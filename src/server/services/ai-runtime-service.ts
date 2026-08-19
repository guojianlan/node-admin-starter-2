import { generateText, streamText, type ModelMessage } from "ai";
import type { AiModelUsage, AiProviderRuntimeConfig } from "./ai-provider-service";
import { getAiRuntimeConfig, resolveAiProviderTimeoutMs } from "./ai-provider-service";
import { aiOutputTokenSafetyLimit, buildAiSdkChatRuntime } from "./ai-sdk-runtime";

export type AiRuntimeMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiRuntimeCallOptions = {
  usage?: AiModelUsage;
  input?: string;
  messages?: AiRuntimeMessage[];
  modelId?: number | null;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
};

export type AiRuntimePublicConfig = {
  provider: {
    id: number;
    code: string;
    name: string;
    providerType: string;
    baseUrl: string;
    hasApiKey: boolean;
    timeoutMs: number;
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

export type AiTextGenerationResult = AiRuntimePublicConfig & {
  text: string;
  finishReason: string;
  rawFinishReason?: string;
  usage: Record<string, unknown>;
  request: {
    usage: AiModelUsage;
    inputLength: number;
    maxOutputTokens: number;
    timeoutMs: number;
  };
  durationMs: number;
  warnings?: string[];
};

const minOutputTokens = 16;
export function resolveAiOutputTokens(input: {
  requested?: number | null;
  modelLimit?: number | null;
  fallback?: number;
}) {
  const configured =
    input.modelLimit && input.modelLimit > 0 ? input.modelLimit : (input.fallback ?? 16384);
  const requested = input.requested && input.requested > 0 ? input.requested : configured;
  return Math.min(
    Math.max(Math.round(requested), minOutputTokens),
    Math.max(Math.round(configured), minOutputTokens),
    aiOutputTokenSafetyLimit,
  );
}

function normalizeUsage(usage: unknown): Record<string, unknown> {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return {};
  return Object.fromEntries(
    Object.entries(usage as Record<string, unknown>).filter(([, value]) => value != null),
  );
}

function normalizeWarnings(warnings: unknown) {
  if (!Array.isArray(warnings) || warnings.length === 0) return undefined;
  return warnings.map((warning) => {
    if (warning && typeof warning === "object") return JSON.stringify(warning);
    return String(warning);
  });
}

function publicConfig(config: AiProviderRuntimeConfig): AiRuntimePublicConfig {
  return {
    provider: {
      id: config.provider.id,
      code: config.provider.code,
      name: config.provider.name,
      providerType: config.provider.providerType,
      baseUrl: config.provider.baseUrl,
      hasApiKey: Boolean(config.provider.apiKey),
      timeoutMs: config.provider.timeoutMs,
    },
    model: {
      id: config.model.id,
      name: config.model.name,
      modelId: config.model.modelId,
      modelType: config.model.modelType,
      capabilities: config.model.capabilities,
      contextWindow: config.model.contextWindow,
      maxOutputTokens: config.model.maxOutputTokens,
    },
  };
}

function normalizeMessages(messages?: AiRuntimeMessage[]) {
  return (messages ?? [])
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content);
}

function resolveRuntime(options: AiRuntimeCallOptions) {
  const messages = normalizeMessages(options.messages);
  const input = options.input?.trim() ?? "";
  if (!input && messages.length === 0) throw new Error("请输入 AI 调用内容");
  return {
    usage: options.usage ?? "chat",
    input,
    messages,
  };
}

function toModelMessages(messages: AiRuntimeMessage[]): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function promptOptions(runtime: { input: string; messages: AiRuntimeMessage[] }) {
  if (runtime.messages.length) {
    return { messages: toModelMessages(runtime.messages), allowSystemInMessages: true } as const;
  }
  return { prompt: runtime.input } as const;
}

function inputLength(runtime: { input: string; messages: AiRuntimeMessage[] }) {
  if (runtime.messages.length) {
    return runtime.messages.reduce((total, message) => total + message.content.length, 0);
  }
  return runtime.input.length;
}

export async function createAiRuntime(options: AiRuntimeCallOptions) {
  const base = resolveRuntime(options);
  const config = await getAiRuntimeConfig(base.usage, options.modelId);
  const sdkRuntime = buildAiSdkChatRuntime(config.provider, config.model);
  const maxOutputTokens = resolveAiOutputTokens({
    requested: options.maxOutputTokens,
    modelLimit: config.model.maxOutputTokens,
    fallback: sdkRuntime.maxOutputTokens,
  });
  return {
    ...base,
    config,
    sdkRuntime,
    timeoutMs: resolveAiProviderTimeoutMs(config.provider.timeoutMs, options.timeoutMs),
    maxOutputTokens,
    temperature:
      typeof options.temperature === "number"
        ? Math.min(Math.max(options.temperature, 0), 2)
        : undefined,
    publicConfig: publicConfig(config),
  };
}

export async function generateAiText(
  options: AiRuntimeCallOptions,
): Promise<AiTextGenerationResult> {
  const startedAt = performance.now();
  const runtime = await createAiRuntime(options);
  const result = await generateText({
    model: runtime.sdkRuntime.model,
    ...promptOptions(runtime),
    maxOutputTokens: runtime.maxOutputTokens,
    temperature: runtime.temperature,
    timeout: runtime.timeoutMs,
    abortSignal: options.abortSignal,
  });

  return {
    ...runtime.publicConfig,
    text: result.text,
    finishReason: result.finishReason,
    rawFinishReason: result.rawFinishReason,
    usage: normalizeUsage(result.usage),
    request: {
      usage: runtime.usage,
      inputLength: inputLength(runtime),
      maxOutputTokens: runtime.maxOutputTokens,
      timeoutMs: runtime.timeoutMs,
    },
    durationMs: Math.round(performance.now() - startedAt),
    warnings: normalizeWarnings(result.warnings),
  };
}

export async function streamAiText(options: AiRuntimeCallOptions) {
  const startedAt = performance.now();
  const runtime = await createAiRuntime(options);
  const result = streamText({
    model: runtime.sdkRuntime.model,
    ...promptOptions(runtime),
    maxOutputTokens: runtime.maxOutputTokens,
    temperature: runtime.temperature,
    timeout: runtime.timeoutMs,
    abortSignal: options.abortSignal,
  });

  return {
    ...runtime,
    endpointHint: runtime.sdkRuntime.endpointHint,
    stream: result,
    startedAt,
    resolveDurationMs: () => Math.round(performance.now() - startedAt),
    normalizeUsage,
  };
}
