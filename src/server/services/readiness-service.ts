import { sqlite } from "@/server/db";
import { validateAdminBaseEnv } from "@/server/env";

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
