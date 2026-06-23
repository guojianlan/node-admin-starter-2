import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { sqlite } from "@/server/db";
import { sysLoginRecord } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { runWithOperationLog } from "@/server/services/operation-log-service";

const noopSchema = z.object({});

const loginLogCrud = createCrudRoutes({
  basePath: "/login/log",
  table: sysLoginRecord,
  idColumn: sysLoginRecord.id,
  createSchema: noopSchema,
  updateSchema: noopSchema,
  permissions: {
    prefix: "system.loginLog",
    actions: {
      query: "system.loginLog.query",
      delete: "system.loginLog.delete",
      batchDelete: "system.loginLog.delete",
    },
  },
  actions: ["query", "delete", "batchDelete"],
  softDelete: false,
  audit: false,
  list: {
    select: {
      id: sysLoginRecord.id,
      username: sysLoginRecord.username,
      ip: sysLoginRecord.ip,
      userAgent: sysLoginRecord.userAgent,
      status: sysLoginRecord.status,
      message: sysLoginRecord.message,
      createdAt: sysLoginRecord.createdAt,
    },
    searchable: {
      username: "like",
      ip: "like",
      userAgent: "like",
      status: "=",
      message: "like",
      createdAt: "betweenDate",
    },
    quickSearchFields: ["username", "ip", "userAgent", "message"],
    sortableFields: ["id", "createdAt", "status"],
    defaultSort: { field: "createdAt", order: "desc" },
  },
});

export const loginLogRoutes = new Hono<{ Variables: HonoVariables }>();

loginLogRoutes.delete(
  "/login/log/clean",
  authRequired(),
  ability("system.loginLog.clean"),
  async (c) => {
    const payload = z
      .object({
        before: z.string().datetime().optional(),
        status: z.coerce.number().optional(),
      })
      .parse(await c.req.json().catch(() => ({})));

    await runWithOperationLog(
      c,
      {
        module: "system.loginLog",
        action: "clean",
        resource: "/login/log",
        details: payload,
      },
      async () => {
        const conditions: string[] = [];
        const values: Array<string | number> = [];
        if (payload.before) {
          conditions.push("created_at < ?");
          values.push(payload.before);
        }
        if (payload.status !== undefined) {
          conditions.push("status = ?");
          values.push(payload.status);
        }
        await sqlite
          .prepare(`DELETE FROM sys_login_record${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}`)
          .run(...values);
      },
    );

    return c.json(success(null, "清理成功"));
  },
);

loginLogRoutes.route("/", loginLogCrud.routes);
