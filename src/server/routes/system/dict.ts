import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { sqlite } from "@/server/db";
import { sysDict, sysDictItem } from "@/server/db/schema";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { authRequired } from "@/server/middleware/auth";
import {
  assertNotSystemRecords,
  assertSystemCodeUnchanged,
} from "@/server/services/protected-records";

const dictSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  remark: z.string().optional().nullable(),
  status: z.coerce.number().default(1),
  sort: z.coerce.number().default(0),
});

const dictItemSchema = z.object({
  dictId: z.coerce.number(),
  label: z.string().min(1),
  value: z.string().min(1),
  status: z.coerce.number().default(1),
  sort: z.coerce.number().default(0),
});

const dictCrud = createCrudRoutes({
  basePath: "/dict/list",
  table: sysDict,
  idColumn: sysDict.id,
  createSchema: dictSchema,
  updateSchema: dictSchema.partial(),
  permissions: { prefix: "system.dict" },
  list: {
    select: {
      id: sysDict.id,
      name: sysDict.name,
      code: sysDict.code,
      remark: sysDict.remark,
      status: sysDict.status,
      sort: sysDict.sort,
      isSystem: sysDict.isSystem,
      createdAt: sysDict.createdAt,
    },
    searchable: {
      id: "=",
      name: "like",
      code: "like",
      status: "=",
    },
    quickSearchFields: ["name", "code"],
    sortableFields: ["id", "sort", "status", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    beforeUpdate: async (ctx, id, values) => {
      await assertSystemCodeUnchanged({
        db: ctx.sql,
        table: "sys_dict",
        id,
        nextCode: values.code,
        message: "系统内置字典不能修改编码",
      });
      return values;
    },
    beforeDelete: (ctx, ids) =>
      assertNotSystemRecords({
        db: ctx.sql,
        table: "sys_dict",
        ids,
        message: "系统内置字典不能删除",
      }),
  },
});

const dictItemCrud = createCrudRoutes({
  basePath: "/dict/item",
  table: sysDictItem,
  idColumn: sysDictItem.id,
  createSchema: dictItemSchema,
  updateSchema: dictItemSchema.partial(),
  permissions: { prefix: "system.dict" },
  list: {
    select: {
      id: sysDictItem.id,
      dictId: sysDictItem.dictId,
      label: sysDictItem.label,
      value: sysDictItem.value,
      status: sysDictItem.status,
      sort: sysDictItem.sort,
      createdAt: sysDictItem.createdAt,
    },
    searchable: {
      dictId: "=",
      label: "like",
      value: "like",
      status: "=",
    },
    quickSearchFields: ["label", "value"],
    sortableFields: ["id", "sort", "status", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
});

export const dictRoutes = new Hono<{ Variables: HonoVariables }>();

dictRoutes.get("/dict/list/all", authRequired(), async (c) => {
  const dicts = (await sqlite
    .prepare(
      "SELECT id, code FROM sys_dict WHERE deleted_at IS NULL AND status = 1 ORDER BY sort ASC, id ASC",
    )
    .all()) as Array<{ id: number; code: string }>;
  const items = (await sqlite
    .prepare(
      `SELECT dict_id AS dictId, label, value
       FROM sys_dict_item
       WHERE deleted_at IS NULL AND status = 1
       ORDER BY sort ASC, id ASC`,
    )
    .all()) as Array<{ dictId: number; label: string; value: string }>;

  const result: Record<string, Array<{ label: string; value: string }>> = {};
  dicts.forEach((dict) => {
    result[dict.code] = items
      .filter((item) => item.dictId === dict.id)
      .map((item) => ({ label: item.label, value: item.value }));
  });

  return c.json(success(result));
});

dictRoutes.route("/", dictCrud.routes);
dictRoutes.route("/", dictItemCrud.routes);
