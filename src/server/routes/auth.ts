import { Hono, type Context } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { nowIso, sqlite } from "@/server/db";
import { authRequired } from "@/server/middleware/auth";
import { getUserAccess, getUserMenus, login, logout } from "@/server/services/auth-service";
import { resolveDataScopeForUser } from "@/server/services/data-scope";
import {
  confirmPasswordReset,
  createLoginCaptcha,
  createOauthRedirect,
  getPublicOauthProviders,
  handleOauthCallback,
  requestPasswordReset,
  verifyLoginCaptcha,
} from "@/server/services/login-security-service";
import { recordOperationLog } from "@/server/services/operation-log-service";
import { getSecurityPolicy } from "@/server/services/security-policy-service";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional(),
  captchaId: z.string().optional(),
  captchaCode: z.string().optional(),
});

const forgotPasswordSchema = z.object({
  account: z.string().min(1),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

function firstForwardedValue(value?: string) {
  return value?.split(",", 1)[0]?.trim();
}

function requestOrigin(c: Context<{ Variables: HonoVariables }>) {
  const requestUrl = new URL(c.req.url);
  const host =
    firstForwardedValue(c.req.header("x-forwarded-host")) ||
    c.req.header("host") ||
    requestUrl.host;
  const protocol =
    firstForwardedValue(c.req.header("x-forwarded-proto")) || requestUrl.protocol.replace(/:$/, "");
  return new URL(`${protocol}://${host}`).origin;
}

async function shouldRequireCaptcha(username: string) {
  const policy = await getSecurityPolicy();
  if (policy.captchaEnabled) return true;
  if (policy.captchaAfterFailures <= 0) return false;
  const row = (await sqlite
    .prepare(
      `SELECT failed_login_attempts AS failedLoginAttempts
       FROM sys_user
       WHERE username = ? AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(username)) as { failedLoginAttempts: number } | undefined;
  return Number(row?.failedLoginAttempts ?? 0) >= policy.captchaAfterFailures;
}

export const authRoutes = new Hono<{ Variables: HonoVariables }>();

authRoutes.get("/login/options", async (c) => {
  const policy = await getSecurityPolicy();
  return c.json(
    success({
      captchaEnabled: policy.captchaEnabled,
      oauthProviders: await getPublicOauthProviders(),
    }),
  );
});

authRoutes.get("/login/captcha", async (c) => {
  return c.json(success(createLoginCaptcha()));
});

authRoutes.get("/oauth/:provider/redirect", async (c) => {
  const providerKey = c.req.param("provider");
  const url = new URL(c.req.url);
  const redirectUrl = await createOauthRedirect({
    providerKey,
    origin: requestOrigin(c),
    redirect: url.searchParams.get("redirect"),
  });
  return c.redirect(redirectUrl);
});

authRoutes.get("/oauth/:provider/callback", async (c) => {
  const providerKey = c.req.param("provider");
  const url = new URL(c.req.url);
  const origin = requestOrigin(c);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw new Error("OAuth callback 参数不完整");
  try {
    const result = await handleOauthCallback({
      providerKey,
      code,
      state,
      origin,
      ip: c.req.header("x-forwarded-for") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    await recordOperationLog(c, {
      userId: result.userId,
      module: "system.auth",
      action: result.mode === "bind" ? `oauthBind:${providerKey}` : `oauthLogin:${providerKey}`,
      resource: "/auth",
      resourceId: result.userId,
      status: 302,
      success: true,
    });
    if (result.mode === "bind") {
      const target = new URL(result.redirectUri || "/profile", origin);
      target.searchParams.set("oauthBound", providerKey);
      return c.redirect(target.toString());
    }
    const target = new URL("/login", origin);
    target.searchParams.set("oauthToken", result.token);
    target.searchParams.set("redirect", result.redirectUri);
    return c.redirect(target.toString());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sqlite
      .prepare(
        `INSERT INTO sys_login_record
          (username, ip, user_agent, status, message, created_at)
         VALUES
          (?, ?, ?, 0, ?, ?)`,
      )
      .run(
        `oauth:${providerKey}`,
        c.req.header("x-forwarded-for") ?? null,
        c.req.header("user-agent") ?? null,
        message,
        nowIso(),
      );
    await recordOperationLog(c, {
      module: "system.auth",
      action: `oauthLogin:${providerKey}`,
      resource: "/auth",
      status: 500,
      success: false,
      message,
    });
    throw error;
  }
});

authRoutes.post("/login", async (c) => {
  const payload = loginSchema.parse(await c.req.json());
  try {
    if (await shouldRequireCaptcha(payload.username)) {
      if (!payload.captchaId || !payload.captchaCode) throw new Error("请输入验证码");
      if (!verifyLoginCaptcha({ captchaId: payload.captchaId, captchaCode: payload.captchaCode })) {
        throw new Error("验证码错误或已过期");
      }
    }
    const result = await login({
      ...payload,
      ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || null,
      userAgent: c.req.header("user-agent") ?? null,
    });
    await recordOperationLog(c, {
      userId: result.user.id,
      username: result.user.username,
      module: "system.auth",
      action: "login",
      resource: "/auth",
      resourceId: result.user.id,
      status: 200,
      success: true,
      details: { username: payload.username, remember: Boolean(payload.remember) },
    });
    return c.json(success(result, "登录成功"));
  } catch (error) {
    await recordOperationLog(c, {
      username: payload.username,
      module: "system.auth",
      action: "login",
      resource: "/auth",
      status: 500,
      success: false,
      message: error instanceof Error ? error.message : String(error),
      details: { username: payload.username, remember: Boolean(payload.remember) },
    });
    throw error;
  }
});

authRoutes.post("/password-reset/request", async (c) => {
  const payload = forgotPasswordSchema.parse(await c.req.json());
  const url = new URL(c.req.url);
  const origin = c.req.header("origin") || `${url.protocol}//${url.host}`;
  const result = await requestPasswordReset({
    account: payload.account,
    origin,
    ip: c.req.header("x-forwarded-for") ?? null,
    userAgent: c.req.header("user-agent") ?? null,
  });
  await recordOperationLog(c, {
    username: payload.account,
    module: "system.auth",
    action: "forgotPassword",
    resource: "/auth",
    status: 200,
    success: true,
    details: {
      account: payload.account,
      requested: result.requested,
      emailSent: result.emailSent,
    },
  });
  return c.json(
    success(
      {
        debugResetToken: result.debugResetToken,
      },
      "如果账号存在且已绑定邮箱，系统会发送密码重置邮件",
    ),
  );
});

authRoutes.post("/password-reset/confirm", async (c) => {
  const payload = resetPasswordSchema.parse(await c.req.json());
  await confirmPasswordReset(payload);
  await recordOperationLog(c, {
    module: "system.auth",
    action: "resetPassword",
    resource: "/auth",
    status: 200,
    success: true,
  });
  return c.json(success(null, "密码已重置，请重新登录"));
});

authRoutes.post("/logout", authRequired(), async (c) => {
  const user = c.get("user");
  await logout(c.get("tokenHash"));
  await recordOperationLog(c, {
    userId: user.id,
    username: user.username,
    module: "system.auth",
    action: "logout",
    resource: "/auth",
    resourceId: user.id,
    status: 200,
    success: true,
  });
  return c.json(success(null, "退出成功"));
});

authRoutes.get("/info", authRequired(), async (c) => {
  const user = c.get("user");
  return c.json(
    success({
      user,
      access: await getUserAccess(user.id),
      dataScope: await resolveDataScopeForUser(user.id),
    }),
  );
});

authRoutes.get("/menu", authRequired(), async (c) => {
  const user = c.get("user");
  return c.json(success(await getUserMenus(user.id)));
});
