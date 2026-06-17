import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { nowIso, sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildListQuery } from "@/server/services/list-query";

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

dictRoutes.get("/dict/list", authRequired(), ability("system.dict.query"), async (c) => {
  const page = await buildListQuery(c.req.url, {
    table: "sys_dict d",
    select: `
      d.id,
      d.name,
      d.code,
      d.remark,
      d.status,
      d.sort,
      d.created_at AS createdAt
    `,
    fieldMap: {
      id: "d.id",
      name: "d.name",
      code: "d.code",
      status: "d.status",
      sort: "d.sort",
      createdAt: "d.created_at",
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
    baseWhere: ["d.deleted_at IS NULL"],
  });
  return c.json(success(page));
});

dictRoutes.post("/dict/list", authRequired(), ability("system.dict.create"), async (c) => {
  const payload = dictSchema.parse(await c.req.json());
  const now = nowIso();
  await sqlite
    .prepare(
      `INSERT INTO sys_dict
        (name, code, remark, status, sort, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      payload.name,
      payload.code,
      payload.remark ?? null,
      payload.status,
      payload.sort,
      now,
      now,
    );
  return c.json(success(null, "创建成功"));
});

dictRoutes.put("/dict/list/:id", authRequired(), ability("system.dict.update"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = dictSchema.partial().parse(await c.req.json());
  await sqlite
    .prepare(
      `UPDATE sys_dict
       SET name = COALESCE(?, name),
           code = COALESCE(?, code),
           remark = ?,
           status = COALESCE(?, status),
           sort = COALESCE(?, sort),
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      payload.name ?? null,
      payload.code ?? null,
      payload.remark ?? null,
      payload.status ?? null,
      payload.sort ?? null,
      nowIso(),
      id,
    );
  return c.json(success(null, "更新成功"));
});

dictRoutes.delete("/dict/list/:id", authRequired(), ability("system.dict.delete"), async (c) => {
  const id = Number(c.req.param("id"));
  const now = nowIso();
  await sqlite
    .prepare("UPDATE sys_dict SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, id);
  return c.json(success(null, "删除成功"));
});

dictRoutes.get("/dict/item", authRequired(), ability("system.dict.query"), async (c) => {
  const page = await buildListQuery(c.req.url, {
    table: "sys_dict_item i",
    select: `
      i.id,
      i.dict_id AS dictId,
      i.label,
      i.value,
      i.status,
      i.sort,
      i.created_at AS createdAt
    `,
    fieldMap: {
      id: "i.id",
      dictId: "i.dict_id",
      label: "i.label",
      value: "i.value",
      status: "i.status",
      sort: "i.sort",
      createdAt: "i.created_at",
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
    baseWhere: ["i.deleted_at IS NULL"],
  });
  return c.json(success(page));
});

dictRoutes.post("/dict/item", authRequired(), ability("system.dict.create"), async (c) => {
  const payload = dictItemSchema.parse(await c.req.json());
  const now = nowIso();
  await sqlite
    .prepare(
      `INSERT INTO sys_dict_item
        (dict_id, label, value, status, sort, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(payload.dictId, payload.label, payload.value, payload.status, payload.sort, now, now);
  return c.json(success(null, "创建成功"));
});

dictRoutes.put("/dict/item/:id", authRequired(), ability("system.dict.update"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = dictItemSchema.partial().parse(await c.req.json());
  await sqlite
    .prepare(
      `UPDATE sys_dict_item
       SET dict_id = COALESCE(?, dict_id),
           label = COALESCE(?, label),
           value = COALESCE(?, value),
           status = COALESCE(?, status),
           sort = COALESCE(?, sort),
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      payload.dictId ?? null,
      payload.label ?? null,
      payload.value ?? null,
      payload.status ?? null,
      payload.sort ?? null,
      nowIso(),
      id,
    );
  return c.json(success(null, "更新成功"));
});

dictRoutes.delete("/dict/item/:id", authRequired(), ability("system.dict.delete"), async (c) => {
  const id = Number(c.req.param("id"));
  const now = nowIso();
  await sqlite
    .prepare("UPDATE sys_dict_item SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, id);
  return c.json(success(null, "删除成功"));
});
