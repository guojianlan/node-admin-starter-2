import { desc, eq, sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { db } from "@/server/db";
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

operationLogRoutes.route("/", operationLogCrud.routes);
