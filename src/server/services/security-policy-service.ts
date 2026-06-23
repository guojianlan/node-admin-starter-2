import bcrypt from "bcryptjs";
import { nowIso, sqlite, type DbClient } from "@/server/db";

const policyDefaults = {
  passwordMinLength: 6,
  passwordRequireUppercase: false,
  passwordRequireLowercase: false,
  passwordRequireNumber: false,
  passwordRequireSymbol: false,
  passwordHistoryCount: 3,
  passwordExpireDays: 0,
  forceChangeOnFirstLogin: false,
  maxFailedAttempts: 5,
  lockMinutes: 15,
  captchaEnabled: false,
  allowMultiSession: true,
  maxOnlineTokens: 0,
  accessTokenTtlDays: 7,
  rememberTtlDays: 30,
  refreshLastUsed: true,
  cleanupExpiredDays: 30,
};

export type SecurityPolicy = typeof policyDefaults;

function toBoolean(value: string | null | undefined, fallback: boolean) {
  if (value == null || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function toNumber(value: string | null | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getSecurityPolicy(dbClient: DbClient = sqlite): Promise<SecurityPolicy> {
  const rows = (await dbClient
    .prepare(
      `SELECT key, "values" AS values
       FROM sys_config_items
       WHERE deleted_at IS NULL
         AND key IN (
           'security.password_min_length',
           'security.password_require_uppercase',
           'security.password_require_lowercase',
           'security.password_require_number',
           'security.password_require_symbol',
           'security.password_history_count',
           'security.password_expire_days',
           'security.force_change_on_first_login',
           'login.max_failed_attempts',
           'login.lock_minutes',
           'login.captcha_enabled',
           'login.allow_multi_session',
           'login.max_online_tokens',
           'token.access_token_ttl_days',
           'token.remember_ttl_days',
           'token.refresh_last_used',
           'token.cleanup_expired_days'
         )`,
    )
    .all()) as Array<{ key: string; values: string | null }>;
  const map = new Map(rows.map((row) => [row.key, row.values]));

  return {
    passwordMinLength: toNumber(
      map.get("security.password_min_length"),
      policyDefaults.passwordMinLength,
    ),
    passwordRequireUppercase: toBoolean(
      map.get("security.password_require_uppercase"),
      policyDefaults.passwordRequireUppercase,
    ),
    passwordRequireLowercase: toBoolean(
      map.get("security.password_require_lowercase"),
      policyDefaults.passwordRequireLowercase,
    ),
    passwordRequireNumber: toBoolean(
      map.get("security.password_require_number"),
      policyDefaults.passwordRequireNumber,
    ),
    passwordRequireSymbol: toBoolean(
      map.get("security.password_require_symbol"),
      policyDefaults.passwordRequireSymbol,
    ),
    passwordHistoryCount: toNumber(
      map.get("security.password_history_count"),
      policyDefaults.passwordHistoryCount,
    ),
    passwordExpireDays: toNumber(
      map.get("security.password_expire_days"),
      policyDefaults.passwordExpireDays,
    ),
    forceChangeOnFirstLogin: toBoolean(
      map.get("security.force_change_on_first_login"),
      policyDefaults.forceChangeOnFirstLogin,
    ),
    maxFailedAttempts: toNumber(
      map.get("login.max_failed_attempts"),
      policyDefaults.maxFailedAttempts,
    ),
    lockMinutes: toNumber(map.get("login.lock_minutes"), policyDefaults.lockMinutes),
    captchaEnabled: toBoolean(map.get("login.captcha_enabled"), policyDefaults.captchaEnabled),
    allowMultiSession: toBoolean(
      map.get("login.allow_multi_session"),
      policyDefaults.allowMultiSession,
    ),
    maxOnlineTokens: toNumber(map.get("login.max_online_tokens"), policyDefaults.maxOnlineTokens),
    accessTokenTtlDays: toNumber(
      map.get("token.access_token_ttl_days"),
      policyDefaults.accessTokenTtlDays,
    ),
    rememberTtlDays: toNumber(map.get("token.remember_ttl_days"), policyDefaults.rememberTtlDays),
    refreshLastUsed: toBoolean(
      map.get("token.refresh_last_used"),
      policyDefaults.refreshLastUsed,
    ),
    cleanupExpiredDays: toNumber(
      map.get("token.cleanup_expired_days"),
      policyDefaults.cleanupExpiredDays,
    ),
  };
}

export async function assertPasswordPolicy(input: {
  password: string;
  userId?: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const policy = await getSecurityPolicy(dbClient);
  if (input.password.length < policy.passwordMinLength) {
    throw new Error(`密码长度不能少于 ${policy.passwordMinLength} 位`);
  }
  if (policy.passwordRequireUppercase && !/[A-Z]/.test(input.password)) {
    throw new Error("密码必须包含大写字母");
  }
  if (policy.passwordRequireLowercase && !/[a-z]/.test(input.password)) {
    throw new Error("密码必须包含小写字母");
  }
  if (policy.passwordRequireNumber && !/\d/.test(input.password)) {
    throw new Error("密码必须包含数字");
  }
  if (policy.passwordRequireSymbol && !/[^\da-zA-Z]/.test(input.password)) {
    throw new Error("密码必须包含特殊字符");
  }

  if (input.userId && policy.passwordHistoryCount > 0) {
    const rows = (await dbClient
      .prepare(
        `SELECT password_hash AS passwordHash
         FROM sys_user_password_history
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(input.userId, policy.passwordHistoryCount)) as Array<{ passwordHash: string }>;
    for (const row of rows) {
      if (await bcrypt.compare(input.password, row.passwordHash)) {
        throw new Error(`不能复用最近 ${policy.passwordHistoryCount} 次使用过的密码`);
      }
    }
  }
}

export async function recordPasswordHistory(input: {
  userId: number;
  passwordHash: string;
  dbClient?: DbClient;
}) {
  await (input.dbClient ?? sqlite)
    .prepare(
      `INSERT INTO sys_user_password_history (user_id, password_hash, created_at)
       VALUES (?, ?, ?)`,
    )
    .run(input.userId, input.passwordHash, nowIso());
}

export async function revokeUserTokens(input: {
  userId: number;
  exceptTokenHash?: string | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  if (input.exceptTokenHash) {
    await dbClient
      .prepare("DELETE FROM sys_access_token WHERE user_id = ? AND token_hash <> ?")
      .run(input.userId, input.exceptTokenHash);
    return;
  }
  await dbClient.prepare("DELETE FROM sys_access_token WHERE user_id = ?").run(input.userId);
}

export async function enforceSessionPolicy(input: {
  userId: number;
  currentTokenHash: string;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const policy = await getSecurityPolicy(dbClient);
  if (!policy.allowMultiSession) {
    await revokeUserTokens({
      userId: input.userId,
      exceptTokenHash: input.currentTokenHash,
      dbClient,
    });
    return;
  }
  if (policy.maxOnlineTokens <= 0) return;
  const rows = (await dbClient
    .prepare(
      `SELECT token_hash AS tokenHash
       FROM sys_access_token
       WHERE user_id = ?
       ORDER BY COALESCE(last_used_at, created_at) DESC, id DESC
       OFFSET ?`,
    )
    .all(input.userId, policy.maxOnlineTokens)) as Array<{ tokenHash: string }>;
  if (!rows.length) return;
  await dbClient
    .prepare(
      `DELETE FROM sys_access_token
       WHERE user_id = ? AND token_hash IN (${rows.map(() => "?").join(", ")})`,
    )
    .run(input.userId, ...rows.map((row) => row.tokenHash));
}

export async function cleanExpiredTokens(dbClient: DbClient = sqlite) {
  const policy = await getSecurityPolicy(dbClient);
  const cutoff = new Date(Date.now() - policy.cleanupExpiredDays * 24 * 60 * 60 * 1000);
  await dbClient
    .prepare("DELETE FROM sys_access_token WHERE expires_at IS NOT NULL AND expires_at < ?")
    .run(cutoff.toISOString());
}
