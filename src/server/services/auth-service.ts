import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { buildTree } from "@/lib/tree";
import { nowIso, sqlite } from "@/server/db";
import type { AdminUserContext } from "@/server/context";

type UserRow = {
  id: number;
  username: string;
  passwordHash: string;
  nickname: string;
  email: string | null;
  mobile: string | null;
  deptId: number | null;
  status: number;
};

type TokenRow = {
  id: number;
  userId: number;
  abilitiesJson: string;
  expiresAt: string | Date | null;
};

type RuleRow = {
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
};

export type LoginInput = {
  username: string;
  password: string;
  remember?: boolean;
  ip?: string | null;
  userAgent?: string | null;
};

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toUserContext(row: UserRow): AdminUserContext {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    email: row.email,
    mobile: row.mobile,
    deptId: row.deptId,
    status: row.status,
  };
}

function parseAbilities(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function isExpired(expiresAt: string | Date | null) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

async function recordLogin(input: {
  username: string;
  ip?: string | null;
  userAgent?: string | null;
  status: number;
  message: string;
}) {
  await sqlite
    .prepare(
      `INSERT INTO sys_login_record
        (username, ip, user_agent, status, message, created_at)
       VALUES
        (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.username,
      input.ip ?? null,
      input.userAgent ?? null,
      input.status,
      input.message,
      nowIso(),
    );
}

export async function getUserById(userId: number) {
  return (await sqlite
    .prepare(
      `SELECT
        id,
        username,
        password_hash AS passwordHash,
        nickname,
        email,
        mobile,
        dept_id AS deptId,
        status
       FROM sys_user
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(userId)) as UserRow | undefined;
}

export async function getUserAccess(userId: number) {
  if (userId === 1) {
    return (
      (await sqlite
        .prepare("SELECT key FROM sys_rule WHERE type = 'action' AND status = 1 ORDER BY key ASC")
        .all()) as Array<{ key: string }>
    ).map((item) => item.key);
  }

  return (
    (await sqlite
      .prepare(
        `SELECT DISTINCT sr.key
         FROM sys_rule sr
         INNER JOIN sys_role_rule srr ON srr.rule_id = sr.id
         INNER JOIN sys_user_role sur ON sur.role_id = srr.role_id
         INNER JOIN sys_role role ON role.id = sur.role_id
         WHERE sur.user_id = ?
           AND role.status = 1
           AND role.deleted_at IS NULL
           AND sr.type = 'action'
           AND sr.status = 1
         ORDER BY sr.key ASC`,
      )
      .all(userId)) as Array<{ key: string }>
  ).map((item) => item.key);
}

export async function getUserMenus(userId: number) {
  const sql =
    userId === 1
      ? `SELECT
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
         WHERE type IN ('menu', 'route', 'nested') AND status = 1
         ORDER BY "order" ASC, id ASC`
      : `SELECT DISTINCT
          sr.id,
          sr.parent_id AS parentId,
          sr.type,
          sr.key,
          sr.name,
          sr.path,
          sr.icon,
          sr."order",
          sr.status,
          sr.hidden,
          sr.link
         FROM sys_rule sr
         INNER JOIN sys_role_rule srr ON srr.rule_id = sr.id
         INNER JOIN sys_user_role sur ON sur.role_id = srr.role_id
         INNER JOIN sys_role role ON role.id = sur.role_id
         WHERE sur.user_id = ?
           AND role.status = 1
           AND role.deleted_at IS NULL
           AND sr.type IN ('menu', 'route', 'nested')
           AND sr.status = 1
         ORDER BY sr."order" ASC, sr.id ASC`;

  const rows =
    userId === 1
      ? ((await sqlite.prepare(sql).all()) as RuleRow[])
      : ((await sqlite.prepare(sql).all(userId)) as RuleRow[]);

  return buildTree(rows);
}

export async function login(input: LoginInput) {
  const user = (await sqlite
    .prepare(
      `SELECT
        id,
        username,
        password_hash AS passwordHash,
        nickname,
        email,
        mobile,
        dept_id AS deptId,
        status
       FROM sys_user
       WHERE username = ? AND deleted_at IS NULL`,
    )
    .get(input.username)) as UserRow | undefined;

  if (!user) {
    await recordLogin({ ...input, status: 0, message: "账号不存在" });
    throw new Error("账号或密码错误");
  }

  const passwordMatched = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatched) {
    await recordLogin({ ...input, status: 0, message: "密码错误" });
    throw new Error("账号或密码错误");
  }

  if (user.status !== 1) {
    await recordLogin({ ...input, status: 0, message: "账号已停用" });
    throw new Error("账号已停用");
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const access = await getUserAccess(user.id);
  const now = nowIso();
  const ttlDays = Number(process.env.ADMIN_BASE_TOKEN_TTL_DAYS ?? 7);
  const expiresAt = input.remember
    ? null
    : new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  await sqlite
    .prepare(
      `INSERT INTO sys_access_token
        (user_id, name, token_hash, abilities_json, last_used_at, expires_at, created_at, updated_at)
       VALUES
        (?, 'web', ?, ?, ?, ?, ?, ?)`,
    )
    .run(user.id, tokenHash, JSON.stringify(access), now, expiresAt, now, now);

  await sqlite
    .prepare("UPDATE sys_user SET login_ip = ?, login_time = ?, updated_at = ? WHERE id = ?")
    .run(input.ip ?? null, now, now, user.id);

  await recordLogin({ ...input, status: 1, message: "登录成功" });

  return {
    token,
    user: toUserContext(user),
    access,
  };
}

export async function resolveToken(token: string) {
  const tokenHash = hashToken(token);
  const tokenRow = (await sqlite
    .prepare(
      `SELECT
        id,
        user_id AS userId,
        abilities_json AS abilitiesJson,
        expires_at AS expiresAt
       FROM sys_access_token
       WHERE token_hash = ?`,
    )
    .get(tokenHash)) as TokenRow | undefined;

  if (!tokenRow || isExpired(tokenRow.expiresAt)) return null;

  const user = await getUserById(tokenRow.userId);
  if (!user || user.status !== 1) return null;

  await sqlite
    .prepare("UPDATE sys_access_token SET last_used_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), tokenRow.id);

  return {
    tokenHash,
    user: toUserContext(user),
    abilities: parseAbilities(tokenRow.abilitiesJson),
  };
}

export async function logout(tokenHash: string) {
  await sqlite.prepare("DELETE FROM sys_access_token WHERE token_hash = ?").run(tokenHash);
}
