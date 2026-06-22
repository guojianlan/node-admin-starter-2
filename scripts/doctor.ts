import { execFileSync } from "node:child_process";
import "../src/server/load-dotenv";
import { validateAdminBaseEnv } from "../src/server/env";

type DoctorStatus = "ok" | "warning" | "failed";

type DoctorCheck = {
  name: string;
  status: DoctorStatus;
  message: string;
};

function checkNodeVersion(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    return {
      name: "node",
      status: "failed",
      message: `Node.js ${process.version} detected; Node.js 20 or newer is required`,
    };
  }
  return {
    name: "node",
    status: "ok",
    message: `Node.js ${process.version}`,
  };
}

function checkPnpmVersion(): DoctorCheck {
  try {
    const version = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
    return {
      name: "pnpm",
      status: "ok",
      message: `pnpm ${version}`,
    };
  } catch {
    return {
      name: "pnpm",
      status: "failed",
      message: "pnpm is not available",
    };
  }
}

function checkEnvironment(): DoctorCheck {
  const result = validateAdminBaseEnv();
  if (!result.success) {
    return {
      name: "env",
      status: "failed",
      message: result.issues.join("; "),
    };
  }

  const warnings: string[] = [];
  if (!process.env.ADMIN_BASE_SECRET_KEY) {
    warnings.push("ADMIN_BASE_SECRET_KEY is using the development fallback");
  }
  if (!process.env.ADMIN_BASE_ADMIN_PASSWORD) {
    warnings.push("ADMIN_BASE_ADMIN_PASSWORD is using the development fallback");
  }

  return {
    name: "env",
    status: warnings.length ? "warning" : "ok",
    message: warnings.length ? warnings.join("; ") : "environment is valid",
  };
}

function printCheck(check: DoctorCheck) {
  const mark = check.status === "ok" ? "OK" : check.status === "warning" ? "WARN" : "FAIL";
  console.log(`[${mark}] ${check.name}: ${check.message}`);
}

const checks: DoctorCheck[] = [checkNodeVersion(), checkPnpmVersion(), checkEnvironment()];

try {
  const { runReadinessChecks } = await import("../src/server/services/readiness-service");
  const readiness = await runReadinessChecks({ includeMail: true });
  for (const item of readiness.checks) {
    checks.push({
      name: item.name,
      status: item.status,
      message: item.message,
    });
  }
} catch (error) {
  checks.push({
    name: "readiness",
    status: "failed",
    message: error instanceof Error ? error.message : String(error),
  });
} finally {
  const dbModule = await import("../src/server/db").catch(() => null);
  await dbModule?.closeDb().catch(() => undefined);
}

console.log("Admin Base doctor\n");
for (const check of checks) {
  printCheck(check);
}

const failed = checks.filter((item) => item.status === "failed").length;
const warnings = checks.filter((item) => item.status === "warning").length;

console.log(`\nSummary: ${failed} failed, ${warnings} warning(s), ${checks.length} check(s)`);
if (failed) process.exit(1);
