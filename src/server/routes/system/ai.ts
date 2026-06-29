import { sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { success, type PageResult } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { nowIso, sqlite } from "@/server/db";
import { sysAiProvider } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import type { AiModelUsage } from "@/server/services/ai-provider-service";
import { getAiProvider, getAiRuntimeConfig } from "@/server/services/ai-provider-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { assertSystemCodeUnchanged } from "@/server/services/protected-records";
import { decryptSecret, encryptSecret } from "@/server/services/secret";

const emptyToNull = (value: unknown) => (value === "" ? null : value);
const optionalUrl = z.preprocess(emptyToNull, z.string().url().optional().nullable());
const optionalText = z.preprocess(emptyToNull, z.string().optional().nullable());
const optionalNumber = z.preprocess(
  emptyToNull,
  z.union([z.coerce.number().int().nonnegative(), z.null()]).optional().nullable(),
);

const supportedProviderTypes = [
  "openai-compatible",
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "qwen",
  "moonshot",
  "zhipu",
  "siliconflow",
  "openrouter",
  "ollama",
  "custom",
] as const;

type ProviderTestMode = "listModels" | "chat" | "embedding";

const aiProviderSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  providerType: z.enum(supportedProviderTypes).default("openai-compatible"),
  baseUrl: optionalUrl,
  apiKey: optionalText,
  organization: optionalText,
  project: optionalText,
  status: z.coerce.number().default(1),
  sort: z.coerce.number().default(0),
  optionsJson: optionalText,
  remark: optionalText,
});

const aiModelSchema = z.object({
  providerId: z.coerce.number().int().positive(),
  name: z.string().min(1),
  modelId: z.string().min(1),
  modelType: z.enum(["chat", "embedding", "image", "rerank"]).default("chat"),
  capabilitiesJson: optionalText,
  contextWindow: optionalNumber,
  maxOutputTokens: optionalNumber,
  inputPrice: optionalText,
  outputPrice: optionalText,
  currency: z.preprocess(
    (value) => (value === "" || value == null ? "USD" : value),
    z.string().min(1),
  ),
  status: z.coerce.number().default(1),
  sort: z.coerce.number().default(0),
  remark: optionalText,
});

const setDefaultModelSchema = z.object({
  usage: z.enum(["chat", "structured", "embedding"]),
});

const aiProviderTestSchema = z.object({
  id: z.coerce.number(),
  mode: z.enum(["listModels", "chat", "embedding"]).default("listModels"),
  modelId: optionalText,
  input: z.preprocess(
    (value) => (value === "" || value == null ? "请用一句话回复 OK。" : value),
    z.string().min(1),
  ),
});

const aiModelTestSchema = z.object({
  id: z.coerce.number(),
  input: z.preprocess(
    (value) => (value === "" || value == null ? "请用一句话回复 OK。" : value),
    z.string().min(1),
  ),
});

type AiProviderRow = {
  id: number;
  code: string;
  name: string;
  providerType: string;
  baseUrl: string | null;
  apiKeyEncrypted: string | null;
  organization: string | null;
  project: string | null;
  isDefault: boolean;
  status: number;
  optionsJson: string | null;
  isSystem: boolean;
};

type AiModelRow = {
  id: number;
  providerId: number;
  providerName: string;
  providerCode: string;
  providerStatus: number;
  name: string;
  modelId: string;
  modelType: string;
  capabilitiesJson: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputPrice: string | null;
  outputPrice: string | null;
  currency: string;
  isDefaultChat: boolean;
  isDefaultStructured: boolean;
  isDefaultEmbedding: boolean;
  status: number;
  sort: number;
  remark: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

type AiTestResult = {
  mode: ProviderTestMode;
  endpoint: string;
  status: number;
  preview: string;
};

function assertJson(value?: string | null, message = "扩展配置必须是合法 JSON") {
  if (!value) return;
  try {
    JSON.parse(value);
  } catch {
    throw new Error(message);
  }
}

function parseJsonObject(value?: string | null) {
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

function normalizeAiProvider<T extends Record<string, unknown>>(values: T) {
  const { apiKey, optionsJson, ...rest } = values;
  if (typeof optionsJson === "string") assertJson(optionsJson);
  return {
    ...rest,
    ...(optionsJson !== undefined ? { optionsJson } : {}),
    ...(apiKey !== undefined ? { apiKeyEncrypted: encryptSecret(String(apiKey || "")) } : {}),
  } as T;
}

function normalizeAiModel(values: z.infer<typeof aiModelSchema>) {
  if (typeof values.capabilitiesJson === "string") {
    assertJson(values.capabilitiesJson, "模型能力配置必须是合法 JSON");
  }
  return {
    ...values,
    currency: values.currency || "USD",
  };
}

async function getProviderRow(id: number) {
  return (await sqlite
    .prepare(
      `SELECT
        id,
        code,
        name,
        provider_type AS "providerType",
        base_url AS "baseUrl",
        api_key_encrypted AS "apiKeyEncrypted",
        organization,
        project,
        is_default AS "isDefault",
        status,
        options_json AS "optionsJson",
        is_system AS "isSystem"
       FROM sys_ai_provider
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id)) as AiProviderRow | undefined;
}

async function assertAiProviderMutable(id: number) {
  const row = await getProviderRow(id);
  if (!row) throw new Error("AI Provider 不存在");
  if (row.isDefault) throw new Error("默认 AI Provider 不能删除，请先切换默认配置");
  if (row.isSystem) throw new Error("系统内置 AI Provider 不能删除");
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function providerOptions(provider: Pick<AiProviderRow, "optionsJson">) {
  return parseJsonObject(provider.optionsJson);
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === "string")
      .map(([key, item]) => [key, item as string]),
  );
}

function providerRequiresApiKey(provider: Pick<AiProviderRow, "providerType" | "optionsJson">) {
  const options = providerOptions(provider);
  if (options.authRequired === false) return false;
  return provider.providerType !== "ollama";
}

function providerApiKey(provider: Pick<AiProviderRow, "apiKeyEncrypted" | "providerType" | "optionsJson">) {
  const apiKey = decryptSecret(provider.apiKeyEncrypted);
  if (!apiKey && providerRequiresApiKey(provider)) throw new Error("AI Provider API Key 未配置");
  return apiKey;
}

function providerHeaders(
  provider: Pick<
    AiProviderRow,
    "apiKeyEncrypted" | "organization" | "project" | "providerType" | "optionsJson"
  >,
) {
  const apiKey = providerApiKey(provider);
  const options = providerOptions(provider);
  const extraHeaders = stringRecord(options.headers);
  if (provider.providerType === "google") return extraHeaders;
  if (provider.providerType === "anthropic") {
    return {
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      "anthropic-version": String(options.anthropicVersion || "2023-06-01"),
      ...extraHeaders,
    };
  }
  return {
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    ...(provider.organization ? { "openai-organization": provider.organization } : {}),
    ...(provider.project ? { "openai-project": provider.project } : {}),
    ...extraHeaders,
  };
}

function providerProtocol(providerType: string): "openai" | "anthropic" | "google" {
  if (providerType === "anthropic") return "anthropic";
  if (providerType === "google") return "google";
  return "openai";
}

function googleModelPath(modelId: string) {
  return modelId.startsWith("models/") ? modelId : `models/${modelId}`;
}

function googleUrl(provider: AiProviderRow, path: string) {
  if (!provider.baseUrl) throw new Error("AI Provider Base URL 未配置");
  const url = new URL(`${normalizeBaseUrl(provider.baseUrl)}/${path.replace(/^\/+/, "")}`);
  const apiKey = providerApiKey(provider);
  if (apiKey) url.searchParams.set("key", apiKey);
  return url.toString();
}

async function parseTestResponse(response: Response, mode: ProviderTestMode, endpoint: string): Promise<AiTestResult> {
  const text = await response.text().catch(() => "");
  const preview = (() => {
    if (!text) return "";
    try {
      return JSON.stringify(JSON.parse(text), null, 2).slice(0, 3000);
    } catch {
      return text.slice(0, 3000);
    }
  })();
  if (!response.ok) {
    throw new Error(`AI 测试失败：${response.status}${preview ? ` ${preview}` : ""}`);
  }
  return {
    mode,
    endpoint,
    status: response.status,
    preview,
  };
}

async function testProviderConnection(provider: AiProviderRow, input: z.infer<typeof aiProviderTestSchema>) {
  if (provider.status !== 1) throw new Error("停用的 AI Provider 不能测试连接");
  if (!provider.baseUrl) throw new Error("AI Provider Base URL 未配置");
  const protocol = providerProtocol(provider.providerType);
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const headers = providerHeaders(provider);
  const mode = input.mode;
  if (mode !== "listModels" && !input.modelId) throw new Error("请输入用于测试的模型 ID");

  if (protocol === "google") {
    const endpoint =
      mode === "listModels"
        ? googleUrl(provider, "/models")
        : googleUrl(
            provider,
            mode === "embedding"
              ? `/${googleModelPath(String(input.modelId))}:embedContent`
              : `/${googleModelPath(String(input.modelId))}:generateContent`,
          );
    const response =
      mode === "listModels"
        ? await fetch(endpoint, { method: "GET", headers, signal: AbortSignal.timeout(15000) })
        : await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body:
              mode === "embedding"
                ? JSON.stringify({ content: { parts: [{ text: input.input }] } })
                : JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: input.input }] }],
                    generationConfig: { maxOutputTokens: 64 },
                  }),
            signal: AbortSignal.timeout(15000),
          });
    return parseTestResponse(response, mode, endpoint);
  }

  if (protocol === "anthropic") {
    if (mode === "embedding") throw new Error("Anthropic Provider 不支持 Embedding 测试");
    const endpoint = `${baseUrl}${mode === "listModels" ? "/models" : "/messages"}`;
    const response =
      mode === "listModels"
        ? await fetch(endpoint, { method: "GET", headers, signal: AbortSignal.timeout(15000) })
        : await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: JSON.stringify({
              model: input.modelId,
              max_tokens: 64,
              messages: [{ role: "user", content: input.input }],
            }),
            signal: AbortSignal.timeout(15000),
          });
    return parseTestResponse(response, mode, endpoint);
  }

  const endpoint =
    mode === "listModels"
      ? `${baseUrl}/models`
      : `${baseUrl}${mode === "embedding" ? "/embeddings" : "/chat/completions"}`;
  const response =
    mode === "listModels"
      ? await fetch(endpoint, { method: "GET", headers, signal: AbortSignal.timeout(15000) })
      : await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body:
            mode === "embedding"
              ? JSON.stringify({ model: input.modelId, input: input.input })
              : JSON.stringify({
                  model: input.modelId,
                  messages: [{ role: "user", content: input.input }],
                  max_tokens: 64,
                }),
          signal: AbortSignal.timeout(15000),
        });
  return parseTestResponse(response, mode, endpoint);
}

async function getModelRow(id: number) {
  return (await sqlite
    .prepare(
      `SELECT
        m.id,
        m.provider_id AS "providerId",
        p.name AS "providerName",
        p.code AS "providerCode",
        p.status AS "providerStatus",
        m.name,
        m.model_id AS "modelId",
        m.model_type AS "modelType",
        m.capabilities_json AS "capabilitiesJson",
        m.context_window AS "contextWindow",
        m.max_output_tokens AS "maxOutputTokens",
        m.input_price AS "inputPrice",
        m.output_price AS "outputPrice",
        m.currency,
        m.is_default_chat AS "isDefaultChat",
        m.is_default_structured AS "isDefaultStructured",
        m.is_default_embedding AS "isDefaultEmbedding",
        m.status,
        m.sort,
        m.remark,
        m.is_system AS "isSystem",
        m.created_at AS "createdAt",
        m.updated_at AS "updatedAt"
       FROM sys_ai_model m
       INNER JOIN sys_ai_provider p ON p.id = m.provider_id
       WHERE m.id = ? AND m.deleted_at IS NULL AND p.deleted_at IS NULL`,
    )
    .get(id)) as AiModelRow | undefined;
}

function ensureDefaultUsageCompatible(model: AiModelRow, usage: AiModelUsage) {
  if (model.status !== 1) throw new Error("停用的 AI 模型不能设为默认");
  if (model.providerStatus !== 1) throw new Error("停用的 AI Provider 下的模型不能设为默认");
  if (usage === "embedding" && model.modelType !== "embedding") {
    throw new Error("默认 Embedding 模型必须是 embedding 类型");
  }
  if ((usage === "chat" || usage === "structured") && model.modelType !== "chat") {
    throw new Error("默认 Chat/Structured 模型必须是 chat 类型");
  }
}

async function testModelConnection(model: AiModelRow, input: z.infer<typeof aiModelTestSchema>) {
  const provider = await getProviderRow(model.providerId);
  if (!provider) throw new Error("AI Provider 不存在");
  if (provider.status !== 1) throw new Error("停用的 AI Provider 不能测试模型");
  if (model.status !== 1) throw new Error("停用的 AI 模型不能测试");
  if (!provider.baseUrl) throw new Error("AI Provider Base URL 未配置");
  const protocol = providerProtocol(provider.providerType);
  const url = normalizeBaseUrl(provider.baseUrl);
  const headers = {
    "content-type": "application/json",
    ...providerHeaders(provider),
  };

  if (protocol === "google") {
    const endpoint = googleUrl(
      provider,
      model.modelType === "embedding"
        ? `/${googleModelPath(model.modelId)}:embedContent`
        : `/${googleModelPath(model.modelId)}:generateContent`,
    );
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body:
        model.modelType === "embedding"
          ? JSON.stringify({ content: { parts: [{ text: input.input }] } })
          : JSON.stringify({
              contents: [{ role: "user", parts: [{ text: input.input }] }],
              generationConfig: { maxOutputTokens: 64 },
            }),
      signal: AbortSignal.timeout(15000),
    });
    return parseTestResponse(response, model.modelType === "embedding" ? "embedding" : "chat", endpoint);
  }

  if (protocol === "anthropic") {
    if (model.modelType === "embedding") throw new Error("Anthropic Provider 不支持 Embedding 测试");
    const endpoint = `${url}/messages`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: model.modelId,
        max_tokens: 64,
        messages: [{ role: "user", content: input.input }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    return parseTestResponse(response, "chat", endpoint);
  }

  const endpoint = `${url}${model.modelType === "embedding" ? "/embeddings" : "/chat/completions"}`;
  const response =
    model.modelType === "embedding"
      ? await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: model.modelId, input: input.input }),
          signal: AbortSignal.timeout(15000),
        })
      : await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: model.modelId,
            messages: [{ role: "user", content: input.input }],
            max_tokens: 64,
          }),
          signal: AbortSignal.timeout(15000),
        });
  return parseTestResponse(response, model.modelType === "embedding" ? "embedding" : "chat", endpoint);
}

const aiProviderCrud = createCrudRoutes({
  basePath: "/ai/provider",
  table: sysAiProvider,
  idColumn: sysAiProvider.id,
  createSchema: aiProviderSchema,
  updateSchema: aiProviderSchema.partial(),
  permissions: { prefix: "system.aiProvider" },
  list: {
    select: {
      id: sysAiProvider.id,
      name: sysAiProvider.name,
      code: sysAiProvider.code,
      providerType: sysAiProvider.providerType,
      baseUrl: sysAiProvider.baseUrl,
      hasApiKey:
        drizzleSql<boolean>`(${sysAiProvider.apiKeyEncrypted} IS NOT NULL AND ${sysAiProvider.apiKeyEncrypted} <> '')`.as(
          "hasApiKey",
        ),
      organization: sysAiProvider.organization,
      project: sysAiProvider.project,
      isDefault: sysAiProvider.isDefault,
      status: sysAiProvider.status,
      sort: sysAiProvider.sort,
      optionsJson: sysAiProvider.optionsJson,
      remark: sysAiProvider.remark,
      isSystem: sysAiProvider.isSystem,
      createdAt: sysAiProvider.createdAt,
      updatedAt: sysAiProvider.updatedAt,
    },
    searchable: {
      name: "like",
      code: "like",
      providerType: "like",
      baseUrl: "like",
      status: "=",
    },
    quickSearchFields: ["name", "code", "providerType", "baseUrl"],
    sortableFields: ["id", "sort", "status", "createdAt", "updatedAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    beforeCreate: (_ctx, values) => normalizeAiProvider(values),
    beforeUpdate: async (ctx, id, values) => {
      await assertSystemCodeUnchanged({
        db: ctx.sql,
        table: "sys_ai_provider",
        id,
        nextCode: values.code,
        message: "系统内置 AI Provider 不能修改编码",
      });
      return normalizeAiProvider(values);
    },
    beforeDelete: async (_ctx, ids) => {
      for (const id of ids) await assertAiProviderMutable(id);
    },
  },
});

export const aiRoutes = new Hono<{ Variables: HonoVariables }>();

aiRoutes.put(
  "/ai/provider/status/:id",
  authRequired(),
  ability("system.aiProvider.status"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiProvider",
        action: "status",
        resource: "/ai/provider",
        resourceId: id,
        details: { status: payload.status },
      },
      async () => {
        const row = await getProviderRow(id);
        if (!row) throw new Error("AI Provider 不存在");
        if (row.isDefault && payload.status === 0) throw new Error("默认 AI Provider 不能停用");
        await sqlite
          .prepare("UPDATE sys_ai_provider SET status = ?, updated_at = now() WHERE id = ?")
          .run(payload.status, id);
      },
    );
    return c.json(success(null, "更新成功"));
  },
);

aiRoutes.put(
  "/ai/provider/default/:id",
  authRequired(),
  ability("system.aiProvider.setDefault"),
  async (c) => {
    const id = Number(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiProvider",
        action: "setDefault",
        resource: "/ai/provider",
        resourceId: id,
      },
      async () => {
        const row = await getProviderRow(id);
        if (!row) throw new Error("AI Provider 不存在");
        if (row.status !== 1) throw new Error("停用的 AI Provider 不能设为默认");
        if (!row.baseUrl) throw new Error("AI Provider Base URL 未配置");
        if (!decryptSecret(row.apiKeyEncrypted) && providerRequiresApiKey(row)) {
          throw new Error("AI Provider API Key 未配置");
        }
        await sqlite.transaction(async (tx) => {
          await tx.prepare("UPDATE sys_ai_provider SET is_default = false, updated_at = now()").run();
          await tx
            .prepare("UPDATE sys_ai_provider SET is_default = true, updated_at = now() WHERE id = ?")
            .run(id);
        });
      },
    );
    return c.json(success(null, "设置成功"));
  },
);

aiRoutes.post(
  "/ai/provider/test",
  authRequired(),
  ability("system.aiProvider.test"),
  async (c) => {
    const payload = aiProviderTestSchema.parse(await c.req.json());
    let result: AiTestResult | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiProvider",
        action: "test",
        resource: "/ai/provider",
        resourceId: payload.id,
        details: { mode: payload.mode, modelId: payload.modelId },
      },
      async () => {
        const row = await getProviderRow(payload.id);
        if (!row) throw new Error("AI Provider 不存在");
        result = await testProviderConnection(row, payload);
      },
    );
    return c.json(success(result, "测试完成"));
  },
);

aiRoutes.get(
  "/ai/model",
  authRequired(),
  ability("system.aiModel.query"),
  async (c) => {
    const params = new URL(c.req.url).searchParams;
    const page = Math.max(Number(params.get("page") || 1), 1);
    const pageSize = Math.min(Math.max(Number(params.get("pageSize") || 20), 1), 200);
    const conditions = ["m.deleted_at IS NULL", "p.deleted_at IS NULL"];
    const values: Array<string | number> = [];
    const keyword = params.get("keyword")?.trim();
    if (keyword) {
      conditions.push("(m.name ILIKE ? OR m.model_id ILIKE ? OR p.name ILIKE ? OR p.code ILIKE ?)");
      values.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const providerId = params.get("providerId");
    if (providerId) {
      conditions.push("m.provider_id = ?");
      values.push(Number(providerId));
    }
    const modelType = params.get("modelType");
    if (modelType) {
      conditions.push("m.model_type = ?");
      values.push(modelType);
    }
    const status = params.get("status");
    if (status) {
      conditions.push("m.status = ?");
      values.push(Number(status));
    }
    const where = conditions.join(" AND ");
    const totalRow = (await sqlite
      .prepare(
        `SELECT COUNT(1)::int AS total
         FROM sys_ai_model m
         INNER JOIN sys_ai_provider p ON p.id = m.provider_id
         WHERE ${where}`,
      )
      .get(...values)) as { total: number } | undefined;
    const rows = (await sqlite
      .prepare(
        `SELECT
          m.id,
          m.provider_id AS "providerId",
          p.name AS "providerName",
          p.code AS "providerCode",
          p.status AS "providerStatus",
          m.name,
          m.model_id AS "modelId",
          m.model_type AS "modelType",
          m.capabilities_json AS "capabilitiesJson",
          m.context_window AS "contextWindow",
          m.max_output_tokens AS "maxOutputTokens",
          m.input_price AS "inputPrice",
          m.output_price AS "outputPrice",
          m.currency,
          m.is_default_chat AS "isDefaultChat",
          m.is_default_structured AS "isDefaultStructured",
          m.is_default_embedding AS "isDefaultEmbedding",
          m.status,
          m.sort,
          m.remark,
          m.is_system AS "isSystem",
          m.created_at AS "createdAt",
          m.updated_at AS "updatedAt"
         FROM sys_ai_model m
         INNER JOIN sys_ai_provider p ON p.id = m.provider_id
         WHERE ${where}
         ORDER BY m.sort ASC, m.id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, pageSize, (page - 1) * pageSize)) as AiModelRow[];
    const result: PageResult<AiModelRow> = {
      data: rows,
      total: Number(totalRow?.total ?? 0),
      page,
      pageSize,
    };
    return c.json(success(result));
  },
);

aiRoutes.post(
  "/ai/model",
  authRequired(),
  ability("system.aiModel.create"),
  async (c) => {
    const payload = normalizeAiModel(aiModelSchema.parse(await c.req.json()));
    await runWithOperationLog(
      c,
      {
        module: "system.aiModel",
        action: "create",
        resource: "/ai/model",
        details: { modelId: payload.modelId, providerId: payload.providerId },
      },
      async () => {
        if (!(await getAiProvider(payload.providerId))) throw new Error("AI Provider 不存在");
        await sqlite
          .prepare(
            `INSERT INTO sys_ai_model
              (provider_id, name, model_id, model_type, capabilities_json, context_window, max_output_tokens,
               input_price, output_price, currency, status, sort, remark, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            payload.providerId,
            payload.name,
            payload.modelId,
            payload.modelType,
            payload.capabilitiesJson || null,
            payload.contextWindow ?? null,
            payload.maxOutputTokens ?? null,
            payload.inputPrice || null,
            payload.outputPrice || null,
            payload.currency,
            payload.status,
            payload.sort,
            payload.remark || null,
            nowIso(),
            nowIso(),
          );
      },
    );
    return c.json(success(null, "创建成功"));
  },
);

aiRoutes.put(
  "/ai/model/:id",
  authRequired(),
  ability("system.aiModel.update"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = aiModelSchema.partial().parse(await c.req.json());
    if (typeof payload.capabilitiesJson === "string") {
      assertJson(payload.capabilitiesJson, "模型能力配置必须是合法 JSON");
    }
    const row = await getModelRow(id);
    if (!row) throw new Error("AI 模型不存在");
    await runWithOperationLog(
      c,
      {
        module: "system.aiModel",
        action: "update",
        resource: "/ai/model",
        resourceId: id,
        details: { fields: Object.keys(payload) },
      },
      async () => {
        if (payload.providerId && !(await getAiProvider(payload.providerId))) {
          throw new Error("AI Provider 不存在");
        }
        await sqlite
          .prepare(
            `UPDATE sys_ai_model
             SET provider_id = COALESCE(?, provider_id),
                 name = COALESCE(?, name),
                 model_id = COALESCE(?, model_id),
                 model_type = COALESCE(?, model_type),
                 capabilities_json = ?,
                 context_window = ?,
                 max_output_tokens = ?,
                 input_price = ?,
                 output_price = ?,
                 currency = COALESCE(?, currency),
                 status = COALESCE(?, status),
                 sort = COALESCE(?, sort),
                 remark = ?,
                 updated_at = now()
             WHERE id = ? AND deleted_at IS NULL`,
          )
          .run(
            payload.providerId ?? null,
            payload.name ?? null,
            payload.modelId ?? null,
            payload.modelType ?? null,
            payload.capabilitiesJson === undefined ? row.capabilitiesJson : payload.capabilitiesJson || null,
            payload.contextWindow === undefined ? row.contextWindow : payload.contextWindow ?? null,
            payload.maxOutputTokens === undefined ? row.maxOutputTokens : payload.maxOutputTokens ?? null,
            payload.inputPrice === undefined ? row.inputPrice : payload.inputPrice || null,
            payload.outputPrice === undefined ? row.outputPrice : payload.outputPrice || null,
            payload.currency ?? null,
            payload.status ?? null,
            payload.sort ?? null,
            payload.remark === undefined ? row.remark : payload.remark || null,
            id,
          );
      },
    );
    return c.json(success(null, "更新成功"));
  },
);

aiRoutes.delete(
  "/ai/model/:id",
  authRequired(),
  ability("system.aiModel.delete"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const row = await getModelRow(id);
    if (!row) throw new Error("AI 模型不存在");
    if (row.isSystem) throw new Error("系统内置 AI 模型不能删除");
    if (row.isDefaultChat || row.isDefaultStructured || row.isDefaultEmbedding) {
      throw new Error("默认 AI 模型不能删除，请先切换默认模型");
    }
    await runWithOperationLog(
      c,
      {
        module: "system.aiModel",
        action: "delete",
        resource: "/ai/model",
        resourceId: id,
      },
      async () => {
        await sqlite
          .prepare("UPDATE sys_ai_model SET deleted_at = now(), updated_at = now() WHERE id = ?")
          .run(id);
      },
    );
    return c.json(success(null, "删除成功"));
  },
);

aiRoutes.put(
  "/ai/model/status/:id",
  authRequired(),
  ability("system.aiModel.status"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiModel",
        action: "status",
        resource: "/ai/model",
        resourceId: id,
        details: { status: payload.status },
      },
      async () => {
        const row = await getModelRow(id);
        if (!row) throw new Error("AI 模型不存在");
        if (
          payload.status === 0 &&
          (row.isDefaultChat || row.isDefaultStructured || row.isDefaultEmbedding)
        ) {
          throw new Error("默认 AI 模型不能停用");
        }
        await sqlite
          .prepare("UPDATE sys_ai_model SET status = ?, updated_at = now() WHERE id = ?")
          .run(payload.status, id);
      },
    );
    return c.json(success(null, "更新成功"));
  },
);

aiRoutes.put(
  "/ai/model/default/:id",
  authRequired(),
  ability("system.aiModel.setDefault"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = setDefaultModelSchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiModel",
        action: "setDefault",
        resource: "/ai/model",
        resourceId: id,
        details: payload,
      },
      async () => {
        const row = await getModelRow(id);
        if (!row) throw new Error("AI 模型不存在");
        ensureDefaultUsageCompatible(row, payload.usage);
        const column =
          payload.usage === "embedding"
            ? "is_default_embedding"
            : payload.usage === "structured"
              ? "is_default_structured"
              : "is_default_chat";
        await sqlite.transaction(async (tx) => {
          await tx.prepare(`UPDATE sys_ai_model SET ${column} = false, updated_at = now()`).run();
          await tx
            .prepare(`UPDATE sys_ai_model SET ${column} = true, updated_at = now() WHERE id = ?`)
            .run(id);
        });
      },
    );
    return c.json(success(null, "设置成功"));
  },
);

aiRoutes.post(
  "/ai/model/test",
  authRequired(),
  ability("system.aiModel.test"),
  async (c) => {
    const payload = aiModelTestSchema.parse(await c.req.json());
    let result: AiTestResult | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiModel",
        action: "test",
        resource: "/ai/model",
        resourceId: payload.id,
        details: { inputPreview: payload.input.slice(0, 120) },
      },
      async () => {
        const row = await getModelRow(payload.id);
        if (!row) throw new Error("AI 模型不存在");
        result = await testModelConnection(row, payload);
      },
    );
    return c.json(success(result, "模型调用正常"));
  },
);

aiRoutes.get(
  "/ai/runtime-config/:usage",
  authRequired(),
  ability("system.aiProvider.query"),
  async (c) => {
    const usage = z.enum(["chat", "structured", "embedding"]).parse(c.req.param("usage"));
    const runtimeConfig = await getAiRuntimeConfig(usage);
    return c.json(
      success({
        provider: {
          id: runtimeConfig.provider.id,
          code: runtimeConfig.provider.code,
          name: runtimeConfig.provider.name,
          providerType: runtimeConfig.provider.providerType,
          baseUrl: runtimeConfig.provider.baseUrl,
          hasApiKey: Boolean(runtimeConfig.provider.apiKey),
        },
        model: runtimeConfig.model,
      }),
    );
  },
);

aiRoutes.route("/", aiProviderCrud.routes);
