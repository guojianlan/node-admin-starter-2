import crypto from "node:crypto";
import { sqlite } from "@/server/db";
import { getAdminBaseEnv } from "@/server/env";

export const aiJobTypes = [
  "notebook_artifact",
  "eval_dataset",
  "notebook_deep_research",
  "knowledge_parser",
  "workflow_resume",
] as const;
export type AiJobType = (typeof aiJobTypes)[number];

export type AiWorkerQueueHealth = {
  status: "healthy" | "degraded";
  stalledAfterSeconds: number;
  queuedCount: number;
  stalledQueuedCount: number;
  expiredLeaseCount: number;
  oldestQueuedAt: string | null;
  oldestQueueAgeSeconds: number;
  checkedAt: string;
};

export async function getAiWorkerQueueHealth(
  stalledAfterSeconds = getAdminBaseEnv().aiWorkerStalledAfterSeconds,
): Promise<AiWorkerQueueHealth> {
  const threshold = Math.min(Math.max(Math.round(stalledAfterSeconds), 10), 86_400);
  const row = (await sqlite
    .prepare(
      `SELECT
         (COUNT(*) FILTER (
           WHERE status = 'queued' AND available_at <= now() AND attempts < max_attempts
         ))::int AS "queuedCount",
         (COUNT(*) FILTER (
           WHERE status = 'queued' AND available_at <= now() - (? * interval '1 second')
             AND attempts < max_attempts
         ))::int AS "stalledQueuedCount",
         (COUNT(*) FILTER (
           WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until <= now()
         ))::int AS "expiredLeaseCount",
         MIN(available_at) FILTER (
           WHERE status = 'queued' AND available_at <= now() AND attempts < max_attempts
         ) AS "oldestQueuedAt",
         COALESCE(EXTRACT(EPOCH FROM (
           now() - MIN(available_at) FILTER (
             WHERE status = 'queued' AND available_at <= now() AND attempts < max_attempts
           )
         ))::int, 0) AS "oldestQueueAgeSeconds",
         now() AS "checkedAt"
       FROM sys_ai_job`,
    )
    .get(threshold)) as {
    queuedCount: number;
    stalledQueuedCount: number;
    expiredLeaseCount: number;
    oldestQueuedAt: string | null;
    oldestQueueAgeSeconds: number;
    checkedAt: string;
  };
  const stalledQueuedCount = Number(row.stalledQueuedCount);
  const expiredLeaseCount = Number(row.expiredLeaseCount);
  return {
    status: stalledQueuedCount > 0 || expiredLeaseCount > 0 ? "degraded" : "healthy",
    stalledAfterSeconds: threshold,
    queuedCount: Number(row.queuedCount),
    stalledQueuedCount,
    expiredLeaseCount,
    oldestQueuedAt: row.oldestQueuedAt,
    oldestQueueAgeSeconds: Number(row.oldestQueueAgeSeconds),
    checkedAt: row.checkedAt,
  };
}

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
  availableAt?: string | Date;
}) {
  const idempotencyKey = input.idempotencyKey?.trim() || crypto.randomUUID();
  const result = await sqlite
    .prepare(
      `INSERT INTO sys_ai_job
       (job_type, payload_json, status, priority, max_attempts, idempotency_key,
        user_id, resource_type, resource_id, request_id, available_at)
       VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, COALESCE(?, now()))
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
      input.availableAt instanceof Date ? input.availableAt.toISOString() : input.availableAt ?? null,
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
  if (job.jobType === "knowledge_parser") {
    const { indexKnowledgeDocument } = await import("./ai-knowledge-service");
    return indexKnowledgeDocument({
      documentId: Number(payload.documentId),
      userId: job.userId,
      requestId: job.requestId ?? undefined,
      expectedDocumentVersion:
        payload.expectedDocumentVersion == null
          ? undefined
          : Number(payload.expectedDocumentVersion),
    });
  }
  if (job.jobType === "workflow_resume") {
    const { resumeVisualWorkflow } = await import("./ai-visual-workflow-service");
    return resumeVisualWorkflow({
      runId: Number(payload.runId),
      userId: job.userId,
      waitId: payload.waitId == null ? undefined : Number(payload.waitId),
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
    const { maintainAiMemoryState } = await import("./ai-governance-service");
    await maintainAiMemoryState().catch(() => undefined);
    // Agent Runs and background jobs share one long-running worker process, but keep
    // independent leases so a slow parser cannot block an expired Agent takeover.
    const { processNextAgentRun } = await import("./ai-agent-worker-service");
    const agentResult = await processNextAgentRun(`${workerId}:agent`);
    const result = agentResult ?? (await processNextAiJob(workerId));
    if (input.once) return result;
    if (!result) {
      await new Promise((resolve) => setTimeout(resolve, input.pollMs ?? 1000));
    }
  } while (!input.signal?.aborted);
  return null;
}
