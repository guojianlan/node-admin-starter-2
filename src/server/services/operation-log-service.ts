import type { Context } from "hono";
import type { HonoVariables } from "@/server/context";
import { sqlite, type DbClient } from "@/server/db";
import { logger } from "@/server/logger";

type OperationLogInput = {
  userId?: number | null;
  username?: string | null;
  module: string;
  action: string;
  resource?: string | null;
  resourceId?: string | number | null;
  status?: number;
  success?: boolean;
  riskLevel?: "low" | "medium" | "high" | "critical";
  message?: string | null;
  durationMs?: number | null;
  details?: Record<string, unknown> | null;
};

function getClientIp(c: Context<{ Variables: HonoVariables }>) {
  const forwardedFor = c.req.header("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || null;
  return c.req.header("x-real-ip") ?? null;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function inferRiskLevel(input: OperationLogInput): "low" | "medium" | "high" | "critical" {
  if (input.riskLevel) return input.riskLevel;
  const action = input.action.toLowerCase();
  if (
    action.includes("clean") ||
    action.includes("forcedelete") ||
    action.includes("destroy")
  ) {
    return "critical";
  }
  if (
    action.includes("delete") ||
    action.includes("resetpassword") ||
    action.includes("kick") ||
    action.includes("publish") ||
    action.includes("revoke") ||
    action.includes("setdefault") ||
    action.includes("setrule") ||
    action.includes("authorize") ||
    action.includes("unbind")
  ) {
    return "high";
  }
  if (
    action.includes("create") ||
    action.includes("update") ||
    action.includes("upload") ||
    action.includes("test") ||
    action.includes("save") ||
    action.includes("bind")
  ) {
    return "medium";
  }
  return input.success === false ? "medium" : "low";
}

export async function recordOperationLog(
  c: Context<{ Variables: HonoVariables }>,
  input: OperationLogInput,
  dbClient: DbClient = sqlite,
) {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const detailsJson = input.details ? JSON.stringify(input.details) : null;
  const riskLevel = inferRiskLevel(input);

  try {
    await dbClient
      .prepare(
        `INSERT INTO sys_operation_log
          (user_id, username, module, action, resource, resource_id, method, path, ip, user_agent,
           request_id, status, success, risk_level, message, duration_ms, details_json)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.userId ?? user?.id ?? null,
        input.username ?? user?.username ?? null,
        input.module,
        input.action,
        input.resource ?? null,
        input.resourceId == null ? null : String(input.resourceId),
        c.req.method,
        url.pathname,
        getClientIp(c),
        c.req.header("user-agent") ?? null,
        c.get("requestId") ?? null,
        input.status ?? 200,
        input.success ?? true,
        riskLevel,
        input.message ?? null,
        input.durationMs == null ? null : Math.round(input.durationMs),
        detailsJson,
      );
  } catch (error) {
    logger.warn(
      {
        err: error,
        requestId: c.get("requestId") ?? null,
        module: input.module,
        action: input.action,
      },
      "failed to record operation log",
    );
  }
}

export async function runWithOperationLog<T>(
  c: Context<{ Variables: HonoVariables }>,
  input: Omit<OperationLogInput, "status" | "success" | "message" | "durationMs">,
  callback: () => Promise<T>,
) {
  const startedAt = performance.now();
  try {
    const result = await callback();
    await recordOperationLog(c, {
      ...input,
      status: 200,
      success: true,
      durationMs: performance.now() - startedAt,
    });
    return result;
  } catch (error) {
    await recordOperationLog(c, {
      ...input,
      status: 500,
      success: false,
      message: toErrorMessage(error),
      durationMs: performance.now() - startedAt,
    });
    throw error;
  }
}
