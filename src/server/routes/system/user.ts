import bcrypt from "bcryptjs";
import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { type DbClient, nowIso, sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildListQuery } from "@/server/services/list-query";

const userCreateSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(6).default("123456"),
  nickname: z.string().min(1),
  email: z.string().email().or(z.literal("")).optional(),
  mobile: z.string().optional(),
  sex: z.coerce.number().default(0),
  deptId: z.coerce.number().nullable().optional(),
  status: z.coerce.number().default(1),
  roleIds: z.array(z.coerce.number()).default([]),
});

const userUpdateSchema = userCreateSchema.omit({ password: true }).partial({
  username: true,
  nickname: true,
});

async function syncUserRoles(dbClient: DbClient, userId: number, roleIds: number[]) {
  await dbClient.prepare("DELETE FROM sys_user_role WHERE user_id = ?").run(userId);
  const insert = dbClient.prepare(
    "INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
  );
  for (const roleId of roleIds) {
    await insert.run(userId, roleId);
  }
}

function parseRoleIds(value: string | null) {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

type UserListRow = {
  id: number;
  username: string;
  nickname: string;
  email: string | null;
  mobile: string | null;
  sex: number;
  deptId: number | null;
  deptName: string | null;
  status: number;
  createdAt: string;
  updatedAt: string;
  roleIds: string | null;
};

export const userRoutes = new Hono<{ Variables: HonoVariables }>();

userRoutes.get("/user", authRequired(), ability("system.user.query"), async (c) => {
  const page = await buildListQuery<UserListRow>(c.req.url, {
    table: "sys_user u LEFT JOIN sys_dept d ON d.id = u.dept_id",
    select: `
      u.id,
      u.username,
      u.nickname,
      u.email,
      u.mobile,
      u.sex,
      u.dept_id AS deptId,
      d.name AS deptName,
      u.status,
      u.created_at AS createdAt,
      u.updated_at AS updatedAt,
      (SELECT STRING_AGG(role_id::text, ',') FROM sys_user_role WHERE user_id = u.id) AS roleIds
    `,
    fieldMap: {
      id: "u.id",
      username: "u.username",
      nickname: "u.nickname",
      sex: "u.sex",
      email: "u.email",
      mobile: "u.mobile",
      deptId: "u.dept_id",
      status: "u.status",
      createdAt: "u.created_at",
      updatedAt: "u.updated_at",
    },
    searchable: {
      username: "like",
      nickname: "like",
      sex: "=",
      mobile: "like",
      email: "like",
      deptId: "=",
      status: "=",
      createdAt: "betweenDate",
    },
    quickSearchFields: ["username", "nickname", "mobile", "email"],
    sortableFields: ["id", "username", "status", "createdAt", "updatedAt"],
    defaultSort: { field: "id", order: "asc" },
    baseWhere: ["u.deleted_at IS NULL"],
  });

  return c.json(
    success({
      ...page,
      data: page.data.map((item) => ({
        ...item,
        roleIds: parseRoleIds(item.roleIds),
      })),
    }),
  );
});

userRoutes.get("/user/role", authRequired(), ability("system.user.query"), async (c) => {
  const rows = await sqlite
    .prepare(
      `SELECT id AS value, name AS label
       FROM sys_role
       WHERE deleted_at IS NULL AND status = 1
       ORDER BY sort ASC, id ASC`,
    )
    .all();
  return c.json(success(rows));
});

userRoutes.get("/user/dept", authRequired(), ability("system.user.query"), async (c) => {
  const rows = await sqlite
    .prepare(
      `SELECT id AS value, name AS label, parent_id AS parentId
       FROM sys_dept
       WHERE deleted_at IS NULL AND status = 1
       ORDER BY sort ASC, id ASC`,
    )
    .all();
  return c.json(success(rows));
});

userRoutes.post("/user", authRequired(), ability("system.user.create"), async (c) => {
  const payload = userCreateSchema.parse(await c.req.json());
  const exists = await sqlite
    .prepare("SELECT id FROM sys_user WHERE username = ?")
    .get(payload.username);
  if (exists) throw new Error("账号已存在");

  const now = nowIso();
  const passwordHash = await bcrypt.hash(payload.password, 10);
  await sqlite.transaction(async (tx) => {
    const result = await tx
      .prepare(
        `INSERT INTO sys_user
          (username, password_hash, nickname, email, mobile, sex, dept_id, status, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .run(
        payload.username,
        passwordHash,
        payload.nickname,
        payload.email || null,
        payload.mobile || null,
        payload.sex,
        payload.deptId ?? null,
        payload.status,
        now,
        now,
      );
    await syncUserRoles(tx, Number(result.lastInsertRowid), payload.roleIds);
  });
  return c.json(success(null, "创建成功"));
});

userRoutes.put(
  "/user/resetPassword",
  authRequired(),
  ability("system.user.resetPassword"),
  async (c) => {
    const payload = z
      .object({
        id: z.coerce.number(),
        password: z.string().min(6),
      })
      .parse(await c.req.json());

    const passwordHash = await bcrypt.hash(payload.password, 10);
    await sqlite
      .prepare("UPDATE sys_user SET password_hash = ?, updated_at = ? WHERE id = ?")
      .run(passwordHash, nowIso(), payload.id);
    return c.json(success(null, "重置成功"));
  },
);

userRoutes.put("/user/:id", authRequired(), ability("system.user.update"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = userUpdateSchema.parse(await c.req.json());
  if (id === 1 && payload.status === 0) throw new Error("不能停用超级管理员");

  const now = nowIso();
  await sqlite.transaction(async (tx) => {
    await tx
      .prepare(
        `UPDATE sys_user
         SET username = COALESCE(?, username),
             nickname = COALESCE(?, nickname),
             email = ?,
             mobile = ?,
             sex = COALESCE(?, sex),
             dept_id = ?,
             status = COALESCE(?, status),
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        payload.username ?? null,
        payload.nickname ?? null,
        payload.email || null,
        payload.mobile || null,
        payload.sex ?? null,
        payload.deptId ?? null,
        payload.status ?? null,
        now,
        id,
      );
    if (payload.roleIds) await syncUserRoles(tx, id, payload.roleIds);
  });
  return c.json(success(null, "更新成功"));
});

userRoutes.delete("/user/:id", authRequired(), ability("system.user.delete"), async (c) => {
  const id = Number(c.req.param("id"));
  if (id === 1) throw new Error("不能删除超级管理员");
  await sqlite
    .prepare("UPDATE sys_user SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), id);
  return c.json(success(null, "删除成功"));
});
