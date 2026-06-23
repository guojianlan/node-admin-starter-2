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

  it("requires captcha when login captcha policy is enabled", async () => {
    await sqlite
      .prepare("UPDATE sys_config_items SET values = 'true' WHERE key = 'login.captcha_enabled'")
      .run();

    const options = await app.request("/api/system/login/options");
    const optionsBody = await readJson(options);
    expect(options.status).toBe(200);
    expect(optionsBody.data).toMatchObject({ captchaEnabled: true });

    const missingCaptcha = await app.request("/api/system/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "123456" }),
    });
    const missingCaptchaBody = await readJson(missingCaptcha);
    expect(missingCaptcha.status).toBe(500);
    expect(missingCaptchaBody.msg).toContain("验证码");

    const captcha = await app.request("/api/system/login/captcha");
    const captchaBody = await readJson(captcha);
    const captchaData = captchaBody.data as {
      captchaId: string;
      debugCode: string;
      image: string;
    };
    expect(captchaData.image).toContain("data:image/svg+xml;base64,");

    const response = await app.request("/api/system/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: "123456",
        captchaId: captchaData.captchaId,
        captchaCode: captchaData.debugCode,
      }),
    });
    const body = await readJson(response);
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(String(body.data?.token ?? "")).toHaveLength(64);
  });

  it("exposes only configured OAuth providers on login options", async () => {
    const emptyOptions = await app.request("/api/system/login/options");
    const emptyBody = await readJson(emptyOptions);
    expect(emptyOptions.status).toBe(200);
    expect(emptyBody.data?.oauthProviders).toEqual([]);

    await sqlite
      .prepare("UPDATE sys_config_items SET values = ? WHERE key = 'login.oauth_providers_json'")
      .run(
        JSON.stringify([
          {
            key: "github",
            name: "GitHub",
            enabled: true,
            authUrl: "https://github.com/login/oauth/authorize?client_id=test",
          },
          {
            key: "wechat",
            name: "微信",
            enabled: false,
            authUrl: "https://example.com/wechat",
          },
          {
            key: "bad",
            name: "Bad",
            enabled: true,
            authUrl: "/local-only",
          },
        ]),
      );

    const options = await app.request("/api/system/login/options");
    const body = await readJson(options);
    expect(options.status).toBe(200);
    expect(body.data?.oauthProviders).toEqual([
      {
        key: "github",
        name: "GitHub",
        authUrl: "https://github.com/login/oauth/authorize?client_id=test",
      },
    ]);
  });

  it("requests and confirms password reset", async () => {
    const request = await app.request("/api/system/password-reset/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
      },
      body: JSON.stringify({ account: "admin" }),
    });
    const requestBody = await readJson(request);
    expect(request.status).toBe(200);
    const resetToken = String(requestBody.data?.debugResetToken ?? "");
    expect(resetToken.length).toBeGreaterThan(20);

    const confirm = await app.request("/api/system/password-reset/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: resetToken, password: "reset-password-123" }),
    });
    const confirmBody = await readJson(confirm);
    expect(confirm.status).toBe(200);
    expect(confirmBody.success).toBe(true);

    const oldPassword = await login("admin", "123456");
    expect(oldPassword.response.status).toBe(500);

    const newPassword = await login("admin", "reset-password-123");
    expect(newPassword.response.status).toBe(200);
    expect(newPassword.token).toHaveLength(64);
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
    await sqlite
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

  it("filters users by numeric select fields from URL params", async () => {
    const { token } = await login();
    const response = await app.request("/api/system/user?page=1&pageSize=20&sex=1", {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await readJson(response);
    const data = body.data as unknown as {
      data: Array<{ username: string; sex: number }>;
      total: number;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(data.total).toBe(1);
    expect(data.data).toEqual([expect.objectContaining({ username: "demo", sex: 1 })]);
  });

  it("applies role authorization to menus and APIs", async () => {
    const now = nowIso();
    const passwordHash = await bcrypt.hash("123456", 10);
    const roleResult = await sqlite
      .prepare(
        `INSERT INTO sys_role
          (name, code, remark, sort, status, created_at, updated_at)
         VALUES
          ('用户查询员', 'user_viewer', '', 10, 1, ?, ?)
         RETURNING id`,
      )
      .run(now, now);
    const roleId = Number(roleResult.lastInsertRowid);
    const ruleIds = (
      (await sqlite
        .prepare(
          `SELECT id FROM sys_rule
           WHERE key IN ('system', 'system.user', 'system.user.query')
           ORDER BY id ASC`,
        )
        .all()) as Array<{ id: number }>
    ).map((item) => item.id);
    const insertRoleRule = sqlite.prepare(
      "INSERT INTO sys_role_rule (role_id, rule_id) VALUES (?, ?)",
    );
    for (const ruleId of ruleIds) {
      await insertRoleRule.run(roleId, ruleId);
    }

    const userResult = await sqlite
      .prepare(
        `INSERT INTO sys_user
          (username, password_hash, nickname, sex, dept_id, status, created_at, updated_at)
         VALUES
          ('viewer', ?, '用户查询员', 0, 1, 1, ?, ?)
         RETURNING id`,
      )
      .run(passwordHash, now, now);
    await sqlite
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

  it("creates, updates and deletes file groups", async () => {
    const { token } = await login();
    const create = await app.request("/api/system/file/group", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        parentId: 0,
        name: "测试文件夹",
        sort: 9,
        describe: "文件夹 CRUD 回归",
      }),
    });
    expect(create.status).toBe(200);

    const createdRow = (await sqlite
      .prepare("SELECT id FROM sys_file_group WHERE name = ?")
      .get("测试文件夹")) as { id: number } | undefined;
    expect(createdRow?.id).toBeGreaterThan(0);

    const update = await app.request(`/api/system/file/group/${createdRow?.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        parentId: 0,
        name: "测试文件夹-更新",
        sort: 10,
        describe: "已更新",
      }),
    });
    expect(update.status).toBe(200);

    const tree = await app.request("/api/system/file/group/tree", {
      headers: { authorization: `Bearer ${token}` },
    });
    const treeBody = await readJson(tree);
    expect(JSON.stringify(treeBody.data)).toContain("测试文件夹-更新");

    const remove = await app.request(`/api/system/file/group/${createdRow?.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(remove.status).toBe(200);
  });
});
