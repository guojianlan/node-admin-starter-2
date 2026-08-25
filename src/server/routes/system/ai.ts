import { sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamText } from "ai";
import { z } from "zod";
import { success, type PageResult } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { nowIso, sqlite, type DbClient } from "@/server/db";
import { sysAiProvider } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import type { AiModelUsage } from "@/server/services/ai-provider-service";
import {
  aiProviderMaxTimeoutMs,
  aiProviderMinTimeoutMs,
  AiRuntimeConfigurationError,
  getAiProvider,
  getAiRuntimeConfig,
  resolveAiProviderTimeoutMs,
} from "@/server/services/ai-provider-service";
import {
  appendAiChatMessage,
  createAiChatSession,
  getAiChatMessage,
  getAiChatSession,
  listAiChatMessages,
  listAiChatSessions,
  refreshAiChatSessionSummary,
  softDeleteAiChatSession,
  supersedeAiChatMessage,
  titleFromContent,
  updateAiChatSession,
  updateAiChatMessage,
} from "@/server/services/ai-chat-service";
import {
  appendAgentRunStep,
  createToolApproval,
  finishAgentRun,
  getApprovalContinuationContext,
  getAiAgent,
  listAiAgents,
  listAiTools,
} from "@/server/services/ai-agent-service";
import { createAiAgentStream } from "@/server/services/ai-agent-runtime-service";
import { governAiChatContext } from "@/server/services/ai-context-service";
import {
  generateAiText,
  resolveAiOutputTokens,
  streamAiText,
} from "@/server/services/ai-runtime-service";
import {
  resolveAiRuntimeCandidates,
  runAiHealthCheck,
} from "@/server/services/ai-reliability-service";
import { buildAiSdkChatRuntime } from "@/server/services/ai-sdk-runtime";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { assertSystemCodeUnchanged } from "@/server/services/protected-records";
import { decryptSecret, encryptSecret } from "@/server/services/secret";
import { resolveListOrder } from "@/server/services/list-query";
import { getOfficialAiPricingSource } from "@/shared/ai-pricing-sources";

const emptyToNull = (value: unknown) => (value === "" ? null : value);
const optionalUrl = z.preprocess(emptyToNull, z.string().url().optional().nullable());
const optionalText = z.preprocess(emptyToNull, z.string().optional().nullable());
const optionalNumber = z.preprocess(
  emptyToNull,
  z.union([z.coerce.number().int().nonnegative(), z.null()]).optional().nullable(),
);

const supportedProviderTypes = [
  "openai-compatible",
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "qwen",
  "moonshot",
  "zhipu",
  "siliconflow",
  "openrouter",
  "ollama",
  "custom",
] as const;
const aiOutputTokenInputLimit = 131072;

const providerDefaults: Record<
  (typeof supportedProviderTypes)[number],
  { name: string; baseUrl: string }
> = {
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  anthropic: { name: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1" },
  google: { name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  qwen: {
    name: "通义千问 / DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  moonshot: { name: "Moonshot / Kimi", baseUrl: "https://api.moonshot.cn/v1" },
  zhipu: { name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  siliconflow: { name: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1" },
  openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  ollama: { name: "Ollama 本地模型", baseUrl: "http://localhost:11434/v1" },
  "openai-compatible": { name: "OpenAI 兼容服务", baseUrl: "https://api.example.com/v1" },
  custom: { name: "其他兼容服务", baseUrl: "https://gateway.example.com/v1" },
};

type ProviderTestMode = "listModels" | "chat" | "embedding";

async function getPublicAiRuntimeStatus(usage: AiModelUsage, modelId?: number | null) {
  try {
    const runtimeConfig = await getAiRuntimeConfig(usage, modelId);
    return {
      ready: true as const,
      reason: null,
      provider: {
        id: runtimeConfig.provider.id,
        code: runtimeConfig.provider.code,
        name: runtimeConfig.provider.name,
        providerType: runtimeConfig.provider.providerType,
        baseUrl: runtimeConfig.provider.baseUrl,
        hasApiKey: Boolean(runtimeConfig.provider.apiKey),
        timeoutMs: runtimeConfig.provider.timeoutMs,
      },
      model: runtimeConfig.model,
    };
  } catch (error) {
    if (!(error instanceof AiRuntimeConfigurationError)) throw error;
    return {
      ready: false as const,
      reason: error.message,
      provider: null,
      model: null,
    };
  }
}

const aiProviderSchema = z.object({
  name: optionalText,
  code: optionalText,
  providerType: z.enum(supportedProviderTypes).default("openai-compatible"),
  baseUrl: optionalUrl,
  apiKey: optionalText,
  organization: optionalText,
  project: optionalText,
  timeoutMs: z.coerce
    .number()
    .int()
    .min(aiProviderMinTimeoutMs)
    .max(aiProviderMaxTimeoutMs)
    .optional(),
  status: z.coerce.number().default(1),
  sort: z.coerce.number().default(0),
  optionsJson: optionalText,
  remark: optionalText,
});

const aiModelSchema = z.object({
  providerId: z.coerce.number().int().positive(),
  name: z.string().optional().nullable(),
  modelId: z.string().min(1),
  modelType: z.enum(["chat", "embedding", "image", "rerank"]).default("chat"),
  capabilitiesJson: optionalText,
  contextWindow: optionalNumber,
  maxOutputTokens: optionalNumber,
  inputPrice: optionalText,
  cachedInputPrice: optionalText,
  cacheWritePrice: optionalText,
  outputPrice: optionalText,
  currency: z.preprocess(
    (value) => (value === "" || value == null ? "USD" : value),
    z.string().min(1),
  ),
  pricingSourceUrl: optionalUrl,
  pricingVerifiedAt: z.preprocess(emptyToNull, z.string().date().optional().nullable()),
  status: z.coerce.number().default(1),
  sort: z.coerce.number().default(0),
  remark: optionalText,
});

const setDefaultModelSchema = z.object({
  usage: z.enum(["chat", "structured", "embedding"]),
});

const aiProviderTestSchema = z.object({
  id: z.coerce.number(),
  mode: z.enum(["listModels", "chat", "embedding"]).default("listModels"),
  modelId: optionalText,
  input: z.preprocess(
    (value) => (value === "" || value == null ? "请用一句话回复 OK。" : value),
    z.string().min(1),
  ),
  maxOutputTokens: z.coerce.number().int().min(16).max(aiOutputTokenInputLimit).optional(),
  timeoutMs: z.coerce
    .number()
    .int()
    .min(aiProviderMinTimeoutMs)
    .max(aiProviderMaxTimeoutMs)
    .optional(),
});

const aiModelTestSchema = z.object({
  id: z.coerce.number(),
  input: z.preprocess(
    (value) => (value === "" || value == null ? "请用一句话回复 OK。" : value),
    z.string().min(1),
  ),
  maxOutputTokens: z.coerce.number().int().min(16).max(aiOutputTokenInputLimit).optional(),
  timeoutMs: z.coerce
    .number()
    .int()
    .min(aiProviderMinTimeoutMs)
    .max(aiProviderMaxTimeoutMs)
    .optional(),
});

const aiPlaygroundChatSchema = z.object({
  usage: z.enum(["chat", "structured"]).default("chat"),
  modelId: z.coerce.number().int().positive().optional().nullable(),
  input: z.string().min(1),
  maxOutputTokens: z.coerce.number().int().min(16).max(aiOutputTokenInputLimit).optional(),
  timeoutMs: z.coerce
    .number()
    .int()
    .min(aiProviderMinTimeoutMs)
    .max(aiProviderMaxTimeoutMs)
    .optional(),
});

const aiChatSessionSchema = z.object({
  title: z.string().optional().nullable(),
  modelId: z.coerce.number().int().positive().optional().nullable(),
  agentId: z.coerce.number().int().positive().optional().nullable(),
  systemPrompt: z.string().max(12000).optional().nullable(),
  temperature: z.coerce.number().min(0).max(2).optional(),
});

const aiChatMessageSchema = z
  .object({
    content: z.string().min(1).optional(),
    resumeApprovalId: z.coerce.number().int().positive().optional(),
  })
  .refine(
    (value) => Boolean(value.resumeApprovalId) || Boolean(value.content?.trim()),
    "请输入聊天内容",
  );

const aiSetupProviderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  providerType: z.enum(supportedProviderTypes),
  baseUrl: optionalUrl,
  apiKey: optionalText,
  organization: optionalText,
  project: optionalText,
  timeoutMs: z.coerce
    .number()
    .int()
    .min(aiProviderMinTimeoutMs)
    .max(aiProviderMaxTimeoutMs)
    .default(300000),
});

const aiSetupModelSchema = z
  .object({
    modelId: z.string().trim().min(1).max(240),
    name: z.string().trim().min(1).max(240),
    modelType: z.enum(["chat", "embedding", "image", "rerank"]),
    contextWindow: z.coerce.number().int().min(4096).max(2_000_000_000).optional().nullable(),
    maxOutputTokens: z.coerce
      .number()
      .int()
      .min(16)
      .max(aiOutputTokenInputLimit)
      .optional()
      .nullable(),
    toolCalling: z.boolean().default(false),
  })
  .refine(
    (value) =>
      !value.contextWindow ||
      !value.maxOutputTokens ||
      value.maxOutputTokens <= value.contextWindow,
    { message: "最大输出不能超过上下文窗口", path: ["maxOutputTokens"] },
  );

const aiSetupDiscoverSchema = z.object({ provider: aiSetupProviderSchema });

const aiSetupCompleteSchema = z
  .object({
    provider: aiSetupProviderSchema,
    models: z.array(aiSetupModelSchema).min(1).max(100),
    defaults: z
      .object({
        chat: optionalText,
        structured: optionalText,
        embedding: optionalText,
      })
      .default({}),
    makeDefaultProvider: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    const models = new Map(value.models.map((model) => [model.modelId, model]));
    if (models.size !== value.models.length) {
      ctx.addIssue({ code: "custom", message: "不能重复导入相同模型", path: ["models"] });
    }
    for (const [usage, modelId] of Object.entries(value.defaults)) {
      if (!modelId) continue;
      const model = models.get(modelId);
      if (!model) {
        ctx.addIssue({
          code: "custom",
          message: `${usage} 默认模型不在本次导入列表中`,
          path: ["defaults", usage],
        });
        continue;
      }
      const compatible =
        usage === "embedding" ? model.modelType === "embedding" : model.modelType === "chat";
      if (!compatible) {
        ctx.addIssue({
          code: "custom",
          message: `${usage} 默认用途与模型类型不匹配`,
          path: ["defaults", usage],
        });
      }
    }
  });

function parseAiSetupPayload<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HTTPException(400, {
    message: parsed.error.issues[0]?.message || "AI 接入参数无效",
  });
}

type AiProviderRow = {
  id: number;
  code: string;
  name: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  organization: string | null;
  project: string | null;
  timeoutMs: number;
  isDefault: boolean;
  status: number;
  optionsJson: string | null;
  isSystem: boolean;
};

type AiChatSource = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: string;
};

function extractWebSearchSources(toolName: string, output: unknown): AiChatSource[] {
  if (toolName !== "web-search" || !output || typeof output !== "object") return [];
  const results = (output as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const url = String(row.url || "").slice(0, 2048);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    } catch {
      return [];
    }
    return [
      {
        title: String(row.title || url).slice(0, 300),
        url,
        snippet: String(row.snippet || "").slice(0, 1200),
        ...(row.publishedAt ? { publishedAt: String(row.publishedAt).slice(0, 100) } : {}),
        source: String(row.source || "web").slice(0, 160),
      },
    ];
  });
}

type AiModelRow = {
  id: number;
  providerId: number;
  providerName: string | null;
  providerCode: string | null;
  providerStatus: number | null;
  providerDeletedAt: string | null;
  name: string;
  modelId: string;
  modelType: string;
  capabilitiesJson: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputPrice: string | null;
  cachedInputPrice: string | null;
  cacheWritePrice: string | null;
  outputPrice: string | null;
  currency: string;
  pricingSourceUrl: string | null;
  pricingVerifiedAt: string | null;
  pricingSourceType: "manual" | "catalog" | "provider";
  pricingCatalogKey: string | null;
  pricingSourceHash: string | null;
  pricingSyncedAt: string | null;
  isDefaultChat: boolean;
  isDefaultStructured: boolean;
  isDefaultEmbedding: boolean;
  status: number;
  sort: number;
  remark: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

type AiTestResult = {
  mode: ProviderTestMode;
  endpoint: string;
  status: number;
  preview: string;
};

type ProviderModelOption = {
  id: string;
  name: string;
  modelType: "chat" | "embedding" | "image" | "rerank";
  contextWindow: number | null;
  maxOutputTokens: number | null;
};

function assertJson(value?: string | null, message = "扩展配置必须是合法 JSON") {
  if (!value) return;
  try {
    JSON.parse(value);
  } catch {
    throw new Error(message);
  }
}

function parseJsonObject(value?: string | null) {
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

function normalizeAiProvider<T extends Record<string, unknown>>(values: T) {
  const { apiKey, optionsJson, ...rest } = values;
  if (typeof optionsJson === "string") assertJson(optionsJson);
  return {
    ...rest,
    ...(optionsJson !== undefined ? { optionsJson } : {}),
    ...(apiKey !== undefined ? { apiKeyEncrypted: encryptSecret(String(apiKey || "")) } : {}),
  } as T;
}

function providerCodeSeed(value: unknown) {
  return (
    String(value || "provider")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "provider"
  );
}

async function nextProviderCode(seed: string, dbClient: DbClient = sqlite) {
  const base = providerCodeSeed(seed);
  const rows = (await dbClient
    .prepare(
      "SELECT code FROM sys_ai_provider WHERE deleted_at IS NULL AND (code = ? OR code LIKE ?)",
    )
    .all(base, `${base}-%`)) as Array<{ code: string }>;
  const codes = new Set(rows.map((row) => row.code));
  if (!codes.has(base)) return base;
  let suffix = 2;
  while (codes.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

async function normalizeAiProviderCreate(
  values: z.infer<typeof aiProviderSchema>,
  dbClient: DbClient = sqlite,
) {
  const providerType = values.providerType || "openai-compatible";
  const defaults = providerDefaults[providerType];
  return normalizeAiProvider({
    ...values,
    name: values.name?.trim() || defaults.name,
    code: values.code?.trim() || (await nextProviderCode(providerType, dbClient)),
    baseUrl: values.baseUrl || defaults.baseUrl,
  });
}

async function buildSetupProviderRow(input: z.infer<typeof aiSetupProviderSchema>) {
  const normalized = await normalizeAiProviderCreate({
    ...input,
    status: 1,
    sort: 0,
  });
  return {
    id: 0,
    code: String(normalized.code),
    name: String(normalized.name),
    providerType: String(normalized.providerType),
    baseUrl: normalized.baseUrl ? String(normalized.baseUrl) : null,
    apiKeyEncrypted: input.apiKey ? encryptSecret(input.apiKey) : null,
    organization: normalized.organization ? String(normalized.organization) : null,
    project: normalized.project ? String(normalized.project) : null,
    timeoutMs: resolveAiProviderTimeoutMs(Number(normalized.timeoutMs)),
    isDefault: false,
    status: 1,
    optionsJson: null,
    isSystem: false,
  } satisfies AiProviderRow;
}

function inferProviderModelType(modelId: string): ProviderModelOption["modelType"] {
  const value = modelId.toLowerCase();
  if (/embed|embedding/.test(value)) return "embedding";
  if (/rerank/.test(value)) return "rerank";
  if (/image|imagen|dall-e/.test(value)) return "image";
  return "chat";
}

function optionalPositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeProviderModels(payload: unknown): ProviderModelOption[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const candidates = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  const seen = new Set<string>();
  return candidates.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const model = item as Record<string, unknown>;
    const topProvider =
      model.top_provider &&
      typeof model.top_provider === "object" &&
      !Array.isArray(model.top_provider)
        ? (model.top_provider as Record<string, unknown>)
        : {};
    const limits =
      model.limits && typeof model.limits === "object" && !Array.isArray(model.limits)
        ? (model.limits as Record<string, unknown>)
        : {};
    const rawId = String(model.id || model.name || "").trim();
    const id = rawId.replace(/^models\//, "");
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        name: String(
          model.display_name || model.displayName || model.name || model.id || id,
        ).replace(/^models\//, ""),
        modelType: inferProviderModelType(id),
        contextWindow: optionalPositiveNumber(
          model.context_window ??
            model.contextWindow ??
            model.contextLength ??
            model.context_length ??
            model.max_context_length ??
            model.max_model_len ??
            model.inputTokenLimit ??
            model.input_token_limit ??
            model.max_input_tokens ??
            topProvider.context_length ??
            limits.context_window ??
            limits.context_length,
        ),
        maxOutputTokens: optionalPositiveNumber(
          model.max_output_tokens ??
            model.maxOutputTokens ??
            model.max_completion_tokens ??
            model.outputTokenLimit ??
            model.output_token_limit ??
            topProvider.max_completion_tokens ??
            limits.max_output_tokens ??
            limits.max_completion_tokens,
        ),
      },
    ];
  });
}

async function listProviderModels(provider: AiProviderRow) {
  if (provider.status !== 1) throw new Error("停用的 AI Provider 不能获取模型");
  if (!provider.baseUrl) throw new Error("AI Provider Base URL 未配置");
  const endpoint =
    providerProtocol(provider.providerType) === "google"
      ? googleUrl(provider, "/models")
      : `${normalizeBaseUrl(provider.baseUrl)}/models`;
  const response = await fetch(endpoint, {
    method: "GET",
    headers: providerHeaders(provider),
    signal: AbortSignal.timeout(resolveAiProviderTimeoutMs(provider.timeoutMs)),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok)
    throw new Error(
      `获取 Provider 模型失败：${response.status}${text ? ` ${text.slice(0, 1000)}` : ""}`,
    );
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Provider 模型列表不是合法 JSON，请直接输入模型 ID");
  }
  return { endpoint, models: normalizeProviderModels(payload) };
}

function normalizeAiModel(values: z.infer<typeof aiModelSchema>) {
  if (typeof values.capabilitiesJson === "string") {
    assertJson(values.capabilitiesJson, "模型能力配置必须是合法 JSON");
  }
  return {
    ...values,
    name: values.name?.trim() || values.modelId,
    capabilitiesJson:
      values.capabilitiesJson?.trim() ||
      JSON.stringify(
        values.modelType === "embedding"
          ? { embedding: true }
          : values.modelType === "image"
            ? { image: true }
            : values.modelType === "rerank"
              ? { rerank: true }
              : { chat: true },
      ),
    currency: values.currency || "USD",
  };
}

async function getProviderRow(id: number) {
  return (await sqlite
    .prepare(
      `SELECT
        id,
        code,
        name,
        provider_type AS "providerType",
        base_url AS "baseUrl",
        api_key_encrypted AS "apiKeyEncrypted",
        organization,
        project,
        timeout_ms AS "timeoutMs",
        is_default AS "isDefault",
        status,
        options_json AS "optionsJson",
        is_system AS "isSystem"
       FROM sys_ai_provider
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id)) as AiProviderRow | undefined;
}

async function assertAiProviderMutable(id: number) {
  const row = await getProviderRow(id);
  if (!row) throw new Error("AI Provider 不存在");
  if (row.isDefault) throw new Error("默认 AI Provider 不能删除，请先切换默认配置");
  if (row.isSystem) throw new Error("系统内置 AI Provider 不能删除");
  const model = (await sqlite
    .prepare(
      `SELECT id, name, model_id AS "modelId"
       FROM sys_ai_model
       WHERE provider_id = ? AND deleted_at IS NULL
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get(id)) as { id: number; name: string; modelId: string } | undefined;
  if (model) {
    throw new Error(
      `AI Provider 仍被模型「${model.name || model.modelId}」引用，请先迁移或删除关联模型`,
    );
  }
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function providerOptions(provider: Pick<AiProviderRow, "optionsJson">) {
  return parseJsonObject(provider.optionsJson);
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === "string")
      .map(([key, item]) => [key, item as string]),
  );
}

function providerRequiresApiKey(provider: Pick<AiProviderRow, "providerType" | "optionsJson">) {
  const options = providerOptions(provider);
  if (options.authRequired === false) return false;
  return provider.providerType !== "ollama";
}

function providerApiKey(
  provider: Pick<AiProviderRow, "apiKeyEncrypted" | "providerType" | "optionsJson">,
) {
  const apiKey = decryptSecret(provider.apiKeyEncrypted);
  if (!apiKey && providerRequiresApiKey(provider)) throw new Error("AI Provider API Key 未配置");
  return apiKey;
}

function providerHeaders(
  provider: Pick<
    AiProviderRow,
    "apiKeyEncrypted" | "organization" | "project" | "providerType" | "optionsJson"
  >,
) {
  const apiKey = providerApiKey(provider);
  const options = providerOptions(provider);
  const extraHeaders = stringRecord(options.headers);
  if (provider.providerType === "google") return extraHeaders;
  if (provider.providerType === "anthropic") {
    return {
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      "anthropic-version": String(options.anthropicVersion || "2023-06-01"),
      ...extraHeaders,
    };
  }
  return {
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    ...(provider.organization ? { "openai-organization": provider.organization } : {}),
    ...(provider.project ? { "openai-project": provider.project } : {}),
    ...extraHeaders,
  };
}

function providerProtocol(providerType: string): "openai" | "anthropic" | "google" {
  if (providerType === "anthropic") return "anthropic";
  if (providerType === "google") return "google";
  return "openai";
}

function googleModelPath(modelId: string) {
  return modelId.startsWith("models/") ? modelId : `models/${modelId}`;
}

function googleUrl(provider: AiProviderRow, path: string) {
  if (!provider.baseUrl) throw new Error("AI Provider Base URL 未配置");
  const url = new URL(`${normalizeBaseUrl(provider.baseUrl)}/${path.replace(/^\/+/, "")}`);
  const apiKey = providerApiKey(provider);
  if (apiKey) url.searchParams.set("key", apiKey);
  return url.toString();
}

async function parseTestResponse(
  response: Response,
  mode: ProviderTestMode,
  endpoint: string,
): Promise<AiTestResult> {
  const text = await response.text().catch(() => "");
  const preview = (() => {
    if (!text) return "";
    try {
      return JSON.stringify(JSON.parse(text), null, 2).slice(0, 3000);
    } catch {
      return text.slice(0, 3000);
    }
  })();
  if (!response.ok) {
    throw new Error(`AI 测试失败：${response.status}${preview ? ` ${preview}` : ""}`);
  }
  return {
    mode,
    endpoint,
    status: response.status,
    preview,
  };
}

async function testProviderConnection(
  provider: AiProviderRow,
  input: z.infer<typeof aiProviderTestSchema>,
) {
  if (provider.status !== 1) throw new Error("停用的 AI Provider 不能测试连接");
  if (!provider.baseUrl) throw new Error("AI Provider Base URL 未配置");
  const protocol = providerProtocol(provider.providerType);
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const headers = providerHeaders(provider);
  const mode = input.mode;
  const timeoutMs = resolveAiProviderTimeoutMs(provider.timeoutMs, input.timeoutMs);
  if (mode !== "listModels" && !input.modelId) throw new Error("请输入用于测试的模型 ID");

  if (protocol === "google") {
    const endpoint =
      mode === "listModels"
        ? googleUrl(provider, "/models")
        : googleUrl(
            provider,
            mode === "embedding"
              ? `/${googleModelPath(String(input.modelId))}:embedContent`
              : `/${googleModelPath(String(input.modelId))}:generateContent`,
          );
    const response =
      mode === "listModels"
        ? await fetch(endpoint, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) })
        : await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body:
              mode === "embedding"
                ? JSON.stringify({ content: { parts: [{ text: input.input }] } })
                : JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: input.input }] }],
                    generationConfig: { maxOutputTokens: 64 },
                  }),
            signal: AbortSignal.timeout(timeoutMs),
          });
    return parseTestResponse(response, mode, endpoint);
  }

  if (protocol === "anthropic") {
    if (mode === "embedding") throw new Error("Anthropic Provider 不支持 Embedding 测试");
    const endpoint = `${baseUrl}${mode === "listModels" ? "/models" : "/messages"}`;
    const response =
      mode === "listModels"
        ? await fetch(endpoint, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) })
        : await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify({
              model: input.modelId,
              max_tokens: 64,
              messages: [{ role: "user", content: input.input }],
            }),
            signal: AbortSignal.timeout(timeoutMs),
          });
    return parseTestResponse(response, mode, endpoint);
  }

  const endpoint =
    mode === "listModels"
      ? `${baseUrl}/models`
      : `${baseUrl}${mode === "embedding" ? "/embeddings" : "/chat/completions"}`;
  const response =
    mode === "listModels"
      ? await fetch(endpoint, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) })
      : await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body:
            mode === "embedding"
              ? JSON.stringify({ model: input.modelId, input: input.input })
              : JSON.stringify({
                  model: input.modelId,
                  messages: [{ role: "user", content: input.input }],
                  max_tokens: 64,
                }),
          signal: AbortSignal.timeout(timeoutMs),
        });
  return parseTestResponse(response, mode, endpoint);
}

async function getModelRow(id: number) {
  return (await sqlite
    .prepare(
      `SELECT
        m.id,
        m.provider_id AS "providerId",
        p.name AS "providerName",
        p.code AS "providerCode",
        p.status AS "providerStatus",
        p.deleted_at AS "providerDeletedAt",
        m.name,
        m.model_id AS "modelId",
        m.model_type AS "modelType",
        m.capabilities_json AS "capabilitiesJson",
        m.context_window AS "contextWindow",
        m.max_output_tokens AS "maxOutputTokens",
        m.input_price AS "inputPrice",
        m.cached_input_price AS "cachedInputPrice",
        m.cache_write_price AS "cacheWritePrice",
        m.output_price AS "outputPrice",
        m.currency,
        m.pricing_source_url AS "pricingSourceUrl",
        m.pricing_verified_at AS "pricingVerifiedAt",
        m.pricing_source_type AS "pricingSourceType",
        m.pricing_catalog_key AS "pricingCatalogKey",
        m.pricing_source_hash AS "pricingSourceHash",
        m.pricing_synced_at AS "pricingSyncedAt",
        m.is_default_chat AS "isDefaultChat",
        m.is_default_structured AS "isDefaultStructured",
        m.is_default_embedding AS "isDefaultEmbedding",
        m.status,
        m.sort,
        m.remark,
        m.is_system AS "isSystem",
        m.created_at AS "createdAt",
        m.updated_at AS "updatedAt"
       FROM sys_ai_model m
       LEFT JOIN sys_ai_provider p ON p.id = m.provider_id
       WHERE m.id = ? AND m.deleted_at IS NULL`,
    )
    .get(id)) as AiModelRow | undefined;
}

function ensureDefaultUsageCompatible(model: AiModelRow, usage: AiModelUsage) {
  if (model.status !== 1) throw new Error("停用的 AI 模型不能设为默认");
  if (model.providerStatus !== 1) throw new Error("停用的 AI Provider 下的模型不能设为默认");
  if (usage === "embedding" && model.modelType !== "embedding") {
    throw new Error("默认 Embedding 模型必须是 embedding 类型");
  }
  if ((usage === "chat" || usage === "structured") && model.modelType !== "chat") {
    throw new Error("默认 Chat/Structured 模型必须是 chat 类型");
  }
}

async function testModelConnection(model: AiModelRow, input: z.infer<typeof aiModelTestSchema>) {
  const provider = await getProviderRow(model.providerId);
  if (!provider) throw new Error("AI Provider 不存在");
  if (provider.status !== 1) throw new Error("停用的 AI Provider 不能测试模型");
  if (model.status !== 1) throw new Error("停用的 AI 模型不能测试");
  if (!provider.baseUrl) throw new Error("AI Provider Base URL 未配置");
  const protocol = providerProtocol(provider.providerType);
  const url = normalizeBaseUrl(provider.baseUrl);
  const headers = {
    "content-type": "application/json",
    ...providerHeaders(provider),
  };
  const timeoutMs = resolveAiProviderTimeoutMs(provider.timeoutMs, input.timeoutMs);

  if (protocol === "google") {
    const endpoint = googleUrl(
      provider,
      model.modelType === "embedding"
        ? `/${googleModelPath(model.modelId)}:embedContent`
        : `/${googleModelPath(model.modelId)}:generateContent`,
    );
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body:
        model.modelType === "embedding"
          ? JSON.stringify({ content: { parts: [{ text: input.input }] } })
          : JSON.stringify({
              contents: [{ role: "user", parts: [{ text: input.input }] }],
              generationConfig: { maxOutputTokens: 64 },
            }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return parseTestResponse(
      response,
      model.modelType === "embedding" ? "embedding" : "chat",
      endpoint,
    );
  }

  if (protocol === "anthropic") {
    if (model.modelType === "embedding")
      throw new Error("Anthropic Provider 不支持 Embedding 测试");
    const endpoint = `${url}/messages`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model.modelId,
        max_tokens: 64,
        messages: [{ role: "user", content: input.input }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return parseTestResponse(response, "chat", endpoint);
  }

  const endpoint = `${url}${model.modelType === "embedding" ? "/embeddings" : "/chat/completions"}`;
  const response =
    model.modelType === "embedding"
      ? await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: model.modelId, input: input.input }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      : await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: model.modelId,
            messages: [{ role: "user", content: input.input }],
            max_tokens: 64,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
  return parseTestResponse(
    response,
    model.modelType === "embedding" ? "embedding" : "chat",
    endpoint,
  );
}

function buildTextStreamResponse(
  runtime: ReturnType<typeof buildAiSdkChatRuntime>,
  input: string,
  abortSignal: AbortSignal,
  options: { maxOutputTokens?: number; timeoutMs?: number } = {},
) {
  const maxOutputTokens = options.maxOutputTokens ?? runtime.maxOutputTokens;
  const timeoutMs = resolveAiProviderTimeoutMs(undefined, options.timeoutMs);
  const result = streamText({
    model: runtime.model,
    prompt: input,
    maxOutputTokens,
    timeout: timeoutMs,
    abortSignal,
  });
  return result.toTextStreamResponse({
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-ai-test-endpoint": runtime.endpointHint,
      "x-ai-test-stream": "text",
      "x-ai-test-max-output-tokens": String(maxOutputTokens),
      "x-ai-test-timeout-ms": String(timeoutMs),
    },
  });
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function encodeSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function buildAiPlaygroundStreamResponse(
  payload: z.infer<typeof aiPlaygroundChatSchema>,
  abortSignal: AbortSignal,
) {
  const runtime = await streamAiText({
    ...payload,
    abortSignal,
    trace: { sourceType: "playground" },
  });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
      };

      send("meta", {
        provider: runtime.publicConfig.provider,
        model: runtime.publicConfig.model,
        endpoint: runtime.endpointHint,
        request: {
          usage: runtime.usage,
          inputLength: runtime.input.length,
          maxOutputTokens: runtime.maxOutputTokens,
          timeoutMs: runtime.timeoutMs,
        },
      });

      try {
        let finishReason = "stop";
        let rawFinishReason: string | undefined;
        let usage: unknown = {};
        for await (const part of runtime.stream.fullStream) {
          if (part.type === "text-delta" && part.text) send("delta", { text: part.text });
          if (part.type === "finish") {
            finishReason = part.finishReason;
            rawFinishReason = part.rawFinishReason;
            usage = part.totalUsage;
          }
        }
        send("finish", {
          finishReason,
          rawFinishReason,
          usage: runtime.normalizeUsage(usage),
          durationMs: runtime.resolveDurationMs(),
        });
      } catch (error) {
        send("error", {
          message: toErrorMessage(error),
          durationMs: runtime.resolveDurationMs(),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-ai-playground-stream": "sse",
      "x-ai-playground-provider": runtime.publicConfig.provider.code,
      "x-ai-playground-model": runtime.publicConfig.model.modelId,
      "x-ai-playground-max-output-tokens": String(runtime.maxOutputTokens),
      "x-ai-playground-timeout-ms": String(runtime.timeoutMs),
    },
  });
}

async function buildAiChatStreamResponse(input: {
  userId: number;
  abilities?: string[];
  requestId?: string;
  sessionId: number;
  content?: string;
  regenerateMessageId?: number;
  resumeApprovalId?: number;
  abortSignal: AbortSignal;
}) {
  const session = await getAiChatSession({ id: input.sessionId, userId: input.userId });
  if (!session) throw new Error("AI Chat 会话不存在");
  let existingMessages = await listAiChatMessages({
    sessionId: input.sessionId,
    userId: input.userId,
  });
  if (
    existingMessages.some(
      (message) => message.status === "pending" || message.status === "streaming",
    )
  ) {
    throw new Error("当前会话仍在生成中，请等待完成或先停止生成");
  }
  const trimmedContent = input.content?.trim() || "";
  const shouldTitleFromContent =
    existingMessages.length === 0 &&
    Boolean(trimmedContent) &&
    (!session.title || session.title === "新的聊天");
  let inputMessageId: number | null = null;
  let regeneratedFromId: number | null = null;
  const continuation = input.resumeApprovalId
    ? await getApprovalContinuationContext({
        id: input.resumeApprovalId,
        sessionId: input.sessionId,
        userId: input.userId,
      })
    : null;

  if (input.regenerateMessageId) {
    const original = await getAiChatMessage({
      id: input.regenerateMessageId,
      sessionId: input.sessionId,
      userId: input.userId,
    });
    if (!original || original.role !== "assistant") throw new Error("只能重新生成 Assistant 消息");
    const latestAssistant = [...existingMessages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (latestAssistant?.id !== original.id) throw new Error("只能重新生成最近一条 Assistant 消息");
    regeneratedFromId = original.id;
    inputMessageId = original.parentMessageId;
    existingMessages = existingMessages.filter((message) => message.id < original.id);
  } else if (!continuation) {
    inputMessageId = await appendAiChatMessage({
      sessionId: input.sessionId,
      userId: input.userId,
      role: "user",
      content: trimmedContent,
      status: "completed",
    });
    existingMessages = await listAiChatMessages({
      sessionId: input.sessionId,
      userId: input.userId,
    });
  }

  const agent = session.agentId ? await getAiAgent(session.agentId) : null;
  if (session.agentId && (!agent || agent.status !== 1))
    throw new Error("当前会话绑定的 Agent 不存在或已停用");
  const selectedModelId = session.modelId || agent?.modelId || null;
  const purpose = agent ? "agent" : "chat";
  const [config] = await resolveAiRuntimeCandidates({ purpose, modelId: selectedModelId });
  const maxOutputTokens = resolveAiOutputTokens({ modelLimit: config.model.maxOutputTokens });
  const systemPrompt = [agent?.instructions, session.systemPrompt].filter(Boolean).join("\n\n");
  const governed = governAiChatContext({
    messages: existingMessages,
    systemPrompt,
    previousSummary: session.contextSummary,
    previouslyCompactedThroughMessageId: session.compactedThroughMessageId,
    contextWindow: config.model.contextWindow,
    maxOutputTokens,
  });
  const assistantMessageId = await appendAiChatMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: "assistant",
    content: "",
    status: "streaming",
    parentMessageId: inputMessageId,
    regeneratedFromId,
    providerId: config.provider.id,
    modelId: config.model.id,
  });
  const temperature = session.temperatureMilli / 1000;
  let agentRuntime: Awaited<ReturnType<typeof createAiAgentStream>> | null = null;
  let plainRuntime: Awaited<ReturnType<typeof streamAiText>> | null = null;
  try {
    agentRuntime = agent
      ? await createAiAgentStream({
          agentId: agent.id,
          sessionId: input.sessionId,
          userId: input.userId,
          inputMessageId,
          parentRunId: continuation?.parentRunId,
          sourceApprovalId: continuation?.id,
          messages: governed.messages,
          modelId: selectedModelId,
          maxOutputTokens,
          temperature,
          abortSignal: input.abortSignal,
          abilities: input.abilities,
          requestId: input.requestId,
        })
      : null;
    plainRuntime = agentRuntime
      ? null
      : await streamAiText({
          purpose,
          messages: governed.messages,
          modelId: selectedModelId,
          maxOutputTokens,
          temperature,
          abortSignal: input.abortSignal,
          trace: {
            sourceType: "chat",
            sourceId: assistantMessageId,
            requestId: input.requestId,
            userId: input.userId,
            sessionId: input.sessionId,
          },
        });
  } catch (error) {
    await updateAiChatMessage({
      id: assistantMessageId,
      sessionId: input.sessionId,
      userId: input.userId,
      status: "failed",
      errorMessage: toErrorMessage(error),
      finishReason: "error",
      providerId: config.provider.id,
      modelId: config.model.id,
    });
    await refreshAiChatSessionSummary({
      sessionId: input.sessionId,
      userId: input.userId,
      title: shouldTitleFromContent ? titleFromContent(trimmedContent) : undefined,
      contextSummary: governed.summary,
      compactedThroughMessageId: governed.compactedThroughMessageId,
    });
    throw error;
  }
  const runtime = agentRuntime?.runtime ?? plainRuntime;
  if (!runtime) throw new Error("AI Runtime 初始化失败");
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
      };

      send("meta", {
        sessionId: input.sessionId,
        messageId: assistantMessageId,
        agent: agent ? { id: agent.id, name: agent.name, code: agent.code } : null,
        runId: agentRuntime?.runId ?? null,
        provider: runtime.publicConfig.provider,
        model: runtime.publicConfig.model,
        endpoint: runtime.endpointHint,
        request: {
          usage: runtime.usage,
          inputLength: governed.messages.reduce((total, item) => total + item.content.length, 0),
          maxOutputTokens: runtime.maxOutputTokens,
          timeoutMs: runtime.timeoutMs,
        },
        context: governed.stats,
      });

      let assistantText = "";
      let waitingApproval = false;
      let finishReason = "stop";
      let rawFinishReason: string | undefined;
      let normalizedUsage: Record<string, unknown> = {};
      const searchSources: AiChatSource[] = [];
      const runtimeStartedAt = runtime.startedAt;
      let firstResponseMs: number | null = null;
      let firstTextMs: number | null = null;
      let reasoningStartedMs: number | null = null;
      let reasoningFinishedMs: number | null = null;
      let reasoningObserved = false;
      const elapsedMs = () => Math.max(Math.round(performance.now() - runtimeStartedAt), 0);
      const markFirstResponse = () => {
        firstResponseMs ??= elapsedMs();
      };
      const finishReasoning = () => {
        if (reasoningObserved && reasoningStartedMs != null && reasoningFinishedMs == null) {
          reasoningFinishedMs = elapsedMs();
        }
      };
      const buildTiming = (totalMs: number) => ({
        totalMs,
        firstResponseMs,
        firstTextMs,
        reasoningMs:
          reasoningObserved && reasoningStartedMs != null
            ? Math.max((reasoningFinishedMs ?? totalMs) - reasoningStartedMs, 0)
            : null,
        generationMs: firstTextMs != null ? Math.max(totalMs - firstTextMs, 0) : null,
        reasoningObserved,
      });
      try {
        if (agentRuntime) {
          for await (const part of agentRuntime.stream.fullStream) {
            if (part.type === "text-delta") {
              markFirstResponse();
              firstTextMs ??= elapsedMs();
              finishReasoning();
              assistantText += part.text;
              send("delta", { text: part.text });
            } else if (part.type === "reasoning-start") {
              markFirstResponse();
              reasoningObserved = true;
              reasoningStartedMs ??= elapsedMs();
            } else if (part.type === "reasoning-delta") {
              markFirstResponse();
              reasoningObserved = true;
              reasoningStartedMs ??= elapsedMs();
            } else if (part.type === "reasoning-end") {
              reasoningObserved = true;
              reasoningStartedMs ??= elapsedMs();
              finishReasoning();
            } else if (part.type === "tool-call") {
              markFirstResponse();
              finishReasoning();
              send("tool-call", {
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              });
            } else if (part.type === "tool-result") {
              markFirstResponse();
              finishReasoning();
              const sources = extractWebSearchSources(part.toolName, part.output);
              if (sources.length) {
                const known = new Set(searchSources.map((source) => source.url));
                for (const source of sources) {
                  if (!known.has(source.url)) searchSources.push(source);
                  known.add(source.url);
                }
                send("sources", { toolCallId: part.toolCallId, sources });
              }
              send("tool-result", {
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                output: part.output,
              });
            } else if (part.type === "tool-approval-request") {
              markFirstResponse();
              finishReasoning();
              waitingApproval = true;
              const toolRow = agentRuntime.toolMap.get(part.toolCall.toolName);
              const stepNo = agentRuntime.nextStepNo();
              const stepId = await appendAgentRunStep({
                runId: agentRuntime.runId,
                stepNo,
                stepType: "approval",
                status: "waiting_approval",
                toolId: toolRow?.id,
                toolName: part.toolCall.toolName,
                toolCallId: part.toolCall.toolCallId,
                input: part.toolCall.input,
              });
              const approvalId = await createToolApproval({
                runId: agentRuntime.runId,
                stepId,
                sessionId: input.sessionId,
                userId: input.userId,
                tool: toolRow,
                toolName: part.toolCall.toolName,
                toolCallId: part.toolCall.toolCallId,
                toolInput: part.toolCall.input,
              });
              send("approval", {
                id: approvalId,
                toolName: part.toolCall.toolName,
                handlerKey: toolRow?.handlerKey ?? null,
                input: part.toolCall.input,
              });
            } else if (part.type === "finish-step") {
              await appendAgentRunStep({
                runId: agentRuntime.runId,
                stepNo: agentRuntime.nextStepNo(),
                stepType: "model",
                status: "completed",
                usage: part.usage,
                durationMs: Math.round(part.performance.stepTimeMs),
              });
            } else if (part.type === "finish") {
              markFirstResponse();
              finishReasoning();
              finishReason = part.finishReason;
              rawFinishReason = part.rawFinishReason;
              normalizedUsage = runtime.normalizeUsage(part.totalUsage);
            } else if (part.type === "error") {
              throw part.error;
            }
          }
        } else {
          if (!plainRuntime) throw new Error("AI Runtime 流不存在");
          for await (const part of plainRuntime.stream.fullStream) {
            if (part.type === "text-delta") {
              if (!part.text) continue;
              markFirstResponse();
              firstTextMs ??= elapsedMs();
              finishReasoning();
              assistantText += part.text;
              send("delta", { text: part.text });
            } else if (part.type === "reasoning-start") {
              markFirstResponse();
              reasoningObserved = true;
              reasoningStartedMs ??= elapsedMs();
            } else if (part.type === "reasoning-delta") {
              markFirstResponse();
              reasoningObserved = true;
              reasoningStartedMs ??= elapsedMs();
            } else if (part.type === "reasoning-end") {
              reasoningObserved = true;
              reasoningStartedMs ??= elapsedMs();
              finishReasoning();
            } else if (part.type === "finish") {
              markFirstResponse();
              finishReasoning();
              finishReason = part.finishReason;
              rawFinishReason = part.rawFinishReason;
              normalizedUsage = runtime.normalizeUsage(part.totalUsage);
            } else if (part.type === "error") {
              throw part.error;
            }
          }
        }
        const durationMs = runtime.resolveDurationMs();
        const timing = buildTiming(durationMs);
        await updateAiChatMessage({
          id: assistantMessageId,
          sessionId: input.sessionId,
          userId: input.userId,
          content: assistantText || (waitingApproval ? "等待工具调用审批" : ""),
          status: "completed",
          providerId: runtime.publicConfig.provider.id,
          modelId: runtime.publicConfig.model.id,
          finishReason,
          usage: normalizedUsage,
          metadata: {
            rawFinishReason,
            providerCode: runtime.publicConfig.provider.code,
            modelId: runtime.publicConfig.model.modelId,
            sources: searchSources,
            timing,
          },
          durationMs,
        });
        if (regeneratedFromId) {
          await supersedeAiChatMessage({
            id: regeneratedFromId,
            sessionId: input.sessionId,
            userId: input.userId,
          });
        }
        await refreshAiChatSessionSummary({
          sessionId: input.sessionId,
          userId: input.userId,
          runtime: runtime.publicConfig,
          usage: normalizedUsage,
          contextSummary: governed.summary,
          compactedThroughMessageId: governed.compactedThroughMessageId,
          title: shouldTitleFromContent ? titleFromContent(trimmedContent) : undefined,
        });
        if (agentRuntime) {
          await finishAgentRun({
            id: agentRuntime.runId,
            status: waitingApproval ? "waiting_approval" : "completed",
            outputMessageId: assistantMessageId,
            totalSteps: agentRuntime.currentStepNo(),
            usage: normalizedUsage,
            durationMs,
          });
          if (continuation) {
            await finishAgentRun({ id: continuation.parentRunId, status: "completed" });
          }
        }
        send("finish", {
          messageId: assistantMessageId,
          finishReason,
          rawFinishReason,
          usage: normalizedUsage,
          durationMs,
          timing,
          waitingApproval,
          context: governed.stats,
        });
      } catch (error) {
        const stopped = input.abortSignal.aborted;
        const durationMs = runtime.resolveDurationMs();
        finishReasoning();
        const timing = buildTiming(durationMs);
        await updateAiChatMessage({
          id: assistantMessageId,
          sessionId: input.sessionId,
          userId: input.userId,
          content: assistantText,
          status: stopped ? "stopped" : "failed",
          errorMessage: stopped ? null : toErrorMessage(error),
          finishReason: stopped ? "abort" : "error",
          providerId: runtime.publicConfig.provider.id,
          modelId: runtime.publicConfig.model.id,
          metadata: { timing },
          durationMs,
        });
        if (agentRuntime) {
          await finishAgentRun({
            id: agentRuntime.runId,
            status: stopped ? "stopped" : "failed",
            outputMessageId: assistantMessageId,
            totalSteps: agentRuntime.currentStepNo(),
            durationMs,
            errorMessage: stopped ? null : toErrorMessage(error),
          });
        }
        send("error", {
          message: toErrorMessage(error),
          messageId: assistantMessageId,
          status: stopped ? "stopped" : "failed",
          durationMs,
          timing,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-ai-chat-stream": "sse",
      "x-ai-chat-session-id": String(input.sessionId),
      "x-ai-chat-provider": runtime.publicConfig.provider.code,
      "x-ai-chat-model": runtime.publicConfig.model.modelId,
      "x-ai-chat-max-output-tokens": String(runtime.maxOutputTokens),
      "x-ai-chat-timeout-ms": String(runtime.timeoutMs),
    },
  });
}

async function testProviderChatStream(
  provider: AiProviderRow,
  input: z.infer<typeof aiProviderTestSchema>,
  abortSignal: AbortSignal,
) {
  if (provider.status !== 1) throw new Error("停用的 AI Provider 不能测试连接");
  if (!provider.baseUrl) throw new Error("AI Provider Base URL 未配置");
  if (input.mode !== "chat") throw new Error("流式测试仅支持 Chat 调用");
  if (!input.modelId) throw new Error("请输入用于测试的模型 ID");
  const runtime = buildAiSdkChatRuntime(provider, {
    modelId: input.modelId,
    modelType: "chat",
    maxOutputTokens: input.maxOutputTokens ?? null,
  });
  return buildTextStreamResponse(runtime, input.input, abortSignal, {
    maxOutputTokens: input.maxOutputTokens,
    timeoutMs: resolveAiProviderTimeoutMs(provider.timeoutMs, input.timeoutMs),
  });
}

async function testModelChatStream(
  model: AiModelRow,
  input: z.infer<typeof aiModelTestSchema>,
  abortSignal: AbortSignal,
) {
  const provider = await getProviderRow(model.providerId);
  if (!provider) throw new Error("AI Provider 不存在");
  if (provider.status !== 1) throw new Error("停用的 AI Provider 不能测试模型");
  if (model.status !== 1) throw new Error("停用的 AI 模型不能测试");
  const runtime = buildAiSdkChatRuntime(provider, model);
  return buildTextStreamResponse(runtime, input.input, abortSignal, {
    maxOutputTokens: input.maxOutputTokens,
    timeoutMs: resolveAiProviderTimeoutMs(provider.timeoutMs, input.timeoutMs),
  });
}

async function getAiSetupSummary() {
  const counts = (await sqlite
    .prepare(
      `SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) AS "providerCount",
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 1) AS "activeProviderCount"
       FROM sys_ai_provider`,
    )
    .get()) as { providerCount: number; activeProviderCount: number };
  const modelCounts = (await sqlite
    .prepare(
      `SELECT
        COUNT(*) FILTER (WHERE deleted_at IS NULL) AS "modelCount",
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 1) AS "activeModelCount"
       FROM sys_ai_model`,
    )
    .get()) as { modelCount: number; activeModelCount: number };
  const defaultRows = (await sqlite
    .prepare(
      `SELECT m.name, m.model_id AS "modelId", p.name AS "providerName",
        m.is_default_chat AS "isDefaultChat",
        m.is_default_structured AS "isDefaultStructured",
        m.is_default_embedding AS "isDefaultEmbedding"
       FROM sys_ai_model m
       INNER JOIN sys_ai_provider p ON p.id = m.provider_id
       WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL
         AND (m.is_default_chat = true OR m.is_default_structured = true OR m.is_default_embedding = true)`,
    )
    .all()) as Array<{
    name: string;
    modelId: string;
    providerName: string;
    isDefaultChat: boolean;
    isDefaultStructured: boolean;
    isDefaultEmbedding: boolean;
  }>;
  const modelSummary = (row?: (typeof defaultRows)[number]) =>
    row ? { name: row.name, modelId: row.modelId, providerName: row.providerName } : null;
  return {
    providerCount: Number(counts.providerCount || 0),
    activeProviderCount: Number(counts.activeProviderCount || 0),
    modelCount: Number(modelCounts.modelCount || 0),
    activeModelCount: Number(modelCounts.activeModelCount || 0),
    defaults: {
      chat: modelSummary(defaultRows.find((row) => row.isDefaultChat)),
      structured: modelSummary(defaultRows.find((row) => row.isDefaultStructured)),
      embedding: modelSummary(defaultRows.find((row) => row.isDefaultEmbedding)),
    },
  };
}

const aiProviderCrud = createCrudRoutes({
  basePath: "/ai/provider",
  table: sysAiProvider,
  idColumn: sysAiProvider.id,
  createSchema: aiProviderSchema,
  updateSchema: aiProviderSchema.partial(),
  permissions: { prefix: "system.aiProvider" },
  list: {
    select: {
      id: sysAiProvider.id,
      name: sysAiProvider.name,
      code: sysAiProvider.code,
      providerType: sysAiProvider.providerType,
      baseUrl: sysAiProvider.baseUrl,
      hasApiKey:
        drizzleSql<boolean>`(${sysAiProvider.apiKeyEncrypted} IS NOT NULL AND ${sysAiProvider.apiKeyEncrypted} <> '')`.as(
          "hasApiKey",
        ),
      organization: sysAiProvider.organization,
      project: sysAiProvider.project,
      timeoutMs: sysAiProvider.timeoutMs,
      isDefault: sysAiProvider.isDefault,
      status: sysAiProvider.status,
      sort: sysAiProvider.sort,
      optionsJson: sysAiProvider.optionsJson,
      remark: sysAiProvider.remark,
      isSystem: sysAiProvider.isSystem,
      createdAt: sysAiProvider.createdAt,
      updatedAt: sysAiProvider.updatedAt,
    },
    searchable: {
      name: "like",
      code: "like",
      providerType: "like",
      baseUrl: "like",
      status: "=",
    },
    quickSearchFields: ["name", "code", "providerType", "baseUrl"],
    sortableFields: ["id", "sort", "status", "createdAt", "updatedAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    beforeCreate: (ctx, values) => normalizeAiProviderCreate(values, ctx.sql),
    beforeUpdate: async (ctx, id, values) => {
      await assertSystemCodeUnchanged({
        db: ctx.sql,
        table: "sys_ai_provider",
        id,
        nextCode: values.code,
        message: "系统内置 AI Provider 不能修改编码",
      });
      return normalizeAiProvider(values);
    },
    beforeDelete: async (_ctx, ids) => {
      for (const id of ids) await assertAiProviderMutable(id);
    },
  },
});

export const aiRoutes = new Hono<{ Variables: HonoVariables }>();

aiRoutes.get("/ai/setup/summary", authRequired(), ability("system.aiSetup.query"), async (c) => {
  return c.json(success(await getAiSetupSummary()));
});

aiRoutes.post(
  "/ai/setup/discover",
  authRequired(),
  ability("system.aiSetup.configure"),
  async (c) => {
    const payload = parseAiSetupPayload(aiSetupDiscoverSchema, await c.req.json());
    let result: Awaited<ReturnType<typeof listProviderModels>> | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiSetup",
        action: "discover",
        resource: "/ai/setup",
        details: {
          providerType: payload.provider.providerType,
          providerName: payload.provider.name,
        },
      },
      async () => {
        result = await listProviderModels(await buildSetupProviderRow(payload.provider));
      },
    );
    return c.json(success(result, "连接正常，模型同步完成"));
  },
);

aiRoutes.post(
  "/ai/setup/complete",
  authRequired(),
  ability("system.aiSetup.configure"),
  async (c) => {
    const payload = parseAiSetupPayload(aiSetupCompleteSchema, await c.req.json());
    const userId = c.get("user").id;
    let result: {
      providerId: number;
      providerCode: string;
      importedModels: Array<{ id: number; modelId: string }>;
    } | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiSetup",
        action: "complete",
        resource: "/ai/setup",
        riskLevel: "high",
        details: {
          providerType: payload.provider.providerType,
          providerName: payload.provider.name,
          modelIds: payload.models.map((model) => model.modelId),
          defaults: payload.defaults,
          makeDefaultProvider: payload.makeDefaultProvider,
        },
      },
      async () => {
        const provider = await buildSetupProviderRow(payload.provider);
        result = await sqlite.transaction(async (tx) => {
          if (payload.makeDefaultProvider) {
            await tx
              .prepare("UPDATE sys_ai_provider SET is_default = false, updated_at = now()")
              .run();
          }
          const providerRow = (await tx
            .prepare(
              `INSERT INTO sys_ai_provider
                (name, code, provider_type, base_url, api_key_encrypted, organization, project,
                 timeout_ms, is_default, status, sort, created_by, updated_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
               RETURNING id`,
            )
            .get(
              provider.name,
              provider.code,
              provider.providerType,
              provider.baseUrl,
              provider.apiKeyEncrypted,
              provider.organization,
              provider.project,
              provider.timeoutMs,
              payload.makeDefaultProvider,
              userId,
              userId,
            )) as { id: number };

          if (payload.defaults.chat) {
            await tx.prepare("UPDATE sys_ai_model SET is_default_chat = false").run();
          }
          if (payload.defaults.structured) {
            await tx.prepare("UPDATE sys_ai_model SET is_default_structured = false").run();
          }
          if (payload.defaults.embedding) {
            await tx.prepare("UPDATE sys_ai_model SET is_default_embedding = false").run();
          }

          const importedModels: Array<{ id: number; modelId: string }> = [];
          for (const [index, model] of payload.models.entries()) {
            const normalized = normalizeAiModel({
              providerId: Number(providerRow.id),
              name: model.name,
              modelId: model.modelId,
              modelType: model.modelType,
              capabilitiesJson:
                model.modelType === "chat"
                  ? JSON.stringify({
                      chat: true,
                      ...(model.toolCalling ? { toolCalling: true } : {}),
                    })
                  : undefined,
              contextWindow: model.contextWindow,
              maxOutputTokens: model.maxOutputTokens,
              status: 1,
              sort: index,
              currency: "USD",
            });
            const modelRow = (await tx
              .prepare(
                `INSERT INTO sys_ai_model
                  (provider_id, name, model_id, model_type, capabilities_json, context_window,
                   max_output_tokens, currency, pricing_source_url,
                   is_default_chat, is_default_structured,
                   is_default_embedding, status, sort, created_by, updated_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, 1, ?, ?, ?)
                 RETURNING id`,
              )
              .get(
                providerRow.id,
                normalized.name,
                normalized.modelId,
                normalized.modelType,
                normalized.capabilitiesJson,
                normalized.contextWindow ?? null,
                normalized.maxOutputTokens ?? null,
                getOfficialAiPricingSource(provider.providerType)?.url ?? null,
                payload.defaults.chat === model.modelId,
                payload.defaults.structured === model.modelId,
                payload.defaults.embedding === model.modelId,
                index,
                userId,
                userId,
              )) as { id: number };
            importedModels.push({ id: Number(modelRow.id), modelId: model.modelId });
          }
          return {
            providerId: Number(providerRow.id),
            providerCode: provider.code,
            importedModels,
          };
        });
      },
    );
    return c.json(success(result, "AI 服务接入完成"));
  },
);

aiRoutes.get(
  "/ai/provider/:id/models",
  authRequired(),
  ability("system.aiModel.create"),
  async (c) => {
    const id = Number(c.req.param("id"));
    let result: Awaited<ReturnType<typeof listProviderModels>> | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiProvider",
        action: "listModels",
        resource: "/ai/provider",
        resourceId: id,
        details: { purpose: "modelCreate" },
      },
      async () => {
        const provider = await getProviderRow(id);
        if (!provider) throw new Error("AI Provider 不存在");
        result = await listProviderModels(provider);
      },
    );
    return c.json(success(result, "模型列表获取成功"));
  },
);

aiRoutes.get(
  "/ai/provider/:id/test-models",
  authRequired(),
  ability("system.aiProvider.test"),
  async (c) => {
    const id = Number(c.req.param("id"));
    let result: Awaited<ReturnType<typeof listProviderModels>> | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiProvider",
        action: "listTestModels",
        resource: "/ai/provider",
        resourceId: id,
        details: { purpose: "providerTest" },
      },
      async () => {
        const provider = await getProviderRow(id);
        if (!provider) throw new Error("AI Provider 不存在");
        result = await listProviderModels(provider);
      },
    );
    return c.json(success(result, "测试模型列表获取成功"));
  },
);

aiRoutes.put(
  "/ai/provider/status/:id",
  authRequired(),
  ability("system.aiProvider.status"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiProvider",
        action: "status",
        resource: "/ai/provider",
        resourceId: id,
        details: { status: payload.status },
      },
      async () => {
        const row = await getProviderRow(id);
        if (!row) throw new Error("AI Provider 不存在");
        if (row.isDefault && payload.status === 0) throw new Error("默认 AI Provider 不能停用");
        await sqlite
          .prepare("UPDATE sys_ai_provider SET status = ?, updated_at = now() WHERE id = ?")
          .run(payload.status, id);
      },
    );
    return c.json(success(null, "更新成功"));
  },
);

aiRoutes.put(
  "/ai/provider/default/:id",
  authRequired(),
  ability("system.aiProvider.setDefault"),
  async (c) => {
    const id = Number(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiProvider",
        action: "setDefault",
        resource: "/ai/provider",
        resourceId: id,
      },
      async () => {
        const row = await getProviderRow(id);
        if (!row) throw new Error("AI Provider 不存在");
        if (row.status !== 1) throw new Error("停用的 AI Provider 不能设为默认");
        if (!row.baseUrl) throw new Error("AI Provider Base URL 未配置");
        if (!decryptSecret(row.apiKeyEncrypted) && providerRequiresApiKey(row)) {
          throw new Error("AI Provider API Key 未配置");
        }
        await sqlite.transaction(async (tx) => {
          await tx
            .prepare("UPDATE sys_ai_provider SET is_default = false, updated_at = now()")
            .run();
          await tx
            .prepare(
              "UPDATE sys_ai_provider SET is_default = true, updated_at = now() WHERE id = ?",
            )
            .run(id);
        });
      },
    );
    return c.json(success(null, "设置成功"));
  },
);

aiRoutes.post("/ai/provider/test", authRequired(), ability("system.aiProvider.test"), async (c) => {
  const payload = aiProviderTestSchema.parse(await c.req.json());
  let result: AiTestResult | null = null;
  await runWithOperationLog(
    c,
    {
      module: "system.aiProvider",
      action: "test",
      resource: "/ai/provider",
      resourceId: payload.id,
      details: { mode: payload.mode, modelId: payload.modelId },
    },
    async () => {
      const row = await getProviderRow(payload.id);
      if (!row) throw new Error("AI Provider 不存在");
      result = await runAiHealthCheck({
        provider: row,
        model: payload.modelId ? { modelId: payload.modelId, name: payload.modelId } : null,
        purpose: payload.mode === "embedding" ? "embedding" : "chat",
        requestId: c.get("requestId"),
        execute: () => testProviderConnection(row, payload),
      });
    },
  );
  return c.json(success(result, "测试完成"));
});

aiRoutes.post(
  "/ai/provider/test/stream",
  authRequired(),
  ability("system.aiProvider.test"),
  async (c) => {
    const payload = aiProviderTestSchema.parse(await c.req.json());
    let response: Response | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiProvider",
        action: "testStream",
        resource: "/ai/provider",
        resourceId: payload.id,
        details: {
          mode: payload.mode,
          modelId: payload.modelId,
          maxOutputTokens: payload.maxOutputTokens,
          timeoutMs: payload.timeoutMs,
        },
      },
      async () => {
        const row = await getProviderRow(payload.id);
        if (!row) throw new Error("AI Provider 不存在");
        response = await testProviderChatStream(row, payload, c.req.raw.signal);
      },
    );
    return response ?? new Response("AI 流式测试未创建响应", { status: 500 });
  },
);

aiRoutes.get("/ai/model", authRequired(), ability("system.aiModel.query"), async (c) => {
  const params = new URL(c.req.url).searchParams;
  const page = Math.max(Number(params.get("page") || 1), 1);
  const pageSize = Math.min(Math.max(Number(params.get("pageSize") || 20), 1), 200);
  const conditions = ["m.deleted_at IS NULL"];
  const values: Array<string | number> = [];
  const keyword = params.get("keyword")?.trim();
  if (keyword) {
    conditions.push("(m.name ILIKE ? OR m.model_id ILIKE ? OR p.name ILIKE ? OR p.code ILIKE ?)");
    values.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const providerId = params.get("providerId");
  if (providerId) {
    conditions.push("m.provider_id = ?");
    values.push(Number(providerId));
  }
  const modelType = params.get("modelType");
  if (modelType) {
    conditions.push("m.model_type = ?");
    values.push(modelType);
  }
  const status = params.get("status");
  if (status) {
    conditions.push("m.status = ?");
    values.push(Number(status));
  }
  const where = conditions.join(" AND ");
  const orderSql = resolveListOrder({
    params,
    fieldMap: {
      id: "m.id",
      sort: "m.sort",
      createdAt: "m.created_at",
      updatedAt: "m.updated_at",
    },
    sortableFields: ["id", "sort", "createdAt", "updatedAt"],
    defaultSort: { field: "sort", order: "asc" },
  }).sql;
  const totalRow = (await sqlite
    .prepare(
      `SELECT COUNT(1)::int AS total
         FROM sys_ai_model m
         LEFT JOIN sys_ai_provider p ON p.id = m.provider_id
         WHERE ${where}`,
    )
    .get(...values)) as { total: number } | undefined;
  const rows = (await sqlite
    .prepare(
      `SELECT
          m.id,
          m.provider_id AS "providerId",
          p.name AS "providerName",
          p.code AS "providerCode",
          p.status AS "providerStatus",
          p.deleted_at AS "providerDeletedAt",
          m.name,
          m.model_id AS "modelId",
          m.model_type AS "modelType",
          m.capabilities_json AS "capabilitiesJson",
          m.context_window AS "contextWindow",
          m.max_output_tokens AS "maxOutputTokens",
          m.input_price AS "inputPrice",
          m.cached_input_price AS "cachedInputPrice",
          m.cache_write_price AS "cacheWritePrice",
          m.output_price AS "outputPrice",
          m.currency,
          m.pricing_source_url AS "pricingSourceUrl",
          m.pricing_verified_at AS "pricingVerifiedAt",
          m.pricing_source_type AS "pricingSourceType",
          m.pricing_catalog_key AS "pricingCatalogKey",
          m.pricing_source_hash AS "pricingSourceHash",
          m.pricing_synced_at AS "pricingSyncedAt",
          m.is_default_chat AS "isDefaultChat",
          m.is_default_structured AS "isDefaultStructured",
          m.is_default_embedding AS "isDefaultEmbedding",
          m.status,
          m.sort,
          m.remark,
          m.is_system AS "isSystem",
          m.created_at AS "createdAt",
          m.updated_at AS "updatedAt"
         FROM sys_ai_model m
         LEFT JOIN sys_ai_provider p ON p.id = m.provider_id
         WHERE ${where}
         ${orderSql}
         LIMIT ? OFFSET ?`,
    )
    .all(...values, pageSize, (page - 1) * pageSize)) as AiModelRow[];
  const result: PageResult<AiModelRow> = {
    data: rows,
    total: Number(totalRow?.total ?? 0),
    page,
    pageSize,
  };
  return c.json(success(result));
});

aiRoutes.post("/ai/model", authRequired(), ability("system.aiModel.create"), async (c) => {
  const payload = normalizeAiModel(aiModelSchema.parse(await c.req.json()));
  await runWithOperationLog(
    c,
    {
      module: "system.aiModel",
      action: "create",
      resource: "/ai/model",
      details: { modelId: payload.modelId, providerId: payload.providerId },
    },
    async () => {
      const provider = await getAiProvider(payload.providerId);
      if (!provider) throw new Error("AI Provider 不存在");
      const pricingSourceUrl =
        payload.pricingSourceUrl || getOfficialAiPricingSource(provider.providerType)?.url || null;
      await sqlite
        .prepare(
          `INSERT INTO sys_ai_model
              (provider_id, name, model_id, model_type, capabilities_json, context_window, max_output_tokens,
               input_price, cached_input_price, cache_write_price, output_price, currency,
               pricing_source_url, pricing_verified_at, status, sort, remark, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          payload.providerId,
          payload.name,
          payload.modelId,
          payload.modelType,
          payload.capabilitiesJson || null,
          payload.contextWindow ?? null,
          payload.maxOutputTokens ?? null,
          payload.inputPrice || null,
          payload.cachedInputPrice || null,
          payload.cacheWritePrice || null,
          payload.outputPrice || null,
          payload.currency,
          pricingSourceUrl,
          payload.pricingVerifiedAt || null,
          payload.status,
          payload.sort,
          payload.remark || null,
          nowIso(),
          nowIso(),
        );
    },
  );
  return c.json(success(null, "创建成功"));
});

aiRoutes.put("/ai/model/:id", authRequired(), ability("system.aiModel.update"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = aiModelSchema.partial().parse(await c.req.json());
  if (typeof payload.capabilitiesJson === "string") {
    assertJson(payload.capabilitiesJson, "模型能力配置必须是合法 JSON");
  }
  const row = await getModelRow(id);
  if (!row) throw new Error("AI 模型不存在");
  await runWithOperationLog(
    c,
    {
      module: "system.aiModel",
      action: "update",
      resource: "/ai/model",
      resourceId: id,
      details: { fields: Object.keys(payload) },
    },
    async () => {
      if (payload.providerId && !(await getAiProvider(payload.providerId))) {
        throw new Error("AI Provider 不存在");
      }
      const manuallyChangedPricing = [
        "inputPrice",
        "cachedInputPrice",
        "cacheWritePrice",
        "outputPrice",
        "currency",
        "contextWindow",
        "maxOutputTokens",
      ].some((field) => Object.prototype.hasOwnProperty.call(payload, field));
      await sqlite
        .prepare(
          `UPDATE sys_ai_model
             SET provider_id = COALESCE(?, provider_id),
                 name = COALESCE(?, name),
                 model_id = COALESCE(?, model_id),
                 model_type = COALESCE(?, model_type),
                 capabilities_json = ?,
                 context_window = ?,
                 max_output_tokens = ?,
                 input_price = ?,
                 cached_input_price = ?,
                 cache_write_price = ?,
                 output_price = ?,
                 currency = COALESCE(?, currency),
                 pricing_source_url = ?,
                 pricing_verified_at = ?,
                 pricing_source_type = CASE WHEN ? THEN 'manual' ELSE pricing_source_type END,
                 pricing_catalog_key = CASE WHEN ? THEN NULL ELSE pricing_catalog_key END,
                 pricing_source_hash = CASE WHEN ? THEN NULL ELSE pricing_source_hash END,
                 pricing_synced_at = CASE WHEN ? THEN NULL ELSE pricing_synced_at END,
                 status = COALESCE(?, status),
                 sort = COALESCE(?, sort),
                 remark = ?,
                 updated_at = now()
             WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(
          payload.providerId ?? null,
          payload.name ?? null,
          payload.modelId ?? null,
          payload.modelType ?? null,
          payload.capabilitiesJson === undefined
            ? row.capabilitiesJson
            : payload.capabilitiesJson || null,
          payload.contextWindow === undefined ? row.contextWindow : (payload.contextWindow ?? null),
          payload.maxOutputTokens === undefined
            ? row.maxOutputTokens
            : (payload.maxOutputTokens ?? null),
          payload.inputPrice === undefined ? row.inputPrice : payload.inputPrice || null,
          payload.cachedInputPrice === undefined
            ? row.cachedInputPrice
            : payload.cachedInputPrice || null,
          payload.cacheWritePrice === undefined
            ? row.cacheWritePrice
            : payload.cacheWritePrice || null,
          payload.outputPrice === undefined ? row.outputPrice : payload.outputPrice || null,
          payload.currency ?? null,
          payload.pricingSourceUrl === undefined
            ? row.pricingSourceUrl
            : payload.pricingSourceUrl || null,
          payload.pricingVerifiedAt === undefined
            ? row.pricingVerifiedAt
            : payload.pricingVerifiedAt || null,
          manuallyChangedPricing,
          manuallyChangedPricing,
          manuallyChangedPricing,
          manuallyChangedPricing,
          payload.status ?? null,
          payload.sort ?? null,
          payload.remark === undefined ? row.remark : payload.remark || null,
          id,
        );
    },
  );
  return c.json(success(null, "更新成功"));
});

aiRoutes.delete("/ai/model/:id", authRequired(), ability("system.aiModel.delete"), async (c) => {
  const id = Number(c.req.param("id"));
  const row = await getModelRow(id);
  if (!row) throw new Error("AI 模型不存在");
  if (row.isSystem) throw new Error("系统内置 AI 模型不能删除");
  if (row.isDefaultChat || row.isDefaultStructured || row.isDefaultEmbedding) {
    throw new Error("默认 AI 模型不能删除，请先切换默认模型");
  }
  await runWithOperationLog(
    c,
    {
      module: "system.aiModel",
      action: "delete",
      resource: "/ai/model",
      resourceId: id,
    },
    async () => {
      await sqlite
        .prepare("UPDATE sys_ai_model SET deleted_at = now(), updated_at = now() WHERE id = ?")
        .run(id);
    },
  );
  return c.json(success(null, "删除成功"));
});

aiRoutes.put(
  "/ai/model/status/:id",
  authRequired(),
  ability("system.aiModel.status"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiModel",
        action: "status",
        resource: "/ai/model",
        resourceId: id,
        details: { status: payload.status },
      },
      async () => {
        const row = await getModelRow(id);
        if (!row) throw new Error("AI 模型不存在");
        if (
          payload.status === 0 &&
          (row.isDefaultChat || row.isDefaultStructured || row.isDefaultEmbedding)
        ) {
          throw new Error("默认 AI 模型不能停用");
        }
        await sqlite
          .prepare("UPDATE sys_ai_model SET status = ?, updated_at = now() WHERE id = ?")
          .run(payload.status, id);
      },
    );
    return c.json(success(null, "更新成功"));
  },
);

aiRoutes.put(
  "/ai/model/default/:id",
  authRequired(),
  ability("system.aiModel.setDefault"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = setDefaultModelSchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiModel",
        action: "setDefault",
        resource: "/ai/model",
        resourceId: id,
        details: payload,
      },
      async () => {
        const row = await getModelRow(id);
        if (!row) throw new Error("AI 模型不存在");
        ensureDefaultUsageCompatible(row, payload.usage);
        const column =
          payload.usage === "embedding"
            ? "is_default_embedding"
            : payload.usage === "structured"
              ? "is_default_structured"
              : "is_default_chat";
        await sqlite.transaction(async (tx) => {
          await tx.prepare(`UPDATE sys_ai_model SET ${column} = false, updated_at = now()`).run();
          await tx
            .prepare(`UPDATE sys_ai_model SET ${column} = true, updated_at = now() WHERE id = ?`)
            .run(id);
        });
      },
    );
    return c.json(success(null, "设置成功"));
  },
);

aiRoutes.post("/ai/model/test", authRequired(), ability("system.aiModel.test"), async (c) => {
  const payload = aiModelTestSchema.parse(await c.req.json());
  let result: AiTestResult | null = null;
  await runWithOperationLog(
    c,
    {
      module: "system.aiModel",
      action: "test",
      resource: "/ai/model",
      resourceId: payload.id,
      details: { inputPreview: payload.input.slice(0, 120) },
    },
    async () => {
      const row = await getModelRow(payload.id);
      if (!row) throw new Error("AI 模型不存在");
      result = await runAiHealthCheck({
        provider: {
          id: row.providerId,
          code: row.providerCode || `provider-${row.providerId}`,
          name: row.providerName || "未知 Provider",
        },
        model: row,
        purpose: row.modelType === "embedding" ? "embedding" : "chat",
        requestId: c.get("requestId"),
        execute: () => testModelConnection(row, payload),
      });
    },
  );
  return c.json(success(result, "模型调用正常"));
});

aiRoutes.post(
  "/ai/model/test/stream",
  authRequired(),
  ability("system.aiModel.test"),
  async (c) => {
    const payload = aiModelTestSchema.parse(await c.req.json());
    let response: Response | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiModel",
        action: "testStream",
        resource: "/ai/model",
        resourceId: payload.id,
        details: {
          inputPreview: payload.input.slice(0, 120),
          maxOutputTokens: payload.maxOutputTokens,
          timeoutMs: payload.timeoutMs,
        },
      },
      async () => {
        const row = await getModelRow(payload.id);
        if (!row) throw new Error("AI 模型不存在");
        response = await testModelChatStream(row, payload, c.req.raw.signal);
      },
    );
    return response ?? new Response("AI 流式测试未创建响应", { status: 500 });
  },
);

aiRoutes.get("/ai/chat/sessions", authRequired(), ability("system.aiChat.query"), async (c) => {
  const user = c.get("user");
  const params = new URL(c.req.url).searchParams;
  const page = Number(params.get("page") || 1);
  const pageSize = Number(params.get("pageSize") || 20);
  const keyword = params.get("keyword") ?? undefined;
  return c.json(success(await listAiChatSessions({ userId: user.id, page, pageSize, keyword })));
});

aiRoutes.get("/ai/chat/options", authRequired(), ability("system.aiChat.query"), async (c) => {
  const models = await sqlite
    .prepare(
      `SELECT m.id, m.name, m.model_id AS "modelId", m.context_window AS "contextWindow",
        m.max_output_tokens AS "maxOutputTokens", m.is_default_chat AS "isDefault",
        p.id AS "providerId", p.name AS "providerName", p.code AS "providerCode"
       FROM sys_ai_model m INNER JOIN sys_ai_provider p ON p.id = m.provider_id
       WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND m.status = 1 AND p.status = 1
         AND m.model_type = 'chat'
       ORDER BY m.is_default_chat DESC, p.sort ASC, m.sort ASC, m.id ASC`,
    )
    .all();
  const agents = await Promise.all(
    (await listAiAgents({ activeOnly: true })).map(async (agent) => ({
      id: agent.id,
      name: agent.name,
      code: agent.code,
      description: agent.description,
      modelId: agent.modelId,
      modelName: agent.modelName,
      toolCodes: (await listAiTools({ activeOnly: true, agentId: agent.id })).map(
        (tool) => tool.code,
      ),
    })),
  );
  return c.json(success({ models, agents }));
});

aiRoutes.get(
  "/ai/chat/runtime-config",
  authRequired(),
  ability("system.aiChat.query"),
  async (c) => {
    return c.json(success(await getPublicAiRuntimeStatus("chat")));
  },
);

aiRoutes.post("/ai/chat/sessions", authRequired(), ability("system.aiChat.create"), async (c) => {
  const user = c.get("user");
  const payload = aiChatSessionSchema.parse(await c.req.json());
  let sessionId = 0;
  await runWithOperationLog(
    c,
    {
      module: "system.aiChat",
      action: "create",
      resource: "/ai/chat/sessions",
      details: { title: payload.title },
    },
    async () => {
      if (payload.modelId) await getAiRuntimeConfig("chat", payload.modelId);
      if (payload.agentId) {
        const agent = await getAiAgent(payload.agentId);
        if (!agent || agent.status !== 1) throw new Error("Agent 不存在或已停用");
      }
      sessionId = await createAiChatSession({
        userId: user.id,
        title: payload.title,
        modelId: payload.modelId,
        agentId: payload.agentId,
        systemPrompt: payload.systemPrompt,
        temperatureMilli:
          payload.temperature === undefined ? undefined : Math.round(payload.temperature * 1000),
      });
    },
  );
  return c.json(success({ id: sessionId }, "创建成功"));
});

aiRoutes.put(
  "/ai/chat/sessions/:id",
  authRequired(),
  ability("system.aiChat.update"),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    const payload = aiChatSessionSchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiChat",
        action: "update",
        resource: "/ai/chat/sessions",
        resourceId: id,
        details: {
          title: payload.title,
          modelId: payload.modelId,
          agentId: payload.agentId,
          temperature: payload.temperature,
          systemPromptLength: payload.systemPrompt?.length ?? 0,
        },
      },
      async () => {
        if (!(await getAiChatSession({ id, userId: user.id })))
          throw new Error("AI Chat 会话不存在");
        if (payload.modelId) await getAiRuntimeConfig("chat", payload.modelId);
        if (payload.agentId) {
          const agent = await getAiAgent(payload.agentId);
          if (!agent || agent.status !== 1) throw new Error("Agent 不存在或已停用");
        }
        await updateAiChatSession({
          id,
          userId: user.id,
          title: payload.title ?? undefined,
          modelId: payload.modelId,
          agentId: payload.agentId,
          systemPrompt: payload.systemPrompt,
          temperatureMilli:
            payload.temperature === undefined ? undefined : Math.round(payload.temperature * 1000),
        });
      },
    );
    return c.json(success(null, "更新成功"));
  },
);

aiRoutes.delete(
  "/ai/chat/sessions/:id",
  authRequired(),
  ability("system.aiChat.delete"),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiChat",
        action: "delete",
        resource: "/ai/chat/sessions",
        resourceId: id,
        riskLevel: "high",
      },
      async () => {
        if (!(await getAiChatSession({ id, userId: user.id })))
          throw new Error("AI Chat 会话不存在");
        await softDeleteAiChatSession({ id, userId: user.id });
      },
    );
    return c.json(success(null, "删除成功"));
  },
);

aiRoutes.get(
  "/ai/chat/sessions/:id/messages",
  authRequired(),
  ability("system.aiChat.query"),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    if (!(await getAiChatSession({ id, userId: user.id }))) throw new Error("AI Chat 会话不存在");
    return c.json(success(await listAiChatMessages({ sessionId: id, userId: user.id })));
  },
);

aiRoutes.get(
  "/ai/chat/sessions/:id/export",
  authRequired(),
  ability("system.aiChat.query"),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    const session = await getAiChatSession({ id, userId: user.id });
    if (!session) throw new Error("AI Chat 会话不存在");
    const messages = await listAiChatMessages({ sessionId: id, userId: user.id });
    const format = new URL(c.req.url).searchParams.get("format") === "json" ? "json" : "markdown";
    const body =
      format === "json"
        ? JSON.stringify({ session, messages }, null, 2)
        : [
            `# ${session.title}`,
            "",
            `- Agent: ${session.agentName || "无"}`,
            `- Model: ${session.modelIdentifier || session.modelName || "默认模型"}`,
            `- Tokens: ${session.totalInputTokens} input / ${session.totalOutputTokens} output`,
            "",
            ...messages.map(
              (message) =>
                `## ${message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "系统"}\n\n${message.content}\n`,
            ),
          ].join("\n");
    const filename = `ai-chat-${id}.${format === "json" ? "json" : "md"}`;
    return new Response(body, {
      headers: {
        "content-type":
          format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  },
);

aiRoutes.post(
  "/ai/chat/sessions/:id/messages/stream",
  authRequired(),
  ability("system.aiChat.chat"),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    const payload = aiChatMessageSchema.parse(await c.req.json());
    let response: Response | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiChat",
        action: "chatStream",
        resource: "/ai/chat/sessions/messages",
        resourceId: id,
        details: {
          inputLength: payload.content?.trim().length ?? 0,
          inputPreview: payload.content?.trim().slice(0, 120),
          resumeApprovalId: payload.resumeApprovalId,
        },
      },
      async () => {
        response = await buildAiChatStreamResponse({
          userId: user.id,
          abilities: c.get("abilities"),
          requestId: c.get("requestId"),
          sessionId: id,
          content: payload.content,
          resumeApprovalId: payload.resumeApprovalId,
          abortSignal: c.req.raw.signal,
        });
      },
    );
    return response ?? new Response("AI Chat 流式调用未创建响应", { status: 500 });
  },
);

aiRoutes.post(
  "/ai/chat/sessions/:id/messages/:messageId/regenerate",
  authRequired(),
  ability("system.aiChat.chat"),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    const messageId = Number(c.req.param("messageId"));
    let response: Response | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiChat",
        action: "regenerate",
        resource: "/ai/chat/sessions/messages/regenerate",
        resourceId: messageId,
        details: { sessionId: id },
      },
      async () => {
        response = await buildAiChatStreamResponse({
          userId: user.id,
          abilities: c.get("abilities"),
          requestId: c.get("requestId"),
          sessionId: id,
          regenerateMessageId: messageId,
          abortSignal: c.req.raw.signal,
        });
      },
    );
    return response ?? new Response("AI Chat 重新生成流未创建", { status: 500 });
  },
);

aiRoutes.post(
  "/ai/playground/chat",
  authRequired(),
  ability("system.aiPlayground.chat"),
  async (c) => {
    const payload = aiPlaygroundChatSchema.parse(await c.req.json());
    let result: Awaited<ReturnType<typeof generateAiText>> | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiPlayground",
        action: "chat",
        resource: "/ai/playground/chat",
        details: {
          usage: payload.usage,
          modelId: payload.modelId,
          inputLength: payload.input.trim().length,
          inputPreview: payload.input.trim().slice(0, 120),
          maxOutputTokens: payload.maxOutputTokens,
          timeoutMs: payload.timeoutMs,
        },
      },
      async () => {
        result = await generateAiText({
          ...payload,
          abortSignal: c.req.raw.signal,
        });
      },
    );
    return c.json(success(result, "AI 调用完成"));
  },
);

aiRoutes.post(
  "/ai/playground/chat/stream",
  authRequired(),
  ability("system.aiPlayground.chat"),
  async (c) => {
    const payload = aiPlaygroundChatSchema.parse(await c.req.json());
    let response: Response | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiPlayground",
        action: "chatStream",
        resource: "/ai/playground/chat/stream",
        details: {
          usage: payload.usage,
          modelId: payload.modelId,
          inputLength: payload.input.trim().length,
          inputPreview: payload.input.trim().slice(0, 120),
          maxOutputTokens: payload.maxOutputTokens,
          timeoutMs: payload.timeoutMs,
        },
      },
      async () => {
        response = await buildAiPlaygroundStreamResponse(payload, c.req.raw.signal);
      },
    );
    return response ?? new Response("AI 流式调用未创建响应", { status: 500 });
  },
);

aiRoutes.get(
  "/ai/playground/options",
  authRequired(),
  ability("system.aiPlayground.query"),
  async (c) => {
    const rows = (await sqlite
      .prepare(
        `SELECT
          m.id,
          m.name,
          m.model_id AS "modelId",
          m.capabilities_json AS "capabilitiesJson",
          m.context_window AS "contextWindow",
          m.max_output_tokens AS "maxOutputTokens",
          m.is_default_chat AS "isDefaultChat",
          m.is_default_structured AS "isDefaultStructured",
          p.id AS "providerId",
          p.name AS "providerName",
          p.code AS "providerCode",
          p.provider_type AS "providerType"
         FROM sys_ai_model m
         INNER JOIN sys_ai_provider p ON p.id = m.provider_id
         WHERE m.deleted_at IS NULL
           AND p.deleted_at IS NULL
           AND m.status = 1
           AND p.status = 1
           AND m.model_type = 'chat'
         ORDER BY m.is_default_chat DESC, m.is_default_structured DESC,
           p.sort ASC, m.sort ASC, m.id ASC`,
      )
      .all()) as Array<Record<string, unknown> & { capabilitiesJson?: string | null }>;
    const models = rows.map(({ capabilitiesJson, ...row }) => ({
      ...row,
      capabilities: parseJsonObject(capabilitiesJson),
    }));
    return c.json(success({ models }));
  },
);

aiRoutes.get(
  "/ai/playground/runtime-config/:usage",
  authRequired(),
  ability("system.aiPlayground.query"),
  async (c) => {
    const usage = z.enum(["chat", "structured"]).parse(c.req.param("usage"));
    const modelIdValue = new URL(c.req.url).searchParams.get("modelId");
    const modelId = modelIdValue ? z.coerce.number().int().positive().parse(modelIdValue) : null;
    return c.json(success(await getPublicAiRuntimeStatus(usage, modelId)));
  },
);

aiRoutes.get(
  "/ai/runtime-config/:usage",
  authRequired(),
  ability("system.aiProvider.query"),
  async (c) => {
    const usage = z.enum(["chat", "structured", "embedding"]).parse(c.req.param("usage"));
    return c.json(success(await getPublicAiRuntimeStatus(usage)));
  },
);

aiRoutes.route("/", aiProviderCrud.routes);
