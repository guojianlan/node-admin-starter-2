import type { ErrorHandler } from "hono";
import { fail } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { logger } from "@/server/logger";

export const errorMiddleware: ErrorHandler<{ Variables: HonoVariables }> = (error, c) => {
  logger.error(
    {
      requestId: c.get("requestId") ?? null,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      userId: c.get("user")?.id ?? null,
      err: error,
    },
    "request failed",
  );
  return c.json(
    fail(error.message || "Server Error", {
      showType: 4,
      description: process.env.NODE_ENV === "development" ? error.stack : undefined,
    }),
    500,
  );
};
