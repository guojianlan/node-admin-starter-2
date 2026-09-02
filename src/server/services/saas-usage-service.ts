import { HTTPException } from "hono/http-exception";
import { sqlite, type DbClient } from "@/server/db";
import { recordBackgroundOperationLog } from "./operation-log-service";
import {
  assertSaaSResourceScope,
  revalidateSaaSResourceScope,
  type SaaSResourceScope,
} from "./saas-resource-scope-service";

export type SaaSUsagePeriod = "daily" | "monthly" | "lifetime";
export type SaaSUsageOveragePolicy = "reject" | "allow_with_audit";
export type SaaSUsageAggregationScope = "tenant" | "workspace";

export type SaaSPlanLimitInput = {
  moduleId: number;
  metric: string;
  period: SaaSUsagePeriod;
  limitQuantity?: string | null;
  concurrencyLimit?: number | null;
  overagePolicy?: SaaSUsageOveragePolicy;
};

type EffectiveUsagePolicy = {
  tenantId: number;
  workspaceId: number;
  moduleId: number;
  moduleCode: string;
  metric: string;
  period: SaaSUsagePeriod;
  aggregationScope: SaaSUsageAggregationScope;
  limitQuantity: string | null;
  concurrencyLimit: number | null;
  overagePolicy: SaaSUsageOveragePolicy;
  source: string;
  periodStart: string;
  periodEnd: string | null;
};

type ReservationRow = {
  id: number;
  tenantId: number;
  workspaceId: number;
  moduleId: number;
  metric: string;
  aggregationScope: SaaSUsageAggregationScope;
  period: SaaSUsagePeriod;
  periodStart: string;
  periodEnd: string | null;
  status: "reserved" | "settled" | "released" | "expired";
  reservedQuantity: string;
  settledQuantity: string | null;
  concurrentUnits: number;
  limitQuantitySnapshot: string | null;
  concurrencyLimitSnapshot: number | null;
  overagePolicySnapshot: SaaSUsageOveragePolicy;
  policySource: string;
  overage: boolean;
  idempotencyKey: string;
  resourceType: string | null;
  resourceId: string | null;
  requestId: string | null;
  expiresAt: string;
  createdBy: number;
};

const metricPattern = /^[a-z][a-z0-9._-]{1,79}$/;
const unsignedQuantityPattern = /^\d{1,24}(?:\.\d{1,6})?$/;
const signedQuantityPattern = /^-?\d{1,24}(?:\.\d{1,6})?$/;

function normalizeMetric(value: string) {
  const metric = value.trim();
  if (!metricPattern.test(metric)) {
    throw new HTTPException(400, { message: "SaaS 用量 metric 不合法" });
  }
  return metric;
}

function decimalToScaled(value: string, options: { signed?: boolean; allowZero?: boolean } = {}) {
  const normalized = value.trim();
  const pattern = options.signed ? signedQuantityPattern : unsignedQuantityPattern;
  if (!pattern.test(normalized)) {
    throw new HTTPException(400, { message: "SaaS 用量数量必须是最多 6 位小数的合法数值" });
  }
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const scaled = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  const result = negative ? -scaled : scaled;
  if (!options.allowZero && result === 0n) {
    throw new HTTPException(400, { message: "SaaS 用量数量必须大于 0" });
  }
  if (!options.signed && result < 0n) {
    throw new HTTPException(400, { message: "SaaS 用量数量不能为负数" });
  }
  return result;
}

function normalizeQuantity(value: string, options: { signed?: boolean; allowZero?: boolean } = {}) {
  const scaled = decimalToScaled(value, options);
  return scaledToQuantity(scaled);
}

function scaledToQuantity(scaled: bigint) {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;
  const whole = absolute / 1_000_000n;
  const fraction = String(absolute % 1_000_000n)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function normalizeOptionalQuantity(value?: string | null) {
  return value == null ? null : normalizeQuantity(value, { allowZero: true });
}

function normalizeResourcePair(input: {
  resourceType?: string | null;
  resourceId?: string | number | null;
}) {
  const resourceType = input.resourceType?.trim() || null;
  const resourceId = input.resourceId == null ? null : String(input.resourceId).trim() || null;
  if (Boolean(resourceType) !== Boolean(resourceId)) {
    throw new HTTPException(400, { message: "resourceType 与 resourceId 必须同时提供" });
  }
  if (resourceType && !metricPattern.test(resourceType)) {
    throw new HTTPException(400, { message: "SaaS 用量 resourceType 不合法" });
  }
  if (resourceId && resourceId.length > 200) {
    throw new HTTPException(400, { message: "SaaS 用量 resourceId 不能超过 200 个字符" });
  }
  return { resourceType, resourceId };
}

function assertPolicyValues(input: {
  limitQuantity?: string | null;
  concurrencyLimit?: number | null;
}) {
  const limitQuantity = normalizeOptionalQuantity(input.limitQuantity);
  const concurrencyLimit = input.concurrencyLimit ?? null;
  if (concurrencyLimit != null && (!Number.isInteger(concurrencyLimit) || concurrencyLimit < 1)) {
    throw new HTTPException(400, { message: "并发额度必须是正整数" });
  }
  if (limitQuantity == null && concurrencyLimit == null) {
    throw new HTTPException(400, { message: "用量策略必须至少配置总量或并发额度" });
  }
  return { limitQuantity, concurrencyLimit };
}

function periodWindow(period: SaaSUsagePeriod, now = new Date()) {
  if (period === "lifetime") {
    return { periodStart: new Date(0).toISOString(), periodEnd: null };
  }
  if (period === "daily") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

async function assertActiveModule(moduleId: number, dbClient: DbClient = sqlite) {
  const moduleRecord = (await dbClient
    .prepare(
      `SELECT id, code, status FROM saas_module
       WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(moduleId)) as { id: number; code: string; status: string } | undefined;
  if (!moduleRecord) throw new HTTPException(404, { message: "SaaS 模块不存在" });
  if (moduleRecord.status !== "active") {
    throw new HTTPException(409, { message: "SaaS 模块尚未上架" });
  }
  return moduleRecord;
}

function validatePlanLimits(limits: SaaSPlanLimitInput[]) {
  const keys = new Set<string>();
  return limits.map((limit) => {
    const moduleId = Number(limit.moduleId);
    if (!Number.isInteger(moduleId) || moduleId <= 0) {
      throw new HTTPException(400, { message: "套餐 moduleId 不合法" });
    }
    const metric = normalizeMetric(limit.metric);
    const values = assertPolicyValues(limit);
    const key = `${moduleId}:${metric}:${limit.period}`;
    if (keys.has(key)) throw new HTTPException(400, { message: "套餐用量限制不能重复" });
    keys.add(key);
    return {
      moduleId,
      metric,
      period: limit.period,
      ...values,
      overagePolicy: limit.overagePolicy ?? "reject",
    };
  });
}

async function replacePlanLimits(
  dbClient: DbClient,
  input: { planId: number; userId: number; limits: SaaSPlanLimitInput[] },
) {
  const limits = validatePlanLimits(input.limits);
  for (const limit of limits) await assertActiveModule(limit.moduleId, dbClient);
  await dbClient.prepare("DELETE FROM saas_plan_module_limit WHERE plan_id = ?").run(input.planId);
  for (const limit of limits) {
    await dbClient
      .prepare(
        `INSERT INTO saas_plan_module_limit
          (plan_id, module_id, metric, period, limit_quantity, concurrency_limit,
           overage_policy, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?::numeric, ?, ?, ?, ?)`,
      )
      .run(
        input.planId,
        limit.moduleId,
        limit.metric,
        limit.period,
        limit.limitQuantity,
        limit.concurrencyLimit,
        limit.overagePolicy,
        input.userId,
        input.userId,
      );
  }
}

export async function listSaaSPlans(input: { page: number; pageSize: number; status?: string }) {
  const where = ["deleted_at IS NULL"];
  const params: Array<string | number> = [];
  if (input.status) {
    where.push("status = ?");
    params.push(input.status);
  }
  const whereSql = where.join(" AND ");
  const count = (await sqlite
    .prepare(`SELECT COUNT(*)::int AS total FROM saas_plan WHERE ${whereSql}`)
    .get(...params)) as { total: number };
  const plans = (await sqlite
    .prepare(
      `SELECT id, code, name, description, status, is_system AS "isSystem",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM saas_plan WHERE ${whereSql}
       ORDER BY is_system DESC, id ASC LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, (input.page - 1) * input.pageSize)) as Array<
    Record<string, unknown> & { id: number }
  >;
  if (!plans.length) {
    return { data: [], page: input.page, pageSize: input.pageSize, total: Number(count.total) };
  }
  const placeholders = plans.map(() => "?").join(", ");
  const limits = (await sqlite
    .prepare(
      `SELECT plan_limit.id, plan_limit.plan_id AS "planId",
        plan_limit.module_id AS "moduleId", module.code AS "moduleCode",
        plan_limit.metric, plan_limit.period,
        plan_limit.limit_quantity::text AS "limitQuantity",
        plan_limit.concurrency_limit AS "concurrencyLimit",
        plan_limit.overage_policy AS "overagePolicy"
       FROM saas_plan_module_limit plan_limit
       INNER JOIN saas_module module ON module.id = plan_limit.module_id
       WHERE plan_limit.plan_id IN (${placeholders})
       ORDER BY plan_limit.plan_id, module.code, plan_limit.metric, plan_limit.period`,
    )
    .all(...plans.map((plan) => plan.id))) as Array<Record<string, unknown> & { planId: number }>;
  return {
    data: plans.map((plan) => ({
      ...plan,
      limits: limits.filter((limit) => Number(limit.planId) === Number(plan.id)),
    })),
    page: input.page,
    pageSize: input.pageSize,
    total: Number(count.total),
  };
}

export async function createSaaSPlan(input: {
  userId: number;
  code: string;
  name: string;
  description?: string | null;
  status: "draft" | "active" | "retired";
  limits: SaaSPlanLimitInput[];
}) {
  const code = input.code.trim();
  if (!/^[a-z][a-z0-9-]{1,49}$/.test(code)) {
    throw new HTTPException(400, { message: "套餐 code 不合法" });
  }
  const id = await sqlite.transaction(async (tx) => {
    const created = await tx
      .prepare(
        `INSERT INTO saas_plan
          (code, name, description, status, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .run(
        code,
        input.name.trim(),
        input.description?.trim() || null,
        input.status,
        input.userId,
        input.userId,
      );
    const planId = Number(created.lastInsertRowid);
    await replacePlanLimits(tx, { planId, userId: input.userId, limits: input.limits });
    return planId;
  });
  return { id };
}

export async function updateSaaSPlan(input: {
  userId: number;
  id: number;
  name?: string;
  description?: string | null;
  status?: "draft" | "active" | "retired";
  limits?: SaaSPlanLimitInput[];
}) {
  await sqlite.transaction(async (tx) => {
    const existing = await tx
      .prepare("SELECT id FROM saas_plan WHERE id = ? AND deleted_at IS NULL FOR UPDATE")
      .get(input.id);
    if (!existing) throw new HTTPException(404, { message: "SaaS 套餐不存在" });
    await tx
      .prepare(
        `UPDATE saas_plan SET name = COALESCE(?, name),
          description = CASE WHEN ? THEN ? ELSE description END,
          status = COALESCE(?, status), updated_by = ?, updated_at = now()
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        input.name?.trim() || null,
        input.description !== undefined,
        input.description?.trim() || null,
        input.status ?? null,
        input.userId,
        input.id,
      );
    if (input.limits) {
      await replacePlanLimits(tx, {
        planId: input.id,
        userId: input.userId,
        limits: input.limits,
      });
    }
  });
  return { id: input.id };
}

export async function assignSaaSTenantSubscription(input: {
  userId: number;
  tenantId: number;
  planId: number;
  status: "trial" | "active" | "suspended" | "expired" | "cancelled";
  startsAt?: string;
  endsAt?: string | null;
}) {
  if (input.endsAt) {
    const startsAt = input.startsAt ? new Date(input.startsAt).getTime() : Date.now();
    if (new Date(input.endsAt).getTime() <= startsAt) {
      throw new HTTPException(400, { message: "订阅结束时间必须晚于开始时间" });
    }
  }
  const subscriptionId = await sqlite.transaction(async (tx) => {
    const tenant = (await tx
      .prepare(
        `SELECT id, status FROM saas_tenant
         WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      )
      .get(input.tenantId)) as { id: number; status: string } | undefined;
    if (!tenant) throw new HTTPException(404, { message: "Tenant 不存在" });
    if (tenant.status !== "active" && ["trial", "active"].includes(input.status)) {
      throw new HTTPException(409, { message: "停用 Tenant 不能启用套餐订阅" });
    }
    const plan = (await tx
      .prepare("SELECT id, status FROM saas_plan WHERE id = ? AND deleted_at IS NULL")
      .get(input.planId)) as { id: number; status: string } | undefined;
    if (!plan) throw new HTTPException(404, { message: "SaaS 套餐不存在" });
    if (["trial", "active"].includes(input.status) && plan.status !== "active") {
      throw new HTTPException(409, { message: "只有 active 套餐可以分配给 Tenant" });
    }
    const row = await tx
      .prepare(
        `INSERT INTO saas_tenant_subscription
          (tenant_id, plan_id, status, starts_at, ends_at, created_by, updated_by)
         VALUES (?, ?, ?, COALESCE(?, now()), ?, ?, ?)
         ON CONFLICT (tenant_id) WHERE deleted_at IS NULL DO UPDATE SET
           plan_id = EXCLUDED.plan_id, status = EXCLUDED.status,
           starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
           updated_by = EXCLUDED.updated_by, updated_at = now()
         RETURNING id`,
      )
      .run(
        input.tenantId,
        input.planId,
        input.status,
        input.startsAt ?? null,
        input.endsAt ?? null,
        input.userId,
        input.userId,
      );
    return Number(row.lastInsertRowid);
  });
  return { id: subscriptionId };
}

export async function upsertSaaSUsagePolicyOverride(input: {
  userId: number;
  tenantId: number;
  workspaceId?: number | null;
  moduleId: number;
  metric: string;
  period: SaaSUsagePeriod;
  limitQuantity?: string | null;
  concurrencyLimit?: number | null;
  overagePolicy: SaaSUsageOveragePolicy;
  status?: number;
  reason: string;
}) {
  const metric = normalizeMetric(input.metric);
  const values = assertPolicyValues(input);
  const id = await sqlite.transaction(async (tx) => {
    const tenant = await tx
      .prepare("SELECT id FROM saas_tenant WHERE id = ? AND deleted_at IS NULL")
      .get(input.tenantId);
    if (!tenant) throw new HTTPException(404, { message: "Tenant 不存在" });
    if (input.workspaceId) {
      const workspace = await tx
        .prepare(
          `SELECT id FROM saas_workspace
           WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
        )
        .get(input.workspaceId, input.tenantId);
      if (!workspace) throw new HTTPException(404, { message: "Workspace 不属于目标 Tenant" });
    }
    await assertActiveModule(input.moduleId, tx);
    const existing = (await tx
      .prepare(
        `SELECT id FROM saas_usage_policy_override
         WHERE tenant_id = ? AND workspace_id IS NOT DISTINCT FROM ?::int
           AND module_id = ? AND metric = ? AND period = ? AND deleted_at IS NULL
         FOR UPDATE`,
      )
      .get(input.tenantId, input.workspaceId ?? null, input.moduleId, metric, input.period)) as
      | { id: number }
      | undefined;
    if (existing) {
      await tx
        .prepare(
          `UPDATE saas_usage_policy_override SET
            limit_quantity = ?::numeric, concurrency_limit = ?, overage_policy = ?,
            status = ?, reason = ?, updated_by = ?, updated_at = now()
           WHERE id = ?`,
        )
        .run(
          values.limitQuantity,
          values.concurrencyLimit,
          input.overagePolicy,
          input.status ?? 1,
          input.reason.trim(),
          input.userId,
          existing.id,
        );
      return existing.id;
    }
    const created = await tx
      .prepare(
        `INSERT INTO saas_usage_policy_override
          (tenant_id, workspace_id, module_id, metric, period, limit_quantity,
           concurrency_limit, overage_policy, status, reason, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?::numeric, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .run(
        input.tenantId,
        input.workspaceId ?? null,
        input.moduleId,
        metric,
        input.period,
        values.limitQuantity,
        values.concurrencyLimit,
        input.overagePolicy,
        input.status ?? 1,
        input.reason.trim(),
        input.userId,
        input.userId,
      );
    return Number(created.lastInsertRowid);
  });
  return { id };
}

async function resolveEffectiveUsagePolicy(
  input: {
    userId: number;
    scope: SaaSResourceScope;
    moduleId: number;
    metric: string;
    period: SaaSUsagePeriod;
    lockEntitlement?: boolean;
  },
  dbClient: DbClient = sqlite,
): Promise<EffectiveUsagePolicy> {
  const scope = await revalidateSaaSResourceScope(
    { userId: input.userId, scope: input.scope },
    dbClient,
  );
  const metric = normalizeMetric(input.metric);
  const entitlement = (await dbClient
    .prepare(
      `SELECT entitlement.id, entitlement.monthly_task_limit_override AS "monthlyTaskLimitOverride",
        entitlement.max_concurrent_task_override AS "maxConcurrentTaskOverride",
        module.id AS "moduleId", module.code AS "moduleCode"
       FROM saas_tenant_entitlement entitlement
       INNER JOIN saas_module module
         ON module.id = entitlement.module_id AND module.deleted_at IS NULL
       WHERE entitlement.tenant_id = ? AND entitlement.module_id = ?
         AND entitlement.deleted_at IS NULL
         AND entitlement.status IN ('trial', 'active')
         AND entitlement.starts_at <= now()
         AND (entitlement.expires_at IS NULL OR entitlement.expires_at > now())
         AND module.status = 'active'
       LIMIT 1${input.lockEntitlement ? " FOR UPDATE OF entitlement" : ""}`,
    )
    .get(scope.tenantId, input.moduleId)) as
    | {
        id: number;
        monthlyTaskLimitOverride: number | null;
        maxConcurrentTaskOverride: number | null;
        moduleId: number;
        moduleCode: string;
      }
    | undefined;
  if (!entitlement) {
    throw new HTTPException(403, { message: "当前 Tenant 未开通该模块或 Entitlement 已失效" });
  }

  const overrides = (await dbClient
    .prepare(
      `SELECT workspace_id AS "workspaceId", limit_quantity::text AS "limitQuantity",
        concurrency_limit AS "concurrencyLimit", overage_policy AS "overagePolicy"
       FROM saas_usage_policy_override
       WHERE tenant_id = ? AND (workspace_id = ? OR workspace_id IS NULL)
         AND module_id = ? AND metric = ? AND period = ?
         AND status = 1 AND deleted_at IS NULL
       ORDER BY CASE WHEN workspace_id = ? THEN 0 ELSE 1 END
       LIMIT 2`,
    )
    .all(
      scope.tenantId,
      scope.workspaceId,
      input.moduleId,
      metric,
      input.period,
      scope.workspaceId,
    )) as Array<{
    workspaceId: number | null;
    limitQuantity: string | null;
    concurrencyLimit: number | null;
    overagePolicy: SaaSUsageOveragePolicy;
  }>;
  const workspaceOverride = overrides.find(
    (override) => Number(override.workspaceId) === Number(scope.workspaceId),
  );
  const tenantOverride = overrides.find((override) => override.workspaceId == null);
  const selectedOverride = workspaceOverride ?? tenantOverride;

  const planLimit = (await dbClient
    .prepare(
      `SELECT plan.code AS "planCode", plan_limit.limit_quantity::text AS "limitQuantity",
        plan_limit.concurrency_limit AS "concurrencyLimit",
        plan_limit.overage_policy AS "overagePolicy"
       FROM saas_tenant_subscription subscription
       INNER JOIN saas_plan plan
         ON plan.id = subscription.plan_id AND plan.deleted_at IS NULL AND plan.status = 'active'
       INNER JOIN saas_plan_module_limit plan_limit
         ON plan_limit.plan_id = plan.id AND plan_limit.module_id = ?
        AND plan_limit.metric = ? AND plan_limit.period = ?
       WHERE subscription.tenant_id = ? AND subscription.deleted_at IS NULL
         AND subscription.status IN ('trial', 'active')
         AND subscription.starts_at <= now()
         AND (subscription.ends_at IS NULL OR subscription.ends_at > now())
       LIMIT 1`,
    )
    .get(input.moduleId, metric, input.period, scope.tenantId)) as
    | {
        planCode: string;
        limitQuantity: string | null;
        concurrencyLimit: number | null;
        overagePolicy: SaaSUsageOveragePolicy;
      }
    | undefined;

  let limitQuantity: string | null = null;
  let concurrencyLimit: number | null = null;
  let overagePolicy: SaaSUsageOveragePolicy = "reject";
  let aggregationScope: SaaSUsageAggregationScope = "tenant";
  let source = "unconfigured";
  if (selectedOverride) {
    limitQuantity = selectedOverride.limitQuantity;
    concurrencyLimit = selectedOverride.concurrencyLimit;
    overagePolicy = selectedOverride.overagePolicy;
    aggregationScope = workspaceOverride ? "workspace" : "tenant";
    source = workspaceOverride ? "workspace_override" : "tenant_override";
  } else if (
    metric === "task_count" &&
    input.period === "monthly" &&
    (entitlement.monthlyTaskLimitOverride != null || entitlement.maxConcurrentTaskOverride != null)
  ) {
    limitQuantity =
      entitlement.monthlyTaskLimitOverride == null
        ? (planLimit?.limitQuantity ?? null)
        : String(entitlement.monthlyTaskLimitOverride);
    concurrencyLimit = entitlement.maxConcurrentTaskOverride ?? planLimit?.concurrencyLimit ?? null;
    overagePolicy = "reject";
    source = "entitlement_override";
  } else if (planLimit) {
    limitQuantity = planLimit.limitQuantity;
    concurrencyLimit = planLimit.concurrencyLimit;
    overagePolicy = planLimit.overagePolicy;
    source = `plan:${planLimit.planCode}`;
  }
  if (limitQuantity == null && concurrencyLimit == null) {
    throw new HTTPException(409, { message: "当前模块尚未配置可用的 SaaS 用量策略" });
  }
  const window = periodWindow(input.period);
  return {
    tenantId: scope.tenantId,
    workspaceId: scope.workspaceId,
    moduleId: entitlement.moduleId,
    moduleCode: entitlement.moduleCode,
    metric,
    period: input.period,
    aggregationScope,
    limitQuantity,
    concurrencyLimit,
    overagePolicy,
    source,
    ...window,
  };
}

async function expireReservations(
  input: { tenantId?: number; moduleId?: number; metric?: string },
  dbClient: DbClient = sqlite,
) {
  const where = ["status = 'reserved'", "expires_at <= now()"];
  const params: Array<string | number> = [];
  if (input.tenantId) {
    where.push("tenant_id = ?");
    params.push(input.tenantId);
  }
  if (input.moduleId) {
    where.push("module_id = ?");
    params.push(input.moduleId);
  }
  if (input.metric) {
    where.push("metric = ?");
    params.push(input.metric);
  }
  const rows = await dbClient
    .prepare(
      `UPDATE saas_usage_reservation
       SET status = 'expired', released_at = now(), release_reason = 'reservation_expired',
         updated_at = now()
       WHERE ${where.join(" AND ")} RETURNING id`,
    )
    .all(...params);
  return rows.length;
}

function scopeFilter(policy: EffectiveUsagePolicy, alias: string) {
  return policy.aggregationScope === "workspace"
    ? { sql: ` AND ${alias}.workspace_id = ?`, params: [policy.workspaceId] }
    : { sql: "", params: [] as number[] };
}

async function readUsageTotals(policy: EffectiveUsagePolicy, dbClient: DbClient) {
  const ledgerScope = scopeFilter(policy, "ledger");
  const reservationScope = scopeFilter(policy, "reservation");
  const ledger = (await dbClient
    .prepare(
      `SELECT COALESCE(SUM(quantity), 0)::text AS quantity
       FROM saas_usage_ledger ledger
       WHERE ledger.tenant_id = ? AND ledger.module_id = ? AND ledger.metric = ?
         AND ledger.period_start = ?::timestamptz${ledgerScope.sql}`,
    )
    .get(
      policy.tenantId,
      policy.moduleId,
      policy.metric,
      policy.periodStart,
      ...ledgerScope.params,
    )) as { quantity: string };
  const reservations = (await dbClient
    .prepare(
      `SELECT COALESCE(SUM(reserved_quantity), 0)::text AS quantity,
        COALESCE(SUM(concurrent_units), 0)::int AS "concurrentUnits"
       FROM saas_usage_reservation reservation
       WHERE reservation.tenant_id = ? AND reservation.module_id = ? AND reservation.metric = ?
         AND reservation.period_start = ?::timestamptz
         AND reservation.status = 'reserved' AND reservation.expires_at > now()
         ${reservationScope.sql}`,
    )
    .get(
      policy.tenantId,
      policy.moduleId,
      policy.metric,
      policy.periodStart,
      ...reservationScope.params,
    )) as { quantity: string; concurrentUnits: number };
  return {
    settledQuantity: String(ledger.quantity ?? "0"),
    reservedQuantity: String(reservations.quantity ?? "0"),
    concurrentUnits: Number(reservations.concurrentUnits ?? 0),
  };
}

async function getReservation(
  id: number,
  dbClient: DbClient = sqlite,
  options: { lock?: boolean } = {},
) {
  return (await dbClient
    .prepare(
      `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId",
        module_id AS "moduleId", metric, aggregation_scope AS "aggregationScope", period,
        period_start AS "periodStart", period_end AS "periodEnd", status,
        reserved_quantity::text AS "reservedQuantity",
        settled_quantity::text AS "settledQuantity", concurrent_units AS "concurrentUnits",
        limit_quantity_snapshot::text AS "limitQuantitySnapshot",
        concurrency_limit_snapshot AS "concurrencyLimitSnapshot",
        overage_policy_snapshot AS "overagePolicySnapshot", policy_source AS "policySource",
        overage, idempotency_key AS "idempotencyKey", resource_type AS "resourceType",
        resource_id AS "resourceId", request_id AS "requestId", expires_at AS "expiresAt",
        created_by AS "createdBy"
       FROM saas_usage_reservation WHERE id = ?${options.lock ? " FOR UPDATE" : ""}`,
    )
    .get(id)) as ReservationRow | undefined;
}

export async function reserveSaaSUsage(input: {
  userId: number;
  scope: SaaSResourceScope;
  moduleId: number;
  metric: string;
  period: SaaSUsagePeriod;
  quantity: string;
  concurrentUnits?: number;
  idempotencyKey: string;
  expiresInSeconds?: number;
  resourceType?: string | null;
  resourceId?: string | number | null;
  requestId?: string | null;
}) {
  const scope = await revalidateSaaSResourceScope({ userId: input.userId, scope: input.scope });
  const metric = normalizeMetric(input.metric);
  const quantity = normalizeQuantity(input.quantity);
  const quantityScaled = decimalToScaled(quantity);
  const concurrentUnits = input.concurrentUnits ?? 1;
  if (!Number.isInteger(concurrentUnits) || concurrentUnits < 1 || concurrentUnits > 1000) {
    throw new HTTPException(400, { message: "并发占用单位必须是 1 到 1000 的整数" });
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new HTTPException(400, { message: "SaaS 用量 idempotencyKey 不合法" });
  }
  const resource = normalizeResourcePair(input);
  const expiresInSeconds = Math.max(30, Math.min(input.expiresInSeconds ?? 15 * 60, 24 * 60 * 60));

  const result = await sqlite.transaction(async (tx) => {
    const policy = await resolveEffectiveUsagePolicy(
      { ...input, scope, metric, lockEntitlement: true },
      tx,
    );
    await expireReservations({ tenantId: scope.tenantId, moduleId: input.moduleId, metric }, tx);
    const existing = (await tx
      .prepare(
        `SELECT id FROM saas_usage_reservation
         WHERE tenant_id = ? AND workspace_id = ? AND module_id = ?
           AND metric = ? AND idempotency_key = ?`,
      )
      .get(scope.tenantId, scope.workspaceId, input.moduleId, metric, idempotencyKey)) as
      | { id: number }
      | undefined;
    if (existing) {
      const reservation = await getReservation(existing.id, tx, { lock: true });
      if (
        !reservation ||
        decimalToScaled(reservation.reservedQuantity) !== quantityScaled ||
        Number(reservation.concurrentUnits) !== concurrentUnits ||
        reservation.resourceType !== resource.resourceType ||
        reservation.resourceId !== resource.resourceId ||
        reservation.period !== input.period
      ) {
        throw new HTTPException(409, { message: "SaaS 用量 idempotencyKey 已用于其他占用" });
      }
      if (["released", "expired"].includes(reservation.status)) {
        throw new HTTPException(409, { message: "SaaS 用量占用已经释放，不能复用幂等键" });
      }
      return { reservation, replayed: true };
    }

    const totals = await readUsageTotals(policy, tx);
    const settled = decimalToScaled(totals.settledQuantity, { signed: true, allowZero: true });
    const reserved = decimalToScaled(totals.reservedQuantity, { allowZero: true });
    const projected = (settled < 0n ? 0n : settled) + reserved + quantityScaled;
    const limit =
      policy.limitQuantity == null
        ? null
        : decimalToScaled(policy.limitQuantity, { allowZero: true });
    const quantityExceeded = limit != null && projected > limit;
    if (quantityExceeded && policy.overagePolicy === "reject") {
      throw new HTTPException(429, { message: "SaaS 用量额度不足" });
    }
    if (
      policy.concurrencyLimit != null &&
      totals.concurrentUnits + concurrentUnits > policy.concurrencyLimit
    ) {
      throw new HTTPException(429, { message: "SaaS 并发额度已用尽" });
    }
    const created = await tx
      .prepare(
        `INSERT INTO saas_usage_reservation
          (tenant_id, workspace_id, module_id, metric, aggregation_scope, period,
           period_start, period_end, reserved_quantity, concurrent_units,
           limit_quantity_snapshot, concurrency_limit_snapshot, overage_policy_snapshot,
           policy_source, overage, idempotency_key, resource_type, resource_id,
           request_id, expires_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz, ?::numeric, ?,
           ?::numeric, ?, ?, ?, ?, ?, ?, ?, ?,
           now() + (? * interval '1 second'), ?) RETURNING id`,
      )
      .run(
        scope.tenantId,
        scope.workspaceId,
        input.moduleId,
        metric,
        policy.aggregationScope,
        input.period,
        policy.periodStart,
        policy.periodEnd,
        quantity,
        concurrentUnits,
        policy.limitQuantity,
        policy.concurrencyLimit,
        policy.overagePolicy,
        policy.source,
        quantityExceeded,
        idempotencyKey,
        resource.resourceType,
        resource.resourceId,
        input.requestId ?? null,
        expiresInSeconds,
        input.userId,
      );
    return {
      reservation: (await getReservation(Number(created.lastInsertRowid), tx))!,
      replayed: false,
    };
  });
  if (!result.replayed) {
    await recordBackgroundOperationLog({
      userId: input.userId,
      module: "saas.usage",
      action: result.reservation.overage ? "reserveOverage" : "reserve",
      resource: "saas_usage_reservation",
      resourceId: result.reservation.id,
      requestId: input.requestId,
      riskLevel: result.reservation.overage ? "high" : "low",
      saasScope: scope,
      details: {
        moduleId: input.moduleId,
        metric,
        quantity,
        concurrentUnits,
        policySource: result.reservation.policySource,
        resourceType: resource.resourceType,
      },
    });
  }
  return result;
}

async function settleReservationRow(
  dbClient: DbClient,
  reservation: ReservationRow,
  input: {
    quantity?: string;
    source: string;
    description?: string | null;
    createdBy?: number | null;
  },
) {
  const quantity = normalizeQuantity(input.quantity ?? reservation.reservedQuantity, {
    allowZero: true,
  });
  if (reservation.status === "settled") {
    if (
      reservation.settledQuantity == null ||
      decimalToScaled(reservation.settledQuantity, { allowZero: true }) !==
        decimalToScaled(quantity, { allowZero: true })
    ) {
      throw new HTTPException(409, { message: "SaaS 用量占用已按其他数量结算" });
    }
    return { reservation, replayed: true };
  }
  if (reservation.status !== "reserved") {
    throw new HTTPException(409, { message: "SaaS 用量占用已释放或过期，不能结算" });
  }
  if (new Date(reservation.expiresAt).getTime() <= Date.now()) {
    await dbClient
      .prepare(
        `UPDATE saas_usage_reservation SET status = 'expired', released_at = now(),
          release_reason = 'reservation_expired', updated_at = now() WHERE id = ?`,
      )
      .run(reservation.id);
    throw new HTTPException(409, { message: "SaaS 用量占用已过期" });
  }
  const actual = decimalToScaled(quantity, { allowZero: true });
  const reserved = decimalToScaled(reservation.reservedQuantity);
  const overage = actual > reserved;
  if (overage && reservation.overagePolicySnapshot === "reject") {
    throw new HTTPException(429, { message: "实际用量超过已占用额度" });
  }
  await dbClient
    .prepare(
      `INSERT INTO saas_usage_ledger
        (tenant_id, workspace_id, module_id, metric, reservation_id, entry_type,
         quantity, overage, period_start, period_end, source, description,
         resource_type, resource_id, request_id, created_by)
       VALUES (?, ?, ?, ?, ?, 'settlement', ?::numeric, ?, ?::timestamptz,
         ?::timestamptz, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (reservation_id) WHERE entry_type = 'settlement'
         AND reservation_id IS NOT NULL DO NOTHING`,
    )
    .run(
      reservation.tenantId,
      reservation.workspaceId,
      reservation.moduleId,
      reservation.metric,
      reservation.id,
      quantity,
      overage || reservation.overage,
      reservation.periodStart,
      reservation.periodEnd,
      input.source,
      input.description?.trim() || null,
      reservation.resourceType,
      reservation.resourceId,
      reservation.requestId,
      input.createdBy ?? reservation.createdBy,
    );
  await dbClient
    .prepare(
      `UPDATE saas_usage_reservation SET status = 'settled', settled_quantity = ?::numeric,
        settled_at = now(), overage = overage OR ?, updated_at = now()
       WHERE id = ? AND status = 'reserved'`,
    )
    .run(quantity, overage, reservation.id);
  return { reservation: (await getReservation(reservation.id, dbClient))!, replayed: false };
}

export async function settleSaaSUsageReservation(input: {
  userId: number;
  scope: SaaSResourceScope;
  reservationId: number;
  quantity?: string;
  source?: string;
  description?: string | null;
}) {
  const scope = await revalidateSaaSResourceScope({ userId: input.userId, scope: input.scope });
  const result = await sqlite.transaction(async (tx) => {
    const reservation = await getReservation(input.reservationId, tx, { lock: true });
    assertSaaSResourceScope(scope, reservation);
    return settleReservationRow(tx, reservation, {
      quantity: input.quantity,
      source: input.source?.trim() || "service_settlement",
      description: input.description,
      createdBy: input.userId,
    });
  });
  if (!result.replayed) {
    await recordBackgroundOperationLog({
      userId: input.userId,
      module: "saas.usage",
      action: result.reservation.overage ? "settleOverage" : "settle",
      resource: "saas_usage_reservation",
      resourceId: result.reservation.id,
      riskLevel: result.reservation.overage ? "high" : "low",
      saasScope: scope,
      details: {
        moduleId: result.reservation.moduleId,
        metric: result.reservation.metric,
        settledQuantity: result.reservation.settledQuantity,
      },
    });
  }
  return result;
}

async function releaseReservationRow(
  dbClient: DbClient,
  reservation: ReservationRow,
  reason: string,
) {
  if (["released", "expired"].includes(reservation.status)) {
    return { reservation, replayed: true };
  }
  if (reservation.status === "settled") {
    throw new HTTPException(409, { message: "已结算的 SaaS 用量占用不能释放" });
  }
  await dbClient
    .prepare(
      `UPDATE saas_usage_reservation SET status = 'released', released_at = now(),
        release_reason = ?, updated_at = now() WHERE id = ? AND status = 'reserved'`,
    )
    .run(reason.slice(0, 500), reservation.id);
  return { reservation: (await getReservation(reservation.id, dbClient))!, replayed: false };
}

export async function releaseSaaSUsageReservation(input: {
  userId: number;
  scope: SaaSResourceScope;
  reservationId: number;
  reason: string;
}) {
  const scope = await revalidateSaaSResourceScope({ userId: input.userId, scope: input.scope });
  const result = await sqlite.transaction(async (tx) => {
    const reservation = await getReservation(input.reservationId, tx, { lock: true });
    assertSaaSResourceScope(scope, reservation);
    return releaseReservationRow(tx, reservation, input.reason.trim() || "released");
  });
  if (!result.replayed) {
    await recordBackgroundOperationLog({
      userId: input.userId,
      module: "saas.usage",
      action: "release",
      resource: "saas_usage_reservation",
      resourceId: result.reservation.id,
      riskLevel: "low",
      saasScope: scope,
      details: {
        moduleId: result.reservation.moduleId,
        metric: result.reservation.metric,
        reason: input.reason,
      },
    });
  }
  return result;
}

export async function assertSaaSUsageReservationForOperation(
  input: {
    scope: SaaSResourceScope;
    reservationId: number;
    moduleId: number;
    userId: number;
  },
  dbClient: DbClient = sqlite,
) {
  const reservation = await getReservation(input.reservationId, dbClient, { lock: true });
  assertSaaSResourceScope(input.scope, reservation);
  if (
    reservation.moduleId !== input.moduleId ||
    reservation.createdBy !== input.userId ||
    reservation.status !== "reserved" ||
    new Date(reservation.expiresAt).getTime() <= Date.now()
  ) {
    throw new HTTPException(409, { message: "SaaS 用量占用与异步操作不匹配或已失效" });
  }
  return reservation;
}

export async function settleSaaSUsageForOperation(
  input: {
    operationId: number;
    quantity?: string;
    source?: string;
    description?: string | null;
  },
  dbClient: DbClient,
) {
  const reservation = (await dbClient
    .prepare(
      `SELECT usage_reservation_id AS "reservationId"
       FROM saas_async_operation WHERE id = ?`,
    )
    .get(input.operationId)) as { reservationId: number | null } | undefined;
  if (!reservation?.reservationId) return null;
  const row = await getReservation(reservation.reservationId, dbClient, { lock: true });
  if (!row) throw new HTTPException(409, { message: "SaaS 异步操作的用量占用不存在" });
  return settleReservationRow(dbClient, row, {
    quantity: input.quantity,
    source: input.source?.trim() || "async_operation",
    description: input.description,
  });
}

export async function releaseSaaSUsageForOperation(
  input: { operationId: number; reason: string },
  dbClient: DbClient,
) {
  const reservation = (await dbClient
    .prepare(
      `SELECT usage_reservation_id AS "reservationId"
       FROM saas_async_operation WHERE id = ?`,
    )
    .get(input.operationId)) as { reservationId: number | null } | undefined;
  if (!reservation?.reservationId) return null;
  const row = await getReservation(reservation.reservationId, dbClient, { lock: true });
  if (!row) throw new HTTPException(409, { message: "SaaS 异步操作的用量占用不存在" });
  return releaseReservationRow(dbClient, row, input.reason.trim() || "async_operation_released");
}

export async function getSaaSUsageSummary(input: {
  userId: number;
  scope: SaaSResourceScope;
  moduleId: number;
  metric: string;
  period: SaaSUsagePeriod;
}) {
  const scope = await revalidateSaaSResourceScope({ userId: input.userId, scope: input.scope });
  return sqlite.transaction(async (tx) => {
    const policy = await resolveEffectiveUsagePolicy({ ...input, scope }, tx);
    await expireReservations(
      { tenantId: scope.tenantId, moduleId: input.moduleId, metric: policy.metric },
      tx,
    );
    const totals = await readUsageTotals(policy, tx);
    const settled = decimalToScaled(totals.settledQuantity, { signed: true, allowZero: true });
    const reserved = decimalToScaled(totals.reservedQuantity, { allowZero: true });
    const limit =
      policy.limitQuantity == null
        ? null
        : decimalToScaled(policy.limitQuantity, { allowZero: true });
    const remaining = limit == null ? null : limit - (settled < 0n ? 0n : settled) - reserved;
    return {
      policy,
      settledQuantity: normalizeQuantity(totals.settledQuantity, {
        signed: true,
        allowZero: true,
      }),
      reservedQuantity: normalizeQuantity(totals.reservedQuantity, { allowZero: true }),
      remainingQuantity: remaining == null ? null : scaledToQuantity(remaining),
      concurrentUnits: totals.concurrentUnits,
    };
  });
}

export async function listSaaSUsageLedger(input: {
  userId: number;
  scope: SaaSResourceScope;
  page: number;
  pageSize: number;
  moduleId?: number;
  metric?: string;
}) {
  const scope = await revalidateSaaSResourceScope({ userId: input.userId, scope: input.scope });
  const where = ["ledger.tenant_id = ?", "ledger.workspace_id = ?"];
  const params: Array<string | number> = [scope.tenantId, scope.workspaceId];
  if (input.moduleId) {
    where.push("ledger.module_id = ?");
    params.push(input.moduleId);
  }
  if (input.metric) {
    where.push("ledger.metric = ?");
    params.push(normalizeMetric(input.metric));
  }
  const whereSql = where.join(" AND ");
  const count = (await sqlite
    .prepare(`SELECT COUNT(*)::int AS total FROM saas_usage_ledger ledger WHERE ${whereSql}`)
    .get(...params)) as { total: number };
  const data = await sqlite
    .prepare(
      `SELECT ledger.id, ledger.tenant_id AS "tenantId", ledger.workspace_id AS "workspaceId",
        ledger.module_id AS "moduleId", module.code AS "moduleCode", ledger.metric,
        ledger.reservation_id AS "reservationId", ledger.entry_type AS "entryType",
        ledger.quantity::text AS quantity, ledger.overage,
        ledger.period_start AS "periodStart", ledger.period_end AS "periodEnd",
        ledger.source, ledger.description, ledger.idempotency_key AS "idempotencyKey",
        ledger.resource_type AS "resourceType",
        ledger.resource_id AS "resourceId", ledger.request_id AS "requestId",
        ledger.occurred_at AS "occurredAt"
       FROM saas_usage_ledger ledger
       INNER JOIN saas_module module ON module.id = ledger.module_id
       WHERE ${whereSql}
       ORDER BY ledger.occurred_at DESC, ledger.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, (input.page - 1) * input.pageSize);
  return { data, page: input.page, pageSize: input.pageSize, total: Number(count.total) };
}

export async function addSaaSUsageAdjustment(input: {
  userId: number;
  scope: SaaSResourceScope;
  moduleId: number;
  metric: string;
  period: SaaSUsagePeriod;
  quantity: string;
  description: string;
  idempotencyKey: string;
  requestId?: string | null;
}) {
  const scope = await revalidateSaaSResourceScope({ userId: input.userId, scope: input.scope });
  const policy = await resolveEffectiveUsagePolicy({ ...input, scope });
  const quantity = normalizeQuantity(input.quantity, { signed: true });
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new HTTPException(400, { message: "SaaS 用量调整 idempotencyKey 不合法" });
  }
  const result = await sqlite.transaction(async (tx) => {
    const created = await tx
      .prepare(
        `INSERT INTO saas_usage_ledger
          (tenant_id, workspace_id, module_id, metric, entry_type, quantity, overage,
           period_start, period_end, source, description, idempotency_key, request_id, created_by)
         VALUES (?, ?, ?, ?, 'adjustment', ?::numeric, false, ?::timestamptz,
           ?::timestamptz, 'manual_adjustment', ?, ?, ?, ?)
         ON CONFLICT (tenant_id, workspace_id, module_id, metric, idempotency_key)
           WHERE entry_type IN ('adjustment', 'reversal') AND idempotency_key IS NOT NULL
           DO NOTHING
         RETURNING id`,
      )
      .run(
        scope.tenantId,
        scope.workspaceId,
        input.moduleId,
        policy.metric,
        quantity,
        policy.periodStart,
        policy.periodEnd,
        input.description.trim(),
        idempotencyKey,
        input.requestId ?? null,
        input.userId,
      );
    const id = Number(created.lastInsertRowid || 0);
    if (id) return { id, replayed: false };
    const existing = (await tx
      .prepare(
        `SELECT id, quantity::text, period_start AS "periodStart", description
         FROM saas_usage_ledger
         WHERE tenant_id = ? AND workspace_id = ? AND module_id = ? AND metric = ?
           AND idempotency_key = ? AND entry_type = 'adjustment'`,
      )
      .get(scope.tenantId, scope.workspaceId, input.moduleId, policy.metric, idempotencyKey)) as
      | { id: number; quantity: string; periodStart: string; description: string | null }
      | undefined;
    if (
      !existing ||
      decimalToScaled(existing.quantity, { signed: true, allowZero: true }) !==
        decimalToScaled(quantity, { signed: true, allowZero: true }) ||
      new Date(existing.periodStart).getTime() !== new Date(policy.periodStart).getTime() ||
      existing.description !== input.description.trim()
    ) {
      throw new HTTPException(409, { message: "SaaS 用量调整幂等键已用于其他补偿" });
    }
    return { id: existing.id, replayed: true };
  });
  return result;
}

export async function expireSaaSUsageReservations() {
  return expireReservations({});
}
