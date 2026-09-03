import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { HTTPException } from "hono/http-exception";
import { sqlite } from "@/server/db";
import { isPublicIpAddress } from "./ai-website-source-service";
import { assertTenantAccess } from "./saas-control-plane-service";
import { decryptSecret, encryptSecret } from "./secret";

type ResolvedAddress = { address: string; family: number };

export type SaaSWebhookDeliveryRuntime = {
  lookup: (hostname: string) => Promise<ResolvedAddress[]>;
  post: (
    url: URL,
    address: ResolvedAddress,
    headers: Record<string, string>,
    body: string,
    timeoutMs: number,
  ) => Promise<{ status: number; bodyHash: string }>;
};

type WebhookEndpointValues = {
  workspaceId?: number | null;
  name: string;
  url: string;
  eventTypes: string[];
  status?: "active" | "disabled";
  timeoutMs?: number;
  maxAttempts?: number;
};

function sha256(value: string | Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sanitizeWebhookError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/(token|secret|password|authorization|cookie)=[^\s&]+/gi, "$1=[REDACTED]").slice(0, 1000);
}

function normalizeEventTypes(values: string[]) {
  const eventTypes = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (!eventTypes.length || eventTypes.length > 100) {
    throw new HTTPException(400, { message: "Webhook 必须订阅 1 到 100 个事件类型" });
  }
  for (const eventType of eventTypes) {
    if (!/^[a-z][a-z0-9._-]{1,119}$/.test(eventType)) {
      throw new HTTPException(400, { message: `Webhook 事件类型不合法：${eventType}` });
    }
  }
  return eventTypes;
}

export function validateSaaSWebhookUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new HTTPException(400, { message: "请输入有效的 Webhook URL" });
  }
  if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
    throw new HTTPException(400, { message: "Webhook 仅允许 HTTPS 标准端口" });
  }
  if (url.username || url.password) {
    throw new HTTPException(400, { message: "Webhook URL 不能包含账号或密码" });
  }
  for (const key of url.searchParams.keys()) {
    if (/(?:token|secret|api[-_]?key|signature|password|authorization|credential)/i.test(key)) {
      throw new HTTPException(400, { message: "Webhook URL 不能在查询参数中携带敏感凭据" });
    }
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (net.isIP(hostname) && !isPublicIpAddress(hostname))
  ) {
    throw new HTTPException(400, { message: "Webhook URL 不能指向本机、内网或保留地址" });
  }
  url.hash = "";
  return url.toString();
}

async function assertWebhookWorkspace(tenantId: number, workspaceId?: number | null) {
  const tenant = await sqlite
    .prepare("SELECT id FROM saas_tenant WHERE id = ? AND status = 'active' AND deleted_at IS NULL")
    .get(tenantId);
  if (!tenant) throw new HTTPException(404, { message: "Webhook Tenant 不存在或不可用" });
  if (!workspaceId) return;
  const workspace = await sqlite
    .prepare(
      `SELECT id FROM saas_workspace
       WHERE id = ? AND tenant_id = ? AND status = 'active' AND deleted_at IS NULL`,
    )
    .get(workspaceId, tenantId);
  if (!workspace) throw new HTTPException(404, { message: "Webhook Workspace 不存在" });
}

function newWebhookSecret() {
  const secret = `sabs_${crypto.randomBytes(32).toString("base64url")}`;
  return { secret, prefix: secret.slice(0, 13), encrypted: encryptSecret(secret)! };
}

export async function createSaaSWebhookEndpoint(input: {
  userId: number;
  tenantId: number;
} & WebhookEndpointValues) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId, roles: ["owner", "admin"] });
  await assertWebhookWorkspace(input.tenantId, input.workspaceId);
  const eventTypes = normalizeEventTypes(input.eventTypes);
  const secret = newWebhookSecret();
  const result = await sqlite
    .prepare(
      `INSERT INTO saas_webhook_endpoint
        (tenant_id, workspace_id, name, url, event_types_json, secret_encrypted,
         secret_prefix, status, timeout_ms, max_attempts, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      input.tenantId,
      input.workspaceId ?? null,
      input.name.trim(),
      validateSaaSWebhookUrl(input.url),
      JSON.stringify(eventTypes),
      secret.encrypted,
      secret.prefix,
      input.status ?? "active",
      Math.max(1000, Math.min(input.timeoutMs ?? 10_000, 30_000)),
      Math.max(1, Math.min(input.maxAttempts ?? 5, 20)),
      input.userId,
      input.userId,
    );
  return { id: Number(result.lastInsertRowid), secret: secret.secret, secretPrefix: secret.prefix };
}

export async function listSaaSWebhookEndpoints(input: {
  userId: number;
  tenantId: number;
  page: number;
  pageSize: number;
  status?: "active" | "disabled" | "revoked";
}) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId, roles: ["owner", "admin"] });
  const where = ["tenant_id = ?", "deleted_at IS NULL"];
  const params: Array<number | string> = [input.tenantId];
  if (input.status) {
    where.push("status = ?");
    params.push(input.status);
  }
  const whereSql = where.join(" AND ");
  const total = (await sqlite.prepare(`SELECT COUNT(*)::int AS total FROM saas_webhook_endpoint WHERE ${whereSql}`).get(...params)) as { total: number };
  const rows = (await sqlite
    .prepare(
      `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId", name, url,
        event_types_json AS "eventTypesJson", secret_prefix AS "secretPrefix",
        secret_version AS "secretVersion", status, timeout_ms AS "timeoutMs",
        max_attempts AS "maxAttempts", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM saas_webhook_endpoint WHERE ${whereSql}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, (input.page - 1) * input.pageSize)) as Array<Record<string, unknown> & { eventTypesJson: string }>;
  return {
    data: rows.map(({ eventTypesJson, ...row }) => ({ ...row, eventTypes: JSON.parse(eventTypesJson) })),
    total: Number(total.total),
    page: input.page,
    pageSize: input.pageSize,
  };
}

async function getManagedEndpoint(input: { userId: number; tenantId: number; id: number }) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId, roles: ["owner", "admin"] });
  const endpoint = await sqlite
    .prepare(
      `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId", status
       FROM saas_webhook_endpoint
       WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    )
    .get(input.id, input.tenantId);
  if (!endpoint) throw new HTTPException(404, { message: "Webhook Endpoint 不存在" });
  return endpoint as { id: number; tenantId: number; workspaceId: number | null; status: string };
}

export async function updateSaaSWebhookEndpoint(input: {
  userId: number;
  tenantId: number;
  id: number;
} & WebhookEndpointValues) {
  const current = await getManagedEndpoint(input);
  if (current.status === "revoked") throw new HTTPException(409, { message: "已撤销 Webhook 不能编辑" });
  await assertWebhookWorkspace(input.tenantId, input.workspaceId);
  await sqlite
    .prepare(
      `UPDATE saas_webhook_endpoint SET workspace_id = ?, name = ?, url = ?,
        event_types_json = ?, status = ?, timeout_ms = ?, max_attempts = ?,
        updated_by = ?, updated_at = now()
       WHERE id = ? AND tenant_id = ?`,
    )
    .run(
      input.workspaceId ?? null,
      input.name.trim(),
      validateSaaSWebhookUrl(input.url),
      JSON.stringify(normalizeEventTypes(input.eventTypes)),
      input.status ?? "active",
      Math.max(1000, Math.min(input.timeoutMs ?? 10_000, 30_000)),
      Math.max(1, Math.min(input.maxAttempts ?? 5, 20)),
      input.userId,
      input.id,
      input.tenantId,
    );
  return { id: input.id };
}

export async function rotateSaaSWebhookSecret(input: { userId: number; tenantId: number; id: number }) {
  const current = await getManagedEndpoint(input);
  if (current.status === "revoked") throw new HTTPException(409, { message: "已撤销 Webhook 不能轮换密钥" });
  const secret = newWebhookSecret();
  await sqlite
    .prepare(
      `UPDATE saas_webhook_endpoint SET secret_encrypted = ?, secret_prefix = ?,
        secret_version = secret_version + 1, updated_by = ?, updated_at = now()
       WHERE id = ? AND tenant_id = ?`,
    )
    .run(secret.encrypted, secret.prefix, input.userId, input.id, input.tenantId);
  return { id: input.id, secret: secret.secret, secretPrefix: secret.prefix };
}

export async function revokeSaaSWebhookEndpoint(input: { userId: number; tenantId: number; id: number }) {
  const endpoint = await getManagedEndpoint(input);
  if (endpoint.status === "revoked") return { id: endpoint.id, replayed: true };
  await sqlite.transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE saas_webhook_endpoint SET status = 'revoked', updated_by = ?, updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(input.userId, input.id, input.tenantId);
    await tx
      .prepare(
        `UPDATE saas_webhook_delivery SET status = 'cancelled', locked_by = NULL,
          lease_until = NULL, error_message = 'Webhook Endpoint 已撤销', updated_at = now()
         WHERE endpoint_id = ? AND status IN ('queued', 'retry')`,
      )
      .run(input.id);
  });
  return { id: input.id, replayed: false };
}

export async function enqueueSaaSWebhookEvent(input: {
  tenantId: number;
  workspaceId?: number | null;
  eventType: string;
  eventKey: string;
  payload: Record<string, unknown>;
  resourceType?: string | null;
  resourceId?: string | number | null;
  requestId?: string | null;
  createdBy?: number | null;
}) {
  await assertWebhookWorkspace(input.tenantId, input.workspaceId);
  const eventType = normalizeEventTypes([input.eventType])[0]!;
  const eventKey = input.eventKey.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(eventKey)) {
    throw new HTTPException(400, { message: "Webhook eventKey 不合法" });
  }
  const payloadJson = JSON.stringify(input.payload);
  if (Buffer.byteLength(payloadJson, "utf8") > 256 * 1024) {
    throw new HTTPException(413, { message: "Webhook payload 超过 256 KiB" });
  }
  const payloadHash = sha256(payloadJson);
  const resourceType = input.resourceType?.trim() || null;
  const resourceId = input.resourceId == null ? null : String(input.resourceId).trim() || null;
  if (Boolean(resourceType) !== Boolean(resourceId)) {
    throw new HTTPException(400, { message: "Webhook resourceType 与 resourceId 必须同时提供" });
  }
  return sqlite.transaction(async (tx) => {
    const inserted = await tx
      .prepare(
        `INSERT INTO saas_webhook_event
          (tenant_id, workspace_id, event_type, event_key, payload_hash, payload_encrypted,
           resource_type, resource_id, request_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, event_type, event_key) DO NOTHING RETURNING id`,
      )
      .run(
        input.tenantId,
        input.workspaceId ?? null,
        eventType,
        eventKey,
        payloadHash,
        encryptSecret(payloadJson),
        resourceType,
        resourceId,
        input.requestId ?? null,
        input.createdBy ?? null,
      );
    let eventId = Number(inserted.lastInsertRowid || 0);
    let replayed = false;
    if (!eventId) {
      replayed = true;
      const existing = (await tx
        .prepare(
          `SELECT id, payload_hash AS "payloadHash", workspace_id AS "workspaceId"
           FROM saas_webhook_event WHERE tenant_id = ? AND event_type = ? AND event_key = ?`,
        )
        .get(input.tenantId, eventType, eventKey)) as { id: number; payloadHash: string; workspaceId: number | null };
      if (existing.payloadHash !== payloadHash || existing.workspaceId !== (input.workspaceId ?? null)) {
        throw new HTTPException(409, { message: "Webhook eventKey 已用于其他事件" });
      }
      eventId = existing.id;
    }
    if (!replayed) {
      const endpoints = (await tx
        .prepare(
          `SELECT id, workspace_id AS "workspaceId", event_types_json AS "eventTypesJson", max_attempts AS "maxAttempts"
           FROM saas_webhook_endpoint
           WHERE tenant_id = ? AND status = 'active' AND deleted_at IS NULL`,
        )
        .all(input.tenantId)) as Array<{ id: number; workspaceId: number | null; eventTypesJson: string; maxAttempts: number }>;
      for (const endpoint of endpoints) {
        if (endpoint.workspaceId && endpoint.workspaceId !== (input.workspaceId ?? null)) continue;
        const eventTypes = JSON.parse(endpoint.eventTypesJson) as string[];
        if (!eventTypes.includes(eventType)) continue;
        await tx
          .prepare(
            `INSERT INTO saas_webhook_delivery
              (event_id, endpoint_id, tenant_id, workspace_id, max_attempts)
             VALUES (?, ?, ?, ?, ?) ON CONFLICT (event_id, endpoint_id) DO NOTHING`,
          )
          .run(eventId, endpoint.id, input.tenantId, input.workspaceId ?? null, endpoint.maxAttempts);
      }
    }
    return { id: eventId, replayed };
  });
}

export function createSaaSWebhookSignature(input: {
  secret: string;
  timestamp: number;
  eventKey: string;
  body: string;
}) {
  const digest = crypto
    .createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.eventKey}.${input.body}`)
    .digest("hex");
  return `t=${input.timestamp},v1=${digest}`;
}

export function verifySaaSWebhookSignature(input: {
  secret: string;
  signature: string;
  timestamp: number;
  eventKey: string;
  body: string;
  toleranceSeconds?: number;
  now?: number;
}) {
  const tolerance = Math.max(30, Math.min(input.toleranceSeconds ?? 300, 900));
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (!Number.isInteger(input.timestamp) || Math.abs(nowSeconds - input.timestamp) > tolerance) {
    throw new HTTPException(401, { message: "Webhook 时间戳超出允许窗口" });
  }
  const expected = createSaaSWebhookSignature(input).split("v1=")[1]!;
  const versions = input.signature.split(",").map((item) => item.trim());
  const timestampHeader = versions.find((item) => item.startsWith("t="))?.slice(2);
  const provided = versions.find((item) => item.startsWith("v1="))?.slice(3);
  if (timestampHeader !== String(input.timestamp) || !provided || provided.length !== expected.length) {
    throw new HTTPException(401, { message: "Webhook 签名无效" });
  }
  if (!crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    throw new HTTPException(401, { message: "Webhook 签名无效" });
  }
  return true;
}

export async function verifyAndClaimSaaSWebhookReplay(input: {
  tenantId: number;
  workspaceId: number;
  source: string;
  eventKey: string;
  body: string;
  timestamp: number;
  signature: string;
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}) {
  verifySaaSWebhookSignature(input);
  await assertWebhookWorkspace(input.tenantId, input.workspaceId);
  const source = input.source.trim();
  if (!/^[a-z][a-z0-9._-]{1,119}$/.test(source)) {
    throw new HTTPException(400, { message: "Webhook source 不合法" });
  }
  const eventKey = input.eventKey.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(eventKey)) {
    throw new HTTPException(400, { message: "Webhook eventKey 不合法" });
  }
  const tolerance = Math.max(30, Math.min(input.toleranceSeconds ?? 300, 900));
  return sqlite.transaction(async (tx) => {
    await tx.prepare("DELETE FROM saas_webhook_replay WHERE expires_at <= now()").run();
    const inserted = await tx
      .prepare(
        `INSERT INTO saas_webhook_replay
          (tenant_id, workspace_id, source, event_key, payload_hash, event_timestamp, expires_at)
         VALUES (?, ?, ?, ?, ?, to_timestamp(?), to_timestamp(?) + (? * interval '1 second'))
         ON CONFLICT (tenant_id, workspace_id, source, event_key) DO NOTHING RETURNING id`,
      )
      .run(
        input.tenantId,
        input.workspaceId,
        source,
        eventKey,
        sha256(input.body),
        input.timestamp,
        input.timestamp,
        tolerance,
      );
    if (!inserted.lastInsertRowid) {
      throw new HTTPException(409, { message: "Webhook 事件已处理，拒绝重放" });
    }
    return { id: Number(inserted.lastInsertRowid) };
  });
}

function postPinned(
  url: URL,
  address: ResolvedAddress,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
) {
  return new Promise<{ status: number; bodyHash: string }>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      },
      (response) => {
        const responseHash = crypto.createHash("sha256");
        response.on("data", (chunk: Buffer) => {
          responseHash.update(chunk);
        });
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, bodyHash: responseHash.digest("hex") }),
        );
        response.on("error", reject);
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error("Webhook 请求超时")));
    request.on("error", reject);
    request.end(body);
  });
}

export const defaultSaaSWebhookDeliveryRuntime: SaaSWebhookDeliveryRuntime = {
  lookup: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  post: postPinned,
};

export async function claimNextSaaSWebhookDelivery(input: { workerId: string; leaseSeconds?: number }) {
  const leaseSeconds = Math.max(30, Math.min(input.leaseSeconds ?? 120, 900));
  return sqlite.transaction(async (tx) => {
    const candidate = (await tx
      .prepare(
        `SELECT id FROM saas_webhook_delivery
         WHERE ((status IN ('queued', 'retry') AND available_at <= now()) OR
                (status = 'running' AND lease_until <= now()))
           AND attempts < max_attempts
         ORDER BY id ASC FOR UPDATE SKIP LOCKED LIMIT 1`,
      )
      .get()) as { id: number } | undefined;
    if (!candidate) return null;
    return tx
      .prepare(
        `UPDATE saas_webhook_delivery SET status = 'running', attempts = attempts + 1,
          locked_by = ?, lease_until = now() + (? * interval '1 second'), updated_at = now()
         WHERE id = ?
         RETURNING id, event_id AS "eventId", endpoint_id AS "endpointId",
          tenant_id AS "tenantId", workspace_id AS "workspaceId", attempts,
          max_attempts AS "maxAttempts"`,
      )
      .get(input.workerId, leaseSeconds, candidate.id) as Promise<{
        id: number;
        eventId: number;
        endpointId: number;
        tenantId: number;
        workspaceId: number | null;
        attempts: number;
        maxAttempts: number;
      }>;
  });
}

export async function processNextSaaSWebhookDelivery(input: {
  workerId: string;
  runtime?: SaaSWebhookDeliveryRuntime;
}) {
  const delivery = await claimNextSaaSWebhookDelivery({ workerId: input.workerId });
  if (!delivery) return null;
  try {
    const row = (await sqlite
      .prepare(
        `SELECT endpoint.url, endpoint.secret_encrypted AS "secretEncrypted",
          endpoint.status AS "endpointStatus", endpoint.timeout_ms AS "timeoutMs",
          event.event_type AS "eventType", event.event_key AS "eventKey",
          event.payload_encrypted AS "payloadEncrypted", event.request_id AS "requestId",
          tenant.status AS "tenantStatus", workspace.status AS "workspaceStatus"
         FROM saas_webhook_delivery delivery
         INNER JOIN saas_webhook_endpoint endpoint ON endpoint.id = delivery.endpoint_id
         INNER JOIN saas_webhook_event event ON event.id = delivery.event_id
         INNER JOIN saas_tenant tenant ON tenant.id = delivery.tenant_id
         LEFT JOIN saas_workspace workspace ON workspace.id = delivery.workspace_id
         WHERE delivery.id = ?`,
      )
      .get(delivery.id)) as
      | {
          url: string;
          secretEncrypted: string;
          endpointStatus: string;
          timeoutMs: number;
          eventType: string;
          eventKey: string;
          payloadEncrypted: string;
          requestId: string | null;
          tenantStatus: string;
          workspaceStatus: string | null;
        }
      | undefined;
    if (!row || row.endpointStatus !== "active" || row.tenantStatus !== "active" || (delivery.workspaceId && row.workspaceStatus !== "active")) {
      throw new HTTPException(409, { message: "Webhook Scope 或 Endpoint 已失效" });
    }
    const body = decryptSecret(row.payloadEncrypted);
    const secret = decryptSecret(row.secretEncrypted);
    if (!body || !secret) throw new Error("Webhook payload 或密钥无法解密");
    const url = new URL(validateSaaSWebhookUrl(row.url));
    const runtime = input.runtime ?? defaultSaaSWebhookDeliveryRuntime;
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await runtime.lookup(hostname);
    if (!addresses.length || addresses.some((item) => !isPublicIpAddress(item.address))) {
      throw new Error("Webhook DNS 解析到内网、保留地址或空结果");
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await runtime.post(
      url,
      addresses[0]!,
      {
        "content-type": "application/json",
        "user-agent": "AdminBase-SaaS-Webhook/1.0",
        "x-admin-base-event-type": row.eventType,
        "x-admin-base-event-id": row.eventKey,
        "x-admin-base-delivery-id": String(delivery.id),
        "x-admin-base-timestamp": String(timestamp),
        "x-admin-base-signature": createSaaSWebhookSignature({ secret, timestamp, eventKey: row.eventKey, body }),
        ...(row.requestId ? { "x-request-id": row.requestId } : {}),
      },
      body,
      row.timeoutMs,
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Webhook 返回 HTTP ${response.status}`);
    }
    const updated = await sqlite
      .prepare(
        `UPDATE saas_webhook_delivery SET status = 'delivered', response_status = ?,
          response_body_hash = ?, error_message = NULL, delivered_at = now(),
          locked_by = NULL, lease_until = NULL, updated_at = now()
         WHERE id = ? AND status = 'running' AND locked_by = ? RETURNING id`,
      )
      .get(response.status, response.bodyHash, delivery.id, input.workerId);
    if (!updated) throw new Error("Webhook Delivery 租约已经失效");
    return { id: delivery.id, status: "delivered" as const };
  } catch (error) {
    const scopeInvalid = error instanceof HTTPException;
    const terminal = scopeInvalid || delivery.attempts >= delivery.maxAttempts;
    const delaySeconds = Math.min(900, 5 * 3 ** Math.max(0, delivery.attempts - 1));
    await sqlite
      .prepare(
        `UPDATE saas_webhook_delivery SET status = ?, error_message = ?,
          available_at = CASE WHEN ? THEN available_at ELSE now() + (? * interval '1 second') END,
          locked_by = NULL, lease_until = NULL, updated_at = now()
         WHERE id = ? AND status = 'running' AND locked_by = ?`,
      )
      .run(
        terminal ? (scopeInvalid ? "cancelled" : "dead_letter") : "retry",
        sanitizeWebhookError(error),
        terminal,
        delaySeconds,
        delivery.id,
        input.workerId,
      );
    return {
      id: delivery.id,
      status: terminal ? (scopeInvalid ? ("cancelled" as const) : ("dead_letter" as const)) : ("retry" as const),
    };
  }
}

export async function listSaaSWebhookDeliveries(input: {
  userId: number;
  tenantId: number;
  page: number;
  pageSize: number;
  status?: string;
  endpointId?: number;
}) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId, roles: ["owner", "admin"] });
  const where = ["delivery.tenant_id = ?"];
  const params: Array<number | string> = [input.tenantId];
  if (input.status) {
    where.push("delivery.status = ?");
    params.push(input.status);
  }
  if (input.endpointId) {
    where.push("delivery.endpoint_id = ?");
    params.push(input.endpointId);
  }
  const whereSql = where.join(" AND ");
  const total = (await sqlite
    .prepare(`SELECT COUNT(*)::int AS total FROM saas_webhook_delivery delivery WHERE ${whereSql}`)
    .get(...params)) as { total: number };
  const data = await sqlite
    .prepare(
      `SELECT delivery.id, delivery.event_id AS "eventId", delivery.endpoint_id AS "endpointId",
        delivery.workspace_id AS "workspaceId", delivery.status, delivery.attempts,
        delivery.max_attempts AS "maxAttempts", delivery.available_at AS "availableAt",
        delivery.response_status AS "responseStatus", delivery.response_body_hash AS "responseBodyHash",
        delivery.error_message AS "errorMessage", delivery.delivered_at AS "deliveredAt",
        event.event_type AS "eventType", event.event_key AS "eventKey",
        delivery.created_at AS "createdAt", delivery.updated_at AS "updatedAt"
       FROM saas_webhook_delivery delivery
       INNER JOIN saas_webhook_event event ON event.id = delivery.event_id
       WHERE ${whereSql} ORDER BY delivery.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, (input.page - 1) * input.pageSize);
  return { data, total: Number(total.total), page: input.page, pageSize: input.pageSize };
}

export async function retrySaaSWebhookDelivery(input: { userId: number; tenantId: number; id: number }) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId, roles: ["owner", "admin"] });
  const updated = await sqlite
    .prepare(
      `UPDATE saas_webhook_delivery delivery SET status = 'queued', attempts = 0,
        available_at = now(), locked_by = NULL, lease_until = NULL, error_message = NULL,
        response_status = NULL, response_body_hash = NULL, updated_at = now()
       FROM saas_webhook_endpoint endpoint
       WHERE delivery.id = ? AND delivery.tenant_id = ? AND delivery.status = 'dead_letter'
         AND endpoint.id = delivery.endpoint_id AND endpoint.status = 'active'
       RETURNING delivery.id`,
    )
    .get(input.id, input.tenantId);
  if (!updated) throw new HTTPException(409, { message: "只有 active Endpoint 的死信投递可以人工重试" });
  return { id: input.id };
}
