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
import {
  assertSaaSUsageReservationForOperation,
  releaseSaaSUsageForOperation,
  releaseSaaSUsageReservation,
  reserveSaaSUsage,
  settleSaaSUsageForOperation,
  type SaaSUsagePeriod,
} from "./saas-usage-service";

export type SaaSAsyncOperationKind = "job" | "tool" | "export";
export type SaaSAsyncOperationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

type SaaSOperationRow = SaaSResourceIdentity & {
  id: number;
  moduleId: number | null;
  usageReservationId: number | null;
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
        module_id AS "moduleId", usage_reservation_id AS "usageReservationId",
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
  moduleId?: number | null;
  usageReservationId?: number | null;
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
  const moduleId = input.moduleId ?? null;
  const usageReservationId = input.usageReservationId ?? null;
  if (Boolean(moduleId) !== Boolean(usageReservationId)) {
    throw new HTTPException(400, {
      message: "计量异步操作必须同时提供 moduleId 与 usageReservationId",
    });
  }
  const created = await sqlite.transaction(async (tx) => {
    if (moduleId && usageReservationId) {
      await assertSaaSUsageReservationForOperation(
        { scope, reservationId: usageReservationId, moduleId, userId: input.userId },
        tx,
      );
    }
    const result = await tx
      .prepare(
        `INSERT INTO saas_async_operation
          (tenant_id, workspace_id, module_id, usage_reservation_id, kind,
           operation_type, payload_json, resource_type, resource_id, requested_by,
           request_id, idempotency_key, priority, max_attempts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, workspace_id, idempotency_key) DO NOTHING
         RETURNING id`,
      )
      .run(
        scope.tenantId,
        scope.workspaceId,
        moduleId,
        usageReservationId,
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
    if (id) return { id, replayed: false };
    const existing = (await tx
      .prepare(
        `SELECT id, kind, operation_type AS "operationType", requested_by AS "requestedBy",
          module_id AS "moduleId", usage_reservation_id AS "usageReservationId"
         FROM saas_async_operation
         WHERE tenant_id = ? AND workspace_id = ? AND idempotency_key = ?`,
      )
      .get(scope.tenantId, scope.workspaceId, idempotencyKey)) as {
      id: number;
      kind: SaaSAsyncOperationKind;
      operationType: string;
      requestedBy: number;
      moduleId: number | null;
      usageReservationId: number | null;
    };
    if (
      existing.requestedBy !== input.userId ||
      existing.kind !== input.kind ||
      existing.operationType !== operationType ||
      Number(existing.moduleId ?? 0) !== Number(moduleId ?? 0) ||
      Number(existing.usageReservationId ?? 0) !== Number(usageReservationId ?? 0)
    ) {
      throw new HTTPException(409, { message: "SaaS idempotencyKey 已用于其他操作" });
    }
    id = Number(existing.id);
    return { id, replayed: true };
  });
  if (!created.replayed) {
    await recordBackgroundOperationLog({
      userId: input.userId,
      module: "saas.asyncOperation",
      action: "enqueue",
      resource: "saas_async_operation",
      resourceId: created.id,
      requestId: input.requestId,
      saasScope: scope,
      details: {
        kind: input.kind,
        operationType,
        resourceType: resource.resourceType,
        moduleId,
        metered: Boolean(usageReservationId),
      },
    });
  }
  return getOperation(created.id);
}

export async function createMeteredSaaSAsyncOperation(input: {
  userId: number;
  scope: SaaSResourceScope;
  moduleId: number;
  metric: string;
  period: SaaSUsagePeriod;
  quantity: string;
  concurrentUnits?: number;
  kind: SaaSAsyncOperationKind;
  operationType: string;
  payload: Record<string, unknown>;
  resourceType?: string | null;
  resourceId?: string | number | null;
  requestId?: string | null;
  idempotencyKey: string;
  priority?: number;
  maxAttempts?: number;
  reservationExpiresInSeconds?: number;
}) {
  const reservation = await reserveSaaSUsage({
    userId: input.userId,
    scope: input.scope,
    moduleId: input.moduleId,
    metric: input.metric,
    period: input.period,
    quantity: input.quantity,
    concurrentUnits: input.concurrentUnits,
    idempotencyKey: `operation:${input.idempotencyKey}`,
    expiresInSeconds: input.reservationExpiresInSeconds,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    requestId: input.requestId,
  });
  try {
    return await createSaaSAsyncOperation({
      ...input,
      moduleId: input.moduleId,
      usageReservationId: reservation.reservation.id,
    });
  } catch (error) {
    if (!reservation.replayed) {
      await releaseSaaSUsageReservation({
        userId: input.userId,
        scope: input.scope,
        reservationId: reservation.reservation.id,
        reason: "async_operation_enqueue_failed",
      }).catch(() => undefined);
    }
    throw error;
  }
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
           module_id AS "moduleId", usage_reservation_id AS "usageReservationId",
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
    await sqlite.transaction(async (tx) => {
      await releaseSaaSUsageForOperation(
        { operationId: claimed.id, reason: "scope_revalidation_failed" },
        tx,
      );
      await tx
        .prepare(
          `UPDATE saas_async_operation
           SET status = 'failed', error_message = ?, locked_by = NULL, lease_until = NULL,
             finished_at = now(), updated_at = now()
           WHERE id = ? AND status = 'running' AND locked_by = ?`,
        )
        .run("SaaS Tenant / Workspace 上下文已失效", claimed.id, input.workerId);
    });
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
        module_id AS "moduleId", usage_reservation_id AS "usageReservationId",
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
  usageQuantity?: string;
}) {
  const operation = await assertSaaSAsyncOperationLease(input);
  if (input.resultFileId) {
    await assertSaaSFileScope(operation.scope, input.resultFileId);
  }
  const settlement = await sqlite.transaction(async (tx) => {
    const current = await tx
      .prepare(
        `SELECT id FROM saas_async_operation
         WHERE id = ? AND status = 'running' AND locked_by = ? AND lease_until > now()
         FOR UPDATE`,
      )
      .get(input.id, input.workerId);
    if (!current) throw new HTTPException(409, { message: "SaaS 异步操作租约已失效" });
    const usage = await settleSaaSUsageForOperation(
      {
        operationId: input.id,
        quantity: input.usageQuantity,
        source: "async_operation_completed",
      },
      tx,
    );
    const updated = await tx
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
    return usage;
  });
  if (settlement && !settlement.replayed) {
    await recordBackgroundOperationLog({
      userId: operation.requestedBy,
      module: "saas.usage",
      action: settlement.reservation.overage ? "settleOverage" : "settle",
      resource: "saas_usage_reservation",
      resourceId: settlement.reservation.id,
      requestId: operation.requestId,
      riskLevel: settlement.reservation.overage ? "high" : "low",
      saasScope: operation.scope,
      details: {
        moduleId: settlement.reservation.moduleId,
        metric: settlement.reservation.metric,
        operationId: operation.id,
        settledQuantity: settlement.reservation.settledQuantity,
      },
    });
  }
  return getOperation(input.id);
}

export async function failSaaSAsyncOperation(input: {
  id: number;
  workerId: string;
  errorMessage: string;
}) {
  const operation = await assertSaaSAsyncOperationLease(input);
  const release = await sqlite.transaction(async (tx) => {
    const current = await tx
      .prepare(
        `SELECT id FROM saas_async_operation
         WHERE id = ? AND status = 'running' AND locked_by = ? AND lease_until > now()
         FOR UPDATE`,
      )
      .get(input.id, input.workerId);
    if (!current) throw new HTTPException(409, { message: "SaaS 异步操作租约已失效" });
    const usage = await releaseSaaSUsageForOperation(
      { operationId: input.id, reason: "async_operation_failed" },
      tx,
    );
    await tx
      .prepare(
        `UPDATE saas_async_operation
         SET status = 'failed', error_message = ?, locked_by = NULL, lease_until = NULL,
           finished_at = now(), updated_at = now()
         WHERE id = ? AND status = 'running' AND locked_by = ? AND lease_until > now()`,
      )
      .run(input.errorMessage.slice(0, 2000), input.id, input.workerId);
    return usage;
  });
  if (release && !release.replayed) {
    await recordBackgroundOperationLog({
      userId: operation.requestedBy,
      module: "saas.usage",
      action: "release",
      resource: "saas_usage_reservation",
      resourceId: release.reservation.id,
      requestId: operation.requestId,
      saasScope: operation.scope,
      details: { operationId: operation.id, reason: "async_operation_failed" },
    });
  }
  return getOperation(input.id);
}

export async function cancelSaaSAsyncOperation(input: {
  id: number;
  userId: number;
  scope: SaaSResourceScope;
  reason?: string;
}) {
  const scope = await revalidateSaaSResourceScope({ userId: input.userId, scope: input.scope });
  const result = await sqlite.transaction(async (tx) => {
    const operation = (await tx
      .prepare(
        `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId", status,
          requested_by AS "requestedBy", request_id AS "requestId"
         FROM saas_async_operation WHERE id = ? FOR UPDATE`,
      )
      .get(input.id)) as
      | {
          id: number;
          tenantId: number;
          workspaceId: number;
          status: SaaSAsyncOperationStatus;
          requestedBy: number;
          requestId: string | null;
        }
      | undefined;
    if (
      !operation ||
      operation.tenantId !== scope.tenantId ||
      operation.workspaceId !== scope.workspaceId
    ) {
      throw new HTTPException(404, { message: "SaaS 异步操作不存在" });
    }
    if (operation.requestedBy !== input.userId) {
      throw new HTTPException(403, { message: "只能取消自己发起的 SaaS 异步操作" });
    }
    if (operation.status === "cancelled") return { replayed: true, release: null };
    if (["completed", "failed"].includes(operation.status)) {
      throw new HTTPException(409, { message: "已结束的 SaaS 异步操作不能取消" });
    }
    const release = await releaseSaaSUsageForOperation(
      { operationId: input.id, reason: input.reason?.trim() || "async_operation_cancelled" },
      tx,
    );
    await tx
      .prepare(
        `UPDATE saas_async_operation SET status = 'cancelled', error_message = ?,
          locked_by = NULL, lease_until = NULL, finished_at = now(), updated_at = now()
         WHERE id = ?`,
      )
      .run(input.reason?.trim() || "用户取消", input.id);
    return { replayed: false, release };
  });
  if (!result.replayed) {
    await recordBackgroundOperationLog({
      userId: input.userId,
      module: "saas.asyncOperation",
      action: "cancel",
      resource: "saas_async_operation",
      resourceId: input.id,
      riskLevel: "medium",
      saasScope: scope,
      details: { reason: input.reason?.trim() || null, releasedUsage: Boolean(result.release) },
    });
  }
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
