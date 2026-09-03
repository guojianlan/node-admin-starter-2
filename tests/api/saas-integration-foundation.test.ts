import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/server/app";
import { nowIso } from "@/server/db";
import {
  authenticateSaaSApiKey,
  recordSaaSApiKeyRequest,
} from "@/server/services/saas-api-key-service";
import {
  getTenantPublicBaseUrl,
  verifyTenantDomain,
} from "@/server/services/saas-branding-service";
import {
  enqueueSaaSEmailNotification,
  processNextSaaSNotification,
} from "@/server/services/saas-notification-service";
import { decryptSecret } from "@/server/services/secret";
import {
  createSaaSWebhookSignature,
  enqueueSaaSWebhookEvent,
  processNextSaaSWebhookDelivery,
  verifyAndClaimSaaSWebhookReplay,
  verifySaaSWebhookSignature,
  type SaaSWebhookDeliveryRuntime,
} from "@/server/services/saas-webhook-service";
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

function jsonHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
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

async function createTenantAdmin(input: { tenantId: number; workspaceId: number; username: string }) {
  const now = nowIso();
  const password = "FoundationF4!";
  const role = await sqlite
    .prepare(
      `INSERT INTO sys_role (name, code, status, data_scope, created_at, updated_at)
       VALUES (?, ?, 1, 'self', ?, ?) RETURNING id`,
    )
    .run(`Role ${input.username}`, `role_${input.username}`, now, now);
  const roleId = Number(role.lastInsertRowid);
  const rules = (await sqlite
    .prepare(
      `SELECT id FROM sys_rule WHERE key IN
        ('saas.branding.query', 'saas.branding.manage', 'saas.domain.query', 'saas.domain.manage',
         'saas.notification.query', 'saas.notification.manage', 'saas.apiKey.query',
         'saas.apiKey.manage', 'saas.webhook.query', 'saas.webhook.manage')`,
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
        (username, password_hash, nickname, email, sex, dept_id, status,
         force_password_change, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 1, 1, false, ?, ?) RETURNING id`,
    )
    .run(
      input.username,
      await bcrypt.hash(password, 10),
      input.username,
      `${input.username}@example.com`,
      now,
      now,
    );
  const userId = Number(user.lastInsertRowid);
  await sqlite.prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)").run(userId, roleId);
  await sqlite
    .prepare(
      `INSERT INTO saas_tenant_member (tenant_id, user_id, role, status, created_by)
       VALUES (?, ?, 'admin', 'active', 1)`,
    )
    .run(input.tenantId, userId);
  await sqlite
    .prepare(
      `INSERT INTO saas_workspace_member (workspace_id, user_id, role, status, created_by)
       VALUES (?, ?, 'editor', 'active', 1)`,
    )
    .run(input.workspaceId, userId);
  return { userId, token: await login(input.username, password) };
}

describe("Foundation F4 SaaS notification, integration, branding, and domain", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("creates an invitation and encrypted email Outbox fact in one transaction, then delivers branded mail", async () => {
    const token = await login();
    const tenant = await createTenant(token, "f4-mail");
    const branding = await app.request("/api/saas/branding", {
      method: "PUT",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        tenantId: tenant.id,
        productName: "Acme Studio",
        primaryColor: "#3366ff",
        themeMode: "system",
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
      }),
    });
    expect(branding.status).toBe(200);

    const response = await app.request("/api/saas/invitations", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        tenantId: tenant.id,
        workspaceId: tenant.defaultWorkspaceId,
        email: "invitee@example.com",
        tenantRole: "member",
        workspaceRole: "editor",
        expiresInDays: 7,
      }),
    });
    expect(response.status).toBe(200);
    const invitation = (await readJson<{
      id: number;
      token: string;
      notificationId: number;
    }>(response)).data!;
    const facts = (await sqlite
      .prepare(
        `SELECT invitation.token_hash AS "tokenHash", outbox.payload_encrypted AS "payloadEncrypted",
          outbox.status, outbox.recipient
         FROM saas_invitation invitation
         INNER JOIN saas_notification_outbox outbox
           ON outbox.resource_type = 'saas_invitation' AND outbox.resource_id = invitation.id::text
         WHERE invitation.id = ?`,
      )
      .get(invitation.id)) as {
      tokenHash: string;
      payloadEncrypted: string;
      status: string;
      recipient: string;
    };
    expect(facts.tokenHash).not.toContain(invitation.token);
    expect(facts.payloadEncrypted).not.toContain(invitation.token);
    expect(facts).toMatchObject({ status: "queued", recipient: "invitee@example.com" });
    expect(JSON.parse(decryptSecret(facts.payloadEncrypted)!)).toMatchObject({ token: invitation.token });

    let sent: { to: string; subject: string; text: string } | null = null;
    const result = await processNextSaaSNotification({
      workerId: "f4-mail-worker",
      sender: async (mail) => {
        sent = mail;
        return { messageId: "mail-1" };
      },
    });
    expect(result).toEqual({ id: invitation.notificationId, status: "delivered" });
    expect(sent).toMatchObject({ to: "invitee@example.com", subject: "Acme Studio 邀请你加入工作空间" });
    const deliveredMail = sent as unknown as { to: string; subject: string; text: string };
    expect(deliveredMail.text).toContain(encodeURIComponent(invitation.token));
    const stored = await sqlite
      .prepare(
        `SELECT status, provider_message_id AS "providerMessageId", payload_encrypted AS "payloadEncrypted"
         FROM saas_notification_outbox WHERE id = ?`,
      )
      .get(invitation.notificationId);
    expect(stored).toMatchObject({ status: "delivered", providerMessageId: "mail-1" });
    expect(JSON.stringify(stored)).not.toContain(invitation.token);
  });

  it("moves failed notification delivery to retry/dead-letter and allows governed manual retry", async () => {
    const token = await login();
    const tenant = await createTenant(token, "f4-mail-fail");
    const invitationResponse = await app.request("/api/saas/invitations", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ tenantId: tenant.id, email: "fail@example.com", expiresInDays: 7 }),
    });
    const invitation = (await readJson<{ notificationId: number }>(invitationResponse)).data!;
    await sqlite
      .prepare("UPDATE saas_notification_outbox SET max_attempts = 1 WHERE id = ?")
      .run(invitation.notificationId);
    await expect(
      processNextSaaSNotification({
        workerId: "f4-mail-fail-worker",
        sender: async () => {
          throw new Error("SMTP token=should-not-leak timeout");
        },
      }),
    ).resolves.toMatchObject({ status: "dead_letter" });
    const failed = (await sqlite
      .prepare("SELECT status, error_message AS \"errorMessage\" FROM saas_notification_outbox WHERE id = ?")
      .get(invitation.notificationId)) as { status: string; errorMessage: string | null };
    expect(failed).toMatchObject({ status: "dead_letter" });
    expect(failed?.errorMessage).not.toContain("should-not-leak");

    const retry = await app.request(`/api/saas/notifications/outbox/${invitation.notificationId}/retry`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ tenantId: tenant.id }),
    });
    expect(retry.status).toBe(200);
    expect(await sqlite.prepare("SELECT status, attempts FROM saas_notification_outbox WHERE id = ?").get(invitation.notificationId)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("rejects notification idempotency conflicts and cancels delivery when its invitation becomes invalid", async () => {
    const token = await login();
    const tenant = await createTenant(token, "f4-mail-cancel");
    const first = await enqueueSaaSEmailNotification({
      tenantId: tenant.id,
      workspaceId: tenant.defaultWorkspaceId,
      templateCode: "saas.example",
      recipient: "idempotent@example.com",
      payload: { value: 1 },
      idempotencyKey: "f4-notification-idempotency",
    });
    await expect(
      enqueueSaaSEmailNotification({
        tenantId: tenant.id,
        workspaceId: tenant.defaultWorkspaceId,
        templateCode: "saas.example",
        recipient: "idempotent@example.com",
        payload: { value: 1 },
        idempotencyKey: "f4-notification-idempotency",
      }),
    ).resolves.toEqual({ id: first.id, replayed: true });
    await expect(
      enqueueSaaSEmailNotification({
        tenantId: tenant.id,
        workspaceId: tenant.defaultWorkspaceId,
        templateCode: "saas.example",
        recipient: "idempotent@example.com",
        payload: { value: 2 },
        idempotencyKey: "f4-notification-idempotency",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await sqlite.prepare("DELETE FROM saas_notification_outbox WHERE id = ?").run(first.id);

    const invitationResponse = await app.request("/api/saas/invitations", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ tenantId: tenant.id, email: "cancelled@example.com", expiresInDays: 7 }),
    });
    const invitation = (await readJson<{ id: number; notificationId: number }>(invitationResponse)).data!;
    await sqlite
      .prepare("UPDATE saas_invitation SET status = 'revoked', revoked_at = now() WHERE id = ?")
      .run(invitation.id);
    await expect(
      processNextSaaSNotification({
        workerId: "f4-mail-cancel-worker",
        sender: async () => {
          throw new Error("sender must not run");
        },
      }),
    ).resolves.toEqual({ id: invitation.notificationId, status: "cancelled" });
    expect(
      await sqlite.prepare("SELECT status FROM saas_notification_outbox WHERE id = ?").get(invitation.notificationId),
    ).toMatchObject({ status: "cancelled" });
  });

  it("hashes API Keys, enforces exact scopes/resources, and revokes the previous key on rotation", async () => {
    const token = await login();
    const tenant = await createTenant(token, "f4-key");
    const create = await app.request("/api/saas/api-keys", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        tenantId: tenant.id,
        workspaceId: tenant.defaultWorkspaceId,
        name: "Automation",
        scopes: ["studio.project.query", "studio.task.create"],
        resourceConstraints: {
          workspaceIds: [tenant.defaultWorkspaceId],
          moduleCodes: ["novel"],
        },
      }),
    });
    expect(create.status).toBe(200);
    const created = (await readJson<{ id: number; key: string; prefix: string }>(create)).data!;
    const databaseKey = (await sqlite
      .prepare("SELECT prefix, key_hash AS \"keyHash\" FROM saas_api_key WHERE id = ?")
      .get(created.id)) as { prefix: string; keyHash: string };
    expect(databaseKey).toMatchObject({ prefix: created.prefix });
    expect(JSON.stringify(databaseKey)).not.toContain(created.key);
    await expect(
      authenticateSaaSApiKey({
        key: created.key,
        requiredScope: "studio.project.query",
        workspaceId: tenant.defaultWorkspaceId,
        moduleCode: "novel",
      }),
    ).resolves.toMatchObject({ tenantId: tenant.id, workspaceId: tenant.defaultWorkspaceId });
    await expect(
      authenticateSaaSApiKey({ key: created.key, requiredScope: "studio.project.delete" }),
    ).rejects.toMatchObject({ status: 403 });

    const list = await app.request(`/api/saas/api-keys?tenantId=${tenant.id}&page=1&pageSize=20`, {
      headers: jsonHeaders(token),
    });
    const listedText = await list.text();
    expect(list.status).toBe(200);
    expect(listedText).not.toContain(created.key);
    expect(listedText).not.toContain(String(databaseKey?.keyHash));

    const rotate = await app.request(`/api/saas/api-keys/${created.id}/rotate`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ tenantId: tenant.id }),
    });
    expect(rotate.status).toBe(200);
    const rotated = (await readJson<{ id: number; key: string }>(rotate)).data!;
    await expect(
      authenticateSaaSApiKey({ key: created.key, requiredScope: "studio.project.query" }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      authenticateSaaSApiKey({ key: rotated.key, requiredScope: "studio.project.query" }),
    ).resolves.toMatchObject({ id: rotated.id });

    const forbidden = await app.request("/api/saas/api-keys", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ tenantId: tenant.id, name: "Forbidden", scopes: ["saas.permission.manage"] }),
    });
    expect(forbidden.status).toBe(400);

    await recordSaaSApiKeyRequest({
      apiKeyId: rotated.id,
      tenantId: tenant.id,
      workspaceId: tenant.defaultWorkspaceId,
      requiredScope: "studio.project.query",
      method: "GET",
      path: "/api/studio/projects?token=must-not-be-logged",
      requestId: "f4-api-key-request",
      status: 200,
      success: true,
      ip: "203.0.113.42",
    });
    const requestLog = (await sqlite
      .prepare(
        `SELECT required_scope AS "requiredScope", method, path, request_id AS "requestId",
          status, success, ip_hash AS "ipHash"
         FROM saas_api_key_request_log WHERE api_key_id = ?`,
      )
      .get(rotated.id)) as {
      requiredScope: string;
      method: string;
      path: string;
      requestId: string;
      status: number;
      success: boolean;
      ipHash: string;
    };
    expect(requestLog).toMatchObject({
      requiredScope: "studio.project.query",
      method: "GET",
      path: "/api/studio/projects",
      requestId: "f4-api-key-request",
      status: 200,
      success: true,
    });
    expect(requestLog.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(requestLog)).not.toContain("203.0.113.42");
    expect(JSON.stringify(requestLog)).not.toContain("must-not-be-logged");
  });

  it("signs encrypted Webhook deliveries, pins public DNS, and rejects duplicate event mutations", async () => {
    const token = await login();
    const tenant = await createTenant(token, "f4-hook");
    const response = await app.request("/api/saas/webhooks", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        tenantId: tenant.id,
        workspaceId: tenant.defaultWorkspaceId,
        name: "Operations",
        url: "https://hooks.example.com/admin-base/audit-url-must-not-leak",
        eventTypes: ["studio.task.completed"],
        maxAttempts: 3,
      }),
    });
    expect(response.status).toBe(200);
    const endpoint = (await readJson<{ id: number; secret: string }>(response)).data!;
    const storedEndpoint = (await sqlite
      .prepare(
        `SELECT secret_encrypted AS "secretEncrypted", secret_prefix AS "secretPrefix"
         FROM saas_webhook_endpoint WHERE id = ?`,
      )
      .get(endpoint.id)) as { secretEncrypted: string; secretPrefix: string };
    expect(storedEndpoint.secretEncrypted).not.toContain(endpoint.secret);
    expect(decryptSecret(storedEndpoint.secretEncrypted)).toBe(endpoint.secret);

    const event = await enqueueSaaSWebhookEvent({
      tenantId: tenant.id,
      workspaceId: tenant.defaultWorkspaceId,
      eventType: "studio.task.completed",
      eventKey: "task-1-completed",
      payload: { taskId: 1, status: "completed" },
      resourceType: "studio_task",
      resourceId: 1,
      createdBy: 1,
    });
    const replay = await enqueueSaaSWebhookEvent({
      tenantId: tenant.id,
      workspaceId: tenant.defaultWorkspaceId,
      eventType: "studio.task.completed",
      eventKey: "task-1-completed",
      payload: { taskId: 1, status: "completed" },
      resourceType: "studio_task",
      resourceId: 1,
      createdBy: 1,
    });
    expect(replay).toEqual({ id: event.id, replayed: true });
    await expect(
      enqueueSaaSWebhookEvent({
        tenantId: tenant.id,
        workspaceId: tenant.defaultWorkspaceId,
        eventType: "studio.task.completed",
        eventKey: "task-1-completed",
        payload: { taskId: 2, status: "completed" },
      }),
    ).rejects.toMatchObject({ status: 409 });

    let captured: { headers: Record<string, string>; body: string; address: string } | null = null;
    const runtime: SaaSWebhookDeliveryRuntime = {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      post: async (_url, address, headers, body) => {
        captured = { headers, body, address: address.address };
        return {
          status: 204,
          bodyHash: "691f48ff76b1b21cc97bff7672ca5609270cff6c449871579ce4c54769b7a519",
        };
      },
    };
    await expect(
      processNextSaaSWebhookDelivery({ workerId: "f4-hook-worker", runtime }),
    ).resolves.toMatchObject({ status: "delivered" });
    const deliveredRequest = captured as unknown as {
      headers: Record<string, string>;
      body: string;
      address: string;
    };
    expect(deliveredRequest.address).toBe("8.8.8.8");
    expect(JSON.parse(deliveredRequest.body)).toEqual({ taskId: 1, status: "completed" });
    expect(
      verifySaaSWebhookSignature({
        secret: endpoint.secret,
        signature: deliveredRequest.headers["x-admin-base-signature"]!,
        timestamp: Number(deliveredRequest.headers["x-admin-base-timestamp"]),
        eventKey: "task-1-completed",
        body: deliveredRequest.body,
      }),
    ).toBe(true);
    const delivery = (await sqlite
      .prepare(
        `SELECT status, response_status AS "responseStatus",
          response_body_hash AS "responseBodyHash", error_message AS "errorMessage"
         FROM saas_webhook_delivery WHERE event_id = ?`,
      )
      .get(event.id)) as {
      status: string;
      responseStatus: number;
      responseBodyHash: string | null;
      errorMessage: string | null;
    };
    expect(delivery).toMatchObject({ status: "delivered", responseStatus: 204, errorMessage: null });
    expect(delivery?.responseBodyHash).toMatch(/^[a-f0-9]{64}$/);
    const webhookLogs = await sqlite
      .prepare("SELECT details_json AS \"detailsJson\" FROM sys_operation_log WHERE module = 'saas.webhook'")
      .all();
    expect(JSON.stringify(webhookLogs)).not.toContain("audit-url-must-not-leak");
  });

  it("enforces signed callback time windows and persistent replay protection", async () => {
    const token = await login();
    const tenant = await createTenant(token, "f4-replay");
    const body = JSON.stringify({ operationId: 12, status: "completed" });
    const eventKey = "provider-event-12";
    const secret = "callback-secret";
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createSaaSWebhookSignature({ secret, timestamp, eventKey, body });
    await expect(
      verifyAndClaimSaaSWebhookReplay({
        tenantId: tenant.id,
        workspaceId: tenant.defaultWorkspaceId,
        source: "video-provider",
        eventKey,
        body,
        timestamp,
        signature,
        secret,
      }),
    ).resolves.toMatchObject({ id: expect.any(Number) });
    await expect(
      verifyAndClaimSaaSWebhookReplay({
        tenantId: tenant.id,
        workspaceId: tenant.defaultWorkspaceId,
        source: "video-provider",
        eventKey,
        body,
        timestamp,
        signature,
        secret,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const replayFact = (await sqlite
      .prepare("SELECT expires_at AS \"expiresAt\" FROM saas_webhook_replay WHERE event_key = ?")
      .get(eventKey)) as { expiresAt: string };
    expect(new Date(replayFact.expiresAt).getTime()).toBeGreaterThanOrEqual((timestamp + 299) * 1000);
    const staleTimestamp = timestamp - 1000;
    const staleSignature = createSaaSWebhookSignature({ secret, timestamp: staleTimestamp, eventKey, body });
    expect(() =>
      verifySaaSWebhookSignature({
        secret,
        signature: staleSignature,
        timestamp: staleTimestamp,
        eventKey,
        body,
      }),
    ).toThrowError(/时间戳/);
    await expect(
      verifyAndClaimSaaSWebhookReplay({
        tenantId: tenant.id,
        workspaceId: tenant.defaultWorkspaceId,
        source: "video-provider",
        eventKey: "invalid\nevent-key",
        body,
        timestamp,
        signature: createSaaSWebhookSignature({
          secret,
          timestamp,
          eventKey: "invalid\nevent-key",
          body,
        }),
        secret,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("dead-letters failed Webhook delivery, sanitizes errors, and permits governed retry", async () => {
    const token = await login();
    const tenant = await createTenant(token, "f4-hook-fail");
    const endpointResponse = await app.request("/api/saas/webhooks", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        tenantId: tenant.id,
        name: "Failing endpoint",
        url: "https://hooks.example.com/failing",
        eventTypes: ["studio.task.failed"],
        maxAttempts: 1,
      }),
    });
    const endpoint = (await readJson<{ id: number }>(endpointResponse)).data!;
    const event = await enqueueSaaSWebhookEvent({
      tenantId: tenant.id,
      workspaceId: tenant.defaultWorkspaceId,
      eventType: "studio.task.failed",
      eventKey: "task-9-failed",
      payload: { taskId: 9, status: "failed" },
    });
    const result = await processNextSaaSWebhookDelivery({
      workerId: "f4-hook-fail-worker",
      runtime: {
        lookup: async () => [{ address: "8.8.8.8", family: 4 }],
        post: async () => {
          throw new Error("provider token=must-not-leak timeout");
        },
      },
    });
    expect(result).toMatchObject({ status: "dead_letter" });
    const failed = (await sqlite
      .prepare(
        `SELECT id, status, attempts, error_message AS "errorMessage", response_body_hash AS "responseBodyHash"
         FROM saas_webhook_delivery WHERE event_id = ? AND endpoint_id = ?`,
      )
      .get(event.id, endpoint.id)) as {
      id: number;
      status: string;
      attempts: number;
      errorMessage: string;
      responseBodyHash: string | null;
    };
    expect(failed).toMatchObject({
      status: "dead_letter",
      attempts: 1,
      responseBodyHash: null,
    });
    expect(failed.errorMessage).not.toContain("must-not-leak");

    const retry = await app.request(`/api/saas/webhook-deliveries/${failed.id}/retry`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ tenantId: tenant.id }),
    });
    expect(retry.status).toBe(200);
    expect(
      await sqlite
        .prepare("SELECT status, attempts, error_message AS \"errorMessage\" FROM saas_webhook_delivery WHERE id = ?")
        .get(failed.id),
    ).toMatchObject({ status: "queued", attempts: 0, errorMessage: null });
  });

  it("rejects cross-Tenant access to API Keys, Webhooks, deliveries, branding, and domains", async () => {
    const token = await login();
    const tenantA = await createTenant(token, "f4-cross-a");
    const tenantB = await createTenant(token, "f4-cross-b");
    const adminA = await createTenantAdmin({
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
      username: "f4_cross_tenant_admin_a",
    });
    const keyResponse = await app.request("/api/saas/api-keys", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        tenantId: tenantB.id,
        name: "Tenant B Key",
        scopes: ["studio.project.query"],
      }),
    });
    const key = (await readJson<{ id: number }>(keyResponse)).data!;
    const webhookResponse = await app.request("/api/saas/webhooks", {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({
        tenantId: tenantB.id,
        name: "Tenant B Webhook",
        url: "https://hooks.example.com/tenant-b",
        eventTypes: ["studio.task.completed"],
      }),
    });
    const webhook = (await readJson<{ id: number }>(webhookResponse)).data!;

    for (const path of [
      `/api/saas/branding?tenantId=${tenantB.id}`,
      `/api/saas/domains?tenantId=${tenantB.id}`,
      `/api/saas/notifications/outbox?tenantId=${tenantB.id}&page=1&pageSize=20`,
      `/api/saas/api-keys?tenantId=${tenantB.id}&page=1&pageSize=20`,
      `/api/saas/webhooks?tenantId=${tenantB.id}&page=1&pageSize=20`,
      `/api/saas/webhook-deliveries?tenantId=${tenantB.id}&page=1&pageSize=20`,
    ]) {
      const response = await app.request(path, { headers: jsonHeaders(adminA.token) });
      expect(response.status, path).toBe(404);
    }
    for (const [path, body] of [
      [`/api/saas/api-keys/${key.id}/revoke`, { tenantId: tenantB.id }],
      [`/api/saas/webhooks/${webhook.id}/revoke`, { tenantId: tenantB.id }],
    ] as const) {
      const response = await app.request(path, {
        method: "POST",
        headers: jsonHeaders(adminA.token),
        body: JSON.stringify(body),
      });
      expect(response.status, path).toBe(404);
    }
  });

  it("verifies Tenant domain ownership but safely falls back until certificate activation and blocks cross-Tenant control", async () => {
    const token = await login();
    const tenantA = await createTenant(token, "f4-domain-a");
    const tenantB = await createTenant(token, "f4-domain-b");
    const adminA = await createTenantAdmin({
      tenantId: tenantA.id,
      workspaceId: tenantA.defaultWorkspaceId,
      username: "f4_tenant_admin_a",
    });
    const crossTenant = await app.request(`/api/saas/branding?tenantId=${tenantB.id}`, {
      headers: jsonHeaders(adminA.token),
    });
    expect(crossTenant.status).toBe(404);

    const create = await app.request("/api/saas/domains", {
      method: "POST",
      headers: jsonHeaders(adminA.token),
      body: JSON.stringify({ tenantId: tenantA.id, hostname: "studio.example.com", isPrimary: true }),
    });
    expect(create.status).toBe(200);
    const domain = (await readJson<{
      id: number;
      verificationToken: string;
      verificationValue: string;
      challengeName: string;
    }>(create)).data!;
    const stored = await sqlite
      .prepare(
        `SELECT verification_token_hash AS "verificationTokenHash",
          verification_token_prefix AS "verificationTokenPrefix"
         FROM saas_tenant_domain WHERE id = ?`,
      )
      .get(domain.id);
    expect(JSON.stringify(stored)).not.toContain(domain.verificationToken);
    await expect(
      verifyTenantDomain({
        userId: adminA.userId,
        tenantId: tenantA.id,
        id: domain.id,
        resolveTxt: async (hostname) => {
          expect(hostname).toBe(domain.challengeName);
          return [[domain.verificationValue]];
        },
      }),
    ).resolves.toMatchObject({ status: "verified", certificateStatus: "pending" });
    expect(await getTenantPublicBaseUrl(tenantA.id)).toBe("http://localhost:3000");
    await sqlite
      .prepare("UPDATE saas_tenant_domain SET certificate_status = 'active' WHERE id = ?")
      .run(domain.id);
    expect(await getTenantPublicBaseUrl(tenantA.id)).toBe("https://studio.example.com");

    const revoke = await app.request(`/api/saas/domains/${domain.id}/revoke`, {
      method: "POST",
      headers: jsonHeaders(adminA.token),
      body: JSON.stringify({ tenantId: tenantA.id }),
    });
    expect(revoke.status).toBe(200);
    expect(await getTenantPublicBaseUrl(tenantA.id)).toBe("http://localhost:3000");
    const logs = (await sqlite
      .prepare(
        `SELECT action, risk_level AS "riskLevel", details_json AS "detailsJson"
         FROM sys_operation_log WHERE module IN ('saas.apiKey', 'saas.webhook', 'saas.domain')`,
      )
      .all()) as Array<{ action: string; riskLevel: string; detailsJson: string | null }>;
    expect(logs.some((log) => log.action === "revoke" && log.riskLevel === "high")).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(domain.verificationToken);
  });

  it("rejects Webhook URLs that can target local infrastructure", async () => {
    const token = await login();
    const tenant = await createTenant(token, "f4-ssrf");
    for (const url of [
      "http://hooks.example.com/event",
      "https://localhost/event",
      "https://127.0.0.1/event",
      "https://hooks.example.com/event?token=must-not-be-stored",
    ]) {
      const response = await app.request("/api/saas/webhooks", {
        method: "POST",
        headers: jsonHeaders(token),
        body: JSON.stringify({
          tenantId: tenant.id,
          name: "Unsafe",
          url,
          eventTypes: ["studio.task.completed"],
        }),
      });
      expect(response.status).toBe(400);
    }
  });
});
