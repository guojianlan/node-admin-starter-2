import { embed, embedMany, generateObject, type FlexibleSchema } from "ai";
import { resolveAiProviderTimeoutMs } from "./ai-provider-service";
import { executeAiWithFallback, type AiInvocationTrace } from "./ai-reliability-service";
import { buildAiSdkChatRuntime, buildAiSdkEmbeddingRuntime } from "./ai-sdk-runtime";
import { resolveAiOutputTokens, type AiRuntimeMessage } from "./ai-runtime-service";

function normalizeUsage(usage: unknown) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return {};
  return Object.fromEntries(
    Object.entries(usage as Record<string, unknown>).filter(([, value]) => value != null),
  );
}

function withProviderTimeout(timeoutMs: number, abortSignal?: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return abortSignal ? AbortSignal.any([abortSignal, timeoutSignal]) : timeoutSignal;
}

function embeddingProviderOptions(config: {
  provider: { providerType: string };
  model: { capabilities: Record<string, unknown> };
}): Record<string, { dimensions: number }> | undefined {
  const dimensions = Number(config.model.capabilities.dimensions);
  if (!Number.isInteger(dimensions) || dimensions <= 0) return undefined;
  if (config.provider.providerType === "openai") return { openai: { dimensions } };
  if (config.provider.providerType === "google") return undefined;
  return { openaiCompatible: { dimensions } };
}

function assertEmbeddingDimensions(embeddings: number[][], capabilities: Record<string, unknown>) {
  const dimensions = Number(capabilities.dimensions);
  if (!Number.isInteger(dimensions) || dimensions <= 0) return;
  if (embeddings.some((embedding) => embedding.length !== dimensions)) {
    throw new Error(`Embedding Provider 返回维度与模型配置不一致，期望 ${dimensions} 维`);
  }
}

export async function generateAiStructured<RESULT>(input: {
  schema: FlexibleSchema<RESULT>;
  prompt?: string;
  messages?: AiRuntimeMessage[];
  modelId?: number | null;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  trace?: Omit<AiInvocationTrace, "purpose">;
  purpose?: "structured" | "evalJudge";
}) {
  const execution = await executeAiWithFallback({
    purpose: input.purpose ?? "structured",
    modelId: input.modelId,
    trace: input.trace ?? { sourceType: "structured" },
    abortSignal: input.abortSignal,
    execute: async (config) => {
      const runtime = buildAiSdkChatRuntime(config.provider, config.model);
      return generateObject({
        model: runtime.model,
        schema: input.schema,
        ...(input.messages?.length
          ? { messages: input.messages, allowSystemInMessages: true }
          : { prompt: input.prompt?.trim() || "请按给定结构生成结果" }),
        maxOutputTokens: resolveAiOutputTokens({
          requested: input.maxOutputTokens,
          modelLimit: config.model.maxOutputTokens,
          fallback: runtime.maxOutputTokens,
        }),
        temperature: input.temperature,
        timeout: resolveAiProviderTimeoutMs(config.provider.timeoutMs, input.timeoutMs),
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });
    },
  });
  const { result, config } = execution;
  return {
    object: result.object,
    finishReason: result.finishReason,
    usage: normalizeUsage(result.usage),
    provider: { id: config.provider.id, code: config.provider.code, name: config.provider.name },
    model: { id: config.model.id, modelId: config.model.modelId, name: config.model.name },
    invocationId: execution.invocationId,
  };
}

export async function embedAiText(input: {
  value: string;
  modelId?: number | null;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  trace?: Omit<AiInvocationTrace, "purpose">;
}) {
  const value = input.value.trim();
  if (!value) throw new Error("请输入需要向量化的文本");
  const execution = await executeAiWithFallback({
    purpose: "embedding",
    modelId: input.modelId,
    trace: input.trace ?? { sourceType: "embedding" },
    abortSignal: input.abortSignal,
    execute: async (config) => {
      const runtime = buildAiSdkEmbeddingRuntime(config.provider, config.model);
      const result = await embed({
        model: runtime.model,
        value,
        providerOptions: embeddingProviderOptions(config),
        abortSignal: withProviderTimeout(
          resolveAiProviderTimeoutMs(config.provider.timeoutMs, input.timeoutMs),
          input.abortSignal,
        ),
        maxRetries: 0,
      });
      assertEmbeddingDimensions([result.embedding], config.model.capabilities);
      return result;
    },
  });
  const { result, config } = execution;
  return {
    embedding: result.embedding,
    usage: normalizeUsage(result.usage),
    provider: { id: config.provider.id, code: config.provider.code, name: config.provider.name },
    model: { id: config.model.id, modelId: config.model.modelId, name: config.model.name },
  };
}

export async function embedAiTexts(input: {
  values: string[];
  modelId?: number | null;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  trace?: Omit<AiInvocationTrace, "purpose">;
}) {
  const values = input.values.map((value) => value.trim()).filter(Boolean);
  if (!values.length) throw new Error("请输入需要向量化的文本列表");
  if (values.length > 1000) throw new Error("单次最多向量化 1000 条文本");
  const execution = await executeAiWithFallback({
    purpose: "embedding",
    modelId: input.modelId,
    trace: input.trace ?? { sourceType: "embedding_batch" },
    abortSignal: input.abortSignal,
    execute: async (config) => {
      const runtime = buildAiSdkEmbeddingRuntime(config.provider, config.model);
      const result = await embedMany({
        model: runtime.model,
        values,
        providerOptions: embeddingProviderOptions(config),
        abortSignal: withProviderTimeout(
          resolveAiProviderTimeoutMs(config.provider.timeoutMs, input.timeoutMs),
          input.abortSignal,
        ),
        maxRetries: 0,
      });
      assertEmbeddingDimensions(result.embeddings, config.model.capabilities);
      return result;
    },
  });
  const { result, config } = execution;
  return {
    embeddings: result.embeddings,
    usage: normalizeUsage(result.usage),
    provider: { id: config.provider.id, code: config.provider.code, name: config.provider.name },
    model: { id: config.model.id, modelId: config.model.modelId, name: config.model.name },
  };
}
