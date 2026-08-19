import type { DbClient } from "@/server/db";
import { sqlite } from "@/server/db";
import { decryptSecret } from "./secret";

export const webSearchProviderTypes = ["tavily", "brave", "searxng"] as const;
export type WebSearchProviderType = (typeof webSearchProviderTypes)[number];

export type AiWebSearchProviderRow = {
  id: number;
  name: string;
  code: string;
  providerType: WebSearchProviderType;
  endpoint: string;
  apiKeyEncrypted: string | null;
  timeoutMs: number;
  maxResults: number;
  status: number;
  sort: number;
  isSystem: boolean;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: string;
};

export type WebSearchAttempt = {
  providerId: number;
  providerCode: string;
  providerName: string;
  providerType: WebSearchProviderType;
  status: "completed" | "empty" | "failed";
  durationMs: number;
  resultCount: number;
  error?: string;
};

export type WebSearchResponse = {
  query: string;
  provider: {
    id: number;
    code: string;
    name: string;
    providerType: WebSearchProviderType;
  } | null;
  results: WebSearchResult[];
  attempts: WebSearchAttempt[];
};

const defaultEndpoints: Record<WebSearchProviderType, string> = {
  tavily: "https://api.tavily.com/search",
  brave: "https://api.search.brave.com/res/v1/web/search",
  searxng: "http://127.0.0.1:18082/search",
};

function clip(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeErrorMessage(error: unknown, secrets: Array<string | null> = []) {
  if (error instanceof DOMException && error.name === "TimeoutError") return "请求超时";
  if (error instanceof Error) {
    let message = error.message;
    for (const secret of secrets) {
      if (secret) message = message.replaceAll(secret, "[REDACTED]");
    }
    return clip(
      message.replaceAll(/(api[_-]?key|token|authorization)=[^\s&]+/gi, "$1=[REDACTED]"),
      500,
    );
  }
  return clip(error, 500) || "搜索请求失败";
}

function normalizeUrl(value: unknown) {
  const raw = clip(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeResult(input: {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
  publishedAt?: unknown;
  source?: unknown;
}): WebSearchResult | null {
  const url = normalizeUrl(input.url);
  if (!url) return null;
  const title = clip(input.title, 300) || url;
  const snippet = clip(input.snippet, 1200);
  const publishedAt = clip(input.publishedAt, 100);
  let source = clip(input.source, 160);
  if (!source) {
    try {
      source = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      source = "web";
    }
  }
  return {
    title,
    url,
    snippet,
    ...(publishedAt ? { publishedAt } : {}),
    source,
  };
}

function deduplicateResults(results: WebSearchResult[], limit: number) {
  const seen = new Set<string>();
  const output: WebSearchResult[] = [];
  for (const result of results) {
    const key = result.url.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(result);
    if (output.length >= limit) break;
  }
  return output;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`搜索 Provider 返回 ${response.status}${text ? `: ${clip(text, 300)}` : ""}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("搜索 Provider 返回了无效 JSON");
  }
}

function requireApiKey(provider: AiWebSearchProviderRow) {
  const apiKey = decryptSecret(provider.apiKeyEncrypted);
  if (!apiKey) throw new Error(`${provider.name} API Key 未配置`);
  return apiKey;
}

async function searchTavily(
  provider: AiWebSearchProviderRow,
  query: string,
  limit: number,
  signal: AbortSignal,
) {
  const response = await fetch(provider.endpoint || defaultEndpoints.tavily, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: requireApiKey(provider),
      query,
      max_results: limit,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
    }),
    signal,
  });
  const payload = await readJson(response);
  const rows = Array.isArray(payload.results) ? payload.results : [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const result = normalizeResult({
      title: row.title,
      url: row.url,
      snippet: row.content,
      publishedAt: row.published_date,
    });
    return result ? [result] : [];
  });
}

async function searchBrave(
  provider: AiWebSearchProviderRow,
  query: string,
  limit: number,
  signal: AbortSignal,
) {
  const url = new URL(provider.endpoint || defaultEndpoints.brave);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  url.searchParams.set("safesearch", "moderate");
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "x-subscription-token": requireApiKey(provider),
    },
    signal,
  });
  const payload = await readJson(response);
  const web =
    payload.web && typeof payload.web === "object" ? (payload.web as Record<string, unknown>) : {};
  const rows = Array.isArray(web.results) ? web.results : [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const result = normalizeResult({
      title: row.title,
      url: row.url,
      snippet: row.description,
      publishedAt: row.age || row.page_age,
      source:
        row.profile && typeof row.profile === "object"
          ? (row.profile as Record<string, unknown>).long_name
          : undefined,
    });
    return result ? [result] : [];
  });
}

async function searchSearxng(
  provider: AiWebSearchProviderRow,
  query: string,
  limit: number,
  signal: AbortSignal,
) {
  const url = new URL(provider.endpoint || defaultEndpoints.searxng);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");
  url.searchParams.set("safesearch", "1");
  const apiKey = decryptSecret(provider.apiKeyEncrypted);
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    signal,
  });
  const payload = await readJson(response);
  const rows = Array.isArray(payload.results) ? payload.results : [];
  return rows.slice(0, limit).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const result = normalizeResult({
      title: row.title,
      url: row.url,
      snippet: row.content,
      publishedAt: row.publishedDate || row.published_date,
      source: row.engine,
    });
    return result ? [result] : [];
  });
}

async function searchProvider(provider: AiWebSearchProviderRow, query: string, limit: number) {
  const signal = AbortSignal.timeout(Math.min(Math.max(provider.timeoutMs, 1000), 60000));
  if (provider.providerType === "tavily") return searchTavily(provider, query, limit, signal);
  if (provider.providerType === "brave") return searchBrave(provider, query, limit, signal);
  return searchSearxng(provider, query, limit, signal);
}

export async function listActiveWebSearchProviders(dbClient: DbClient = sqlite) {
  return (await dbClient
    .prepare(
      `SELECT id, name, code, provider_type AS "providerType", endpoint,
      api_key_encrypted AS "apiKeyEncrypted", timeout_ms AS "timeoutMs",
      max_results AS "maxResults", status, sort, is_system AS "isSystem"
     FROM sys_ai_web_search_provider
     WHERE deleted_at IS NULL AND status = 1
     ORDER BY sort ASC, id ASC`,
    )
    .all()) as AiWebSearchProviderRow[];
}

export async function getWebSearchProvider(id: number, dbClient: DbClient = sqlite) {
  return (await dbClient
    .prepare(
      `SELECT id, name, code, provider_type AS "providerType", endpoint,
      api_key_encrypted AS "apiKeyEncrypted", timeout_ms AS "timeoutMs",
      max_results AS "maxResults", status, sort, is_system AS "isSystem"
     FROM sys_ai_web_search_provider
     WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id)) as AiWebSearchProviderRow | undefined;
}

export async function hasActiveWebSearchProvider(dbClient: DbClient = sqlite) {
  const row = (await dbClient
    .prepare(
      "SELECT id FROM sys_ai_web_search_provider WHERE deleted_at IS NULL AND status = 1 LIMIT 1",
    )
    .get()) as { id: number } | undefined;
  return Boolean(row);
}

export async function executeWebSearch(input: {
  query: string;
  limit?: number;
  providerId?: number;
  dbClient?: DbClient;
}): Promise<WebSearchResponse> {
  const dbClient = input.dbClient ?? sqlite;
  const query = clip(input.query, 500);
  if (!query) throw new Error("搜索关键词不能为空");
  const providers = input.providerId
    ? [await getWebSearchProvider(input.providerId, dbClient)].filter(
        (item): item is AiWebSearchProviderRow => Boolean(item),
      )
    : await listActiveWebSearchProviders(dbClient);
  if (providers.length === 0) throw new Error("没有启用的 Web Search Provider");

  const requestedLimit = Math.min(Math.max(Math.trunc(input.limit ?? 5), 1), 10);
  const attempts: WebSearchAttempt[] = [];
  for (const provider of providers) {
    if (provider.status !== 1) throw new Error("停用的 Web Search Provider 不能执行测试");
    const limit = Math.min(requestedLimit, Math.max(provider.maxResults, 1), 10);
    const startedAt = performance.now();
    try {
      const results = deduplicateResults(await searchProvider(provider, query, limit), limit);
      attempts.push({
        providerId: provider.id,
        providerCode: provider.code,
        providerName: provider.name,
        providerType: provider.providerType,
        status: results.length ? "completed" : "empty",
        durationMs: Math.round(performance.now() - startedAt),
        resultCount: results.length,
      });
      if (results.length) {
        return {
          query,
          provider: {
            id: provider.id,
            code: provider.code,
            name: provider.name,
            providerType: provider.providerType,
          },
          results,
          attempts,
        };
      }
    } catch (error) {
      attempts.push({
        providerId: provider.id,
        providerCode: provider.code,
        providerName: provider.name,
        providerType: provider.providerType,
        status: "failed",
        durationMs: Math.round(performance.now() - startedAt),
        resultCount: 0,
        error: safeErrorMessage(error, [decryptSecret(provider.apiKeyEncrypted)]),
      });
    }
  }

  return { query, provider: null, results: [], attempts };
}

export function getDefaultWebSearchEndpoint(providerType: WebSearchProviderType) {
  return defaultEndpoints[providerType];
}
