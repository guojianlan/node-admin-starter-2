import { sqlite } from "@/server/db";
import { decryptSecret } from "@/server/services/secret";

export type AiModelUsage = "chat" | "structured" | "embedding" | "rerank";

export const aiProviderDefaultTimeoutMs = 300_000;
export const aiProviderMinTimeoutMs = 5_000;
export const aiProviderMaxTimeoutMs = 3_600_000;

export function resolveAiProviderTimeoutMs(
  providerTimeoutMs?: number | null,
  overrideTimeoutMs?: number | null,
) {
  const value = overrideTimeoutMs ?? providerTimeoutMs ?? aiProviderDefaultTimeoutMs;
  return Math.min(Math.max(Math.round(value), aiProviderMinTimeoutMs), aiProviderMaxTimeoutMs);
}

export class AiRuntimeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRuntimeConfigurationError";
  }
}

export type AiProviderRuntimeConfig = {
  provider: {
    id: number;
    code: string;
    name: string;
    providerType: string;
    baseUrl: string;
    apiKey: string | null;
    organization?: string | null;
    project?: string | null;
    timeoutMs: number;
    options?: Record<string, unknown>;
  };
  model: {
    id: number;
    name: string;
    modelId: string;
    modelType: string;
    capabilities: Record<string, unknown>;
    contextWindow?: number | null;
    maxOutputTokens?: number | null;
    inputPrice?: string | null;
    cachedInputPrice?: string | null;
    cacheWritePrice?: string | null;
    outputPrice?: string | null;
    currency: string;
  };
};

export type AiProviderRow = {
  id: number;
  name: string;
  code: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  organization: string | null;
  project: string | null;
  timeoutMs: number;
  isDefault: boolean;
  status: number;
  optionsJson: string | null;
};

export type AiModelRow = {
  id: number;
  providerId: number;
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
  isDefaultChat: boolean;
  isDefaultStructured: boolean;
  isDefaultEmbedding: boolean;
  status: number;
};

function parseOptions(value?: string | null) {
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

function providerRequiresApiKey(provider: Pick<AiProviderRow, "providerType" | "optionsJson">) {
  const options = parseOptions(provider.optionsJson);
  if (options.authRequired === false) return false;
  return provider.providerType !== "ollama";
}

function providerSelectSql(extraWhere: string) {
  return `SELECT
    id,
    name,
    code,
    provider_type AS "providerType",
    base_url AS "baseUrl",
    api_key_encrypted AS "apiKeyEncrypted",
    organization,
    project,
    timeout_ms AS "timeoutMs",
    is_default AS "isDefault",
    status,
    options_json AS "optionsJson"
   FROM sys_ai_provider
   WHERE deleted_at IS NULL ${extraWhere}`;
}

function modelSelectSql(extraWhere: string) {
  return `SELECT
    id,
    provider_id AS "providerId",
    name,
    model_id AS "modelId",
    model_type AS "modelType",
    capabilities_json AS "capabilitiesJson",
    context_window AS "contextWindow",
    max_output_tokens AS "maxOutputTokens",
    input_price AS "inputPrice",
    cached_input_price AS "cachedInputPrice",
    cache_write_price AS "cacheWritePrice",
    output_price AS "outputPrice",
    currency,
    is_default_chat AS "isDefaultChat",
    is_default_structured AS "isDefaultStructured",
    is_default_embedding AS "isDefaultEmbedding",
    status
   FROM sys_ai_model
   WHERE deleted_at IS NULL ${extraWhere}`;
}

function requireActiveProvider(provider?: AiProviderRow | null) {
  if (!provider) throw new AiRuntimeConfigurationError("AI Provider 未配置");
  if (provider.status !== 1) throw new AiRuntimeConfigurationError("AI Provider 已停用");
  const baseUrl = provider.baseUrl;
  if (!baseUrl) throw new AiRuntimeConfigurationError("AI Provider Base URL 未配置");
  const apiKey = decryptSecret(provider.apiKeyEncrypted);
  if (!apiKey && providerRequiresApiKey(provider)) {
    throw new AiRuntimeConfigurationError("AI Provider API Key 未配置");
  }
  return { ...provider, baseUrl, apiKey };
}

function requireActiveModel(model?: AiModelRow | null) {
  if (!model) throw new AiRuntimeConfigurationError("AI 模型未配置");
  if (model.status !== 1) throw new AiRuntimeConfigurationError("AI 模型已停用");
  return model;
}

export async function getAiProvider(id: number) {
  return (await sqlite.prepare(`${providerSelectSql("AND id = ?")} LIMIT 1`).get(id)) as
    | AiProviderRow
    | undefined;
}

export async function getDefaultAiProvider() {
  return (await sqlite
    .prepare(`${providerSelectSql("AND is_default = true")} ORDER BY id ASC LIMIT 1`)
    .get()) as AiProviderRow | undefined;
}

export async function getAiModel(id: number) {
  return (await sqlite.prepare(`${modelSelectSql("AND id = ?")} LIMIT 1`).get(id)) as
    | AiModelRow
    | undefined;
}

export async function getDefaultAiModel(usage: AiModelUsage) {
  if (usage === "rerank") return undefined;
  const column =
    usage === "embedding"
      ? "is_default_embedding"
      : usage === "structured"
        ? "is_default_structured"
        : "is_default_chat";
  return (await sqlite
    .prepare(`${modelSelectSql(`AND ${column} = true`)} ORDER BY id ASC LIMIT 1`)
    .get()) as AiModelRow | undefined;
}

export async function getAiRuntimeConfig(
  usage: AiModelUsage = "chat",
  modelId?: number | null,
): Promise<AiProviderRuntimeConfig> {
  const model = requireActiveModel(
    modelId ? await getAiModel(modelId) : await getDefaultAiModel(usage),
  );
  if (usage === "embedding" && model.modelType !== "embedding") {
    throw new AiRuntimeConfigurationError("默认 Embedding 模型类型不正确");
  }
  if (usage === "rerank" && model.modelType !== "rerank") {
    throw new AiRuntimeConfigurationError("Rerank 模型类型不正确");
  }
  if ((usage === "chat" || usage === "structured") && model.modelType !== "chat") {
    throw new AiRuntimeConfigurationError("默认 Chat/Structured 模型类型不正确");
  }
  const provider = requireActiveProvider(await getAiProvider(model.providerId));
  const baseUrl = provider.baseUrl;
  return {
    provider: {
      id: provider.id,
      code: provider.code,
      name: provider.name,
      providerType: provider.providerType,
      baseUrl,
      apiKey: provider.apiKey,
      organization: provider.organization,
      project: provider.project,
      timeoutMs: resolveAiProviderTimeoutMs(provider.timeoutMs),
      options: parseOptions(provider.optionsJson),
    },
    model: {
      id: model.id,
      name: model.name,
      modelId: model.modelId,
      modelType: model.modelType,
      capabilities: parseOptions(model.capabilitiesJson),
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      inputPrice: model.inputPrice,
      cachedInputPrice: model.cachedInputPrice,
      cacheWritePrice: model.cacheWritePrice,
      outputPrice: model.outputPrice,
      currency: model.currency,
    },
  };
}

/**
 * Image models do not participate in the text-purpose fallback table yet. They
 * are resolved explicitly so a Chat/Agent model can never be used as an image
 * model by accident.
 */
export async function getAiImageRuntimeConfig(modelId?: number | null): Promise<AiProviderRuntimeConfig> {
  const model = requireActiveModel(
    modelId
      ? await getAiModel(modelId)
      : ((await sqlite
          .prepare(`${modelSelectSql("AND model_type = 'image' AND status = 1")} ORDER BY id ASC LIMIT 1`)
          .get()) as AiModelRow | undefined),
  );
  if (model.modelType !== "image") {
    throw new AiRuntimeConfigurationError("图片工作流需要 Image 类型模型，请在模型管理中配置");
  }
  const provider = requireActiveProvider(await getAiProvider(model.providerId));
  return {
    provider: {
      id: provider.id,
      code: provider.code,
      name: provider.name,
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      organization: provider.organization,
      project: provider.project,
      timeoutMs: resolveAiProviderTimeoutMs(provider.timeoutMs),
      options: parseOptions(provider.optionsJson),
    },
    model: {
      id: model.id,
      name: model.name,
      modelId: model.modelId,
      modelType: model.modelType,
      capabilities: parseOptions(model.capabilitiesJson),
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      inputPrice: model.inputPrice,
      cachedInputPrice: model.cachedInputPrice,
      cacheWritePrice: model.cacheWritePrice,
      outputPrice: model.outputPrice,
      currency: model.currency,
    },
  };
}

export async function hasActiveAiImageModel() {
  const row = await sqlite
    .prepare(
      "SELECT 1 FROM sys_ai_model m INNER JOIN sys_ai_provider p ON p.id = m.provider_id WHERE m.model_type = 'image' AND m.status = 1 AND m.deleted_at IS NULL AND p.status = 1 AND p.deleted_at IS NULL LIMIT 1",
    )
    .get();
  return Boolean(row);
}
