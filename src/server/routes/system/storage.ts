import { sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { sqlite } from "@/server/db";
import { sysStorage } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { encryptSecret } from "@/server/services/secret";
import { getStorageById, testStorageConnection } from "@/server/services/storage-service";

const storageSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  type: z.enum(["local", "s3"]),
  endpoint: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  bucket: z.string().optional().nullable(),
  accessKey: z.string().optional().nullable(),
  secretKey: z.string().optional().nullable(),
  baseUrl: z.string().optional().nullable(),
  rootPath: z.string().optional().nullable(),
  status: z.coerce.number().default(1),
  sort: z.coerce.number().default(0),
  optionsJson: z.string().optional().nullable(),
});

function withEncryptedSecret<T extends Record<string, unknown>>(values: T) {
  const { secretKey, ...rest } = values;
  if (secretKey === undefined) return rest;
  return {
    ...rest,
    secretKeyEncrypted: encryptSecret(String(secretKey || "")),
  };
}

async function assertStorageMutable(id: number) {
  const row = (await sqlite
    .prepare("SELECT is_default AS isDefault, is_system AS isSystem FROM sys_storage WHERE id = ?")
    .get(id)) as { isDefault?: boolean; isSystem?: boolean } | undefined;
  if (!row) throw new Error("存储配置不存在");
  if (row.isDefault) throw new Error("默认存储不能删除，请先切换默认存储");
  if (row.isSystem) throw new Error("系统内置存储不能删除");
}

const storageCrud = createCrudRoutes({
  basePath: "/storage",
  table: sysStorage,
  idColumn: sysStorage.id,
  createSchema: storageSchema,
  updateSchema: storageSchema.partial(),
  permissions: { prefix: "system.storage" },
  list: {
    select: {
      id: sysStorage.id,
      name: sysStorage.name,
      code: sysStorage.code,
      type: sysStorage.type,
      endpoint: sysStorage.endpoint,
      region: sysStorage.region,
      bucket: sysStorage.bucket,
      accessKey: sysStorage.accessKey,
      hasSecretKey: drizzleSql<boolean>`(${sysStorage.secretKeyEncrypted} IS NOT NULL AND ${sysStorage.secretKeyEncrypted} <> '')`.as(
        "hasSecretKey",
      ),
      baseUrl: sysStorage.baseUrl,
      rootPath: sysStorage.rootPath,
      isDefault: sysStorage.isDefault,
      status: sysStorage.status,
      sort: sysStorage.sort,
      optionsJson: sysStorage.optionsJson,
      isSystem: sysStorage.isSystem,
      createdAt: sysStorage.createdAt,
      updatedAt: sysStorage.updatedAt,
    },
    searchable: {
      name: "like",
      code: "like",
      type: "=",
      status: "=",
    },
    quickSearchFields: ["name", "code", "endpoint", "bucket"],
    sortableFields: ["id", "sort", "status", "createdAt", "updatedAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    beforeCreate: (_ctx, values) => withEncryptedSecret(values),
    beforeUpdate: async (_ctx, id, values) => {
      const row = (await sqlite
        .prepare("SELECT is_system AS isSystem FROM sys_storage WHERE id = ?")
        .get(id)) as { isSystem?: boolean } | undefined;
      if (row?.isSystem && values.code !== undefined) {
        throw new Error("系统内置存储不能修改编码");
      }
      return withEncryptedSecret(values);
    },
    beforeDelete: async (_ctx, ids) => {
      for (const id of ids) await assertStorageMutable(id);
    },
  },
});

export const storageRoutes = new Hono<{ Variables: HonoVariables }>();

storageRoutes.put("/storage/status/:id", authRequired(), ability("system.storage.status"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
  const row = (await sqlite
    .prepare("SELECT is_default AS isDefault FROM sys_storage WHERE id = ? AND deleted_at IS NULL")
    .get(id)) as { isDefault?: boolean } | undefined;
  if (!row) throw new Error("存储配置不存在");
  if (row.isDefault && payload.status === 0) throw new Error("默认存储不能停用");
  await sqlite
    .prepare("UPDATE sys_storage SET status = ?, updated_at = now() WHERE id = ?")
    .run(payload.status, id);
  return c.json(success(null, "更新成功"));
});

storageRoutes.put(
  "/storage/default/:id",
  authRequired(),
  ability("system.storage.setDefault"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const row = await getStorageById(id);
    if (!row) throw new Error("存储配置不存在");
    if (row.status !== 1) throw new Error("停用的存储不能设为默认");
    await sqlite.transaction(async (tx) => {
      await tx.prepare("UPDATE sys_storage SET is_default = false, updated_at = now()").run();
      await tx.prepare("UPDATE sys_storage SET is_default = true, updated_at = now() WHERE id = ?").run(id);
    });
    return c.json(success(null, "设置成功"));
  },
);

storageRoutes.post("/storage/test", authRequired(), ability("system.storage.test"), async (c) => {
  const payload = z
    .object({
      id: z.coerce.number().optional(),
      config: storageSchema.partial().optional(),
    })
    .parse(await c.req.json());

  if (payload.id) {
    const row = await getStorageById(payload.id);
    if (!row) throw new Error("存储配置不存在");
    await testStorageConnection(row);
  } else {
    const config = storageSchema.parse(payload.config ?? {});
    await testStorageConnection({
      ...config,
      secretKeyEncrypted: encryptSecret(config.secretKey),
    });
  }

  return c.json(success(null, "测试成功"));
});

storageRoutes.route("/", storageCrud.routes);
