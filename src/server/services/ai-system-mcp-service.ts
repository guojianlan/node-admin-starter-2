import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { buildTree } from "@/lib/tree";
import { sqlite } from "@/server/db";
import { getUserAccess, getUserById, getUserMenus } from "./auth-service";
import { decryptSecret } from "./secret";

export const INTERNAL_SYSTEM_MCP_CODE = "admin-base-system";
export const INTERNAL_SYSTEM_MCP_AGENT_CODE = "system-data-inspector";

type InternalTokenType = "access" | "refresh";
type InternalTokenPayload = {
  serverId: number;
  type: InternalTokenType;
  exp: number;
};

type InternalServerCredential = {
  id: number;
  clientId: string;
  clientSecretEncrypted: string;
  status: string;
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type MenuRow = {
  id: number;
  parentId: number;
  type: "menu" | "route" | "nested";
  key: string;
  name: string;
  path: string | null;
  icon: string | null;
  order: number;
  status: number;
  hidden: number;
  link: number;
};

const pageInputSchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  includeHidden: z.boolean().optional().default(true),
  includeDisabled: z.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(200).optional().default(100),
});

const menuInputSchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  includeHidden: z.boolean().optional().default(true),
  includeDisabled: z.boolean().optional().default(false),
});

const roleInputSchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  includeDisabled: z.boolean().optional().default(false),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

const personnelInputSchema = z.object({
  keyword: z.string().trim().max(100).optional(),
  deptId: z.coerce.number().int().positive().optional(),
  status: z.coerce.number().int().min(0).max(1).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const internalTools = [
  {
    name: "get_system_overview",
    title: "系统概览",
    description: "汇总当前后台页面、菜单、权限、用户、角色和部门数量。只返回统计和模块分布。",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "list_pages",
    title: "查询后台页面",
    description: "从 sys_rule 查询真实后台页面、路径、权限键、所属菜单和启停状态。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        keyword: { type: "string", description: "按页面名称、路径或权限键搜索" },
        includeHidden: {
          type: "boolean",
          default: true,
          description: "默认包含用于菜单组织的隐藏路由节点；传 false 才过滤",
        },
        includeDisabled: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
      },
    },
  },
  {
    name: "list_menu_tree",
    title: "查询菜单树",
    description: "查询全局菜单树，或传入 userId 查看该用户基于角色权限得到的有效菜单。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        userId: { type: "integer", minimum: 1, description: "可选，查看指定用户的有效菜单" },
        includeHidden: {
          type: "boolean",
          default: true,
          description: "默认包含用于菜单组织的隐藏节点；传 false 才过滤",
        },
        includeDisabled: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "list_roles_and_permissions",
    title: "查询角色权限",
    description: "查询角色、数据范围和已分配的菜单/操作权限，不返回任何认证凭据。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        keyword: { type: "string", description: "按角色名称或编码搜索" },
        includeDisabled: { type: "boolean", default: false },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
    },
  },
  {
    name: "list_personnel",
    title: "查询人员组织",
    description:
      "分页查询用户、部门和角色，仅返回后台管理所需身份字段；不会返回密码、Token、手机号或邮箱。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        keyword: { type: "string", description: "按用户名或昵称搜索" },
        deptId: { type: "integer", minimum: 1 },
        status: { type: "integer", enum: [0, 1] },
        page: { type: "integer", minimum: 1, default: 1 },
        pageSize: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
    },
  },
] as const;

function encodeTokenPart(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function tokenSignature(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createInternalToken(
  server: InternalServerCredential,
  type: InternalTokenType,
  ttlSeconds: number,
) {
  const secret = decryptSecret(server.clientSecretEncrypted);
  if (!secret) throw new HTTPException(409, { message: "内置 MCP Client Secret 不可用" });
  const encoded = encodeTokenPart({
    serverId: server.id,
    type,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  } satisfies InternalTokenPayload);
  return `${encoded}.${tokenSignature(encoded, secret)}`;
}

function safeSecretEqual(left: string, right: string) {
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

async function getInternalServerByClientId(clientId: string) {
  return (await sqlite
    .prepare(
      `SELECT id, client_id AS "clientId", client_secret_encrypted AS "clientSecretEncrypted",
       status FROM sys_ai_mcp_server
       WHERE code = ? AND client_id = ? AND oauth_mode = 'client_credentials'
         AND deleted_at IS NULL LIMIT 1`,
    )
    .get(INTERNAL_SYSTEM_MCP_CODE, clientId)) as InternalServerCredential | undefined;
}

async function getInternalServerById(serverId: number) {
  return (await sqlite
    .prepare(
      `SELECT id, client_id AS "clientId", client_secret_encrypted AS "clientSecretEncrypted",
       status FROM sys_ai_mcp_server
       WHERE id = ? AND code = ? AND oauth_mode = 'client_credentials'
         AND deleted_at IS NULL LIMIT 1`,
    )
    .get(serverId, INTERNAL_SYSTEM_MCP_CODE)) as InternalServerCredential | undefined;
}

async function verifyInternalToken(raw: string, expectedType: InternalTokenType) {
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) throw new HTTPException(401, { message: "MCP Token 无效" });
  let payload: InternalTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as InternalTokenPayload;
  } catch {
    throw new HTTPException(401, { message: "MCP Token 无效" });
  }
  const server = await getInternalServerById(Number(payload.serverId));
  const secret = decryptSecret(server?.clientSecretEncrypted);
  if (!server || server.status !== "active" || !secret) {
    throw new HTTPException(401, { message: "内置 MCP Server 未启用" });
  }
  const expected = tokenSignature(encoded, secret);
  if (!safeSecretEqual(signature, expected)) {
    throw new HTTPException(401, { message: "MCP Token 签名无效" });
  }
  if (payload.type !== expectedType || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new HTTPException(401, { message: "MCP Token 已过期或类型不匹配" });
  }
  return server;
}

export async function issueInternalSystemMcpToken(input: {
  grantType: string;
  clientId: string;
  clientSecret: string;
  refreshToken?: string | null;
}) {
  const server = await getInternalServerByClientId(input.clientId);
  const storedSecret = decryptSecret(server?.clientSecretEncrypted);
  if (!server || server.status !== "active" || !storedSecret) {
    throw new HTTPException(401, { message: "MCP Client 无效" });
  }
  if (!safeSecretEqual(input.clientSecret, storedSecret)) {
    throw new HTTPException(401, { message: "MCP Client 无效" });
  }
  if (input.grantType === "refresh_token") {
    if (!input.refreshToken) throw new HTTPException(400, { message: "缺少 refresh_token" });
    await verifyInternalToken(input.refreshToken, "refresh");
  } else if (input.grantType !== "client_credentials") {
    throw new HTTPException(400, { message: "不支持该 OAuth grant_type" });
  }
  return {
    access_token: createInternalToken(server, "access", 60 * 60),
    refresh_token: createInternalToken(server, "refresh", 30 * 24 * 60 * 60),
    token_type: "Bearer",
    expires_in: 60 * 60,
    scope: "system.read",
  };
}

async function assertInternalMcpUser(userId: number) {
  const user = await getUserById(userId);
  if (!user || user.status !== 1) throw new HTTPException(403, { message: "MCP 调用用户不可用" });
  const abilities = await getUserAccess(userId);
  if (!abilities.includes("system.aiGovernance.query")) {
    throw new HTTPException(403, { message: "缺少 system.aiGovernance.query 权限" });
  }
}

async function getSystemOverview() {
  const overview = (await sqlite
    .prepare(
      `SELECT
       (SELECT COUNT(*)::int FROM sys_rule WHERE type IN ('route', 'nested') AND deleted_at IS NULL) AS "pageCount",
       (SELECT COUNT(*)::int FROM sys_rule WHERE type IN ('menu', 'route', 'nested') AND deleted_at IS NULL) AS "menuNodeCount",
       (SELECT COUNT(*)::int FROM sys_rule WHERE type = 'action' AND deleted_at IS NULL) AS "permissionCount",
       (SELECT COUNT(*)::int FROM sys_user WHERE deleted_at IS NULL) AS "userCount",
       (SELECT COUNT(*)::int FROM sys_user WHERE status = 1 AND deleted_at IS NULL) AS "activeUserCount",
       (SELECT COUNT(*)::int FROM sys_role WHERE deleted_at IS NULL) AS "roleCount",
       (SELECT COUNT(*)::int FROM sys_dept WHERE deleted_at IS NULL) AS "departmentCount"`,
    )
    .get()) as Record<string, number>;
  const modules = await sqlite
    .prepare(
      `SELECT split_part(key, '.', 1) AS module, COUNT(*)::int AS total
       FROM sys_rule WHERE type = 'action' AND deleted_at IS NULL
       GROUP BY split_part(key, '.', 1) ORDER BY total DESC, module ASC`,
    )
    .all();
  return { generatedAt: new Date().toISOString(), ...overview, permissionModules: modules };
}

async function listSystemPages(raw: Record<string, unknown>) {
  const input = pageInputSchema.parse(raw);
  const where = ["rule.type IN ('route', 'nested')", "rule.deleted_at IS NULL"];
  const params: Array<string | number> = [];
  if (!input.includeHidden) where.push("rule.hidden = 0");
  if (!input.includeDisabled) where.push("rule.status = 1");
  if (input.keyword) {
    where.push("(rule.name ILIKE ? OR rule.path ILIKE ? OR rule.key ILIKE ?)");
    const keyword = `%${input.keyword}%`;
    params.push(keyword, keyword, keyword);
  }
  return sqlite
    .prepare(
      `SELECT rule.id, rule.name, rule.key AS "permissionKey", rule.path, rule.type,
       rule.parent_id AS "parentId", parent.name AS "parentName", rule.component,
       rule.status, rule.hidden, rule."order"
       FROM sys_rule rule LEFT JOIN sys_rule parent ON parent.id = rule.parent_id
       WHERE ${where.join(" AND ")}
       ORDER BY COALESCE(parent."order", 0), rule."order", rule.id LIMIT ?`,
    )
    .all(...params, input.limit);
}

async function listSystemMenuTree(raw: Record<string, unknown>) {
  const input = menuInputSchema.parse(raw);
  if (input.userId && !input.includeHidden && !input.includeDisabled) {
    const user = await getUserById(input.userId);
    if (!user) throw new HTTPException(404, { message: "用户不存在" });
    return {
      userId: input.userId,
      userName: user.nickname,
      tree: await getUserMenus(input.userId),
    };
  }
  const where = ["type IN ('menu', 'route', 'nested')", "deleted_at IS NULL"];
  if (!input.includeHidden) where.push("hidden = 0");
  if (!input.includeDisabled) where.push("status = 1");
  const rows = (await sqlite
    .prepare(
      `SELECT id, parent_id AS "parentId", type, key, name, path, icon, "order", status, hidden, link
       FROM sys_rule WHERE ${where.join(" AND ")} ORDER BY "order", id`,
    )
    .all()) as MenuRow[];
  return { userId: null, tree: buildTree(rows) };
}

async function listRolesAndPermissions(raw: Record<string, unknown>) {
  const input = roleInputSchema.parse(raw);
  const where = ["deleted_at IS NULL"];
  const params: Array<string | number> = [];
  if (!input.includeDisabled) where.push("status = 1");
  if (input.keyword) {
    where.push("(name ILIKE ? OR code ILIKE ?)");
    const keyword = `%${input.keyword}%`;
    params.push(keyword, keyword);
  }
  const roles = (await sqlite
    .prepare(
      `SELECT id, name, code, data_scope AS "dataScope", status, is_system AS "isSystem"
       FROM sys_role WHERE ${where.join(" AND ")} ORDER BY sort, id LIMIT ?`,
    )
    .all(...params, input.limit)) as Array<Record<string, unknown> & { id: number }>;
  const roleIds = roles.map((role) => role.id);
  if (!roleIds.length) return { roles: [] };
  const permissions = (await sqlite
    .prepare(
      `SELECT relation.role_id AS "roleId", rule.type, rule.key, rule.name, rule.path
       FROM sys_role_rule relation INNER JOIN sys_rule rule ON rule.id = relation.rule_id
       WHERE relation.role_id IN (${roleIds.map(() => "?").join(", ")})
         AND rule.deleted_at IS NULL ORDER BY relation.role_id, rule.type, rule.key`,
    )
    .all(...roleIds)) as Array<{ roleId: number } & Record<string, unknown>>;
  return {
    roles: roles.map((role) => ({
      ...role,
      permissions: permissions
        .filter((permission) => permission.roleId === role.id)
        .map(({ roleId, ...permission }) => {
          void roleId;
          return permission;
        }),
    })),
  };
}

async function listPersonnel(raw: Record<string, unknown>) {
  const input = personnelInputSchema.parse(raw);
  const where = ["user_account.deleted_at IS NULL"];
  const params: Array<string | number> = [];
  if (input.keyword) {
    where.push("(user_account.username ILIKE ? OR user_account.nickname ILIKE ?)");
    const keyword = `%${input.keyword}%`;
    params.push(keyword, keyword);
  }
  if (input.deptId) {
    where.push("user_account.dept_id = ?");
    params.push(input.deptId);
  }
  if (input.status !== undefined) {
    where.push("user_account.status = ?");
    params.push(input.status);
  }
  const totalRow = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total FROM sys_user user_account WHERE ${where.join(" AND ")}`,
    )
    .get(...params)) as { total: number };
  const users = (await sqlite
    .prepare(
      `SELECT user_account.id, user_account.username, user_account.nickname,
       user_account.dept_id AS "deptId", dept.name AS "deptName", user_account.status,
       user_account.is_system AS "isSystem", user_account.created_at AS "createdAt"
       FROM sys_user user_account LEFT JOIN sys_dept dept ON dept.id = user_account.dept_id
       WHERE ${where.join(" AND ")} ORDER BY user_account.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, input.pageSize, (input.page - 1) * input.pageSize)) as Array<
    Record<string, unknown> & { id: number }
  >;
  const userIds = users.map((user) => user.id);
  const assignments = userIds.length
    ? ((await sqlite
        .prepare(
          `SELECT relation.user_id AS "userId", role.id, role.name, role.code,
           role.data_scope AS "dataScope"
           FROM sys_user_role relation INNER JOIN sys_role role ON role.id = relation.role_id
           WHERE relation.user_id IN (${userIds.map(() => "?").join(", ")})
             AND role.deleted_at IS NULL ORDER BY relation.user_id, role.sort, role.id`,
        )
        .all(...userIds)) as Array<{ userId: number } & Record<string, unknown>>)
    : [];
  return {
    page: input.page,
    pageSize: input.pageSize,
    total: Number(totalRow.total),
    users: users.map((user) => ({
      ...user,
      roles: assignments
        .filter((assignment) => assignment.userId === user.id)
        .map(({ userId, ...role }) => {
          void userId;
          return role;
        }),
    })),
  };
}

async function executeInternalTool(name: string, raw: Record<string, unknown>) {
  if (name === "get_system_overview") return getSystemOverview();
  if (name === "list_pages") return listSystemPages(raw);
  if (name === "list_menu_tree") return listSystemMenuTree(raw);
  if (name === "list_roles_and_permissions") return listRolesAndPermissions(raw);
  if (name === "list_personnel") return listPersonnel(raw);
  throw new HTTPException(404, { message: `内置 MCP Tool ${name} 不存在` });
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export async function handleInternalSystemMcpRpc(input: {
  authorization?: string | null;
  userId?: number | null;
  payload: JsonRpcRequest;
}) {
  const token = input.authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HTTPException(401, { message: "缺少 MCP Bearer Token" });
  await verifyInternalToken(token, "access");
  const userId = Number(input.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new HTTPException(401, { message: "缺少 MCP 调用用户" });
  }
  await assertInternalMcpUser(userId);

  if (input.payload.method === "initialize") {
    return rpcResult(input.payload.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "admin-base-system", version: "1.0.0" },
    });
  }
  if (input.payload.method === "notifications/initialized") return null;
  if (input.payload.method === "ping") return rpcResult(input.payload.id, {});
  if (input.payload.method === "tools/list") {
    return rpcResult(input.payload.id, { tools: internalTools });
  }
  if (input.payload.method === "tools/call") {
    const params = z
      .object({
        name: z.string().min(1),
        arguments: z.record(z.string(), z.unknown()).optional().default({}),
      })
      .parse(input.payload.params ?? {});
    const data = await executeInternalTool(params.name, params.arguments);
    return rpcResult(input.payload.id, {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: data,
      isError: false,
    });
  }
  return {
    jsonrpc: "2.0",
    id: input.payload.id ?? null,
    error: { code: -32601, message: `Method not found: ${input.payload.method ?? "unknown"}` },
  };
}
