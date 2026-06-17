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
  type: z.enum(["menu", "route", "nested", "action"]),
  key: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().optional().nullable(),
  path: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
  i18nKey: z.string().optional().nullable(),
  component: z.string().optional().nullable(),
  order: z.coerce.number().default(0),
  status: z.coerce.number().default(1),
  hidden: z.coerce.number().default(1),
  link: z.coerce.number().default(0),
  defaultAuth: z.coerce.number().default(0),
});

type RuleRow = {
  id: number;
  parentId: number;
  type: "menu" | "route" | "nested" | "action";
  key: string;
  name: string;
  displayName: string | null;
  path: string | null;
  icon: string | null;
  i18nKey: string | null;
  component: string | null;
  order: number;
  status: number;
  hidden: number;
  link: number;
  defaultAuth: number;
  createdAt: string;
  updatedAt: string;
};

export const ruleRoutes = new Hono<{ Variables: HonoVariables }>();

ruleRoutes.get("/rule", authRequired(), ability("system.rule.query"), async (c) => {
  const page = await buildListQuery<RuleRow>(c.req.url, {
    table: "sys_rule r",
    select: `
      r.id,
      r.parent_id AS parentId,
      r.type,
      r.key,
      r.name,
      r.display_name AS displayName,
      r.path,
      r.icon,
      r.i18n_key AS i18nKey,
      r.component,
      r."order",
      r.status,
      r.hidden,
      r.link,
      r.default_auth AS defaultAuth,
      r.created_at AS createdAt,
      r.updated_at AS updatedAt
    `,
    fieldMap: {
      id: "r.id",
      parentId: "r.parent_id",
      type: "r.type",
      key: "r.key",
      name: "r.name",
      displayName: "r.display_name",
      path: "r.path",
      i18nKey: "r.i18n_key",
      component: "r.component",
      status: "r.status",
      hidden: "r.hidden",
      order: 'r."order"',
      createdAt: "r.created_at",
      updatedAt: "r.updated_at",
    },
    searchable: {
      type: "=",
      key: "like",
      name: "like",
      status: "=",
      hidden: "=",
    },
    quickSearchFields: ["key", "name", "displayName", "path", "i18nKey", "component"],
    sortableFields: ["id", "order", "status", "createdAt", "updatedAt"],
    defaultSort: { field: "order", order: "asc" },
  });
  return c.json(success(page));
});

ruleRoutes.get("/rule/tree", authRequired(), ability("system.rule.query"), async (c) => {
  const rows = (await sqlite
    .prepare(
      `SELECT
        id,
        parent_id AS parentId,
        type,
        key,
        name,
        display_name AS displayName,
        path,
        icon,
        i18n_key AS i18nKey,
        component,
        "order",
        status,
        hidden,
        link,
        default_auth AS defaultAuth,
        created_at AS createdAt,
        updated_at AS updatedAt
       FROM sys_rule
       ORDER BY "order" ASC, id ASC`,
    )
    .all()) as RuleRow[];
  return c.json(success(buildTree(rows)));
});

ruleRoutes.get("/rule/parent", authRequired(), ability("system.rule.query"), async (c) => {
  const rows = await sqlite
    .prepare(
      `SELECT id AS value, name AS label, parent_id AS parentId
       FROM sys_rule
       WHERE type IN ('menu', 'route', 'nested')
       ORDER BY "order" ASC, id ASC`,
    )
    .all();
  return c.json(success(rows));
});

ruleRoutes.post("/rule", authRequired(), ability("system.rule.create"), async (c) => {
  const payload = ruleSchema.parse(await c.req.json());
  const now = nowIso();
  await sqlite
    .prepare(
      `INSERT INTO sys_rule
        (parent_id, type, key, name, display_name, path, icon, i18n_key, component, "order", status, hidden, link, default_auth, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      payload.parentId,
      payload.type,
      payload.key,
      payload.name,
      payload.displayName ?? null,
      payload.path ?? null,
      payload.icon ?? null,
      payload.i18nKey ?? null,
      payload.component ?? null,
      payload.order,
      payload.status,
      payload.hidden,
      payload.link,
      payload.defaultAuth,
      now,
      now,
    );
  return c.json(success(null, "创建成功"));
});

ruleRoutes.put("/rule/hidden/:id", authRequired(), ability("system.rule.hidden"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = z.object({ hidden: z.coerce.number() }).parse(await c.req.json());
  await sqlite
    .prepare("UPDATE sys_rule SET hidden = ?, updated_at = ? WHERE id = ?")
    .run(payload.hidden, nowIso(), id);
  return c.json(success(null, "更新成功"));
});

ruleRoutes.put("/rule/status/:id", authRequired(), ability("system.rule.status"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
  await sqlite
    .prepare("UPDATE sys_rule SET status = ?, updated_at = ? WHERE id = ?")
    .run(payload.status, nowIso(), id);
  return c.json(success(null, "更新成功"));
});

ruleRoutes.put("/rule/:id", authRequired(), ability("system.rule.update"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = ruleSchema.partial().parse(await c.req.json());
  await sqlite
    .prepare(
      `UPDATE sys_rule
       SET parent_id = COALESCE(?, parent_id),
           type = COALESCE(?, type),
           key = COALESCE(?, key),
           name = COALESCE(?, name),
           display_name = ?,
           path = ?,
           icon = ?,
           i18n_key = ?,
           component = ?,
           "order" = COALESCE(?, "order"),
           status = COALESCE(?, status),
           hidden = COALESCE(?, hidden),
           link = COALESCE(?, link),
           default_auth = COALESCE(?, default_auth),
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      payload.parentId ?? null,
      payload.type ?? null,
      payload.key ?? null,
      payload.name ?? null,
      payload.displayName ?? null,
      payload.path ?? null,
      payload.icon ?? null,
      payload.i18nKey ?? null,
      payload.component ?? null,
      payload.order ?? null,
      payload.status ?? null,
      payload.hidden ?? null,
      payload.link ?? null,
      payload.defaultAuth ?? null,
      nowIso(),
      id,
    );
  return c.json(success(null, "更新成功"));
});

ruleRoutes.delete("/rule/:id", authRequired(), ability("system.rule.delete"), async (c) => {
  const id = Number(c.req.param("id"));
  await sqlite.prepare("DELETE FROM sys_role_rule WHERE rule_id = ?").run(id);
  await sqlite.prepare("DELETE FROM sys_rule WHERE id = ?").run(id);
  return c.json(success(null, "删除成功"));
});
