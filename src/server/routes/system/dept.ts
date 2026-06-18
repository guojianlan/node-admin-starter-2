import { Hono } from "hono";
import { z } from "zod";
import { buildTree } from "@/lib/tree";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { sqlite } from "@/server/db";
import { sysDept } from "@/server/db/schema";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
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

const deptCrud = createCrudRoutes({
  basePath: "/dept",
  table: sysDept,
  idColumn: sysDept.id,
  createSchema: deptSchema,
  updateSchema: deptSchema.partial(),
  permissions: { prefix: "system.dept" },
  list: {
    select: {
      id: sysDept.id,
      parentId: sysDept.parentId,
      name: sysDept.name,
      code: sysDept.code,
      sort: sysDept.sort,
      leader: sysDept.leader,
      phone: sysDept.phone,
      status: sysDept.status,
      createdAt: sysDept.createdAt,
    },
    searchable: {
      name: "like",
      code: "like",
      status: "=",
    },
    quickSearchFields: ["name", "code", "leader", "phone"],
    sortableFields: ["id", "sort", "status", "createdAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    beforeDelete: (_ctx, ids) => {
      if (ids.includes(1)) throw new Error("不能删除默认部门");
    },
  },
});

export const deptRoutes = new Hono<{ Variables: HonoVariables }>();

deptRoutes.get("/dept/tree", authRequired(), ability("system.dept.query"), async (c) => {
  const rows = (await sqlite
    .prepare(
      `SELECT id, parent_id AS parentId, name, code, sort, leader, phone, status
       FROM sys_dept
       WHERE deleted_at IS NULL
       ORDER BY sort ASC, id ASC`,
    )
    .all()) as Array<{ id: number; parentId: number }>;
  return c.json(success(buildTree(rows)));
});

deptRoutes.get("/dept/users/:id", authRequired(), ability("system.dept.query"), async (c) => {
  const deptId = Number(c.req.param("id"));
  if (!Number.isFinite(deptId)) throw new Error("部门不存在");

  const page = await buildListQuery(c.req.url, {
    table: "sys_user u",
    select: `
      u.id,
      u.username,
      u.nickname,
      u.email,
      u.mobile,
      u.status,
      u.created_at AS createdAt
    `,
    fieldMap: {
      id: "u.id",
      username: "u.username",
      nickname: "u.nickname",
      email: "u.email",
      mobile: "u.mobile",
      status: "u.status",
      createdAt: "u.created_at",
    },
    searchable: {
      username: "like",
      nickname: "like",
      email: "like",
      mobile: "like",
      status: "=",
    },
    quickSearchFields: ["username", "nickname", "email", "mobile"],
    sortableFields: ["id", "username", "status", "createdAt"],
    defaultSort: { field: "id", order: "asc" },
    baseWhere: [`u.dept_id = ${deptId}`, "u.deleted_at IS NULL"],
  });
  return c.json(success(page));
});

deptRoutes.route("/", deptCrud.routes);
