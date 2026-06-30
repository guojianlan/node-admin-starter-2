import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { decryptSecret } from "@/server/services/secret";
import type { AiModelRow, AiProviderRow } from "./ai-provider-service";

type AiProviderForSdk = Pick<
  AiProviderRow,
  | "code"
  | "name"
  | "providerType"
  | "baseUrl"
  | "apiKeyEncrypted"
  | "organization"
  | "project"
  | "optionsJson"
>;

type AiModelForSdk = Pick<AiModelRow, "modelId" | "modelType" | "maxOutputTokens">;

type AiSdkRuntime = {
  model: LanguageModel;
  endpointHint: string;
  maxOutputTokens: number;
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

function providerRequiresApiKey(provider: Pick<AiProviderForSdk, "providerType" | "optionsJson">) {
  const options = parseOptions(provider.optionsJson);
  if (options.authRequired === false) return false;
  return provider.providerType !== "ollama";
}

function getApiKey(provider: AiProviderForSdk) {
  const apiKey = decryptSecret(provider.apiKeyEncrypted);
  if (!apiKey && providerRequiresApiKey(provider)) throw new Error("AI Provider API Key 未配置");
  return apiKey || undefined;
}

function getHeaders(provider: AiProviderForSdk) {
  const options = parseOptions(provider.optionsJson);
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
  const options = parseOptions(provider.optionsJson);
  return stringRecord(options.queryParams);
}

function getOpenAiCompatibleBodyTransform(provider: AiProviderForSdk) {
  const options = parseOptions(provider.optionsJson);
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
  const maxOutputTokens = Math.min(Math.max(model.maxOutputTokens ?? 4096, 16), 32768);

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
