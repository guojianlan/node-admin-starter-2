import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/server/app";
import { nowIso } from "@/server/db";
import { resetTestDatabase, sqlite } from "../helpers/db";

type ApiResponse<T = unknown> = {
  success: boolean;
  msg: string;
  data?: T;
};

type Page<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

type OperationLogRow = {
  id: number;
  userId: number | null;
  username: string | null;
  module: string;
  action: string;
  resource: string | null;
  resourceId: string | null;
  method: string;
  path: string;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  status: number;
  success: boolean;
  message: string | null;
  detailsJson: string | null;
};

async function readJson<T = unknown>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

async function login(username = "admin", password = "123456") {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await readJson<{ token: string }>(response);
  return String(body.data?.token ?? "");
}

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function createDictQueryOnlyUser() {
  const now = nowIso();
  const passwordHash = await bcrypt.hash("123456", 10);
  const roleResult = await sqlite
    .prepare(
      `INSERT INTO sys_role
        (name, code, remark, sort, status, created_at, updated_at)
       VALUES
        ('字典查询员', 'dict_query_only', '', 20, 1, ?, ?)
       RETURNING id`,
    )
    .run(now, now);
  const roleId = Number(roleResult.lastInsertRowid);
  const ruleIds = (
    (await sqlite
      .prepare(
        `SELECT id FROM sys_rule
         WHERE key IN ('system', 'system.dict', 'system.dict.query')
         ORDER BY id ASC`,
      )
      .all()) as Array<{ id: number }>
  ).map((item) => item.id);
  for (const ruleId of ruleIds) {
    await sqlite
      .prepare("INSERT INTO sys_role_rule (role_id, rule_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
      .run(roleId, ruleId);
  }

  await sqlite
    .prepare(
      `INSERT INTO sys_user
        (username, password_hash, nickname, sex, dept_id, status, created_at, updated_at)
       VALUES
        ('dictviewer', ?, '字典查询员', 0, 1, 1, ?, ?)
       RETURNING id`,
    )
    .run(passwordHash, now, now);
  await sqlite
    .prepare(
      "INSERT INTO sys_user_role (user_id, role_id) VALUES ((SELECT id FROM sys_user WHERE username = ?), ?)",
    )
    .run("dictviewer", roleId);
}

async function latestOperationLog(module: string, action: string) {
  return (await sqlite
    .prepare(
      `SELECT
        id,
        user_id AS userId,
        username,
        module,
        action,
        resource,
        resource_id AS resourceId,
        method,
        path,
        ip,
        user_agent AS userAgent,
        request_id AS requestId,
        status,
        success,
        message,
        details_json AS detailsJson
       FROM sys_operation_log
       WHERE module = ? AND action = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(module, action)) as OperationLogRow | undefined;
}

describe("operation log", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("records successful CRUD mutations with request context", async () => {
    const token = await login();

    const response = await app.request("/api/system/dict/list", {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "x-request-id": "operation-log-create",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        "user-agent": "operation-log-test",
      },
      body: JSON.stringify({
        name: "操作日志字典",
        code: "operation_log_dict",
        status: 1,
        sort: 30,
      }),
    });

    expect(response.status).toBe(200);

    const log = await latestOperationLog("system.dict", "create");
    expect(log).toMatchObject({
      userId: 1,
      username: "admin",
      module: "system.dict",
      action: "create",
      resource: "/dict/list",
      method: "POST",
      path: "/api/system/dict/list",
      ip: "203.0.113.10",
      userAgent: "operation-log-test",
      requestId: "operation-log-create",
      status: 200,
      success: true,
    });
    expect(JSON.parse(String(log?.detailsJson))).toMatchObject({
      fields: expect.arrayContaining(["name", "code", "status", "sort"]),
    });
  });

  it("records failed explicit operations", async () => {
    const token = await login();

    const response = await app.request("/api/system/rule/status/1", {
      method: "PUT",
      headers: {
        ...authHeaders(token),
        "x-request-id": "operation-log-failure",
      },
      body: JSON.stringify({ status: 0 }),
    });
    const body = await readJson(response);

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);

    const log = await latestOperationLog("system.rule", "status");
    expect(log).toMatchObject({
      userId: 1,
      username: "admin",
      resource: "/rule",
      resourceId: "1",
      requestId: "operation-log-failure",
      status: 500,
      success: false,
    });
    expect(log?.message).toContain("系统内置权限不能停用");
  });

  it("exposes operation logs only to users with operation log permission", async () => {
    const adminToken = await login();

    await app.request("/api/system/dict/list", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        name: "操作日志查询",
        code: "operation_log_query",
        status: 1,
        sort: 31,
      }),
    });

    const list = await app.request(
      "/api/system/operation/log?page=1&pageSize=10&module=system.dict&action=create",
      { headers: { authorization: `Bearer ${adminToken}` } },
    );
    const listBody = await readJson<Page<OperationLogRow>>(list);

    expect(list.status).toBe(200);
    expect(listBody.data?.data).toEqual([
      expect.objectContaining({
        module: "system.dict",
        action: "create",
        success: true,
      }),
    ]);

    await createDictQueryOnlyUser();
    const limitedToken = await login("dictviewer", "123456");
    const denied = await app.request("/api/system/operation/log", {
      headers: { authorization: `Bearer ${limitedToken}` },
    });
    expect(denied.status).toBe(403);
  });

  it("records login and logout events", async () => {
    const failedLogin = await app.request("/api/system/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "operation-log-login-failed",
      },
      body: JSON.stringify({ username: "admin", password: "wrong-password" }),
    });
    expect(failedLogin.status).toBe(500);

    const failedLog = await latestOperationLog("system.auth", "login");
    expect(failedLog).toMatchObject({
      username: "admin",
      requestId: "operation-log-login-failed",
      success: false,
      status: 500,
    });
    expect(failedLog?.message).toBe("账号或密码错误");

    const loginResponse = await app.request("/api/system/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "operation-log-login-success",
      },
      body: JSON.stringify({ username: "admin", password: "123456" }),
    });
    const loginBody = await readJson<{ token: string }>(loginResponse);
    expect(loginResponse.status).toBe(200);

    const successLog = await latestOperationLog("system.auth", "login");
    expect(successLog).toMatchObject({
      userId: 1,
      username: "admin",
      requestId: "operation-log-login-success",
      success: true,
      status: 200,
    });

    const logout = await app.request("/api/system/logout", {
      method: "POST",
      headers: {
        authorization: `Bearer ${loginBody.data?.token}`,
        "x-request-id": "operation-log-logout",
      },
    });
    expect(logout.status).toBe(200);

    const logoutLog = await latestOperationLog("system.auth", "logout");
    expect(logoutLog).toMatchObject({
      userId: 1,
      username: "admin",
      requestId: "operation-log-logout",
      success: true,
      status: 200,
    });
  });
});
