import { desc, eq, sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { db, sqlite } from "@/server/db";
import { sysOperationLog } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { z } from "zod";

const noopSchema = z.object({});

const operationLogCrud = createCrudRoutes({
  basePath: "/operation/log",
  table: sysOperationLog,
  idColumn: sysOperationLog.id,
  createSchema: noopSchema,
  updateSchema: noopSchema,
  permissions: { prefix: "system.operationLog", actions: { query: "system.operationLog.query" } },
  actions: ["query"],
  softDelete: false,
  audit: false,
  list: {
    select: {
      id: sysOperationLog.id,
      userId: sysOperationLog.userId,
      username: sysOperationLog.username,
      module: sysOperationLog.module,
      action: sysOperationLog.action,
      resource: sysOperationLog.resource,
      resourceId: sysOperationLog.resourceId,
      method: sysOperationLog.method,
      path: sysOperationLog.path,
      ip: sysOperationLog.ip,
      userAgent: sysOperationLog.userAgent,
      requestId: sysOperationLog.requestId,
      status: sysOperationLog.status,
      success: sysOperationLog.success,
      message: sysOperationLog.message,
      durationMs: sysOperationLog.durationMs,
      detailsJson: sysOperationLog.detailsJson,
      createdAt: sysOperationLog.createdAt,
    },
    searchable: {
      userId: "=",
      username: "like",
      module: "like",
      action: "like",
      resource: "like",
      resourceId: "like",
      method: "=",
      path: "like",
      requestId: "like",
      status: "=",
      success: "=",
      createdAt: "betweenDate",
    },
    quickSearchFields: ["username", "module", "action", "resource", "path", "requestId"],
    sortableFields: ["id", "createdAt", "durationMs", "status"],
    defaultSort: { field: "createdAt", order: "desc" },
  },
});

export const operationLogRoutes = new Hono<{ Variables: HonoVariables }>();

operationLogRoutes.get(
  "/operation/log/stats",
  authRequired(),
  ability("system.operationLog.query"),
  async (c) => {
    const rows = await db
      .select({
        module: sysOperationLog.module,
        total: drizzleSql<number>`COUNT(1)::int`,
        failed: drizzleSql<number>`COUNT(*) FILTER (WHERE ${sysOperationLog.success} = false)::int`,
        lastAt: drizzleSql<Date>`MAX(${sysOperationLog.createdAt})`,
      })
      .from(sysOperationLog)
      .groupBy(sysOperationLog.module)
      .orderBy(desc(drizzleSql`MAX(${sysOperationLog.createdAt})`));

    const failedTotal = await db
      .select({ total: drizzleSql<number>`COUNT(1)::int` })
      .from(sysOperationLog)
      .where(eq(sysOperationLog.success, false));

    return c.json(
      success({
        modules: rows,
        failedTotal: Number(failedTotal[0]?.total ?? 0),
      }),
    );
  },
);

operationLogRoutes.get(
  "/operation/log/export",
  authRequired(),
  ability("system.operationLog.export"),
  async () => {
    const rows = (await sqlite
      .prepare(
        `SELECT
          id,
          username,
          module,
          action,
          method,
          path,
          status,
          success,
          request_id AS requestId,
          ip,
          created_at AS createdAt
         FROM sys_operation_log
         ORDER BY created_at DESC
         LIMIT 5000`,
      )
      .all()) as Array<Record<string, unknown>>;
    const headers = [
      "id",
      "username",
      "module",
      "action",
      "method",
      "path",
      "status",
      "success",
      "requestId",
      "ip",
      "createdAt",
    ];
    const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = [headers.join(","), ...rows.map((row) => headers.map((key) => escapeCsv(row[key])).join(","))].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="operation-log-${Date.now()}.csv"`,
      },
    });
  },
);

operationLogRoutes.delete(
  "/operation/log/clean",
  authRequired(),
  ability("system.operationLog.clean"),
  async (c) => {
    const payload = z
      .object({
        before: z.coerce.date().optional(),
        success: z.coerce.boolean().optional(),
      })
      .parse(await c.req.json().catch(() => ({})));
    const conditions: string[] = [];
    const params: Array<string | boolean> = [];
    if (payload.before) {
      conditions.push("created_at < ?");
      params.push(payload.before.toISOString());
    }
    if (payload.success !== undefined) {
      conditions.push("success = ?");
      params.push(payload.success);
    }
    if (!conditions.length) throw new Error("请选择清理条件");
    await sqlite
      .prepare(`DELETE FROM sys_operation_log WHERE ${conditions.join(" AND ")}`)
      .run(...params);
    return c.json(success(null, "清理成功"));
  },
);

operationLogRoutes.route("/", operationLogCrud.routes);
