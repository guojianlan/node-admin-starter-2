import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/server/app";
import { nowIso } from "@/server/db";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase, sqlite } from "../helpers/db";

type ApiResponse<T = unknown> = { success: boolean; msg: string; data?: T };
type Page<T> = { data: T[]; page: number; pageSize: number; total: number };

async function readJson<T = unknown>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

async function login(username = "admin", password?: string) {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username,
      password: password ?? (username === "admin" ? getAdminTestPassword() : "123456"),
    }),
  });
  const body = await readJson<{ token: string }>(response);
  return String(body.data?.token ?? "");
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function createTenantThroughApi(token: string, code: string) {
  const response = await app.request("/api/saas/tenants", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      name: `Tenant ${code}`,
      code,
      region: "cn-south",
      retentionDays: 730,
    }),
  });
  const body = await readJson<{ id: number; defaultWorkspaceId: number }>(response);
  expect(response.status).toBe(200);
  return body.data as { id: number; defaultWorkspaceId: number };
}

async function createScopedSaasUser(input: {
  tenantId: number;
  workspaceId: number;
  username?: string;
  email?: string;
  tenantRole?: "owner" | "admin" | "member" | "viewer";
  workspaceRole?: "owner" | "editor" | "reviewer" | "viewer";
}) {
  const now = nowIso();
  const password = "TenantUser123!";
  const username = input.username ?? "tenant_member";
  const role = await sqlite
    .prepare(
      `INSERT INTO sys_role
        (name, code, status, data_scope, created_at, updated_at)
       VALUES ('Tenant 测试成员', 'tenant_test_member', 1, 'self', ?, ?)
       RETURNING id`,
    )
    .run(now, now);
  const roleId = Number(role.lastInsertRowid);
  const rules = (await sqlite
    .prepare(
      `SELECT id FROM sys_rule WHERE key IN (
        'saas.tenant.query', 'saas.tenant.update',
        'saas.workspace.query', 'saas.workspace.update',
        'saas.member.query', 'saas.member.update', 'saas.member.remove',
        'saas.member.invite', 'saas.member.revokeInvite',
        'saas.module.query', 'saas.module.entitlementQuery',
        'saas.module.entitlementCreate', 'saas.module.entitlementUpdate'
      )`,
    )
    .all()) as Array<{ id: number }>;
  for (const rule of rules) {
    await sqlite
      .prepare("INSERT INTO sys_role_rule (role_id, rule_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
      .run(roleId, rule.id);
  }
  const user = await sqlite
    .prepare(
      `INSERT INTO sys_user
        (username, password_hash, nickname, sex, dept_id, status, force_password_change,
         created_at, updated_at)
       VALUES (?, ?, 'Tenant 成员', 0, 1, 1, false, ?, ?)
       RETURNING id`,
    )
    .run(username, await bcrypt.hash(password, 10), now, now);
  const userId = Number(user.lastInsertRowid);
  if (input.email) {
    await sqlite.prepare("UPDATE sys_user SET email = ? WHERE id = ?").run(input.email, userId);
  }
  await sqlite
    .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)")
    .run(userId, roleId);
  await sqlite
    .prepare(
      `INSERT INTO saas_tenant_member (tenant_id, user_id, role, status, created_by)
       VALUES (?, ?, ?, 'active', 1)`,
    )
    .run(input.tenantId, userId, input.tenantRole ?? "member");
  await sqlite
    .prepare(
      `INSERT INTO saas_workspace_member (workspace_id, user_id, role, status, created_by)
       VALUES (?, ?, ?, 'active', 1)`,
    )
    .run(input.workspaceId, userId, input.workspaceRole ?? "viewer");
  return { password, userId, username };
}

describe("SaaS tenant and workspace control plane", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("creates a default tenant context for the existing single-organization users", async () => {
    const token = await login("demo", "123456");
    const response = await app.request("/api/saas/context", {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await readJson<{
      tenants: Array<{ code: string; role: string }>;
      workspaces: Array<{ code: string; role: string }>;
      defaultTenantId: number;
      defaultWorkspaceId: number;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.data?.tenants).toEqual([
      expect.objectContaining({ code: "default", role: "member" }),
    ]);
    expect(body.data?.workspaces).toEqual([
      expect.objectContaining({ code: "default", role: "viewer" }),
    ]);
    expect(body.data?.defaultTenantId).toEqual(expect.any(Number));
    expect(body.data?.defaultWorkspaceId).toEqual(expect.any(Number));
  });

  it("creates Tenant and default Workspace atomically and records sanitized audit evidence", async () => {
    const token = await login();
    const created = await createTenantThroughApi(token, "tenant-a");
    const tenant = await sqlite
      .prepare('SELECT code, created_by AS "createdBy" FROM saas_tenant WHERE id = ?')
      .get(created.id);
    const workspace = await sqlite
      .prepare(
        `SELECT tenant_id AS "tenantId", code, created_by AS "createdBy"
         FROM saas_workspace WHERE id = ?`,
      )
      .get(created.defaultWorkspaceId);
    const tenantMember = await sqlite
      .prepare("SELECT role FROM saas_tenant_member WHERE tenant_id = ? AND user_id = 1")
      .get(created.id);
    const workspaceMember = await sqlite
      .prepare("SELECT role FROM saas_workspace_member WHERE workspace_id = ? AND user_id = 1")
      .get(created.defaultWorkspaceId);
    const audit = (await sqlite
      .prepare(
        `SELECT module, action, risk_level AS "riskLevel", details_json AS "detailsJson"
         FROM sys_operation_log WHERE module = 'saas.tenant' AND action = 'create'
         ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { module: string; action: string; riskLevel: string; detailsJson: string };

    expect(tenant).toMatchObject({ code: "tenant-a", createdBy: 1 });
    expect(workspace).toMatchObject({ tenantId: created.id, code: "default", createdBy: 1 });
    expect(tenantMember).toMatchObject({ role: "owner" });
    expect(workspaceMember).toMatchObject({ role: "owner" });
    expect(audit).toMatchObject({ module: "saas.tenant", action: "create", riskLevel: "medium" });
    expect(audit.detailsJson).toContain("tenant-a");
    expect(audit.detailsJson.toLowerCase()).not.toContain("password");
  });

  it("isolates Tenant and Workspace lists and rejects direct cross-tenant writes", async () => {
    const adminToken = await login();
    const tenantA = await createTenantThroughApi(adminToken, "tenant-a");
    const tenantB = await createTenantThroughApi(adminToken, "tenant-b");
    const scoped = await createScopedSaasUser({
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
    });
    const token = await login(scoped.username, scoped.password);

    const tenantsResponse = await app.request("/api/saas/tenants?page=1&pageSize=100", {
      headers: { authorization: `Bearer ${token}` },
    });
    const tenants = await readJson<Page<{ id: number; code: string }>>(tenantsResponse);
    expect(tenantsResponse.status).toBe(200);
    expect(tenants.data?.data.map((item) => item.code)).toEqual(["tenant-a"]);

    const workspacesResponse = await app.request("/api/saas/workspaces?page=1&pageSize=100", {
      headers: { authorization: `Bearer ${token}` },
    });
    const workspaces = await readJson<Page<{ id: number; tenantId: number }>>(workspacesResponse);
    expect(workspacesResponse.status).toBe(200);
    expect(workspaces.data?.data).toEqual([
      expect.objectContaining({ id: tenantA.defaultWorkspaceId, tenantId: tenantA.id }),
    ]);

    const tenantAttack = await app.request(`/api/saas/tenants/${tenantB.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ name: "越权 Tenant" }),
    });
    const workspaceAttack = await app.request(
      `/api/saas/workspaces/${tenantB.defaultWorkspaceId}`,
      {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "越权 Workspace" }),
      },
    );
    expect(tenantAttack.status).toBe(404);
    expect(workspaceAttack.status).toBe(404);
    expect(
      await sqlite.prepare("SELECT name FROM saas_tenant WHERE id = ?").get(tenantB.id),
    ).toMatchObject({
      name: "Tenant tenant-b",
    });
  });

  it("stores invitation tokens only as hashes and binds acceptance to an existing user email", async () => {
    const adminToken = await login();
    const tenant = await createTenantThroughApi(adminToken, "invite-tenant");
    const invited = await createScopedSaasUser({
      tenantId: tenant.id,
      workspaceId: tenant.defaultWorkspaceId,
      username: "invited_user",
      email: "invited@example.com",
    });
    await sqlite
      .prepare("DELETE FROM saas_workspace_member WHERE workspace_id = ? AND user_id = ?")
      .run(tenant.defaultWorkspaceId, invited.userId);
    await sqlite
      .prepare("DELETE FROM saas_tenant_member WHERE tenant_id = ? AND user_id = ?")
      .run(tenant.id, invited.userId);

    const invitationResponse = await app.request("/api/saas/invitations", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        tenantId: tenant.id,
        workspaceId: tenant.defaultWorkspaceId,
        email: "Invited@Example.com",
        tenantRole: "member",
        workspaceRole: "editor",
        expiresInDays: 7,
      }),
    });
    const invitationBody = await readJson<{ id: number; token: string }>(invitationResponse);
    const token = String(invitationBody.data?.token ?? "");
    expect(invitationResponse.status).toBe(200);
    expect(token.length).toBeGreaterThan(20);

    const stored = (await sqlite
      .prepare(
        `SELECT email, token_hash AS "tokenHash", status
         FROM saas_invitation WHERE id = ?`,
      )
      .get(Number(invitationBody.data?.id))) as {
      email: string;
      tokenHash: string;
      status: string;
    };
    expect(stored.email).toBe("invited@example.com");
    expect(stored.tokenHash).not.toContain(token);
    expect(stored.tokenHash).toHaveLength(64);

    const invitedToken = await login(invited.username, invited.password);
    const acceptResponse = await app.request("/api/saas/invitations/accept", {
      method: "POST",
      headers: authHeaders(invitedToken),
      body: JSON.stringify({ token }),
    });
    expect(acceptResponse.status).toBe(200);
    expect(
      await sqlite
        .prepare("SELECT role, status FROM saas_tenant_member WHERE tenant_id = ? AND user_id = ?")
        .get(tenant.id, invited.userId),
    ).toMatchObject({ role: "member", status: "active" });
    expect(
      await sqlite
        .prepare(
          "SELECT role, status FROM saas_workspace_member WHERE workspace_id = ? AND user_id = ?",
        )
        .get(tenant.defaultWorkspaceId, invited.userId),
    ).toMatchObject({ role: "editor", status: "active" });

    const replayResponse = await app.request("/api/saas/invitations/accept", {
      method: "POST",
      headers: authHeaders(invitedToken),
      body: JSON.stringify({ token }),
    });
    expect(replayResponse.status).toBe(409);
    const audit = (await sqlite
      .prepare(
        `SELECT details_json AS "detailsJson"
         FROM sys_operation_log WHERE module = 'saas.invitation'
         ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { detailsJson: string };
    expect(audit.detailsJson).not.toContain(token);
  });

  it("isolates member and invitation management across tenants and protects owner roles", async () => {
    const adminToken = await login();
    const tenantA = await createTenantThroughApi(adminToken, "member-a");
    const tenantB = await createTenantThroughApi(adminToken, "member-b");
    const manager = await createScopedSaasUser({
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
      username: "tenant_manager",
      email: "manager@example.com",
      tenantRole: "admin",
      workspaceRole: "owner",
    });
    const managerToken = await login(manager.username, manager.password);

    const crossInvitation = await app.request("/api/saas/invitations", {
      method: "POST",
      headers: authHeaders(managerToken),
      body: JSON.stringify({
        tenantId: tenantB.id,
        email: "attacker@example.com",
        tenantRole: "member",
      }),
    });
    expect(crossInvitation.status).toBe(404);

    const ownerMutation = await app.request(`/api/saas/tenant-members/${tenantA.id}/1`, {
      method: "PUT",
      headers: authHeaders(managerToken),
      body: JSON.stringify({ role: "member", status: "suspended" }),
    });
    expect(ownerMutation.status).toBe(409);

    const crossMembers = await app.request(
      `/api/saas/tenant-members?tenantId=${tenantB.id}&page=1&pageSize=20`,
      { headers: { authorization: `Bearer ${managerToken}` } },
    );
    expect(crossMembers.status).toBe(404);
    expect(
      await sqlite
        .prepare("SELECT COUNT(*)::int AS total FROM saas_invitation WHERE tenant_id = ?")
        .get(tenantB.id),
    ).toMatchObject({ total: 0 });
  });

  it("requires a real route and ability before activation and resolves effective entitled modules", async () => {
    const adminToken = await login();
    const tenantA = await createTenantThroughApi(adminToken, "entitled-a");
    const tenantB = await createTenantThroughApi(adminToken, "entitled-b");

    const plannedModule = (await sqlite
      .prepare("SELECT id FROM saas_module WHERE code = 'image' AND deleted_at IS NULL")
      .get()) as { id: number };
    const prematureEntitlement = await app.request("/api/saas/entitlements", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        tenantId: tenantA.id,
        moduleId: plannedModule.id,
        status: "trial",
        source: "trial",
      }),
    });
    expect(prematureEntitlement.status).toBe(409);

    const moduleResponse = await app.request("/api/saas/modules", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        code: "workspace-addon",
        name: "Workspace Add-on",
        version: "1.0.0",
        status: "active",
        routeKey: "saas.workspace",
        routePath: "/saas/workspaces",
        requiredAbility: "saas.workspace.query",
        dependencies: [],
        capabilities: ["workspace"],
      }),
    });
    const moduleBody = await readJson<{ id: number }>(moduleResponse);
    expect(moduleResponse.status).toBe(200);

    const entitlementResponse = await app.request("/api/saas/entitlements", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        tenantId: tenantA.id,
        moduleId: moduleBody.data?.id,
        status: "active",
        source: "manual",
        memberLimitOverride: 25,
      }),
    });
    expect(entitlementResponse.status).toBe(200);

    const manager = await createScopedSaasUser({
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
      username: "entitlement_manager",
      email: "entitlement@example.com",
      tenantRole: "admin",
      workspaceRole: "owner",
    });
    const managerToken = await login(manager.username, manager.password);
    const effectiveResponse = await app.request(
      `/api/saas/modules/effective?tenantId=${tenantA.id}`,
      { headers: { authorization: `Bearer ${managerToken}` } },
    );
    const effective =
      await readJson<Array<{ code: string; memberLimitOverride: number }>>(effectiveResponse);
    expect(effectiveResponse.status).toBe(200);
    expect(effective.data).toEqual([
      expect.objectContaining({ code: "workspace-addon", memberLimitOverride: 25 }),
    ]);

    const crossEntitlement = await app.request("/api/saas/entitlements", {
      method: "POST",
      headers: authHeaders(managerToken),
      body: JSON.stringify({
        tenantId: tenantB.id,
        moduleId: moduleBody.data?.id,
        status: "trial",
        source: "trial",
      }),
    });
    expect(crossEntitlement.status).toBe(404);
  });
});
