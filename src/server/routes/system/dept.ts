import { Hono } from "hono";
import { z } from "zod";
import { buildTree } from "@/lib/tree";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { nowIso, sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildListQuery } from "@/server/services/list-query";

const deptSchema = z.object({
  parentId: z.coerce.number().default(0),
  name: z.string().min(1),
  code: z.string().optional().nullable(),
  sort: z.coerce.number().default(0),
  leader: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  status: z.coerce.number().default(1),
});

export const deptRoutes = new Hono<{ Variables: HonoVariables }>();

deptRoutes.get("/dept", authRequired(), ability("system.dept.query"), (c) => {
  const page = buildListQuery(c.req.url, {
    table: "sys_dept d",
    select: `
      d.id,
      d.parent_id AS parentId,
      d.name,
      d.code,
      d.sort,
      d.leader,
      d.phone,
      d.status,
      d.created_at AS createdAt
    `,
    fieldMap: {
      id: "d.id",
      parentId: "d.parent_id",
      name: "d.name",
      code: "d.code",
      status: "d.status",
      sort: "d.sort",
      createdAt: "d.created_at",
    },
    searchable: {
      name: "like",
      code: "like",
      status: "=",
    },
    quickSearchFields: ["name", "code", "leader", "phone"],
    sortableFields: ["id", "sort", "status", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
    baseWhere: ["d.deleted_at IS NULL"],
  });
  return c.json(success(page));
});

deptRoutes.get("/dept/tree", authRequired(), ability("system.dept.query"), (c) => {
  const rows = sqlite
    .prepare(
      `SELECT id, parent_id AS parentId, name, code, sort, leader, phone, status
       FROM sys_dept
       WHERE deleted_at IS NULL
       ORDER BY sort ASC, id ASC`,
    )
    .all() as Array<{ id: number; parentId: number }>;
  return c.json(success(buildTree(rows)));
});

deptRoutes.post("/dept", authRequired(), ability("system.dept.create"), async (c) => {
  const payload = deptSchema.parse(await c.req.json());
  const now = nowIso();
  sqlite
    .prepare(
      `INSERT INTO sys_dept
        (parent_id, name, code, sort, leader, phone, status, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      payload.parentId,
      payload.name,
      payload.code ?? null,
      payload.sort,
      payload.leader ?? null,
      payload.phone ?? null,
      payload.status,
      now,
      now,
    );
  return c.json(success(null, "创建成功"));
});

deptRoutes.put("/dept/:id", authRequired(), ability("system.dept.update"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = deptSchema.partial().parse(await c.req.json());
  sqlite
    .prepare(
      `UPDATE sys_dept
       SET parent_id = COALESCE(?, parent_id),
           name = COALESCE(?, name),
           code = ?,
           sort = COALESCE(?, sort),
           leader = ?,
           phone = ?,
           status = COALESCE(?, status),
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      payload.parentId ?? null,
      payload.name ?? null,
      payload.code ?? null,
      payload.sort ?? null,
      payload.leader ?? null,
      payload.phone ?? null,
      payload.status ?? null,
      nowIso(),
      id,
    );
  return c.json(success(null, "更新成功"));
});

deptRoutes.delete("/dept/:id", authRequired(), ability("system.dept.delete"), (c) => {
  const id = Number(c.req.param("id"));
  sqlite.prepare("UPDATE sys_dept SET deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), id);
  return c.json(success(null, "删除成功"));
});
