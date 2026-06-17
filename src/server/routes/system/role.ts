import { Hono } from "hono";
import { z } from "zod";
import { buildTree } from "@/lib/tree";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { type DbClient, nowIso, sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildListQuery } from "@/server/services/list-query";

const roleSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  remark: z.string().optional().nullable(),
  sort: z.coerce.number().default(0),
  status: z.coerce.number().default(1),
  ruleIds: z.array(z.coerce.number()).default([]),
});

async function syncRoleRules(dbClient: DbClient, roleId: number, ruleIds: number[]) {
  await dbClient.prepare("DELETE FROM sys_role_rule WHERE role_id = ?").run(roleId);
  const insert = dbClient.prepare(
    "INSERT INTO sys_role_rule (role_id, rule_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
  );
  for (const ruleId of ruleIds) {
    await insert.run(roleId, ruleId);
  }
}

function parseIds(value: string | null) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

type RoleRow = {
  id: number;
  name: string;
  code: string;
  remark: string | null;
  sort: number;
  status: number;
  createdAt: string;
  userCount: number;
  ruleIds: string | null;
};

export const roleRoutes = new Hono<{ Variables: HonoVariables }>();

roleRoutes.get("/role", authRequired(), ability("system.role.query"), async (c) => {
  const page = await buildListQuery<RoleRow>(c.req.url, {
    table: "sys_role r",
    select: `
      r.id,
      r.name,
      r.code,
      r.remark,
      r.sort,
      r.status,
      r.created_at AS createdAt,
      (SELECT COUNT(1) FROM sys_user_role WHERE role_id = r.id) AS userCount,
      (SELECT STRING_AGG(rule_id::text, ',') FROM sys_role_rule WHERE role_id = r.id) AS ruleIds
    `,
    fieldMap: {
      id: "r.id",
      name: "r.name",
      code: "r.code",
      status: "r.status",
      sort: "r.sort",
      createdAt: "r.created_at",
    },
    searchable: {
      name: "like",
      code: "like",
      status: "=",
    },
    quickSearchFields: ["name", "code"],
    sortableFields: ["id", "sort", "status", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
    baseWhere: ["r.deleted_at IS NULL"],
  });

  return c.json(
    success({
      ...page,
      data: page.data.map((item) => ({
        ...item,
        ruleIds: parseIds(item.ruleIds),
      })),
    }),
  );
});

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

roleRoutes.get("/role/users/:id", authRequired(), ability("system.role.query"), async (c) => {
  const roleId = Number(c.req.param("id"));
  if (!Number.isFinite(roleId)) throw new Error("角色不存在");

  const page = await buildListQuery(c.req.url, {
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
    baseWhere: [`sur.role_id = ${roleId}`, "u.deleted_at IS NULL"],
  });

  return c.json(success(page));
});

roleRoutes.post("/role", authRequired(), ability("system.role.create"), async (c) => {
  const payload = roleSchema.parse(await c.req.json());
  const now = nowIso();
  await sqlite.transaction(async (tx) => {
    const result = await tx
      .prepare(
        `INSERT INTO sys_role
          (name, code, remark, sort, status, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .run(
        payload.name,
        payload.code,
        payload.remark ?? null,
        payload.sort,
        payload.status,
        now,
        now,
      );
    await syncRoleRules(tx, Number(result.lastInsertRowid), payload.ruleIds);
  });
  return c.json(success(null, "创建成功"));
});

roleRoutes.put("/role/status/:id", authRequired(), ability("system.role.status"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
  if (id === 1 && payload.status === 0) throw new Error("不能停用超级管理员角色");
  await sqlite
    .prepare("UPDATE sys_role SET status = ?, updated_at = ? WHERE id = ?")
    .run(payload.status, nowIso(), id);
  return c.json(success(null, "更新成功"));
});

roleRoutes.post("/role/setRule", authRequired(), ability("system.role.setRule"), async (c) => {
  const payload = z
    .object({
      id: z.coerce.number(),
      ruleIds: z.array(z.coerce.number()).default([]),
    })
    .parse(await c.req.json());
  if (payload.id === 1) throw new Error("超级管理员默认拥有全部权限");
  await syncRoleRules(sqlite, payload.id, payload.ruleIds);
  return c.json(success(null, "分配成功"));
});

roleRoutes.put("/role/:id", authRequired(), ability("system.role.update"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = roleSchema.partial({ ruleIds: true }).parse(await c.req.json());
  const now = nowIso();
  await sqlite.transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE sys_role
         SET name = COALESCE(?, name),
             code = COALESCE(?, code),
             remark = ?,
             sort = COALESCE(?, sort),
             status = COALESCE(?, status),
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        payload.name ?? null,
        payload.code ?? null,
        payload.remark ?? null,
        payload.sort ?? null,
        payload.status ?? null,
        now,
        id,
      );
    if (payload.ruleIds) await syncRoleRules(tx, id, payload.ruleIds);
  });
  return c.json(success(null, "更新成功"));
});

roleRoutes.delete("/role/:id", authRequired(), ability("system.role.delete"), async (c) => {
  const id = Number(c.req.param("id"));
  if (id === 1) throw new Error("不能删除超级管理员角色");
  await sqlite
    .prepare("UPDATE sys_role SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), id);
  return c.json(success(null, "删除成功"));
});
