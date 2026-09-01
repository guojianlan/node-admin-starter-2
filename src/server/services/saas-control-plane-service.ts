import { HTTPException } from "hono/http-exception";
import { sqlite } from "@/server/db";

export type TenantRole = "owner" | "admin" | "member" | "viewer";
export type WorkspaceRole = "owner" | "editor" | "reviewer" | "viewer";

type TenantRecord = {
  id: number;
  name: string;
  code: string;
  region: string;
  status: "active" | "suspended" | "archived";
  retentionDays: number;
  isSystem: boolean;
  memberRole?: TenantRole | null;
  createdAt: string;
  updatedAt: string;
};

type WorkspaceRecord = {
  id: number;
  tenantId: number;
  tenantName: string;
  name: string;
  code: string;
  description: string | null;
  status: "active" | "archived";
  isSystem: boolean;
  memberRole?: WorkspaceRole | null;
  createdAt: string;
  updatedAt: string;
};

type ListInput = {
  userId: number;
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
};

function pageOffset(page: number, pageSize: number) {
  return (page - 1) * pageSize;
}

function likeKeyword(keyword?: string) {
  return `%${String(keyword ?? "").trim()}%`;
}

export async function assertTenantAccess(input: {
  userId: number;
  tenantId: number;
  roles?: TenantRole[];
}) {
  const tenant = (await sqlite
    .prepare(
      `SELECT id, name, code, status, is_system AS "isSystem"
       FROM saas_tenant
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(input.tenantId)) as
    | { id: number; name: string; code: string; status: string; isSystem: boolean }
    | undefined;
  if (!tenant) throw new HTTPException(404, { message: "Tenant 不存在" });
  if (input.userId === 1) return { tenant, role: "owner" as TenantRole };

  const membership = (await sqlite
    .prepare(
      `SELECT role
       FROM saas_tenant_member
       WHERE tenant_id = ? AND user_id = ? AND status = 'active'
       LIMIT 1`,
    )
    .get(input.tenantId, input.userId)) as { role: TenantRole } | undefined;
  if (!membership) throw new HTTPException(404, { message: "Tenant 不存在" });
  if (input.roles?.length && !input.roles.includes(membership.role)) {
    throw new HTTPException(403, { message: "没有管理该 Tenant 的成员权限" });
  }
  return { tenant, role: membership.role };
}

export async function assertWorkspaceAccess(input: {
  userId: number;
  workspaceId: number;
  roles?: WorkspaceRole[];
}) {
  const workspace = (await sqlite
    .prepare(
      `SELECT workspace.id, workspace.tenant_id AS "tenantId", workspace.name,
        workspace.code, workspace.status, workspace.is_system AS "isSystem",
        member.role AS "memberRole",
        tenant_member.role AS "tenantRole"
       FROM saas_workspace workspace
       LEFT JOIN saas_workspace_member member
         ON member.workspace_id = workspace.id AND member.user_id = ? AND member.status = 'active'
       LEFT JOIN saas_tenant_member tenant_member
         ON tenant_member.tenant_id = workspace.tenant_id AND tenant_member.user_id = ?
        AND tenant_member.status = 'active'
       WHERE workspace.id = ? AND workspace.deleted_at IS NULL
       LIMIT 1`,
    )
    .get(input.userId, input.userId, input.workspaceId)) as
    | {
        id: number;
        tenantId: number;
        name: string;
        code: string;
        status: string;
        isSystem: boolean;
        memberRole: WorkspaceRole | null;
        tenantRole: TenantRole | null;
      }
    | undefined;
  if (!workspace) throw new HTTPException(404, { message: "Workspace 不存在" });
  if (input.userId === 1) return workspace;
  const tenantCanManage = workspace.tenantRole === "owner" || workspace.tenantRole === "admin";
  if (!workspace.memberRole && !tenantCanManage) {
    throw new HTTPException(404, { message: "Workspace 不存在" });
  }
  if (input.roles?.length && !tenantCanManage && !input.roles.includes(workspace.memberRole as WorkspaceRole)) {
    throw new HTTPException(403, { message: "没有管理该 Workspace 的成员权限" });
  }
  return workspace;
}

export async function getSaasContext(userId: number) {
  const tenants = (await sqlite
    .prepare(
      `SELECT tenant.id, tenant.name, tenant.code, tenant.status, member.role
       FROM saas_tenant_member member
       INNER JOIN saas_tenant tenant ON tenant.id = member.tenant_id
       WHERE member.user_id = ? AND member.status = 'active' AND tenant.deleted_at IS NULL
       ORDER BY tenant.is_system DESC, tenant.id ASC`,
    )
    .all(userId)) as Array<{
    id: number;
    name: string;
    code: string;
    status: string;
    role: TenantRole;
  }>;
  const workspaces = (await sqlite
    .prepare(
      `SELECT workspace.id, workspace.tenant_id AS "tenantId", workspace.name,
        workspace.code, workspace.status, member.role
       FROM saas_workspace_member member
       INNER JOIN saas_workspace workspace ON workspace.id = member.workspace_id
       WHERE member.user_id = ? AND member.status = 'active' AND workspace.deleted_at IS NULL
       ORDER BY workspace.is_system DESC, workspace.id ASC`,
    )
    .all(userId)) as Array<{
    id: number;
    tenantId: number;
    name: string;
    code: string;
    status: string;
    role: WorkspaceRole;
  }>;
  return {
    tenants,
    workspaces,
    defaultTenantId: tenants.find((item) => item.status === "active")?.id ?? null,
    defaultWorkspaceId: workspaces.find((item) => item.status === "active")?.id ?? null,
  };
}

export async function listTenants(input: ListInput) {
  const params: Array<string | number> = [];
  const where = ["tenant.deleted_at IS NULL"];
  let join = "";
  if (input.userId !== 1) {
    join = `INNER JOIN saas_tenant_member member
      ON member.tenant_id = tenant.id AND member.user_id = ? AND member.status = 'active'`;
    params.push(input.userId);
  } else {
    join = `LEFT JOIN saas_tenant_member member
      ON member.tenant_id = tenant.id AND member.user_id = ? AND member.status = 'active'`;
    params.push(input.userId);
  }
  if (input.keyword?.trim()) {
    where.push("(tenant.name ILIKE ? OR tenant.code ILIKE ?)");
    params.push(likeKeyword(input.keyword), likeKeyword(input.keyword));
  }
  if (input.status) {
    where.push("tenant.status = ?");
    params.push(input.status);
  }
  const whereSql = where.join(" AND ");
  const count = (await sqlite
    .prepare(`SELECT COUNT(*)::int AS total FROM saas_tenant tenant ${join} WHERE ${whereSql}`)
    .get(...params)) as { total: number };
  const rows = (await sqlite
    .prepare(
      `SELECT tenant.id, tenant.name, tenant.code, tenant.region, tenant.status,
        tenant.retention_days AS "retentionDays", tenant.is_system AS "isSystem",
        member.role AS "memberRole", tenant.created_at AS "createdAt",
        tenant.updated_at AS "updatedAt"
       FROM saas_tenant tenant ${join}
       WHERE ${whereSql}
       ORDER BY tenant.is_system DESC, tenant.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, pageOffset(input.page, input.pageSize))) as TenantRecord[];
  return { data: rows, page: input.page, pageSize: input.pageSize, total: Number(count.total) };
}

export async function createTenant(input: {
  userId: number;
  name: string;
  code: string;
  region: string;
  retentionDays: number;
}) {
  return sqlite.transaction(async (tx) => {
    const created = await tx
      .prepare(
        `INSERT INTO saas_tenant
          (name, code, region, retention_days, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .run(input.name, input.code, input.region, input.retentionDays, input.userId, input.userId);
    const tenantId = Number(created.lastInsertRowid);
    await tx
      .prepare(
        `INSERT INTO saas_tenant_member (tenant_id, user_id, role, status, created_by)
         VALUES (?, ?, 'owner', 'active', ?)`,
      )
      .run(tenantId, input.userId, input.userId);
    const workspace = await tx
      .prepare(
        `INSERT INTO saas_workspace
          (tenant_id, name, code, description, status, created_by, updated_by)
         VALUES (?, '默认工作区', 'default', 'Tenant 创建时自动建立', 'active', ?, ?)
         RETURNING id`,
      )
      .run(tenantId, input.userId, input.userId);
    const workspaceId = Number(workspace.lastInsertRowid);
    await tx
      .prepare(
        `INSERT INTO saas_workspace_member (workspace_id, user_id, role, status, created_by)
         VALUES (?, ?, 'owner', 'active', ?)`,
      )
      .run(workspaceId, input.userId, input.userId);
    return { id: tenantId, defaultWorkspaceId: workspaceId };
  });
}

export async function updateTenant(input: {
  userId: number;
  id: number;
  name?: string;
  region?: string;
  status?: "active" | "suspended" | "archived";
  retentionDays?: number;
}) {
  const access = await assertTenantAccess({
    userId: input.userId,
    tenantId: input.id,
    roles: ["owner", "admin"],
  });
  if (access.tenant.isSystem && input.status && input.status !== "active") {
    throw new HTTPException(409, { message: "系统默认 Tenant 不能停用或归档" });
  }
  await sqlite
    .prepare(
      `UPDATE saas_tenant SET
        name = COALESCE(?, name), region = COALESCE(?, region),
        status = COALESCE(?, status), retention_days = COALESCE(?, retention_days),
        updated_by = ?, updated_at = now()
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      input.name ?? null,
      input.region ?? null,
      input.status ?? null,
      input.retentionDays ?? null,
      input.userId,
      input.id,
    );
  return { id: input.id };
}

export async function listWorkspaces(input: ListInput & { tenantId?: number }) {
  const params: Array<string | number> = [];
  const where = ["workspace.deleted_at IS NULL", "tenant.deleted_at IS NULL"];
  let memberSelect = "NULL::text AS \"memberRole\"";
  let memberJoin = "";
  if (input.userId !== 1) {
    memberSelect = "workspace_member.role AS \"memberRole\"";
    memberJoin = `INNER JOIN saas_tenant_member tenant_member
      ON tenant_member.tenant_id = workspace.tenant_id AND tenant_member.user_id = ?
     AND tenant_member.status = 'active'
     LEFT JOIN saas_workspace_member workspace_member
      ON workspace_member.workspace_id = workspace.id AND workspace_member.user_id = ?
     AND workspace_member.status = 'active'`;
    params.push(input.userId, input.userId);
    where.push("(workspace_member.user_id IS NOT NULL OR tenant_member.role IN ('owner', 'admin'))");
  }
  if (input.tenantId) {
    where.push("workspace.tenant_id = ?");
    params.push(input.tenantId);
  }
  if (input.keyword?.trim()) {
    where.push("(workspace.name ILIKE ? OR workspace.code ILIKE ?)");
    params.push(likeKeyword(input.keyword), likeKeyword(input.keyword));
  }
  if (input.status) {
    where.push("workspace.status = ?");
    params.push(input.status);
  }
  const whereSql = where.join(" AND ");
  const fromSql = `FROM saas_workspace workspace
    INNER JOIN saas_tenant tenant ON tenant.id = workspace.tenant_id
    ${memberJoin}`;
  const count = (await sqlite
    .prepare(`SELECT COUNT(*)::int AS total ${fromSql} WHERE ${whereSql}`)
    .get(...params)) as { total: number };
  const rows = (await sqlite
    .prepare(
      `SELECT workspace.id, workspace.tenant_id AS "tenantId", tenant.name AS "tenantName",
        workspace.name, workspace.code, workspace.description, workspace.status,
        workspace.is_system AS "isSystem", ${memberSelect},
        workspace.created_at AS "createdAt", workspace.updated_at AS "updatedAt"
       ${fromSql} WHERE ${whereSql}
       ORDER BY workspace.is_system DESC, workspace.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, pageOffset(input.page, input.pageSize))) as WorkspaceRecord[];
  return { data: rows, page: input.page, pageSize: input.pageSize, total: Number(count.total) };
}

export async function createWorkspace(input: {
  userId: number;
  tenantId: number;
  name: string;
  code: string;
  description?: string | null;
}) {
  await assertTenantAccess({
    userId: input.userId,
    tenantId: input.tenantId,
    roles: ["owner", "admin"],
  });
  return sqlite.transaction(async (tx) => {
    const created = await tx
      .prepare(
        `INSERT INTO saas_workspace
          (tenant_id, name, code, description, status, created_by, updated_by)
         VALUES (?, ?, ?, ?, 'active', ?, ?) RETURNING id`,
      )
      .run(
        input.tenantId,
        input.name,
        input.code,
        input.description ?? null,
        input.userId,
        input.userId,
      );
    const id = Number(created.lastInsertRowid);
    await tx
      .prepare(
        `INSERT INTO saas_workspace_member (workspace_id, user_id, role, status, created_by)
         VALUES (?, ?, 'owner', 'active', ?)`,
      )
      .run(id, input.userId, input.userId);
    return { id };
  });
}

export async function updateWorkspace(input: {
  userId: number;
  id: number;
  name?: string;
  description?: string | null;
  status?: "active" | "archived";
}) {
  const workspace = await assertWorkspaceAccess({
    userId: input.userId,
    workspaceId: input.id,
    roles: ["owner", "editor"],
  });
  if (workspace.isSystem && input.status === "archived") {
    throw new HTTPException(409, { message: "系统默认 Workspace 不能归档" });
  }
  await sqlite
    .prepare(
      `UPDATE saas_workspace SET
        name = COALESCE(?, name), description = COALESCE(?, description),
        status = COALESCE(?, status), updated_by = ?, updated_at = now()
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      input.name ?? null,
      input.description ?? null,
      input.status ?? null,
      input.userId,
      input.id,
    );
  return { id: input.id };
}
