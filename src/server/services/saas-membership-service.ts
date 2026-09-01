import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { sqlite } from "@/server/db";
import {
  assertTenantAccess,
  assertWorkspaceAccess,
  type TenantRole,
  type WorkspaceRole,
} from "@/server/services/saas-control-plane-service";

type TenantAssignableRole = Exclude<TenantRole, "owner">;
type WorkspaceAssignableRole = Exclude<WorkspaceRole, "owner">;

type PageInput = {
  userId: number;
  page: number;
  pageSize: number;
  keyword?: string;
  status?: string;
};

function offset(page: number, pageSize: number) {
  return (page - 1) * pageSize;
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function invitationTokenHash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function getTenantMembership(tenantId: number, userId: number) {
  return (await sqlite
    .prepare(
      `SELECT role, status
       FROM saas_tenant_member
       WHERE tenant_id = ? AND user_id = ?
       LIMIT 1`,
    )
    .get(tenantId, userId)) as { role: TenantRole; status: "active" | "suspended" } | undefined;
}

async function getWorkspaceMembership(workspaceId: number, userId: number) {
  return (await sqlite
    .prepare(
      `SELECT role, status
       FROM saas_workspace_member
       WHERE workspace_id = ? AND user_id = ?
       LIMIT 1`,
    )
    .get(workspaceId, userId)) as
    | { role: WorkspaceRole; status: "active" | "suspended" }
    | undefined;
}

async function assertActiveUser(userId: number) {
  const user = (await sqlite
    .prepare(
      `SELECT id, username, nickname, email
       FROM sys_user
       WHERE id = ? AND status = 1 AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(userId)) as
    | { id: number; username: string; nickname: string; email: string | null }
    | undefined;
  if (!user) throw new HTTPException(404, { message: "用户不存在或已停用" });
  return user;
}

function assertTenantMemberMutation(input: {
  actorRole: TenantRole;
  targetRole?: TenantRole;
  nextRole?: TenantAssignableRole;
}) {
  if (input.targetRole === "owner") {
    throw new HTTPException(409, { message: "Tenant owner 需要通过独立所有权转移流程变更" });
  }
  if (input.actorRole === "admin" && (input.targetRole === "admin" || input.nextRole === "admin")) {
    throw new HTTPException(403, { message: "Tenant admin 不能分配或变更 admin" });
  }
}

function assertWorkspaceMemberMutation(input: {
  tenantRole: TenantRole | null;
  workspaceRole: WorkspaceRole | null;
  targetRole?: WorkspaceRole;
  nextRole?: WorkspaceAssignableRole;
}) {
  if (input.targetRole === "owner") {
    throw new HTTPException(409, { message: "Workspace owner 需要通过独立所有权转移流程变更" });
  }
  const tenantCanManage = input.tenantRole === "owner" || input.tenantRole === "admin";
  if (!tenantCanManage && input.workspaceRole !== "owner") {
    throw new HTTPException(403, { message: "只有 Tenant 管理员或 Workspace owner 可以管理成员" });
  }
}

export async function listTenantMembers(input: PageInput & { tenantId: number }) {
  await assertTenantAccess({
    userId: input.userId,
    tenantId: input.tenantId,
    roles: ["owner", "admin"],
  });
  const params: Array<string | number> = [input.tenantId];
  const where = ["member.tenant_id = ?", "app_user.deleted_at IS NULL"];
  if (input.keyword?.trim()) {
    where.push(
      "(app_user.username ILIKE ? OR app_user.nickname ILIKE ? OR app_user.email ILIKE ?)",
    );
    const keyword = `%${input.keyword.trim()}%`;
    params.push(keyword, keyword, keyword);
  }
  if (input.status) {
    where.push("member.status = ?");
    params.push(input.status);
  }
  const whereSql = where.join(" AND ");
  const count = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total
       FROM saas_tenant_member member
       INNER JOIN sys_user app_user ON app_user.id = member.user_id
       WHERE ${whereSql}`,
    )
    .get(...params)) as { total: number };
  const rows = await sqlite
    .prepare(
      `SELECT member.tenant_id AS "tenantId", member.user_id AS "userId",
        app_user.username, app_user.nickname, app_user.email,
        member.role, member.status, member.joined_at AS "joinedAt"
       FROM saas_tenant_member member
       INNER JOIN sys_user app_user ON app_user.id = member.user_id
       WHERE ${whereSql}
       ORDER BY CASE member.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END,
         member.joined_at ASC, member.user_id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, offset(input.page, input.pageSize));
  return { data: rows, page: input.page, pageSize: input.pageSize, total: Number(count.total) };
}

export async function upsertTenantMember(input: {
  userId: number;
  tenantId: number;
  targetUserId: number;
  role: TenantAssignableRole;
  status: "active" | "suspended";
}) {
  const access = await assertTenantAccess({
    userId: input.userId,
    tenantId: input.tenantId,
    roles: ["owner", "admin"],
  });
  await assertActiveUser(input.targetUserId);
  const existing = await getTenantMembership(input.tenantId, input.targetUserId);
  assertTenantMemberMutation({
    actorRole: access.role,
    targetRole: existing?.role,
    nextRole: input.role,
  });
  await sqlite
    .prepare(
      `INSERT INTO saas_tenant_member
        (tenant_id, user_id, role, status, joined_at, created_by)
       VALUES (?, ?, ?, ?, now(), ?)
       ON CONFLICT (tenant_id, user_id)
       DO UPDATE SET role = excluded.role, status = excluded.status`,
    )
    .run(input.tenantId, input.targetUserId, input.role, input.status, input.userId);
  if (input.status === "suspended") {
    await sqlite
      .prepare(
        `UPDATE saas_workspace_member member
         SET status = 'suspended'
         FROM saas_workspace workspace
         WHERE member.workspace_id = workspace.id
           AND workspace.tenant_id = ? AND member.user_id = ?`,
      )
      .run(input.tenantId, input.targetUserId);
  }
  return { tenantId: input.tenantId, userId: input.targetUserId };
}

export async function removeTenantMember(input: {
  userId: number;
  tenantId: number;
  targetUserId: number;
}) {
  const access = await assertTenantAccess({
    userId: input.userId,
    tenantId: input.tenantId,
    roles: ["owner", "admin"],
  });
  const existing = await getTenantMembership(input.tenantId, input.targetUserId);
  if (!existing) throw new HTTPException(404, { message: "Tenant 成员不存在" });
  assertTenantMemberMutation({ actorRole: access.role, targetRole: existing.role });
  await sqlite.transaction(async (tx) => {
    await tx
      .prepare(
        `DELETE FROM saas_workspace_member member
         USING saas_workspace workspace
         WHERE member.workspace_id = workspace.id
           AND workspace.tenant_id = ? AND member.user_id = ?`,
      )
      .run(input.tenantId, input.targetUserId);
    await tx
      .prepare("DELETE FROM saas_tenant_member WHERE tenant_id = ? AND user_id = ?")
      .run(input.tenantId, input.targetUserId);
  });
  return { tenantId: input.tenantId, userId: input.targetUserId };
}

export async function listWorkspaceMembers(input: PageInput & { workspaceId: number }) {
  await assertWorkspaceAccess({
    userId: input.userId,
    workspaceId: input.workspaceId,
    roles: ["owner"],
  });
  const params: Array<string | number> = [input.workspaceId];
  const where = ["member.workspace_id = ?", "app_user.deleted_at IS NULL"];
  if (input.keyword?.trim()) {
    where.push(
      "(app_user.username ILIKE ? OR app_user.nickname ILIKE ? OR app_user.email ILIKE ?)",
    );
    const keyword = `%${input.keyword.trim()}%`;
    params.push(keyword, keyword, keyword);
  }
  if (input.status) {
    where.push("member.status = ?");
    params.push(input.status);
  }
  const whereSql = where.join(" AND ");
  const count = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total
       FROM saas_workspace_member member
       INNER JOIN sys_user app_user ON app_user.id = member.user_id
       WHERE ${whereSql}`,
    )
    .get(...params)) as { total: number };
  const rows = await sqlite
    .prepare(
      `SELECT member.workspace_id AS "workspaceId", member.user_id AS "userId",
        app_user.username, app_user.nickname, app_user.email,
        member.role, member.status, member.joined_at AS "joinedAt"
       FROM saas_workspace_member member
       INNER JOIN sys_user app_user ON app_user.id = member.user_id
       WHERE ${whereSql}
       ORDER BY CASE member.role WHEN 'owner' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,
         member.joined_at ASC, member.user_id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, offset(input.page, input.pageSize));
  return { data: rows, page: input.page, pageSize: input.pageSize, total: Number(count.total) };
}

export async function upsertWorkspaceMember(input: {
  userId: number;
  workspaceId: number;
  targetUserId: number;
  role: WorkspaceAssignableRole;
  status: "active" | "suspended";
}) {
  const workspace = await assertWorkspaceAccess({
    userId: input.userId,
    workspaceId: input.workspaceId,
    roles: ["owner"],
  });
  if (input.userId !== 1) {
    assertWorkspaceMemberMutation({
      tenantRole: workspace.tenantRole,
      workspaceRole: workspace.memberRole,
      targetRole: (await getWorkspaceMembership(input.workspaceId, input.targetUserId))?.role,
      nextRole: input.role,
    });
  }
  await assertActiveUser(input.targetUserId);
  const tenantMembership = await getTenantMembership(workspace.tenantId, input.targetUserId);
  if (!tenantMembership || tenantMembership.status !== "active") {
    throw new HTTPException(409, { message: "用户必须先成为该 Tenant 的有效成员" });
  }
  await sqlite
    .prepare(
      `INSERT INTO saas_workspace_member
        (workspace_id, user_id, role, status, joined_at, created_by)
       VALUES (?, ?, ?, ?, now(), ?)
       ON CONFLICT (workspace_id, user_id)
       DO UPDATE SET role = excluded.role, status = excluded.status`,
    )
    .run(input.workspaceId, input.targetUserId, input.role, input.status, input.userId);
  return { workspaceId: input.workspaceId, userId: input.targetUserId };
}

export async function removeWorkspaceMember(input: {
  userId: number;
  workspaceId: number;
  targetUserId: number;
}) {
  const workspace = await assertWorkspaceAccess({
    userId: input.userId,
    workspaceId: input.workspaceId,
    roles: ["owner"],
  });
  const existing = await getWorkspaceMembership(input.workspaceId, input.targetUserId);
  if (!existing) throw new HTTPException(404, { message: "Workspace 成员不存在" });
  if (input.userId !== 1) {
    assertWorkspaceMemberMutation({
      tenantRole: workspace.tenantRole,
      workspaceRole: workspace.memberRole,
      targetRole: existing.role,
    });
  } else if (existing.role === "owner") {
    throw new HTTPException(409, { message: "Workspace owner 需要通过独立所有权转移流程变更" });
  }
  await sqlite
    .prepare("DELETE FROM saas_workspace_member WHERE workspace_id = ? AND user_id = ?")
    .run(input.workspaceId, input.targetUserId);
  return { workspaceId: input.workspaceId, userId: input.targetUserId };
}

async function expirePendingInvitations(tenantId?: number) {
  const suffix = tenantId ? " AND tenant_id = ?" : "";
  const params = tenantId ? [tenantId] : [];
  await sqlite
    .prepare(
      `UPDATE saas_invitation
       SET status = 'expired', updated_at = now()
       WHERE status = 'pending' AND expires_at <= now()${suffix}`,
    )
    .run(...params);
}

export async function listInvitations(input: PageInput & { tenantId: number }) {
  await assertTenantAccess({
    userId: input.userId,
    tenantId: input.tenantId,
    roles: ["owner", "admin"],
  });
  await expirePendingInvitations(input.tenantId);
  const params: Array<string | number> = [input.tenantId];
  const where = ["invitation.tenant_id = ?"];
  if (input.keyword?.trim()) {
    where.push("invitation.email ILIKE ?");
    params.push(`%${input.keyword.trim()}%`);
  }
  if (input.status) {
    where.push("invitation.status = ?");
    params.push(input.status);
  }
  const whereSql = where.join(" AND ");
  const count = (await sqlite
    .prepare(`SELECT COUNT(*)::int AS total FROM saas_invitation invitation WHERE ${whereSql}`)
    .get(...params)) as { total: number };
  const rows = await sqlite
    .prepare(
      `SELECT invitation.id, invitation.tenant_id AS "tenantId",
        invitation.workspace_id AS "workspaceId", workspace.name AS "workspaceName",
        invitation.email, invitation.tenant_role AS "tenantRole",
        invitation.workspace_role AS "workspaceRole", invitation.status,
        invitation.expires_at AS "expiresAt", invitation.accepted_at AS "acceptedAt",
        invitation.revoked_at AS "revokedAt", invitation.created_at AS "createdAt"
       FROM saas_invitation invitation
       LEFT JOIN saas_workspace workspace ON workspace.id = invitation.workspace_id
       WHERE ${whereSql}
       ORDER BY invitation.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, offset(input.page, input.pageSize));
  return { data: rows, page: input.page, pageSize: input.pageSize, total: Number(count.total) };
}

export async function createInvitation(input: {
  userId: number;
  tenantId: number;
  workspaceId?: number | null;
  email: string;
  tenantRole: TenantAssignableRole;
  workspaceRole?: WorkspaceAssignableRole | null;
  expiresInDays: number;
}) {
  const access = await assertTenantAccess({
    userId: input.userId,
    tenantId: input.tenantId,
    roles: ["owner", "admin"],
  });
  if (access.tenant.status !== "active") {
    throw new HTTPException(409, { message: "只有启用中的 Tenant 可以创建邀请" });
  }
  if (access.role === "admin" && input.tenantRole === "admin") {
    throw new HTTPException(403, { message: "Tenant admin 不能邀请新的 admin" });
  }
  if (Boolean(input.workspaceId) !== Boolean(input.workspaceRole)) {
    throw new HTTPException(400, { message: "Workspace 与 Workspace 角色必须同时提供" });
  }
  if (input.workspaceId) {
    const workspace = await assertWorkspaceAccess({
      userId: input.userId,
      workspaceId: input.workspaceId,
      roles: ["owner"],
    });
    if (workspace.tenantId !== input.tenantId) {
      throw new HTTPException(404, { message: "Workspace 不存在" });
    }
    if (workspace.status !== "active") {
      throw new HTTPException(409, { message: "归档 Workspace 不能创建邀请" });
    }
  }
  const email = normalizedEmail(input.email);
  await expirePendingInvitations(input.tenantId);
  const existingMember = (await sqlite
    .prepare(
      `SELECT member.user_id AS "userId"
       FROM saas_tenant_member member
       INNER JOIN sys_user app_user ON app_user.id = member.user_id
       WHERE member.tenant_id = ? AND member.status = 'active'
         AND lower(app_user.email) = ? AND app_user.deleted_at IS NULL
       LIMIT 1`,
    )
    .get(input.tenantId, email)) as { userId: number } | undefined;
  if (existingMember) throw new HTTPException(409, { message: "该邮箱已经是有效 Tenant 成员" });
  const pendingInvitation = await sqlite
    .prepare(
      `SELECT id FROM saas_invitation
       WHERE tenant_id = ? AND email = ? AND status = 'pending'
       LIMIT 1`,
    )
    .get(input.tenantId, email);
  if (pendingInvitation) {
    throw new HTTPException(409, { message: "该邮箱已有待接受邀请，请先撤销或等待过期" });
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = invitationTokenHash(token);
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();
  const created = await sqlite
    .prepare(
      `INSERT INTO saas_invitation
        (tenant_id, workspace_id, email, tenant_role, workspace_role, token_hash,
         status, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       RETURNING id`,
    )
    .run(
      input.tenantId,
      input.workspaceId ?? null,
      email,
      input.tenantRole,
      input.workspaceRole ?? null,
      tokenHash,
      expiresAt,
      input.userId,
    );
  return { id: Number(created.lastInsertRowid), token, expiresAt };
}

export async function revokeInvitation(input: { userId: number; id: number }) {
  const invitation = (await sqlite
    .prepare(
      `SELECT id, tenant_id AS "tenantId", status
       FROM saas_invitation WHERE id = ? LIMIT 1`,
    )
    .get(input.id)) as { id: number; tenantId: number; status: string } | undefined;
  if (!invitation) throw new HTTPException(404, { message: "邀请不存在" });
  await assertTenantAccess({
    userId: input.userId,
    tenantId: invitation.tenantId,
    roles: ["owner", "admin"],
  });
  await expirePendingInvitations(invitation.tenantId);
  const updated = await sqlite
    .prepare(
      `UPDATE saas_invitation
       SET status = 'revoked', revoked_at = now(), revoked_by = ?, updated_at = now()
       WHERE id = ? AND status = 'pending'
       RETURNING id`,
    )
    .get(input.userId, input.id);
  if (!updated) throw new HTTPException(409, { message: "只有待接受邀请可以撤销" });
  return { id: input.id };
}

export async function acceptInvitation(input: { userId: number; token: string }) {
  const user = await assertActiveUser(input.userId);
  if (!user.email) {
    throw new HTTPException(409, { message: "请先在个人中心绑定邀请邮箱" });
  }
  const tokenHash = invitationTokenHash(input.token);
  const invitation = (await sqlite
    .prepare(
      `SELECT invitation.id, invitation.tenant_id AS "tenantId",
        invitation.workspace_id AS "workspaceId", invitation.email,
        invitation.tenant_role AS "tenantRole", invitation.workspace_role AS "workspaceRole",
        invitation.status, invitation.expires_at AS "expiresAt",
        tenant.status AS "tenantStatus", workspace.status AS "workspaceStatus"
       FROM saas_invitation invitation
       INNER JOIN saas_tenant tenant ON tenant.id = invitation.tenant_id
       LEFT JOIN saas_workspace workspace ON workspace.id = invitation.workspace_id
       WHERE invitation.token_hash = ? AND tenant.deleted_at IS NULL
       LIMIT 1`,
    )
    .get(tokenHash)) as
    | {
        id: number;
        tenantId: number;
        workspaceId: number | null;
        email: string;
        tenantRole: TenantAssignableRole;
        workspaceRole: WorkspaceAssignableRole | null;
        status: string;
        expiresAt: string;
        tenantStatus: string;
        workspaceStatus: string | null;
      }
    | undefined;
  if (!invitation) throw new HTTPException(404, { message: "邀请不存在" });
  if (normalizedEmail(user.email) !== invitation.email) {
    throw new HTTPException(403, { message: "当前账号邮箱与邀请邮箱不一致" });
  }
  if (invitation.status !== "pending") {
    throw new HTTPException(409, { message: "邀请已失效或已处理" });
  }
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
    await expirePendingInvitations(invitation.tenantId);
    throw new HTTPException(410, { message: "邀请已过期" });
  }
  if (invitation.tenantStatus !== "active") {
    throw new HTTPException(409, { message: "Tenant 当前不可加入" });
  }
  if (invitation.workspaceId && invitation.workspaceStatus !== "active") {
    throw new HTTPException(409, { message: "Workspace 当前不可加入" });
  }

  await sqlite.transaction(async (tx) => {
    const accepted = await tx
      .prepare(
        `UPDATE saas_invitation
         SET status = 'accepted', accepted_at = now(), accepted_by = ?, updated_at = now()
         WHERE id = ? AND status = 'pending' AND expires_at > now()
         RETURNING id`,
      )
      .get(input.userId, invitation.id);
    if (!accepted) throw new HTTPException(409, { message: "邀请已被处理" });
    await tx
      .prepare(
        `INSERT INTO saas_tenant_member
          (tenant_id, user_id, role, status, joined_at, created_by)
         VALUES (?, ?, ?, 'active', now(), ?)
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET
           role = CASE WHEN saas_tenant_member.role = 'owner' THEN 'owner' ELSE excluded.role END,
           status = 'active'`,
      )
      .run(invitation.tenantId, input.userId, invitation.tenantRole, input.userId);
    if (invitation.workspaceId && invitation.workspaceRole) {
      await tx
        .prepare(
          `INSERT INTO saas_workspace_member
            (workspace_id, user_id, role, status, joined_at, created_by)
           VALUES (?, ?, ?, 'active', now(), ?)
           ON CONFLICT (workspace_id, user_id)
           DO UPDATE SET
             role = CASE WHEN saas_workspace_member.role = 'owner' THEN 'owner' ELSE excluded.role END,
             status = 'active'`,
        )
        .run(invitation.workspaceId, input.userId, invitation.workspaceRole, input.userId);
    }
  });
  return {
    id: invitation.id,
    tenantId: invitation.tenantId,
    workspaceId: invitation.workspaceId,
  };
}
