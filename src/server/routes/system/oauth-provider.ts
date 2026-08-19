import { Hono } from "hono";
import { z } from "zod";
import { success, type PageResult } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { nowIso, sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { encryptSecret } from "@/server/services/secret";
import { resolveListOrder } from "@/server/services/list-query";

const emptyToNull = (value: unknown) => (value === "" ? null : value);

const optionalUrl = z.preprocess(emptyToNull, z.string().url().optional().nullable());

const providerSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  enabled: z.coerce.boolean().default(false),
  authUrl: z.string().url(),
  tokenUrl: optionalUrl,
  userInfoUrl: optionalUrl,
  clientId: z.preprocess(emptyToNull, z.string().optional().nullable()),
  clientSecret: z.preprocess(emptyToNull, z.string().optional().nullable()),
  scopes: z
    .union([z.array(z.string()), z.string()])
    .optional()
    .nullable(),
  userMapping: z
    .union([z.record(z.string(), z.unknown()), z.string()])
    .optional()
    .nullable(),
  autoCreateUser: z.coerce.boolean().default(false),
  status: z.coerce.number().default(1),
  sort: z.coerce.number().default(0),
});

type ProviderRow = {
  id: number;
  key: string;
  name: string;
  enabled: boolean;
  authUrl: string;
  tokenUrl: string | null;
  userInfoUrl: string | null;
  clientId: string | null;
  clientSecretEncrypted: string | null;
  scopesJson: string | null;
  userMappingJson: string | null;
  autoCreateUser: boolean;
  status: number;
  sort: number;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

function parseJsonObject(value?: string | Record<string, unknown> | null) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeScopes(value?: string[] | string | null) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fall through to comma/space split.
  }
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toResponse(row: ProviderRow) {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    enabled: row.enabled,
    authUrl: row.authUrl,
    tokenUrl: row.tokenUrl,
    userInfoUrl: row.userInfoUrl,
    clientId: row.clientId,
    hasClientSecret: Boolean(row.clientSecretEncrypted),
    scopes: normalizeScopes(row.scopesJson),
    scopesJson: row.scopesJson,
    userMapping: parseJsonObject(row.userMappingJson),
    userMappingJson: row.userMappingJson,
    autoCreateUser: row.autoCreateUser,
    status: row.status,
    sort: row.sort,
    isSystem: row.isSystem,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getProvider(id: number) {
  return (await sqlite
    .prepare(
      `SELECT
        id,
        key,
        name,
        enabled,
        auth_url AS authUrl,
        token_url AS tokenUrl,
        user_info_url AS userInfoUrl,
        client_id AS clientId,
        client_secret_encrypted AS clientSecretEncrypted,
        scopes_json AS scopesJson,
        user_mapping_json AS userMappingJson,
        auto_create_user AS autoCreateUser,
        status,
        sort,
        is_system AS isSystem,
        created_at AS createdAt,
        updated_at AS updatedAt
       FROM sys_oauth_provider
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id)) as ProviderRow | undefined;
}

export const oauthProviderRoutes = new Hono<{ Variables: HonoVariables }>();

oauthProviderRoutes.get(
  "/oauth/provider",
  authRequired(),
  ability("system.oauthProvider.query"),
  async (c) => {
    const params = new URL(c.req.url).searchParams;
    const page = Math.max(Number(params.get("page") || 1), 1);
    const pageSize = Math.min(Math.max(Number(params.get("pageSize") || 20), 1), 200);
    const keyword = params.get("keyword")?.trim();
    const conditions = ["deleted_at IS NULL"];
    const values: Array<string | number> = [];
    if (keyword) {
      conditions.push("(key ILIKE ? OR name ILIKE ? OR auth_url ILIKE ?)");
      values.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const status = params.get("status");
    if (status) {
      conditions.push("status = ?");
      values.push(Number(status));
    }
    const where = conditions.join(" AND ");
    const orderSql = resolveListOrder({
      params,
      fieldMap: {
        id: "id",
        sort: "sort",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      sortableFields: ["id", "sort", "createdAt", "updatedAt"],
      defaultSort: { field: "sort", order: "asc" },
    }).sql;
    const totalRow = (await sqlite
      .prepare(`SELECT COUNT(1)::int AS total FROM sys_oauth_provider WHERE ${where}`)
      .get(...values)) as { total: number } | undefined;
    const rows = (await sqlite
      .prepare(
        `SELECT
          id,
          key,
          name,
          enabled,
          auth_url AS authUrl,
          token_url AS tokenUrl,
          user_info_url AS userInfoUrl,
          client_id AS clientId,
          client_secret_encrypted AS clientSecretEncrypted,
          scopes_json AS scopesJson,
          user_mapping_json AS userMappingJson,
          auto_create_user AS autoCreateUser,
          status,
          sort,
          is_system AS isSystem,
          created_at AS createdAt,
          updated_at AS updatedAt
         FROM sys_oauth_provider
         WHERE ${where}
         ${orderSql}
         LIMIT ? OFFSET ?`,
      )
      .all(...values, pageSize, (page - 1) * pageSize)) as ProviderRow[];
    const result: PageResult<ReturnType<typeof toResponse>> = {
      data: rows.map(toResponse),
      total: Number(totalRow?.total ?? 0),
      page,
      pageSize,
    };
    return c.json(success(result));
  },
);

oauthProviderRoutes.post(
  "/oauth/provider",
  authRequired(),
  ability("system.oauthProvider.create"),
  async (c) => {
    const payload = providerSchema.parse(await c.req.json());
    const scopesJson = JSON.stringify(normalizeScopes(payload.scopes));
    const userMappingJson = JSON.stringify(parseJsonObject(payload.userMapping));
    const clientSecretEncrypted = payload.clientSecret ? encryptSecret(payload.clientSecret) : null;
    await runWithOperationLog(
      c,
      {
        module: "system.oauthProvider",
        action: "create",
        resource: "/oauth/provider",
        details: { key: payload.key },
      },
      async () => {
        await sqlite
          .prepare(
            `INSERT INTO sys_oauth_provider
              (key, name, enabled, auth_url, token_url, user_info_url, client_id, client_secret_encrypted, scopes_json, user_mapping_json, auto_create_user, status, sort, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            payload.key,
            payload.name,
            payload.enabled,
            payload.authUrl,
            payload.tokenUrl || null,
            payload.userInfoUrl || null,
            payload.clientId || null,
            clientSecretEncrypted,
            scopesJson,
            userMappingJson,
            payload.autoCreateUser,
            payload.status,
            payload.sort,
            nowIso(),
            nowIso(),
          );
      },
    );
    return c.json(success(null, "创建成功"));
  },
);

oauthProviderRoutes.put(
  "/oauth/provider/:id",
  authRequired(),
  ability("system.oauthProvider.update"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = providerSchema.partial().parse(await c.req.json());
    const row = await getProvider(id);
    if (!row) throw new Error("第三方登录配置不存在");
    if (row.isSystem && payload.key && payload.key !== row.key) {
      throw new Error("系统内置第三方登录不能修改编码");
    }
    await runWithOperationLog(
      c,
      {
        module: "system.oauthProvider",
        action: "update",
        resource: "/oauth/provider",
        resourceId: id,
        details: { fields: Object.keys(payload) },
      },
      async () => {
        await sqlite
          .prepare(
            `UPDATE sys_oauth_provider
             SET key = COALESCE(?, key),
                 name = COALESCE(?, name),
                 enabled = COALESCE(?, enabled),
                 auth_url = COALESCE(?, auth_url),
                 token_url = ?,
                 user_info_url = ?,
                 client_id = ?,
                 client_secret_encrypted = COALESCE(?, client_secret_encrypted),
                 scopes_json = ?,
                 user_mapping_json = ?,
                 auto_create_user = COALESCE(?, auto_create_user),
                 status = COALESCE(?, status),
                 sort = COALESCE(?, sort),
                 updated_at = now()
             WHERE id = ? AND deleted_at IS NULL`,
          )
          .run(
            payload.key ?? null,
            payload.name ?? null,
            payload.enabled ?? null,
            payload.authUrl ?? null,
            payload.tokenUrl ?? row.tokenUrl,
            payload.userInfoUrl ?? row.userInfoUrl,
            payload.clientId ?? row.clientId,
            payload.clientSecret ? encryptSecret(payload.clientSecret) : null,
            payload.scopes === undefined
              ? row.scopesJson
              : JSON.stringify(normalizeScopes(payload.scopes)),
            payload.userMapping === undefined
              ? row.userMappingJson
              : JSON.stringify(parseJsonObject(payload.userMapping)),
            payload.autoCreateUser ?? null,
            payload.status ?? null,
            payload.sort ?? null,
            id,
          );
      },
    );
    return c.json(success(null, "更新成功"));
  },
);

oauthProviderRoutes.delete(
  "/oauth/provider/:id",
  authRequired(),
  ability("system.oauthProvider.delete"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const row = await getProvider(id);
    if (!row) throw new Error("第三方登录配置不存在");
    if (row.isSystem) throw new Error("系统内置第三方登录不能删除");
    await runWithOperationLog(
      c,
      {
        module: "system.oauthProvider",
        action: "delete",
        resource: "/oauth/provider",
        resourceId: id,
      },
      async () => {
        await sqlite
          .prepare(
            "UPDATE sys_oauth_provider SET deleted_at = now(), updated_at = now() WHERE id = ?",
          )
          .run(id);
      },
    );
    return c.json(success(null, "删除成功"));
  },
);

oauthProviderRoutes.put(
  "/oauth/provider/status/:id",
  authRequired(),
  ability("system.oauthProvider.status"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = z
      .object({ status: z.coerce.number(), enabled: z.coerce.boolean().optional() })
      .parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.oauthProvider",
        action: "status",
        resource: "/oauth/provider",
        resourceId: id,
        details: payload,
      },
      async () => {
        await sqlite
          .prepare(
            "UPDATE sys_oauth_provider SET status = ?, enabled = COALESCE(?, enabled), updated_at = now() WHERE id = ? AND deleted_at IS NULL",
          )
          .run(payload.status, payload.enabled ?? null, id);
      },
    );
    return c.json(success(null, "更新成功"));
  },
);

oauthProviderRoutes.post(
  "/oauth/provider/test",
  authRequired(),
  ability("system.oauthProvider.test"),
  async (c) => {
    const payload = z.object({ id: z.coerce.number() }).parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.oauthProvider",
        action: "test",
        resource: "/oauth/provider",
        resourceId: payload.id,
      },
      async () => {
        const row = await getProvider(payload.id);
        if (!row) throw new Error("第三方登录配置不存在");
        if (!row.authUrl || !row.tokenUrl || !row.userInfoUrl || !row.clientId) {
          throw new Error("第三方登录配置不完整");
        }
      },
    );
    return c.json(success(null, "配置完整"));
  },
);
