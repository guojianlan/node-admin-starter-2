import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { nowIso } from "@/server/db";
import {
  applySaaSOperationCallback,
  claimNextSaaSAsyncOperation,
  completeSaaSAsyncOperation,
  createSaaSAsyncOperation,
  renewSaaSAsyncOperationLease,
} from "@/server/services/saas-async-operation-service";
import { assertSaaSFileScope } from "@/server/services/saas-file-service";
import { resolveSaaSResourceScope } from "@/server/services/saas-resource-scope-service";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase, sqlite } from "../helpers/db";

type ApiResponse<T = unknown> = { success: boolean; msg: string; data?: T };

async function readJson<T = unknown>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

async function login(username = "admin", password = getAdminTestPassword()) {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
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

async function createTenantUser(input: {
  username: string;
  tenantId?: number;
  workspaceId?: number;
}) {
  const now = nowIso();
  const password = "SaaSResource123!";
  const role = await sqlite
    .prepare(
      `INSERT INTO sys_role (name, code, status, data_scope, created_at, updated_at)
       VALUES (?, ?, 1, 'self', ?, ?) RETURNING id`,
    )
    .run(`Role ${input.username}`, `role_${input.username}`, now, now);
  const roleId = Number(role.lastInsertRowid);
  const rules = (await sqlite
    .prepare(
      `SELECT id FROM sys_rule
       WHERE key IN ('saas.workspace.query', 'saas.workspace.update')`,
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
       VALUES (?, ?, ?, 0, 1, 1, false, ?, ?) RETURNING id`,
    )
    .run(input.username, await bcrypt.hash(password, 10), input.username, now, now);
  const userId = Number(user.lastInsertRowid);
  await sqlite
    .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)")
    .run(userId, roleId);
  if (input.tenantId && input.workspaceId) {
    await sqlite
      .prepare(
        `INSERT INTO saas_tenant_member (tenant_id, user_id, role, status, created_by)
         VALUES (?, ?, 'member', 'active', 1)`,
      )
      .run(input.tenantId, userId);
    await sqlite
      .prepare(
        `INSERT INTO saas_workspace_member (workspace_id, user_id, role, status, created_by)
         VALUES (?, ?, 'editor', 'active', 1)`,
      )
      .run(input.workspaceId, userId);
  }
  return { userId, password, token: await login(input.username, password) };
}

async function uploadSaaSFile(input: {
  token: string;
  tenantId: number;
  workspaceId: number;
  name: string;
  content: string;
}) {
  const form = new FormData();
  form.set("file", new File([input.content], input.name, { type: "text/plain" }));
  form.set("resourceType", "test.record");
  form.set("resourceId", input.name);
  form.set("purpose", "attack-matrix");
  const response = await app.request("/api/saas/files/upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "x-saas-tenant-id": String(input.tenantId),
      "x-saas-workspace-id": String(input.workspaceId),
    },
    body: form,
  });
  expect(response.status).toBe(200);
  return (await readJson<{ fileId: number; objectKey: string }>(response)).data!;
}

describe("Foundation F2 SaaS resource scope", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("uses server-generated object prefixes and blocks file metadata, download, and binding attacks", async () => {
    const adminToken = await login();
    const tenantA = await createTenant(adminToken, "resource-a");
    const tenantB = await createTenant(adminToken, "resource-b");
    const userA = await createTenantUser({
      username: "resource_user_a",
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
    });
    const userB = await createTenantUser({
      username: "resource_user_b",
      tenantId: tenantB.id,
      workspaceId: tenantB.defaultWorkspaceId,
    });
    const fileA = await uploadSaaSFile({
      token: userA.token,
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
      name: "tenant-a.txt",
      content: "tenant a private content",
    });
    const fileB = await uploadSaaSFile({
      token: userB.token,
      tenantId: tenantB.id,
      workspaceId: tenantB.defaultWorkspaceId,
      name: "tenant-b.txt",
      content: "tenant b private content",
    });

    expect(fileA.objectKey).toMatch(/^tenants\/resource-a\/workspaces\/default\//);
    expect(fileB.objectKey).toMatch(/^tenants\/resource-b\/workspaces\/default\//);
    expect(fileA.objectKey).not.toBe(fileB.objectKey);

    const list = await app.request("/api/saas/files?page=1&pageSize=100", {
      headers: jsonHeaders(userA.token, tenantA.id, tenantA.defaultWorkspaceId),
    });
    const page = await readJson<{ data: Array<{ fileId: number }> }>(list);
    expect(page.data?.data.map((item) => item.fileId)).toEqual([fileA.fileId]);

    for (const path of [
      `/api/saas/files/${fileB.fileId}`,
      `/api/saas/files/${fileB.fileId}/download`,
    ]) {
      const attack = await app.request(path, {
        headers: jsonHeaders(userA.token, tenantA.id, tenantA.defaultWorkspaceId),
      });
      expect(attack.status).toBe(404);
    }
    const bindAttack = await app.request(`/api/saas/files/${fileB.fileId}/binding`, {
      method: "PUT",
      headers: jsonHeaders(userA.token, tenantA.id, tenantA.defaultWorkspaceId),
      body: JSON.stringify({ resourceType: "test.record", resourceId: "stolen" }),
    });
    expect(bindAttack.status).toBe(404);

    const platformOnly = await createTenantUser({ username: "platform_only" });
    const implicitBreakGlass = await app.request(`/api/saas/files/${fileB.fileId}`, {
      headers: jsonHeaders(platformOnly.token, tenantB.id, tenantB.defaultWorkspaceId),
    });
    expect(implicitBreakGlass.status).toBe(404);
  });

  it("binds audit rows to the current scope and never leaks another Tenant audit stream", async () => {
    const adminToken = await login();
    const tenantA = await createTenant(adminToken, "audit-a");
    const tenantB = await createTenant(adminToken, "audit-b");
    const userA = await createTenantUser({
      username: "audit_user_a",
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
    });
    const userB = await createTenantUser({
      username: "audit_user_b",
      tenantId: tenantB.id,
      workspaceId: tenantB.defaultWorkspaceId,
    });
    await uploadSaaSFile({
      token: userA.token,
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
      name: "audit-a.txt",
      content: "a",
    });
    await uploadSaaSFile({
      token: userB.token,
      tenantId: tenantB.id,
      workspaceId: tenantB.defaultWorkspaceId,
      name: "audit-b.txt",
      content: "b",
    });

    const response = await app.request("/api/saas/audit?page=1&pageSize=100", {
      headers: jsonHeaders(userA.token, tenantA.id, tenantA.defaultWorkspaceId),
    });
    const page = await readJson<{ data: Array<{ userId: number; module: string }> }>(response);
    expect(response.status).toBe(200);
    expect(page.data?.data).toContainEqual(
      expect.objectContaining({ userId: userA.userId, module: "saas.file" }),
    );
    expect(page.data?.data.some((item) => item.userId === userB.userId)).toBe(false);
    expect(
      await sqlite
        .prepare(
          `SELECT tenant_id AS "tenantId", workspace_id AS "workspaceId"
           FROM sys_operation_log WHERE module = 'saas.file' AND user_id = ? ORDER BY id DESC LIMIT 1`,
        )
        .get(userA.userId),
    ).toMatchObject({ tenantId: tenantA.id, workspaceId: tenantA.defaultWorkspaceId });
  });

  it("persists database scope for Job, Tool, and Export and rejects cross-Tenant result resources", async () => {
    const adminToken = await login();
    const tenantA = await createTenant(adminToken, "async-a");
    const tenantB = await createTenant(adminToken, "async-b");
    const userA = await createTenantUser({
      username: "async_user_a",
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
    });
    const userB = await createTenantUser({
      username: "async_user_b",
      tenantId: tenantB.id,
      workspaceId: tenantB.defaultWorkspaceId,
    });
    const fileA = await uploadSaaSFile({
      token: userA.token,
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
      name: "async-a.txt",
      content: "a",
    });
    const fileB = await uploadSaaSFile({
      token: userB.token,
      tenantId: tenantB.id,
      workspaceId: tenantB.defaultWorkspaceId,
      name: "async-b.txt",
      content: "b",
    });
    const scopeA = await resolveSaaSResourceScope({
      userId: userA.userId,
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
    });

    for (const kind of ["job", "tool", "export"] as const) {
      const operation = await createSaaSAsyncOperation({
        userId: userA.userId,
        scope: scopeA,
        kind,
        operationType: `test.${kind}`,
        payload: {
          tenantId: tenantB.id,
          workspaceId: tenantB.defaultWorkspaceId,
          fileId: fileB.fileId,
        },
        idempotencyKey: `attack-${kind}`,
      });
      expect(operation).toMatchObject({
        tenantId: tenantA.id,
        workspaceId: tenantA.defaultWorkspaceId,
      });
      const workerId = `worker-${kind}`;
      const claimed = await claimNextSaaSAsyncOperation({ workerId, kinds: [kind] });
      expect(claimed?.scope).toMatchObject({
        tenantId: tenantA.id,
        workspaceId: tenantA.defaultWorkspaceId,
      });
      await expect(
        renewSaaSAsyncOperationLease({ id: operation!.id, workerId, leaseSeconds: 60 }),
      ).resolves.toEqual(expect.objectContaining({ leaseUntil: expect.anything() }));
      await expect(assertSaaSFileScope(claimed!.scope, fileB.fileId)).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        completeSaaSAsyncOperation({
          id: operation!.id,
          workerId,
          resultFileId: fileB.fileId,
        }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        completeSaaSAsyncOperation({
          id: operation!.id,
          workerId,
          resultFileId: fileA.fileId,
          result: { ok: true },
        }),
      ).resolves.toMatchObject({ status: "completed" });
    }
  });

  it("fails closed before Worker side effects and restores Callback scope from the operation fact", async () => {
    const adminToken = await login();
    const tenantA = await createTenant(adminToken, "worker-a");
    const tenantB = await createTenant(adminToken, "worker-b");
    const userA = await createTenantUser({
      username: "worker_user_a",
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
    });
    const scopeA = await resolveSaaSResourceScope({
      userId: userA.userId,
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
    });
    const callbackOperation = await createSaaSAsyncOperation({
      userId: userA.userId,
      scope: scopeA,
      kind: "job",
      operationType: "test.callback",
      payload: { tenantId: tenantB.id },
      idempotencyKey: "callback-scope",
    });
    const apply = vi.fn(async (scope: typeof scopeA) => scope.tenantId);
    const callback = await applySaaSOperationCallback({
      operationId: callbackOperation!.id,
      callbackKey: "provider-event-1",
      payload: { tenantId: tenantB.id, workspaceId: tenantB.defaultWorkspaceId },
      apply,
    });
    expect(callback.result).toBe(tenantA.id);
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: tenantA.id, workspaceId: tenantA.defaultWorkspaceId }),
      expect.objectContaining({ tenantId: tenantB.id }),
    );
    await applySaaSOperationCallback({
      operationId: callbackOperation!.id,
      callbackKey: "provider-event-1",
      payload: { tenantId: tenantB.id },
      apply,
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(
      await sqlite
        .prepare(
          `SELECT tenant_id AS "tenantId", workspace_id AS "workspaceId", status
           FROM saas_callback_event WHERE operation_id = ?`,
        )
        .get(callbackOperation!.id),
    ).toMatchObject({
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
      status: "applied",
    });

    const blockedOperation = await createSaaSAsyncOperation({
      userId: userA.userId,
      scope: scopeA,
      kind: "tool",
      operationType: "test.member-suspension",
      payload: {},
      idempotencyKey: "suspended-worker",
    });
    await sqlite
      .prepare(
        `UPDATE saas_tenant_member SET status = 'suspended'
         WHERE tenant_id = ? AND user_id = ?`,
      )
      .run(tenantA.id, userA.userId);
    await expect(
      claimNextSaaSAsyncOperation({ workerId: "blocked-worker", kinds: ["tool"] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      await sqlite
        .prepare("SELECT status FROM saas_async_operation WHERE id = ?")
        .get(blockedOperation!.id),
    ).toMatchObject({ status: "failed" });
  });
});
