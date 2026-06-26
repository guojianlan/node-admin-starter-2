import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { nowIso, sqlite } from "@/server/db";
import { issueUserToken } from "@/server/services/auth-service";
import { sendMail } from "@/server/services/mail-service";
import { decryptSecret } from "@/server/services/secret";
import {
  assertPasswordPolicy,
  recordPasswordHistory,
  revokeUserTokens,
} from "@/server/services/security-policy-service";

const captchaTtlMs = 2 * 60 * 1000;
const resetTokenTtlMs = 30 * 60 * 1000;
const captchaStore = new Map<string, { code: string; expiresAt: number }>();

export type PublicOauthProvider = {
  key: string;
  name: string;
  authUrl: string;
};

type OauthProviderConfig = PublicOauthProvider & {
  enabled?: boolean;
  tokenUrl?: string;
  userInfoUrl?: string;
  clientId?: string;
  clientSecret?: string;
  clientSecretEncrypted?: string;
  scopes?: string[] | string;
  autoCreateUser?: boolean;
  userMapping?: {
    id?: string;
    username?: string;
    email?: string;
    nickname?: string;
  };
};

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function cleanupCaptchaStore() {
  const now = Date.now();
  for (const [id, item] of captchaStore.entries()) {
    if (item.expiresAt <= now) captchaStore.delete(id);
  }
}

function randomCaptchaCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => alphabet[crypto.randomInt(0, alphabet.length)]).join("");
}

function buildCaptchaSvg(code: string) {
  const chars = code
    .split("")
    .map((char, index) => {
      const x = 18 + index * 22;
      const y = 34 + crypto.randomInt(-3, 4);
      const rotate = crypto.randomInt(-12, 13);
      return `<text x="${x}" y="${y}" transform="rotate(${rotate} ${x} ${y})">${char}</text>`;
    })
    .join("");
  const lines = Array.from({ length: 4 }, () => {
    const x1 = crypto.randomInt(4, 106);
    const y1 = crypto.randomInt(8, 40);
    const x2 = crypto.randomInt(4, 106);
    const y2 = crypto.randomInt(8, 40);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="112" height="44" viewBox="0 0 112 44">
<rect width="112" height="44" rx="8" fill="#f4f7fb"/>
<g stroke="#8aa4c7" stroke-width="1" opacity=".55">${lines}</g>
<g fill="#1f2a44" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="2">${chars}</g>
</svg>`;
}

export function createLoginCaptcha() {
  cleanupCaptchaStore();
  const id = crypto.randomUUID();
  const code = randomCaptchaCode();
  captchaStore.set(id, { code, expiresAt: Date.now() + captchaTtlMs });
  const svg = buildCaptchaSvg(code);
  return {
    captchaId: id,
    image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    expiresIn: Math.floor(captchaTtlMs / 1000),
    debugCode: process.env.NODE_ENV === "test" ? code : undefined,
  };
}

export function verifyLoginCaptcha(input: { captchaId?: string; captchaCode?: string }) {
  cleanupCaptchaStore();
  if (!input.captchaId || !input.captchaCode) return false;
  const item = captchaStore.get(input.captchaId);
  captchaStore.delete(input.captchaId);
  if (!item || item.expiresAt <= Date.now()) return false;
  return item.code.toUpperCase() === input.captchaCode.trim().toUpperCase();
}

export async function getPublicOauthProviders() {
  const providers = await getOauthProviderConfigs();
  return providers
    .filter((item) => item.enabled && item.key && item.name && /^https?:\/\//i.test(item.authUrl))
    .map((item) => ({
      key: item.key,
      name: item.name,
      authUrl: `/api/system/oauth/${encodeURIComponent(item.key)}/redirect`,
    }));
}

async function getOauthProviderConfigs() {
  const row = (await sqlite
    .prepare(
      `SELECT "values" AS values
       FROM sys_config_items
       WHERE key = 'login.oauth_providers_json'
         AND status = 1
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get()) as { values: string | null } | undefined;
  if (!row?.values) return [];
  try {
    const parsed = JSON.parse(row.values) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const provider = item as Partial<OauthProviderConfig>;
        return {
          key: String(provider.key || ""),
          name: String(provider.name || provider.key || ""),
          authUrl: String(provider.authUrl || ""),
          tokenUrl: provider.tokenUrl ? String(provider.tokenUrl) : undefined,
          userInfoUrl: provider.userInfoUrl ? String(provider.userInfoUrl) : undefined,
          clientId: provider.clientId ? String(provider.clientId) : undefined,
          clientSecret: provider.clientSecret ? String(provider.clientSecret) : undefined,
          clientSecretEncrypted: provider.clientSecretEncrypted
            ? String(provider.clientSecretEncrypted)
            : undefined,
          scopes: provider.scopes,
          autoCreateUser: Boolean(provider.autoCreateUser),
          userMapping: provider.userMapping,
          enabled: Boolean(provider.enabled),
        };
      })
      .filter((item) => item.key && item.name);
  } catch {
    return [];
  }
}

function readPath(source: unknown, selector?: string) {
  if (!selector) return undefined;
  return selector.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

function providerSecret(provider: OauthProviderConfig) {
  return provider.clientSecretEncrypted
    ? decryptSecret(provider.clientSecretEncrypted)
    : provider.clientSecret;
}

export async function createOauthRedirect(input: {
  providerKey: string;
  origin: string;
  redirect?: string | null;
}) {
  const provider = (await getOauthProviderConfigs()).find(
    (item) => item.key === input.providerKey && item.enabled,
  );
  if (!provider) throw new Error("第三方登录未启用");
  if (!provider.clientId) throw new Error("第三方登录缺少 clientId");
  const state = crypto.randomBytes(24).toString("hex");
  const callbackUrl = `${input.origin.replace(/\/$/, "")}/api/system/oauth/${encodeURIComponent(provider.key)}/callback`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await sqlite
    .prepare(
      "INSERT INTO sys_oauth_state (state, provider, redirect_uri, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(state, provider.key, input.redirect || "/dashboard", expiresAt);
  const url = new URL(provider.authUrl);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  const scopes = Array.isArray(provider.scopes) ? provider.scopes.join(" ") : provider.scopes;
  if (scopes) url.searchParams.set("scope", scopes);
  return url.toString();
}

export async function handleOauthCallback(input: {
  providerKey: string;
  code: string;
  state: string;
  origin: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const stateRow = (await sqlite
    .prepare("SELECT provider, redirect_uri AS redirectUri, expires_at AS expiresAt FROM sys_oauth_state WHERE state = ?")
    .get(input.state)) as { provider: string; redirectUri: string | null; expiresAt: string } | undefined;
  if (!stateRow || stateRow.provider !== input.providerKey) throw new Error("OAuth state 无效");
  if (new Date(stateRow.expiresAt).getTime() <= Date.now()) throw new Error("OAuth state 已过期");
  await sqlite.prepare("DELETE FROM sys_oauth_state WHERE state = ?").run(input.state);

  const provider = (await getOauthProviderConfigs()).find(
    (item) => item.key === input.providerKey && item.enabled,
  );
  if (!provider?.tokenUrl || !provider.userInfoUrl || !provider.clientId) {
    throw new Error("第三方登录配置不完整");
  }
  const secret = providerSecret(provider);
  const callbackUrl = `${input.origin.replace(/\/$/, "")}/api/system/oauth/${encodeURIComponent(provider.key)}/callback`;
  const tokenResponse = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: provider.clientId,
      client_secret: secret || "",
      redirect_uri: callbackUrl,
    }),
  });
  if (!tokenResponse.ok) throw new Error("获取 OAuth access token 失败");
  const tokenPayload = (await tokenResponse.json()) as Record<string, unknown>;
  const accessToken = String(tokenPayload.access_token || "");
  if (!accessToken) throw new Error("OAuth access token 为空");
  const userInfoResponse = await fetch(provider.userInfoUrl, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
  });
  if (!userInfoResponse.ok) throw new Error("获取 OAuth 用户信息失败");
  const profile = (await userInfoResponse.json()) as Record<string, unknown>;
  const mapping = provider.userMapping ?? {};
  const providerUserId = String(readPath(profile, mapping.id || "id") || "");
  const email = readPath(profile, mapping.email || "email");
  const username = readPath(profile, mapping.username || "login") ?? readPath(profile, "username");
  const nickname = readPath(profile, mapping.nickname || "name") ?? username;
  if (!providerUserId) throw new Error("OAuth 用户信息缺少用户 ID");

  const bound = (await sqlite
    .prepare(
      `SELECT u.id
       FROM sys_oauth_account oa
       INNER JOIN sys_user u ON u.id = oa.user_id
       WHERE oa.provider = ? AND oa.provider_user_id = ? AND u.deleted_at IS NULL AND u.status = 1`,
    )
    .get(provider.key, providerUserId)) as { id: number } | undefined;
  let userId = bound?.id ?? 0;
  if (!userId && email) {
    const matched = (await sqlite
      .prepare("SELECT id FROM sys_user WHERE email = ? AND deleted_at IS NULL AND status = 1 LIMIT 1")
      .get(String(email))) as { id: number } | undefined;
    if (matched) userId = matched.id;
  }
  if (!userId && provider.autoCreateUser) {
    const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
    const result = await sqlite
      .prepare(
        `INSERT INTO sys_user (username, password_hash, nickname, email, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, now(), now())
         RETURNING id`,
      )
      .run(`${provider.key}_${providerUserId}`, randomPasswordHash, String(nickname || username || provider.key), email ? String(email) : null);
    userId = Number(result.lastInsertRowid);
  }
  if (!userId) throw new Error("OAuth 账号未绑定本地用户");

  await sqlite
    .prepare(
      `INSERT INTO sys_oauth_account
        (user_id, provider, provider_user_id, provider_username, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, now(), now())
       ON CONFLICT (provider, provider_user_id)
       DO UPDATE SET user_id = excluded.user_id, provider_username = excluded.provider_username, email = excluded.email, updated_at = now()`,
    )
    .run(userId, provider.key, providerUserId, username ? String(username) : null, email ? String(email) : null);

  const issued = await issueUserToken({
    userId,
    name: `oauth:${provider.key}`,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await sqlite
    .prepare(
      `INSERT INTO sys_login_record
        (username, ip, user_agent, status, message, created_at)
       VALUES
        (?, ?, ?, 1, ?, ?)`,
    )
    .run(
      `${provider.key}:${providerUserId}`,
      input.ip ?? null,
      input.userAgent ?? null,
      `OAuth 登录成功：${provider.key}`,
      nowIso(),
    );
  return { token: issued.token, redirectUri: stateRow.redirectUri || "/dashboard", userId };
}

type ResetUserRow = {
  id: number;
  username: string;
  nickname: string;
  email: string | null;
  status: number;
};

export async function requestPasswordReset(input: {
  account: string;
  origin: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const account = input.account.trim();
  const user = (await sqlite
    .prepare(
      `SELECT id, username, nickname, email, status
       FROM sys_user
       WHERE deleted_at IS NULL
         AND status = 1
         AND (username = ? OR email = ? OR mobile = ?)
       LIMIT 1`,
    )
    .get(account, account, account)) as ResetUserRow | undefined;

  if (!user?.email) return { requested: false, emailSent: false, debugResetToken: undefined };

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + resetTokenTtlMs).toISOString();
  await sqlite
    .prepare(
      `INSERT INTO sys_password_reset_token
        (user_id, token_hash, expires_at, ip, user_agent, created_at)
       VALUES
        (?, ?, ?, ?, ?, ?)`,
    )
    .run(user.id, sha256(token), expiresAt, input.ip ?? null, input.userAgent ?? null, nowIso());

  const resetUrl = `${input.origin.replace(/\/$/, "")}/login?resetToken=${encodeURIComponent(token)}`;
  let emailSent = false;
  try {
    await sendMail({
      to: user.email,
      subject: "Admin Base 密码重置",
      text: [
        `${user.nickname || user.username}，你好：`,
        "",
        "你正在重置 Admin Base 登录密码。请在 30 分钟内打开下面的链接完成重置：",
        resetUrl,
        "",
        "如果这不是你本人操作，可以忽略这封邮件。",
      ].join("\n"),
    });
    emailSent = true;
  } catch {
    emailSent = false;
  }

  return {
    requested: true,
    emailSent,
    debugResetToken: process.env.NODE_ENV === "test" ? token : undefined,
  };
}

export async function confirmPasswordReset(input: { token: string; password: string }) {
  const tokenHash = sha256(input.token);
  const row = (await sqlite
    .prepare(
      `SELECT
        t.id,
        t.user_id AS userId,
        t.expires_at AS expiresAt,
        t.used_at AS usedAt,
        u.status AS status
       FROM sys_password_reset_token t
       INNER JOIN sys_user u ON u.id = t.user_id
       WHERE t.token_hash = ?
         AND u.deleted_at IS NULL
       LIMIT 1`,
    )
    .get(tokenHash)) as
    | {
        id: number;
        userId: number;
        expiresAt: string | Date;
        usedAt: string | Date | null;
        status: number | boolean | string;
      }
    | undefined;

  if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new Error("重置链接无效或已过期");
  }
  if (Number(row.status) !== 1) throw new Error("账号已停用");

  await assertPasswordPolicy({ password: input.password, userId: row.userId });
  const passwordHash = await bcrypt.hash(input.password, 10);
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
    .run(passwordHash, row.userId);
  await sqlite
    .prepare("UPDATE sys_password_reset_token SET used_at = now() WHERE id = ?")
    .run(row.id);
  await recordPasswordHistory({ userId: row.userId, passwordHash });
  await revokeUserTokens({ userId: row.userId });
}
