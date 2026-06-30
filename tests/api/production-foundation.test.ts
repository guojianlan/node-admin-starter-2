import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "@/server/app";
import { seedDatabase } from "@/server/db/seed/seed";
import { resetTestDatabase, sqlite } from "../helpers/db";

type ApiResponse<T = unknown> = {
  success: boolean;
  msg: string;
  data?: T;
};

type ReadyData = {
  status: "ready" | "degraded" | "failed";
  failed: number;
  warnings: number;
  checks: Array<{ name: string; status: "ok" | "warning" | "failed" }>;
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
  return { response, body: await readJson<{ token: string }>(response) };
}

const originalAdminPassword = process.env.ADMIN_BASE_ADMIN_PASSWORD;

function expectCommandFailureMessage(run: () => void, pattern: RegExp) {
  try {
    run();
  } catch (error) {
    const output = [
      error instanceof Error ? error.message : String(error),
      String((error as { stdout?: Buffer | string }).stdout ?? ""),
      String((error as { stderr?: Buffer | string }).stderr ?? ""),
    ].join("\n");
    expect(output).toMatch(pattern);
    return;
  }
  throw new Error("Expected command to fail");
}

describe("production foundation", () => {
  beforeEach(async () => {
    delete process.env.ADMIN_BASE_ADMIN_PASSWORD;
    await resetTestDatabase();
  });

  afterEach(() => {
    if (originalAdminPassword === undefined) {
      delete process.env.ADMIN_BASE_ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_BASE_ADMIN_PASSWORD = originalAdminPassword;
    }
  });

  it("uses ADMIN_BASE_ADMIN_PASSWORD only when the admin user is first seeded", async () => {
    process.env.ADMIN_BASE_ADMIN_PASSWORD = "custom-admin-password";
    await resetTestDatabase();

    const customLogin = await login("admin", "custom-admin-password");
    expect(customLogin.response.status).toBe(200);
    expect(customLogin.body.success).toBe(true);

    process.env.ADMIN_BASE_ADMIN_PASSWORD = "new-admin-password";
    await seedDatabase();

    const oldPasswordLogin = await login("admin", "custom-admin-password");
    expect(oldPasswordLogin.response.status).toBe(200);

    const newPasswordLogin = await login("admin", "new-admin-password");
    expect(newPasswordLogin.response.status).toBe(500);
    expect(newPasswordLogin.body.success).toBe(false);
  }, 15000);

  it("returns request id headers on API responses", async () => {
    const response = await app.request("/api/health", {
      headers: { "x-request-id": "test-request-id" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("test-request-id");
  });

  it("returns ready when critical dependencies are seeded", async () => {
    const response = await app.request("/api/ready");
    const body = await readJson<ReadyData>(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.status).toBe("ready");
    expect(body.data?.failed).toBe(0);
    expect(body.data?.checks.map((item) => item.name)).toContain("default_storage");
  });

  it("returns 503 when a critical readiness dependency is missing", async () => {
    await sqlite.prepare("UPDATE sys_storage SET deleted_at = now() WHERE is_default = true").run();

    const response = await app.request("/api/ready");
    const body = await readJson<ReadyData>(response);

    expect(response.status).toBe(503);
    expect(body.success).toBe(true);
    expect(body.data?.status).toBe("failed");
    expect(body.data?.checks.find((item) => item.name === "default_storage")?.status).toBe(
      "failed",
    );
  });

  it("doctor reports failed production env checks without mutating data", () => {
    expect(() =>
      execFileSync("pnpm", ["run", "doctor"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "production",
          DATABASE_URL: "",
          ADMIN_BASE_SECRET_KEY: "",
          ADMIN_BASE_ADMIN_PASSWORD: "",
        },
      }),
    ).toThrow();
  });

  it("refuses db reset for production-like targets without destructive confirmation", () => {
    expectCommandFailureMessage(
      () =>
        execFileSync("./node_modules/.bin/tsx", ["scripts/db-reset.ts"], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_ENV: "development",
            DATABASE_URL: "postgres://admin_base:admin_base@prod-db.internal:5432/admin_base",
            ADMIN_BASE_ALLOW_DB_RESET: "true",
            ADMIN_BASE_SECRET_KEY: "test-admin-base-secret",
            ADMIN_BASE_ADMIN_PASSWORD: "safe-admin-password",
          },
        }),
      /ADMIN_BASE_CONFIRM_PRODUCTION_RESET/,
    );

    expectCommandFailureMessage(
      () =>
        execFileSync("./node_modules/.bin/tsx", ["scripts/db-reset.ts"], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_ENV: "production",
            DATABASE_URL: "postgres://admin_base:admin_base@localhost:5432/admin_base_production",
            ADMIN_BASE_ALLOW_DB_RESET: "true",
            ADMIN_BASE_SECRET_KEY: "production-secret-value-that-is-long-enough",
            ADMIN_BASE_ADMIN_PASSWORD: "safe-admin-password",
          },
        }),
      /ADMIN_BASE_CONFIRM_PRODUCTION_RESET/,
    );
  });
});
