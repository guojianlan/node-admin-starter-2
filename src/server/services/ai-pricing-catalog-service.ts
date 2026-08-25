import { createHash } from "node:crypto";
import { sqlite, type DbClient } from "@/server/db";

export const aiPricingCatalogSource = {
  type: "litellm" as const,
  name: "LiteLLM Model Pricing Catalog",
  url: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
  homepage: "https://github.com/BerriAI/litellm",
  trustLevel: "community" as const,
};

const catalogFetchTimeoutMs = 30_000;
const catalogMaxBytes = 20 * 1024 * 1024;
const catalogMinItems = 100;
const catalogMaxItems = 20_000;
const retainedSnapshotCount = 10;

export const aiPricingApplyFields = [
  "inputPrice",
  "cachedInputPrice",
  "cacheWritePrice",
  "outputPrice",
  "contextWindow",
  "maxOutputTokens",
] as const;

export type AiPricingApplyField = (typeof aiPricingApplyFields)[number];

type CatalogRawEntry = Record<string, unknown>;

export type AiPricingCatalogItem = {
  id: number;
  snapshotId: number;
  catalogKey: string;
  modelIdentifier: string;
  providerType: string | null;
  mode: string | null;
  inputPrice: string | null;
  cachedInputPrice: string | null;
  cacheWritePrice: string | null;
  outputPrice: string | null;
  currency: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  sourceHash: string;
  fetchedAt: string;
};

type ParsedCatalogItem = Omit<
  AiPricingCatalogItem,
  "id" | "snapshotId" | "sourceHash" | "fetchedAt"
>;

type ModelPricingRow = {
  id: number;
  modelId: string;
  providerType: string;
  inputPrice: string | null;
  cachedInputPrice: string | null;
  cacheWritePrice: string | null;
  outputPrice: string | null;
  currency: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  pricingSourceType: "manual" | "catalog" | "provider";
  pricingCatalogKey: string | null;
  pricingSourceHash: string | null;
  pricingSyncedAt: string | null;
};

function finiteNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function positiveInteger(value: unknown) {
  const number = finiteNumber(value);
  return number != null && Number.isInteger(number) && number > 0 ? number : null;
}

function pricePerMillion(value: unknown) {
  const price = finiteNumber(value);
  if (price == null) return null;
  return String(Number((price * 1_000_000).toPrecision(12)));
}

function normalizeCatalogProvider(value: unknown) {
  const provider = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!provider) return null;
  if (["openai", "azure", "azure_ai"].includes(provider)) return "openai";
  if (["anthropic", "anthropic_text"].includes(provider)) return "anthropic";
  if (["gemini", "google", "vertex_ai", "vertex_ai-language-models"].includes(provider)) {
    return "google";
  }
  if (provider.includes("deepseek")) return "deepseek";
  if (["dashscope", "qwen"].includes(provider)) return "qwen";
  if (["moonshot", "kimi"].includes(provider)) return "moonshot";
  if (["zhipu", "zai", "bigmodel"].includes(provider)) return "zhipu";
  if (provider.includes("siliconflow")) return "siliconflow";
  if (provider.includes("openrouter")) return "openrouter";
  if (provider.includes("ollama")) return "ollama";
  return provider;
}

function normalizeModelIdentifier(catalogKey: string, provider: string | null) {
  let value = catalogKey.trim().replace(/^models\//i, "");
  if (provider && value.toLowerCase().startsWith(`${provider.toLowerCase()}/`)) {
    value = value.slice(provider.length + 1);
  }
  return value;
}

function parseCatalogItem(catalogKey: string, entry: CatalogRawEntry): ParsedCatalogItem | null {
  const providerType = normalizeCatalogProvider(entry.litellm_provider);
  const inputPrice = pricePerMillion(entry.input_cost_per_token);
  const cachedInputPrice = pricePerMillion(entry.cache_read_input_token_cost);
  const cacheWritePrice = pricePerMillion(entry.cache_creation_input_token_cost);
  const outputPrice = pricePerMillion(entry.output_cost_per_token);
  const contextWindow =
    positiveInteger(entry.max_input_tokens) ?? positiveInteger(entry.max_tokens) ?? null;
  const maxOutputTokens = positiveInteger(entry.max_output_tokens) ?? null;
  if (
    inputPrice == null &&
    cachedInputPrice == null &&
    cacheWritePrice == null &&
    outputPrice == null &&
    contextWindow == null &&
    maxOutputTokens == null
  ) {
    return null;
  }
  return {
    catalogKey,
    modelIdentifier: normalizeModelIdentifier(catalogKey, String(entry.litellm_provider ?? "")),
    providerType,
    mode: typeof entry.mode === "string" ? entry.mode : null,
    inputPrice,
    cachedInputPrice,
    cacheWritePrice,
    outputPrice,
    currency: "USD",
    contextWindow,
    maxOutputTokens,
  };
}

export function parseAiPricingCatalog(body: string) {
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("价格目录必须是以模型 ID 为键的 JSON 对象");
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > catalogMaxItems) throw new Error("价格目录模型数量超过安全上限");
  const items = entries.flatMap(([catalogKey, value]) => {
    if (catalogKey === "sample_spec") return [];
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = parseCatalogItem(catalogKey, value as CatalogRawEntry);
    return item ? [item] : [];
  });
  if (items.length < catalogMinItems) {
    throw new Error(`价格目录有效模型少于 ${catalogMinItems} 条，已拒绝替换现有快照`);
  }
  return items;
}

function validateCatalogUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com") {
    throw new Error("价格目录只允许访问受信任的 HTTPS 数据源");
  }
  if (url.username || url.password) throw new Error("价格目录 URL 不能包含凭据");
  return url.toString();
}

async function readCatalogResponse(response: Response) {
  if (!response.ok) throw new Error(`价格目录请求失败：HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > catalogMaxBytes) throw new Error("价格目录响应超过安全大小限制");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > catalogMaxBytes) throw new Error("价格目录响应超过安全大小限制");
  return new TextDecoder().decode(bytes);
}

async function latestSnapshot(dbClient: DbClient = sqlite) {
  return (await dbClient
    .prepare(
      `SELECT id, source_type AS "sourceType", source_url AS "sourceUrl",
              source_hash AS "sourceHash", model_count AS "modelCount",
              fetched_at AS "fetchedAt"
       FROM sys_ai_pricing_catalog_snapshot
       ORDER BY fetched_at DESC, id DESC
       LIMIT 1`,
    )
    .get()) as
    | {
        id: number;
        sourceType: string;
        sourceUrl: string;
        sourceHash: string;
        modelCount: number;
        fetchedAt: string;
      }
    | undefined;
}

export async function getAiPricingCatalogStatus() {
  const snapshot = await latestSnapshot();
  return {
    source: aiPricingCatalogSource,
    ready: Boolean(snapshot),
    snapshot: snapshot ?? null,
  };
}

export async function refreshAiPricingCatalog(input: { userId: number; fetchImpl?: typeof fetch }) {
  const sourceUrl = validateCatalogUrl(aiPricingCatalogSource.url);
  const response = await (input.fetchImpl ?? fetch)(sourceUrl, {
    headers: { accept: "application/json", "user-agent": "admin-base-pricing-catalog/1.0" },
    signal: AbortSignal.timeout(catalogFetchTimeoutMs),
  });
  const body = await readCatalogResponse(response);
  const sourceHash = createHash("sha256").update(body).digest("hex");
  const items = parseAiPricingCatalog(body);

  return sqlite.transaction(async (tx) => {
    const existing = (await tx
      .prepare(
        `SELECT id, model_count AS "modelCount", fetched_at AS "fetchedAt"
         FROM sys_ai_pricing_catalog_snapshot
         WHERE source_type = ? AND source_hash = ?`,
      )
      .get(aiPricingCatalogSource.type, sourceHash)) as
      | { id: number; modelCount: number; fetchedAt: string }
      | undefined;
    if (existing) {
      await tx
        .prepare("UPDATE sys_ai_pricing_catalog_snapshot SET fetched_at = now() WHERE id = ?")
        .run(existing.id);
      return {
        changed: false,
        snapshotId: existing.id,
        sourceHash,
        modelCount: existing.modelCount,
      };
    }

    const snapshot = (await tx
      .prepare(
        `INSERT INTO sys_ai_pricing_catalog_snapshot
           (source_type, source_url, source_hash, model_count, fetched_at, created_by)
         VALUES (?, ?, ?, ?, now(), ?)
         RETURNING id`,
      )
      .get(aiPricingCatalogSource.type, sourceUrl, sourceHash, items.length, input.userId)) as {
      id: number;
    };

    await tx
      .prepare(
        `INSERT INTO sys_ai_pricing_catalog_item
          (snapshot_id, catalog_key, model_identifier, provider_type, mode,
           input_price, cached_input_price, cache_write_price, output_price, currency,
           context_window, max_output_tokens)
         SELECT ?, item.catalog_key, item.model_identifier, item.provider_type, item.mode,
                item.input_price, item.cached_input_price, item.cache_write_price,
                item.output_price, item.currency, item.context_window, item.max_output_tokens
         FROM jsonb_to_recordset(?::jsonb) AS item(
           catalog_key TEXT, model_identifier TEXT, provider_type TEXT, mode TEXT,
           input_price TEXT, cached_input_price TEXT, cache_write_price TEXT,
           output_price TEXT, currency TEXT, context_window INTEGER, max_output_tokens INTEGER
         )`,
      )
      .run(
        snapshot.id,
        JSON.stringify(
          items.map((item) => ({
            catalog_key: item.catalogKey,
            model_identifier: item.modelIdentifier,
            provider_type: item.providerType,
            mode: item.mode,
            input_price: item.inputPrice,
            cached_input_price: item.cachedInputPrice,
            cache_write_price: item.cacheWritePrice,
            output_price: item.outputPrice,
            currency: item.currency,
            context_window: item.contextWindow,
            max_output_tokens: item.maxOutputTokens,
          })),
        ),
      );

    await tx
      .prepare(
        `DELETE FROM sys_ai_pricing_catalog_snapshot
         WHERE id NOT IN (
           SELECT id FROM sys_ai_pricing_catalog_snapshot
           ORDER BY fetched_at DESC, id DESC
           LIMIT ?
         )`,
      )
      .run(retainedSnapshotCount);

    return {
      changed: true,
      snapshotId: snapshot.id,
      sourceHash,
      modelCount: items.length,
    };
  });
}

function providerCompatible(modelProvider: string, catalogProvider: string | null) {
  if (["openai-compatible", "custom"].includes(modelProvider)) return true;
  return !catalogProvider || modelProvider === catalogProvider;
}

function normalizedModelCandidates(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^models\//, "");
  return new Set([normalized, normalized.split("/").at(-1) || normalized]);
}

function catalogMatchesModel(modelId: string, item: AiPricingCatalogItem) {
  const modelCandidates = normalizedModelCandidates(modelId);
  const itemCandidates = new Set([
    ...normalizedModelCandidates(item.modelIdentifier),
    ...normalizedModelCandidates(item.catalogKey),
  ]);
  return [...modelCandidates].some((candidate) => itemCandidates.has(candidate));
}

export async function listAiPricingCatalogItems(input: {
  page: number;
  pageSize: number;
  keyword?: string;
  providerType?: string;
  modelId?: string;
}) {
  const snapshot = await latestSnapshot();
  if (!snapshot) return { data: [], total: 0, page: input.page, pageSize: input.pageSize };
  const conditions = ["i.snapshot_id = ?"];
  const values: Array<string | number> = [snapshot.id];
  if (input.keyword) {
    conditions.push("(i.catalog_key ILIKE ? OR i.model_identifier ILIKE ?)");
    values.push(`%${input.keyword}%`, `%${input.keyword}%`);
  }
  if (input.providerType && !["openai-compatible", "custom"].includes(input.providerType)) {
    conditions.push("i.provider_type = ?");
    values.push(input.providerType);
  }
  if (input.modelId) {
    const normalized = input.modelId
      .trim()
      .toLowerCase()
      .replace(/^models\//, "");
    const tail = normalized.split("/").at(-1) || normalized;
    conditions.push(
      `(LOWER(i.model_identifier) IN (?, ?) OR LOWER(i.catalog_key) IN (?, ?)
        OR LOWER(i.model_identifier) LIKE ?)`,
    );
    values.push(normalized, tail, normalized, tail, `%/${tail}`);
  }
  const where = conditions.join(" AND ");
  const total = (await sqlite
    .prepare(`SELECT COUNT(1)::int AS total FROM sys_ai_pricing_catalog_item i WHERE ${where}`)
    .get(...values)) as { total: number } | undefined;
  const rows = (await sqlite
    .prepare(
      `SELECT i.id, i.snapshot_id AS "snapshotId", i.catalog_key AS "catalogKey",
              i.model_identifier AS "modelIdentifier", i.provider_type AS "providerType",
              i.mode, i.input_price AS "inputPrice",
              i.cached_input_price AS "cachedInputPrice",
              i.cache_write_price AS "cacheWritePrice", i.output_price AS "outputPrice",
              i.currency, i.context_window AS "contextWindow",
              i.max_output_tokens AS "maxOutputTokens",
              snapshot.source_hash AS "sourceHash", snapshot.fetched_at AS "fetchedAt"
       FROM sys_ai_pricing_catalog_item i
       JOIN sys_ai_pricing_catalog_snapshot snapshot ON snapshot.id = i.snapshot_id
       WHERE ${where}
       ORDER BY i.provider_type ASC NULLS LAST, i.catalog_key ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...values, input.pageSize, (input.page - 1) * input.pageSize)) as AiPricingCatalogItem[];
  return {
    data: rows,
    total: Number(total?.total ?? 0),
    page: input.page,
    pageSize: input.pageSize,
  };
}

async function getModelPricingRow(id: number, dbClient: DbClient = sqlite) {
  return (await dbClient
    .prepare(
      `SELECT model.id, model.model_id AS "modelId", provider.provider_type AS "providerType",
              model.input_price AS "inputPrice", model.cached_input_price AS "cachedInputPrice",
              model.cache_write_price AS "cacheWritePrice", model.output_price AS "outputPrice",
              model.currency, model.context_window AS "contextWindow",
              model.max_output_tokens AS "maxOutputTokens",
              model.pricing_source_type AS "pricingSourceType",
              model.pricing_catalog_key AS "pricingCatalogKey",
              model.pricing_source_hash AS "pricingSourceHash",
              model.pricing_synced_at AS "pricingSyncedAt"
       FROM sys_ai_model model
       JOIN sys_ai_provider provider ON provider.id = model.provider_id
       WHERE model.id = ? AND model.deleted_at IS NULL`,
    )
    .get(id)) as ModelPricingRow | undefined;
}

function pricingDiff(model: ModelPricingRow, item: AiPricingCatalogItem) {
  return Object.fromEntries(
    aiPricingApplyFields.map((field) => [
      field,
      {
        current: model[field],
        suggested: item[field],
        changed: String(model[field] ?? "") !== String(item[field] ?? ""),
        available: item[field] != null,
      },
    ]),
  );
}

export async function getAiModelPricingPreview(modelId: number) {
  const model = await getModelPricingRow(modelId);
  if (!model) return null;
  const candidates = await listAiPricingCatalogItems({
    page: 1,
    pageSize: 20,
    modelId: model.modelId,
    providerType: model.providerType,
  });
  const compatibleCandidates = candidates.data
    .filter(
      (item) =>
        providerCompatible(model.providerType, item.providerType) &&
        catalogMatchesModel(model.modelId, item),
    )
    .map((item) => ({ ...item, diff: pricingDiff(model, item) }));
  return {
    model,
    catalog: await getAiPricingCatalogStatus(),
    candidates: compatibleCandidates,
  };
}

export async function applyAiModelPricing(input: {
  modelId: number;
  catalogItemId: number;
  fields: AiPricingApplyField[];
}) {
  return sqlite.transaction(async (tx) => {
    const model = await getModelPricingRow(input.modelId, tx);
    if (!model) throw new Error("AI 模型不存在");
    const snapshot = await latestSnapshot(tx);
    if (!snapshot) throw new Error("价格目录尚未初始化");
    const item = (await tx
      .prepare(
        `SELECT i.id, i.snapshot_id AS "snapshotId", i.catalog_key AS "catalogKey",
                i.model_identifier AS "modelIdentifier", i.provider_type AS "providerType",
                i.mode, i.input_price AS "inputPrice",
                i.cached_input_price AS "cachedInputPrice",
                i.cache_write_price AS "cacheWritePrice", i.output_price AS "outputPrice",
                i.currency, i.context_window AS "contextWindow",
                i.max_output_tokens AS "maxOutputTokens",
                snapshot.source_hash AS "sourceHash", snapshot.fetched_at AS "fetchedAt"
         FROM sys_ai_pricing_catalog_item i
         JOIN sys_ai_pricing_catalog_snapshot snapshot ON snapshot.id = i.snapshot_id
         WHERE i.id = ? AND i.snapshot_id = ?`,
      )
      .get(input.catalogItemId, snapshot.id)) as AiPricingCatalogItem | undefined;
    if (!item) throw new Error("价格候选不属于最新目录快照，请刷新后重试");
    if (!providerCompatible(model.providerType, item.providerType)) {
      throw new Error("价格候选与模型服务商类型不匹配");
    }
    if (!catalogMatchesModel(model.modelId, item)) throw new Error("价格候选与模型 ID 不匹配");
    const unavailable = input.fields.filter((field) => item[field] == null);
    if (unavailable.length) throw new Error(`价格目录未提供字段：${unavailable.join(", ")}`);

    const next = { ...model };
    for (const field of input.fields) {
      (next[field] as string | number | null) = item[field];
    }
    if (next.contextWindow && next.maxOutputTokens && next.maxOutputTokens > next.contextWindow) {
      throw new Error("目录最大输出 Token 不能超过模型上下文窗口");
    }
    const appliesPrice = input.fields.some((field) => field.endsWith("Price"));
    await tx
      .prepare(
        `UPDATE sys_ai_model
         SET input_price = ?, cached_input_price = ?, cache_write_price = ?, output_price = ?,
             currency = ?, context_window = ?, max_output_tokens = ?,
             pricing_source_type = 'catalog', pricing_catalog_key = ?,
             pricing_source_hash = ?, pricing_synced_at = now(), updated_at = now()
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        next.inputPrice,
        next.cachedInputPrice,
        next.cacheWritePrice,
        next.outputPrice,
        appliesPrice ? item.currency : model.currency,
        next.contextWindow,
        next.maxOutputTokens,
        item.catalogKey,
        item.sourceHash,
        model.id,
      );
    return {
      modelId: model.id,
      catalogItemId: item.id,
      catalogKey: item.catalogKey,
      sourceHash: item.sourceHash,
      appliedFields: input.fields,
      diff: pricingDiff(model, item),
    };
  });
}
