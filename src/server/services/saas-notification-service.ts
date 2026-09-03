import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { sqlite, type DbClient } from "@/server/db";
import { decryptSecret, encryptSecret } from "./secret";
import { sendMail } from "./mail-service";
import { assertTenantAccess } from "./saas-control-plane-service";
import { getEffectiveTenantBranding, getTenantPublicBaseUrl } from "./saas-branding-service";

type NotificationStatus =
  | "queued"
  | "running"
  | "retry"
  | "delivered"
  | "dead_letter"
  | "cancelled";

type ClaimedNotification = {
  id: number;
  tenantId: number;
  workspaceId: number | null;
  templateCode: string;
  recipient: string;
  payloadEncrypted: string;
  resourceType: string | null;
  resourceId: string | null;
  attempts: number;
  maxAttempts: number;
  requestId: string | null;
  createdBy: number | null;
};

class InvalidNotificationFactError extends Error {}

export type SaaSNotificationSender = (input: {
  to: string;
  subject: string;
  text: string;
}) => Promise<{ messageId?: string | null } | void>;

function sanitizeDeliveryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replaceAll(/(token|secret|password|authorization|cookie)=[^\s&]+/gi, "$1=[REDACTED]").slice(0, 1000);
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseEncryptedPayload(value: string) {
  const decrypted = decryptSecret(value);
  if (!decrypted) throw new Error("通知 Outbox payload 无法解密");
  return JSON.parse(decrypted) as Record<string, unknown>;
}

export async function enqueueSaaSEmailNotification(
  input: {
    tenantId: number;
    workspaceId?: number | null;
    templateCode: string;
    recipient: string;
    payload: Record<string, unknown>;
    resourceType?: string | null;
    resourceId?: string | number | null;
    idempotencyKey: string;
    requestId?: string | null;
    createdBy?: number | null;
    priority?: number;
    maxAttempts?: number;
  },
  dbClient: DbClient = sqlite,
) {
  const scope = await dbClient
    .prepare(
      `SELECT tenant.id, tenant.status AS "tenantStatus", workspace.status AS "workspaceStatus"
       FROM saas_tenant tenant
       LEFT JOIN saas_workspace workspace
         ON workspace.id = ? AND workspace.tenant_id = tenant.id AND workspace.deleted_at IS NULL
       WHERE tenant.id = ? AND tenant.deleted_at IS NULL`,
    )
    .get(input.workspaceId ?? null, input.tenantId) as
    | { id: number; tenantStatus: string; workspaceStatus: string | null }
    | undefined;
  if (!scope || scope.tenantStatus !== "active") {
    throw new HTTPException(404, { message: "通知 Tenant 不存在或不可用" });
  }
  if (input.workspaceId && scope.workspaceStatus !== "active") {
    throw new HTTPException(404, { message: "通知 Workspace 不存在或不可用" });
  }
  const payloadJson = JSON.stringify(input.payload);
  if (Buffer.byteLength(payloadJson, "utf8") > 64 * 1024) {
    throw new HTTPException(413, { message: "通知 payload 超过 64 KiB" });
  }
  const resourceType = input.resourceType?.trim() || null;
  const resourceId = input.resourceId == null ? null : String(input.resourceId).trim() || null;
  if (Boolean(resourceType) !== Boolean(resourceId)) {
    throw new HTTPException(400, { message: "通知 resourceType 与 resourceId 必须同时提供" });
  }
  const result = await dbClient
    .prepare(
      `INSERT INTO saas_notification_outbox
        (tenant_id, workspace_id, channel, template_code, recipient, payload_encrypted,
         resource_type, resource_id, idempotency_key, request_id, created_by, priority, max_attempts)
       VALUES (?, ?, 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, channel, idempotency_key) DO NOTHING
       RETURNING id`,
    )
    .run(
      input.tenantId,
      input.workspaceId ?? null,
      input.templateCode.trim(),
      input.recipient.trim().toLowerCase(),
      encryptSecret(payloadJson),
      resourceType,
      resourceId,
      input.idempotencyKey.trim(),
      input.requestId ?? null,
      input.createdBy ?? null,
      Math.max(0, Math.min(input.priority ?? 100, 1000)),
      Math.max(1, Math.min(input.maxAttempts ?? 5, 20)),
    );
  let id = Number(result.lastInsertRowid || 0);
  let replayed = false;
  if (!id) {
    replayed = true;
    const existing = (await dbClient
      .prepare(
        `SELECT id, template_code AS "templateCode", recipient, resource_type AS "resourceType",
          resource_id AS "resourceId", payload_encrypted AS "payloadEncrypted"
         FROM saas_notification_outbox
         WHERE tenant_id = ? AND channel = 'email' AND idempotency_key = ?`,
      )
      .get(input.tenantId, input.idempotencyKey.trim())) as
      | {
          id: number;
          templateCode: string;
          recipient: string;
          resourceType: string | null;
          resourceId: string | null;
          payloadEncrypted: string;
        }
      | undefined;
    if (
      !existing ||
      existing.templateCode !== input.templateCode.trim() ||
      existing.recipient !== input.recipient.trim().toLowerCase() ||
      existing.resourceType !== resourceType ||
      existing.resourceId !== resourceId ||
      sha256(decryptSecret(existing.payloadEncrypted) ?? "") !== sha256(payloadJson)
    ) {
      throw new HTTPException(409, { message: "通知 idempotencyKey 已用于其他消息" });
    }
    id = existing.id;
  }
  return { id, replayed };
}

export async function enqueueSaaSInvitationEmail(
  input: {
    invitationId: number;
    tenantId: number;
    workspaceId?: number | null;
    recipient: string;
    token: string;
    expiresAt: string;
    createdBy: number;
    requestId?: string | null;
  },
  dbClient: DbClient = sqlite,
) {
  return enqueueSaaSEmailNotification(
    {
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      templateCode: "saas.invitation",
      recipient: input.recipient,
      payload: {
        invitationId: input.invitationId,
        token: input.token,
        expiresAt: input.expiresAt,
      },
      resourceType: "saas_invitation",
      resourceId: input.invitationId,
      idempotencyKey: `invitation:${input.invitationId}`,
      requestId: input.requestId,
      createdBy: input.createdBy,
      priority: 20,
      maxAttempts: 5,
    },
    dbClient,
  );
}

export async function listSaaSNotificationOutbox(input: {
  userId: number;
  tenantId: number;
  page: number;
  pageSize: number;
  status?: NotificationStatus;
}) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId, roles: ["owner", "admin"] });
  const where = ["tenant_id = ?"];
  const params: Array<string | number> = [input.tenantId];
  if (input.status) {
    where.push("status = ?");
    params.push(input.status);
  }
  const whereSql = where.join(" AND ");
  const total = (await sqlite
    .prepare(`SELECT COUNT(*)::int AS total FROM saas_notification_outbox WHERE ${whereSql}`)
    .get(...params)) as { total: number };
  const data = await sqlite
    .prepare(
      `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId", channel,
        template_code AS "templateCode", recipient, resource_type AS "resourceType",
        resource_id AS "resourceId", status, attempts, max_attempts AS "maxAttempts",
        available_at AS "availableAt", delivered_at AS "deliveredAt",
        error_message AS "errorMessage", request_id AS "requestId", created_at AS "createdAt"
       FROM saas_notification_outbox WHERE ${whereSql}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, (input.page - 1) * input.pageSize);
  return { data, total: Number(total.total), page: input.page, pageSize: input.pageSize };
}

export async function retrySaaSNotification(input: { userId: number; tenantId: number; id: number }) {
  await assertTenantAccess({ userId: input.userId, tenantId: input.tenantId, roles: ["owner", "admin"] });
  const updated = await sqlite
    .prepare(
      `UPDATE saas_notification_outbox SET status = 'queued', attempts = 0, available_at = now(),
        locked_by = NULL, lease_until = NULL, error_message = NULL, updated_at = now()
       WHERE id = ? AND tenant_id = ? AND status = 'dead_letter' RETURNING id`,
    )
    .get(input.id, input.tenantId);
  if (!updated) throw new HTTPException(409, { message: "只有死信通知可以人工重试" });
  return { id: input.id };
}

export async function claimNextSaaSNotification(input: { workerId: string; leaseSeconds?: number }) {
  const leaseSeconds = Math.max(30, Math.min(input.leaseSeconds ?? 120, 900));
  return sqlite.transaction(async (tx) => {
    const candidate = (await tx
      .prepare(
        `SELECT id FROM saas_notification_outbox
         WHERE ((status IN ('queued', 'retry') AND available_at <= now()) OR
                (status = 'running' AND lease_until <= now()))
           AND attempts < max_attempts
         ORDER BY priority ASC, id ASC FOR UPDATE SKIP LOCKED LIMIT 1`,
      )
      .get()) as { id: number } | undefined;
    if (!candidate) return null;
    return (await tx
      .prepare(
        `UPDATE saas_notification_outbox SET status = 'running', attempts = attempts + 1,
          locked_by = ?, lease_until = now() + (? * interval '1 second'),
          last_attempt_at = now(), updated_at = now()
         WHERE id = ?
         RETURNING id, tenant_id AS "tenantId", workspace_id AS "workspaceId",
          template_code AS "templateCode", recipient, payload_encrypted AS "payloadEncrypted",
          resource_type AS "resourceType", resource_id AS "resourceId", attempts,
          max_attempts AS "maxAttempts", request_id AS "requestId", created_by AS "createdBy"`,
      )
      .get(input.workerId, leaseSeconds, candidate.id)) as ClaimedNotification;
  });
}

async function renderNotification(notification: ClaimedNotification) {
  if (notification.templateCode !== "saas.invitation") {
    throw new Error(`不支持的通知模板：${notification.templateCode}`);
  }
  const payload = parseEncryptedPayload(notification.payloadEncrypted);
  const invitationId = Number(payload.invitationId);
  const token = String(payload.token ?? "");
  const invitation = (await sqlite
    .prepare(
      `SELECT invitation.id, invitation.email, invitation.status,
        invitation.expires_at AS "expiresAt", invitation.token_hash AS "tokenHash",
        tenant.status AS "tenantStatus", workspace.status AS "workspaceStatus"
       FROM saas_invitation invitation
       INNER JOIN saas_tenant tenant ON tenant.id = invitation.tenant_id AND tenant.deleted_at IS NULL
       LEFT JOIN saas_workspace workspace
         ON workspace.id = invitation.workspace_id AND workspace.deleted_at IS NULL
       WHERE invitation.id = ? AND invitation.tenant_id = ?
         AND invitation.status = 'pending' AND invitation.expires_at > now()`,
    )
    .get(invitationId, notification.tenantId)) as
    | {
        id: number;
        email: string;
        status: string;
        expiresAt: string;
        tokenHash: string;
        tenantStatus: string;
        workspaceStatus: string | null;
      }
    | undefined;
  if (
    !invitation ||
    invitation.tenantStatus !== "active" ||
    (notification.workspaceId && invitation.workspaceStatus !== "active") ||
    invitation.email !== notification.recipient ||
    sha256(token) !== invitation.tokenHash
  ) {
    throw new InvalidNotificationFactError("邀请已经失效，通知不再投递");
  }
  const branding = await getEffectiveTenantBranding(notification.tenantId);
  const baseUrl = await getTenantPublicBaseUrl(notification.tenantId);
  const invitationUrl = `${baseUrl}/saas/invitations/accept?token=${encodeURIComponent(token)}`;
  return {
    subject: `${branding.productName} 邀请你加入工作空间`,
    text: [
      `你收到一封来自 ${branding.productName} 的邀请。`,
      "",
      `接受邀请：${invitationUrl}`,
      `有效期至：${new Date(invitation.expiresAt).toISOString()}`,
      "",
      "如果这不是你的操作，请忽略此邮件。",
    ].join("\n"),
  };
}

export async function processNextSaaSNotification(input: {
  workerId: string;
  sender?: SaaSNotificationSender;
}) {
  const notification = await claimNextSaaSNotification({ workerId: input.workerId });
  if (!notification) return null;
  try {
    const rendered = await renderNotification(notification);
    const delivery = await (input.sender ?? sendMail)({
      to: notification.recipient,
      subject: rendered.subject,
      text: rendered.text,
    });
    const messageId = delivery && "messageId" in delivery ? delivery.messageId ?? null : null;
    const updated = await sqlite
      .prepare(
        `UPDATE saas_notification_outbox SET status = 'delivered', provider_message_id = ?,
          delivered_at = now(), error_message = NULL, locked_by = NULL, lease_until = NULL,
          updated_at = now()
         WHERE id = ? AND status = 'running' AND locked_by = ? RETURNING id`,
      )
      .get(messageId, notification.id, input.workerId);
    if (!updated) throw new Error("通知 Outbox 租约已经失效");
    return { id: notification.id, status: "delivered" as const };
  } catch (error) {
    const cancelled = error instanceof InvalidNotificationFactError;
    const terminal = cancelled || notification.attempts >= notification.maxAttempts;
    const delaySeconds = Math.min(900, 5 * 3 ** Math.max(0, notification.attempts - 1));
    await sqlite
      .prepare(
        `UPDATE saas_notification_outbox SET status = ?, error_message = ?,
          available_at = CASE WHEN ? THEN available_at ELSE now() + (? * interval '1 second') END,
          locked_by = NULL, lease_until = NULL, updated_at = now()
         WHERE id = ? AND status = 'running' AND locked_by = ?`,
      )
      .run(
        cancelled ? "cancelled" : terminal ? "dead_letter" : "retry",
        sanitizeDeliveryError(error),
        terminal,
        delaySeconds,
        notification.id,
        input.workerId,
      );
    return {
      id: notification.id,
      status: cancelled ? ("cancelled" as const) : terminal ? ("dead_letter" as const) : ("retry" as const),
    };
  }
}
