import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

type ApiResponse<T> = { success: boolean; data?: T };
type Page<T> = { data: T[]; total: number };

async function readJson<T>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

async function login() {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: getAdminTestPassword() }),
  });
  return String((await readJson<{ token: string }>(response)).data?.token ?? "");
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function expectNumericOrder(values: number[], order: "asc" | "desc") {
  const expected = [...values].sort((left, right) =>
    order === "asc" ? left - right : right - left,
  );
  expect(values).toEqual(expected);
}

beforeEach(async () => {
  await resetTestDatabase();
}, 120000);

describe("server-side list sorting", () => {
  it("sorts CRUD lists by ID and timestamps in both directions", async () => {
    const token = await login();

    const ascending = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/user?page=1&pageSize=200&sort=id.asc", {
        headers: authHeaders(token),
      }),
    );
    const descending = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/user?page=1&pageSize=200&sort=id.desc", {
        headers: authHeaders(token),
      }),
    );
    const newest = await readJson<Page<{ id: number; createdAt: string }>>(
      await app.request("/api/system/user?page=1&pageSize=200&sort=createdAt.desc", {
        headers: authHeaders(token),
      }),
    );

    expectNumericOrder(
      (ascending.data?.data ?? []).map((item) => item.id),
      "asc",
    );
    expectNumericOrder(
      (descending.data?.data ?? []).map((item) => item.id),
      "desc",
    );
    expect((newest.data?.data ?? []).map((item) => Date.parse(item.createdAt))).toEqual(
      [...(newest.data?.data ?? [])]
        .map((item) => Date.parse(item.createdAt))
        .sort((left, right) => right - left),
    );
  });

  it("sorts explicit AI, OAuth, and online-user list routes", async () => {
    const token = await login();
    await sqlite
      .prepare(
        `INSERT INTO sys_ai_model
          (provider_id, name, model_id, model_type, status, sort, created_at, updated_at)
         VALUES
          (2, 'Sort Test A', 'sort-test-a', 'chat', 1, 80, now() - interval '1 day', now()),
          (2, 'Sort Test B', 'sort-test-b', 'chat', 1, 70, now(), now())`,
      )
      .run();
    await login();

    const models = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/ai/model?page=1&pageSize=200&sort=id.desc", {
        headers: authHeaders(token),
      }),
    );
    const oauthProviders = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/oauth/provider?page=1&pageSize=200&sort=id.desc", {
        headers: authHeaders(token),
      }),
    );
    const onlineUsers = await readJson<Page<{ id: number; createdAt: string }>>(
      await app.request("/api/system/online/user?page=1&pageSize=200&sort=createdAt.asc", {
        headers: authHeaders(token),
      }),
    );

    expectNumericOrder(
      (models.data?.data ?? []).map((item) => item.id),
      "desc",
    );
    expectNumericOrder(
      (oauthProviders.data?.data ?? []).map((item) => item.id),
      "desc",
    );
    const onlineRows = onlineUsers.data?.data ?? [];
    expect(onlineRows.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < onlineRows.length; index += 1) {
      const previous = onlineRows[index - 1]!;
      const current = onlineRows[index]!;
      const previousTime = Date.parse(previous.createdAt);
      const currentTime = Date.parse(current.createdAt);
      expect(previousTime).toBeLessThanOrEqual(currentTime);
      if (previousTime === currentTime) expect(previous.id).toBeLessThan(current.id);
    }
  });
});
