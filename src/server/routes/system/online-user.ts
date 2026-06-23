import { Hono } from "hono";
import { z } from "zod";
import { success, type PageResult } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { cleanExpiredTokens, revokeUserTokens } from "@/server/services/security-policy-service";

type OnlineUserRecord = {
  id: number;
  userId: number;
  username: string;
  nickname: string;
  name: string;
  ip: string | null;
  userAgent: string | null;
  lastUsedAt: string | Date | null;
  expiresAt: string | Date | null;
  createdAt: string | Date;
};

function pageParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function buildWhere(params: URLSearchParams) {
  const clauses = ["u.deleted_at IS NULL"];
  const values: Array<string | number> = [];
  const keyword = params.get("keyword")?.trim();
  if (keyword) {
    clauses.push("(u.username ILIKE ? OR u.nickname ILIKE ? OR t.ip ILIKE ? OR t.user_agent ILIKE ?)");
    values.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  for (const [field, column] of [
    ["username", "u.username"],
    ["ip", "t.ip"],
    ["userAgent", "t.user_agent"],
  ] as const) {
    const value = params.get(field)?.trim();
    if (value) {
      clauses.push(`${column} ILIKE ?`);
      values.push(`%${value}%`);
    }
  }
  const userId = params.get("userId");
  if (userId) {
    clauses.push("t.user_id = ?");
    values.push(Number(userId));
  }
  const onlyActive = params.get("active") !== "false";
  if (onlyActive) clauses.push("(t.expires_at IS NULL OR t.expires_at > now())");
  return { where: clauses.join(" AND "), values };
}

export const onlineUserRoutes = new Hono<{ Variables: HonoVariables }>();

onlineUserRoutes.get(
  "/online/user",
  authRequired(),
  ability("system.onlineUser.query"),
  async (c) => {
    const params = new URL(c.req.url).searchParams;
    const page = pageParam(params.get("page"), 1);
    const pageSize = Math.min(pageParam(params.get("pageSize"), 20), 200);
    const offset = (page - 1) * pageSize;
    const { where, values } = buildWhere(params);

    const totalRow = (await sqlite
      .prepare(
        `SELECT COUNT(1)::int AS total
         FROM sys_access_token t
         INNER JOIN sys_user u ON u.id = t.user_id
         WHERE ${where}`,
      )
      .get(...values)) as { total: number } | undefined;

    const data = (await sqlite
      .prepare(
        `SELECT
          t.id,
          t.user_id AS userId,
          u.username,
          u.nickname,
          t.name,
          t.ip,
          t.user_agent AS userAgent,
          t.last_used_at AS lastUsedAt,
          t.expires_at AS expiresAt,
          t.created_at AS createdAt
         FROM sys_access_token t
         INNER JOIN sys_user u ON u.id = t.user_id
         WHERE ${where}
         ORDER BY COALESCE(t.last_used_at, t.created_at) DESC, t.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, pageSize, offset)) as OnlineUserRecord[];

    const result: PageResult<OnlineUserRecord> = {
      data,
      page,
      pageSize,
      total: Number(totalRow?.total ?? 0),
    };
    return c.json(success(result));
  },
);

onlineUserRoutes.delete(
  "/online/user/expired",
  authRequired(),
  ability("system.onlineUser.clean"),
  async (c) => {
    const payload = z.object({}).parse(await c.req.json().catch(() => ({})));
    await runWithOperationLog(
      c,
      {
        module: "system.onlineUser",
        action: "cleanExpired",
        resource: "/online/user",
        details: payload,
      },
      async () => cleanExpiredTokens(),
    );
    return c.json(success(null, "清理成功"));
  },
);

onlineUserRoutes.delete(
  "/online/user/user/:userId",
  authRequired(),
  ability("system.onlineUser.kick"),
  async (c) => {
    const userId = Number(c.req.param("userId"));
    await runWithOperationLog(
      c,
      {
        module: "system.onlineUser",
        action: "kickUser",
        resource: "/online/user",
        resourceId: userId,
      },
      async () => revokeUserTokens({ userId }),
    );
    return c.json(success(null, "已强制下线该用户全部会话"));
  },
);

onlineUserRoutes.delete(
  "/online/user/:id",
  authRequired(),
  ability("system.onlineUser.kick"),
  async (c) => {
    const id = Number(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.onlineUser",
        action: "kick",
        resource: "/online/user",
        resourceId: id,
      },
      async () => {
        await sqlite.prepare("DELETE FROM sys_access_token WHERE id = ?").run(id);
      },
    );
    return c.json(success(null, "已强制下线"));
  },
);
