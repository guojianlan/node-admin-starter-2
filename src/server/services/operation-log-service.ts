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

export async function recordOperationLog(
  c: Context<{ Variables: HonoVariables }>,
  input: OperationLogInput,
  dbClient: DbClient = sqlite,
) {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const detailsJson = input.details ? JSON.stringify(input.details) : null;

  try {
    await dbClient
      .prepare(
        `INSERT INTO sys_operation_log
          (user_id, username, module, action, resource, resource_id, method, path, ip, user_agent,
           request_id, status, success, message, duration_ms, details_json)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
