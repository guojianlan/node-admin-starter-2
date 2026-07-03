import bcrypt from "bcryptjs";
import { eq, sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { type DbClient, sqlite } from "@/server/db";
import { sysDept, sysUser } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildDataScopeWhereSql, resolveDataScope } from "@/server/services/data-scope";
import { assertNotSystemRecords, getSystemFlag } from "@/server/services/protected-records";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import {
  assertPasswordPolicy,
  getSecurityPolicy,
  recordPasswordHistory,
  revokeUserTokens,
} from "@/server/services/security-policy-service";

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
  for (const roleId of [...new Set(roleIds)]) {
    await insert.run(userId, roleId);
  }
}

function parseRoleIds(value: unknown) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function parseRoleNames(value: unknown) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function assertUsernameAvailable(dbClient: DbClient, username: string, currentId?: number) {
  const row = (await dbClient
    .prepare(
      `SELECT id
       FROM sys_user
       WHERE username = ?
         AND deleted_at IS NULL
         ${currentId ? "AND id <> ?" : ""}
       LIMIT 1`,
    )
    .get(...(currentId ? [username, currentId] : [username]))) as { id: number } | undefined;
  if (row) throw new Error("账号已存在");
}

const userCrud = createCrudRoutes({
  basePath: "/user",
  table: sysUser,
  idColumn: sysUser.id,
  createSchema: userCreateSchema,
  updateSchema: userUpdateSchema,
  permissions: { prefix: "system.user" },
  dataScope: {
    deptId: sysUser.deptId,
    userId: sysUser.id,
  },
  list: {
    select: {
      id: sysUser.id,
      username: sysUser.username,
      nickname: sysUser.nickname,
      email: sysUser.email,
      mobile: sysUser.mobile,
      sex: sysUser.sex,
      deptId: sysUser.deptId,
      deptName: sysDept.name,
      status: sysUser.status,
      isSystem: sysUser.isSystem,
      createdAt: sysUser.createdAt,
      updatedAt: sysUser.updatedAt,
      roleIds: drizzleSql<string | null>`(SELECT STRING_AGG(role_id::text, ',') FROM sys_user_role WHERE user_id = ${sysUser.id})`.as(
        "roleIds",
      ),
      roleNames: drizzleSql<string | null>`(
        SELECT STRING_AGG(r.name, ',')
        FROM sys_user_role ur
        LEFT JOIN sys_role r ON r.id = ur.role_id
        WHERE ur.user_id = ${sysUser.id}
          AND r.deleted_at IS NULL
      )`.as("roleNames"),
    },
    joins: [
      {
        type: "left",
        table: sysDept,
        on: eq(sysDept.id, sysUser.deptId),
      },
    ],
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
  },
  hooks: {
    afterList: (_ctx, page) => ({
      ...page,
      data: page.data.map((item) => ({
        ...item,
        roleIds: parseRoleIds(item.roleIds),
        roleNames: parseRoleNames(item.roleNames),
      })),
    }),
    beforeCreate: async (ctx, values) => {
      await assertUsernameAvailable(ctx.sql, values.username);
      const policy = await getSecurityPolicy();
      return {
        ...values,
        passwordHash: await bcrypt.hash(values.password, 10),
        passwordUpdatedAt: new Date(),
        forcePasswordChange: policy.forceChangeOnFirstLogin,
      };
    },
    afterCreate: (ctx, id, values) => syncUserRoles(ctx.sql, id, values.roleIds ?? []),
    beforeUpdate: async (ctx, id, values) => {
      const isSystem = await getSystemFlag(ctx.sql, "sys_user", id);
      if (values.username) await assertUsernameAvailable(ctx.sql, values.username, id);
      if (isSystem) {
        if (values.username !== undefined) throw new Error("系统内置用户不能修改账号");
        if (values.status === 0) throw new Error("系统内置用户不能停用");
        if (Array.isArray(values.roleIds) && !values.roleIds.includes(1)) {
          throw new Error("超级管理员不能移除超级管理员角色");
        }
      }
      return values;
    },
    afterUpdate: async (ctx, id, values) => {
      if (!values.roleIds) return;
      await syncUserRoles(ctx.sql, id, values.roleIds);
      await revokeUserTokens({ userId: id });
    },
    beforeDelete: (ctx, ids) =>
      assertNotSystemRecords({
        db: ctx.sql,
        table: "sys_user",
        ids,
        message: "系统内置用户不能删除",
      }),
  },
});

export const userRoutes = new Hono<{ Variables: HonoVariables }>();

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
  const scope = await resolveDataScope(c);
  const scopeWhere = buildDataScopeWhereSql(scope, {
    selfFallbackDept: "id",
    deptId: "id",
  });
  const rows = await sqlite
    .prepare(
      `SELECT id AS value, name AS label, parent_id AS parentId
       FROM sys_dept
       WHERE deleted_at IS NULL
         AND status = 1
         ${scopeWhere ? `AND ${scopeWhere}` : ""}
       ORDER BY sort ASC, id ASC`,
    )
    .all();
  return c.json(success(rows));
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

    await runWithOperationLog(
      c,
      {
        module: "system.user",
        action: "resetPassword",
        resource: "/user",
        resourceId: payload.id,
      },
      async () => {
        await assertPasswordPolicy({ password: payload.password, userId: payload.id });
        const passwordHash = await bcrypt.hash(payload.password, 10);
        await sqlite
          .prepare(
            `UPDATE sys_user
             SET password_hash = ?,
                 password_updated_at = now(),
                 force_password_change = true,
                 failed_login_attempts = 0,
                 locked_until = NULL,
                 updated_at = now()
             WHERE id = ?`,
          )
          .run(passwordHash, payload.id);
        await recordPasswordHistory({ userId: payload.id, passwordHash });
        await revokeUserTokens({ userId: payload.id });
      },
    );
    return c.json(success(null, "重置成功"));
  },
);

userRoutes.route("/", userCrud.routes);
