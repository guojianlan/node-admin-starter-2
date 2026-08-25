import type { LanguageModel } from "ai";
import { sqlite, type DbClient } from "@/server/db";
import {
  AiRuntimeConfigurationError,
  getAiRuntimeConfig,
  type AiModelUsage,
  type AiProviderRuntimeConfig,
} from "./ai-provider-service";
import {
  acquireAiCircuitPermission,
  assertAiQuotaAvailable,
  createAiBillingUsageEntry,
  recordAiCircuitAttemptResult,
} from "./ai-governance-service";

export const aiModelPurposes = [
  "chat",
  "structured",
  "embedding",
  "rerank",
  "agent",
  "ragAnswer",
  "evalJudge",
] as const;

export type AiModelPurpose = (typeof aiModelPurposes)[number];
export type AiInvocationStatus = "running" | "completed" | "failed" | "aborted";

export type AiInvocationTrace = {
  purpose: AiModelPurpose;
  sourceType: string;
  sourceId?: string | number | null;
  requestId?: string | null;
  userId?: number | null;
  sessionId?: number | null;
  runId?: number | null;
  stepId?: number | null;
};

export type AiTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};

type PurposeModelRow = {
  purpose: AiModelPurpose;
  modelId: number;
  priority: number;
};

const purposeUsage: Record<AiModelPurpose, AiModelUsage> = {
  chat: "chat",
  structured: "structured",
  embedding: "embedding",
  rerank: "rerank",
  agent: "chat",
  ragAnswer: "chat",
  evalJudge: "structured",
};

function parseCapabilities(value?: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function expectedModelType(purpose: AiModelPurpose) {
  if (purpose === "embedding") return "embedding";
  if (purpose === "rerank") return "rerank";
  return "chat";
}

function assertPurposeModelCompatible(
  purpose: AiModelPurpose,
  model: {
    modelType: string;
    capabilitiesJson?: string | null;
    capabilities?: Record<string, unknown>;
  },
) {
  const expected = expectedModelType(purpose);
  if (model.modelType !== expected) {
    throw new AiRuntimeConfigurationError(`${purpose} 用途需要 ${expected} 类型模型`);
  }
  const capabilities = model.capabilities ?? parseCapabilities(model.capabilitiesJson);
  if (purpose === "agent" && capabilities.toolCalling !== true) {
    throw new AiRuntimeConfigurationError(
      "当前 Agent 模型未启用工具调用能力，请在“模型管理”中勾选“工具调用 / Agent”，并在“运行与追踪”中配置 Agent 用途模型",
    );
  }
  if (purpose === "structured" && capabilities.structured === false) {
    throw new AiRuntimeConfigurationError("Structured 用途不能选择明确禁用结构化输出的模型");
  }
}

export async function listAiPurposeRoutes(dbClient: DbClient = sqlite) {
  const routes = (await dbClient
    .prepare(
      `SELECT purpose, name, description, status, updated_at AS "updatedAt"
       FROM sys_ai_purpose_route ORDER BY
       CASE purpose
         WHEN 'chat' THEN 1 WHEN 'agent' THEN 2 WHEN 'structured' THEN 3
         WHEN 'embedding' THEN 4 WHEN 'ragAnswer' THEN 5 WHEN 'rerank' THEN 6 ELSE 7
       END`,
    )
    .all()) as Array<Record<string, unknown> & { purpose: AiModelPurpose }>;
  const candidates = (await dbClient
    .prepare(
      `SELECT pm.purpose, pm.model_id AS "modelId", pm.priority,
        m.name AS "modelName", m.model_id AS "modelIdentifier", m.model_type AS "modelType",
        m.capabilities_json AS "capabilitiesJson", m.status AS "modelStatus",
        p.id AS "providerId", p.name AS "providerName", p.code AS "providerCode",
        p.status AS "providerStatus"
       FROM sys_ai_purpose_model pm
       INNER JOIN sys_ai_model m ON m.id = pm.model_id
       INNER JOIN sys_ai_provider p ON p.id = m.provider_id
       WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL
       ORDER BY pm.purpose, pm.priority`,
    )
    .all()) as Array<Record<string, unknown> & { purpose: AiModelPurpose }>;
  return routes.map((route) => ({
    ...route,
    candidates: candidates.filter((candidate) => candidate.purpose === route.purpose),
  }));
}

export async function listAiPurposeModelOptions(dbClient: DbClient = sqlite) {
  return dbClient
    .prepare(
      `SELECT m.id, m.name, m.model_id AS "modelId", m.model_type AS "modelType",
        m.capabilities_json AS "capabilitiesJson", m.context_window AS "contextWindow",
        m.max_output_tokens AS "maxOutputTokens", p.id AS "providerId",
        p.name AS "providerName", p.code AS "providerCode"
       FROM sys_ai_model m
       INNER JOIN sys_ai_provider p ON p.id = m.provider_id
       WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND m.status = 1 AND p.status = 1
       ORDER BY p.sort ASC, m.sort ASC, m.id ASC`,
    )
    .all();
}

export async function saveAiPurposeRoute(input: {
  purpose: AiModelPurpose;
  modelIds: number[];
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const modelIds = [...new Set(input.modelIds.map(Number))];
  if (modelIds.length === 0) throw new Error("每个用途至少配置一个主模型");
  if (modelIds.length > 5) throw new Error("每个用途最多配置 5 个候选模型");
  const placeholders = modelIds.map(() => "?").join(", ");
  const models = (await dbClient
    .prepare(
      `SELECT m.id, m.model_type AS "modelType", m.capabilities_json AS "capabilitiesJson",
        m.status, p.status AS "providerStatus"
       FROM sys_ai_model m INNER JOIN sys_ai_provider p ON p.id = m.provider_id
       WHERE m.id IN (${placeholders}) AND m.deleted_at IS NULL AND p.deleted_at IS NULL`,
    )
    .all(...modelIds)) as Array<{
    id: number;
    modelType: string;
    capabilitiesJson: string | null;
    status: number;
    providerStatus: number;
  }>;
  if (models.length !== modelIds.length) throw new Error("候选模型不存在或已删除");
  for (const modelId of modelIds) {
    const model = models.find((item) => Number(item.id) === modelId);
    if (!model || model.status !== 1 || model.providerStatus !== 1) {
      throw new Error("候选模型及其服务商必须处于启用状态");
    }
    assertPurposeModelCompatible(input.purpose, model);
  }
  await dbClient.prepare("DELETE FROM sys_ai_purpose_model WHERE purpose = ?").run(input.purpose);
  for (const [index, modelId] of modelIds.entries()) {
    await dbClient
      .prepare(
        `INSERT INTO sys_ai_purpose_model (purpose, model_id, priority, created_by)
         VALUES (?, ?, ?, ?)`,
      )
      .run(input.purpose, modelId, index + 1, input.userId);
  }
  await dbClient
    .prepare("UPDATE sys_ai_purpose_route SET updated_by = ?, updated_at = now() WHERE purpose = ?")
    .run(input.userId, input.purpose);
}

export async function resolveAiRuntimeCandidates(input: {
  purpose: AiModelPurpose;
  modelId?: number | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const configured = (await dbClient
    .prepare(
      `SELECT pm.purpose, pm.model_id AS "modelId", pm.priority
       FROM sys_ai_purpose_model pm
       INNER JOIN sys_ai_purpose_route route ON route.purpose = pm.purpose AND route.status = 1
       INNER JOIN sys_ai_model m ON m.id = pm.model_id AND m.deleted_at IS NULL AND m.status = 1
       INNER JOIN sys_ai_provider p ON p.id = m.provider_id AND p.deleted_at IS NULL AND p.status = 1
       WHERE pm.purpose = ? ORDER BY pm.priority ASC`,
    )
    .all(input.purpose)) as PurposeModelRow[];
  const ids = [
    ...(input.modelId ? [Number(input.modelId)] : []),
    ...configured.map((item) => Number(item.modelId)),
  ].filter((id, index, values) => values.indexOf(id) === index);
  if (ids.length === 0) {
    const legacy = await getAiRuntimeConfig(purposeUsage[input.purpose]);
    assertPurposeModelCompatible(input.purpose, legacy.model);
    return [legacy];
  }
  const candidates: AiProviderRuntimeConfig[] = [];
  const errors: string[] = [];
  for (const id of ids) {
    try {
      const config = await getAiRuntimeConfig(purposeUsage[input.purpose], id);
      assertPurposeModelCompatible(input.purpose, config.model);
      candidates.push(config);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (candidates.length === 0) {
    throw new AiRuntimeConfigurationError(errors[0] || `${input.purpose} 用途没有可用模型`);
  }
  const available: AiProviderRuntimeConfig[] = [];
  for (const candidate of candidates) {
    if (
      await acquireAiCircuitPermission({
        providerId: candidate.provider.id,
        purpose: input.purpose,
        dbClient,
      })
    ) {
      available.push(candidate);
    }
  }
  if (!available.length) {
    throw new AiRuntimeConfigurationError(`${input.purpose} 用途的候选 Provider 均处于熔断状态`);
  }
  return available;
}

export async function hasEnabledAiPurposeModels(
  purpose: AiModelPurpose,
  dbClient: DbClient = sqlite,
) {
  const row = (await dbClient
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM sys_ai_purpose_model pm
         INNER JOIN sys_ai_purpose_route route
           ON route.purpose = pm.purpose AND route.status = 1
         INNER JOIN sys_ai_model m
           ON m.id = pm.model_id AND m.deleted_at IS NULL AND m.status = 1
         INNER JOIN sys_ai_provider p
           ON p.id = m.provider_id AND p.deleted_at IS NULL AND p.status = 1
         WHERE pm.purpose = ?
       ) AS "configured"`,
    )
    .get(purpose)) as { configured?: boolean | number } | undefined;
  return row?.configured === true || Number(row?.configured) === 1;
}

export function normalizeAiTokenUsage(usage: unknown): AiTokenUsage {
  const source = usage && typeof usage === "object" ? (usage as Record<string, unknown>) : {};
  const readNumber = (record: Record<string, unknown>, ...keys: string[]) => {
    for (const key of keys) {
      const value = Number(record[key]);
      if (Number.isFinite(value) && value >= 0) return Math.round(value);
    }
    return 0;
  };
  const inputTokenDetails =
    source.inputTokenDetails && typeof source.inputTokenDetails === "object"
      ? (source.inputTokenDetails as Record<string, unknown>)
      : {};
  return {
    inputTokens: readNumber(
      source,
      "inputTokens",
      "promptTokens",
      "input_tokens",
      "totalTokens",
      "total_tokens",
      "tokens",
    ),
    outputTokens: readNumber(source, "outputTokens", "completionTokens", "output_tokens"),
    cachedInputTokens:
      readNumber(inputTokenDetails, "cacheReadTokens") ||
      readNumber(source, "cachedInputTokens", "cachedPromptTokens", "cacheReadTokens"),
    cacheWriteTokens:
      readNumber(inputTokenDetails, "cacheWriteTokens") ||
      readNumber(source, "cacheWriteTokens", "cacheCreationInputTokens"),
  };
}

function decimalPrice(value?: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function estimateAiCost(config: AiProviderRuntimeConfig, usage: AiTokenUsage) {
  const inputPrice = decimalPrice(config.model.inputPrice);
  const cachedInputPrice = decimalPrice(config.model.cachedInputPrice);
  const cacheWritePrice = decimalPrice(config.model.cacheWritePrice);
  const outputPrice = decimalPrice(config.model.outputPrice);
  if (
    inputPrice == null &&
    cachedInputPrice == null &&
    cacheWritePrice == null &&
    outputPrice == null
  ) {
    return null;
  }
  const cachedInputTokens = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const cacheWriteTokens = Math.min(
    usage.cacheWriteTokens,
    Math.max(usage.inputTokens - cachedInputTokens, 0),
  );
  const regularInputTokens = Math.max(usage.inputTokens - cachedInputTokens - cacheWriteTokens, 0);
  const cost =
    (regularInputTokens / 1_000_000) * (inputPrice ?? 0) +
    (cachedInputTokens / 1_000_000) * (cachedInputPrice ?? inputPrice ?? 0) +
    (cacheWriteTokens / 1_000_000) * (cacheWritePrice ?? inputPrice ?? 0) +
    (usage.outputTokens / 1_000_000) * (outputPrice ?? 0);
  return cost.toFixed(8);
}

export function classifyAiError(error: unknown) {
  const name = error instanceof Error ? error.name : "Error";
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]")
    .slice(0, 1000);
  const lower = `${name} ${raw}`.toLowerCase();
  const type = lower.includes("abort")
    ? "aborted"
    : lower.includes("timeout")
      ? "timeout"
      : lower.includes("429") || lower.includes("rate limit")
        ? "rate_limit"
        : lower.includes("401") || lower.includes("403") || lower.includes("auth")
          ? "authentication"
          : lower.includes("network") || lower.includes("fetch")
            ? "network"
            : "provider_error";
  return { type, message };
}

export async function beginAiInvocation(input: AiInvocationTrace & { modelId?: number | null }) {
  await assertAiQuotaAvailable(input.userId);
  const result = await sqlite
    .prepare(
      `INSERT INTO sys_ai_invocation
       (purpose, source_type, source_id, request_id, user_id, session_id, run_id, step_id,
        requested_model_id, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', now()) RETURNING id`,
    )
    .run(
      input.purpose,
      input.sourceType,
      input.sourceId == null ? null : String(input.sourceId),
      input.requestId ?? null,
      input.userId ?? null,
      input.sessionId ?? null,
      input.runId ?? null,
      input.stepId ?? null,
      input.modelId ?? null,
    );
  return Number(result.lastInsertRowid);
}

export async function beginAiInvocationAttempt(input: {
  invocationId: number;
  attemptNo: number;
  config: AiProviderRuntimeConfig;
}) {
  const result = await sqlite
    .prepare(
      `INSERT INTO sys_ai_invocation_attempt
       (invocation_id, attempt_no, provider_id, model_id, provider_code, provider_name,
        model_identifier, model_name, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', now()) RETURNING id`,
    )
    .run(
      input.invocationId,
      input.attemptNo,
      input.config.provider.id,
      input.config.model.id,
      input.config.provider.code,
      input.config.provider.name,
      input.config.model.modelId,
      input.config.model.name,
    );
  await sqlite
    .prepare("UPDATE sys_ai_invocation SET attempt_count = ? WHERE id = ?")
    .run(input.attemptNo, input.invocationId);
  return Number(result.lastInsertRowid);
}

export async function finishAiInvocationAttempt(input: {
  id: number;
  status: AiInvocationStatus;
  config: AiProviderRuntimeConfig;
  usage?: unknown;
  latencyMs: number;
  firstTokenMs?: number | null;
  error?: unknown;
}) {
  const usage = normalizeAiTokenUsage(input.usage);
  const error = input.error == null ? null : classifyAiError(input.error);
  await sqlite
    .prepare(
      `UPDATE sys_ai_invocation_attempt SET status = ?, input_tokens = ?, output_tokens = ?,
       cached_input_tokens = ?, cache_write_tokens = ?, estimated_cost = ?, currency = ?, latency_ms = ?, first_token_ms = ?,
       error_type = ?, error_message = ?, finished_at = now() WHERE id = ?`,
    )
    .run(
      input.status,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens,
      usage.cacheWriteTokens,
      estimateAiCost(input.config, usage),
      input.config.model.currency,
      input.latencyMs,
      input.firstTokenMs ?? null,
      error?.type ?? null,
      error?.message ?? null,
      input.id,
    );
  await recordAiCircuitAttemptResult({
    attemptId: input.id,
    success: input.status === "completed",
    errorType: error?.type,
  });
  return usage;
}

export async function finishAiInvocation(input: {
  id: number;
  status: AiInvocationStatus;
  config?: AiProviderRuntimeConfig | null;
  attemptCount: number;
  usage?: unknown;
  durationMs: number;
  error?: unknown;
}) {
  const usage = normalizeAiTokenUsage(input.usage);
  const error = input.error == null ? null : classifyAiError(input.error);
  await sqlite
    .prepare(
      `UPDATE sys_ai_invocation SET status = ?, resolved_model_id = ?, attempt_count = ?,
       fallback_used = ?, input_tokens = ?, output_tokens = ?, cached_input_tokens = ?,
       cache_write_tokens = ?, estimated_cost = ?, currency = ?, duration_ms = ?, error_type = ?, error_message = ?,
       finished_at = now() WHERE id = ?`,
    )
    .run(
      input.status,
      input.config?.model.id ?? null,
      input.attemptCount,
      input.attemptCount > 1,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens,
      usage.cacheWriteTokens,
      input.config ? estimateAiCost(input.config, usage) : null,
      input.config?.model.currency ?? null,
      input.durationMs,
      error?.type ?? null,
      error?.message ?? null,
      input.id,
    );
  if (input.status === "completed") await createAiBillingUsageEntry(input.id);
}

export async function runAiHealthCheck<T>(input: {
  provider: { id: number; code: string; name: string };
  model?: { id?: number | null; modelId: string; name?: string | null } | null;
  purpose: AiModelPurpose;
  requestId?: string | null;
  execute: () => Promise<T>;
}) {
  const startedAt = performance.now();
  const invocationId = await beginAiInvocation({
    purpose: input.purpose,
    sourceType: "health_check",
    sourceId: input.provider.id,
    requestId: input.requestId,
    modelId: input.model?.id ?? null,
  });
  const attempt = await sqlite
    .prepare(
      `INSERT INTO sys_ai_invocation_attempt
       (invocation_id, attempt_no, provider_id, model_id, provider_code, provider_name,
        model_identifier, model_name, status, started_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, 'running', now()) RETURNING id`,
    )
    .run(
      invocationId,
      input.provider.id,
      input.model?.id ?? null,
      input.provider.code,
      input.provider.name,
      input.model?.modelId ?? "provider-connection-test",
      input.model?.name || input.model?.modelId || "Provider 连接测试",
    );
  try {
    const result = await input.execute();
    const durationMs = Math.round(performance.now() - startedAt);
    await sqlite
      .prepare(
        `UPDATE sys_ai_invocation_attempt SET status = 'completed', latency_ms = ?,
         first_token_ms = ?, finished_at = now() WHERE id = ?`,
      )
      .run(durationMs, durationMs, attempt.lastInsertRowid);
    await sqlite
      .prepare(
        `UPDATE sys_ai_invocation SET status = 'completed', resolved_model_id = ?,
         attempt_count = 1, duration_ms = ?, finished_at = now() WHERE id = ?`,
      )
      .run(input.model?.id ?? null, durationMs, invocationId);
    return result;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    const sanitized = classifyAiError(error);
    await sqlite
      .prepare(
        `UPDATE sys_ai_invocation_attempt SET status = 'failed', latency_ms = ?,
         error_type = ?, error_message = ?, finished_at = now() WHERE id = ?`,
      )
      .run(durationMs, sanitized.type, sanitized.message, attempt.lastInsertRowid);
    await sqlite
      .prepare(
        `UPDATE sys_ai_invocation SET status = 'failed', resolved_model_id = ?,
         attempt_count = 1, duration_ms = ?, error_type = ?, error_message = ?,
         finished_at = now() WHERE id = ?`,
      )
      .run(input.model?.id ?? null, durationMs, sanitized.type, sanitized.message, invocationId);
    throw error;
  }
}

export async function executeAiWithFallback<T extends { usage?: unknown }>(input: {
  purpose: AiModelPurpose;
  modelId?: number | null;
  trace: Omit<AiInvocationTrace, "purpose">;
  abortSignal?: AbortSignal;
  execute: (config: AiProviderRuntimeConfig) => Promise<T>;
}) {
  const startedAt = performance.now();
  const candidates = await resolveAiRuntimeCandidates({
    purpose: input.purpose,
    modelId: input.modelId,
  });
  const invocationId = await beginAiInvocation({
    purpose: input.purpose,
    ...input.trace,
    modelId: input.modelId,
  });
  let lastError: unknown;
  for (const [index, config] of candidates.entries()) {
    const attemptStartedAt = performance.now();
    const attemptId = await beginAiInvocationAttempt({
      invocationId,
      attemptNo: index + 1,
      config,
    });
    try {
      const result = await input.execute(config);
      await finishAiInvocationAttempt({
        id: attemptId,
        status: "completed",
        config,
        usage: result.usage,
        latencyMs: Math.round(performance.now() - attemptStartedAt),
      });
      await finishAiInvocation({
        id: invocationId,
        status: "completed",
        config,
        attemptCount: index + 1,
        usage: result.usage,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return { result, config, invocationId, attemptCount: index + 1 };
    } catch (error) {
      lastError = error;
      const status = input.abortSignal?.aborted ? "aborted" : "failed";
      await finishAiInvocationAttempt({
        id: attemptId,
        status,
        config,
        latencyMs: Math.round(performance.now() - attemptStartedAt),
        error,
      });
      if (status === "aborted" || index === candidates.length - 1) {
        await finishAiInvocation({
          id: invocationId,
          status,
          config,
          attemptCount: index + 1,
          durationMs: Math.round(performance.now() - startedAt),
          error,
        });
        throw error;
      }
    }
  }
  throw lastError ?? new Error("AI Runtime 没有可用候选模型");
}

export async function listAiProviderHealth(input: { windowHours: number }) {
  return sqlite
    .prepare(
      `SELECT p.id, p.name, p.code, p.provider_type AS "providerType", p.status,
        COUNT(a.id) FILTER (WHERE i.source_type <> 'health_check')::int AS "businessCalls",
        COUNT(a.id) FILTER (WHERE i.source_type <> 'health_check' AND a.status = 'completed')::int
          AS "businessSuccesses",
        COUNT(a.id) FILTER (WHERE i.source_type = 'health_check')::int AS "healthChecks",
        ROUND(100.0 * COUNT(a.id) FILTER (WHERE i.source_type <> 'health_check' AND a.status = 'completed') /
          NULLIF(COUNT(a.id) FILTER (WHERE i.source_type <> 'health_check'), 0), 2) AS "successRate",
        ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY a.latency_ms)
          FILTER (WHERE i.source_type <> 'health_check' AND a.status = 'completed'))::int AS "p50LatencyMs",
        ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY a.latency_ms)
          FILTER (WHERE i.source_type <> 'health_check' AND a.status = 'completed'))::int AS "p95LatencyMs",
        MAX(a.finished_at) FILTER (WHERE a.status = 'completed') AS "lastSuccessAt",
        MAX(a.finished_at) FILTER (WHERE a.status = 'failed') AS "lastFailureAt",
        (ARRAY_AGG(a.error_type ORDER BY a.finished_at DESC)
          FILTER (WHERE a.status = 'failed'))[1] AS "lastErrorType"
       FROM sys_ai_provider p
       LEFT JOIN sys_ai_invocation_attempt a ON a.provider_id = p.id
         AND a.created_at >= now() - (? * interval '1 hour')
       LEFT JOIN sys_ai_invocation i ON i.id = a.invocation_id
       WHERE p.deleted_at IS NULL
       GROUP BY p.id ORDER BY p.sort ASC, p.id ASC`,
    )
    .all(input.windowHours);
}

export async function listAiInvocations(input: {
  page: number;
  pageSize: number;
  purpose?: string | null;
  status?: string | null;
  sourceType?: string | null;
  providerId?: number | null;
  requestId?: string | null;
}) {
  const offset = (input.page - 1) * input.pageSize;
  const params = [
    input.purpose ?? "",
    input.purpose ?? "",
    input.status ?? "",
    input.status ?? "",
    input.sourceType ?? "",
    input.sourceType ?? "",
    input.providerId ?? 0,
    input.providerId ?? 0,
    input.requestId ?? "",
    `%${input.requestId ?? ""}%`,
  ] as const;
  const where = `(? = '' OR i.purpose = ?) AND (? = '' OR i.status = ?)
    AND (? = '' OR i.source_type = ?) AND (? = 0 OR a.provider_id = ?)
    AND (? = '' OR i.request_id ILIKE ?)`;
  const count = (await sqlite
    .prepare(
      `SELECT COUNT(DISTINCT i.id)::int AS total FROM sys_ai_invocation i
       LEFT JOIN sys_ai_invocation_attempt a ON a.invocation_id = i.id WHERE ${where}`,
    )
    .get(...params)) as { total: number };
  const rows = await sqlite
    .prepare(
      `SELECT i.id, i.purpose, i.source_type AS "sourceType", i.source_id AS "sourceId",
        i.request_id AS "requestId", i.user_id AS "userId", u.username,
        i.session_id AS "sessionId", i.run_id AS "runId", i.status,
        i.attempt_count AS "attemptCount", i.fallback_used AS "fallbackUsed",
        i.input_tokens AS "inputTokens", i.output_tokens AS "outputTokens",
        i.cached_input_tokens AS "cachedInputTokens", i.estimated_cost AS "estimatedCost",
        i.cache_write_tokens AS "cacheWriteTokens",
        i.currency, i.duration_ms AS "durationMs", i.error_type AS "errorType",
        i.error_message AS "errorMessage", i.started_at AS "startedAt", i.finished_at AS "finishedAt",
        m.name AS "modelName", m.model_id AS "modelIdentifier",
        p.name AS "providerName", p.code AS "providerCode"
       FROM sys_ai_invocation i
       LEFT JOIN sys_user u ON u.id = i.user_id
       LEFT JOIN sys_ai_model m ON m.id = i.resolved_model_id
       LEFT JOIN sys_ai_provider p ON p.id = m.provider_id
       LEFT JOIN sys_ai_invocation_attempt a ON a.invocation_id = i.id
       WHERE ${where}
       GROUP BY i.id, u.username, m.name, m.model_id, p.name, p.code
       ORDER BY i.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, offset);
  return {
    data: rows,
    total: Number(count.total || 0),
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function getAiInvocationTrace(id: number) {
  const invocation = await sqlite
    .prepare(
      `SELECT i.*, u.username, m.name AS "modelName", m.model_id AS "modelIdentifier"
       FROM sys_ai_invocation i LEFT JOIN sys_user u ON u.id = i.user_id
       LEFT JOIN sys_ai_model m ON m.id = i.resolved_model_id WHERE i.id = ?`,
    )
    .get(id);
  if (!invocation) return null;
  const attempts = await sqlite
    .prepare(
      `SELECT id, attempt_no AS "attemptNo", provider_id AS "providerId", model_id AS "modelId",
        provider_code AS "providerCode", provider_name AS "providerName",
        model_identifier AS "modelIdentifier", model_name AS "modelName", status,
        input_tokens AS "inputTokens", output_tokens AS "outputTokens",
        cached_input_tokens AS "cachedInputTokens", estimated_cost AS "estimatedCost", currency,
        cache_write_tokens AS "cacheWriteTokens",
        latency_ms AS "latencyMs", first_token_ms AS "firstTokenMs", error_type AS "errorType",
        error_message AS "errorMessage", started_at AS "startedAt", finished_at AS "finishedAt"
       FROM sys_ai_invocation_attempt WHERE invocation_id = ? ORDER BY attempt_no ASC`,
    )
    .all(id);
  return { ...invocation, attempts };
}

type FallbackModelCandidate = {
  config: AiProviderRuntimeConfig;
  model: LanguageModel;
};

type CompatibleLanguageModel = {
  specificationVersion: "v3" | "v4";
  provider: string;
  modelId: string;
  supportedUrls: PromiseLike<Record<string, RegExp[]>> | Record<string, RegExp[]>;
  doGenerate(options: unknown): PromiseLike<unknown>;
  doStream(
    options: unknown,
  ): PromiseLike<{ stream: ReadableStream<unknown> } & Record<string, unknown>>;
};

function requireCompatibleLanguageModel(model: LanguageModel) {
  if (
    typeof model === "string" ||
    (model.specificationVersion !== "v3" && model.specificationVersion !== "v4")
  ) {
    throw new Error("有序失败回退当前要求 AI SDK LanguageModel v3 或 v4");
  }
  return model as unknown as CompatibleLanguageModel;
}

function streamUsage(part: unknown) {
  if (!part || typeof part !== "object") return undefined;
  const row = part as Record<string, unknown>;
  return row.type === "finish" ? row.usage : undefined;
}

function streamError(part: unknown) {
  if (!part || typeof part !== "object") return undefined;
  const row = part as Record<string, unknown>;
  return row.type === "error" ? row.error : undefined;
}

export function createAiFallbackLanguageModel(input: {
  purpose: AiModelPurpose;
  candidates: FallbackModelCandidate[];
  trace: Omit<AiInvocationTrace, "purpose">;
}) {
  if (input.candidates.length === 0) throw new Error("AI Runtime 没有可用候选模型");
  const models = input.candidates.map((candidate) => ({
    ...candidate,
    model: requireCompatibleLanguageModel(candidate.model),
  }));
  const primary = models[0].model;

  const begin = () =>
    beginAiInvocation({
      purpose: input.purpose,
      sourceType: input.trace.sourceType,
      sourceId: input.trace.sourceId,
      requestId: input.trace.requestId,
      userId: input.trace.userId,
      sessionId: input.trace.sessionId,
      runId: input.trace.runId,
      stepId: input.trace.stepId,
      modelId: models[0].config.model.id,
    });

  const fallbackModel: CompatibleLanguageModel = {
    specificationVersion: primary.specificationVersion,
    provider: "admin-base-fallback",
    modelId: models.map((item) => item.config.model.modelId).join(" -> "),
    supportedUrls: primary.supportedUrls,
    async doGenerate(options) {
      const startedAt = performance.now();
      const invocationId = await begin();
      let lastError: unknown;
      for (const [index, candidate] of models.entries()) {
        const attemptStartedAt = performance.now();
        const attemptId = await beginAiInvocationAttempt({
          invocationId,
          attemptNo: index + 1,
          config: candidate.config,
        });
        try {
          const result = (await candidate.model.doGenerate(options)) as Record<string, unknown>;
          await finishAiInvocationAttempt({
            id: attemptId,
            status: "completed",
            config: candidate.config,
            usage: result.usage,
            latencyMs: Math.round(performance.now() - attemptStartedAt),
          });
          await finishAiInvocation({
            id: invocationId,
            status: "completed",
            config: candidate.config,
            attemptCount: index + 1,
            usage: result.usage,
            durationMs: Math.round(performance.now() - startedAt),
          });
          return result;
        } catch (error) {
          lastError = error;
          await finishAiInvocationAttempt({
            id: attemptId,
            status: "failed",
            config: candidate.config,
            latencyMs: Math.round(performance.now() - attemptStartedAt),
            error,
          });
          if (index === models.length - 1) {
            await finishAiInvocation({
              id: invocationId,
              status: "failed",
              config: candidate.config,
              attemptCount: index + 1,
              durationMs: Math.round(performance.now() - startedAt),
              error,
            });
            throw error;
          }
        }
      }
      throw lastError ?? new Error("AI Runtime 没有可用候选模型");
    },
    async doStream(options) {
      const startedAt = performance.now();
      const invocationId = await begin();
      let lastError: unknown;
      for (const [index, candidate] of models.entries()) {
        const attemptStartedAt = performance.now();
        const attemptId = await beginAiInvocationAttempt({
          invocationId,
          attemptNo: index + 1,
          config: candidate.config,
        });
        try {
          const result = await candidate.model.doStream(options);
          const reader = result.stream.getReader();
          let firstTokenMs: number | null = null;
          const stream = new ReadableStream<unknown>({
            async start(controller) {
              let usage: unknown;
              let failure: unknown;
              try {
                while (true) {
                  const next = await reader.read();
                  if (next.done) break;
                  firstTokenMs ??= Math.round(performance.now() - attemptStartedAt);
                  usage = streamUsage(next.value) ?? usage;
                  failure = streamError(next.value) ?? failure;
                  controller.enqueue(next.value);
                }
                const status = failure ? "failed" : "completed";
                await finishAiInvocationAttempt({
                  id: attemptId,
                  status,
                  config: candidate.config,
                  usage,
                  latencyMs: Math.round(performance.now() - attemptStartedAt),
                  firstTokenMs,
                  error: failure,
                });
                await finishAiInvocation({
                  id: invocationId,
                  status,
                  config: candidate.config,
                  attemptCount: index + 1,
                  usage,
                  durationMs: Math.round(performance.now() - startedAt),
                  error: failure,
                });
                controller.close();
              } catch (error) {
                await finishAiInvocationAttempt({
                  id: attemptId,
                  status: "failed",
                  config: candidate.config,
                  usage,
                  latencyMs: Math.round(performance.now() - attemptStartedAt),
                  firstTokenMs,
                  error,
                });
                await finishAiInvocation({
                  id: invocationId,
                  status: "failed",
                  config: candidate.config,
                  attemptCount: index + 1,
                  usage,
                  durationMs: Math.round(performance.now() - startedAt),
                  error,
                });
                controller.error(error);
              }
            },
            cancel(reason) {
              return reader.cancel(reason);
            },
          });
          return { ...result, stream };
        } catch (error) {
          lastError = error;
          await finishAiInvocationAttempt({
            id: attemptId,
            status: "failed",
            config: candidate.config,
            latencyMs: Math.round(performance.now() - attemptStartedAt),
            error,
          });
          if (index === models.length - 1) {
            await finishAiInvocation({
              id: invocationId,
              status: "failed",
              config: candidate.config,
              attemptCount: index + 1,
              durationMs: Math.round(performance.now() - startedAt),
              error,
            });
            throw error;
          }
        }
      }
      throw lastError ?? new Error("AI Runtime 没有可用候选模型");
    },
  };
  return fallbackModel as unknown as LanguageModel;
}
