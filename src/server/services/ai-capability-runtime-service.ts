import { embed, embedMany, generateObject, type FlexibleSchema } from "ai";
import { getAiRuntimeConfig, resolveAiProviderTimeoutMs } from "./ai-provider-service";
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

export async function generateAiStructured<RESULT>(input: {
  schema: FlexibleSchema<RESULT>;
  prompt?: string;
  messages?: AiRuntimeMessage[];
  modelId?: number | null;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}) {
  const config = await getAiRuntimeConfig("structured", input.modelId);
  const runtime = buildAiSdkChatRuntime(config.provider, config.model);
  const result = await generateObject({
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
  });
  return {
    object: result.object,
    finishReason: result.finishReason,
    usage: normalizeUsage(result.usage),
    provider: { id: config.provider.id, code: config.provider.code, name: config.provider.name },
    model: { id: config.model.id, modelId: config.model.modelId, name: config.model.name },
  };
}

export async function embedAiText(input: {
  value: string;
  modelId?: number | null;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}) {
  const value = input.value.trim();
  if (!value) throw new Error("请输入需要向量化的文本");
  const config = await getAiRuntimeConfig("embedding", input.modelId);
  const runtime = buildAiSdkEmbeddingRuntime(config.provider, config.model);
  const result = await embed({
    model: runtime.model,
    value,
    abortSignal: withProviderTimeout(
      resolveAiProviderTimeoutMs(config.provider.timeoutMs, input.timeoutMs),
      input.abortSignal,
    ),
  });
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
}) {
  const values = input.values.map((value) => value.trim()).filter(Boolean);
  if (!values.length) throw new Error("请输入需要向量化的文本列表");
  if (values.length > 1000) throw new Error("单次最多向量化 1000 条文本");
  const config = await getAiRuntimeConfig("embedding", input.modelId);
  const runtime = buildAiSdkEmbeddingRuntime(config.provider, config.model);
  const result = await embedMany({
    model: runtime.model,
    values,
    abortSignal: withProviderTimeout(
      resolveAiProviderTimeoutMs(config.provider.timeoutMs, input.timeoutMs),
      input.abortSignal,
    ),
  });
  return {
    embeddings: result.embeddings,
    usage: normalizeUsage(result.usage),
    provider: { id: config.provider.id, code: config.provider.code, name: config.provider.name },
    model: { id: config.model.id, modelId: config.model.modelId, name: config.model.name },
  };
}
