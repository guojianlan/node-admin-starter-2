import { generateText, streamText } from "ai";
import type { AiModelUsage, AiProviderRuntimeConfig } from "./ai-provider-service";
import { getAiRuntimeConfig } from "./ai-provider-service";
import { buildAiSdkChatRuntime } from "./ai-sdk-runtime";

export type AiRuntimeCallOptions = {
  usage?: AiModelUsage;
  input: string;
  maxOutputTokens?: number;
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

const defaultTimeoutMs = 60000;
const minOutputTokens = 16;
const maxOutputTokenLimit = 32768;

function clampOutputTokens(value: number) {
  return Math.min(Math.max(Math.round(value), minOutputTokens), maxOutputTokenLimit);
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

function resolveRuntime(options: AiRuntimeCallOptions) {
  if (!options.input.trim()) throw new Error("请输入 AI 调用内容");
  return {
    usage: options.usage ?? "chat",
    input: options.input.trim(),
    timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
  };
}

export async function createAiRuntime(options: AiRuntimeCallOptions) {
  const base = resolveRuntime(options);
  const config = await getAiRuntimeConfig(base.usage);
  const sdkRuntime = buildAiSdkChatRuntime(config.provider, config.model);
  const maxOutputTokens = clampOutputTokens(options.maxOutputTokens ?? sdkRuntime.maxOutputTokens);
  return {
    ...base,
    config,
    sdkRuntime,
    maxOutputTokens,
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
    prompt: runtime.input,
    maxOutputTokens: runtime.maxOutputTokens,
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
      inputLength: runtime.input.length,
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
    prompt: runtime.input,
    maxOutputTokens: runtime.maxOutputTokens,
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
