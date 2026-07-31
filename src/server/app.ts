import { Hono } from "hono";
import { cors } from "hono/cors";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { runMigrations } from "@/server/db/migrations";
import { errorMiddleware } from "@/server/middleware/error";
import { requestLogMiddleware } from "@/server/middleware/request-log";
import { authRoutes } from "@/server/routes/auth";
import { systemRoutes } from "@/server/routes/system";
import { runReadinessChecks } from "@/server/services/readiness-service";

if (process.env.NODE_ENV !== "test") {
  await runMigrations();
}

export const app = new Hono<{ Variables: HonoVariables }>().basePath("/api");

app.use("*", requestLogMiddleware());
app.use("*", cors());
app.onError(errorMiddleware);

app.get("/health", (c) =>
  c.json(
    success({
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
  ),
);

app.get("/ready", async (c) => {
  const result = await runReadinessChecks();
  return c.json(success(result), result.status === "failed" ? 503 : 200);
});

app.route("/system", authRoutes);
app.route("/system", systemRoutes);
