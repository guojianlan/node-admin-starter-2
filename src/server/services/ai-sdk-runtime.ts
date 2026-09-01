import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { EmbeddingModel, ImageModel, LanguageModel } from "ai";
import { decryptSecret } from "@/server/services/secret";
import type { AiModelRow } from "./ai-provider-service";

type AiProviderForSdk = {
  code: string;
  name: string;
  providerType: string;
  baseUrl: string | null;
  apiKey?: string | null;
  apiKeyEncrypted?: string | null;
  organization?: string | null;
  project?: string | null;
  options?: Record<string, unknown>;
  optionsJson?: string | null;
};

type AiModelForSdk = Pick<AiModelRow, "modelId" | "modelType"> & {
  maxOutputTokens?: number | null;
};

type AiSdkRuntime = {
  model: LanguageModel;
  endpointHint: string;
  maxOutputTokens: number;
};

type AiSdkEmbeddingRuntime = {
  model: EmbeddingModel;
  endpointHint: string;
};

export type AiSdkImageRuntime = {
  model: ImageModel;
  endpointHint: string;
};

const openAiCompatibleProviderTypes = new Set([
  "openai-compatible",
  "deepseek",
  "qwen",
  "moonshot",
  "zhipu",
  "siliconflow",
  "openrouter",
  "ollama",
  "custom",
]);

export const aiOutputTokenSafetyLimit = 131072;

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

function getOptions(provider: Pick<AiProviderForSdk, "options" | "optionsJson">) {
  return provider.options ?? parseOptions(provider.optionsJson);
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === "string")
      .map(([key, item]) => [key, item as string]),
  );
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function providerRequiresApiKey(
  provider: Pick<AiProviderForSdk, "providerType" | "options" | "optionsJson">,
) {
  const options = getOptions(provider);
  if (options.authRequired === false) return false;
  return provider.providerType !== "ollama";
}

function getApiKey(provider: AiProviderForSdk) {
  const apiKey = provider.apiKey || decryptSecret(provider.apiKeyEncrypted);
  if (!apiKey && providerRequiresApiKey(provider)) throw new Error("AI Provider API Key 未配置");
  return apiKey || undefined;
}

function getHeaders(provider: AiProviderForSdk) {
  const options = getOptions(provider);
  const headers = stringRecord(options.headers);
  if (
    provider.providerType === "openai" ||
    openAiCompatibleProviderTypes.has(provider.providerType)
  ) {
    return {
      ...(provider.organization ? { "openai-organization": provider.organization } : {}),
      ...(provider.project ? { "openai-project": provider.project } : {}),
      ...headers,
    };
  }
  return headers;
}

function getQueryParams(provider: AiProviderForSdk) {
  const options = getOptions(provider);
  return stringRecord(options.queryParams);
}

function getOpenAiCompatibleBodyTransform(provider: AiProviderForSdk) {
  const options = getOptions(provider);
  const requestBody = options.requestBody;
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody))
    return undefined;
  const extraBody = requestBody as Record<string, unknown>;
  return (body: Record<string, unknown>) => ({ ...body, ...extraBody });
}

function buildEndpointHint(provider: AiProviderForSdk, modelId: string) {
  const baseUrl = normalizeBaseUrl(String(provider.baseUrl));
  if (provider.providerType === "anthropic") return `${baseUrl}/messages`;
  if (provider.providerType === "google") {
    const normalizedModelId = modelId.startsWith("models/") ? modelId : `models/${modelId}`;
    return `${baseUrl}/${normalizedModelId}:streamGenerateContent`;
  }
  return `${baseUrl}/chat/completions`;
}

export function buildAiSdkChatRuntime(
  provider: AiProviderForSdk,
  model: AiModelForSdk,
): AiSdkRuntime {
  if (model.modelType !== "chat") throw new Error("只有 Chat 模型支持流式测试");
  if (!provider.baseUrl) throw new Error("AI Provider Base URL 未配置");
  const baseURL = normalizeBaseUrl(provider.baseUrl);
  const apiKey = getApiKey(provider);
  const headers = getHeaders(provider);
  const maxOutputTokens = Math.min(
    Math.max(model.maxOutputTokens ?? 16384, 16),
    aiOutputTokenSafetyLimit,
  );

  if (provider.providerType === "openai") {
    const client = createOpenAI({
      baseURL,
      apiKey,
      organization: provider.organization ?? undefined,
      project: provider.project ?? undefined,
      headers,
      name: provider.code,
    });
    return {
      model: client.chat(model.modelId),
      endpointHint: buildEndpointHint(provider, model.modelId),
      maxOutputTokens,
    };
  }

  if (provider.providerType === "anthropic") {
    const client = createAnthropic({
      baseURL,
      apiKey,
      headers,
      name: provider.code,
    });
    return {
      model: client.chat(model.modelId),
      endpointHint: buildEndpointHint(provider, model.modelId),
      maxOutputTokens,
    };
  }

  if (provider.providerType === "google") {
    const client = createGoogle({
      baseURL,
      apiKey,
      headers,
      name: provider.code,
    });
    return {
      model: client.chat(model.modelId),
      endpointHint: buildEndpointHint(provider, model.modelId),
      maxOutputTokens,
    };
  }

  if (!openAiCompatibleProviderTypes.has(provider.providerType)) {
    throw new Error(`暂不支持 ${provider.providerType} 的 AI SDK 流式测试`);
  }

  const client = createOpenAICompatible({
    name: provider.code,
    baseURL,
    apiKey,
    headers,
    queryParams: getQueryParams(provider),
    transformRequestBody: getOpenAiCompatibleBodyTransform(provider),
  });
  return {
    model: client.chatModel(model.modelId),
    endpointHint: buildEndpointHint(provider, model.modelId),
    maxOutputTokens,
  };
}

export function buildAiSdkEmbeddingRuntime(
  provider: AiProviderForSdk,
  model: AiModelForSdk,
): AiSdkEmbeddingRuntime {
  if (model.modelType !== "embedding") throw new Error("只有 Embedding 模型支持向量调用");
  if (!provider.baseUrl) throw new Error("AI Provider Base URL 未配置");
  if (provider.providerType === "anthropic") throw new Error("Anthropic Provider 不支持 Embedding 模型");
  const baseURL = normalizeBaseUrl(provider.baseUrl);
  const apiKey = getApiKey(provider);
  const headers = getHeaders(provider);
  const endpointHint = provider.providerType === "google"
    ? `${baseURL}/${model.modelId.startsWith("models/") ? model.modelId : `models/${model.modelId}`}:embedContent`
    : `${baseURL}/embeddings`;

  if (provider.providerType === "openai") {
    const client = createOpenAI({ baseURL, apiKey, headers, organization: provider.organization ?? undefined, project: provider.project ?? undefined, name: provider.code });
    return { model: client.embeddingModel(model.modelId), endpointHint };
  }
  if (provider.providerType === "google") {
    const client = createGoogle({ baseURL, apiKey, headers, name: provider.code });
    return { model: client.embeddingModel(model.modelId), endpointHint };
  }
  if (!openAiCompatibleProviderTypes.has(provider.providerType)) {
    throw new Error(`暂不支持 ${provider.providerType} 的 Embedding Runtime`);
  }
  const client = createOpenAICompatible({
    name: provider.code,
    baseURL,
    apiKey,
    headers,
    queryParams: getQueryParams(provider),
    transformRequestBody: getOpenAiCompatibleBodyTransform(provider),
  });
  return { model: client.embeddingModel(model.modelId), endpointHint };
}

export function buildAiSdkImageRuntime(
  provider: AiProviderForSdk,
  model: AiModelForSdk,
): AiSdkImageRuntime {
  if (model.modelType !== "image") throw new Error("只有 Image 模型支持图片生成或编辑");
  if (!provider.baseUrl) throw new Error("AI Provider Base URL 未配置");

  const baseURL = normalizeBaseUrl(provider.baseUrl);
  const apiKey = getApiKey(provider);
  const headers = getHeaders(provider);
  const endpointHint = `${baseURL}/images/edits`;

  if (provider.providerType === "openai") {
    const client = createOpenAI({
      baseURL,
      apiKey,
      organization: provider.organization ?? undefined,
      project: provider.project ?? undefined,
      headers,
      name: provider.code,
    });
    return { model: client.imageModel(model.modelId), endpointHint };
  }

  if (provider.providerType === "google") {
    const client = createGoogle({
      baseURL,
      apiKey,
      headers,
      name: provider.code,
    });
    return { model: client.imageModel(model.modelId), endpointHint };
  }

  if (!openAiCompatibleProviderTypes.has(provider.providerType)) {
    throw new Error(`暂不支持 ${provider.providerType} 的 AI SDK 图片 Runtime`);
  }

  const client = createOpenAICompatible({
    name: provider.code,
    baseURL,
    apiKey,
    headers,
    queryParams: getQueryParams(provider),
  });
  return { model: client.imageModel(model.modelId), endpointHint };
}
