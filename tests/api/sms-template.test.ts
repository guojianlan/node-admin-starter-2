import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

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

async function login(username = "admin", password?: string) {
  const resolvedPassword =
    password ?? (username === "admin" ? getAdminTestPassword() : "123456");
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: resolvedPassword }),
  });
  const body = await readJson<{ token: string }>(response);
  return { response, body, token: String(body.data?.token ?? "") };
}

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

function readRequestBody(init?: RequestInit) {
  return typeof init?.body === "string" ? JSON.parse(init.body) : {};
}

async function latestOperation(module: string, action: string) {
  return (await sqlite
    .prepare(
      `SELECT module, action, success, status, details_json AS "detailsJson"
       FROM sys_operation_log
       WHERE module = ? AND action = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(module, action)) as
    | { module: string; action: string; success: boolean; status: number; detailsJson: string | null }
    | undefined;
}

async function createSmsProvider(token: string) {
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
      signature: "Provider Sig",
      templateCode: "PROVIDER_DEFAULT",
      status: 1,
      sort: 1,
    }),
  });
  expect(create.status).toBe(200);

  const list = await app.request("/api/system/sms/provider?keyword=webhook", {
    headers: { authorization: `Bearer ${token}` },
  });
  const listBody = await readJson<Page<{ id: number }>>(list);
  const provider = listBody.data?.data[0];
  expect(provider?.id).toBeTruthy();
  return provider as { id: number };
}

describe("system.smsTemplate module", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetTestDatabase();
  }, 120000);

  it("requires permission for list access", async () => {
    const response = await app.request("/api/system/sms/template");

    expect(response.status).toBe(401);
  });

  it("supports template lifecycle and sends rendered webhook tests", async () => {
    const { token } = await login();
    const provider = await createSmsProvider(token);

    const created = await app.request("/api/system/sms/template", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "登录验证码",
        code: "login_code",
        providerId: provider.id,
        templateCode: "LOGIN_CODE",
        signature: "Template Sig",
        content: "验证码 {{code}}，{{expireMinutes}} 分钟内有效",
        variablesJson: '{"code":"验证码","expireMinutes":"有效分钟数"}',
        status: 1,
        sort: 1,
      }),
    });
    expect(created.status).toBe(200);

    const list = await app.request("/api/system/sms/template?keyword=login", {
      headers: { authorization: `Bearer ${token}` },
    });
    const listBody = await readJson<Page<{ id: number; code: string; providerName: string }>>(list);
    expect(list.status).toBe(200);
    expect(listBody.data?.total).toBeGreaterThanOrEqual(1);
    expect(listBody.data?.data[0]).toMatchObject({
      code: "login_code",
      providerName: "Webhook SMS",
    });

    const id = Number(listBody.data?.data[0]?.id);
    expect(id).toBeTruthy();

    const updated = await app.request(`/api/system/sms/template/${id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "登录验证码更新",
        remark: "用于登录和改密",
      }),
    });
    expect(updated.status).toBe(200);

    const disabled = await app.request(`/api/system/sms/template/status/${id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ status: 0 }),
    });
    expect(disabled.status).toBe(200);

    const disabledTest = await app.request("/api/system/sms/template/test", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        id,
        to: "13800138000",
        variables: { code: "123456", expireMinutes: 5 },
      }),
    });
    expect(disabledTest.status).toBe(500);

    const enabled = await app.request(`/api/system/sms/template/status/${id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ status: 1 }),
    });
    expect(enabled.status).toBe(200);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://sms.example.test/send");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>)["x-admin-base-sms-access-key"]).toBe(
        "sms-access",
      );
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer sms-secret");
      expect(readRequestBody(init)).toMatchObject({
        to: "13800138000",
        content: "验证码 123456，5 分钟内有效",
        signature: "Template Sig",
        templateCode: "LOGIN_CODE",
        variables: { code: "123456", expireMinutes: 5 },
      });
      return new Response("ok", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const test = await app.request("/api/system/sms/template/test", {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "sms-template-test" },
      body: JSON.stringify({
        id,
        to: "13800138000",
        variables: { code: "123456", expireMinutes: 5 },
      }),
    });
    expect(test.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const operation = await latestOperation("system.smsTemplate", "test");
    expect(operation).toMatchObject({
      success: true,
      status: 200,
    });
    expect(operation?.detailsJson).toContain("138****8000");

    const deleted = await app.request(`/api/system/sms/template/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleted.status).toBe(200);
  });
});
