import { Hono } from "hono";
import { z } from "zod";
import { buildTree } from "@/lib/tree";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { sqlite } from "@/server/db";
import { sysRule } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { assertNotSystemRecords, getSystemFlag } from "@/server/services/protected-records";

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
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
};

const ruleCrud = createCrudRoutes({
  basePath: "/rule",
  table: sysRule,
  idColumn: sysRule.id,
  createSchema: ruleSchema,
  updateSchema: ruleSchema.partial(),
  permissions: { prefix: "system.rule" },
  list: {
    select: {
      id: sysRule.id,
      parentId: sysRule.parentId,
      type: sysRule.type,
      key: sysRule.key,
      name: sysRule.name,
      displayName: sysRule.displayName,
      path: sysRule.path,
      icon: sysRule.icon,
      i18nKey: sysRule.i18nKey,
      component: sysRule.component,
      order: sysRule.order,
      status: sysRule.status,
      hidden: sysRule.hidden,
      link: sysRule.link,
      defaultAuth: sysRule.defaultAuth,
      isSystem: sysRule.isSystem,
      createdAt: sysRule.createdAt,
      updatedAt: sysRule.updatedAt,
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
  },
  hooks: {
    beforeUpdate: async (ctx, id, values) => {
      const isSystem = await getSystemFlag(ctx.sql, "sys_rule", id);
      if (!isSystem) return values;
      const current = (await ctx.sql
        .prepare("SELECT key, type FROM sys_rule WHERE id = ?")
        .get(id)) as { key: string; type: string } | undefined;
      const keyChanged = values.key !== undefined && values.key !== current?.key;
      const typeChanged = values.type !== undefined && values.type !== current?.type;
      if (keyChanged || typeChanged) {
        throw new Error("系统内置权限不能修改类型或权限标识");
      }
      if (values.status === 0) throw new Error("系统内置权限不能停用");
      return values;
    },
    beforeDelete: (ctx, ids) =>
      assertNotSystemRecords({
        db: ctx.sql,
        table: "sys_rule",
        ids,
        message: "系统内置权限不能删除",
      }),
  },
});

export const ruleRoutes = new Hono<{ Variables: HonoVariables }>();

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
        is_system AS isSystem,
        created_at AS createdAt,
        updated_at AS updatedAt
       FROM sys_rule
       WHERE deleted_at IS NULL
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
         AND deleted_at IS NULL
       ORDER BY "order" ASC, id ASC`,
    )
    .all();
  return c.json(success(rows));
});

ruleRoutes.put("/rule/hidden/:id", authRequired(), ability("system.rule.hidden"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = z.object({ hidden: z.coerce.number() }).parse(await c.req.json());
  if (payload.hidden === 0 && (await getSystemFlag(sqlite, "sys_rule", id))) {
    throw new Error("系统内置权限不能隐藏");
  }
  await sqlite
    .prepare("UPDATE sys_rule SET hidden = ?, updated_at = now() WHERE id = ? AND deleted_at IS NULL")
    .run(payload.hidden, id);
  return c.json(success(null, "更新成功"));
});

ruleRoutes.put("/rule/status/:id", authRequired(), ability("system.rule.status"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
  if (payload.status === 0 && (await getSystemFlag(sqlite, "sys_rule", id))) {
    throw new Error("系统内置权限不能停用");
  }
  await sqlite
    .prepare("UPDATE sys_rule SET status = ?, updated_at = now() WHERE id = ? AND deleted_at IS NULL")
    .run(payload.status, id);
  return c.json(success(null, "更新成功"));
});

ruleRoutes.route("/", ruleCrud.routes);
