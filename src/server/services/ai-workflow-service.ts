import { randomUUID } from "node:crypto";
import { sqlite, type DbClient } from "@/server/db";

export type AiWorkflowRunStatus =
  | "queued"
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

export type AiWorkflowStepStatus = "running" | "suspended" | "completed" | "failed" | "skipped";

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

export async function createAiWorkflowRun(input: {
  workflowCode: string;
  userId: number;
  requestId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  workflowInput: unknown;
  initialStatus?: "queued" | "running";
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const orchestratorRunId = `admin-base-workflow-${randomUUID()}`;
  const result = await dbClient
    .prepare(
      `INSERT INTO sys_ai_workflow_run
        (workflow_code, orchestrator_run_id, user_id, status, request_id, resource_type,
         resource_id, input_json, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'running' THEN now() ELSE NULL END)
       RETURNING id`,
    )
    .run(
      input.workflowCode,
      orchestratorRunId,
      input.userId,
      input.initialStatus ?? "running",
      input.requestId ?? null,
      input.resourceType ?? null,
      input.resourceId ?? null,
      toJson(input.workflowInput),
      input.initialStatus ?? "running",
    );
  return { id: Number(result.lastInsertRowid), orchestratorRunId };
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
  return { ...hydrateRun(row), steps: steps.map(hydrateStep) };
}
