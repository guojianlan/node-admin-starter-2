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
    expect(result.data.aiWorkerStalledAfterSeconds).toBe(60);
    expect(result.data.aiWorkerMonitorIntervalSeconds).toBe(30);
    expect(result.data.aiWorkerAlertWebhookUrl).toBeNull();
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
      ADMIN_BASE_AI_WORKER_STALLED_AFTER_SECONDS: "120",
      ADMIN_BASE_AI_WORKER_MONITOR_INTERVAL_SECONDS: "15",
      ADMIN_BASE_AI_WORKER_ALERT_WEBHOOK_URL: "https://alerts.example.com/admin-base",
    } as NodeJS.ProcessEnv);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.isProduction).toBe(true);
    expect(result.data.logLevel).toBe("warn");
    expect(result.data.aiWorkerStalledAfterSeconds).toBe(120);
    expect(result.data.aiWorkerMonitorIntervalSeconds).toBe(15);
    expect(result.data.aiWorkerAlertWebhookUrl).toBe("https://alerts.example.com/admin-base");
  });

  it("rejects unsafe Worker monitoring thresholds and invalid webhook URLs", () => {
    const result = validateAdminBaseEnv({
      NODE_ENV: "development",
      ADMIN_BASE_AI_WORKER_STALLED_AFTER_SECONDS: "1",
      ADMIN_BASE_AI_WORKER_MONITOR_INTERVAL_SECONDS: "2",
      ADMIN_BASE_AI_WORKER_ALERT_WEBHOOK_URL: "not-a-url",
    } as NodeJS.ProcessEnv);

    expect(result.success).toBe(false);
    expect(result.issues.join("\n")).toContain("ADMIN_BASE_AI_WORKER_STALLED_AFTER_SECONDS");
    expect(result.issues.join("\n")).toContain("ADMIN_BASE_AI_WORKER_MONITOR_INTERVAL_SECONDS");
    expect(result.issues.join("\n")).toContain("ADMIN_BASE_AI_WORKER_ALERT_WEBHOOK_URL");
  });
});
