import { HTTPException } from "hono/http-exception";
import { sqlite } from "@/server/db";
import { assertTenantAccess } from "@/server/services/saas-control-plane-service";

type PageInput = {
  userId: number;
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
};

type ModuleStatus = "draft" | "active" | "disabled" | "retired";
type EntitlementStatus = "trial" | "active" | "suspended" | "expired";
type EntitlementSource = "manual" | "trial" | "plan";

function offset(page: number, pageSize: number) {
  return (page - 1) * pageSize;
}

function normalizeCodes(values: string[]) {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort();
}

function parseStringArray(value: unknown) {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function serializeStringArray(values: string[]) {
  return JSON.stringify(normalizeCodes(values));
}

function mapModuleRecord(record: Record<string, unknown>) {
  const dependencies = parseStringArray(record.dependenciesJson);
  const capabilities = parseStringArray(record.capabilitiesJson);
  return {
    ...record,
    dependencies,
    capabilities,
    dependenciesCsv: dependencies.join(", "),
    capabilitiesCsv: capabilities.join(", "),
  };
}

async function assertModuleActivationReady(input: {
  status: ModuleStatus;
  routeKey: string;
  routePath: string;
  requiredAbility: string;
}) {
  if (input.status !== "active") return;
  const route = (await sqlite
    .prepare(
      `SELECT id, path
       FROM sys_rule
       WHERE key = ? AND type IN ('route', 'nested') AND status = 1 AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(input.routeKey)) as { id: number; path: string | null } | undefined;
  const action = await sqlite
    .prepare(
      `SELECT id
       FROM sys_rule
       WHERE key = ? AND type = 'action' AND status = 1 AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(input.requiredAbility);
  if (!route || route.path !== input.routePath || !action) {
    throw new HTTPException(409, {
      message: "模块上架前必须存在匹配的 route、path 和 required ability",
    });
  }
}

async function assertDependenciesExist(codes: string[], currentModuleId?: number) {
  const normalized = normalizeCodes(codes);
  if (!normalized.length) return;
  const placeholders = normalized.map(() => "?").join(", ");
  const rows = (await sqlite
    .prepare(
      `SELECT id, code FROM saas_module
       WHERE code IN (${placeholders}) AND deleted_at IS NULL`,
    )
    .all(...normalized)) as Array<{ id: number; code: string }>;
  if (rows.length !== normalized.length) {
    throw new HTTPException(400, { message: "模块依赖包含不存在的 module code" });
  }
  if (currentModuleId && rows.some((row) => row.id === currentModuleId)) {
    throw new HTTPException(400, { message: "模块不能依赖自身" });
  }
}

async function assertModuleDependencyGraph(input: { code: string; dependencies: string[] }) {
  const rows = (await sqlite
    .prepare(
      `SELECT code, dependencies_json AS "dependenciesJson"
       FROM saas_module WHERE deleted_at IS NULL`,
    )
    .all()) as Array<{ code: string; dependenciesJson: string }>;
  const graph = new Map(rows.map((row) => [row.code, parseStringArray(row.dependenciesJson)]));
  graph.set(input.code, normalizeCodes(input.dependencies));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (code: string): boolean => {
    if (visiting.has(code)) return true;
    if (visited.has(code)) return false;
    visiting.add(code);
    for (const dependency of graph.get(code) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(code);
    visited.add(code);
    return false;
  };
  if (visit(input.code)) {
    throw new HTTPException(400, { message: "模块依赖不能形成循环" });
  }
}

async function assertActiveDependencies(status: ModuleStatus, dependencies: string[]) {
  if (status !== "active" || !dependencies.length) return;
  const normalized = normalizeCodes(dependencies);
  const placeholders = normalized.map(() => "?").join(", ");
  const active = (await sqlite
    .prepare(
      `SELECT code FROM saas_module
       WHERE code IN (${placeholders}) AND status = 'active' AND deleted_at IS NULL`,
    )
    .all(...normalized)) as Array<{ code: string }>;
  if (active.length !== normalized.length) {
    throw new HTTPException(409, { message: "模块上架前必须先上架全部依赖模块" });
  }
}

export async function listSaasModules(input: Omit<PageInput, "userId">) {
  const params: Array<string | number> = [];
  const where = ["deleted_at IS NULL"];
  if (input.keyword?.trim()) {
    where.push("(name ILIKE ? OR code ILIKE ? OR route_key ILIKE ?)");
    const keyword = `%${input.keyword.trim()}%`;
    params.push(keyword, keyword, keyword);
  }
  if (input.status) {
    where.push("status = ?");
    params.push(input.status);
  }
  const whereSql = where.join(" AND ");
  const count = (await sqlite
    .prepare(`SELECT COUNT(*)::int AS total FROM saas_module WHERE ${whereSql}`)
    .get(...params)) as { total: number };
  const rows = (await sqlite
    .prepare(
      `SELECT id, code, name, version, description, status,
        route_key AS "routeKey", route_path AS "routePath",
        required_ability AS "requiredAbility",
        dependencies_json AS "dependenciesJson", capabilities_json AS "capabilitiesJson",
        is_system AS "isSystem", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM saas_module
       WHERE ${whereSql}
       ORDER BY is_system DESC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, offset(input.page, input.pageSize))) as Array<
    Record<string, unknown>
  >;
  return {
    data: rows.map(mapModuleRecord),
    page: input.page,
    pageSize: input.pageSize,
    total: Number(count.total),
  };
}

export async function createSaasModule(input: {
  userId: number;
  code: string;
  name: string;
  version: string;
  description?: string | null;
  status: ModuleStatus;
  routeKey: string;
  routePath: string;
  requiredAbility: string;
  dependencies: string[];
  capabilities: string[];
}) {
  await assertDependenciesExist(input.dependencies);
  await assertModuleDependencyGraph({ code: input.code, dependencies: input.dependencies });
  await assertActiveDependencies(input.status, input.dependencies);
  await assertModuleActivationReady(input);
  const created = await sqlite
    .prepare(
      `INSERT INTO saas_module
        (code, name, version, description, status, route_key, route_path, required_ability,
         dependencies_json, capabilities_json, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .run(
      input.code,
      input.name,
      input.version,
      input.description ?? null,
      input.status,
      input.routeKey,
      input.routePath,
      input.requiredAbility,
      serializeStringArray(input.dependencies),
      serializeStringArray(input.capabilities),
      input.userId,
      input.userId,
    );
  return { id: Number(created.lastInsertRowid) };
}

export async function updateSaasModule(input: {
  userId: number;
  id: number;
  name?: string;
  version?: string;
  description?: string | null;
  status?: ModuleStatus;
  routeKey?: string;
  routePath?: string;
  requiredAbility?: string;
  dependencies?: string[];
  capabilities?: string[];
}) {
  const existing = (await sqlite
    .prepare(
      `SELECT id, code, status, route_key AS "routeKey", route_path AS "routePath",
        required_ability AS "requiredAbility", dependencies_json AS "dependenciesJson"
       FROM saas_module WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(input.id)) as
    | {
        id: number;
        code: string;
        status: ModuleStatus;
        routeKey: string;
        routePath: string;
        requiredAbility: string;
        dependenciesJson: string;
      }
    | undefined;
  if (!existing) throw new HTTPException(404, { message: "SaaS 模块不存在" });
  const dependencies = input.dependencies ?? parseStringArray(existing.dependenciesJson);
  await assertDependenciesExist(dependencies, input.id);
  await assertModuleDependencyGraph({ code: existing.code, dependencies });
  await assertActiveDependencies(input.status ?? existing.status, dependencies);
  await assertModuleActivationReady({
    status: input.status ?? existing.status,
    routeKey: input.routeKey ?? existing.routeKey,
    routePath: input.routePath ?? existing.routePath,
    requiredAbility: input.requiredAbility ?? existing.requiredAbility,
  });
  await sqlite
    .prepare(
      `UPDATE saas_module SET
        name = COALESCE(?, name), version = COALESCE(?, version),
        description = CASE WHEN ? THEN ? ELSE description END,
        status = COALESCE(?, status), route_key = COALESCE(?, route_key),
        route_path = COALESCE(?, route_path), required_ability = COALESCE(?, required_ability),
        dependencies_json = COALESCE(?, dependencies_json),
        capabilities_json = COALESCE(?, capabilities_json),
        updated_by = ?, updated_at = now()
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      input.name ?? null,
      input.version ?? null,
      input.description !== undefined,
      input.description ?? null,
      input.status ?? null,
      input.routeKey ?? null,
      input.routePath ?? null,
      input.requiredAbility ?? null,
      input.dependencies ? serializeStringArray(input.dependencies) : null,
      input.capabilities ? serializeStringArray(input.capabilities) : null,
      input.userId,
      input.id,
    );
  return { id: input.id };
}

async function expireEntitlements(tenantId?: number) {
  const suffix = tenantId ? " AND tenant_id = ?" : "";
  const params = tenantId ? [tenantId] : [];
  await sqlite
    .prepare(
      `UPDATE saas_tenant_entitlement
       SET status = 'expired', updated_at = now()
       WHERE status IN ('trial', 'active') AND expires_at IS NOT NULL AND expires_at <= now()
         AND deleted_at IS NULL${suffix}`,
    )
    .run(...params);
}

export async function listTenantEntitlements(
  input: PageInput & { tenantId?: number; moduleId?: number },
) {
  if (input.userId !== 1 && !input.tenantId) {
    throw new HTTPException(400, { message: "普通用户查询 Entitlement 必须指定 Tenant" });
  }
  if (input.tenantId) {
    await assertTenantAccess({
      userId: input.userId,
      tenantId: input.tenantId,
      roles: ["owner", "admin"],
    });
  }
  await expireEntitlements(input.tenantId);
  const params: Array<string | number> = [];
  const where = [
    "entitlement.deleted_at IS NULL",
    "tenant.deleted_at IS NULL",
    "module.deleted_at IS NULL",
  ];
  if (input.tenantId) {
    where.push("entitlement.tenant_id = ?");
    params.push(input.tenantId);
  }
  if (input.moduleId) {
    where.push("entitlement.module_id = ?");
    params.push(input.moduleId);
  }
  if (input.status) {
    where.push("entitlement.status = ?");
    params.push(input.status);
  }
  if (input.keyword?.trim()) {
    where.push("(tenant.name ILIKE ? OR module.name ILIKE ? OR module.code ILIKE ?)");
    const keyword = `%${input.keyword.trim()}%`;
    params.push(keyword, keyword, keyword);
  }
  const whereSql = where.join(" AND ");
  const fromSql = `FROM saas_tenant_entitlement entitlement
    INNER JOIN saas_tenant tenant ON tenant.id = entitlement.tenant_id
    INNER JOIN saas_module module ON module.id = entitlement.module_id`;
  const count = (await sqlite
    .prepare(`SELECT COUNT(*)::int AS total ${fromSql} WHERE ${whereSql}`)
    .get(...params)) as { total: number };
  const rows = await sqlite
    .prepare(
      `SELECT entitlement.id, entitlement.tenant_id AS "tenantId", tenant.name AS "tenantName",
        entitlement.module_id AS "moduleId", module.name AS "moduleName", module.code AS "moduleCode",
        entitlement.status, entitlement.source, entitlement.starts_at AS "startsAt",
        entitlement.expires_at AS "expiresAt",
        entitlement.member_limit_override AS "memberLimitOverride",
        entitlement.monthly_task_limit_override AS "monthlyTaskLimitOverride",
        entitlement.max_concurrent_task_override AS "maxConcurrentTaskOverride",
        entitlement.export_profile_override AS "exportProfileOverride",
        entitlement.notes, entitlement.created_at AS "createdAt",
        entitlement.updated_at AS "updatedAt"
       ${fromSql} WHERE ${whereSql}
       ORDER BY entitlement.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, offset(input.page, input.pageSize));
  return { data: rows, page: input.page, pageSize: input.pageSize, total: Number(count.total) };
}

async function assertEntitlementTarget(input: {
  userId: number;
  tenantId: number;
  moduleId: number;
}) {
  const access = await assertTenantAccess({
    userId: input.userId,
    tenantId: input.tenantId,
    roles: ["owner", "admin"],
  });
  if (access.tenant.status !== "active") {
    throw new HTTPException(409, { message: "只有启用中的 Tenant 可以开通模块" });
  }
  const moduleRecord = (await sqlite
    .prepare(
      `SELECT id, code, status FROM saas_module
       WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(input.moduleId)) as { id: number; code: string; status: ModuleStatus } | undefined;
  if (!moduleRecord) throw new HTTPException(404, { message: "SaaS 模块不存在" });
  if (moduleRecord.status !== "active") {
    throw new HTTPException(409, { message: "只有已上架模块可以授予 Entitlement" });
  }
  return moduleRecord;
}

function validateEntitlementDates(input: { startsAt?: string; expiresAt?: string | null }) {
  if (input.expiresAt) {
    const startsAt = input.startsAt ? new Date(input.startsAt).getTime() : Date.now();
    if (new Date(input.expiresAt).getTime() <= startsAt) {
      throw new HTTPException(400, { message: "Entitlement 过期时间必须晚于开始时间" });
    }
  }
}

type EntitlementValues = {
  status: EntitlementStatus;
  source: EntitlementSource;
  startsAt?: string;
  expiresAt?: string | null;
  memberLimitOverride?: number | null;
  monthlyTaskLimitOverride?: number | null;
  maxConcurrentTaskOverride?: number | null;
  exportProfileOverride?: string | null;
  notes?: string | null;
};

export async function createTenantEntitlement(
  input: EntitlementValues & { userId: number; tenantId: number; moduleId: number },
) {
  await assertEntitlementTarget(input);
  validateEntitlementDates(input);
  const created = await sqlite
    .prepare(
      `INSERT INTO saas_tenant_entitlement
        (tenant_id, module_id, status, source, starts_at, expires_at,
         member_limit_override, monthly_task_limit_override, max_concurrent_task_override,
         export_profile_override, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, COALESCE(?, now()), ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .run(
      input.tenantId,
      input.moduleId,
      input.status,
      input.source,
      input.startsAt ?? null,
      input.expiresAt ?? null,
      input.memberLimitOverride ?? null,
      input.monthlyTaskLimitOverride ?? null,
      input.maxConcurrentTaskOverride ?? null,
      input.exportProfileOverride ?? null,
      input.notes ?? null,
      input.userId,
      input.userId,
    );
  return { id: Number(created.lastInsertRowid) };
}

export async function updateTenantEntitlement(
  input: Partial<EntitlementValues> & { userId: number; id: number },
) {
  const existing = (await sqlite
    .prepare(
      `SELECT id, tenant_id AS "tenantId", module_id AS "moduleId",
        starts_at AS "startsAt", expires_at AS "expiresAt"
       FROM saas_tenant_entitlement
       WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(input.id)) as
    | { id: number; tenantId: number; moduleId: number; startsAt: string; expiresAt: string | null }
    | undefined;
  if (!existing) throw new HTTPException(404, { message: "Tenant Entitlement 不存在" });
  await assertEntitlementTarget({
    userId: input.userId,
    tenantId: existing.tenantId,
    moduleId: existing.moduleId,
  });
  validateEntitlementDates({
    startsAt: input.startsAt ?? existing.startsAt,
    expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
  });
  await sqlite
    .prepare(
      `UPDATE saas_tenant_entitlement SET
        status = COALESCE(?, status), source = COALESCE(?, source),
        starts_at = COALESCE(?, starts_at),
        expires_at = CASE WHEN ? THEN ? ELSE expires_at END,
        member_limit_override = CASE WHEN ? THEN ? ELSE member_limit_override END,
        monthly_task_limit_override = CASE WHEN ? THEN ? ELSE monthly_task_limit_override END,
        max_concurrent_task_override = CASE WHEN ? THEN ? ELSE max_concurrent_task_override END,
        export_profile_override = CASE WHEN ? THEN ? ELSE export_profile_override END,
        notes = CASE WHEN ? THEN ? ELSE notes END,
        updated_by = ?, updated_at = now()
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      input.status ?? null,
      input.source ?? null,
      input.startsAt ?? null,
      input.expiresAt !== undefined,
      input.expiresAt ?? null,
      input.memberLimitOverride !== undefined,
      input.memberLimitOverride ?? null,
      input.monthlyTaskLimitOverride !== undefined,
      input.monthlyTaskLimitOverride ?? null,
      input.maxConcurrentTaskOverride !== undefined,
      input.maxConcurrentTaskOverride ?? null,
      input.exportProfileOverride !== undefined,
      input.exportProfileOverride ?? null,
      input.notes !== undefined,
      input.notes ?? null,
      input.userId,
      input.id,
    );
  return { id: input.id };
}

export async function resolveEffectiveSaasModules(input: {
  userId: number;
  abilities: string[];
  tenantId: number;
}) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId });
  await expireEntitlements(input.tenantId);
  const tenant = (await sqlite
    .prepare(
      `SELECT status FROM saas_tenant
       WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(input.tenantId)) as { status: string } | undefined;
  if (!tenant || tenant.status !== "active") return [];
  const rows = (await sqlite
    .prepare(
      `SELECT module.id, module.code, module.name, module.version,
        module.route_key AS "routeKey", module.route_path AS "routePath",
        module.required_ability AS "requiredAbility",
        module.dependencies_json AS "dependenciesJson",
        module.capabilities_json AS "capabilitiesJson",
        entitlement.status AS "entitlementStatus", entitlement.source,
        entitlement.expires_at AS "expiresAt",
        entitlement.member_limit_override AS "memberLimitOverride",
        entitlement.monthly_task_limit_override AS "monthlyTaskLimitOverride",
        entitlement.max_concurrent_task_override AS "maxConcurrentTaskOverride",
        entitlement.export_profile_override AS "exportProfileOverride"
       FROM saas_tenant_entitlement entitlement
       INNER JOIN saas_module module ON module.id = entitlement.module_id
       WHERE entitlement.tenant_id = ? AND entitlement.deleted_at IS NULL
         AND entitlement.status IN ('trial', 'active')
         AND entitlement.starts_at <= now()
         AND (entitlement.expires_at IS NULL OR entitlement.expires_at > now())
         AND module.status = 'active' AND module.deleted_at IS NULL
       ORDER BY module.id ASC`,
    )
    .all(input.tenantId)) as Array<Record<string, unknown>>;
  const abilityFiltered = rows.filter(
    (row) => input.userId === 1 || input.abilities.includes(String(row.requiredAbility)),
  );
  const effectiveCodes = new Set(abilityFiltered.map((row) => String(row.code)));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of abilityFiltered) {
      const code = String(row.code);
      if (!effectiveCodes.has(code)) continue;
      const dependencies = parseStringArray(row.dependenciesJson);
      if (dependencies.some((dependency) => !effectiveCodes.has(dependency))) {
        effectiveCodes.delete(code);
        changed = true;
      }
    }
  }
  return abilityFiltered.filter((row) => effectiveCodes.has(String(row.code))).map(mapModuleRecord);
}
