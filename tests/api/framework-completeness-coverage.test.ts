import bcrypt from "bcryptjs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  const body = await readJson<{ token: string; mustChangePassword?: boolean }>(response);
  return { response, body, token: String(body.data?.token ?? "") };
}

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function createNotice(
  token: string,
  payload: Record<string, unknown>,
): Promise<number> {
  const response = await app.request("/api/system/notice", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      type: "notice",
      status: 1,
      ...payload,
    }),
  });
  expect(response.status).toBe(200);
  const row = (await sqlite
    .prepare("SELECT id FROM sys_notice WHERE title = ? ORDER BY id DESC LIMIT 1")
    .get(String(payload.title))) as { id: number };
  return row.id;
}

async function visibleNoticeTitles(token: string) {
  const response = await app.request("/api/system/notice/my", {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await readJson<Array<{ title: string }>>(response);
  expect(response.status).toBe(200);
  return (body.data ?? []).map((item) => item.title);
}

async function countLoginRecords(message: string) {
  const row = (await sqlite
    .prepare("SELECT COUNT(1)::int AS total FROM sys_login_record WHERE message = ?")
    .get(message)) as { total: number } | undefined;
  return Number(row?.total ?? 0);
}

async function latestOperation(module: string, action: string) {
  return (await sqlite
    .prepare(
      `SELECT request_id AS requestId, details_json AS detailsJson, success, status, risk_level AS riskLevel
       FROM sys_operation_log
       WHERE module = ? AND action = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(module, action)) as
    | {
        requestId: string | null;
        detailsJson: string | null;
        success: boolean;
        status: number;
        riskLevel: string;
      }
    | undefined;
}

describe("framework completeness coverage", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("enforces notice visibility for users, roles, departments, schedules and expiry", async () => {
    const admin = await login();
    const demo = await login("demo", "123456");
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const expired = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    await createNotice(admin.token, {
      title: "全员公告",
      content: "全部可见",
      scope: "all",
    });
    await createNotice(admin.token, {
      title: "指定用户公告",
      content: "demo 可见",
      scope: "users",
      targetUserIds: [2],
    });
    await createNotice(admin.token, {
      title: "指定角色公告",
      content: "operator 可见",
      scope: "roles",
      targetRoleIds: [2],
    });
    await createNotice(admin.token, {
      title: "指定部门公告",
      content: "产品部可见",
      scope: "depts",
      targetDeptIds: [2],
    });
    await createNotice(admin.token, {
      title: "未来公告",
      content: "暂不可见",
      scope: "all",
      publishedAt: future,
    });
    await createNotice(admin.token, {
      title: "过期公告",
      content: "已过期",
      scope: "all",
      expiredAt: expired,
    });

    const adminTitles = await visibleNoticeTitles(admin.token);
    expect(adminTitles).toContain("全员公告");
    expect(adminTitles).not.toContain("指定用户公告");
    expect(adminTitles).not.toContain("指定角色公告");
    expect(adminTitles).not.toContain("指定部门公告");
    expect(adminTitles).not.toContain("未来公告");
    expect(adminTitles).not.toContain("过期公告");

    const demoTitles = await visibleNoticeTitles(demo.token);
    expect(demoTitles).toEqual(
      expect.arrayContaining(["全员公告", "指定用户公告", "指定角色公告", "指定部门公告"]),
    );
    expect(demoTitles).not.toContain("未来公告");
    expect(demoTitles).not.toContain("过期公告");

    const userNotice = (await sqlite
      .prepare("SELECT id FROM sys_notice WHERE title = '指定用户公告'")
      .get()) as { id: number };
    const stats = await app.request(`/api/system/notice/${userNotice.id}/read-stats`, {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const statsBody = await readJson<{ targetTotal: number; readTotal: number; unreadTotal: number }>(
      stats,
    );
    expect(stats.status).toBe(200);
    expect(statsBody.data).toMatchObject({ targetTotal: 1, readTotal: 0, unreadTotal: 1 });

    const unreadUsers = await app.request(
      `/api/system/notice/${userNotice.id}/read-users?readStatus=unread`,
      {
        headers: { authorization: `Bearer ${admin.token}` },
      },
    );
    const unreadUsersBody = await readJson<Page<{ username: string; readStatus: string }>>(
      unreadUsers,
    );
    expect(unreadUsers.status).toBe(200);
    expect(unreadUsersBody.data?.data).toContainEqual(
      expect.objectContaining({ username: "demo", readStatus: "unread" }),
    );

    const read = await app.request(`/api/system/notice/my/${userNotice.id}/read`, {
      method: "POST",
      headers: authHeaders(demo.token),
      body: JSON.stringify({}),
    });
    expect(read.status).toBe(200);

    const statsAfterRead = await app.request(`/api/system/notice/${userNotice.id}/read-stats`, {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const statsAfterReadBody = await readJson<{
      targetTotal: number;
      readTotal: number;
      unreadTotal: number;
    }>(statsAfterRead);
    expect(statsAfterReadBody.data).toMatchObject({
      targetTotal: 1,
      readTotal: 1,
      unreadTotal: 0,
    });
    const readUsers = await app.request(
      `/api/system/notice/${userNotice.id}/read-users?readStatus=read`,
      {
        headers: { authorization: `Bearer ${admin.token}` },
      },
    );
    const readUsersBody = await readJson<Page<{ username: string; readStatus: string }>>(
      readUsers,
    );
    expect(readUsersBody.data?.data).toContainEqual(
      expect.objectContaining({ username: "demo", readStatus: "read" }),
    );

    const readAll = await app.request("/api/system/notice/my/read-all", {
      method: "POST",
      headers: authHeaders(demo.token),
      body: JSON.stringify({}),
    });
    expect(readAll.status).toBe(200);
    const unread = await app.request("/api/system/notice/my/unread-count", {
      headers: { authorization: `Bearer ${demo.token}` },
    });
    const unreadBody = await readJson<{ total: number }>(unread);
    expect(unreadBody.data?.total).toBe(0);

    const revoke = await app.request(`/api/system/notice/revoke/${userNotice.id}`, {
      method: "PUT",
      headers: authHeaders(admin.token),
      body: JSON.stringify({}),
    });
    expect(revoke.status).toBe(200);
    expect(await visibleNoticeTitles(demo.token)).not.toContain("指定用户公告");
  });

  it("sanitizes notice rich text content before saving", async () => {
    const admin = await login();
    const id = await createNotice(admin.token, {
      title: "富文本清洗",
      content:
        '<h5>五级标题</h5><p><strong>正文</strong><script>alert(1)</script><a href="javascript:alert(1)">危险链接</a><img src="/uploads/demo.png" onerror="alert(1)" /></p>',
      scope: "all",
    });

    const row = (await sqlite
      .prepare("SELECT content FROM sys_notice WHERE id = ?")
      .get(id)) as { content: string } | undefined;

    expect(row?.content).toContain("<h5>五级标题</h5>");
    expect(row?.content).toContain("<strong>正文</strong>");
    expect(row?.content).toContain("危险链接");
    expect(row?.content).toContain('src="/uploads/demo.png"');
    expect(row?.content).not.toContain("<script");
    expect(row?.content).not.toContain("javascript:");
    expect(row?.content).not.toContain("onerror");
  });

  it("handles OAuth provider redirects, callback failures and successful email binding", async () => {
    await sqlite
      .prepare(
        `INSERT INTO sys_oauth_provider
          (key, name, enabled, auth_url, client_id, status, sort, created_at, updated_at)
         VALUES
          ('disabled', 'Disabled', false, 'https://provider.test/oauth/authorize', 'disabled-client', 1, 90, now(), now())
         ON CONFLICT DO NOTHING`,
      )
      .run();
    await sqlite
      .prepare(
        `INSERT INTO sys_oauth_provider
          (key, name, enabled, auth_url, status, sort, created_at, updated_at)
         VALUES
          ('missing-client', 'Missing Client', true, 'https://provider.test/oauth/authorize', 1, 91, now(), now())
         ON CONFLICT DO NOTHING`,
      )
      .run();
    await sqlite
      .prepare(
        `UPDATE sys_oauth_provider
         SET enabled = true,
             auth_url = ?,
             token_url = ?,
             user_info_url = ?,
             client_id = ?,
             scopes_json = ?,
             user_mapping_json = ?,
             status = 1
         WHERE key = 'github'`,
      )
      .run(
        "https://provider.test/oauth/authorize",
        "https://provider.test/oauth/token",
        "https://provider.test/user",
        "github-client",
        JSON.stringify(["user:email"]),
        JSON.stringify({ id: "id", username: "login", email: "email", nickname: "name" }),
      );

    const disabledRedirect = await app.request("/api/system/oauth/disabled/redirect", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(disabledRedirect.status).toBe(500);

    const missingClientRedirect = await app.request("/api/system/oauth/missing-client/redirect", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(missingClientRedirect.status).toBe(500);

    const redirect = await app.request("/api/system/oauth/github/redirect?redirect=/dashboard", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(redirect.status).toBe(302);
    const redirectUrl = new URL(String(redirect.headers.get("location")));
    expect(redirectUrl.origin).toBe("https://provider.test");
    expect(redirectUrl.searchParams.get("client_id")).toBe("github-client");
    const state = String(redirectUrl.searchParams.get("state"));
    expect(state).toHaveLength(48);

    const mismatch = await app.request(
      "/api/system/oauth/github/callback?code=bad-code&state=wrong-state",
      { headers: { "user-agent": "oauth-test" } },
    );
    expect(mismatch.status).toBe(500);
    expect(await countLoginRecords("OAuth state 无效")).toBe(1);

    const failedRedirect = await app.request("/api/system/oauth/github/redirect", {
      headers: { origin: "http://localhost:3000" },
    });
    const failedState = String(new URL(String(failedRedirect.headers.get("location"))).searchParams.get("state"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "bad" }), { status: 500 })),
    );
    const failedCallback = await app.request(
      `/api/system/oauth/github/callback?code=bad-code&state=${failedState}`,
      { headers: { "user-agent": "oauth-test" } },
    );
    expect(failedCallback.status).toBe(500);
    expect(await countLoginRecords("获取 OAuth access token 失败")).toBe(1);

    const successRedirect = await app.request("/api/system/oauth/github/redirect", {
      headers: { origin: "http://localhost:3000" },
    });
    const successState = String(
      new URL(String(successRedirect.headers.get("location"))).searchParams.get("state"),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://provider.test/oauth/token") {
          return new Response(JSON.stringify({ access_token: "oauth-access-token" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url === "https://provider.test/user") {
          return new Response(
            JSON.stringify({
              id: "github-admin",
              login: "admin-oauth",
              email: "admin@xinadmin.test",
              name: "Admin OAuth",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );
    const callback = await app.request(
      `/api/system/oauth/github/callback?code=good-code&state=${successState}`,
      { headers: { "user-agent": "oauth-test", "x-request-id": "oauth-success" } },
    );
    expect(callback.status).toBe(302);
    const target = new URL(String(callback.headers.get("location")));
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("oauthToken")).toHaveLength(64);

    const account = (await sqlite
      .prepare(
        "SELECT user_id AS userId FROM sys_oauth_account WHERE provider = 'github' AND provider_user_id = 'github-admin'",
      )
      .get()) as { userId: number } | undefined;
    expect(account?.userId).toBe(1);
    expect(await countLoginRecords("OAuth 登录成功：github")).toBe(1);
    expect(await latestOperation("system.auth", "oauthLogin:github")).toMatchObject({
      requestId: "oauth-success",
      success: true,
      status: 302,
    });
  });

  it("manages OAuth provider resources and profile account unbinding without leaking secrets", async () => {
    const { token } = await login();
    const create = await app.request("/api/system/oauth/provider", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        key: "custom",
        name: "Custom OAuth",
        enabled: true,
        authUrl: "https://custom.test/oauth/authorize",
        tokenUrl: "https://custom.test/oauth/token",
        userInfoUrl: "https://custom.test/user",
        clientId: "custom-client",
        clientSecret: "custom-secret",
        scopes: "openid email",
        userMapping: '{"id":"sub","username":"preferred_username","email":"email","nickname":"name"}',
        autoCreateUser: false,
        status: 1,
        sort: 50,
      }),
    });
    expect(create.status).toBe(200);

    const list = await app.request("/api/system/oauth/provider?keyword=custom", {
      headers: { authorization: `Bearer ${token}` },
    });
    const listBody = await readJson<Page<Record<string, unknown>>>(list);
    expect(list.status).toBe(200);
    expect(listBody.data?.data[0]).toMatchObject({
      key: "custom",
      hasClientSecret: true,
      clientId: "custom-client",
    });
    expect(listBody.data?.data[0]).not.toHaveProperty("clientSecretEncrypted");

    const loginOptions = await app.request("/api/system/login/options");
    const loginOptionsBody = await readJson<{ oauthProviders: Array<{ key: string; authUrl: string }> }>(
      loginOptions,
    );
    expect(loginOptionsBody.data?.oauthProviders).toContainEqual({
      key: "custom",
      name: "Custom OAuth",
      authUrl: "/api/system/oauth/custom/redirect",
    });

    const github = (await sqlite
      .prepare("SELECT id FROM sys_oauth_provider WHERE key = 'github'")
      .get()) as { id: number };
    const renameSystem = await app.request(`/api/system/oauth/provider/${github.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ key: "github-renamed" }),
    });
    expect(renameSystem.status).toBe(500);
    const deleteSystem = await app.request(`/api/system/oauth/provider/${github.id}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(deleteSystem.status).toBe(500);

    const custom = listBody.data?.data[0] as { id: number };
    const disable = await app.request(`/api/system/oauth/provider/status/${custom.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ status: 1, enabled: false }),
    });
    expect(disable.status).toBe(200);
    const disabledRedirect = await app.request("/api/system/oauth/custom/redirect", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(disabledRedirect.status).toBe(500);

    await sqlite
      .prepare(
        `INSERT INTO sys_oauth_account
          (user_id, provider, provider_user_id, provider_username, email, created_at, updated_at)
         VALUES (1, 'custom', 'custom-admin', 'admin-custom', 'admin@xinadmin.test', now(), now())`,
      )
      .run();
    const accounts = await app.request("/api/system/profile/oauth/accounts", {
      headers: { authorization: `Bearer ${token}` },
    });
    const accountsBody = await readJson<Array<{ provider: string; providerUsername: string }>>(accounts);
    expect(accounts.status).toBe(200);
    expect(accountsBody.data).toContainEqual(
      expect.objectContaining({ provider: "custom", providerUsername: "admin-custom" }),
    );

    const unbind = await app.request("/api/system/profile/oauth/custom/unbind", {
      method: "DELETE",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    expect(unbind.status).toBe(200);
    const remaining = (await sqlite
      .prepare("SELECT COUNT(1)::int AS total FROM sys_oauth_account WHERE user_id = 1 AND provider = 'custom'")
      .get()) as { total: number };
    expect(Number(remaining.total)).toBe(0);
    expect(await latestOperation("profile.oauth", "unbind")).toMatchObject({
      success: true,
      status: 200,
    });
  });

  it("manages SMS provider resources without leaking secrets and tests webhook sending", async () => {
    const { token } = await login();
    const create = await app.request("/api/system/sms/provider", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "Webhook SMS",
        code: "webhook",
        provider: "webhook",
        endpoint: "https://sms.example.test/send",
        accessKey: "sms-access",
        secretKey: "sms-secret",
        signature: "Admin Base",
        templateCode: "SMS_TEST",
        status: 1,
        sort: 1,
        optionsJson: '{"timeout":3000}',
      }),
    });
    expect(create.status).toBe(200);

    const list = await app.request("/api/system/sms/provider?keyword=webhook", {
      headers: { authorization: `Bearer ${token}` },
    });
    const listBody = await readJson<Page<Record<string, unknown>>>(list);
    expect(list.status).toBe(200);
    expect(listBody.data?.data[0]).toMatchObject({
      code: "webhook",
      provider: "webhook",
      hasSecretKey: true,
      accessKey: "sms-access",
    });
    expect(listBody.data?.data[0]).not.toHaveProperty("secretKey");
    expect(listBody.data?.data[0]).not.toHaveProperty("secretKeyEncrypted");

    const provider = listBody.data?.data[0] as { id: number };
    const setDefault = await app.request(`/api/system/sms/provider/default/${provider.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    expect(setDefault.status).toBe(200);

    const disableDefault = await app.request(`/api/system/sms/provider/status/${provider.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ status: 0 }),
    });
    expect(disableDefault.status).toBe(500);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://sms.example.test/send");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["x-admin-base-sms-access-key"]).toBe("sms-access");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer sms-secret");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        to: "13800138000",
        content: "测试短信",
        signature: "Admin Base",
        templateCode: "SMS_TEST",
      });
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const test = await app.request("/api/system/sms/provider/test", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        id: provider.id,
        to: "13800138000",
        content: "测试短信",
      }),
    });
    expect(test.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await latestOperation("system.smsProvider", "test")).toMatchObject({
      success: true,
      status: 200,
    });
  });

  it("generates CRUD module drafts and publishes them into project source when requested", async () => {
    const { token } = await login();
    const generatedRoot = path.join(process.cwd(), "generated/module-drafts/qa-note");
    const integrationFiles = [
      "src/server/db/schema/index.ts",
      "src/server/db/migrations.ts",
      "src/server/db/seed/default-data.ts",
      "src/server/routes/system/index.ts",
      "src/router/route-manifest.ts",
    ].map((item) => path.join(process.cwd(), item));
    const generatedSourceFiles = [
      "src/server/routes/system/qa-note.ts",
      "src/features/system/qa-note/QaNotePage.tsx",
      "src/app/(admin)/system/qa/note/page.tsx",
      "tests/api/qa-note.test.ts",
    ].map((item) => path.join(process.cwd(), item));
    const backups = new Map<string, string>();
    for (const file of integrationFiles) backups.set(file, await fs.readFile(file, "utf8"));
    await fs.rm(generatedRoot, { recursive: true, force: true });

    const example = await app.request("/api/system/module/generator/example", {
      headers: { authorization: `Bearer ${token}` },
    });
    const exampleBody = await readJson<Record<string, unknown>>(example);
    expect(example.status).toBe(200);
    expect(exampleBody.data?.name).toBe("sms-config");

    try {
      const generate = await app.request("/api/system/module/generator/generate", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          force: true,
          config: {
            name: "qa-note",
            title: "质检记录",
            description: "验证 Web 端模块生成器",
            frontendPath: "/system/qa/note",
            parentId: 180,
            parentKey: "system.settingsGroup",
            seedBaseId: 900,
            icon: "code",
            fields: [
              { name: "name", label: "名称", type: "text", required: true, search: true, quickSearch: true },
              { name: "code", label: "编码", type: "text", required: true, unique: true, search: true },
              { name: "status", label: "状态", type: "integer", valueType: "select", required: true, default: 1, search: true },
              { name: "remark", label: "备注", type: "textarea", table: false },
            ],
          },
        }),
      });
      const generateBody = await readJson<{
        module: { permission: string; frontendPath: string };
        outputRoot: string;
        files: Array<{ path: string; content: string }>;
      }>(generate);
      expect(generate.status).toBe(200);
      expect(generateBody.data?.module).toMatchObject({
        permission: "system.qa.note",
        frontendPath: "/system/qa/note",
      });
      expect(generateBody.data?.outputRoot).toBe("generated/module-drafts/qa-note");
      expect(generateBody.data?.files.map((file) => file.path)).toEqual(
        expect.arrayContaining([
          "generated/module-drafts/qa-note/README.md",
          "generated/module-drafts/qa-note/src/server/routes/system/qa-note.ts",
          "generated/module-drafts/qa-note/src/features/system/qa-note/QaNotePage.tsx",
          "generated/module-drafts/qa-note/tests/api/qa-note.test.ts",
        ]),
      );

      const drafts = await app.request("/api/system/module/generator/drafts", {
        headers: { authorization: `Bearer ${token}` },
      });
      const draftsBody = await readJson<Array<{ name: string; status: string }>>(drafts);
      expect(draftsBody.data).toContainEqual(expect.objectContaining({ name: "qa-note", status: "draft" }));

      const publish = await app.request("/api/system/module/generator/publish", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ name: "qa-note" }),
      });
      expect(publish.status).toBe(200);
      expect(await fs.readFile(path.join(process.cwd(), "src/router/route-manifest.ts"), "utf8")).toContain(
        'key: "system.qa.note"',
      );
      expect(await fs.readFile(path.join(process.cwd(), "src/server/db/schema/index.ts"), "utf8")).toContain(
        "export const sysQaNote",
      );
      expect(await fs.readFile(path.join(process.cwd(), "src/server/routes/system/index.ts"), "utf8")).toContain(
        "qaNoteRoutes",
      );
      for (const file of generatedSourceFiles) {
        expect(await fs.stat(file)).toBeTruthy();
      }

      const draftsAfterPublish = await app.request("/api/system/module/generator/drafts", {
        headers: { authorization: `Bearer ${token}` },
      });
      const draftsAfterPublishBody = await readJson<Array<{ name: string; status: string }>>(draftsAfterPublish);
      expect(draftsAfterPublishBody.data).toContainEqual(
        expect.objectContaining({ name: "qa-note", status: "published" }),
      );
      expect(await latestOperation("system.moduleGenerator", "publish")).toMatchObject({
        success: true,
        status: 200,
      });
    } finally {
      for (const [file, content] of backups) await fs.writeFile(file, content);
      for (const file of generatedSourceFiles) await fs.rm(file, { force: true });
      await fs.rm(path.join(process.cwd(), "src/app/(admin)/system/qa"), { recursive: true, force: true });
      await fs.rm(path.join(process.cwd(), "src/features/system/qa-note"), { recursive: true, force: true });
      await fs.rm(generatedRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsafe uploads and validates chunk upload failure paths and cleanup", async () => {
    const { token } = await login();
    await sqlite
      .prepare("UPDATE sys_config_items SET values = 'txt,png,svg' WHERE key = 'file.allowed_extensions'")
      .run();
    await sqlite
      .prepare("UPDATE sys_config_items SET values = 'svg,html,js' WHERE key = 'file.denied_extensions'")
      .run();

    const svgForm = new FormData();
    svgForm.append("file", new File(["<svg></svg>"], "bad.svg", { type: "image/svg+xml" }));
    const svgUpload = await app.request("/api/system/file/list/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: svgForm,
    });
    expect(svgUpload.status).toBe(500);

    const mimeForm = new FormData();
    mimeForm.append("file", new File(["hello"], "bad.png", { type: "text/plain" }));
    const mimeUpload = await app.request("/api/system/file/list/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: mimeForm,
    });
    expect(mimeUpload.status).toBe(500);

    const magicForm = new FormData();
    magicForm.append("file", new File(["not a png"], "bad.png", { type: "image/png" }));
    const magicUpload = await app.request("/api/system/file/list/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: magicForm,
    });
    expect(magicUpload.status).toBe(500);

    const init = await app.request("/api/system/file/chunk/init", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        filename: "chunk.txt",
        mime: "text/plain",
        size: 10,
        totalParts: 2,
      }),
    });
    const initBody = await readJson<{ uploadId: string }>(init);
    expect(init.status).toBe(200);
    const uploadId = String(initBody.data?.uploadId);

    const part = new FormData();
    part.append("uploadId", uploadId);
    part.append("partNumber", "1");
    part.append("file", new File(["hello"], "1.part", { type: "application/octet-stream" }));
    const uploadPart = await app.request("/api/system/file/chunk/part", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: part,
    });
    expect(uploadPart.status).toBe(200);

    const incomplete = await app.request("/api/system/file/chunk/complete", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ uploadId }),
    });
    expect(incomplete.status).toBe(500);

    await sqlite
      .prepare("UPDATE sys_file_upload_session SET expires_at = ? WHERE upload_id = ?")
      .run(new Date(Date.now() - 60 * 1000).toISOString(), uploadId);
    const clean = await app.request("/api/system/file/chunk/clean-expired", {
      method: "DELETE",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    expect(clean.status).toBe(200);
    const expired = (await sqlite
      .prepare("SELECT status FROM sys_file_upload_session WHERE upload_id = ?")
      .get(uploadId)) as { status: string };
    expect(expired.status).toBe("expired");

    const cancelInit = await app.request("/api/system/file/chunk/init", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        filename: "cancel.txt",
        mime: "text/plain",
        size: 5,
        totalParts: 1,
      }),
    });
    const cancelUploadId = String((await readJson<{ uploadId: string }>(cancelInit)).data?.uploadId);
    const cancelPart = new FormData();
    cancelPart.append("uploadId", cancelUploadId);
    cancelPart.append("partNumber", "1");
    cancelPart.append("sha256", "0000");
    cancelPart.append("file", new File(["hello"], "1.part"));
    expect(
      await app.request("/api/system/file/chunk/part", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: cancelPart,
      }),
    ).toHaveProperty("status", 500);
    const validCancelPart = new FormData();
    validCancelPart.append("uploadId", cancelUploadId);
    validCancelPart.append("partNumber", "1");
    validCancelPart.append(
      "sha256",
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    validCancelPart.append("file", new File(["hello"], "1.part"));
    expect(
      await app.request("/api/system/file/chunk/part", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: validCancelPart,
      }),
    ).toHaveProperty("status", 200);
    const cancel = await app.request(`/api/system/file/chunk/${cancelUploadId}`, {
      method: "DELETE",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    expect(cancel.status).toBe(200);
    const cancelled = (await sqlite
      .prepare("SELECT status FROM sys_file_upload_session WHERE upload_id = ?")
      .get(cancelUploadId)) as { status: string };
    expect(cancelled.status).toBe("cancelled");
    await expect(
      fs.stat(path.join(process.cwd(), "storage", "upload-parts", cancelUploadId)),
    ).rejects.toThrow();

    const txtForm = new FormData();
    txtForm.append("file", new File(["reference"], "reference.txt", { type: "text/plain" }));
    const txtUpload = await app.request("/api/system/file/list/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: txtForm,
    });
    const txtUploadBody = await readJson<{ id: number }>(txtUpload);
    expect(txtUpload.status).toBe(200);
    const addReference = await app.request("/api/system/file/reference", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        fileId: txtUploadBody.data?.id,
        module: "test.module",
        resourceType: "article",
        resourceId: "100",
        field: "cover",
      }),
    });
    expect(addReference.status).toBe(200);
    const references = await app.request(`/api/system/file/${txtUploadBody.data?.id}/references`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const referencesBody = await readJson<Array<{ module: string; resourceType: string }>>(references);
    expect(referencesBody.data).toContainEqual(
      expect.objectContaining({ module: "test.module", resourceType: "article" }),
    );
    const removeReference = await app.request("/api/system/file/reference", {
      method: "DELETE",
      headers: authHeaders(token),
      body: JSON.stringify({
        fileId: txtUploadBody.data?.id,
        module: "test.module",
        resourceType: "article",
        resourceId: "100",
        field: "cover",
      }),
    });
    expect(removeReference.status).toBe(200);
  });

  it("enforces password policies, lockouts, force-change reset and token revocation", async () => {
    await sqlite
      .prepare("UPDATE sys_config_items SET values = '12' WHERE key = 'security.password_min_length'")
      .run();
    const { token } = await login();
    const weak = await app.request("/api/system/profile/password", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ oldPassword: "123456", newPassword: "short" }),
    });
    expect(weak.status).toBe(500);

    await sqlite
      .prepare("UPDATE sys_config_items SET values = '6' WHERE key = 'security.password_min_length'")
      .run();
    await sqlite
      .prepare("UPDATE sys_config_items SET values = '5' WHERE key = 'security.password_history_count'")
      .run();
    const change = await app.request("/api/system/profile/password", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ oldPassword: "123456", newPassword: "new-password-123" }),
    });
    expect(change.status).toBe(200);
    const reuse = await app.request("/api/system/profile/password", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ oldPassword: "new-password-123", newPassword: "123456" }),
    });
    expect(reuse.status).toBe(500);

    await sqlite
      .prepare("UPDATE sys_config_items SET values = '2' WHERE key = 'login.max_failed_attempts'")
      .run();
    await sqlite
      .prepare("UPDATE sys_config_items SET values = '1' WHERE key = 'login.lock_minutes'")
      .run();
    expect((await login("demo", "bad-password")).response.status).toBe(500);
    expect((await login("demo", "bad-password")).response.status).toBe(500);
    const locked = await login("demo", "123456");
    expect(locked.response.status).toBe(500);
    await sqlite
      .prepare("UPDATE sys_user SET locked_until = ? WHERE username = 'demo'")
      .run(new Date(Date.now() - 60 * 1000).toISOString());
    expect((await login("demo", "123456")).response.status).toBe(200);

    const demoBeforeReset = await login("demo", "123456");
    const reset = await app.request("/api/system/user/resetPassword", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ id: 2, password: "reset-password-123" }),
    });
    expect(reset.status).toBe(200);
    const oldTokenInfo = await app.request("/api/system/info", {
      headers: { authorization: `Bearer ${demoBeforeReset.token}` },
    });
    expect(oldTokenInfo.status).toBe(401);
    const demoAfterReset = await login("demo", "reset-password-123");
    expect(demoAfterReset.response.status).toBe(200);
    expect(demoAfterReset.body.data?.mustChangePassword).toBe(true);
    const info = await app.request("/api/system/info", {
      headers: { authorization: `Bearer ${demoAfterReset.token}` },
    });
    const infoBody = await readJson<{ user: { mustChangePassword?: boolean } }>(info);
    expect(infoBody.data?.user.mustChangePassword).toBe(true);
  });

  it("blocks non-profile APIs during forced password change and releases after change", async () => {
    await sqlite
      .prepare("UPDATE sys_config_items SET values = 'true' WHERE key = 'security.force_change_on_first_login'")
      .run();
    const { token: adminToken } = await login();
    const create = await app.request("/api/system/user", {
      method: "POST",
      headers: authHeaders(adminToken),
      body: JSON.stringify({
        username: "first-login",
        password: "first-login-123",
        nickname: "First Login",
        email: "first-login@example.com",
        status: 1,
        roleIds: [],
      }),
    });
    expect(create.status).toBe(200);

    const firstLogin = await login("first-login", "first-login-123");
    expect(firstLogin.response.status).toBe(200);
    expect(firstLogin.body.data?.mustChangePassword).toBe(true);

    const blocked = await app.request("/api/system/dashboard/summary", {
      headers: { authorization: `Bearer ${firstLogin.token}` },
    });
    expect(blocked.status).toBe(423);

    const profile = await app.request("/api/system/profile", {
      headers: { authorization: `Bearer ${firstLogin.token}` },
    });
    expect(profile.status).toBe(200);

    const change = await app.request("/api/system/profile/password", {
      method: "PUT",
      headers: authHeaders(firstLogin.token),
      body: JSON.stringify({
        oldPassword: "first-login-123",
        newPassword: "first-login-456",
      }),
    });
    expect(change.status).toBe(200);
    const afterChangeInfo = await app.request("/api/system/info", {
      headers: { authorization: `Bearer ${firstLogin.token}` },
    });
    const afterChangeBody = await readJson<{ user: { mustChangePassword?: boolean } }>(
      afterChangeInfo,
    );
    expect(afterChangeBody.data?.user.mustChangePassword).toBe(false);
    const dashboard = await app.request("/api/system/dashboard/summary", {
      headers: { authorization: `Bearer ${firstLogin.token}` },
    });
    expect(dashboard.status).toBe(200);
  });

  it("requires captcha after configured failed login attempts", async () => {
    await sqlite
      .prepare("UPDATE sys_config_items SET values = 'false' WHERE key = 'login.captcha_enabled'")
      .run();
    await sqlite
      .prepare("UPDATE sys_config_items SET values = '1' WHERE key = 'login.captcha_after_failures'")
      .run();

    expect((await login("demo", "bad-password")).response.status).toBe(500);
    const requiresCaptcha = await app.request("/api/system/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "demo", password: "123456" }),
    });
    const requiresCaptchaBody = await readJson(requiresCaptcha);
    expect(requiresCaptcha.status).toBe(500);
    expect(requiresCaptchaBody.msg).toBe("请输入验证码");

    const captcha = await app.request("/api/system/login/captcha");
    const captchaBody = await readJson<{ captchaId: string; debugCode?: string }>(captcha);
    const passed = await app.request("/api/system/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "demo",
        password: "123456",
        captchaId: captchaBody.data?.captchaId,
        captchaCode: captchaBody.data?.debugCode,
      }),
    });
    expect(passed.status).toBe(200);
  });

  it("records high-value operations and protects log export and cleanup permissions", async () => {
    const admin = await login();
    const failedLogin = await app.request("/api/system/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "coverage-failed-login" },
      body: JSON.stringify({ username: "admin", password: "bad-password" }),
    });
    expect(failedLogin.status).toBe(500);

    const cleanLoginLog = await app.request("/api/system/login/log/clean", {
      method: "DELETE",
      headers: authHeaders(admin.token),
      body: JSON.stringify({ status: 0 }),
    });
    expect(cleanLoginLog.status).toBe(200);
    expect(await latestOperation("system.loginLog", "clean")).toMatchObject({
      success: true,
      riskLevel: "critical",
    });

    const demo = await login("demo", "123456");
    const online = await app.request("/api/system/online/user?userId=2", {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const onlineBody = await readJson<Page<{ id: number }>>(online);
    const kick = await app.request(`/api/system/online/user/${onlineBody.data?.data[0]?.id}`, {
      method: "DELETE",
      headers: authHeaders(admin.token),
      body: JSON.stringify({}),
    });
    expect(kick.status).toBe(200);
    expect(await latestOperation("system.onlineUser", "kick")).toMatchObject({
      success: true,
      riskLevel: "high",
    });
    expect(
      await app.request("/api/system/info", {
        headers: { authorization: `Bearer ${demo.token}` },
      }),
    ).toHaveProperty("status", 401);

    const form = new FormData();
    form.append("file", new File(["move-copy-log"], "move-copy-log.txt", { type: "text/plain" }));
    const upload = await app.request("/api/system/file/list/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${admin.token}` },
      body: form,
    });
    const uploadBody = await readJson<{ id: number }>(upload);
    expect(upload.status).toBe(200);
    expect(await latestOperation("system.file", "upload")).toMatchObject({ success: true });

    const move = await app.request("/api/system/file/list/move", {
      method: "PUT",
      headers: authHeaders(admin.token),
      body: JSON.stringify({ ids: [uploadBody.data?.id], groupId: 1 }),
    });
    expect(move.status).toBe(200);
    expect(await latestOperation("system.file", "move")).toMatchObject({ success: true });

    const copy = await app.request("/api/system/file/list/copy", {
      method: "POST",
      headers: authHeaders(admin.token),
      body: JSON.stringify({ ids: [uploadBody.data?.id], groupId: 1 }),
    });
    expect(copy.status).toBe(200);
    expect(await latestOperation("system.file", "copy")).toMatchObject({ success: true });

    const exportDeniedUserPassword = await bcrypt.hash("123456", 10);
    const now = nowIso();
    await sqlite
      .prepare(
        `INSERT INTO sys_user
          (username, password_hash, nickname, sex, dept_id, status, created_at, updated_at)
         VALUES ('log_limited', ?, '日志受限', 0, 1, 1, ?, ?)`,
      )
      .run(exportDeniedUserPassword, now, now);
    const limited = await login("log_limited", "123456");
    const deniedExport = await app.request("/api/system/operation/log/export", {
      headers: { authorization: `Bearer ${limited.token}` },
    });
    expect(deniedExport.status).toBe(403);

    const exportResponse = await app.request("/api/system/operation/log/export", {
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toContain("text/csv");
    expect(await latestOperation("system.operationLog", "export")).toMatchObject({
      success: true,
      riskLevel: "high",
    });

    const cleanDenied = await app.request("/api/system/operation/log/clean", {
      method: "DELETE",
      headers: authHeaders(limited.token),
      body: JSON.stringify({ success: false }),
    });
    expect(cleanDenied.status).toBe(403);
    const cleanWithoutCondition = await app.request("/api/system/operation/log/clean", {
      method: "DELETE",
      headers: authHeaders(admin.token),
      body: JSON.stringify({}),
    });
    expect(cleanWithoutCondition.status).toBe(500);
    const cleanByRisk = await app.request("/api/system/operation/log/clean", {
      method: "DELETE",
      headers: authHeaders(admin.token),
      body: JSON.stringify({ riskLevel: "low" }),
    });
    expect(cleanByRisk.status).toBe(200);
    expect(await latestOperation("system.operationLog", "clean")).toMatchObject({
      success: true,
      riskLevel: "critical",
    });
  });

  it("saves business settings with settings permission and applies upload policy immediately", async () => {
    const now = nowIso();
    const passwordHash = await bcrypt.hash("123456", 10);
    const roleResult = await sqlite
      .prepare(
        `INSERT INTO sys_role
          (name, code, remark, sort, status, created_at, updated_at)
         VALUES ('系统设置员', 'settings_manager', '', 30, 1, ?, ?)
         RETURNING id`,
      )
      .run(now, now);
    const roleId = Number(roleResult.lastInsertRowid);
    const ruleIds = (
      (await sqlite
        .prepare(
          `SELECT id FROM sys_rule
           WHERE key IN ('system', 'system.settings', 'system.settings.query', 'system.settings.save')
           ORDER BY id ASC`,
        )
        .all()) as Array<{ id: number }>
    ).map((item) => item.id);
    for (const ruleId of ruleIds) {
      await sqlite
        .prepare("INSERT INTO sys_role_rule (role_id, rule_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
        .run(roleId, ruleId);
    }
    const userResult = await sqlite
      .prepare(
        `INSERT INTO sys_user
          (username, password_hash, nickname, sex, dept_id, status, created_at, updated_at)
         VALUES ('settings_only', ?, '系统设置员', 0, 1, 1, ?, ?)
         RETURNING id`,
      )
      .run(passwordHash, now, now);
    await sqlite
      .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)")
      .run(Number(userResult.lastInsertRowid), roleId);

    const settingsUser = await login("settings_only", "123456");
    const save = await app.request("/api/system/settings/config/save", {
      method: "PUT",
      headers: authHeaders(settingsUser.token),
      body: JSON.stringify({
        site_name: "Settings Saved",
        "file.mime_check_enabled": "false",
        "file.magic_check_enabled": "false",
      }),
    });
    expect(save.status).toBe(200);
    const saved = (await sqlite
      .prepare("SELECT key, \"values\" AS values FROM sys_config_items WHERE key IN (?, ?, ?)")
      .all("site_name", "file.mime_check_enabled", "file.magic_check_enabled")) as Array<{
      key: string;
      values: string;
    }>;
    expect(Object.fromEntries(saved.map((item) => [item.key, item.values]))).toMatchObject({
      site_name: "Settings Saved",
      "file.mime_check_enabled": "false",
      "file.magic_check_enabled": "false",
    });
    expect(await latestOperation("system.settings", "save")).toMatchObject({ success: true });

    const admin = await login();
    const form = new FormData();
    form.append("file", new File(["not a png"], "policy.png", { type: "text/plain" }));
    const upload = await app.request("/api/system/file/list/upload", {
      method: "POST",
      headers: { authorization: `Bearer ${admin.token}` },
      body: form,
    });
    expect(upload.status).toBe(200);
  });
});
