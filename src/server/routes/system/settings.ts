import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { nowIso, sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { runWithOperationLog } from "@/server/services/operation-log-service";

export const settingsRoutes = new Hono<{ Variables: HonoVariables }>();

settingsRoutes.get(
  "/settings/config/items",
  authRequired(),
  ability("system.settings.query"),
  async (c) => {
    const searchParams = new URL(c.req.url).searchParams;
    const query = z
      .object({
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().positive().max(500).default(300),
      })
      .parse(Object.fromEntries(searchParams));
    const offset = (query.page - 1) * query.pageSize;
    const rows = await sqlite
      .prepare(
        `SELECT
          ci.id,
          ci.group_id AS "groupId",
          cg.name AS "groupName",
          ci.key,
          ci.title,
          ci.describe,
          ci.values,
          ci.type,
          ci.options_json AS "optionsJson",
          ci.props_json AS "propsJson",
          ci.sort,
          ci.status,
          ci.is_system AS "isSystem",
          ci.created_at AS "createdAt"
         FROM sys_config_items ci
         LEFT JOIN sys_config_group cg ON cg.id = ci.group_id
         WHERE ci.deleted_at IS NULL
         ORDER BY ci.sort ASC, ci.id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(query.pageSize, offset);
    const totalRow = (await sqlite
      .prepare("SELECT COUNT(*) AS total FROM sys_config_items WHERE deleted_at IS NULL")
      .get()) as { total: number };
    return c.json(
      success({
        data: rows,
        page: query.page,
        pageSize: query.pageSize,
        total: Number(totalRow.total ?? 0),
      }),
    );
  },
);

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
