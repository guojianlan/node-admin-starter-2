import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  createTenant,
  createWorkspace,
  getSaasContext,
  listTenants,
  listWorkspaces,
  updateTenant,
  updateWorkspace,
} from "@/server/services/saas-control-plane-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().trim().max(100).optional(),
  status: z.string().trim().max(30).optional(),
});

const tenantCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().regex(/^[a-z][a-z0-9-]{1,49}$/),
  region: z.string().trim().min(1).max(50).default("global"),
  retentionDays: z.coerce.number().int().min(1).max(3650).default(365),
});

const tenantUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  region: z.string().trim().min(1).max(50).optional(),
  status: z.enum(["active", "suspended", "archived"]).optional(),
  retentionDays: z.coerce.number().int().min(1).max(3650).optional(),
});

const workspaceCreateSchema = z.object({
  tenantId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().regex(/^[a-z][a-z0-9-]{1,49}$/),
  description: z.string().trim().max(500).optional().nullable(),
});

const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  status: z.enum(["active", "archived"]).optional(),
});

export const saasRoutes = new Hono<{ Variables: HonoVariables }>();

saasRoutes.get("/context", authRequired(), async (c) =>
  c.json(success(await getSaasContext(c.get("user").id))),
);

saasRoutes.get("/tenants", authRequired(), ability("saas.tenant.query"), async (c) => {
  const query = listSchema.parse(c.req.query());
  return c.json(success(await listTenants({ ...query, userId: c.get("user").id })));
});

saasRoutes.post("/tenants", authRequired(), ability("saas.tenant.create"), async (c) => {
  const payload = tenantCreateSchema.parse(await c.req.json());
  const result = await runWithOperationLog(
    c,
    {
      module: "saas.tenant",
      action: "create",
      resource: "saas_tenant",
      riskLevel: "medium",
      details: { code: payload.code, region: payload.region },
    },
    () => createTenant({ ...payload, userId: c.get("user").id }),
  );
  return c.json(success(result, "Tenant 创建成功"));
});

saasRoutes.put("/tenants/:id", authRequired(), ability("saas.tenant.update"), async (c) => {
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const payload = tenantUpdateSchema.parse(await c.req.json());
  const result = await runWithOperationLog(
    c,
    {
      module: "saas.tenant",
      action: "update",
      resource: "saas_tenant",
      resourceId: id,
      riskLevel: payload.status && payload.status !== "active" ? "high" : "medium",
      details: { fields: Object.keys(payload), status: payload.status },
    },
    () => updateTenant({ ...payload, id, userId: c.get("user").id }),
  );
  return c.json(success(result, "Tenant 更新成功"));
});

saasRoutes.get("/workspaces", authRequired(), ability("saas.workspace.query"), async (c) => {
  const query = listSchema.extend({ tenantId: z.coerce.number().int().positive().optional() }).parse(c.req.query());
  return c.json(success(await listWorkspaces({ ...query, userId: c.get("user").id })));
});

saasRoutes.post("/workspaces", authRequired(), ability("saas.workspace.create"), async (c) => {
  const payload = workspaceCreateSchema.parse(await c.req.json());
  const result = await runWithOperationLog(
    c,
    {
      module: "saas.workspace",
      action: "create",
      resource: "saas_workspace",
      riskLevel: "medium",
      details: { tenantId: payload.tenantId, code: payload.code },
    },
    () => createWorkspace({ ...payload, userId: c.get("user").id }),
  );
  return c.json(success(result, "Workspace 创建成功"));
});

saasRoutes.put("/workspaces/:id", authRequired(), ability("saas.workspace.update"), async (c) => {
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const payload = workspaceUpdateSchema.parse(await c.req.json());
  const result = await runWithOperationLog(
    c,
    {
      module: "saas.workspace",
      action: "update",
      resource: "saas_workspace",
      resourceId: id,
      riskLevel: payload.status === "archived" ? "high" : "medium",
      details: { fields: Object.keys(payload), status: payload.status },
    },
    () => updateWorkspace({ ...payload, id, userId: c.get("user").id }),
  );
  return c.json(success(result, "Workspace 更新成功"));
});
