import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/server/app";
import {
  cancelSaaSAsyncOperation,
  claimNextSaaSAsyncOperation,
  completeSaaSAsyncOperation,
  createMeteredSaaSAsyncOperation,
  failSaaSAsyncOperation,
} from "@/server/services/saas-async-operation-service";
import {
  createTenantEntitlement,
  updateTenantEntitlement,
} from "@/server/services/saas-entitlement-service";
import { resolveSaaSResourceScope } from "@/server/services/saas-resource-scope-service";
import {
  assignSaaSTenantSubscription,
  createSaaSPlan,
  getSaaSUsageSummary,
  releaseSaaSUsageReservation,
  reserveSaaSUsage,
  settleSaaSUsageReservation,
  upsertSaaSUsagePolicyOverride,
} from "@/server/services/saas-usage-service";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase, sqlite } from "../helpers/db";

type ApiResponse<T = unknown> = { success: boolean; msg: string; data?: T };

async function readJson<T = unknown>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

async function login() {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: getAdminTestPassword() }),
  });
  return String((await readJson<{ token: string }>(response)).data?.token ?? "");
}

function jsonHeaders(token: string, tenantId?: number, workspaceId?: number) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...(tenantId ? { "x-saas-tenant-id": String(tenantId) } : {}),
    ...(workspaceId ? { "x-saas-workspace-id": String(workspaceId) } : {}),
  };
}

async function createTenant(token: string, code: string) {
  const response = await app.request("/api/saas/tenants", {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify({ name: `Tenant ${code}`, code, region: "global", retentionDays: 365 }),
  });
  expect(response.status).toBe(200);
  return (await readJson<{ id: number; defaultWorkspaceId: number }>(response)).data!;
}

async function setupUsageFoundation(
  input: {
    limitQuantity?: string;
    concurrencyLimit?: number;
    overagePolicy?: "reject" | "allow_with_audit";
  } = {},
) {
  const token = await login();
  const tenantA = await createTenant(token, "usage-a");
  const tenantB = await createTenant(token, "usage-b");
  const moduleRecord = (await sqlite
    .prepare("UPDATE saas_module SET status = 'active' WHERE code = 'novel' RETURNING id")
    .get()) as { id: number };
  const moduleId = Number(moduleRecord.id);
  const plan = await createSaaSPlan({
    userId: 1,
    code: "foundation",
    name: "Foundation",
    status: "active",
    limits: [
      {
        moduleId,
        metric: "task_count",
        period: "monthly",
        limitQuantity: input.limitQuantity ?? "2",
        concurrencyLimit: input.concurrencyLimit ?? 1,
        overagePolicy: input.overagePolicy ?? "reject",
      },
    ],
  });
  for (const tenant of [tenantA, tenantB]) {
    await assignSaaSTenantSubscription({
      userId: 1,
      tenantId: tenant.id,
      planId: plan.id,
      status: "active",
    });
    await createTenantEntitlement({
      userId: 1,
      tenantId: tenant.id,
      moduleId,
      status: "active",
      source: "plan",
    });
  }
  const scopeA = await resolveSaaSResourceScope({
    userId: 1,
    tenantId: tenantA.id,
    workspaceId: tenantA.defaultWorkspaceId,
  });
  const scopeB = await resolveSaaSResourceScope({
    userId: 1,
    tenantId: tenantB.id,
    workspaceId: tenantB.defaultWorkspaceId,
  });
  return { token, tenantA, tenantB, moduleId, planId: plan.id, scopeA, scopeB };
}

describe("Foundation F3 SaaS usage and quota", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("resolves Plan, Entitlement, Tenant, and Workspace policy precedence", async () => {
    const fixture = await setupUsageFoundation({ limitQuantity: "10", concurrencyLimit: 2 });
    const planSummary = await getSaaSUsageSummary({
      userId: 1,
      scope: fixture.scopeA,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
    });
    expect(planSummary.policy).toMatchObject({
      source: "plan:foundation",
      aggregationScope: "tenant",
      limitQuantity: "10.000000",
      concurrencyLimit: 2,
    });

    const entitlement = (await sqlite
      .prepare(
        `SELECT id FROM saas_tenant_entitlement
         WHERE tenant_id = ? AND module_id = ?`,
      )
      .get(fixture.tenantA.id, fixture.moduleId)) as { id: number };
    await updateTenantEntitlement({
      userId: 1,
      id: entitlement.id,
      monthlyTaskLimitOverride: 8,
      maxConcurrentTaskOverride: 3,
    });
    expect(
      (
        await getSaaSUsageSummary({
          userId: 1,
          scope: fixture.scopeA,
          moduleId: fixture.moduleId,
          metric: "task_count",
          period: "monthly",
        })
      ).policy,
    ).toMatchObject({ source: "entitlement_override", limitQuantity: "8", concurrencyLimit: 3 });

    await upsertSaaSUsagePolicyOverride({
      userId: 1,
      tenantId: fixture.tenantA.id,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
      limitQuantity: "6",
      concurrencyLimit: 2,
      overagePolicy: "reject",
      reason: "Tenant contract",
    });
    expect(
      (
        await getSaaSUsageSummary({
          userId: 1,
          scope: fixture.scopeA,
          moduleId: fixture.moduleId,
          metric: "task_count",
          period: "monthly",
        })
      ).policy,
    ).toMatchObject({ source: "tenant_override", limitQuantity: "6.000000" });

    await upsertSaaSUsagePolicyOverride({
      userId: 1,
      tenantId: fixture.tenantA.id,
      workspaceId: fixture.tenantA.defaultWorkspaceId,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
      limitQuantity: "4",
      concurrencyLimit: 1,
      overagePolicy: "reject",
      reason: "Workspace contract",
    });
    expect(
      (
        await getSaaSUsageSummary({
          userId: 1,
          scope: fixture.scopeA,
          moduleId: fixture.moduleId,
          metric: "task_count",
          period: "monthly",
        })
      ).policy,
    ).toMatchObject({
      source: "workspace_override",
      aggregationScope: "workspace",
      limitQuantity: "4.000000",
    });
  });

  it("makes reserve, settle, and release idempotent while enforcing total and concurrency limits", async () => {
    const fixture = await setupUsageFoundation({ limitQuantity: "2", concurrencyLimit: 1 });
    const first = await reserveSaaSUsage({
      userId: 1,
      scope: fixture.scopeA,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
      quantity: "1",
      idempotencyKey: "first",
    });
    const replay = await reserveSaaSUsage({
      userId: 1,
      scope: fixture.scopeA,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
      quantity: "1",
      idempotencyKey: "first",
    });
    expect(replay).toMatchObject({ replayed: true });
    expect(replay.reservation.id).toBe(first.reservation.id);
    await expect(
      reserveSaaSUsage({
        userId: 1,
        scope: fixture.scopeA,
        moduleId: fixture.moduleId,
        metric: "task_count",
        period: "monthly",
        quantity: "1",
        idempotencyKey: "blocked-by-concurrency",
      }),
    ).rejects.toMatchObject({ status: 429 });

    await releaseSaaSUsageReservation({
      userId: 1,
      scope: fixture.scopeA,
      reservationId: first.reservation.id,
      reason: "request_failed",
    });
    const second = await reserveSaaSUsage({
      userId: 1,
      scope: fixture.scopeA,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
      quantity: "1",
      idempotencyKey: "second",
    });
    const settled = await settleSaaSUsageReservation({
      userId: 1,
      scope: fixture.scopeA,
      reservationId: second.reservation.id,
    });
    expect(settled.reservation).toMatchObject({ status: "settled", settledQuantity: "1.000000" });
    expect(
      await settleSaaSUsageReservation({
        userId: 1,
        scope: fixture.scopeA,
        reservationId: second.reservation.id,
      }),
    ).toMatchObject({ replayed: true });
    await expect(
      settleSaaSUsageReservation({
        userId: 1,
        scope: fixture.scopeB,
        reservationId: second.reservation.id,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const third = await reserveSaaSUsage({
      userId: 1,
      scope: fixture.scopeA,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
      quantity: "1",
      idempotencyKey: "third",
    });
    await settleSaaSUsageReservation({
      userId: 1,
      scope: fixture.scopeA,
      reservationId: third.reservation.id,
    });
    await expect(
      reserveSaaSUsage({
        userId: 1,
        scope: fixture.scopeA,
        moduleId: fixture.moduleId,
        metric: "task_count",
        period: "monthly",
        quantity: "1",
        idempotencyKey: "over-limit",
      }),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("serializes concurrent reserves and safely reclaims expired reservations", async () => {
    const fixture = await setupUsageFoundation({ limitQuantity: "1", concurrencyLimit: 2 });
    const concurrent = await Promise.allSettled(
      ["race-a", "race-b"].map((idempotencyKey) =>
        reserveSaaSUsage({
          userId: 1,
          scope: fixture.scopeA,
          moduleId: fixture.moduleId,
          metric: "task_count",
          period: "monthly",
          quantity: "1",
          idempotencyKey,
        }),
      ),
    );
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    const winner = concurrent.find((result) => result.status === "fulfilled");
    const reservationId = winner && winner.status === "fulfilled" ? winner.value.reservation.id : 0;
    await sqlite
      .prepare(
        "UPDATE saas_usage_reservation SET expires_at = now() - interval '1 second' WHERE id = ?",
      )
      .run(reservationId);
    await expect(
      reserveSaaSUsage({
        userId: 1,
        scope: fixture.scopeA,
        moduleId: fixture.moduleId,
        metric: "task_count",
        period: "monthly",
        quantity: "1",
        idempotencyKey: "after-expiry",
      }),
    ).resolves.toMatchObject({ replayed: false });
    expect(
      await sqlite
        .prepare("SELECT status FROM saas_usage_reservation WHERE id = ?")
        .get(reservationId),
    ).toMatchObject({ status: "expired" });
  });

  it("settles completed metered operations and releases failed, cancelled, and invalid-scope work", async () => {
    const fixture = await setupUsageFoundation({ limitQuantity: "10", concurrencyLimit: 1 });
    const completed = await createMeteredSaaSAsyncOperation({
      userId: 1,
      scope: fixture.scopeA,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
      quantity: "2",
      kind: "job",
      operationType: "test.metered-completed",
      payload: { tenantId: fixture.tenantB.id },
      idempotencyKey: "metered-completed",
    });
    const completedClaim = await claimNextSaaSAsyncOperation({
      workerId: "metered-complete-worker",
      kinds: ["job"],
    });
    expect(completedClaim).toMatchObject({
      id: completed!.id,
      tenantId: fixture.tenantA.id,
      moduleId: fixture.moduleId,
    });
    await completeSaaSAsyncOperation({
      id: completed!.id,
      workerId: "metered-complete-worker",
      usageQuantity: "2",
    });

    const failed = await createMeteredSaaSAsyncOperation({
      userId: 1,
      scope: fixture.scopeA,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
      quantity: "1",
      kind: "tool",
      operationType: "test.metered-failed",
      payload: {},
      idempotencyKey: "metered-failed",
    });
    await claimNextSaaSAsyncOperation({ workerId: "metered-fail-worker", kinds: ["tool"] });
    await failSaaSAsyncOperation({
      id: failed!.id,
      workerId: "metered-fail-worker",
      errorMessage: "provider failed",
    });

    const cancelled = await createMeteredSaaSAsyncOperation({
      userId: 1,
      scope: fixture.scopeA,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
      quantity: "1",
      kind: "export",
      operationType: "test.metered-cancelled",
      payload: {},
      idempotencyKey: "metered-cancelled",
    });
    await cancelSaaSAsyncOperation({
      id: cancelled!.id,
      userId: 1,
      scope: fixture.scopeA,
      reason: "not needed",
    });

    const invalidScope = await createMeteredSaaSAsyncOperation({
      userId: 1,
      scope: fixture.scopeA,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
      quantity: "1",
      kind: "job",
      operationType: "test.metered-invalid-scope",
      payload: {},
      idempotencyKey: "metered-invalid-scope",
    });
    await sqlite
      .prepare(
        "UPDATE saas_tenant_member SET status = 'suspended' WHERE tenant_id = ? AND user_id = 1",
      )
      .run(fixture.tenantA.id);
    await expect(
      claimNextSaaSAsyncOperation({ workerId: "metered-invalid-worker", kinds: ["job"] }),
    ).rejects.toMatchObject({ status: 404 });

    const rows = (await sqlite
      .prepare(
        `SELECT operation.id, reservation.status
         FROM saas_async_operation operation
         INNER JOIN saas_usage_reservation reservation
           ON reservation.id = operation.usage_reservation_id
         WHERE operation.id IN (?, ?, ?, ?) ORDER BY operation.id`,
      )
      .all(completed!.id, failed!.id, cancelled!.id, invalidScope!.id)) as Array<{
      id: number;
      status: string;
    }>;
    expect(rows.map((row) => row.status)).toEqual(["settled", "released", "released", "released"]);
  });

  it("allows governed overage with high-risk audit and append-only ledger evidence", async () => {
    const fixture = await setupUsageFoundation({
      limitQuantity: "1",
      concurrencyLimit: 2,
      overagePolicy: "allow_with_audit",
    });
    const reservation = await reserveSaaSUsage({
      userId: 1,
      scope: fixture.scopeA,
      moduleId: fixture.moduleId,
      metric: "task_count",
      period: "monthly",
      quantity: "2",
      idempotencyKey: "governed-overage",
    });
    expect(reservation.reservation.overage).toBe(true);
    const settled = await settleSaaSUsageReservation({
      userId: 1,
      scope: fixture.scopeA,
      reservationId: reservation.reservation.id,
      quantity: "3",
    });
    expect(settled.reservation).toMatchObject({ status: "settled", overage: true });
    expect(
      await sqlite
        .prepare(
          `SELECT entry_type AS "entryType", quantity::text, overage
           FROM saas_usage_ledger WHERE reservation_id = ?`,
        )
        .get(reservation.reservation.id),
    ).toMatchObject({ entryType: "settlement", quantity: "3.000000", overage: true });
    expect(
      await sqlite
        .prepare(
          `SELECT risk_level AS "riskLevel", details_json AS "detailsJson"
           FROM sys_operation_log
           WHERE module = 'saas.usage' AND action = 'settleOverage'
           ORDER BY id DESC LIMIT 1`,
        )
        .get(),
    ).toMatchObject({ riskLevel: "high" });
  });

  it("exposes governed Plan, Subscription, policy, summary, ledger, and adjustment APIs", async () => {
    const token = await login();
    const tenant = await createTenant(token, "usage-api");
    const moduleRecord = (await sqlite
      .prepare("UPDATE saas_module SET status = 'active' WHERE code = 'novel' RETURNING id")
      .get()) as { id: number };
    const moduleId = Number(moduleRecord.id);
    await createTenantEntitlement({
      userId: 1,
      tenantId: tenant.id,
      moduleId,
      status: "active",
      source: "plan",
    });

    const createPlanResponse = await app.request("/api/saas/plans", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        code: "api-plan",
        name: "API Plan",
        status: "active",
        limits: [
          {
            moduleId,
            metric: "task_count",
            period: "monthly",
            limitQuantity: "5",
            concurrencyLimit: 2,
            overagePolicy: "reject",
          },
        ],
      }),
    });
    expect(createPlanResponse.status).toBe(200);
    const planId = Number((await readJson<{ id: number }>(createPlanResponse)).data?.id);
    expect(
      (
        await app.request(`/api/saas/plans/${planId}`, {
          method: "PUT",
          headers: jsonHeaders(token),
          body: JSON.stringify({ name: "API Plan V2" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/saas/subscriptions/${tenant.id}`, {
          method: "PUT",
          headers: jsonHeaders(token),
          body: JSON.stringify({ planId, status: "active" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/api/saas/usage/policies", {
          method: "PUT",
          headers: jsonHeaders(token),
          body: JSON.stringify({
            tenantId: tenant.id,
            workspaceId: tenant.defaultWorkspaceId,
            moduleId,
            metric: "task_count",
            period: "monthly",
            limitQuantity: "4",
            concurrencyLimit: 1,
            overagePolicy: "reject",
            reason: "API contract",
          }),
        })
      ).status,
    ).toBe(200);
    const scopedHeaders = jsonHeaders(token, tenant.id, tenant.defaultWorkspaceId);
    const summary = await app.request(
      `/api/saas/usage/summary?moduleId=${moduleId}&metric=task_count&period=monthly`,
      { headers: scopedHeaders },
    );
    expect(summary.status).toBe(200);
    expect((await readJson<{ policy: { source: string } }>(summary)).data?.policy.source).toBe(
      "workspace_override",
    );
    const adjustmentPayload = {
      moduleId,
      metric: "task_count",
      period: "monthly",
      quantity: "-1",
      description: "manual correction",
      idempotencyKey: "manual-correction-1",
    };
    const adjustment = await app.request("/api/saas/usage/adjustments", {
      method: "POST",
      headers: scopedHeaders,
      body: JSON.stringify(adjustmentPayload),
    });
    expect(adjustment.status).toBe(200);
    expect(
      (
        await app.request("/api/saas/usage/adjustments", {
          method: "POST",
          headers: scopedHeaders,
          body: JSON.stringify(adjustmentPayload),
        })
      ).status,
    ).toBe(200);
    const ledger = await app.request(
      `/api/saas/usage/ledger?page=1&pageSize=20&moduleId=${moduleId}&metric=task_count`,
      { headers: scopedHeaders },
    );
    expect(ledger.status).toBe(200);
    expect(
      (await readJson<{ data: Array<{ entryType: string }> }>(ledger)).data?.data,
    ).toContainEqual(expect.objectContaining({ entryType: "adjustment" }));
    expect(
      await sqlite
        .prepare(
          `SELECT COUNT(*)::int AS total FROM saas_usage_ledger
           WHERE tenant_id = ? AND idempotency_key = ?`,
        )
        .get(tenant.id, adjustmentPayload.idempotencyKey),
    ).toMatchObject({ total: 1 });
    expect((await app.request("/api/saas/plans")).status).toBe(401);

    const otherTenant = await createTenant(token, "usage-api-other");
    const crossScope = await app.request(
      `/api/saas/usage/summary?moduleId=${moduleId}&metric=task_count&period=monthly`,
      { headers: jsonHeaders(token, tenant.id, otherTenant.defaultWorkspaceId) },
    );
    expect(crossScope.status).toBe(404);
  });
});
