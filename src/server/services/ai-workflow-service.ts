import { randomUUID } from "node:crypto";
import { sql, sqlite, type DbClient } from "@/server/db";

export type AiWorkflowRunStatus =
  | "queued"
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

export type AiWorkflowStepStatus = "running" | "suspended" | "completed" | "failed" | "skipped";
export type AiWorkflowWaitType = "approval" | "event" | "timer" | "child_workflow";
export type AiWorkflowWaitStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "resolved"
  | "expired"
  | "cancelled";

export type AiWorkflowWaitRecord = {
  id: number;
  runId: number;
  stepId: number | null;
  nodeId: string;
  waitType: AiWorkflowWaitType;
  childRunId: number | null;
  status: AiWorkflowWaitStatus;
  correlationKey: string | null;
  input: unknown;
  resolution: unknown;
  resumeAt: string | null;
  timeoutAt: string | null;
  decidedBy: number | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiWorkflowRuntimeRun = {
  id: number;
  workflowCode: string;
  definitionId: number | null;
  parentRunId: number | null;
  parentNodeId: string | null;
  callDepth: number;
  userId: number;
  status: AiWorkflowRunStatus;
  input: unknown;
  output: unknown;
  continuation: unknown;
  startedAt: string | null;
};

function toJson(value: unknown) {
  return value == null ? null : JSON.stringify(value);
}

function parseJson(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function hydrateRun<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    input: parseJson(row.inputJson),
    output: parseJson(row.outputJson),
  };
}

function hydrateStep<T extends Record<string, unknown>>(row: T) {
  return {
    ...row,
    input: parseJson(row.inputJson),
    output: parseJson(row.outputJson),
  };
}

export async function appendAiProgressEvent(input: {
  resourceType: string;
  resourceId: string | number;
  runId?: number | null;
  eventType: string;
  payload?: unknown;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const result = await dbClient
    .prepare(
      `INSERT INTO sys_ai_progress_event (resource_type, resource_id, run_id, event_type, payload_json)
       VALUES (?, ?, ?, ?, ?) RETURNING id, created_at AS "createdAt"`,
    )
    .get(
      input.resourceType,
      String(input.resourceId),
      input.runId ?? null,
      input.eventType,
      JSON.stringify(input.payload ?? {}),
    ) as { id: number; createdAt: string };
  // NOTIFY is an optimization only. The persisted row is the replay source of truth.
  void dbClient
    .prepare("SELECT pg_notify('admin_base_ai_progress', ?)")
    .run(JSON.stringify({ id: result.id, resourceType: input.resourceType, resourceId: String(input.resourceId) }))
    .catch(() => undefined);
  return result;
}

export async function listAiProgressEvents(input: {
  resourceType: string;
  resourceId: string | number;
  afterId?: number;
  limit?: number;
}) {
  const rows = (await sqlite
    .prepare(
      `SELECT id, resource_type AS "resourceType", resource_id AS "resourceId", run_id AS "runId",
        event_type AS "eventType", payload_json AS "payloadJson", created_at AS "createdAt"
       FROM sys_ai_progress_event
       WHERE resource_type = ? AND resource_id = ? AND id > ?
       ORDER BY id ASC LIMIT ?`,
    )
    .all(input.resourceType, String(input.resourceId), Math.max(input.afterId ?? 0, 0), Math.min(input.limit ?? 500, 2000))) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ ...row, payload: parseJson(row.payloadJson) }));
}

/**
 * Subscribe to cross-process progress hints. NOTIFY is only a wake-up signal;
 * callers must still replay the persisted event table by id.
 */
export async function subscribeAiProgressNotifications(input: {
  resourceType: string;
  resourceId: string | number;
  onNotify: (event: { id: number; resourceType: string; resourceId: string }) => void;
}) {
  const request = sql.listen("admin_base_ai_progress", (payload) => {
    try {
      const value = JSON.parse(payload) as {
        id?: number;
        resourceType?: string;
        resourceId?: string;
      };
      if (
        Number(value.id) > 0 &&
        value.resourceType === input.resourceType &&
        value.resourceId === String(input.resourceId)
      ) {
        input.onNotify({
          id: Number(value.id),
          resourceType: value.resourceType,
          resourceId: value.resourceId,
        });
      }
    } catch {
      // The persisted row is authoritative when a notification is malformed.
    }
  });
  const listenMeta = await request;
  return async () => {
    await listenMeta.unlisten().catch(() => undefined);
  };
}

export async function createAiWorkflowRun(input: {
  workflowCode: string;
  userId: number;
  requestId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  workflowInput: unknown;
  definitionId?: number | null;
  parentRunId?: number | null;
  parentNodeId?: string | null;
  callDepth?: number;
  initialStatus?: "queued" | "running";
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const orchestratorRunId = `admin-base-workflow-${randomUUID()}`;
  const result = await dbClient
    .prepare(
      `INSERT INTO sys_ai_workflow_run
        (workflow_code, orchestrator_run_id, user_id, status, request_id, definition_id,
         parent_run_id, parent_node_id, call_depth, resource_type, resource_id, input_json, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'running' THEN now() ELSE NULL END)
       RETURNING id`,
    )
    .run(
      input.workflowCode,
      orchestratorRunId,
      input.userId,
      input.initialStatus ?? "running",
      input.requestId ?? null,
      input.definitionId ?? null,
      input.parentRunId ?? null,
      input.parentNodeId ?? null,
      Math.max(Math.round(input.callDepth ?? 0), 0),
      input.resourceType ?? null,
      input.resourceId ?? null,
      toJson(input.workflowInput),
      input.initialStatus ?? "running",
    );
  await appendAiProgressEvent({
    resourceType: input.resourceType ?? "workflow",
    resourceId: input.resourceId ?? Number(result.lastInsertRowid),
    runId: Number(result.lastInsertRowid),
    eventType: input.initialStatus ?? "running",
    payload: { workflowCode: input.workflowCode },
    dbClient,
  });
  return { id: Number(result.lastInsertRowid), orchestratorRunId };
}

export async function saveAiWorkflowContinuation(input: {
  runId: number;
  continuation: unknown;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient
    .prepare(
      `UPDATE sys_ai_workflow_run SET continuation_json = ?, updated_at = now()
       WHERE id = ? AND status IN ('running', 'suspended')`,
    )
    .run(toJson(input.continuation), input.runId);
}

export async function getAiWorkflowRuntimeRun(input: {
  id: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const row = (await dbClient
    .prepare(
      `SELECT id, workflow_code AS "workflowCode", definition_id AS "definitionId", user_id AS "userId",
        parent_run_id AS "parentRunId", parent_node_id AS "parentNodeId", call_depth AS "callDepth",
        status, input_json AS "inputJson", output_json AS "outputJson",
        continuation_json AS "continuationJson", started_at AS "startedAt"
       FROM sys_ai_workflow_run WHERE id = ? AND user_id = ?`,
    )
    .get(input.id, input.userId)) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...row,
    input: parseJson(row.inputJson),
    output: parseJson(row.outputJson),
    continuation: parseJson(row.continuationJson),
  } as AiWorkflowRuntimeRun;
}

export async function createAiWorkflowWait(input: {
  runId: number;
  stepId: number;
  nodeId: string;
  waitType: AiWorkflowWaitType;
  childRunId?: number | null;
  correlationKey?: string | null;
  waitInput?: unknown;
  resumeAt?: string | Date | null;
  timeoutAt?: string | Date | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const result = await dbClient
    .prepare(
      `INSERT INTO sys_ai_workflow_wait
       (run_id, step_id, node_id, wait_type, child_run_id, correlation_key, input_json, resume_at, timeout_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (run_id, node_id) WHERE status = 'pending' DO NOTHING
       RETURNING id`,
    )
    .run(
      input.runId,
      input.stepId,
      input.nodeId,
      input.waitType,
      input.childRunId ?? null,
      input.correlationKey?.trim() || null,
      toJson(input.waitInput),
      input.resumeAt instanceof Date ? input.resumeAt.toISOString() : input.resumeAt ?? null,
      input.timeoutAt instanceof Date ? input.timeoutAt.toISOString() : input.timeoutAt ?? null,
    );
  if (result.lastInsertRowid) return { id: Number(result.lastInsertRowid), status: "pending" as const };
  const existing = (await dbClient
    .prepare(
      `SELECT id, status FROM sys_ai_workflow_wait
       WHERE run_id = ? AND node_id = ? AND status = 'pending'`,
    )
    .get(input.runId, input.nodeId)) as { id: number; status: AiWorkflowWaitStatus } | undefined;
  if (!existing) throw new Error("Workflow Wait 创建冲突");
  return existing;
}

export async function listAiWorkflowWaits(input: {
  runId: number;
  userId: number;
  pendingOnly?: boolean;
  dbClient?: DbClient;
}): Promise<AiWorkflowWaitRecord[]> {
  const dbClient = input.dbClient ?? sqlite;
  const rows = (await dbClient
    .prepare(
      `SELECT wait.id, wait.run_id AS "runId", wait.step_id AS "stepId", wait.node_id AS "nodeId",
        wait.wait_type AS "waitType", wait.child_run_id AS "childRunId", wait.status,
        wait.correlation_key AS "correlationKey",
        wait.input_json AS "inputJson", wait.resolution_json AS "resolutionJson",
        wait.resume_at AS "resumeAt", wait.timeout_at AS "timeoutAt",
        wait.decided_by AS "decidedBy", wait.decided_at AS "decidedAt",
        wait.created_at AS "createdAt", wait.updated_at AS "updatedAt"
       FROM sys_ai_workflow_wait wait
       INNER JOIN sys_ai_workflow_run run ON run.id = wait.run_id
       WHERE wait.run_id = ? AND run.user_id = ? ${input.pendingOnly ? "AND wait.status = 'pending'" : ""}
       ORDER BY wait.id DESC`,
    )
    .all(input.runId, input.userId)) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...row,
    input: parseJson(row.inputJson),
    resolution: parseJson(row.resolutionJson),
  })) as AiWorkflowWaitRecord[];
}

export async function resolveAiWorkflowWait(input: {
  id: number;
  runId: number;
  userId: number;
  status: "approved" | "rejected" | "resolved";
  resolution?: unknown;
  correlationKey?: string | null;
  expectedWaitType?: "approval" | "event";
  dbClient?: DbClient;
}): Promise<(AiWorkflowWaitRecord & { resolution: unknown }) | null> {
  const dbClient = input.dbClient ?? sqlite;
  const row = (await dbClient
    .prepare(
      `UPDATE sys_ai_workflow_wait
       SET status = ?, resolution_json = ?, decided_by = ?, decided_at = now(), updated_at = now()
       WHERE id = ? AND run_id = ? AND status = 'pending'
         AND EXISTS (SELECT 1 FROM sys_ai_workflow_run run WHERE run.id = run_id AND run.user_id = ?)
         AND (CAST(? AS TEXT) IS NULL OR wait_type = CAST(? AS TEXT))
         AND (CAST(? AS TEXT) IS NULL OR correlation_key = CAST(? AS TEXT))
         AND (timeout_at IS NULL OR timeout_at > now())
       RETURNING id, wait_type AS "waitType", node_id AS "nodeId",
         status, resolution_json AS "resolutionJson"`,
    )
    .get(
      input.status,
      toJson(input.resolution),
      input.userId,
      input.id,
      input.runId,
      input.userId,
      input.expectedWaitType ?? null,
      input.expectedWaitType ?? null,
      input.correlationKey ?? null,
      input.correlationKey ?? null,
    )) as Record<string, unknown> | undefined;
  if (!row) return null;
  await appendAiProgressEvent({
    resourceType: "workflow_run",
    resourceId: input.runId,
    runId: input.runId,
    eventType: "wait-resolved",
    payload: { waitId: input.id, nodeId: row.nodeId, status: input.status },
    dbClient,
  });
  return { ...row, resolution: parseJson(row.resolutionJson) } as AiWorkflowWaitRecord & { resolution: unknown };
}

export async function resolveChildWorkflowWaits(input: {
  childRunId: number;
  childStatus: "completed" | "failed" | "cancelled";
  value?: unknown;
  errorMessage?: string | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const rows = (await dbClient
    .prepare(
      `UPDATE sys_ai_workflow_wait wait
       SET status = 'resolved', resolution_json = ?, decided_at = now(), updated_at = now()
       FROM sys_ai_workflow_run parent
       WHERE wait.run_id = parent.id AND wait.child_run_id = ?
         AND wait.wait_type = 'child_workflow' AND wait.status = 'pending'
       RETURNING wait.id, wait.run_id AS "runId", parent.user_id AS "userId", wait.node_id AS "nodeId"`,
    )
    .all(
      toJson({
        childRunId: input.childRunId,
        status: input.childStatus,
        value: input.value ?? null,
        errorMessage: input.errorMessage ?? null,
      }),
      input.childRunId,
    )) as Array<{ id: number; runId: number; userId: number; nodeId: string }>;
  for (const row of rows) {
    await appendAiProgressEvent({
      resourceType: "workflow_run",
      resourceId: row.runId,
      runId: row.runId,
      eventType: "child-workflow-resolved",
      payload: { waitId: row.id, nodeId: row.nodeId, childRunId: input.childRunId, status: input.childStatus },
      dbClient,
    });
  }
  return rows;
}

export async function resolveDueAiWorkflowTimer(input: {
  id: number;
  runId: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const row = (await dbClient
    .prepare(
      `UPDATE sys_ai_workflow_wait
       SET status = 'resolved', resolution_json = ?, decided_at = now(), updated_at = now()
       WHERE id = ? AND run_id = ? AND wait_type = 'timer'
         AND status = 'pending' AND resume_at <= now()
         AND EXISTS (SELECT 1 FROM sys_ai_workflow_run run WHERE run.id = run_id AND run.user_id = ?)
       RETURNING id, node_id AS "nodeId", status`,
    )
    .get(JSON.stringify({ reason: "timer_due" }), input.id, input.runId, input.userId)) as
    | { id: number; nodeId: string; status: string }
    | undefined;
  return row ?? null;
}

export async function completeSuspendedAiWorkflowStep(input: {
  runId: number;
  stepNo: number;
  output: unknown;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient
    .prepare(
      `UPDATE sys_ai_workflow_run_step
       SET status = 'completed', output_json = ?, error_message = NULL,
         finished_at = now(), updated_at = now()
       WHERE run_id = ? AND step_no = ? AND status = 'suspended'`,
    )
    .run(toJson(input.output), input.runId, input.stepNo);
}

export async function failSuspendedAiWorkflowStep(input: {
  runId: number;
  stepNo: number;
  errorMessage: string;
  output?: unknown;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient
    .prepare(
      `UPDATE sys_ai_workflow_run_step
       SET status = 'failed', output_json = ?, error_message = ?,
         finished_at = now(), updated_at = now()
       WHERE run_id = ? AND step_no = ? AND status = 'suspended'`,
    )
    .run(toJson(input.output), input.errorMessage.slice(0, 2000), input.runId, input.stepNo);
}

export async function startAiWorkflowRun(id: number, dbClient: DbClient = sqlite) {
  await dbClient
    .prepare(
      `UPDATE sys_ai_workflow_run
       SET status = 'running', started_at = COALESCE(started_at, now()), error_message = NULL,
         updated_at = now()
       WHERE id = ? AND status = 'queued'`,
    )
    .run(id);
  await appendAiProgressEvent({ resourceType: "workflow_run", resourceId: id, runId: id, eventType: "started", dbClient });
}

export async function finishAiWorkflowRun(input: {
  id: number;
  status: Exclude<AiWorkflowRunStatus, "queued" | "running">;
  output?: unknown;
  errorMessage?: string | null;
  durationMs?: number | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient
    .prepare(
      `UPDATE sys_ai_workflow_run
       SET status = ?, output_json = ?, error_message = ?,
         duration_ms = CASE
           WHEN ? = 'suspended' THEN duration_ms
           ELSE COALESCE(
             ?,
             GREATEST((EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int, 0),
             duration_ms,
             0
           )
         END,
         finished_at = CASE WHEN ? = 'suspended' THEN NULL ELSE now() END,
         updated_at = now()
       WHERE id = ?`,
    )
    .run(
      input.status,
      toJson(input.output),
      input.errorMessage ?? null,
      input.status,
      input.durationMs ?? null,
      input.status,
      input.id,
    );
  await appendAiProgressEvent({ resourceType: "workflow_run", resourceId: input.id, runId: input.id, eventType: input.status, payload: { errorMessage: input.errorMessage }, dbClient });
}

export async function startAiWorkflowStep(input: {
  runId: number;
  stepNo: number;
  stepCode: string;
  stepInput: unknown;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const result = await dbClient
    .prepare(
      `INSERT INTO sys_ai_workflow_run_step
        (run_id, step_no, step_code, status, input_json, started_at)
       VALUES (?, ?, ?, 'running', ?, now())
       RETURNING id`,
    )
    .run(input.runId, input.stepNo, input.stepCode, toJson(input.stepInput));
  await appendAiProgressEvent({ resourceType: "workflow_run", resourceId: input.runId, runId: input.runId, eventType: "step-start", payload: { stepId: Number(result.lastInsertRowid), stepCode: input.stepCode, stepNo: input.stepNo }, dbClient });
  return Number(result.lastInsertRowid);
}

export async function finishAiWorkflowStep(input: {
  id: number;
  status: Exclude<AiWorkflowStepStatus, "running">;
  output?: unknown;
  errorMessage?: string | null;
  durationMs?: number | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient
    .prepare(
      `UPDATE sys_ai_workflow_run_step
       SET status = ?, output_json = ?, error_message = ?, duration_ms = ?,
         finished_at = CASE WHEN ? = 'suspended' THEN NULL ELSE now() END,
         updated_at = now()
       WHERE id = ?`,
    )
    .run(
      input.status,
      toJson(input.output),
      input.errorMessage ?? null,
      input.durationMs ?? null,
      input.status,
      input.id,
    );
  const row = (await dbClient.prepare("SELECT run_id AS \"runId\", step_code AS \"stepCode\" FROM sys_ai_workflow_run_step WHERE id = ?").get(input.id)) as { runId: number; stepCode: string } | undefined;
  if (row) await appendAiProgressEvent({ resourceType: "workflow_run", resourceId: row.runId, runId: row.runId, eventType: "step-finish", payload: { stepId: input.id, stepCode: row.stepCode, status: input.status }, dbClient });
}

export async function runPersistedAiWorkflowStep<T>(input: {
  runId: number;
  stepNo: number;
  stepCode: string;
  stepInput: unknown;
  execute: () => Promise<T>;
}) {
  const startedAt = performance.now();
  const stepId = await startAiWorkflowStep(input);
  try {
    const output = await input.execute();
    await finishAiWorkflowStep({
      id: stepId,
      status: "completed",
      output,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return output;
  } catch (error) {
    await finishAiWorkflowStep({
      id: stepId,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
}

export async function listAiWorkflowRuns(input: {
  userId: number;
  workflowCode?: string | null;
  limit?: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const values: Array<string | number> = [input.userId];
  const workflowWhere = input.workflowCode ? "AND workflow_code = ?" : "";
  if (input.workflowCode) values.push(input.workflowCode);
  values.push(limit);
  const rows = (await dbClient
    .prepare(
      `SELECT id, workflow_code AS "workflowCode", orchestrator_run_id AS "orchestratorRunId",
        user_id AS "userId", status, request_id AS "requestId", resource_type AS "resourceType",
        resource_id AS "resourceId", input_json AS "inputJson", output_json AS "outputJson",
        definition_id AS "definitionId", parent_run_id AS "parentRunId",
        parent_node_id AS "parentNodeId", call_depth AS "callDepth",
        continuation_json AS "continuationJson",
        error_message AS "errorMessage", duration_ms AS "durationMs", started_at AS "startedAt",
        finished_at AS "finishedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM sys_ai_workflow_run
       WHERE user_id = ? ${workflowWhere}
       ORDER BY id DESC LIMIT ?`,
    )
    .all(...values)) as Array<Record<string, unknown>>;
  return rows.map(hydrateRun);
}

export async function getAiWorkflowRun(input: { id: number; userId: number; dbClient?: DbClient }) {
  const dbClient = input.dbClient ?? sqlite;
  const row = (await dbClient
    .prepare(
      `SELECT id, workflow_code AS "workflowCode", orchestrator_run_id AS "orchestratorRunId",
        user_id AS "userId", status, request_id AS "requestId", resource_type AS "resourceType",
        resource_id AS "resourceId", input_json AS "inputJson", output_json AS "outputJson",
        definition_id AS "definitionId", parent_run_id AS "parentRunId",
        parent_node_id AS "parentNodeId", call_depth AS "callDepth",
        continuation_json AS "continuationJson",
        error_message AS "errorMessage", duration_ms AS "durationMs", started_at AS "startedAt",
        finished_at AS "finishedAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM sys_ai_workflow_run WHERE id = ? AND user_id = ?`,
    )
    .get(input.id, input.userId)) as Record<string, unknown> | undefined;
  if (!row) return null;
  const steps = (await dbClient
    .prepare(
      `SELECT id, run_id AS "runId", step_no AS "stepNo", step_code AS "stepCode", status,
        input_json AS "inputJson", output_json AS "outputJson", error_message AS "errorMessage",
        duration_ms AS "durationMs", started_at AS "startedAt", finished_at AS "finishedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM sys_ai_workflow_run_step WHERE run_id = ? ORDER BY step_no ASC, id ASC`,
    )
    .all(input.id)) as Array<Record<string, unknown>>;
  const waits = await listAiWorkflowWaits({ runId: input.id, userId: input.userId, dbClient });
  return { ...hydrateRun(row), continuation: parseJson(row.continuationJson), steps: steps.map(hydrateStep), waits };
}
