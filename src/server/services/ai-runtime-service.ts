import { generateText, streamText, type ModelMessage } from "ai";
import type { AiModelUsage, AiProviderRuntimeConfig } from "./ai-provider-service";
import { resolveAiProviderTimeoutMs } from "./ai-provider-service";
import {
  beginAiInvocation,
  beginAiInvocationAttempt,
  finishAiInvocation,
  finishAiInvocationAttempt,
  resolveAiRuntimeCandidates,
  type AiInvocationTrace,
  type AiModelPurpose,
} from "./ai-reliability-service";
import { aiOutputTokenSafetyLimit, buildAiSdkChatRuntime } from "./ai-sdk-runtime";

export type AiRuntimeMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiRuntimeCallOptions = {
  usage?: AiModelUsage;
  purpose?: AiModelPurpose;
  input?: string;
  messages?: AiRuntimeMessage[];
  modelId?: number | null;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  trace?: Omit<AiInvocationTrace, "purpose">;
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
  invocationId: number;
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
    purpose: options.purpose ?? options.usage ?? "chat",
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

async function resolveAiRuntimePool(options: AiRuntimeCallOptions) {
  const base = resolveRuntime(options);
  const configs = await resolveAiRuntimeCandidates({
    purpose: base.purpose,
    modelId: options.modelId,
  });
  return { base, configs };
}

function createRuntimeFromConfig(
  options: AiRuntimeCallOptions,
  base: ReturnType<typeof resolveRuntime>,
  config: AiProviderRuntimeConfig,
) {
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

export async function createAiRuntime(options: AiRuntimeCallOptions) {
  const { base, configs } = await resolveAiRuntimePool(options);
  return createRuntimeFromConfig(options, base, configs[0]);
}

export async function createAiRuntimePool(options: AiRuntimeCallOptions) {
  const { base, configs } = await resolveAiRuntimePool(options);
  return configs.map((config) => createRuntimeFromConfig(options, base, config));
}

export async function generateAiText(
  options: AiRuntimeCallOptions,
): Promise<AiTextGenerationResult> {
  const startedAt = performance.now();
  const { base, configs } = await resolveAiRuntimePool(options);
  const invocationId = await beginAiInvocation({
    purpose: base.purpose,
    sourceType: options.trace?.sourceType ?? "runtime",
    sourceId: options.trace?.sourceId,
    requestId: options.trace?.requestId,
    userId: options.trace?.userId,
    sessionId: options.trace?.sessionId,
    runId: options.trace?.runId,
    stepId: options.trace?.stepId,
    modelId: options.modelId,
  });
  let lastError: unknown;
  for (const [index, config] of configs.entries()) {
    const runtime = createRuntimeFromConfig(options, base, config);
    const attemptStartedAt = performance.now();
    const attemptId = await beginAiInvocationAttempt({
      invocationId,
      attemptNo: index + 1,
      config,
    });
    try {
      const result = await generateText({
        model: runtime.sdkRuntime.model,
        maxRetries: 0,
        ...promptOptions(runtime),
        maxOutputTokens: runtime.maxOutputTokens,
        temperature: runtime.temperature,
        timeout: runtime.timeoutMs,
        abortSignal: options.abortSignal,
      });
      const durationMs = Math.round(performance.now() - startedAt);
      const attemptDurationMs = Math.round(performance.now() - attemptStartedAt);
      await finishAiInvocationAttempt({
        id: attemptId,
        status: "completed",
        config,
        usage: result.usage,
        latencyMs: attemptDurationMs,
      });
      await finishAiInvocation({
        id: invocationId,
        status: "completed",
        config,
        attemptCount: index + 1,
        usage: result.usage,
        durationMs,
      });
      return {
        invocationId,
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
        durationMs,
        warnings: normalizeWarnings(result.warnings),
      };
    } catch (error) {
      lastError = error;
      const status = options.abortSignal?.aborted ? "aborted" : "failed";
      await finishAiInvocationAttempt({
        id: attemptId,
        status,
        config,
        latencyMs: Math.round(performance.now() - attemptStartedAt),
        error,
      });
      if (status === "aborted" || index === configs.length - 1) {
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

export async function streamAiText(options: AiRuntimeCallOptions) {
  const startedAt = performance.now();
  const { base, configs } = await resolveAiRuntimePool(options);
  const invocationId = await beginAiInvocation({
    purpose: base.purpose,
    sourceType: options.trace?.sourceType ?? "runtime_stream",
    sourceId: options.trace?.sourceId,
    requestId: options.trace?.requestId,
    userId: options.trace?.userId,
    sessionId: options.trace?.sessionId,
    runId: options.trace?.runId,
    stepId: options.trace?.stepId,
    modelId: options.modelId,
  });
  let lastError: unknown;
  for (const [index, config] of configs.entries()) {
    const runtime = createRuntimeFromConfig(options, base, config);
    const attemptStartedAt = performance.now();
    const attemptId = await beginAiInvocationAttempt({
      invocationId,
      attemptNo: index + 1,
      config,
    });
    try {
      const result = streamText({
        model: runtime.sdkRuntime.model,
        maxRetries: 0,
        ...promptOptions(runtime),
        maxOutputTokens: runtime.maxOutputTokens,
        temperature: runtime.temperature,
        timeout: runtime.timeoutMs,
        abortSignal: options.abortSignal,
      });
      const iterator = result.fullStream[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (!first.done && first.value.type === "error") throw first.value.error;
      const firstResponseMs = Math.round(performance.now() - attemptStartedAt);
      const fullStream = {
        async *[Symbol.asyncIterator]() {
          let usage: unknown;
          let completed = false;
          try {
            if (!first.done) {
              if (first.value.type === "finish") usage = first.value.totalUsage;
              yield first.value;
            }
            while (true) {
              const next = await iterator.next();
              if (next.done) break;
              if (next.value.type === "finish") usage = next.value.totalUsage;
              if (next.value.type === "error") throw next.value.error;
              yield next.value;
            }
            completed = true;
            const durationMs = Math.round(performance.now() - startedAt);
            await finishAiInvocationAttempt({
              id: attemptId,
              status: "completed",
              config,
              usage,
              latencyMs: Math.round(performance.now() - attemptStartedAt),
              firstTokenMs: firstResponseMs,
            });
            await finishAiInvocation({
              id: invocationId,
              status: "completed",
              config,
              attemptCount: index + 1,
              usage,
              durationMs,
            });
          } catch (error) {
            const status = options.abortSignal?.aborted ? "aborted" : "failed";
            await finishAiInvocationAttempt({
              id: attemptId,
              status,
              config,
              usage,
              latencyMs: Math.round(performance.now() - attemptStartedAt),
              firstTokenMs: firstResponseMs,
              error,
            });
            await finishAiInvocation({
              id: invocationId,
              status,
              config,
              attemptCount: index + 1,
              usage,
              durationMs: Math.round(performance.now() - startedAt),
              error,
            });
            throw error;
          } finally {
            if (!completed && options.abortSignal?.aborted) await iterator.return?.();
          }
        },
      };
      return {
        ...runtime,
        endpointHint: runtime.sdkRuntime.endpointHint,
        stream: { fullStream },
        invocationId,
        attemptNo: index + 1,
        startedAt,
        resolveDurationMs: () => Math.round(performance.now() - startedAt),
        normalizeUsage,
      };
    } catch (error) {
      lastError = error;
      const status = options.abortSignal?.aborted ? "aborted" : "failed";
      await finishAiInvocationAttempt({
        id: attemptId,
        status,
        config,
        latencyMs: Math.round(performance.now() - attemptStartedAt),
        error,
      });
      if (status === "aborted" || index === configs.length - 1) {
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
