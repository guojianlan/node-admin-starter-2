import { beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { app } from "@/server/app";
import { nowIso } from "@/server/db";
import { resetTestDatabase, sqlite } from "../helpers/db";

type TestResponse = {
  success: boolean;
  msg: string;
  data?: Record<string, unknown>;
};

async function readJson(response: Response) {
  return (await response.json()) as TestResponse;
}

async function login(username = "admin", password = "123456") {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await readJson(response);
  return { response, body, token: String(body.data?.token ?? "") };
}

describe("auth and permission API", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("logs in, returns token, info and menu for super admin", async () => {
    const { response, body, token } = await login();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(token).toHaveLength(64);

    const info = await app.request("/api/system/info", {
      headers: { authorization: `Bearer ${token}` },
    });
    const infoBody = await readJson(info);
    expect(info.status).toBe(200);
    expect(infoBody.data?.user).toMatchObject({ username: "admin" });

    const menu = await app.request("/api/system/menu", {
      headers: { authorization: `Bearer ${token}` },
    });
    const menuBody = await readJson(menu);
    expect(menu.status).toBe(200);
    expect(JSON.stringify(menuBody.data)).toContain("/system/user");
  });

  it("rejects protected APIs without token", async () => {
    const response = await app.request("/api/system/user");
    const body = await readJson(response);

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it("returns 403 when token abilities do not include the API permission", async () => {
    const now = nowIso();
    const passwordHash = await bcrypt.hash("123456", 10);
    sqlite
      .prepare(
        `INSERT INTO sys_user
          (username, password_hash, nickname, sex, dept_id, status, created_at, updated_at)
         VALUES
          ('viewer', ?, '只读用户', 0, 1, 1, ?, ?)`,
      )
      .run(passwordHash, now, now);

    const { token } = await login("viewer", "123456");
    const response = await app.request("/api/system/user", {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await readJson(response);

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
    expect(body.msg).toBe("No Permission");
  });

  it("lists users with URL query pagination, keyword, filter and sort", async () => {
    const { token } = await login();
    const keyword = encodeURIComponent("admin@xinadmin.test");
    const response = await app.request(
      `/api/system/user?page=1&pageSize=20&keyword=${keyword}&status=1&sort=createdAt.desc`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    const body = await readJson(response);
    const data = body.data as unknown as { data: Array<{ username: string }>; total: number };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(data.total).toBe(1);
    expect(data.data[0]?.username).toBe("admin");
  });

  it("applies role authorization to menus and APIs", async () => {
    const now = nowIso();
    const passwordHash = await bcrypt.hash("123456", 10);
    const roleResult = sqlite
      .prepare(
        `INSERT INTO sys_role
          (name, code, remark, sort, status, created_at, updated_at)
         VALUES
          ('用户查询员', 'user_viewer', '', 10, 1, ?, ?)`,
      )
      .run(now, now);
    const roleId = Number(roleResult.lastInsertRowid);
    const ruleIds = (
      sqlite
        .prepare(
          `SELECT id FROM sys_rule
           WHERE key IN ('system', 'system.user', 'system.user.query')
           ORDER BY id ASC`,
        )
        .all() as Array<{ id: number }>
    ).map((item) => item.id);
    const insertRoleRule = sqlite.prepare(
      "INSERT INTO sys_role_rule (role_id, rule_id) VALUES (?, ?)",
    );
    ruleIds.forEach((ruleId) => insertRoleRule.run(roleId, ruleId));

    const userResult = sqlite
      .prepare(
        `INSERT INTO sys_user
          (username, password_hash, nickname, sex, dept_id, status, created_at, updated_at)
         VALUES
          ('viewer', ?, '用户查询员', 0, 1, 1, ?, ?)`,
      )
      .run(passwordHash, now, now);
    sqlite
      .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)")
      .run(Number(userResult.lastInsertRowid), roleId);

    const { token } = await login("viewer", "123456");
    const menu = await app.request("/api/system/menu", {
      headers: { authorization: `Bearer ${token}` },
    });
    const menuBody = await readJson(menu);
    expect(JSON.stringify(menuBody.data)).toContain("/system/user");
    expect(JSON.stringify(menuBody.data)).not.toContain("/system/role");

    const users = await app.request("/api/system/user", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(users.status).toBe(200);

    const roles = await app.request("/api/system/role", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(roles.status).toBe(403);
  });

  it("uploads, lists, downloads and deletes local files", async () => {
    const { token } = await login();
    const form = new FormData();
    form.append("file", new File(["hello admin"], "hello.txt", { type: "text/plain" }));

    const upload = await app.request("/api/system/file/list/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    const uploadBody = await readJson(upload);
    const fileId = Number(uploadBody.data?.id);
    expect(upload.status).toBe(200);
    expect(fileId).toBeGreaterThan(0);

    const list = await app.request("/api/system/file/list?keyword=hello", {
      headers: { authorization: `Bearer ${token}` },
    });
    const listBody = await readJson(list);
    expect(JSON.stringify(listBody.data)).toContain("hello.txt");

    const download = await app.request(`/api/system/file/list/download/${fileId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("hello admin");

    const deleteResponse = await app.request(`/api/system/file/list/${fileId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteResponse.status).toBe(200);
  });
});
