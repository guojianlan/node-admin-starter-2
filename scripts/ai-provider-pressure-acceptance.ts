import "../src/server/load-dotenv";

import crypto from "node:crypto";
import { closeDb, sqlite } from "../src/server/db";
import { generateAiText } from "../src/server/services/ai-runtime-service";

const confirmation = process.env.ADMIN_BASE_REAL_PROVIDER_ACCEPTANCE;
const concurrency = Math.min(Math.max(Number(process.env.AI_PROVIDER_ACCEPTANCE_CONCURRENCY ?? 5), 1), 5);
const maxOutputTokens = Math.min(Math.max(Number(process.env.AI_PROVIDER_ACCEPTANCE_MAX_OUTPUT_TOKENS ?? 64), 16), 128);

if (confirmation !== "I_ACCEPT_PROVIDER_COST") {
  throw new Error(
    "Real Provider acceptance has a cost. Set ADMIN_BASE_REAL_PROVIDER_ACCEPTANCE=I_ACCEPT_PROVIDER_COST to run it.",
  );
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(Math.ceil(sorted.length * ratio) - 1, sorted.length - 1)];
}

const batchId = `provider-pressure-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const results = await Promise.allSettled(
  Array.from({ length: concurrency }, (_, index) =>
    generateAiText({
      purpose: "chat",
      input: `只回复 ACCEPT-${index + 1}，不要添加其他内容。`,
      maxOutputTokens,
      temperature: 0,
      trace: {
        sourceType: "provider_pressure_acceptance",
        sourceId: `${batchId}:${index + 1}`,
        requestId: `${batchId}:${index + 1}`,
        userId: 1,
      },
    }),
  ),
);

const invocationRows = (await sqlite
  .prepare(
    `SELECT invocation.id, invocation.status, invocation.duration_ms AS "durationMs",
      invocation.attempt_count AS "attemptCount", invocation.input_tokens AS "inputTokens",
      invocation.output_tokens AS "outputTokens", invocation.estimated_cost AS "estimatedCost",
      MIN(attempt.provider_id)::int AS "providerId",
      COALESCE(invocation.resolved_model_id, MIN(attempt.model_id))::int AS "modelId",
      invocation.error_type AS "errorType",
      COUNT(attempt.id)::int AS "persistedAttemptCount",
      COUNT(attempt.id) FILTER (WHERE attempt.status = 'completed')::int AS "completedAttemptCount"
     FROM sys_ai_invocation invocation
     LEFT JOIN sys_ai_invocation_attempt attempt ON attempt.invocation_id = invocation.id
     WHERE invocation.request_id LIKE ?
     GROUP BY invocation.id ORDER BY invocation.id`,
  )
  .all(`${batchId}:%`)) as Array<{
  id: number;
  status: string;
  durationMs: number;
  attemptCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: string | number;
  providerId: number;
  modelId: number;
  errorType: string | null;
  persistedAttemptCount: number;
  completedAttemptCount: number;
}>;

const successful = results.filter((result) => result.status === "fulfilled");
const failed = results.filter((result) => result.status === "rejected");
const latencies = invocationRows.map((row) => Number(row.durationMs)).filter(Number.isFinite);
const stuckCount = invocationRows.filter((row) => ["pending", "running"].includes(row.status)).length;
const providerIds = [...new Set(invocationRows.map((row) => Number(row.providerId)))];
const modelIds = [...new Set(invocationRows.map((row) => Number(row.modelId)))];

const summary = {
  success: failed.length === 0 && invocationRows.length === concurrency && stuckCount === 0,
  batchId,
  requested: concurrency,
  completed: successful.length,
  failed: failed.length,
  p50Ms: percentile(latencies, 0.5),
  p95Ms: percentile(latencies, 0.95),
  providerIds,
  modelIds,
  invocationCount: invocationRows.length,
  attemptCount: invocationRows.reduce((total, row) => total + Number(row.persistedAttemptCount), 0),
  fallbackInvocationCount: invocationRows.filter((row) => Number(row.attemptCount) > 1).length,
  totalInputTokens: invocationRows.reduce((total, row) => total + Number(row.inputTokens ?? 0), 0),
  totalOutputTokens: invocationRows.reduce((total, row) => total + Number(row.outputTokens ?? 0), 0),
  estimatedCost: invocationRows.reduce((total, row) => total + Number(row.estimatedCost ?? 0), 0),
  stuckCount,
  persistedErrorTypes: [...new Set(invocationRows.map((row) => row.errorType).filter(Boolean))],
  failureTypes: failed.map((result) =>
    result.status === "rejected"
      ? result.reason instanceof Error
        ? result.reason.name
        : "UnknownError"
      : null,
  ),
};

console.log(JSON.stringify(summary, null, 2));
await closeDb();

if (!summary.success) process.exitCode = 1;
