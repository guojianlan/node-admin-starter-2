import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { sqlite, type DbClient } from "@/server/db";
import { getAdminBaseEnv } from "@/server/env";
import { assertTenantAccess } from "./saas-control-plane-service";

export type SaaSApiKeyConstraints = {
  workspaceIds?: number[];
  moduleCodes?: string[];
};

const scopePattern = /^[a-z][a-z0-9-]*(?:[.:][a-zA-Z][a-zA-Z0-9-]*)+$/;
const forbiddenScopePattern =
  /(^|[.:])(system|permission|secret|apiKey|memberAdmin|billing|payment|refund|forceDelete|physicalDelete)([.:]|$)/i;

function hashApiKey(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeScopes(values: string[]) {
  const scopes = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (!scopes.length || scopes.length > 100) {
    throw new HTTPException(400, { message: "API Key 必须配置 1 到 100 个明确 Scope" });
  }
  for (const scope of scopes) {
    if (scope.length > 120 || !scopePattern.test(scope) || forbiddenScopePattern.test(scope)) {
      throw new HTTPException(400, { message: `API Key Scope 不允许或格式错误：${scope}` });
    }
  }
  return scopes;
}

function normalizeConstraints(input: SaaSApiKeyConstraints = {}) {
  const workspaceIds = [...new Set(input.workspaceIds ?? [])].sort((a, b) => a - b);
  const moduleCodes = [...new Set(input.moduleCodes?.map((value) => value.trim()).filter(Boolean) ?? [])].sort();
  if (workspaceIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new HTTPException(400, { message: "API Key workspaceIds 必须是正整数" });
  }
  if (moduleCodes.some((code) => !/^[a-z][a-z0-9-]{1,49}$/.test(code))) {
    throw new HTTPException(400, { message: "API Key moduleCodes 格式不正确" });
  }
  return {
    ...(workspaceIds.length ? { workspaceIds } : {}),
    ...(moduleCodes.length ? { moduleCodes } : {}),
  };
}

async function assertWorkspaceConstraints(tenantId: number, workspaceId: number | null, constraints: SaaSApiKeyConstraints) {
  const ids = [...new Set([...(constraints.workspaceIds ?? []), ...(workspaceId ? [workspaceId] : [])])];
  if (!ids.length) return;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = (await sqlite
    .prepare(
      `SELECT id FROM saas_workspace
       WHERE tenant_id = ? AND id IN (${placeholders}) AND status = 'active' AND deleted_at IS NULL`,
    )
    .all(tenantId, ...ids)) as Array<{ id: number }>;
  if (rows.length !== ids.length) {
    throw new HTTPException(404, { message: "API Key 资源约束包含不可用的 Workspace" });
  }
  if (workspaceId && constraints.workspaceIds?.length && !constraints.workspaceIds.includes(workspaceId)) {
    throw new HTTPException(400, { message: "绑定 Workspace 必须包含在资源约束中" });
  }
}

function newApiKeyMaterial() {
  const secret = crypto.randomBytes(32).toString("base64url");
  const key = `sabk_${secret}`;
  return { key, prefix: key.slice(0, 13), keyHash: hashApiKey(key) };
}

async function insertApiKey(
  input: {
    userId: number;
    tenantId: number;
    workspaceId: number | null;
    name: string;
    scopes: string[];
    resourceConstraints: SaaSApiKeyConstraints;
    expiresAt: string | null;
    rotatedFromId?: number | null;
  },
  dbClient: DbClient,
) {
  const material = newApiKeyMaterial();
  const result = await dbClient
    .prepare(
      `INSERT INTO saas_api_key
        (tenant_id, workspace_id, name, prefix, key_hash, scopes_json,
         resource_constraints_json, status, expires_at, rotated_from_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      input.tenantId,
      input.workspaceId,
      input.name.trim(),
      material.prefix,
      material.keyHash,
      JSON.stringify(input.scopes),
      JSON.stringify(input.resourceConstraints),
      input.expiresAt,
      input.rotatedFromId ?? null,
      input.userId,
      input.userId,
    );
  return { id: Number(result.lastInsertRowid), key: material.key, prefix: material.prefix };
}

export async function createSaaSApiKey(input: {
  userId: number;
  tenantId: number;
  workspaceId?: number | null;
  name: string;
  scopes: string[];
  resourceConstraints?: SaaSApiKeyConstraints;
  expiresAt?: string | null;
}) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId, roles: ["owner", "admin"] });
  const scopes = normalizeScopes(input.scopes);
  const constraints = normalizeConstraints(input.resourceConstraints);
  await assertWorkspaceConstraints(input.tenantId, input.workspaceId ?? null, constraints);
  if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
    throw new HTTPException(400, { message: "API Key 过期时间必须晚于当前时间" });
  }
  return insertApiKey(
    {
      userId: input.userId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId ?? null,
      name: input.name,
      scopes,
      resourceConstraints: constraints,
      expiresAt: input.expiresAt ?? null,
    },
    sqlite,
  );
}

export async function listSaaSApiKeys(input: {
  userId: number;
  tenantId: number;
  page: number;
  pageSize: number;
  status?: "active" | "revoked";
}) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId, roles: ["owner", "admin"] });
  const where = ["tenant_id = ?", "deleted_at IS NULL"];
  const params: Array<number | string> = [input.tenantId];
  if (input.status) {
    where.push("status = ?");
    params.push(input.status);
  }
  const whereSql = where.join(" AND ");
  const total = (await sqlite
    .prepare(`SELECT COUNT(*)::int AS total FROM saas_api_key WHERE ${whereSql}`)
    .get(...params)) as { total: number };
  const rows = (await sqlite
    .prepare(
      `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId", name, prefix,
        scopes_json AS "scopesJson", resource_constraints_json AS "resourceConstraintsJson",
        status, expires_at AS "expiresAt", last_used_at AS "lastUsedAt",
        revoked_at AS "revokedAt", rotated_from_id AS "rotatedFromId", created_at AS "createdAt"
       FROM saas_api_key WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, (input.page - 1) * input.pageSize)) as Array<Record<string, unknown> & { scopesJson: string; resourceConstraintsJson: string }>;
  return {
    data: rows.map(({ scopesJson, resourceConstraintsJson, ...row }) => ({
      ...row,
      scopes: JSON.parse(scopesJson),
      resourceConstraints: JSON.parse(resourceConstraintsJson),
    })),
    total: Number(total.total),
    page: input.page,
    pageSize: input.pageSize,
  };
}

async function getManagedKey(input: { userId: number; tenantId: number; id: number }, lock = false, dbClient: DbClient = sqlite) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId, roles: ["owner", "admin"] });
  const row = await dbClient
    .prepare(
      `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId", name,
        scopes_json AS "scopesJson", resource_constraints_json AS "resourceConstraintsJson",
        status, expires_at AS "expiresAt"
       FROM saas_api_key WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL${lock ? " FOR UPDATE" : ""}`,
    )
    .get(input.id, input.tenantId);
  if (!row) throw new HTTPException(404, { message: "API Key 不存在" });
  return row as {
    id: number;
    tenantId: number;
    workspaceId: number | null;
    name: string;
    scopesJson: string;
    resourceConstraintsJson: string;
    status: "active" | "revoked";
    expiresAt: string | null;
  };
}

export async function revokeSaaSApiKey(input: { userId: number; tenantId: number; id: number }) {
  const key = await getManagedKey(input);
  if (key.status === "revoked") return { id: key.id, replayed: true };
  const updated = await sqlite
    .prepare(
      `UPDATE saas_api_key SET status = 'revoked', revoked_at = now(), revoked_by = ?,
        updated_by = ?, updated_at = now()
       WHERE id = ? AND tenant_id = ? AND status = 'active' RETURNING id`,
    )
    .get(input.userId, input.userId, input.id, input.tenantId);
  if (!updated) throw new HTTPException(409, { message: "API Key 状态已经变化" });
  return { id: input.id, replayed: false };
}

export async function rotateSaaSApiKey(input: { userId: number; tenantId: number; id: number }) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId, roles: ["owner", "admin"] });
  return sqlite.transaction(async (tx) => {
    const key = await getManagedKey(input, true, tx);
    if (key.status !== "active") throw new HTTPException(409, { message: "只有 active API Key 可以轮换" });
    await tx
      .prepare(
        `UPDATE saas_api_key SET status = 'revoked', revoked_at = now(), revoked_by = ?,
          updated_by = ?, updated_at = now() WHERE id = ? AND status = 'active'`,
      )
      .run(input.userId, input.userId, key.id);
    return insertApiKey(
      {
        userId: input.userId,
        tenantId: key.tenantId,
        workspaceId: key.workspaceId,
        name: key.name,
        scopes: JSON.parse(key.scopesJson),
        resourceConstraints: JSON.parse(key.resourceConstraintsJson),
        expiresAt: key.expiresAt,
        rotatedFromId: key.id,
      },
      tx,
    );
  });
}

export async function authenticateSaaSApiKey(input: {
  key: string;
  requiredScope: string;
  workspaceId?: number | null;
  moduleCode?: string | null;
}) {
  const row = (await sqlite
    .prepare(
      `SELECT api_key.id, api_key.tenant_id AS "tenantId", api_key.workspace_id AS "workspaceId",
        api_key.scopes_json AS "scopesJson",
        api_key.resource_constraints_json AS "resourceConstraintsJson"
       FROM saas_api_key api_key
       INNER JOIN saas_tenant tenant ON tenant.id = api_key.tenant_id
       LEFT JOIN saas_workspace workspace ON workspace.id = api_key.workspace_id
       WHERE api_key.key_hash = ? AND api_key.status = 'active' AND api_key.deleted_at IS NULL
         AND (api_key.expires_at IS NULL OR api_key.expires_at > now())
         AND tenant.status = 'active' AND tenant.deleted_at IS NULL
         AND (api_key.workspace_id IS NULL OR
              (workspace.status = 'active' AND workspace.deleted_at IS NULL))
       LIMIT 1`,
    )
    .get(hashApiKey(input.key))) as
    | { id: number; tenantId: number; workspaceId: number | null; scopesJson: string; resourceConstraintsJson: string }
    | undefined;
  if (!row) throw new HTTPException(401, { message: "API Key 无效或已失效" });
  const scopes = JSON.parse(row.scopesJson) as string[];
  if (!scopes.includes(input.requiredScope)) {
    throw new HTTPException(403, { message: "API Key Scope 不允许该操作" });
  }
  if (row.workspaceId && input.workspaceId && row.workspaceId !== input.workspaceId) {
    throw new HTTPException(403, { message: "API Key 不允许访问该 Workspace" });
  }
  const constraints = JSON.parse(row.resourceConstraintsJson) as SaaSApiKeyConstraints;
  if (input.workspaceId && constraints.workspaceIds?.length && !constraints.workspaceIds.includes(input.workspaceId)) {
    throw new HTTPException(403, { message: "API Key 资源范围不允许该 Workspace" });
  }
  if (input.moduleCode && constraints.moduleCodes?.length && !constraints.moduleCodes.includes(input.moduleCode)) {
    throw new HTTPException(403, { message: "API Key 资源范围不允许该 Module" });
  }
  await sqlite.prepare("UPDATE saas_api_key SET last_used_at = now() WHERE id = ?").run(row.id);
  return { id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId, scopes, resourceConstraints: constraints };
}

export async function recordSaaSApiKeyRequest(input: {
  apiKeyId: number;
  tenantId: number;
  workspaceId?: number | null;
  requiredScope: string;
  method: string;
  path: string;
  requestId?: string | null;
  status: number;
  success: boolean;
  ip?: string | null;
}) {
  const ipHash = input.ip
    ? crypto.createHmac("sha256", getAdminBaseEnv().adminBaseSecretKey).update(input.ip).digest("hex")
    : null;
  const path = input.path.split(/[?#]/, 1)[0]?.slice(0, 500) || "/";
  await sqlite
    .prepare(
      `INSERT INTO saas_api_key_request_log
        (api_key_id, tenant_id, workspace_id, required_scope, method, path,
         request_id, status, success, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.apiKeyId,
      input.tenantId,
      input.workspaceId ?? null,
      input.requiredScope,
      input.method.toUpperCase(),
      path,
      input.requestId ?? null,
      input.status,
      input.success,
      ipHash,
    );
}
