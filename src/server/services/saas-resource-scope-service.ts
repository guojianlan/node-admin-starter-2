import { HTTPException } from "hono/http-exception";
import { sqlite, type DbClient } from "@/server/db";
import type { TenantRole, WorkspaceRole } from "./saas-control-plane-service";

export type SaaSResourceScope = {
  tenantId: number;
  workspaceId: number;
  tenantCode: string;
  workspaceCode: string;
  tenantRole: TenantRole;
  workspaceRole: WorkspaceRole | null;
};

export type SaaSResourceIdentity = {
  tenantId: number;
  workspaceId: number;
};

type ScopeRow = SaaSResourceScope & {
  tenantStatus: string;
  workspaceStatus: string;
};

function positiveId(value: string | number | null | undefined) {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HTTPException(400, { message: "SaaS Tenant / Workspace Header 不合法" });
  }
  return parsed;
}

export function readSaaSContextSelection(headers: {
  tenantId?: string | null;
  workspaceId?: string | null;
}) {
  return {
    tenantId: positiveId(headers.tenantId),
    workspaceId: positiveId(headers.workspaceId),
  };
}

export async function resolveSaaSResourceScope(
  input: {
    userId: number;
    tenantId?: number | null;
    workspaceId?: number | null;
  },
  dbClient: DbClient = sqlite,
): Promise<SaaSResourceScope> {
  const saved = (await dbClient
    .prepare(
      `SELECT tenant_id AS "tenantId", workspace_id AS "workspaceId"
       FROM saas_user_context WHERE user_id = ? LIMIT 1`,
    )
    .get(input.userId)) as { tenantId: number; workspaceId: number } | undefined;
  const tenantId = positiveId(input.tenantId) ?? saved?.tenantId;
  const workspaceId = positiveId(input.workspaceId) ?? saved?.workspaceId;

  const row = (await dbClient
    .prepare(
      `SELECT tenant.id AS "tenantId", workspace.id AS "workspaceId",
        tenant.code AS "tenantCode", workspace.code AS "workspaceCode",
        tenant.status AS "tenantStatus", workspace.status AS "workspaceStatus",
        tenant_member.role AS "tenantRole", workspace_member.role AS "workspaceRole"
       FROM saas_tenant_member tenant_member
       INNER JOIN saas_tenant tenant
         ON tenant.id = tenant_member.tenant_id AND tenant.deleted_at IS NULL
       INNER JOIN saas_workspace workspace
         ON workspace.tenant_id = tenant.id AND workspace.deleted_at IS NULL
       LEFT JOIN saas_workspace_member workspace_member
         ON workspace_member.workspace_id = workspace.id
        AND workspace_member.user_id = tenant_member.user_id
        AND workspace_member.status = 'active'
       WHERE tenant_member.user_id = ?
         AND tenant_member.status = 'active'
         AND tenant.status = 'active'
         AND workspace.status = 'active'
         AND (?::int IS NULL OR tenant.id = ?)
         AND (?::int IS NULL OR workspace.id = ?)
         AND (workspace_member.user_id IS NOT NULL OR tenant_member.role IN ('owner', 'admin'))
       ORDER BY
         CASE WHEN tenant.id = ? THEN 0 ELSE 1 END,
         tenant.is_system DESC,
         CASE WHEN workspace.id = ? THEN 0 ELSE 1 END,
         workspace.is_system DESC,
         tenant.id ASC,
         workspace.id ASC
       LIMIT 1`,
    )
    .get(
      input.userId,
      tenantId ?? null,
      tenantId ?? null,
      workspaceId ?? null,
      workspaceId ?? null,
      tenantId ?? null,
      workspaceId ?? null,
    )) as ScopeRow | undefined;

  if (!row) {
    if (tenantId || workspaceId) {
      throw new HTTPException(404, { message: "SaaS 资源不存在或当前上下文不可访问" });
    }
    throw new HTTPException(409, { message: "当前账号没有可用的 Tenant / Workspace 资源上下文" });
  }
  return {
    tenantId: Number(row.tenantId),
    workspaceId: Number(row.workspaceId),
    tenantCode: row.tenantCode,
    workspaceCode: row.workspaceCode,
    tenantRole: row.tenantRole,
    workspaceRole: row.workspaceRole,
  };
}

export async function revalidateSaaSResourceScope(
  input: { userId: number; scope: SaaSResourceIdentity },
  dbClient: DbClient = sqlite,
) {
  return resolveSaaSResourceScope(
    {
      userId: input.userId,
      tenantId: input.scope.tenantId,
      workspaceId: input.scope.workspaceId,
    },
    dbClient,
  );
}

export function assertSaaSResourceScope(
  scope: SaaSResourceIdentity,
  resource: SaaSResourceIdentity | null | undefined,
): asserts resource is SaaSResourceIdentity {
  if (
    !resource ||
    Number(resource.tenantId) !== Number(scope.tenantId) ||
    Number(resource.workspaceId) !== Number(scope.workspaceId)
  ) {
    throw new HTTPException(404, { message: "SaaS 资源不存在或当前上下文不可访问" });
  }
}

function safeScopeCode(value: string, label: string) {
  if (!/^[a-z][a-z0-9-]{0,49}$/.test(value)) {
    throw new Error(`${label} code 不能用于对象存储路径`);
  }
  return value;
}

export function buildSaaSObjectPrefix(
  scope: Pick<SaaSResourceScope, "tenantCode" | "workspaceCode">,
) {
  return `tenants/${safeScopeCode(scope.tenantCode, "Tenant")}/workspaces/${safeScopeCode(scope.workspaceCode, "Workspace")}`;
}
