import { sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { sqlite } from "@/server/db";
import { sysAiWebSearchProvider } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  executeWebSearch,
  getDefaultWebSearchEndpoint,
  getWebSearchProvider,
  webSearchProviderTypes,
} from "@/server/services/ai-web-search-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { encryptSecret } from "@/server/services/secret";

const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const webSearchProviderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  providerType: z.enum(webSearchProviderTypes),
  endpoint: z.preprocess(emptyToUndefined, z.string().url().optional()),
  apiKey: z.preprocess(emptyToUndefined, z.string().max(1000).optional()),
  timeoutMs: z.coerce.number().int().min(1000).max(60000).default(10000),
  maxResults: z.coerce.number().int().min(1).max(10).default(8),
  status: z.coerce.number().int().min(0).max(1).default(0),
  sort: z.coerce.number().int().min(0).max(9999).default(0),
  remark: z.preprocess(emptyToUndefined, z.string().max(500).optional()),
});

async function assertSystemIdentityUnchanged(id: number, values: Record<string, unknown>) {
  const current = await getWebSearchProvider(id);
  if (!current) throw new Error("Web Search Provider 不存在");
  if (!current.isSystem) return;
  if (values.code !== undefined && values.code !== current.code) {
    throw new Error("系统内置 Web Search Provider 不能修改编码");
  }
  if (values.providerType !== undefined && values.providerType !== current.providerType) {
    throw new Error("系统内置 Web Search Provider 不能修改类型");
  }
}

function normalizeProvider<T extends Record<string, unknown>>(values: T) {
  const { apiKey, ...rest } = values;
  const providerType = values.providerType as (typeof webSearchProviderTypes)[number] | undefined;
  return {
    ...rest,
    ...(providerType && !values.endpoint
      ? { endpoint: getDefaultWebSearchEndpoint(providerType) }
      : {}),
    ...(apiKey !== undefined ? { apiKeyEncrypted: encryptSecret(String(apiKey || "")) } : {}),
  } as T;
}

function assertProviderCanBeEnabled(
  values: Record<string, unknown>,
  current?: Awaited<ReturnType<typeof getWebSearchProvider>>,
) {
  const providerType = (values.providerType ?? current?.providerType) as
    | (typeof webSearchProviderTypes)[number]
    | undefined;
  const status = Number(values.status ?? current?.status ?? 0);
  const hasApiKey =
    values.apiKey !== undefined
      ? Boolean(String(values.apiKey || ""))
      : Boolean(current?.apiKeyEncrypted);
  if (status === 1 && providerType !== "searxng" && !hasApiKey) {
    throw new Error("启用 Tavily 或 Brave Search 前必须配置 API Key");
  }
}

const webSearchProviderCrud = createCrudRoutes({
  basePath: "/ai/web-search/provider",
  table: sysAiWebSearchProvider,
  idColumn: sysAiWebSearchProvider.id,
  createSchema: webSearchProviderSchema,
  updateSchema: webSearchProviderSchema.partial(),
  permissions: { prefix: "system.aiWebSearch" },
  list: {
    select: {
      id: sysAiWebSearchProvider.id,
      name: sysAiWebSearchProvider.name,
      code: sysAiWebSearchProvider.code,
      providerType: sysAiWebSearchProvider.providerType,
      endpoint: sysAiWebSearchProvider.endpoint,
      hasApiKey:
        drizzleSql<boolean>`(${sysAiWebSearchProvider.apiKeyEncrypted} IS NOT NULL AND ${sysAiWebSearchProvider.apiKeyEncrypted} <> '')`.as(
          "hasApiKey",
        ),
      timeoutMs: sysAiWebSearchProvider.timeoutMs,
      maxResults: sysAiWebSearchProvider.maxResults,
      status: sysAiWebSearchProvider.status,
      isPrimary: drizzleSql<boolean>`(
          ${sysAiWebSearchProvider.status} = 1
          AND ${sysAiWebSearchProvider.id} = (
            SELECT preferred.id
            FROM sys_ai_web_search_provider preferred
            WHERE preferred.deleted_at IS NULL AND preferred.status = 1
            ORDER BY preferred.sort ASC, preferred.id ASC
            LIMIT 1
          )
        )`.as("isPrimary"),
      sort: sysAiWebSearchProvider.sort,
      remark: sysAiWebSearchProvider.remark,
      isSystem: sysAiWebSearchProvider.isSystem,
      createdAt: sysAiWebSearchProvider.createdAt,
      updatedAt: sysAiWebSearchProvider.updatedAt,
    },
    searchable: {
      name: "like",
      code: "like",
      providerType: "=",
      endpoint: "like",
      status: "=",
    },
    quickSearchFields: ["name", "code", "endpoint"],
    sortableFields: ["id", "sort", "status", "createdAt", "updatedAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    beforeCreate: (_ctx, values) => {
      assertProviderCanBeEnabled(values);
      return normalizeProvider(values);
    },
    beforeUpdate: async (_ctx, id, values) => {
      await assertSystemIdentityUnchanged(id, values);
      const current = await getWebSearchProvider(id);
      assertProviderCanBeEnabled(values, current);
      return normalizeProvider(values);
    },
    beforeDelete: async (_ctx, ids) => {
      for (const id of ids) {
        const provider = await getWebSearchProvider(id);
        if (!provider) throw new Error("Web Search Provider 不存在");
        if (provider.isSystem) throw new Error("系统内置 Web Search Provider 不能删除");
      }
    },
  },
});

export const aiWebSearchRoutes = new Hono<{ Variables: HonoVariables }>();

aiWebSearchRoutes.put(
  "/ai/web-search/provider/status/:id",
  authRequired(),
  ability("system.aiWebSearch.status"),
  async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param("id"));
    const payload = z
      .object({ status: z.coerce.number().int().min(0).max(1) })
      .parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiWebSearch",
        action: "status",
        resource: "/ai/web-search/provider",
        resourceId: id,
        details: { status: payload.status },
      },
      async () => {
        const provider = await getWebSearchProvider(id);
        if (!provider) throw new Error("Web Search Provider 不存在");
        if (
          payload.status === 1 &&
          provider.providerType !== "searxng" &&
          !provider.apiKeyEncrypted
        ) {
          throw new Error("启用前必须配置 API Key");
        }
        await sqlite
          .prepare(
            "UPDATE sys_ai_web_search_provider SET status = ?, updated_at = now() WHERE id = ?",
          )
          .run(payload.status, id);
      },
    );
    return c.json(success(null, "状态更新成功"));
  },
);

aiWebSearchRoutes.post(
  "/ai/web-search/provider/test",
  authRequired(),
  ability("system.aiWebSearch.test"),
  async (c) => {
    const payload = z
      .object({
        id: z.coerce.number().int().positive(),
        query: z.string().trim().min(1).max(500),
        limit: z.coerce.number().int().min(1).max(10).default(5),
      })
      .parse(await c.req.json());
    let result!: Awaited<ReturnType<typeof executeWebSearch>>;
    await runWithOperationLog(
      c,
      {
        module: "system.aiWebSearch",
        action: "test",
        resource: "/ai/web-search/provider",
        resourceId: payload.id,
        details: { query: payload.query, limit: payload.limit },
      },
      async () => {
        result = await executeWebSearch({
          providerId: payload.id,
          query: payload.query,
          limit: payload.limit,
        });
      },
    );
    return c.json(success(result, result.results.length ? "搜索测试成功" : "搜索完成但没有结果"));
  },
);

aiWebSearchRoutes.route("/", webSearchProviderCrud.routes);
