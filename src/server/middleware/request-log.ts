import crypto from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { HonoVariables } from "@/server/context";
import { logger } from "@/server/logger";

export function requestLogMiddleware(): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const requestId = c.req.header("x-request-id") || crypto.randomUUID();
    const startedAt = performance.now();
    let thrown: unknown;

    c.set("requestId", requestId);
    c.header("x-request-id", requestId);

    try {
      await next();
    } catch (error) {
      thrown = error;
      throw error;
    } finally {
      const url = new URL(c.req.url);
      const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const status = thrown ? 500 : c.res.status;
      logger.info(
        {
          requestId,
          method: c.req.method,
          path: url.pathname,
          status,
          durationMs,
          userId: c.get("user")?.id ?? null,
        },
        "request completed",
      );
    }
  };
}
