import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATABASE_URL,
  DEFAULT_ADMIN_BASE_ADMIN_PASSWORD,
  DEFAULT_ADMIN_BASE_SECRET_KEY,
  validateAdminBaseEnv,
} from "@/server/env";

describe("admin base env", () => {
  it("provides safe development defaults", () => {
    const result = validateAdminBaseEnv({
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.databaseUrl).toBe(DEFAULT_DATABASE_URL);
    expect(result.data.adminBaseSecretKey).toBe(DEFAULT_ADMIN_BASE_SECRET_KEY);
    expect(result.data.adminBaseAdminPassword).toBe(DEFAULT_ADMIN_BASE_ADMIN_PASSWORD);
    expect(result.data.adminBaseTokenTtlDays).toBe(7);
    expect(result.data.databasePoolSize).toBe(10);
  });

  it("rejects missing production database and secrets", () => {
    const result = validateAdminBaseEnv({
      NODE_ENV: "production",
    } as NodeJS.ProcessEnv);

    expect(result.success).toBe(false);
    expect(result.issues.join("\n")).toContain("DATABASE_URL");
    expect(result.issues.join("\n")).toContain("ADMIN_BASE_SECRET_KEY");
    expect(result.issues.join("\n")).toContain("ADMIN_BASE_ADMIN_PASSWORD");
  });

  it("rejects example production secret and weak admin password", () => {
    const result = validateAdminBaseEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://admin_base:admin_base@localhost:5432/admin_base",
      ADMIN_BASE_SECRET_KEY: "change-me-admin-base-secret",
      ADMIN_BASE_ADMIN_PASSWORD: "123456",
    } as NodeJS.ProcessEnv);

    expect(result.success).toBe(false);
    expect(result.issues.join("\n")).toContain("development/example value");
    expect(result.issues.join("\n")).toContain("weak default value");
  });

  it("accepts explicit production values", () => {
    const result = validateAdminBaseEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://admin_base:admin_base@localhost:5432/admin_base",
      ADMIN_BASE_SECRET_KEY: "production-secret-value-that-is-long-enough",
      ADMIN_BASE_ADMIN_PASSWORD: "production-admin-password",
      LOG_LEVEL: "warn",
    } as NodeJS.ProcessEnv);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isProduction).toBe(true);
    expect(result.data.logLevel).toBe("warn");
  });
});
