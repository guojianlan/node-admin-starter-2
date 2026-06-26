import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/server/app";
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

async function login(username = "admin", password = "123456", userAgent = "test-agent") {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": userAgent,
      "x-forwarded-for": "198.51.100.9",
    },
    body: JSON.stringify({ username, password }),
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

describe("framework completeness modules", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lists and cleans login records", async () => {
    const { token } = await login();
    await app.request("/api/system/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "bad-password" }),
    });

    const list = await app.request("/api/system/login/log?username=admin&page=1&pageSize=20", {
      headers: { authorization: `Bearer ${token}` },
    });
    const listBody = await readJson<Page<{ username: string; status: number }>>(list);

    expect(list.status).toBe(200);
    expect(listBody.data?.total).toBeGreaterThanOrEqual(2);
    expect(listBody.data?.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ username: "admin", status: 1 }),
        expect.objectContaining({ username: "admin", status: 0 }),
      ]),
    );

    const clean = await app.request("/api/system/login/log/clean", {
      method: "DELETE",
      headers: authHeaders(token),
      body: JSON.stringify({ status: 0 }),
    });
    expect(clean.status).toBe(200);
  });

  it("tracks online sessions and can force a token offline", async () => {
    const first = await login("admin", "123456", "first-agent");
    const second = await login("admin", "123456", "second-agent");

    const list = await app.request("/api/system/online/user?keyword=first-agent&active=true", {
      headers: { authorization: `Bearer ${second.token}` },
    });
    const listBody = await readJson<Page<{ id: number; userAgent: string }>>(list);
    const targetId = listBody.data?.data[0]?.id;
    expect(list.status).toBe(200);
    expect(targetId).toBeGreaterThan(0);

    const kick = await app.request(`/api/system/online/user/${targetId}`, {
      method: "DELETE",
      headers: authHeaders(second.token),
    });
    expect(kick.status).toBe(200);

    const denied = await app.request("/api/system/info", {
      headers: { authorization: `Bearer ${first.token}` },
    });
    expect(denied.status).toBe(401);
  });

  it("updates profile and changes password with token preservation for current session", async () => {
    const { token } = await login();

    const update = await app.request("/api/system/profile", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({
        nickname: "管理员-更新",
        email: "admin-updated@example.com",
        mobile: "13811112222",
        sex: 2,
        bio: "profile test",
      }),
    });
    expect(update.status).toBe(200);

    const profile = await app.request("/api/system/profile", {
      headers: { authorization: `Bearer ${token}` },
    });
    const profileBody = await readJson<{ nickname: string; email: string }>(profile);
    expect(profileBody.data).toMatchObject({
      nickname: "管理员-更新",
      email: "admin-updated@example.com",
    });

    const changePassword = await app.request("/api/system/profile/password", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ oldPassword: "123456", newPassword: "new-password-123" }),
    });
    expect(changePassword.status).toBe(200);

    const stillValid = await app.request("/api/system/info", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(stillValid.status).toBe(200);

    const oldLogin = await login("admin", "123456");
    expect(oldLogin.response.status).toBe(500);
    const newLogin = await login("admin", "new-password-123");
    expect(newLogin.response.status).toBe(200);
  });

  it("publishes notices and supports unread/read state", async () => {
    const { token } = await login();
    const futurePublishedAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const futureCreate = await app.request("/api/system/notice", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        title: "定时发布测试",
        content: "未来才可见",
        type: "notice",
        scope: "all",
        status: 1,
        publishedAt: futurePublishedAt,
      }),
    });
    expect(futureCreate.status).toBe(200);

    const scheduledMyNotices = await app.request("/api/system/notice/my", {
      headers: { authorization: `Bearer ${token}` },
    });
    const scheduledMyNoticesBody = await readJson<Array<{ title: string; content: string }>>(
      scheduledMyNotices,
    );
    expect(scheduledMyNotices.status).toBe(200);
    expect(scheduledMyNoticesBody.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "定时发布测试", content: "未来才可见" }),
      ]),
    );

    const create = await app.request("/api/system/notice", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        title: "发布测试",
        content: "公告内容",
        type: "announcement",
        scope: "all",
        status: 0,
      }),
    });
    expect(create.status).toBe(200);

    const row = (await sqlite
      .prepare("SELECT id FROM sys_notice WHERE title = ?")
      .get("发布测试")) as { id: number } | undefined;
    expect(row?.id).toBeGreaterThan(0);

    const publish = await app.request(`/api/system/notice/publish/${row?.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    expect(publish.status).toBe(200);

    const unread = await app.request("/api/system/notice/my/unread-count", {
      headers: { authorization: `Bearer ${token}` },
    });
    const unreadBody = await readJson<{ total: number }>(unread);
    expect(unreadBody.data?.total).toBeGreaterThanOrEqual(1);

    const myNotices = await app.request("/api/system/notice/my", {
      headers: { authorization: `Bearer ${token}` },
    });
    const myNoticesBody = await readJson<Array<{ title: string; content: string }>>(myNotices);
    expect(myNotices.status).toBe(200);
    expect(myNoticesBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "发布测试", content: "公告内容" }),
      ]),
    );

    const read = await app.request(`/api/system/notice/my/${row?.id}/read`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    expect(read.status).toBe(200);
  });
});
