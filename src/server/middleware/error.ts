import type { ErrorHandler } from "hono";
import { fail } from "@/lib/response";
import type { HonoVariables } from "@/server/context";

export const errorMiddleware: ErrorHandler<{ Variables: HonoVariables }> = (error, c) => {
  console.error(error);
  return c.json(
    fail(error.message || "Server Error", {
      showType: 4,
      description: process.env.NODE_ENV === "development" ? error.stack : undefined,
    }),
    500,
  );
};
