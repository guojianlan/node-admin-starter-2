import { Hono } from "hono";
import { cors } from "hono/cors";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { runMigrations } from "@/server/db/migrations";
import { sqlite } from "@/server/db";
import { errorMiddleware } from "@/server/middleware/error";
import { authRoutes } from "@/server/routes/auth";
import { systemRoutes } from "@/server/routes/system";

runMigrations(sqlite);

export const app = new Hono<{ Variables: HonoVariables }>().basePath("/api");

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

app.route("/system", authRoutes);
app.route("/system", systemRoutes);
