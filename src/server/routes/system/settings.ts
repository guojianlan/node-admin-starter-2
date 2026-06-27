import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { nowIso, sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { runWithOperationLog } from "@/server/services/operation-log-service";

export const settingsRoutes = new Hono<{ Variables: HonoVariables }>();

settingsRoutes.put(
  "/settings/config/save",
  authRequired(),
  ability("system.settings.save"),
  async (c) => {
    const payload = z.record(z.string(), z.unknown()).parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.settings",
        action: "save",
        resource: "/settings/config",
        details: { keys: Object.keys(payload) },
      },
      async () => {
        const update = sqlite.prepare(
          `UPDATE sys_config_items SET "values" = ?, updated_at = ? WHERE key = ?`,
        );
        for (const [key, value] of Object.entries(payload)) {
          await update.run(
            typeof value === "string" ? value : JSON.stringify(value),
            nowIso(),
            key,
          );
        }
      },
    );
    return c.json(success(null, "保存成功"));
  },
);
