import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { fail } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { logger } from "@/server/logger";

export const errorMiddleware: ErrorHandler<{ Variables: HonoVariables }> = (error, c) => {
  const validationError = error instanceof ZodError;
  const status: ContentfulStatusCode = validationError
    ? 400
    : "status" in error &&
        typeof error.status === "number" &&
        error.status >= 400 &&
        error.status <= 599
      ? (error.status as ContentfulStatusCode)
      : 500;
  const message = validationError
    ? error.issues[0]?.message || "请求参数校验失败"
    : error.message || "Server Error";
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
    fail(message, {
      showType: 4,
      description: process.env.NODE_ENV === "development" ? error.stack : undefined,
    }),
    status,
  );
};
