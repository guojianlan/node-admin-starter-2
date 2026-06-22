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

async function grantUserQueryToOperator() {
  const ruleIds = (
    (await sqlite
      .prepare(
        `SELECT id FROM sys_rule
         WHERE key IN ('system', 'system.user', 'system.user.query')
         ORDER BY id ASC`,
      )
      .all()) as Array<{ id: number }>
  ).map((item) => item.id);
  const insert = sqlite.prepare(
    "INSERT INTO sys_role_rule (role_id, rule_id) VALUES (2, ?) ON CONFLICT DO NOTHING",
  );
  for (const ruleId of ruleIds) await insert.run(ruleId);
}

describe("admin base completion scope", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("protects built-in users, roles, rules, storage and mail accounts", async () => {
    const token = await login();
    for (const path of [
      "/api/system/user/1",
      "/api/system/role/1",
      "/api/system/rule/1",
      "/api/system/storage/1",
      "/api/system/mail/account/1",
    ]) {
      const response = await app.request(path, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await readJson(response);
      expect(response.status).toBe(500);
      expect(body.success).toBe(false);
    }
  });

  it("applies role data scope to user lists", async () => {
    await grantUserQueryToOperator();

    await sqlite.prepare("UPDATE sys_role SET data_scope = 'self' WHERE id = 2").run();
    const selfToken = await login("demo", "123456");
    const selfResponse = await app.request("/api/system/user?page=1&pageSize=20", {
      headers: { authorization: `Bearer ${selfToken}` },
    });
    const selfBody = await readJson<Page<{ username: string }>>(selfResponse);
    expect(selfResponse.status).toBe(200);
    expect(selfBody.data?.data).toEqual([expect.objectContaining({ username: "demo" })]);

    await sqlite.prepare("UPDATE sys_role SET data_scope = 'custom_dept' WHERE id = 2").run();
    await sqlite.prepare("DELETE FROM sys_role_dept WHERE role_id = 2").run();
    await sqlite
      .prepare("INSERT INTO sys_role_dept (role_id, dept_id) VALUES (2, 1)")
      .run();
    const customToken = await login("demo", "123456");
    const customResponse = await app.request("/api/system/user?page=1&pageSize=20", {
      headers: { authorization: `Bearer ${customToken}` },
    });
    const customBody = await readJson<Page<{ username: string }>>(customResponse);
    expect(customResponse.status).toBe(200);
    expect(customBody.data?.data.map((item) => item.username)).toContain("admin");
    expect(customBody.data?.data.map((item) => item.username)).not.toContain("demo");
  });

  it("manages local storage and records upload metadata", async () => {
    const token = await login();
    const create = await app.request("/api/system/storage", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "测试本地存储",
        code: "local_test",
        type: "local",
        baseUrl: "/uploads",
        rootPath: "storage/uploads-test",
        status: 1,
        sort: 2,
      }),
    });
    expect(create.status).toBe(200);
    const storage = (await sqlite
      .prepare("SELECT id FROM sys_storage WHERE code = ?")
      .get("local_test")) as { id: number };

    const test = await app.request("/api/system/storage/test", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ id: storage.id }),
    });
    expect(test.status).toBe(200);

    const setDefault = await app.request(`/api/system/storage/default/${storage.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(setDefault.status).toBe(200);

    const form = new FormData();
    form.append("file", new File(["metadata"], "metadata.txt", { type: "text/plain" }));
    const upload = await app.request("/api/system/file/list/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
    const uploadBody = await readJson<{ id: number }>(upload);
    expect(upload.status).toBe(200);

    const file = (await sqlite
      .prepare("SELECT storage_id AS storageId, type, sha256 FROM sys_file WHERE id = ?")
      .get(uploadBody.data?.id ?? 0)) as { storageId: number; type: string; sha256: string };
    expect(file).toMatchObject({ storageId: storage.id, type: "document" });
    expect(file.sha256).toHaveLength(64);
  });

  it("encrypts mail passwords and keeps them out of API responses", async () => {
    const token = await login();
    const now = nowIso();
    await sqlite
      .prepare(
        `INSERT INTO sys_mail_account
          (name, code, host, port, secure, from_email, status, sort, created_at, updated_at)
         VALUES
          ('失败测试 SMTP', 'smtp_fail', '127.0.0.1', 9, false, 'noreply@test.local', 1, 9, ?, ?)`,
      )
      .run(now, now);

    const create = await app.request("/api/system/mail/account", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "SMTP 密钥测试",
        code: "smtp_secret",
        host: "127.0.0.1",
        port: 9,
        secure: false,
        username: "mailer",
        password: "secret-value",
        fromEmail: "mailer@test.local",
        status: 1,
        sort: 10,
      }),
    });
    expect(create.status).toBe(200);
    const mail = (await sqlite
      .prepare("SELECT password_encrypted AS passwordEncrypted FROM sys_mail_account WHERE code = ?")
      .get("smtp_secret")) as { passwordEncrypted: string };
    expect(mail.passwordEncrypted).toBeTruthy();
    expect(mail.passwordEncrypted).not.toContain("secret-value");

    const list = await app.request("/api/system/mail/account?keyword=smtp_secret", {
      headers: { authorization: `Bearer ${token}` },
    });
    const listText = await list.text();
    expect(list.status).toBe(200);
    expect(listText).toContain("hasPassword");
    expect(listText).not.toContain("passwordEncrypted");
    expect(listText).not.toContain("secret-value");

    const test = await app.request("/api/system/mail/account/test", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ id: 2, to: "receiver@test.local" }),
    });
    const testBody = await readJson(test);
    expect(test.status).toBe(500);
    expect(testBody.msg).toBe("SMTP 连接失败");
  });
});
