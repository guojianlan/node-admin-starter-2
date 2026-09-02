import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { sqlite, type DbClient } from "@/server/db";
import { recordBackgroundOperationLog } from "./operation-log-service";
import { assertSaaSFileScope } from "./saas-file-service";
import {
  revalidateSaaSResourceScope,
  type SaaSResourceIdentity,
  type SaaSResourceScope,
} from "./saas-resource-scope-service";

export type SaaSAsyncOperationKind = "job" | "tool" | "export";
export type SaaSAsyncOperationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

type SaaSOperationRow = SaaSResourceIdentity & {
  id: number;
  kind: SaaSAsyncOperationKind;
  operationType: string;
  status: SaaSAsyncOperationStatus;
  payloadJson: string;
  resultJson: string | null;
  resourceType: string | null;
  resourceId: string | null;
  requestedBy: number;
  requestId: string | null;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  leaseUntil: string | null;
};

function normalizeOptionalPair(input: {
  resourceType?: string | null;
  resourceId?: string | number | null;
}) {
  const resourceType = input.resourceType?.trim() || null;
  const resourceId = input.resourceId == null ? null : String(input.resourceId).trim() || null;
  if (Boolean(resourceType) !== Boolean(resourceId)) {
    throw new HTTPException(400, { message: "resourceType 与 resourceId 必须同时提供" });
  }
  return { resourceType, resourceId };
}

async function getOperation(id: number, dbClient: DbClient = sqlite) {
  return (await dbClient
    .prepare(
      `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId", kind,
        operation_type AS "operationType", status, payload_json AS "payloadJson",
        result_json AS "resultJson", resource_type AS "resourceType",
        resource_id AS "resourceId", requested_by AS "requestedBy",
        request_id AS "requestId", attempts, max_attempts AS "maxAttempts",
        locked_by AS "lockedBy", lease_until AS "leaseUntil"
       FROM saas_async_operation WHERE id = ? LIMIT 1`,
    )
    .get(id)) as SaaSOperationRow | undefined;
}

export async function createSaaSAsyncOperation(input: {
  userId: number;
  scope: SaaSResourceScope;
  kind: SaaSAsyncOperationKind;
  operationType: string;
  payload: Record<string, unknown>;
  resourceType?: string | null;
  resourceId?: string | number | null;
  requestId?: string | null;
  idempotencyKey?: string;
  priority?: number;
  maxAttempts?: number;
}) {
  const scope = await revalidateSaaSResourceScope({ userId: input.userId, scope: input.scope });
  const resource = normalizeOptionalPair(input);
  const operationType = input.operationType.trim();
  if (!/^[a-z][a-z0-9._-]{1,119}$/.test(operationType)) {
    throw new HTTPException(400, { message: "SaaS operationType 不合法" });
  }
  const idempotencyKey = input.idempotencyKey?.trim() || crypto.randomUUID();
  if (idempotencyKey.length > 200) {
    throw new HTTPException(400, { message: "SaaS idempotencyKey 不能超过 200 个字符" });
  }
  const result = await sqlite
    .prepare(
      `INSERT INTO saas_async_operation
        (tenant_id, workspace_id, kind, operation_type, payload_json,
         resource_type, resource_id, requested_by, request_id, idempotency_key,
         priority, max_attempts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, workspace_id, idempotency_key) DO NOTHING
       RETURNING id`,
    )
    .run(
      scope.tenantId,
      scope.workspaceId,
      input.kind,
      operationType,
      JSON.stringify(input.payload),
      resource.resourceType,
      resource.resourceId,
      input.userId,
      input.requestId ?? null,
      idempotencyKey,
      Math.max(0, Math.min(input.priority ?? 100, 1000)),
      Math.max(1, Math.min(input.maxAttempts ?? 3, 20)),
    );
  let id = Number(result.lastInsertRowid || 0);
  if (!id) {
    const existing = (await sqlite
      .prepare(
        `SELECT id, kind, operation_type AS "operationType", requested_by AS "requestedBy"
         FROM saas_async_operation
         WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ?`,
      )
      .get(scope.tenantId, scope.workspaceId, idempotencyKey)) as {
      id: number;
      kind: SaaSAsyncOperationKind;
      operationType: string;
      requestedBy: number;
    };
    if (
      existing.requestedBy !== input.userId ||
      existing.kind !== input.kind ||
      existing.operationType !== operationType
    ) {
      throw new HTTPException(409, { message: "SaaS idempotencyKey 已用于其他操作" });
    }
    id = Number(existing.id);
  }
  await recordBackgroundOperationLog({
    userId: input.userId,
    module: "saas.asyncOperation",
    action: "enqueue",
    resource: "saas_async_operation",
    resourceId: id,
    requestId: input.requestId,
    saasScope: scope,
    details: { kind: input.kind, operationType, resourceType: resource.resourceType },
  });
  return getOperation(id);
}

export async function claimNextSaaSAsyncOperation(input: {
  workerId: string;
  leaseSeconds?: number;
  kinds?: SaaSAsyncOperationKind[];
}) {
  const leaseSeconds = Math.max(30, Math.min(input.leaseSeconds ?? 120, 15 * 60));
  const kinds = input.kinds?.length ? input.kinds : ["job", "tool", "export"];
  const placeholders = kinds.map(() => "?").join(", ");
  const claimed = await sqlite.transaction(async (tx) => {
    const candidate = (await tx
      .prepare(
        `SELECT id FROM saas_async_operation
         WHERE kind IN (${placeholders})
           AND ((status = 'queued' AND available_at <= now()) OR
                (status = 'running' AND lease_until <= now()))
           AND attempts < max_attempts
         ORDER BY priority ASC, id ASC
         FOR UPDATE SKIP LOCKED LIMIT 1`,
      )
      .get(...kinds)) as { id: number } | undefined;
    if (!candidate) return null;
    return (await tx
      .prepare(
        `UPDATE saas_async_operation
         SET status = 'running', attempts = attempts + 1, locked_by = ?,
           lease_until = now() + (? * interval '1 second'),
           started_at = COALESCE(started_at, now()), updated_at = now()
         WHERE id = ?
         RETURNING id, tenant_id AS "tenantId", workspace_id AS "workspaceId", kind,
           operation_type AS "operationType", status, payload_json AS "payloadJson",
           result_json AS "resultJson", resource_type AS "resourceType",
           resource_id AS "resourceId", requested_by AS "requestedBy",
           request_id AS "requestId", attempts, max_attempts AS "maxAttempts",
           locked_by AS "lockedBy", lease_until AS "leaseUntil"`,
      )
      .get(input.workerId, leaseSeconds, candidate.id)) as SaaSOperationRow;
  });
  if (!claimed) return null;

  try {
    const scope = await revalidateSaaSResourceScope({
      userId: claimed.requestedBy,
      scope: claimed,
    });
    return {
      ...claimed,
      payload: JSON.parse(claimed.payloadJson) as Record<string, unknown>,
      scope,
    };
  } catch (error) {
    await sqlite
      .prepare(
        `UPDATE saas_async_operation
         SET status = 'failed', error_message = ?, locked_by = NULL, lease_until = NULL,
           finished_at = now(), updated_at = now()
         WHERE id = ? AND status = 'running' AND locked_by = ?`,
      )
      .run("SaaS Tenant / Workspace 上下文已失效", claimed.id, input.workerId);
    await recordBackgroundOperationLog({
      userId: claimed.requestedBy,
      module: "saas.asyncOperation",
      action: "scopeRejected",
      resource: "saas_async_operation",
      resourceId: claimed.id,
      status: 409,
      success: false,
      riskLevel: "high",
      message: "SaaS Tenant / Workspace 上下文已失效",
      saasScope: claimed,
      details: { kind: claimed.kind, operationType: claimed.operationType },
    });
    throw error;
  }
}

export async function assertSaaSAsyncOperationLease(input: { id: number; workerId: string }) {
  const operation = (await sqlite
    .prepare(
      `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId", kind,
        operation_type AS "operationType", status, payload_json AS "payloadJson",
        result_json AS "resultJson", resource_type AS "resourceType",
        resource_id AS "resourceId", requested_by AS "requestedBy",
        request_id AS "requestId", attempts, max_attempts AS "maxAttempts",
        locked_by AS "lockedBy", lease_until AS "leaseUntil"
       FROM saas_async_operation
       WHERE id = ? AND status = 'running' AND locked_by = ? AND lease_until > now()`,
    )
    .get(input.id, input.workerId)) as SaaSOperationRow | undefined;
  if (!operation) throw new HTTPException(409, { message: "SaaS 异步操作租约已失效" });
  const scope = await revalidateSaaSResourceScope({
    userId: operation.requestedBy,
    scope: operation,
  });
  return {
    ...operation,
    scope,
    payload: JSON.parse(operation.payloadJson) as Record<string, unknown>,
  };
}

export async function renewSaaSAsyncOperationLease(input: {
  id: number;
  workerId: string;
  leaseSeconds?: number;
}) {
  await assertSaaSAsyncOperationLease(input);
  const leaseSeconds = Math.max(30, Math.min(input.leaseSeconds ?? 120, 15 * 60));
  const updated = await sqlite
    .prepare(
      `UPDATE saas_async_operation
       SET lease_until = now() + (? * interval '1 second'), updated_at = now()
       WHERE id = ? AND status = 'running' AND locked_by = ? AND lease_until > now()
       RETURNING lease_until AS "leaseUntil"`,
    )
    .get(leaseSeconds, input.id, input.workerId);
  if (!updated) throw new HTTPException(409, { message: "SaaS 异步操作租约已失效" });
  return updated as { leaseUntil: string };
}

export async function completeSaaSAsyncOperation(input: {
  id: number;
  workerId: string;
  result?: Record<string, unknown> | null;
  resultFileId?: number | null;
}) {
  const operation = await assertSaaSAsyncOperationLease(input);
  if (input.resultFileId) {
    await assertSaaSFileScope(operation.scope, input.resultFileId);
  }
  const updated = await sqlite
    .prepare(
      `UPDATE saas_async_operation
       SET status = 'completed', result_json = ?, result_file_id = ?, error_message = NULL,
         locked_by = NULL, lease_until = NULL, finished_at = now(), updated_at = now()
       WHERE id = ? AND status = 'running' AND locked_by = ? AND lease_until > now()
       RETURNING id`,
    )
    .run(
      JSON.stringify(input.result ?? null),
      input.resultFileId ?? null,
      input.id,
      input.workerId,
    );
  if (!updated.changes) throw new HTTPException(409, { message: "SaaS 异步操作租约已失效" });
  return getOperation(input.id);
}

export async function applySaaSOperationCallback<T>(input: {
  operationId: number;
  callbackKey: string;
  payload: Record<string, unknown>;
  apply: (scope: SaaSResourceScope, payload: Record<string, unknown>) => Promise<T>;
}) {
  const callbackKey = input.callbackKey.trim();
  if (!callbackKey) throw new HTTPException(400, { message: "callbackKey 不能为空" });
  const operation = await getOperation(input.operationId);
  if (!operation) throw new HTTPException(404, { message: "SaaS 异步操作不存在" });
  const existing = (await sqlite
    .prepare(
      `SELECT id, status FROM saas_callback_event
       WHERE operation_id = ? AND callback_key = ?`,
    )
    .get(operation.id, callbackKey)) as { id: number; status: string } | undefined;
  if (existing?.status === "applied")
    return { id: existing.id, replayed: true, result: null as T | null };
  if (existing) throw new HTTPException(409, { message: "SaaS Callback 正在处理或已经失败" });

  const scope = await revalidateSaaSResourceScope({
    userId: operation.requestedBy,
    scope: operation,
  });
  const inserted = await sqlite
    .prepare(
      `INSERT INTO saas_callback_event
        (operation_id, tenant_id, workspace_id, callback_key, payload_json, status)
       VALUES (?, ?, ?, ?, ?, 'accepted')
       ON CONFLICT (operation_id, callback_key) DO NOTHING
       RETURNING id`,
    )
    .run(
      operation.id,
      operation.tenantId,
      operation.workspaceId,
      callbackKey,
      JSON.stringify(input.payload),
    );
  const eventId = Number(inserted.lastInsertRowid || 0);
  if (!eventId) {
    const concurrent = (await sqlite
      .prepare(
        `SELECT id, status FROM saas_callback_event
         WHERE operation_id = ? AND callback_key = ?`,
      )
      .get(operation.id, callbackKey)) as { id: number; status: string };
    if (concurrent.status === "applied") {
      return { id: concurrent.id, replayed: true, result: null as T | null };
    }
    throw new HTTPException(409, { message: "SaaS Callback 正在处理或已经失败" });
  }
  try {
    const currentScope = await revalidateSaaSResourceScope({
      userId: operation.requestedBy,
      scope: operation,
    });
    const result = await input.apply(currentScope, input.payload);
    await sqlite
      .prepare(
        `UPDATE saas_callback_event
         SET status = 'applied', processed_at = now(), error_message = NULL
         WHERE id = ? AND status = 'accepted'`,
      )
      .run(eventId);
    await recordBackgroundOperationLog({
      userId: operation.requestedBy,
      module: "saas.asyncOperation",
      action: "callbackApplied",
      resource: "saas_async_operation",
      resourceId: operation.id,
      requestId: operation.requestId,
      saasScope: scope,
      details: { kind: operation.kind, operationType: operation.operationType, callbackKey },
    });
    return { id: eventId, replayed: false, result };
  } catch (error) {
    await sqlite
      .prepare(
        `UPDATE saas_callback_event
         SET status = 'rejected', processed_at = now(), error_message = ?
         WHERE id = ? AND status = 'accepted'`,
      )
      .run((error instanceof Error ? error.message : String(error)).slice(0, 2000), eventId);
    throw error;
  }
}
