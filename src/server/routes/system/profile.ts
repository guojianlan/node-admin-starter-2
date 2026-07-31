import bcrypt from "bcryptjs";
import { Hono } from "hono";
import { z } from "zod";
import { success, type PageResult } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { sqlite } from "@/server/db";
import { authRequired } from "@/server/middleware/auth";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { createOauthBindRedirect } from "@/server/services/login-security-service";
import {
  assertPasswordPolicy,
  recordPasswordHistory,
  revokeUserTokens,
} from "@/server/services/security-policy-service";
import { uploadFileToDefaultStorage } from "@/server/services/storage-service";

type LoginRecord = {
  id: number;
  username: string;
  ip: string | null;
  userAgent: string | null;
  status: number;
  message: string | null;
  createdAt: string | Date;
};

type OauthAccount = {
  provider: string;
  providerUserId: string;
  providerUsername: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
};

function pageParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const profileRoutes = new Hono<{ Variables: HonoVariables }>();

profileRoutes.get("/profile", authRequired(), async (c) => {
  const user = c.get("user");
  const row = await sqlite
    .prepare(
      `SELECT
        u.id,
        u.username,
        u.nickname,
        u.email,
        u.mobile,
        u.sex,
        u.bio,
        u.dept_id AS "deptId",
        d.name AS "deptName",
        u.avatar_id AS "avatarId",
        f.url AS "avatarUrl",
        u.login_ip AS "loginIp",
        u.login_time AS "loginTime",
        u.password_updated_at AS "passwordUpdatedAt",
        u.status
       FROM sys_user u
       LEFT JOIN sys_dept d ON d.id = u.dept_id
       LEFT JOIN sys_file f ON f.id = u.avatar_id
       WHERE u.id = ? AND u.deleted_at IS NULL`,
    )
    .get(user.id);
  return c.json(success(row));
});

profileRoutes.put("/profile", authRequired(), async (c) => {
  const user = c.get("user");
  const payload = z
    .object({
      nickname: z.string().min(1),
      email: z.string().email().or(z.literal("")).optional().nullable(),
      mobile: z.string().optional().nullable(),
      sex: z.coerce.number().optional(),
      bio: z.string().optional().nullable(),
    })
    .parse(await c.req.json());

  await runWithOperationLog(
    c,
    {
      module: "profile",
      action: "update",
      resource: "/profile",
      resourceId: user.id,
      details: { fields: Object.keys(payload) },
    },
    async () => {
      await sqlite
        .prepare(
          `UPDATE sys_user
           SET nickname = ?,
               email = ?,
               mobile = ?,
               sex = COALESCE(?, sex),
               bio = ?,
               updated_at = now()
           WHERE id = ?`,
        )
        .run(
          payload.nickname,
          payload.email || null,
          payload.mobile || null,
          payload.sex ?? null,
          payload.bio || null,
          user.id,
        );
    },
  );

  return c.json(success(null, "保存成功"));
});

profileRoutes.put("/profile/password", authRequired(), async (c) => {
  const user = c.get("user");
  const payload = z
    .object({
      oldPassword: z.string().min(1),
      newPassword: z.string().min(6),
    })
    .parse(await c.req.json());

  await runWithOperationLog(
    c,
    {
      module: "profile",
      action: "changePassword",
      resource: "/profile",
      resourceId: user.id,
    },
    async () => {
      const row = (await sqlite
        .prepare("SELECT password_hash AS passwordHash FROM sys_user WHERE id = ?")
        .get(user.id)) as { passwordHash: string } | undefined;
      if (!row || !(await bcrypt.compare(payload.oldPassword, row.passwordHash))) {
        throw new Error("旧密码错误");
      }
      await assertPasswordPolicy({ password: payload.newPassword, userId: user.id });
      const passwordHash = await bcrypt.hash(payload.newPassword, 10);
      await sqlite
        .prepare(
          `UPDATE sys_user
           SET password_hash = ?,
               password_updated_at = now(),
               force_password_change = false,
               failed_login_attempts = 0,
               locked_until = NULL,
               updated_at = now()
           WHERE id = ?`,
        )
        .run(passwordHash, user.id);
      await recordPasswordHistory({ userId: user.id, passwordHash });
      await revokeUserTokens({ userId: user.id, exceptTokenHash: c.get("tokenHash") });
    },
  );

  return c.json(success(null, "密码已更新"));
});

profileRoutes.post("/profile/avatar", authRequired(), async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new Error("请选择头像文件");
  if (!file.type.startsWith("image/")) throw new Error("头像必须是图片文件");

  const result = await runWithOperationLog(
    c,
    {
      module: "profile",
      action: "uploadAvatar",
      resource: "/profile",
      resourceId: user.id,
    },
    async () => {
      const upload = await uploadFileToDefaultStorage({
        file,
        groupId: 1,
        userId: user.id,
      });
      await sqlite
        .prepare("UPDATE sys_user SET avatar_id = ?, updated_at = now() WHERE id = ?")
        .run(upload.id, user.id);
      return upload;
    },
  );

  return c.json(success(result, "头像已更新"));
});

profileRoutes.get("/profile/login-records", authRequired(), async (c) => {
  const user = c.get("user");
  const params = new URL(c.req.url).searchParams;
  const page = pageParam(params.get("page"), 1);
  const pageSize = Math.min(pageParam(params.get("pageSize"), 10), 100);
  const offset = (page - 1) * pageSize;

  const total = (await sqlite
    .prepare("SELECT COUNT(1)::int AS total FROM sys_login_record WHERE username = ?")
    .get(user.username)) as { total: number } | undefined;
  const data = (await sqlite
    .prepare(
      `SELECT
        id,
        username,
        ip,
        user_agent AS userAgent,
        status,
        message,
        created_at AS createdAt
       FROM sys_login_record
       WHERE username = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(user.username, pageSize, offset)) as LoginRecord[];

  const result: PageResult<LoginRecord> = {
    data,
    page,
    pageSize,
    total: Number(total?.total ?? 0),
  };
  return c.json(success(result));
});

profileRoutes.get("/profile/oauth/accounts", authRequired(), async (c) => {
  const user = c.get("user");
  const rows = (await sqlite
    .prepare(
      `SELECT
        provider,
        provider_user_id AS providerUserId,
        provider_username AS providerUsername,
        email,
        created_at AS createdAt,
        updated_at AS updatedAt
       FROM sys_oauth_account
       WHERE user_id = ?
       ORDER BY provider ASC`,
    )
    .all(user.id)) as OauthAccount[];
  return c.json(success(rows));
});

profileRoutes.post("/profile/oauth/:provider/bind", authRequired(), async (c) => {
  const user = c.get("user");
  const providerKey = c.req.param("provider");
  const url = new URL(c.req.url);
  const origin = c.req.header("origin") || `${url.protocol}//${url.host}`;
  const authUrl = await createOauthBindRedirect({
    providerKey,
    userId: user.id,
    origin,
  });
  return c.json(success({ authUrl }));
});

profileRoutes.delete("/profile/oauth/:provider/unbind", authRequired(), async (c) => {
  const user = c.get("user");
  const providerKey = c.req.param("provider");
  const account = (await sqlite
    .prepare("SELECT provider FROM sys_oauth_account WHERE user_id = ? AND provider = ?")
    .get(user.id, providerKey)) as { provider: string } | undefined;
  if (!account) throw new Error("第三方账号绑定不存在");

  const loginMethods = (await sqlite
    .prepare(
      `SELECT
        u.password_hash AS passwordHash,
        (SELECT COUNT(1)::int FROM sys_oauth_account WHERE user_id = u.id) AS oauthCount
       FROM sys_user u
       WHERE u.id = ?`,
    )
    .get(user.id)) as { passwordHash: string | null; oauthCount: number } | undefined;
  if (!loginMethods?.passwordHash && Number(loginMethods?.oauthCount ?? 0) <= 1) {
    throw new Error("当前账号没有可用密码，不能解绑最后一个第三方账号");
  }

  await runWithOperationLog(
    c,
    {
      module: "profile.oauth",
      action: "unbind",
      resource: "/profile/oauth",
      resourceId: user.id,
      details: { provider: providerKey },
    },
    async () => {
      await sqlite
        .prepare("DELETE FROM sys_oauth_account WHERE user_id = ? AND provider = ?")
        .run(user.id, providerKey);
    },
  );

  return c.json(success(null, "解绑成功"));
});
