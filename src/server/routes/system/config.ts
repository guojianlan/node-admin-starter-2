import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { nowIso, sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildListQuery } from "@/server/services/list-query";

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

export const configRoutes = new Hono<{ Variables: HonoVariables }>();

configRoutes.get("/config/group", authRequired(), ability("system.config.query"), (c) => {
  const page = buildListQuery(c.req.url, {
    table: "sys_config_group g",
    select: `
      g.id,
      g.name,
      g.code,
      g.sort,
      g.status,
      g.created_at AS createdAt
    `,
    fieldMap: {
      id: "g.id",
      name: "g.name",
      code: "g.code",
      sort: "g.sort",
      status: "g.status",
      createdAt: "g.created_at",
    },
    searchable: { name: "like", code: "like", status: "=" },
    quickSearchFields: ["name", "code"],
    sortableFields: ["id", "sort", "status", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
    baseWhere: ["g.deleted_at IS NULL"],
  });
  return c.json(success(page));
});

configRoutes.post("/config/group", authRequired(), ability("system.config.create"), async (c) => {
  const payload = groupSchema.parse(await c.req.json());
  const now = nowIso();
  sqlite
    .prepare(
      `INSERT INTO sys_config_group
        (name, code, sort, status, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?)`,
    )
    .run(payload.name, payload.code, payload.sort, payload.status, now, now);
  return c.json(success(null, "创建成功"));
});

configRoutes.put("/config/group/:id", authRequired(), ability("system.config.update"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = groupSchema.partial().parse(await c.req.json());
  sqlite
    .prepare(
      `UPDATE sys_config_group
       SET name = COALESCE(?, name),
           code = COALESCE(?, code),
           sort = COALESCE(?, sort),
           status = COALESCE(?, status),
           updated_at = ?
       WHERE id = ?`,
    )
    .run(payload.name ?? null, payload.code ?? null, payload.sort ?? null, payload.status ?? null, nowIso(), id);
  return c.json(success(null, "更新成功"));
});

configRoutes.delete("/config/group/:id", authRequired(), ability("system.config.delete"), (c) => {
  const id = Number(c.req.param("id"));
  sqlite
    .prepare("UPDATE sys_config_group SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), id);
  return c.json(success(null, "删除成功"));
});

configRoutes.get("/config/items", authRequired(), ability("system.config.query"), (c) => {
  const page = buildListQuery(c.req.url, {
    table: "sys_config_items i LEFT JOIN sys_config_group g ON g.id = i.group_id",
    select: `
      i.id,
      i.group_id AS groupId,
      g.name AS groupName,
      i.key,
      i.title,
      i.describe,
      i."values" AS "values",
      i.type,
      i.options_json AS optionsJson,
      i.props_json AS propsJson,
      i.sort,
      i.status,
      i.created_at AS createdAt
    `,
    fieldMap: {
      id: "i.id",
      groupId: "i.group_id",
      key: "i.key",
      title: "i.title",
      type: "i.type",
      status: "i.status",
      sort: "i.sort",
      createdAt: "i.created_at",
    },
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
    baseWhere: ["i.deleted_at IS NULL"],
  });
  return c.json(success(page));
});

configRoutes.post("/config/items", authRequired(), ability("system.config.create"), async (c) => {
  const payload = itemSchema.parse(await c.req.json());
  const now = nowIso();
  sqlite
    .prepare(
      `INSERT INTO sys_config_items
        (group_id, key, title, describe, "values", type, options_json, props_json, sort, status, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      payload.groupId,
      payload.key,
      payload.title,
      payload.describe ?? null,
      payload.values ?? null,
      payload.type,
      payload.optionsJson ?? null,
      payload.propsJson ?? null,
      payload.sort,
      payload.status,
      now,
      now,
    );
  return c.json(success(null, "创建成功"));
});

configRoutes.put("/config/items/save", authRequired(), ability("system.config.save"), async (c) => {
  const payload = z.record(z.string(), z.unknown()).parse(await c.req.json());
  const update = sqlite.prepare(`UPDATE sys_config_items SET "values" = ?, updated_at = ? WHERE key = ?`);
  Object.entries(payload).forEach(([key, value]) => {
    update.run(typeof value === "string" ? value : JSON.stringify(value), nowIso(), key);
  });
  return c.json(success(null, "保存成功"));
});

configRoutes.post("/config/items/refreshCache", authRequired(), ability("system.config.save"), (c) => {
  return c.json(success(null, "刷新成功"));
});

configRoutes.put("/config/items/:id", authRequired(), ability("system.config.update"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = itemSchema.partial().parse(await c.req.json());
  sqlite
    .prepare(
      `UPDATE sys_config_items
       SET group_id = COALESCE(?, group_id),
           key = COALESCE(?, key),
           title = COALESCE(?, title),
           describe = ?,
           "values" = ?,
           type = COALESCE(?, type),
           options_json = ?,
           props_json = ?,
           sort = COALESCE(?, sort),
           status = COALESCE(?, status),
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      payload.groupId ?? null,
      payload.key ?? null,
      payload.title ?? null,
      payload.describe ?? null,
      payload.values ?? null,
      payload.type ?? null,
      payload.optionsJson ?? null,
      payload.propsJson ?? null,
      payload.sort ?? null,
      payload.status ?? null,
      nowIso(),
      id,
    );
  return c.json(success(null, "更新成功"));
});

configRoutes.delete("/config/items/:id", authRequired(), ability("system.config.delete"), (c) => {
  const id = Number(c.req.param("id"));
  sqlite
    .prepare("UPDATE sys_config_items SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), id);
  return c.json(success(null, "删除成功"));
});
