import { sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { buildTree } from "@/lib/tree";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { type DbClient, sqlite } from "@/server/db";
import { sysRole } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildDataScopeWhereSql, resolveDataScope } from "@/server/services/data-scope";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import {
  assertNotSystemRecords,
  assertSystemCodeUnchanged,
  getSystemFlag,
} from "@/server/services/protected-records";
import { buildListQuery } from "@/server/services/list-query";

const dataScopeSchema = z.enum(["all", "custom_dept", "current_dept", "current_dept_tree", "self"]);

const roleSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  remark: z.string().optional().nullable(),
  sort: z.coerce.number().default(0),
  status: z.coerce.number().default(1),
  dataScope: dataScopeSchema.default("all"),
  ruleIds: z.array(z.coerce.number()).default([]),
  deptIds: z.array(z.coerce.number()).default([]),
});

async function syncRoleRules(dbClient: DbClient, roleId: number, ruleIds: number[]) {
  await dbClient.prepare("DELETE FROM sys_role_rule WHERE role_id = ?").run(roleId);
  const insert = dbClient.prepare(
    "INSERT INTO sys_role_rule (role_id, rule_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
  );
  for (const ruleId of [...new Set(ruleIds)]) {
    await insert.run(roleId, ruleId);
  }
}

async function syncRoleDepts(dbClient: DbClient, roleId: number, deptIds: number[]) {
  await dbClient.prepare("DELETE FROM sys_role_dept WHERE role_id = ?").run(roleId);
  const insert = dbClient.prepare(
    "INSERT INTO sys_role_dept (role_id, dept_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
  );
  for (const deptId of [...new Set(deptIds)]) {
    await insert.run(roleId, deptId);
  }
}

function parseIds(value: unknown) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

type RoleUserRecord = {
  id: number;
  username: string;
  nickname: string;
  email?: string | null;
  mobile?: string | null;
  status: number;
  createdAt: string;
};

const roleCrud = createCrudRoutes({
  basePath: "/role",
  table: sysRole,
  idColumn: sysRole.id,
  createSchema: roleSchema,
  updateSchema: roleSchema.partial(),
  permissions: { prefix: "system.role" },
  list: {
    select: {
      id: sysRole.id,
      name: sysRole.name,
      code: sysRole.code,
      remark: sysRole.remark,
      sort: sysRole.sort,
      status: sysRole.status,
      dataScope: sysRole.dataScope,
      isSystem: sysRole.isSystem,
      createdAt: sysRole.createdAt,
      userCount:
        drizzleSql<number>`(SELECT COUNT(1)::int FROM sys_user_role WHERE role_id = ${sysRole.id})`.as(
          "userCount",
        ),
      ruleIds: drizzleSql<
        string | null
      >`(SELECT STRING_AGG(rule_id::text, ',') FROM sys_role_rule WHERE role_id = ${sysRole.id})`.as(
        "ruleIds",
      ),
      deptIds: drizzleSql<
        string | null
      >`(SELECT STRING_AGG(dept_id::text, ',') FROM sys_role_dept WHERE role_id = ${sysRole.id})`.as(
        "deptIds",
      ),
    },
    searchable: {
      name: "like",
      code: "like",
      status: "=",
      dataScope: "=",
    },
    quickSearchFields: ["name", "code"],
    sortableFields: ["id", "sort", "status", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    afterList: (_ctx, page) => ({
      ...page,
      data: page.data.map((item) => ({
        ...item,
        userCount: Number(item.userCount ?? 0),
        ruleIds: parseIds(item.ruleIds),
        deptIds: parseIds(item.deptIds),
      })),
    }),
    beforeUpdate: async (ctx, id, values) => {
      const isSystem = await getSystemFlag(ctx.sql, "sys_role", id);
      if (!isSystem) return values;
      await assertSystemCodeUnchanged({
        db: ctx.sql,
        table: "sys_role",
        id,
        nextCode: values.code,
        message: "系统内置角色不能修改编码",
      });
      if (values.status === 0) throw new Error("系统内置角色不能停用");
      if (values.dataScope && values.dataScope !== "all") {
        throw new Error("超级管理员角色必须保持全部数据权限");
      }
      if (Array.isArray(values.ruleIds)) throw new Error("系统内置角色不能通过编辑表单修改权限");
      return values;
    },
    afterCreate: (ctx, id, values) =>
      Promise.all([
        syncRoleRules(ctx.sql, id, values.ruleIds ?? []),
        syncRoleDepts(ctx.sql, id, values.deptIds ?? []),
      ]).then(() => undefined),
    afterUpdate: (ctx, id, values) =>
      Promise.all([
        values.ruleIds ? syncRoleRules(ctx.sql, id, values.ruleIds) : Promise.resolve(),
        values.deptIds ? syncRoleDepts(ctx.sql, id, values.deptIds) : Promise.resolve(),
      ]).then(() => undefined),
    beforeDelete: (ctx, ids) =>
      assertNotSystemRecords({
        db: ctx.sql,
        table: "sys_role",
        ids,
        message: "系统内置角色不能删除",
      }),
  },
});

export const roleRoutes = new Hono<{ Variables: HonoVariables }>();

roleRoutes.get("/role/ruleList", authRequired(), ability("system.role.query"), async (c) => {
  const rows = (await sqlite
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
       WHERE status = 1
         AND deleted_at IS NULL
       ORDER BY "order" ASC, id ASC`,
    )
    .all()) as Array<{
    id: number;
    parentId: number;
    type: "menu" | "route" | "nested" | "action";
    key: string;
    name: string;
    path: string | null;
    icon: string | null;
    order: number;
    status: number;
    hidden: number;
    link: number;
  }>;
  return c.json(success(buildTree(rows)));
});

roleRoutes.get("/role/deptTree", authRequired(), ability("system.role.query"), async (c) => {
  const rows = (await sqlite
    .prepare(
      `SELECT id, parent_id AS parentId, name, code, sort
       FROM sys_dept
       WHERE deleted_at IS NULL AND status = 1
       ORDER BY sort ASC, id ASC`,
    )
    .all()) as Array<{ id: number; parentId: number }>;
  return c.json(success(buildTree(rows)));
});

roleRoutes.get("/role/users/:id", authRequired(), ability("system.role.query"), async (c) => {
  const roleId = Number(c.req.param("id"));
  if (!Number.isFinite(roleId)) throw new Error("角色不存在");

  const scope = await resolveDataScope(c);
  const scopeWhere = buildDataScopeWhereSql(scope, {
    deptId: "u.dept_id",
    userId: "u.id",
  });

  const page = await buildListQuery<RoleUserRecord>(c.req.url, {
    table: "sys_user u INNER JOIN sys_user_role sur ON sur.user_id = u.id",
    select: `
      u.id,
      u.username,
      u.nickname,
      u.email,
      u.mobile,
      u.status,
      u.created_at AS createdAt
    `,
    fieldMap: {
      id: "u.id",
      username: "u.username",
      nickname: "u.nickname",
      email: "u.email",
      mobile: "u.mobile",
      status: "u.status",
      createdAt: "u.created_at",
    },
    searchable: {
      username: "like",
      nickname: "like",
      email: "like",
      mobile: "like",
      status: "=",
    },
    quickSearchFields: ["username", "nickname", "email", "mobile"],
    sortableFields: ["id", "username", "status", "createdAt"],
    defaultSort: { field: "id", order: "asc" },
    baseWhere: [`sur.role_id = ${roleId}`, "u.deleted_at IS NULL", scopeWhere].filter(
      Boolean,
    ) as string[],
  });

  return c.json(success(page));
});

roleRoutes.put("/role/status/:id", authRequired(), ability("system.role.status"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
  await runWithOperationLog(
    c,
    {
      module: "system.role",
      action: "status",
      resource: "/role",
      resourceId: id,
      details: { status: payload.status },
    },
    async () => {
      if (payload.status === 0 && (await getSystemFlag(sqlite, "sys_role", id))) {
        throw new Error("系统内置角色不能停用");
      }
      await sqlite
        .prepare(
          "UPDATE sys_role SET status = ?, updated_at = now() WHERE id = ? AND deleted_at IS NULL",
        )
        .run(payload.status, id);
    },
  );
  return c.json(success(null, "更新成功"));
});

roleRoutes.post("/role/setRule", authRequired(), ability("system.role.setRule"), async (c) => {
  const payload = z
    .object({
      id: z.coerce.number(),
      ruleIds: z.array(z.coerce.number()).default([]),
    })
    .parse(await c.req.json());
  await runWithOperationLog(
    c,
    {
      module: "system.role",
      action: "setRule",
      resource: "/role",
      resourceId: payload.id,
      details: { ruleCount: payload.ruleIds.length },
    },
    async () => {
      if (await getSystemFlag(sqlite, "sys_role", payload.id)) {
        throw new Error("系统内置角色不能通过分配权限接口修改权限");
      }
      await sqlite.transaction(async (tx) => {
        await syncRoleRules(tx, payload.id, payload.ruleIds);
      });
    },
  );
  return c.json(success(null, "分配成功"));
});

roleRoutes.route("/", roleCrud.routes);
