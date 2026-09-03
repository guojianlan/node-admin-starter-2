import { z } from "zod";

export const DEFAULT_DATABASE_URL = "postgres://admin_base:admin_base@localhost:5432/admin_base";
export const DEFAULT_ADMIN_BASE_SECRET_KEY = "admin-base-development-secret";
export const EXAMPLE_ADMIN_BASE_SECRET_KEY = "change-me-admin-base-secret";
export const DEFAULT_ADMIN_BASE_ADMIN_PASSWORD = "123456";

const unsafeSecretKeys = new Set([DEFAULT_ADMIN_BASE_SECRET_KEY, EXAMPLE_ADMIN_BASE_SECRET_KEY]);

const unsafeAdminPasswords = new Set(["123456", "admin", "password"]);

const envSchema = z
  .object({
    NODE_ENV: z.string().default("development"),
    NEXT_PHASE: z.string().optional(),
    npm_lifecycle_event: z.string().optional(),
    DATABASE_URL: z.string().trim().optional(),
    DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),
    ADMIN_BASE_SECRET_KEY: z.string().trim().optional(),
    ADMIN_BASE_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
    ADMIN_BASE_PUBLIC_URL: z.url().default("http://localhost:3000"),
    ADMIN_BASE_ADMIN_PASSWORD: z.string().optional(),
    ADMIN_BASE_AI_WORKER_STALLED_AFTER_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .max(86_400)
      .default(60),
    ADMIN_BASE_AI_WORKER_MONITOR_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(5)
      .max(3_600)
      .default(30),
    ADMIN_BASE_AI_WORKER_ALERT_WEBHOOK_URL: z.union([z.url(), z.literal("")]).optional(),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
  })
  .superRefine((value, ctx) => {
    const isProductionBuild =
      value.NEXT_PHASE === "phase-production-build" || value.npm_lifecycle_event === "build";
    if (value.NODE_ENV !== "production" || isProductionBuild) return;

    if (!value.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required in production",
      });
    }

    if (!value.ADMIN_BASE_SECRET_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADMIN_BASE_SECRET_KEY"],
        message: "ADMIN_BASE_SECRET_KEY is required in production",
      });
    } else if (unsafeSecretKeys.has(value.ADMIN_BASE_SECRET_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADMIN_BASE_SECRET_KEY"],
        message: "ADMIN_BASE_SECRET_KEY cannot use the development/example value in production",
      });
    }

    if (!value.ADMIN_BASE_ADMIN_PASSWORD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADMIN_BASE_ADMIN_PASSWORD"],
        message: "ADMIN_BASE_ADMIN_PASSWORD is required in production",
      });
    } else if (unsafeAdminPasswords.has(value.ADMIN_BASE_ADMIN_PASSWORD)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADMIN_BASE_ADMIN_PASSWORD"],
        message: "ADMIN_BASE_ADMIN_PASSWORD cannot use a weak default value in production",
      });
    }

    if (!value.ADMIN_BASE_PUBLIC_URL.startsWith("https://")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADMIN_BASE_PUBLIC_URL"],
        message: "ADMIN_BASE_PUBLIC_URL must use HTTPS in production",
      });
    }
  });

export type AdminBaseEnv = {
  nodeEnv: string;
  isProduction: boolean;
  databaseUrl: string;
  databasePoolSize: number;
  adminBaseSecretKey: string;
  adminBaseTokenTtlDays: number;
  publicUrl: string;
  adminBaseAdminPassword: string;
  aiWorkerStalledAfterSeconds: number;
  aiWorkerMonitorIntervalSeconds: number;
  aiWorkerAlertWebhookUrl: string | null;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
};

export type EnvValidationResult =
  | { success: true; data: AdminBaseEnv; issues: [] }
  | { success: false; data: null; issues: string[] };

function normalizeEnv(value: z.infer<typeof envSchema>): AdminBaseEnv {
  return {
    nodeEnv: value.NODE_ENV,
    isProduction: value.NODE_ENV === "production",
    databaseUrl: value.DATABASE_URL || DEFAULT_DATABASE_URL,
    databasePoolSize: value.DATABASE_POOL_SIZE,
    adminBaseSecretKey: value.ADMIN_BASE_SECRET_KEY || DEFAULT_ADMIN_BASE_SECRET_KEY,
    adminBaseTokenTtlDays: value.ADMIN_BASE_TOKEN_TTL_DAYS,
    publicUrl: value.ADMIN_BASE_PUBLIC_URL.replace(/\/$/, ""),
    adminBaseAdminPassword: value.ADMIN_BASE_ADMIN_PASSWORD || DEFAULT_ADMIN_BASE_ADMIN_PASSWORD,
    aiWorkerStalledAfterSeconds: value.ADMIN_BASE_AI_WORKER_STALLED_AFTER_SECONDS,
    aiWorkerMonitorIntervalSeconds: value.ADMIN_BASE_AI_WORKER_MONITOR_INTERVAL_SECONDS,
    aiWorkerAlertWebhookUrl: value.ADMIN_BASE_AI_WORKER_ALERT_WEBHOOK_URL?.trim() || null,
    logLevel: value.LOG_LEVEL,
  };
}

export function validateAdminBaseEnv(source: NodeJS.ProcessEnv = process.env): EnvValidationResult {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    return {
      success: false,
      data: null,
      issues: parsed.error.issues.map((issue) => {
        const field = issue.path.join(".") || "env";
        return `${field}: ${issue.message}`;
      }),
    };
  }
  return {
    success: true,
    data: normalizeEnv(parsed.data),
    issues: [],
  };
}

export function getAdminBaseEnv() {
  const result = validateAdminBaseEnv();
  if (!result.success) {
    throw new Error(`Invalid Admin Base environment:\n${result.issues.join("\n")}`);
  }
  return result.data;
}
