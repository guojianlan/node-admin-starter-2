import { rerank, type RerankingModel } from "ai";
import { resolveAiProviderTimeoutMs, type AiProviderRuntimeConfig } from "./ai-provider-service";
import { executeAiWithFallback, type AiInvocationTrace } from "./ai-reliability-service";

export type AiRerankDocument = {
  id: string | number;
  text: string;
};

export type AiRerankResult = {
  id: string | number;
  originalIndex: number;
  score: number;
};

type CompatibleRerankResponse = {
  id?: unknown;
  results?: unknown;
  output?: { results?: unknown };
  usage?: Record<string, unknown>;
  meta?: { billed_units?: Record<string, unknown> };
};

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function rerankEndpoint(config: AiProviderRuntimeConfig) {
  const configuredPath = config.model.capabilities.rerankPath;
  if (typeof configuredPath === "string" && configuredPath.trim()) {
    const baseUrl = new URL(`${normalizeBaseUrl(config.provider.baseUrl)}/`);
    const endpoint = new URL(configuredPath.trim(), baseUrl);
    if (endpoint.origin !== baseUrl.origin) {
      throw new Error("Rerank 路径不能指向 Provider Base URL 之外的域名");
    }
    return endpoint.toString();
  }
  const baseUrl = normalizeBaseUrl(config.provider.baseUrl);
  return baseUrl.endsWith("/reranks") ? baseUrl : `${baseUrl}/reranks`;
}

function normalizeRanking(payload: CompatibleRerankResponse, documentCount: number) {
  const source = Array.isArray(payload.results)
    ? payload.results
    : Array.isArray(payload.output?.results)
      ? payload.output.results
      : [];
  const seen = new Set<number>();
  const ranking: Array<{ index: number; relevanceScore: number }> = [];
  for (const item of source) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const value = item as Record<string, unknown>;
    const index = Number(value.index ?? value.document_index);
    const relevanceScore = Number(value.relevance_score ?? value.score);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= documentCount ||
      !Number.isFinite(relevanceScore) ||
      seen.has(index)
    ) {
      continue;
    }
    seen.add(index);
    ranking.push({ index, relevanceScore });
  }
  if (!ranking.length) throw new Error("Rerank Provider 未返回有效排序结果");
  return ranking.sort((left, right) => right.relevanceScore - left.relevanceScore);
}

function readErrorCode(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const source = payload as Record<string, unknown>;
  const nested = source.error;
  const code =
    (nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>).code
      : null) ?? source.code;
  return typeof code === "string" && code.trim() ? code.trim().slice(0, 100) : null;
}

function createCompatibleRerankingModel(config: AiProviderRuntimeConfig): RerankingModel {
  return {
    specificationVersion: "v4",
    provider: config.provider.code,
    modelId: config.model.modelId,
    async doRerank(options) {
      if (options.documents.type !== "text") {
        throw new Error("当前 Rerank Runtime 只支持文本候选");
      }
      const response = await fetch(rerankEndpoint(config), {
        method: "POST",
        headers: {
          ...options.headers,
          accept: "application/json",
          "content-type": "application/json",
          ...(config.provider.apiKey ? { authorization: `Bearer ${config.provider.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model.modelId,
          query: options.query,
          documents: options.documents.values,
          top_n: options.topN,
          return_documents: false,
        }),
        signal: options.abortSignal,
      });
      const payload = (await response.json().catch(() => ({}))) as CompatibleRerankResponse;
      if (!response.ok) {
        const code = readErrorCode(payload);
        throw new Error(
          `Rerank Provider 请求失败，HTTP ${response.status}${code ? `，错误码 ${code}` : ""}`,
        );
      }
      return {
        ranking: normalizeRanking(payload, options.documents.values.length),
        warnings: [],
        response: {
          id: typeof payload.id === "string" ? payload.id : undefined,
          timestamp: new Date(),
          modelId: config.model.modelId,
        },
      };
    },
  };
}

export async function rerankAiDocuments(input: {
  query: string;
  documents: AiRerankDocument[];
  topN: number;
  candidateLimit?: number;
  maxDocumentChars?: number;
  modelId?: number | null;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  trace?: Omit<AiInvocationTrace, "purpose">;
}) {
  const query = input.query.trim();
  if (!query) throw new Error("请输入 Rerank 查询文本");
  const candidateLimit = Math.min(Math.max(Math.round(input.candidateLimit ?? 50), 1), 100);
  const maxDocumentChars = Math.min(
    Math.max(Math.round(input.maxDocumentChars ?? 1800), 100),
    20_000,
  );
  const documents = input.documents
    .slice(0, candidateLimit)
    .map((document) => ({ ...document, text: document.text.trim().slice(0, maxDocumentChars) }))
    .filter((document) => document.text.length > 0);
  if (!documents.length) throw new Error("没有可用于 Rerank 的候选文档");
  const topN = Math.min(Math.max(Math.round(input.topN), 1), documents.length);

  const execution = await executeAiWithFallback({
    purpose: "rerank",
    modelId: input.modelId,
    trace: input.trace ?? { sourceType: "rerank" },
    abortSignal: input.abortSignal,
    execute: async (config) => {
      const timeoutSignal = AbortSignal.timeout(
        resolveAiProviderTimeoutMs(config.provider.timeoutMs, input.timeoutMs),
      );
      const abortSignal = input.abortSignal
        ? AbortSignal.any([input.abortSignal, timeoutSignal])
        : timeoutSignal;
      const result = await rerank({
        model: createCompatibleRerankingModel(config),
        query,
        documents: documents.map((document) => document.text),
        topN,
        abortSignal,
        maxRetries: 0,
      });
      return { ranking: result.ranking, usage: undefined };
    },
  });

  return {
    invocationId: execution.invocationId,
    provider: {
      id: execution.config.provider.id,
      code: execution.config.provider.code,
      name: execution.config.provider.name,
    },
    model: {
      id: execution.config.model.id,
      modelId: execution.config.model.modelId,
      name: execution.config.model.name,
    },
    results: execution.result.ranking.map(
      (item) =>
        ({
          id: documents[item.originalIndex]!.id,
          originalIndex: item.originalIndex,
          score: item.score,
        }) satisfies AiRerankResult,
    ),
  };
}
