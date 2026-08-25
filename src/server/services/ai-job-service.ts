import crypto from "node:crypto";
import { sqlite } from "@/server/db";

export const aiJobTypes = ["notebook_artifact", "eval_dataset", "notebook_deep_research"] as const;
export type AiJobType = (typeof aiJobTypes)[number];

export async function enqueueAiJob(input: {
  jobType: AiJobType;
  payload: Record<string, unknown>;
  userId: number;
  resourceType?: string;
  resourceId?: string | number;
  requestId?: string;
  priority?: number;
  maxAttempts?: number;
  idempotencyKey?: string;
}) {
  const idempotencyKey = input.idempotencyKey?.trim() || crypto.randomUUID();
  const result = await sqlite
    .prepare(
      `INSERT INTO sys_ai_job
       (job_type, payload_json, status, priority, max_attempts, idempotency_key,
        user_id, resource_type, resource_id, request_id)
       VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING id`,
    )
    .run(
      input.jobType,
      JSON.stringify(input.payload),
      input.priority ?? 100,
      input.maxAttempts ?? 3,
      idempotencyKey,
      input.userId,
      input.resourceType ?? null,
      input.resourceId == null ? null : String(input.resourceId),
      input.requestId ?? null,
    );
  if (result.lastInsertRowid) return Number(result.lastInsertRowid);
  const existing = (await sqlite
    .prepare("SELECT id FROM sys_ai_job WHERE idempotency_key = ?")
    .get(idempotencyKey)) as { id: number };
  return existing.id;
}

type ClaimedJob = {
  id: number;
  jobType: AiJobType;
  payloadJson: string;
  attempts: number;
  maxAttempts: number;
  userId: number | null;
  requestId: string | null;
};

export async function claimAiJob(workerId: string, leaseSeconds = 120) {
  return sqlite.transaction(async (tx) => {
    const row = (await tx
      .prepare(
        `SELECT id FROM sys_ai_job
         WHERE (
           (status = 'queued' AND available_at <= now()) OR
           (status = 'running' AND lease_until <= now())
         ) AND attempts < max_attempts
         ORDER BY priority ASC, id ASC
         FOR UPDATE SKIP LOCKED LIMIT 1`,
      )
      .get()) as { id: number } | undefined;
    if (!row) return null;
    return (await tx
      .prepare(
        `UPDATE sys_ai_job SET status = 'running', attempts = attempts + 1, locked_by = ?,
         lease_until = now() + (? * interval '1 second'), started_at = COALESCE(started_at, now()),
         updated_at = now() WHERE id = ?
         RETURNING id, job_type AS "jobType", payload_json AS "payloadJson", attempts,
         max_attempts AS "maxAttempts", user_id AS "userId", request_id AS "requestId"`,
      )
      .get(workerId, leaseSeconds, row.id)) as ClaimedJob;
  });
}

async function renewAiJobLease(jobId: number, workerId: string, leaseSeconds: number) {
  const result = await sqlite
    .prepare(
      `UPDATE sys_ai_job SET lease_until = now() + (? * interval '1 second'), updated_at = now()
       WHERE id = ? AND status = 'running' AND locked_by = ? RETURNING id`,
    )
    .run(leaseSeconds, jobId, workerId);
  return result.changes > 0;
}

async function getAiJobStatus(jobId: number) {
  const row = (await sqlite.prepare("SELECT status FROM sys_ai_job WHERE id = ?").get(jobId)) as
    | { status: string }
    | undefined;
  return row?.status ?? "missing";
}

async function executeAiJob(job: ClaimedJob) {
  const payload = JSON.parse(job.payloadJson) as Record<string, unknown>;
  if (!job.userId) throw new Error("AI Job 缺少发起用户");
  if (job.jobType === "notebook_artifact") {
    const { createAiNotebookArtifact } = await import("./ai-notebook-service");
    return createAiNotebookArtifact({
      notebookId: Number(payload.notebookId),
      artifactType: String(payload.artifactType) as "summary" | "outline" | "faq" | "brief",
      title: payload.title ? String(payload.title) : null,
      customPrompt: payload.customPrompt ? String(payload.customPrompt) : null,
      userId: job.userId,
      requestId: job.requestId ?? undefined,
    });
  }
  if (job.jobType === "eval_dataset") {
    const { executeAiEvalDataset } = await import("./ai-eval-service");
    return executeAiEvalDataset({
      datasetId: Number(payload.datasetId),
      userId: job.userId,
      abilities: Array.isArray(payload.abilities) ? payload.abilities.map(String) : [],
      requestId: job.requestId ?? undefined,
    });
  }
  if (job.jobType === "notebook_deep_research") {
    const { executeAiNotebookDeepResearch } = await import("./ai-notebook-research-service");
    return executeAiNotebookDeepResearch({
      workflowRunId: Number(payload.workflowRunId),
      userId: job.userId,
      requestId: job.requestId ?? undefined,
    });
  }
  throw new Error(`未注册的 AI Job 类型：${job.jobType}`);
}

export async function processNextAiJob(workerId: string, leaseSeconds = 120) {
  const job = await claimAiJob(workerId, leaseSeconds);
  if (!job) return null;
  const heartbeat = setInterval(
    () => void renewAiJobLease(job.id, workerId, leaseSeconds).catch(() => undefined),
    Math.max(1000, Math.floor((leaseSeconds * 1000) / 3)),
  );
  try {
    const result = await executeAiJob(job);
    const completed = await sqlite
      .prepare(
        `UPDATE sys_ai_job SET status = 'completed', result_json = ?, error_message = NULL,
         locked_by = NULL, lease_until = NULL, finished_at = now(), updated_at = now()
         WHERE id = ? AND status = 'running' AND locked_by = ? RETURNING id`,
      )
      .run(JSON.stringify(result ?? null), job.id, workerId);
    return {
      id: job.id,
      status: completed.changes > 0 ? ("completed" as const) : await getAiJobStatus(job.id),
    };
  } catch (error) {
    const terminal = job.attempts >= job.maxAttempts;
    const delaySeconds = Math.min(300, 2 ** Math.max(0, job.attempts - 1) * 5);
    const updated = await sqlite
      .prepare(
        `UPDATE sys_ai_job SET status = ?, error_message = ?, locked_by = NULL,
         lease_until = NULL, available_at = now() + (? * interval '1 second'),
         finished_at = CASE WHEN ? THEN now() ELSE NULL END, updated_at = now()
         WHERE id = ? AND status = 'running' AND locked_by = ? RETURNING id`,
      )
      .run(
        terminal ? "failed" : "queued",
        (error instanceof Error ? error.message : String(error)).slice(0, 2000),
        delaySeconds,
        terminal,
        job.id,
        workerId,
      );
    return {
      id: job.id,
      status:
        updated.changes > 0
          ? terminal
            ? ("failed" as const)
            : ("queued" as const)
          : await getAiJobStatus(job.id),
    };
  } finally {
    clearInterval(heartbeat);
  }
}

export async function runAiWorker(input: {
  workerId?: string;
  once?: boolean;
  pollMs?: number;
  signal?: AbortSignal;
}) {
  const workerId = input.workerId ?? `ai-worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  do {
    const result = await processNextAiJob(workerId);
    if (input.once) return result;
    if (!result) {
      await new Promise((resolve) => setTimeout(resolve, input.pollMs ?? 1000));
    }
  } while (!input.signal?.aborted);
  return null;
}
