import { sqlite } from "@/server/db";
import { decryptSecret } from "@/server/services/secret";

export type AiModelUsage = "chat" | "structured" | "embedding";

export type AiProviderRuntimeConfig = {
  provider: {
    id: number;
    code: string;
    name: string;
    providerType: string;
    baseUrl: string;
    apiKey: string;
    organization?: string | null;
    project?: string | null;
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
    is_default_chat AS "isDefaultChat",
    is_default_structured AS "isDefaultStructured",
    is_default_embedding AS "isDefaultEmbedding",
    status
   FROM sys_ai_model
   WHERE deleted_at IS NULL ${extraWhere}`;
}

function requireActiveProvider(provider?: AiProviderRow | null) {
  if (!provider) throw new Error("AI Provider 未配置");
  if (provider.status !== 1) throw new Error("AI Provider 已停用");
  const baseUrl = provider.baseUrl;
  if (!baseUrl) throw new Error("AI Provider Base URL 未配置");
  const apiKey = decryptSecret(provider.apiKeyEncrypted);
  if (!apiKey) throw new Error("AI Provider API Key 未配置");
  return { ...provider, baseUrl, apiKey };
}

function requireActiveModel(model?: AiModelRow | null) {
  if (!model) throw new Error("AI 模型未配置");
  if (model.status !== 1) throw new Error("AI 模型已停用");
  return model;
}

export async function getAiProvider(id: number) {
  return (await sqlite
    .prepare(`${providerSelectSql("AND id = ?")} LIMIT 1`)
    .get(id)) as AiProviderRow | undefined;
}

export async function getDefaultAiProvider() {
  return (await sqlite
    .prepare(`${providerSelectSql("AND is_default = true")} ORDER BY id ASC LIMIT 1`)
    .get()) as AiProviderRow | undefined;
}

export async function getAiModel(id: number) {
  return (await sqlite
    .prepare(`${modelSelectSql("AND id = ?")} LIMIT 1`)
    .get(id)) as AiModelRow | undefined;
}

export async function getDefaultAiModel(usage: AiModelUsage) {
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

export async function getAiRuntimeConfig(usage: AiModelUsage = "chat"): Promise<AiProviderRuntimeConfig> {
  const model = requireActiveModel(await getDefaultAiModel(usage));
  if (usage === "embedding" && model.modelType !== "embedding") {
    throw new Error("默认 Embedding 模型类型不正确");
  }
  if ((usage === "chat" || usage === "structured") && model.modelType !== "chat") {
    throw new Error("默认 Chat/Structured 模型类型不正确");
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
    },
  };
}
