import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { nowIso, sqlite } from "@/server/db";
import { sysConfigGroup, sysConfigItems } from "@/server/db/schema";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { assertNotSystemRecords, getSystemFlag } from "@/server/services/protected-records";

const groupSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  sort: z.coerce.number().default(0),
  status: z.coerce.number().default(1),
});

const itemSchema = z.object({
  groupId: z.coerce.number(),
  key: z.string().min(1),
  title: z.string().min(1),
  describe: z.string().optional().nullable(),
  values: z.string().optional().nullable(),
  type: z.string().default("text"),
  optionsJson: z.string().optional().nullable(),
  propsJson: z.string().optional().nullable(),
  sort: z.coerce.number().default(0),
  status: z.coerce.number().default(1),
});

const configGroupCrud = createCrudRoutes({
  basePath: "/config/group",
  table: sysConfigGroup,
  idColumn: sysConfigGroup.id,
  createSchema: groupSchema,
  updateSchema: groupSchema.partial(),
  permissions: { prefix: "system.config" },
  list: {
    select: {
      id: sysConfigGroup.id,
      name: sysConfigGroup.name,
      code: sysConfigGroup.code,
      sort: sysConfigGroup.sort,
      status: sysConfigGroup.status,
      isSystem: sysConfigGroup.isSystem,
      createdAt: sysConfigGroup.createdAt,
    },
    searchable: { name: "like", code: "like", status: "=" },
    quickSearchFields: ["name", "code"],
    sortableFields: ["id", "sort", "status", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    beforeUpdate: async (ctx, id, values) => {
      if ((await getSystemFlag(ctx.sql, "sys_config_group", id)) && values.code !== undefined) {
        throw new Error("系统内置配置组不能修改编码");
      }
      return values;
    },
    beforeDelete: (ctx, ids) =>
      assertNotSystemRecords({
        db: ctx.sql,
        table: "sys_config_group",
        ids,
        message: "系统内置配置组不能删除",
      }),
  },
});

const configItemCrud = createCrudRoutes({
  basePath: "/config/items",
  table: sysConfigItems,
  idColumn: sysConfigItems.id,
  createSchema: itemSchema,
  updateSchema: itemSchema.partial(),
  permissions: { prefix: "system.config" },
  list: {
    select: {
      id: sysConfigItems.id,
      groupId: sysConfigItems.groupId,
      groupName: sysConfigGroup.name,
      key: sysConfigItems.key,
      title: sysConfigItems.title,
      describe: sysConfigItems.describe,
      values: sysConfigItems.values,
      type: sysConfigItems.type,
      optionsJson: sysConfigItems.optionsJson,
      propsJson: sysConfigItems.propsJson,
      sort: sysConfigItems.sort,
      status: sysConfigItems.status,
      isSystem: sysConfigItems.isSystem,
      createdAt: sysConfigItems.createdAt,
    },
    joins: [
      {
        type: "left",
        table: sysConfigGroup,
        on: eq(sysConfigGroup.id, sysConfigItems.groupId),
      },
    ],
    searchable: {
      groupId: "=",
      key: "like",
      title: "like",
      type: "=",
      status: "=",
    },
    quickSearchFields: ["key", "title"],
    sortableFields: ["id", "sort", "status", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    beforeUpdate: async (ctx, id, values) => {
      if ((await getSystemFlag(ctx.sql, "sys_config_items", id)) && values.key !== undefined) {
        throw new Error("系统内置配置项不能修改键名");
      }
      return values;
    },
    beforeDelete: (ctx, ids) =>
      assertNotSystemRecords({
        db: ctx.sql,
        table: "sys_config_items",
        ids,
        message: "系统内置配置项不能删除",
      }),
  },
});

export const configRoutes = new Hono<{ Variables: HonoVariables }>();

configRoutes.put("/config/items/save", authRequired(), ability("system.config.save"), async (c) => {
  const payload = z.record(z.string(), z.unknown()).parse(await c.req.json());
  const update = sqlite.prepare(
    `UPDATE sys_config_items SET "values" = ?, updated_at = ? WHERE key = ?`,
  );
  for (const [key, value] of Object.entries(payload)) {
    await update.run(typeof value === "string" ? value : JSON.stringify(value), nowIso(), key);
  }
  return c.json(success(null, "保存成功"));
});

configRoutes.post(
  "/config/items/refreshCache",
  authRequired(),
  ability("system.config.save"),
  (c) => {
    return c.json(success(null, "刷新成功"));
  },
);

configRoutes.route("/", configGroupCrud.routes);
configRoutes.route("/", configItemCrud.routes);
