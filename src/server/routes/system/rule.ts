import { Hono } from "hono";
import { z } from "zod";
import { buildTree } from "@/lib/tree";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { nowIso, sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildListQuery } from "@/server/services/list-query";

const ruleSchema = z.object({
  parentId: z.coerce.number().default(0),
  type: z.enum(["menu", "route", "action"]),
  key: z.string().min(1),
  name: z.string().min(1),
  path: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  order: z.coerce.number().default(0),
  status: z.coerce.number().default(1),
  hidden: z.coerce.number().default(1),
  link: z.coerce.number().default(0),
});

type RuleRow = {
  id: number;
  parentId: number;
  type: "menu" | "route" | "action";
  key: string;
  name: string;
  path: string | null;
  icon: string | null;
  order: number;
  status: number;
  hidden: number;
  link: number;
  createdAt: string;
};

export const ruleRoutes = new Hono<{ Variables: HonoVariables }>();

ruleRoutes.get("/rule", authRequired(), ability("system.rule.query"), (c) => {
  const page = buildListQuery<RuleRow>(c.req.url, {
    table: "sys_rule r",
    select: `
      r.id,
      r.parent_id AS parentId,
      r.type,
      r.key,
      r.name,
      r.path,
      r.icon,
      r."order",
      r.status,
      r.hidden,
      r.link,
      r.created_at AS createdAt
    `,
    fieldMap: {
      id: "r.id",
      parentId: "r.parent_id",
      type: "r.type",
      key: "r.key",
      name: "r.name",
      path: "r.path",
      status: "r.status",
      hidden: "r.hidden",
      order: "r.\"order\"",
      createdAt: "r.created_at",
    },
    searchable: {
      type: "=",
      key: "like",
      name: "like",
      status: "=",
      hidden: "=",
    },
    quickSearchFields: ["key", "name", "path"],
    sortableFields: ["id", "order", "status", "createdAt"],
    defaultSort: { field: "order", order: "asc" },
  });
  return c.json(success(page));
});

ruleRoutes.get("/rule/tree", authRequired(), ability("system.rule.query"), (c) => {
  const rows = sqlite
    .prepare(
      `SELECT
        id,
        parent_id AS parentId,
        type,
        key,
        name,
        path,
        icon,
        "order",
        status,
        hidden,
        link
       FROM sys_rule
       ORDER BY "order" ASC, id ASC`,
    )
    .all() as RuleRow[];
  return c.json(success(buildTree(rows)));
});

ruleRoutes.get("/rule/parent", authRequired(), ability("system.rule.query"), (c) => {
  const rows = sqlite
    .prepare(
      `SELECT id AS value, name AS label, parent_id AS parentId
       FROM sys_rule
       WHERE type IN ('menu', 'route')
       ORDER BY "order" ASC, id ASC`,
    )
    .all();
  return c.json(success(rows));
});

ruleRoutes.post("/rule", authRequired(), ability("system.rule.create"), async (c) => {
  const payload = ruleSchema.parse(await c.req.json());
  const now = nowIso();
  sqlite
    .prepare(
      `INSERT INTO sys_rule
        (parent_id, type, key, name, path, icon, "order", status, hidden, link, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      payload.parentId,
      payload.type,
      payload.key,
      payload.name,
      payload.path ?? null,
      payload.icon ?? null,
      payload.order,
      payload.status,
      payload.hidden,
      payload.link,
      now,
      now,
    );
  return c.json(success(null, "创建成功"));
});

ruleRoutes.put("/rule/hidden/:id", authRequired(), ability("system.rule.hidden"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = z.object({ hidden: z.coerce.number() }).parse(await c.req.json());
  sqlite
    .prepare("UPDATE sys_rule SET hidden = ?, updated_at = ? WHERE id = ?")
    .run(payload.hidden, nowIso(), id);
  return c.json(success(null, "更新成功"));
});

ruleRoutes.put("/rule/status/:id", authRequired(), ability("system.rule.status"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
  sqlite
    .prepare("UPDATE sys_rule SET status = ?, updated_at = ? WHERE id = ?")
    .run(payload.status, nowIso(), id);
  return c.json(success(null, "更新成功"));
});

ruleRoutes.put("/rule/:id", authRequired(), ability("system.rule.update"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = ruleSchema.partial().parse(await c.req.json());
  sqlite
    .prepare(
      `UPDATE sys_rule
       SET parent_id = COALESCE(?, parent_id),
           type = COALESCE(?, type),
           key = COALESCE(?, key),
           name = COALESCE(?, name),
           path = ?,
           icon = ?,
           "order" = COALESCE(?, "order"),
           status = COALESCE(?, status),
           hidden = COALESCE(?, hidden),
           link = COALESCE(?, link),
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      payload.parentId ?? null,
      payload.type ?? null,
      payload.key ?? null,
      payload.name ?? null,
      payload.path ?? null,
      payload.icon ?? null,
      payload.order ?? null,
      payload.status ?? null,
      payload.hidden ?? null,
      payload.link ?? null,
      nowIso(),
      id,
    );
  return c.json(success(null, "更新成功"));
});

ruleRoutes.delete("/rule/:id", authRequired(), ability("system.rule.delete"), (c) => {
  const id = Number(c.req.param("id"));
  sqlite.prepare("DELETE FROM sys_role_rule WHERE rule_id = ?").run(id);
  sqlite.prepare("DELETE FROM sys_rule WHERE id = ?").run(id);
  return c.json(success(null, "删除成功"));
});
