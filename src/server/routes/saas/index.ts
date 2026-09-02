import { type Context, Hono } from "hono";
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
  setSaasContext,
  updateTenant,
  updateWorkspace,
} from "@/server/services/saas-control-plane-service";
import {
  createSaasModule,
  createTenantEntitlement,
  listSaasModules,
  listTenantEntitlements,
  resolveEffectiveSaasModules,
  updateSaasModule,
  updateTenantEntitlement,
} from "@/server/services/saas-entitlement-service";
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  listTenantMembers,
  listWorkspaceMembers,
  removeTenantMember,
  removeWorkspaceMember,
  revokeInvitation,
  upsertTenantMember,
  upsertWorkspaceMember,
} from "@/server/services/saas-membership-service";
import {
  getSaaSFile,
  listSaaSFiles,
  readSaaSFile,
  updateSaaSFileBinding,
  uploadSaaSFile,
} from "@/server/services/saas-file-service";
import {
  readSaaSContextSelection,
  resolveSaaSResourceScope,
} from "@/server/services/saas-resource-scope-service";
import { sqlite } from "@/server/db";
import { runWithOperationLog } from "@/server/services/operation-log-service";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().trim().max(100).optional(),
  status: z.string().trim().max(30).optional(),
});

const tenantCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{1,49}$/),
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
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]{1,49}$/),
  description: z.string().trim().max(500).optional().nullable(),
});

const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  status: z.enum(["active", "archived"]).optional(),
});

const memberListSchema = listSchema.extend({
  status: z.enum(["active", "suspended"]).optional(),
});

const tenantMemberSchema = z.object({
  role: z.enum(["admin", "member", "viewer"]),
  status: z.enum(["active", "suspended"]).default("active"),
});

const workspaceMemberSchema = z.object({
  role: z.enum(["editor", "reviewer", "viewer"]),
  status: z.enum(["active", "suspended"]).default("active"),
});

const invitationCreateSchema = z.object({
  tenantId: z.coerce.number().int().positive(),
  workspaceId: z.coerce.number().int().positive().optional().nullable(),
  email: z.string().trim().email().max(255),
  tenantRole: z.enum(["admin", "member", "viewer"]).default("member"),
  workspaceRole: z.enum(["editor", "reviewer", "viewer"]).optional().nullable(),
  expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
});

const invitationAcceptSchema = z.object({
  token: z.string().trim().min(20).max(500),
});

function csvValues(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string")
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  return [];
}

const moduleBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i),
  description: z.string().trim().max(500).optional().nullable(),
  status: z.enum(["draft", "active", "disabled", "retired"]),
  routeKey: z
    .string()
    .trim()
    .regex(/^[a-z][A-Za-z0-9.]+$/)
    .max(100),
  routePath: z.string().trim().startsWith("/").max(200),
  requiredAbility: z
    .string()
    .trim()
    .regex(/^[a-z][A-Za-z0-9.]+$/)
    .max(120),
  dependencies: z.preprocess(csvValues, z.array(z.string().min(1).max(80)).max(50)).optional(),
  capabilities: z.preprocess(csvValues, z.array(z.string().min(1).max(80)).max(100)).optional(),
  dependenciesCsv: z.unknown().optional(),
  capabilitiesCsv: z.unknown().optional(),
});

const moduleCreateSchema = moduleBaseSchema
  .extend({
    code: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{1,49}$/),
  })
  .transform((value) => ({
    ...value,
    dependencies: value.dependencies ?? csvValues(value.dependenciesCsv),
    capabilities: value.capabilities ?? csvValues(value.capabilitiesCsv),
  }));

const moduleUpdateSchema = moduleBaseSchema.partial().transform((value) => ({
  ...value,
  ...(value.dependencies !== undefined || value.dependenciesCsv !== undefined
    ? { dependencies: value.dependencies ?? csvValues(value.dependenciesCsv) }
    : {}),
  ...(value.capabilities !== undefined || value.capabilitiesCsv !== undefined
    ? { capabilities: value.capabilities ?? csvValues(value.capabilitiesCsv) }
    : {}),
}));

const nullableDateTime = z.string().datetime({ offset: true }).optional().nullable();
const entitlementValuesSchema = z.object({
  status: z.enum(["trial", "active", "suspended", "expired"]),
  source: z.enum(["manual", "trial", "plan"]),
  startsAt: z.string().datetime({ offset: true }).optional(),
  expiresAt: nullableDateTime,
  memberLimitOverride: z.coerce.number().int().min(1).optional().nullable(),
  monthlyTaskLimitOverride: z.coerce.number().int().min(0).optional().nullable(),
  maxConcurrentTaskOverride: z.coerce.number().int().min(1).optional().nullable(),
  exportProfileOverride: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const entitlementCreateSchema = entitlementValuesSchema.extend({
  tenantId: z.coerce.number().int().positive(),
  moduleId: z.coerce.number().int().positive(),
});

const entitlementUpdateSchema = entitlementValuesSchema.partial();
const contextSelectionSchema = z.object({
  tenantId: z.coerce.number().int().positive(),
  workspaceId: z.coerce.number().int().positive().optional().nullable(),
});

const saasFileBindingSchema = z.object({
  resourceType: z.string().trim().min(1).max(100).optional().nullable(),
  resourceId: z
    .union([z.string().trim().min(1).max(200), z.coerce.number()])
    .optional()
    .nullable(),
  purpose: z.string().trim().max(100).optional().nullable(),
});

async function currentResourceScope(c: Context<{ Variables: HonoVariables }>) {
  const selection = readSaaSContextSelection({
    tenantId: c.req.header("x-saas-tenant-id"),
    workspaceId: c.req.header("x-saas-workspace-id"),
  });
  return resolveSaaSResourceScope({ userId: c.get("user").id, ...selection });
}

export const saasRoutes = new Hono<{ Variables: HonoVariables }>();

saasRoutes.get("/context", authRequired(), async (c) => {
  const query = contextSelectionSchema.partial().parse(c.req.query());
  const headerTenantId = c.req.header("x-saas-tenant-id");
  const headerWorkspaceId = c.req.header("x-saas-workspace-id");
  const tenantId =
    query.tenantId ??
    (headerTenantId ? z.coerce.number().int().positive().parse(headerTenantId) : undefined);
  const workspaceId =
    query.workspaceId ??
    (query.tenantId == null && headerWorkspaceId
      ? z.coerce.number().int().positive().parse(headerWorkspaceId)
      : undefined);
  const context = await getSaasContext(c.get("user").id, { tenantId, workspaceId });
  const effectiveModules = context.currentTenantId
    ? await resolveEffectiveSaasModules({
        tenantId: context.currentTenantId,
        userId: c.get("user").id,
        abilities: c.get("abilities") ?? [],
      })
    : [];
  return c.json(success({ ...context, effectiveModules }));
});

saasRoutes.put("/context", authRequired(), async (c) => {
  const payload = contextSelectionSchema.parse(await c.req.json());
  const context = await runWithOperationLog(
    c,
    {
      module: "saas.context",
      action: "switch",
      resource: "saas_user_context",
      resourceId: c.get("user").id,
      riskLevel: "low",
      details: { tenantId: payload.tenantId, workspaceId: payload.workspaceId ?? null },
    },
    () => setSaasContext({ ...payload, userId: c.get("user").id }),
  );
  const effectiveModules = context.currentTenantId
    ? await resolveEffectiveSaasModules({
        tenantId: context.currentTenantId,
        userId: c.get("user").id,
        abilities: c.get("abilities") ?? [],
      })
    : [];
  return c.json(success({ ...context, effectiveModules }, "当前工作上下文已切换"));
});

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
  const query = listSchema
    .extend({ tenantId: z.coerce.number().int().positive().optional() })
    .parse(c.req.query());
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

saasRoutes.get("/tenant-members", authRequired(), ability("saas.member.query"), async (c) => {
  const query = memberListSchema
    .extend({ tenantId: z.coerce.number().int().positive() })
    .parse(c.req.query());
  return c.json(success(await listTenantMembers({ ...query, userId: c.get("user").id })));
});

saasRoutes.put(
  "/tenant-members/:tenantId/:userId",
  authRequired(),
  ability("saas.member.update"),
  async (c) => {
    const tenantId = z.coerce.number().int().positive().parse(c.req.param("tenantId"));
    const targetUserId = z.coerce.number().int().positive().parse(c.req.param("userId"));
    const payload = tenantMemberSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "saas.member",
        action: "updateTenantMember",
        resource: "saas_tenant_member",
        resourceId: `${tenantId}:${targetUserId}`,
        riskLevel: "high",
        details: { tenantId, targetUserId, role: payload.role, status: payload.status },
      },
      () =>
        upsertTenantMember({
          ...payload,
          tenantId,
          targetUserId,
          userId: c.get("user").id,
        }),
    );
    return c.json(success(result, "Tenant 成员已更新"));
  },
);

saasRoutes.get("/files", authRequired(), ability("saas.workspace.query"), async (c) => {
  const query = listSchema.parse(c.req.query());
  const scope = await currentResourceScope(c);
  return c.json(success(await listSaaSFiles({ ...query, scope })));
});

saasRoutes.post("/files/upload", authRequired(), ability("saas.workspace.update"), async (c) => {
  const user = c.get("user");
  const scope = await currentResourceScope(c);
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new Error("请选择文件");
  const binding = saasFileBindingSchema.parse({
    resourceType: body.resourceType || null,
    resourceId: body.resourceId || null,
    purpose: body.purpose || null,
  });
  const result = await runWithOperationLog(
    c,
    {
      module: "saas.file",
      action: "upload",
      resource: "saas_file_binding",
      riskLevel: "medium",
      saasScope: scope,
      details: {
        originalName: file.name,
        resourceType: binding.resourceType,
        purpose: binding.purpose,
      },
    },
    () => uploadSaaSFile({ userId: user.id, scope, file, ...binding }),
  );
  return c.json(success(result, "SaaS 文件上传成功"));
});

saasRoutes.get("/files/:id", authRequired(), ability("saas.workspace.query"), async (c) => {
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const scope = await currentResourceScope(c);
  return c.json(success(await getSaaSFile(scope, id)));
});

saasRoutes.get(
  "/files/:id/download",
  authRequired(),
  ability("saas.workspace.query"),
  async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param("id"));
    const scope = await currentResourceScope(c);
    const { row, buffer } = await readSaaSFile(scope, id);
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(row.originalName)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);

saasRoutes.put(
  "/files/:id/binding",
  authRequired(),
  ability("saas.workspace.update"),
  async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param("id"));
    const payload = saasFileBindingSchema.parse(await c.req.json());
    const scope = await currentResourceScope(c);
    const result = await runWithOperationLog(
      c,
      {
        module: "saas.file",
        action: "bind",
        resource: "saas_file_binding",
        resourceId: id,
        riskLevel: "medium",
        saasScope: scope,
        details: { resourceType: payload.resourceType, purpose: payload.purpose },
      },
      () => updateSaaSFileBinding({ userId: c.get("user").id, scope, fileId: id, ...payload }),
    );
    return c.json(success(result, "SaaS 文件绑定已更新"));
  },
);

saasRoutes.delete(
  "/files/:id/binding",
  authRequired(),
  ability("saas.workspace.update"),
  async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param("id"));
    const scope = await currentResourceScope(c);
    const result = await runWithOperationLog(
      c,
      {
        module: "saas.file",
        action: "unbind",
        resource: "saas_file_binding",
        resourceId: id,
        riskLevel: "medium",
        saasScope: scope,
      },
      () =>
        updateSaaSFileBinding({
          userId: c.get("user").id,
          scope,
          fileId: id,
          resourceType: null,
          resourceId: null,
          purpose: null,
        }),
    );
    return c.json(success(result, "SaaS 文件业务绑定已移除"));
  },
);

saasRoutes.get("/audit", authRequired(), ability("saas.workspace.query"), async (c) => {
  const scope = await currentResourceScope(c);
  const query = listSchema.parse(c.req.query());
  const total = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total FROM sys_operation_log
       WHERE tenant_id = ? AND workspace_id = ?`,
    )
    .get(scope.tenantId, scope.workspaceId)) as { total: number };
  const rows = await sqlite
    .prepare(
      `SELECT id, user_id AS "userId", username, module, action, resource, resource_id AS "resourceId",
        request_id AS "requestId", status, success, risk_level AS "riskLevel", message, created_at AS "createdAt"
       FROM sys_operation_log
       WHERE tenant_id = ? AND workspace_id = ?
       ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(scope.tenantId, scope.workspaceId, query.pageSize, (query.page - 1) * query.pageSize);
  return c.json(
    success({ data: rows, page: query.page, pageSize: query.pageSize, total: Number(total.total) }),
  );
});

saasRoutes.delete(
  "/tenant-members/:tenantId/:userId",
  authRequired(),
  ability("saas.member.remove"),
  async (c) => {
    const tenantId = z.coerce.number().int().positive().parse(c.req.param("tenantId"));
    const targetUserId = z.coerce.number().int().positive().parse(c.req.param("userId"));
    const result = await runWithOperationLog(
      c,
      {
        module: "saas.member",
        action: "removeTenantMember",
        resource: "saas_tenant_member",
        resourceId: `${tenantId}:${targetUserId}`,
        riskLevel: "high",
        details: { tenantId, targetUserId },
      },
      () => removeTenantMember({ tenantId, targetUserId, userId: c.get("user").id }),
    );
    return c.json(success(result, "Tenant 成员已移除"));
  },
);

saasRoutes.get("/workspace-members", authRequired(), ability("saas.member.query"), async (c) => {
  const query = memberListSchema
    .extend({ workspaceId: z.coerce.number().int().positive() })
    .parse(c.req.query());
  return c.json(success(await listWorkspaceMembers({ ...query, userId: c.get("user").id })));
});

saasRoutes.put(
  "/workspace-members/:workspaceId/:userId",
  authRequired(),
  ability("saas.member.update"),
  async (c) => {
    const workspaceId = z.coerce.number().int().positive().parse(c.req.param("workspaceId"));
    const targetUserId = z.coerce.number().int().positive().parse(c.req.param("userId"));
    const payload = workspaceMemberSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "saas.member",
        action: "updateWorkspaceMember",
        resource: "saas_workspace_member",
        resourceId: `${workspaceId}:${targetUserId}`,
        riskLevel: "high",
        details: { workspaceId, targetUserId, role: payload.role, status: payload.status },
      },
      () =>
        upsertWorkspaceMember({
          ...payload,
          workspaceId,
          targetUserId,
          userId: c.get("user").id,
        }),
    );
    return c.json(success(result, "Workspace 成员已更新"));
  },
);

saasRoutes.delete(
  "/workspace-members/:workspaceId/:userId",
  authRequired(),
  ability("saas.member.remove"),
  async (c) => {
    const workspaceId = z.coerce.number().int().positive().parse(c.req.param("workspaceId"));
    const targetUserId = z.coerce.number().int().positive().parse(c.req.param("userId"));
    const result = await runWithOperationLog(
      c,
      {
        module: "saas.member",
        action: "removeWorkspaceMember",
        resource: "saas_workspace_member",
        resourceId: `${workspaceId}:${targetUserId}`,
        riskLevel: "high",
        details: { workspaceId, targetUserId },
      },
      () => removeWorkspaceMember({ workspaceId, targetUserId, userId: c.get("user").id }),
    );
    return c.json(success(result, "Workspace 成员已移除"));
  },
);

saasRoutes.get("/invitations", authRequired(), ability("saas.member.query"), async (c) => {
  const query = listSchema
    .extend({ tenantId: z.coerce.number().int().positive() })
    .parse(c.req.query());
  return c.json(success(await listInvitations({ ...query, userId: c.get("user").id })));
});

saasRoutes.post("/invitations", authRequired(), ability("saas.member.invite"), async (c) => {
  const payload = invitationCreateSchema.parse(await c.req.json());
  const result = await runWithOperationLog(
    c,
    {
      module: "saas.invitation",
      action: "create",
      resource: "saas_invitation",
      riskLevel: "high",
      details: {
        tenantId: payload.tenantId,
        workspaceId: payload.workspaceId,
        email: payload.email,
        tenantRole: payload.tenantRole,
        workspaceRole: payload.workspaceRole,
      },
    },
    () => createInvitation({ ...payload, userId: c.get("user").id }),
  );
  return c.json(success(result, "邀请已创建；Token 仅在本次响应返回"));
});

saasRoutes.post(
  "/invitations/:id/revoke",
  authRequired(),
  ability("saas.member.revokeInvite"),
  async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param("id"));
    const result = await runWithOperationLog(
      c,
      {
        module: "saas.invitation",
        action: "revoke",
        resource: "saas_invitation",
        resourceId: id,
        riskLevel: "high",
      },
      () => revokeInvitation({ id, userId: c.get("user").id }),
    );
    return c.json(success(result, "邀请已撤销"));
  },
);

saasRoutes.post("/invitations/accept", authRequired(), async (c) => {
  const payload = invitationAcceptSchema.parse(await c.req.json());
  const result = await runWithOperationLog(
    c,
    {
      module: "saas.invitation",
      action: "accept",
      resource: "saas_invitation",
      riskLevel: "medium",
      details: { userId: c.get("user").id },
    },
    () => acceptInvitation({ token: payload.token, userId: c.get("user").id }),
  );
  return c.json(success(result, "邀请已接受"));
});

saasRoutes.get("/modules/effective", authRequired(), async (c) => {
  const tenantId = z.coerce.number().int().positive().parse(c.req.query("tenantId"));
  return c.json(
    success(
      await resolveEffectiveSaasModules({
        tenantId,
        userId: c.get("user").id,
        abilities: c.get("abilities") ?? [],
      }),
    ),
  );
});

saasRoutes.get("/modules", authRequired(), ability("saas.module.query"), async (c) => {
  const query = listSchema.parse(c.req.query());
  return c.json(success(await listSaasModules(query)));
});

saasRoutes.post("/modules", authRequired(), ability("saas.module.create"), async (c) => {
  const payload = moduleCreateSchema.parse(await c.req.json());
  const result = await runWithOperationLog(
    c,
    {
      module: "saas.module",
      action: "create",
      resource: "saas_module",
      riskLevel: "high",
      details: { code: payload.code, routeKey: payload.routeKey, status: payload.status },
    },
    () => createSaasModule({ ...payload, userId: c.get("user").id }),
  );
  return c.json(success(result, "模块定义已创建"));
});

saasRoutes.put("/modules/:id", authRequired(), ability("saas.module.update"), async (c) => {
  const id = z.coerce.number().int().positive().parse(c.req.param("id"));
  const payload = moduleUpdateSchema.parse(await c.req.json());
  const result = await runWithOperationLog(
    c,
    {
      module: "saas.module",
      action: "update",
      resource: "saas_module",
      resourceId: id,
      riskLevel: payload.status === "active" ? "high" : "medium",
      details: { fields: Object.keys(payload), status: payload.status },
    },
    () => updateSaasModule({ ...payload, id, userId: c.get("user").id }),
  );
  return c.json(success(result, "模块定义已更新"));
});

saasRoutes.get(
  "/entitlements",
  authRequired(),
  ability("saas.module.entitlementQuery"),
  async (c) => {
    const query = listSchema
      .extend({
        tenantId: z.coerce.number().int().positive().optional(),
        moduleId: z.coerce.number().int().positive().optional(),
      })
      .parse(c.req.query());
    return c.json(success(await listTenantEntitlements({ ...query, userId: c.get("user").id })));
  },
);

saasRoutes.post(
  "/entitlements",
  authRequired(),
  ability("saas.module.entitlementCreate"),
  async (c) => {
    const payload = entitlementCreateSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "saas.entitlement",
        action: "create",
        resource: "saas_tenant_entitlement",
        riskLevel: "high",
        details: {
          tenantId: payload.tenantId,
          moduleId: payload.moduleId,
          status: payload.status,
          source: payload.source,
        },
      },
      () => createTenantEntitlement({ ...payload, userId: c.get("user").id }),
    );
    return c.json(success(result, "Tenant Entitlement 已开通"));
  },
);

saasRoutes.put(
  "/entitlements/:id",
  authRequired(),
  ability("saas.module.entitlementUpdate"),
  async (c) => {
    const id = z.coerce.number().int().positive().parse(c.req.param("id"));
    const payload = entitlementUpdateSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "saas.entitlement",
        action: "update",
        resource: "saas_tenant_entitlement",
        resourceId: id,
        riskLevel: "high",
        details: { fields: Object.keys(payload), status: payload.status, source: payload.source },
      },
      () => updateTenantEntitlement({ ...payload, id, userId: c.get("user").id }),
    );
    return c.json(success(result, "Tenant Entitlement 已更新"));
  },
);
