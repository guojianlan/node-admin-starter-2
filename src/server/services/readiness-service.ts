import fs from "node:fs/promises";
import path from "node:path";
import { sqlite } from "@/server/db";
import {
  DEFAULT_ADMIN_BASE_ADMIN_PASSWORD,
  DEFAULT_ADMIN_BASE_SECRET_KEY,
  DEFAULT_DATABASE_URL,
  getAdminBaseEnv,
  validateAdminBaseEnv,
} from "@/server/env";
import { testStorageConnection } from "@/server/services/storage-service";

export type ReadinessStatus = "ok" | "warning" | "failed";

export type ReadinessCheck = {
  name: string;
  status: ReadinessStatus;
  message: string;
  critical: boolean;
};

export type ReadinessResult = {
  status: "ready" | "degraded" | "failed";
  checks: ReadinessCheck[];
  failed: number;
  warnings: number;
  timestamp: string;
};

async function check(input: {
  name: string;
  critical: boolean;
  checks: ReadinessCheck[];
  run: () => Promise<string>;
}) {
  try {
    const message = await input.run();
    input.checks.push({
      name: input.name,
      status: "ok",
      message,
      critical: input.critical,
    });
  } catch (error) {
    input.checks.push({
      name: input.name,
      status: input.critical ? "failed" : "warning",
      message: error instanceof Error ? error.message : String(error),
      critical: input.critical,
    });
  }
}

function countRows(value: unknown) {
  return Number((value as { total?: number | string } | undefined)?.total ?? 0);
}

export async function runReadinessChecks(
  input: { includeMail?: boolean } = {},
): Promise<ReadinessResult> {
  const checks: ReadinessCheck[] = [];

  const envResult = validateAdminBaseEnv();
  checks.push({
    name: "env",
    status: envResult.success ? "ok" : "failed",
    message: envResult.success ? "environment is valid" : envResult.issues.join("; "),
    critical: true,
  });

  await check({
    name: "database",
    critical: true,
    checks,
    run: async () => {
      await sqlite.prepare("SELECT 1 AS ok").get();
      return "database connection is available";
    },
  });

  await check({
    name: "migration",
    critical: true,
    checks,
    run: async () => {
      const row = await sqlite.prepare("SELECT COUNT(1) AS total FROM __migrations").get();
      const total = countRows(row);
      if (total < 1) throw new Error("no migrations have been applied");
      return `${total} migration(s) applied`;
    },
  });

  await check({
    name: "admin_user",
    critical: true,
    checks,
    run: async () => {
      const row = (await sqlite
        .prepare(
          `SELECT id, status
           FROM sys_user
           WHERE id = 1 AND username = 'admin' AND deleted_at IS NULL`,
        )
        .get()) as { id: number; status: number } | undefined;
      if (!row) throw new Error("default admin user is missing");
      if (row.status !== 1) throw new Error("default admin user is disabled");
      return "default admin user is available";
    },
  });

  await check({
    name: "admin_role",
    critical: true,
    checks,
    run: async () => {
      const row = (await sqlite
        .prepare(
          `SELECT id, status
           FROM sys_role
           WHERE id = 1 AND code = 'admin' AND deleted_at IS NULL`,
        )
        .get()) as { id: number; status: number } | undefined;
      if (!row) throw new Error("super admin role is missing");
      if (row.status !== 1) throw new Error("super admin role is disabled");
      return "super admin role is available";
    },
  });

  await check({
    name: "default_storage",
    critical: true,
    checks,
    run: async () => {
      const row = (await sqlite
        .prepare(
          `SELECT id, type, status
           FROM sys_storage
           WHERE is_default = true AND deleted_at IS NULL
           ORDER BY id ASC
           LIMIT 1`,
        )
        .get()) as { id: number; type: string; status: number } | undefined;
      if (!row) throw new Error("default storage is missing");
      if (row.status !== 1) throw new Error("default storage is disabled");
      return `default ${row.type} storage is available`;
    },
  });

  await check({
    name: "storage_connection",
    critical: true,
    checks,
    run: async () => {
      const row = (await sqlite
        .prepare(
          `SELECT
            type,
            endpoint,
            region,
            bucket,
            access_key AS accessKey,
            secret_key_encrypted AS secretKeyEncrypted,
            root_path AS rootPath
           FROM sys_storage
           WHERE is_default = true AND deleted_at IS NULL AND status = 1
           ORDER BY id ASC
           LIMIT 1`,
        )
        .get()) as
        | {
            type: "local" | "s3";
            endpoint: string | null;
            region: string | null;
            bucket: string | null;
            accessKey: string | null;
            secretKeyEncrypted: string | null;
            rootPath: string | null;
          }
        | undefined;
      if (!row) throw new Error("default storage is missing");
      await testStorageConnection(row);
      return "default storage connection is writable/available";
    },
  });

  await check({
    name: "upload_directory",
    critical: false,
    checks,
    run: async () => {
      const row = (await sqlite
        .prepare(
          `SELECT root_path AS rootPath
           FROM sys_storage
           WHERE type = 'local' AND is_default = true AND deleted_at IS NULL
           ORDER BY id ASC
           LIMIT 1`,
        )
        .get()) as { rootPath: string | null } | undefined;
      if (!row) return "default storage is not local";
      const configured = row.rootPath?.trim() || path.join("storage", "uploads");
      const root = path.isAbsolute(configured)
        ? configured
        : path.join(/* turbopackIgnore: true */ process.cwd(), configured);
      await fs.mkdir(root, { recursive: true });
      const probe = path.join(root, `.doctor-${Date.now()}`);
      await fs.writeFile(probe, "ok");
      await fs.rm(probe, { force: true });
      return `upload directory is writable: ${root}`;
    },
  });

  if (input.includeMail) {
    await check({
      name: "default_mail",
      critical: false,
      checks,
      run: async () => {
        const row = (await sqlite
          .prepare(
            `SELECT id, status
             FROM sys_mail_account
             WHERE is_default = true AND deleted_at IS NULL
             ORDER BY id ASC
             LIMIT 1`,
          )
          .get()) as { id: number; status: number } | undefined;
        if (!row) throw new Error("default mail account is missing");
        if (row.status !== 1) throw new Error("default mail account is disabled");
        return "default mail account is available";
      },
    });
  }

  await check({
    name: "production_safety",
    critical: false,
    checks,
    run: async () => {
      const env = getAdminBaseEnv();
      const warnings: string[] = [];
      if (env.isProduction && env.databaseUrl === DEFAULT_DATABASE_URL) {
        warnings.push("production DATABASE_URL is still using the development fallback");
      }
      if (env.isProduction && env.adminBaseSecretKey === DEFAULT_ADMIN_BASE_SECRET_KEY) {
        warnings.push("production secret key is still using the development fallback");
      }
      if (env.isProduction && env.adminBaseAdminPassword === DEFAULT_ADMIN_BASE_ADMIN_PASSWORD) {
        warnings.push("production admin password is still using the weak default");
      }
      if (warnings.length) throw new Error(warnings.join("; "));
      return env.isProduction ? "production safety settings are valid" : "not running in production";
    },
  });

  const failed = checks.filter((item) => item.status === "failed").length;
  const warnings = checks.filter((item) => item.status === "warning").length;

  return {
    status: failed ? "failed" : warnings ? "degraded" : "ready",
    checks,
    failed,
    warnings,
    timestamp: new Date().toISOString(),
  };
}
