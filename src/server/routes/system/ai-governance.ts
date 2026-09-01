import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  addAiBillingAdjustment,
  cancelAiJob,
  completeAiMcpOAuth,
  connectAiMcpServer,
  deleteAiMcpServer,
  deleteAiMemory,
  deleteAiRuntimeSkill,
  disconnectAiMcpConnection,
  listAiBillingLedger,
  listAiCircuits,
  listAiJobs,
  listAiMcpServers,
  listAiMcpConnections,
  listAiMcpTools,
  listAiMemories,
  listAiMemoryCandidates,
  listAiQuotaPolicies,
  listAiRuntimeSkills,
  listAiRuntimeSkillVersions,
  provisionInternalSystemMcp,
  resetAiCircuit,
  retryAiJob,
  saveAiCircuitPolicy,
  saveAiMcpServer,
  saveAiMemory,
  saveAiQuotaPolicy,
  saveAiRuntimeSkill,
  createAiRuntimeSkillVersion,
  publishAiRuntimeSkillVersion,
  rollbackAiRuntimeSkillVersion,
  decideAiMemoryCandidate,
  settleAiBillingEntry,
  setAiMcpToolPolicy,
  syncAiMcpTools,
} from "@/server/services/ai-governance-service";
import { enqueueAiJob } from "@/server/services/ai-job-service";
import {
  handleInternalSystemMcpRpc,
  issueInternalSystemMcpToken,
} from "@/server/services/ai-system-mcp-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";

const id = z.coerce.number().int().positive();
const memorySchema = z.object({
  scopeType: z.enum(["user", "agent"]),
  agentId: id.nullable().optional(),
  content: z.string().trim().min(1).max(12000),
  writePolicy: z.enum(["manual", "confirmed"]).default("manual"),
  sourceSessionId: id.nullable().optional(),
  sourceMessageId: id.nullable().optional(),
  status: z.enum(["active", "archived"]).default("active"),
  expiresAt: z.string().datetime().nullable().optional(),
  importance: z.coerce.number().int().min(0).max(100).default(50),
});
const skillSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]*$/)
    .max(100),
  description: z.string().trim().max(1000).nullable().optional(),
  instructions: z.string().trim().min(1).max(20000),
  status: z.coerce.number().int().min(0).max(1).default(1),
  sort: z.coerce.number().int().min(0).max(999999).default(0),
  toolIds: z.array(id).max(100).default([]),
  agentIds: z.array(id).max(100).default([]),
});
const mcpServerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9-]*$/)
    .max(100),
  endpointUrl: z.string().trim().url().max(2000),
  transport: z.enum(["streamable_http", "sse"]).default("streamable_http"),
  oauthMode: z.enum(["none", "client_credentials", "authorization_code"]).default("none"),
  clientId: z.string().trim().max(500).nullable().optional(),
  clientSecret: z.string().max(4000).nullable().optional(),
  authorizationUrl: z.string().trim().url().max(2000).nullable().optional(),
  tokenUrl: z.string().trim().url().max(2000).nullable().optional(),
  revokeUrl: z.string().trim().url().max(2000).nullable().optional(),
  scopes: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(["draft", "active", "disabled"]).default("draft"),
});
const mcpToolPolicySchema = z.object({
  allowlisted: z.boolean(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  approvalRequired: z.boolean(),
  status: z.coerce.number().int().min(0).max(1),
});
const circuitSchema = z.object({
  providerId: id,
  purpose: z.string().trim().min(1).max(50),
  failureThreshold: z.coerce.number().int().min(1).max(100),
  cooldownMs: z.coerce.number().int().min(1000).max(86400000),
});
const quotaSchema = z.object({
  name: z.string().trim().min(1).max(120),
  subjectType: z.enum(["system", "department", "user"]),
  subjectId: id.nullable().optional(),
  period: z.enum(["daily", "monthly"]),
  maxInputTokens: z.coerce.number().int().positive().nullable().optional(),
  maxOutputTokens: z.coerce.number().int().positive().nullable().optional(),
  maxCost: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,8})?$/)
    .nullable()
    .optional(),
  currency: z.string().trim().min(3).max(8).default("USD"),
  status: z.coerce.number().int().min(0).max(1).default(1),
});
const adjustmentSchema = z.object({
  userId: id,
  amount: z
    .string()
    .trim()
    .regex(/^-?\d+(?:\.\d{1,8})?$/),
  currency: z.string().trim().min(3).max(8).default("USD"),
  description: z.string().trim().min(1).max(1000),
});
const settlementSchema = z.object({
  status: z.enum(["confirmed", "void"]),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(?:\.\d{1,8})?$/)
    .nullable()
    .optional(),
  currency: z.string().trim().min(3).max(8).nullable().optional(),
  source: z.string().trim().min(1).max(100).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});
const evalJobSchema = z.object({
  datasetId: id,
  idempotencyKey: z.string().trim().max(200).optional(),
});

export const aiGovernanceRoutes = new Hono<{ Variables: HonoVariables }>();

aiGovernanceRoutes.get(
  "/ai/governance/options",
  authRequired(),
  ability("system.aiGovernance.query"),
  async (c) => {
    const [agents, tools, providers, users, departments] = await Promise.all([
      sqlite
        .prepare(
          "SELECT id, name, code FROM sys_ai_agent WHERE deleted_at IS NULL AND status = 1 ORDER BY sort, id",
        )
        .all(),
      sqlite
        .prepare(
          'SELECT id, name, code, risk_level AS "riskLevel" FROM sys_ai_tool WHERE deleted_at IS NULL AND status = 1 ORDER BY sort, id',
        )
        .all(),
      sqlite
        .prepare(
          "SELECT id, name, code FROM sys_ai_provider WHERE deleted_at IS NULL ORDER BY sort, id",
        )
        .all(),
      sqlite
        .prepare(
          "SELECT id, username, nickname FROM sys_user WHERE deleted_at IS NULL AND status = 1 ORDER BY id",
        )
        .all(),
      sqlite
        .prepare(
          "SELECT id, name FROM sys_dept WHERE deleted_at IS NULL AND status = 1 ORDER BY sort, id",
        )
        .all(),
    ]);
    return c.json(success({ agents, tools, providers, users, departments }));
  },
);

aiGovernanceRoutes.get(
  "/ai/governance/memories",
  authRequired(),
  ability("system.aiChat.query"),
  async (c) => {
    const url = new URL(c.req.url);
    return c.json(
      success(
        await listAiMemories({
          userId: c.get("user").id,
          agentId: url.searchParams.get("agentId")
            ? Number(url.searchParams.get("agentId"))
            : undefined,
          includeArchived: url.searchParams.get("includeArchived") === "1",
        }),
      ),
    );
  },
);

aiGovernanceRoutes.post(
  "/ai/governance/memories",
  authRequired(),
  ability("system.aiChat.update"),
  async (c) => {
    const payload = memorySchema.parse(await c.req.json());
    const memoryId = await runWithOperationLog(
      c,
      {
        module: "system.aiMemory",
        action: "create",
        resource: "/ai/governance/memories",
        riskLevel: "medium",
        details: {
          scopeType: payload.scopeType,
          agentId: payload.agentId,
          sourceSessionId: payload.sourceSessionId,
        },
      },
      () => saveAiMemory({ userId: c.get("user").id, payload }),
    );
    return c.json(success({ id: memoryId }, "Memory 已保存"));
  },
);

aiGovernanceRoutes.put(
  "/ai/governance/memories/:id",
  authRequired(),
  ability("system.aiChat.update"),
  async (c) => {
    const memoryId = id.parse(c.req.param("id"));
    const payload = memorySchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiMemory",
        action: "update",
        resource: "/ai/governance/memories",
        resourceId: memoryId,
        riskLevel: "medium",
        details: { scopeType: payload.scopeType, status: payload.status },
      },
      () => saveAiMemory({ id: memoryId, userId: c.get("user").id, payload }),
    );
    return c.json(success(null, "Memory 已更新"));
  },
);

aiGovernanceRoutes.delete(
  "/ai/governance/memories/:id",
  authRequired(),
  ability("system.aiChat.update"),
  async (c) => {
    const memoryId = id.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiMemory",
        action: "delete",
        resource: "/ai/governance/memories",
        resourceId: memoryId,
        riskLevel: "medium",
      },
      () => deleteAiMemory(memoryId, c.get("user").id),
    );
    return c.json(success(null, "Memory 已删除"));
  },
);

aiGovernanceRoutes.get(
  "/ai/governance/skills/:id/versions",
  authRequired(),
  ability("system.aiGovernance.query"),
  async (c) => c.json(success(await listAiRuntimeSkillVersions(id.parse(c.req.param("id"))))),
);

aiGovernanceRoutes.post(
  "/ai/governance/skills/:id/versions",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const skillId = id.parse(c.req.param("id"));
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiSkill",
        action: "createVersion",
        resource: "/ai/governance/skills/versions",
        resourceId: skillId,
        riskLevel: "high",
        details: { skillId },
      },
      () => createAiRuntimeSkillVersion({ skillId, userId: c.get("user").id }),
    );
    return c.json(success(result, "Skill 草稿版本已创建"));
  },
);

aiGovernanceRoutes.post(
  "/ai/governance/skills/:id/versions/:version/publish",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const skillId = id.parse(c.req.param("id"));
    const version = id.parse(c.req.param("version"));
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiSkill",
        action: "publishVersion",
        resource: "/ai/governance/skills/versions/publish",
        resourceId: skillId,
        riskLevel: "high",
        details: { skillId, version },
      },
      () => publishAiRuntimeSkillVersion({ skillId, version, userId: c.get("user").id }),
    );
    return c.json(success(result, "Skill 版本已发布"));
  },
);

aiGovernanceRoutes.post(
  "/ai/governance/skills/:id/versions/:version/rollback",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const skillId = id.parse(c.req.param("id"));
    const version = id.parse(c.req.param("version"));
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiSkill",
        action: "rollbackVersion",
        resource: "/ai/governance/skills/versions/rollback",
        resourceId: skillId,
        riskLevel: "critical",
        details: { skillId, version },
      },
      () => rollbackAiRuntimeSkillVersion({ skillId, version, userId: c.get("user").id }),
    );
    return c.json(success(result, "Skill 版本已回滚并发布"));
  },
);

aiGovernanceRoutes.get(
  "/ai/governance/memory-candidates",
  authRequired(),
  ability("system.aiChat.query"),
  async (c) =>
    c.json(
      success(
        await listAiMemoryCandidates({
          userId: c.get("user").id,
          status: new URL(c.req.url).searchParams.get("status") ?? undefined,
        }),
      ),
    ),
);

aiGovernanceRoutes.post(
  "/ai/governance/memory-candidates/:id/decision",
  authRequired(),
  ability("system.aiChat.update"),
  async (c) => {
    const payload = z
      .object({ decision: z.enum(["accept", "reject"]), reason: z.string().trim().max(500).optional() })
      .parse(await c.req.json());
    const candidateId = id.parse(c.req.param("id"));
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiMemory",
        action: `candidate-${payload.decision}`,
        resource: "/ai/governance/memory-candidates",
        resourceId: candidateId,
        riskLevel: "medium",
        details: { decision: payload.decision },
      },
      () =>
        decideAiMemoryCandidate({
          id: candidateId,
          userId: c.get("user").id,
          decision: payload.decision,
          reason: payload.reason,
        }),
    );
    return c.json(success(result, payload.decision === "accept" ? "Memory 候选已保存" : "Memory 候选已拒绝"));
  },
);

aiGovernanceRoutes.get(
  "/ai/governance/skills",
  authRequired(),
  ability("system.aiGovernance.query"),
  async (c) => c.json(success(await listAiRuntimeSkills())),
);

aiGovernanceRoutes.post(
  "/ai/governance/skills",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const payload = skillSchema.parse(await c.req.json());
    const savedId = await runWithOperationLog(
      c,
      {
        module: "system.aiSkill",
        action: "create",
        resource: "/ai/governance/skills",
        riskLevel: "high",
        details: { code: payload.code, toolIds: payload.toolIds, agentIds: payload.agentIds },
      },
      () => saveAiRuntimeSkill({ userId: c.get("user").id, payload }),
    );
    return c.json(success({ id: savedId }, "Runtime Skill 已创建"));
  },
);

aiGovernanceRoutes.put(
  "/ai/governance/skills/:id",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const skillId = id.parse(c.req.param("id"));
    const payload = skillSchema.parse(await c.req.json());
    const savedId = await runWithOperationLog(
      c,
      {
        module: "system.aiSkill",
        action: "update",
        resource: "/ai/governance/skills",
        resourceId: skillId,
        riskLevel: "high",
        details: { code: payload.code, toolIds: payload.toolIds, agentIds: payload.agentIds },
      },
      () => saveAiRuntimeSkill({ id: skillId, userId: c.get("user").id, payload }),
    );
    return c.json(success({ id: savedId }, "Runtime Skill 已更新"));
  },
);

aiGovernanceRoutes.delete(
  "/ai/governance/skills/:id",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const skillId = id.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiSkill",
        action: "delete",
        resource: "/ai/governance/skills",
        resourceId: skillId,
        riskLevel: "high",
      },
      () => deleteAiRuntimeSkill(skillId, c.get("user").id),
    );
    return c.json(success(null, "Runtime Skill 已删除"));
  },
);

aiGovernanceRoutes.get(
  "/ai/governance/mcp/servers",
  authRequired(),
  ability("system.aiGovernance.query"),
  async (c) => c.json(success(await listAiMcpServers())),
);

aiGovernanceRoutes.post("/ai/governance/mcp/internal/oauth/token", async (c) => {
  const body = new URLSearchParams(await c.req.text());
  const result = await issueInternalSystemMcpToken({
    grantType: body.get("grant_type") ?? "",
    clientId: body.get("client_id") ?? "",
    clientSecret: body.get("client_secret") ?? "",
    refreshToken: body.get("refresh_token"),
  });
  return c.json(result);
});

aiGovernanceRoutes.post("/ai/governance/mcp/internal", async (c) => {
  const result = await handleInternalSystemMcpRpc({
    authorization: c.req.header("authorization"),
    userId: Number(c.req.header("x-admin-base-user-id")),
    payload: (await c.req.json()) as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: Record<string, unknown>;
    },
  });
  return result === null ? c.body(null, 202) : c.json(result);
});

aiGovernanceRoutes.post(
  "/ai/governance/mcp/internal/provision",
  authRequired(),
  ability("system.aiGovernance.update"),
  ability("system.aiGovernance.execute"),
  ability("system.aiGovernance.approve"),
  async (c) => {
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiMcp",
        action: "provisionInternalServer",
        resource: "/ai/governance/mcp/internal",
        riskLevel: "critical",
        details: { code: "admin-base-system", mode: "read_only" },
      },
      () =>
        provisionInternalSystemMcp({
          origin: new URL(c.req.url).origin,
          userId: c.get("user").id,
        }),
    );
    return c.json(success(result, "系统数据 MCP 与测试 Agent 已部署"));
  },
);

aiGovernanceRoutes.post(
  "/ai/governance/mcp/servers",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const payload = mcpServerSchema.parse(await c.req.json());
    const savedId = await runWithOperationLog(
      c,
      {
        module: "system.aiMcp",
        action: "createServer",
        resource: "/ai/governance/mcp/servers",
        riskLevel: "high",
        details: { code: payload.code, oauthMode: payload.oauthMode, status: payload.status },
      },
      () => saveAiMcpServer({ userId: c.get("user").id, payload }),
    );
    return c.json(success({ id: savedId }, "MCP Server 已保存"));
  },
);

aiGovernanceRoutes.put(
  "/ai/governance/mcp/servers/:id",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const serverId = id.parse(c.req.param("id"));
    const payload = mcpServerSchema.parse(await c.req.json());
    const savedId = await runWithOperationLog(
      c,
      {
        module: "system.aiMcp",
        action: "updateServer",
        resource: "/ai/governance/mcp/servers",
        resourceId: serverId,
        riskLevel: "high",
        details: { code: payload.code, oauthMode: payload.oauthMode, status: payload.status },
      },
      () => saveAiMcpServer({ id: serverId, userId: c.get("user").id, payload }),
    );
    return c.json(success({ id: savedId }, "MCP Server 已保存"));
  },
);

aiGovernanceRoutes.delete(
  "/ai/governance/mcp/servers/:id",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const serverId = id.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiMcp",
        action: "deleteServer",
        resource: "/ai/governance/mcp/servers",
        resourceId: serverId,
        riskLevel: "critical",
      },
      () => deleteAiMcpServer(serverId, c.get("user").id),
    );
    return c.json(success(null, "MCP Server 已删除"));
  },
);

aiGovernanceRoutes.post(
  "/ai/governance/mcp/servers/:id/connect",
  authRequired(),
  ability("system.aiGovernance.execute"),
  async (c) => {
    const serverId = id.parse(c.req.param("id"));
    const callbackUrl = `${new URL(c.req.url).origin}/api/system/ai/governance/mcp/oauth/callback`;
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiMcp",
        action: "connect",
        resource: "/ai/governance/mcp/connect",
        resourceId: serverId,
        riskLevel: "high",
      },
      () => connectAiMcpServer({ serverId, userId: c.get("user").id, callbackUrl }),
    );
    return c.json(success(result));
  },
);

aiGovernanceRoutes.get("/ai/governance/mcp/oauth/callback", async (c) => {
  const url = new URL(c.req.url);
  try {
    await completeAiMcpOAuth({
      state: z.string().min(10).parse(url.searchParams.get("state")),
      code: z.string().min(1).parse(url.searchParams.get("code")),
      callbackUrl: `${url.origin}/api/system/ai/governance/mcp/oauth/callback`,
    });
    return c.redirect("/system/ai/governance?tab=mcp&mcpConnected=1");
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP OAuth 连接失败";
    return c.redirect(`/system/ai/governance?tab=mcp&mcpError=${encodeURIComponent(message)}`);
  }
});

aiGovernanceRoutes.get(
  "/ai/governance/mcp/connections",
  authRequired(),
  ability("system.aiGovernance.query"),
  async (c) => {
    const serverId = new URL(c.req.url).searchParams.get("serverId");
    return c.json(success(await listAiMcpConnections(serverId ? Number(serverId) : undefined)));
  },
);

aiGovernanceRoutes.delete(
  "/ai/governance/mcp/connections/:id",
  authRequired(),
  ability("system.aiGovernance.execute"),
  async (c) => {
    const connectionId = id.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiMcp",
        action: "disconnect",
        resource: "/ai/governance/mcp/connections",
        resourceId: connectionId,
        riskLevel: "high",
      },
      () => disconnectAiMcpConnection(connectionId),
    );
    return c.json(success(null, "MCP 连接已断开"));
  },
);

aiGovernanceRoutes.post(
  "/ai/governance/mcp/servers/:id/sync",
  authRequired(),
  ability("system.aiGovernance.execute"),
  async (c) => {
    const serverId = id.parse(c.req.param("id"));
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiMcp",
        action: "syncTools",
        resource: "/ai/governance/mcp/tools",
        resourceId: serverId,
        riskLevel: "high",
      },
      () => syncAiMcpTools({ serverId, userId: c.get("user").id }),
    );
    return c.json(success(result, "MCP Tool 已同步，需逐项进入 allowlist 后才可使用"));
  },
);

aiGovernanceRoutes.get(
  "/ai/governance/mcp/tools",
  authRequired(),
  ability("system.aiGovernance.query"),
  async (c) => {
    const serverId = new URL(c.req.url).searchParams.get("serverId");
    return c.json(success(await listAiMcpTools(serverId ? Number(serverId) : undefined)));
  },
);

aiGovernanceRoutes.put(
  "/ai/governance/mcp/tools/:id/policy",
  authRequired(),
  ability("system.aiGovernance.approve"),
  async (c) => {
    const toolId = id.parse(c.req.param("id"));
    const payload = mcpToolPolicySchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiMcp",
        action: "setToolPolicy",
        resource: "/ai/governance/mcp/tools",
        resourceId: toolId,
        riskLevel: "critical",
        details: payload,
      },
      () => setAiMcpToolPolicy({ id: toolId, userId: c.get("user").id, ...payload }),
    );
    return c.json(success(null, "MCP Tool 策略已更新"));
  },
);

aiGovernanceRoutes.get(
  "/ai/governance/circuits",
  authRequired(),
  ability("system.aiGovernance.query"),
  async (c) => c.json(success(await listAiCircuits())),
);
aiGovernanceRoutes.put(
  "/ai/governance/circuits",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const payload = circuitSchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiCircuit",
        action: "savePolicy",
        resource: "/ai/governance/circuits",
        riskLevel: "high",
        details: payload,
      },
      () => saveAiCircuitPolicy(payload),
    );
    return c.json(success(null, "熔断策略已更新"));
  },
);
aiGovernanceRoutes.post(
  "/ai/governance/circuits/reset",
  authRequired(),
  ability("system.aiGovernance.execute"),
  async (c) => {
    const payload = circuitSchema
      .pick({ providerId: true, purpose: true })
      .parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiCircuit",
        action: "reset",
        resource: "/ai/governance/circuits",
        riskLevel: "high",
        details: payload,
      },
      () => resetAiCircuit(payload.providerId, payload.purpose),
    );
    return c.json(success(null, "熔断状态已重置"));
  },
);

aiGovernanceRoutes.get(
  "/ai/governance/quotas",
  authRequired(),
  ability("system.aiGovernance.query"),
  async (c) => c.json(success(await listAiQuotaPolicies())),
);
aiGovernanceRoutes.post(
  "/ai/governance/quotas",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const payload = quotaSchema.parse(await c.req.json());
    const savedId = await runWithOperationLog(
      c,
      {
        module: "system.aiQuota",
        action: "create",
        resource: "/ai/governance/quotas",
        riskLevel: "high",
        details: {
          subjectType: payload.subjectType,
          subjectId: payload.subjectId,
          period: payload.period,
        },
      },
      () => saveAiQuotaPolicy({ userId: c.get("user").id, payload }),
    );
    return c.json(success({ id: savedId }, "配额策略已保存"));
  },
);

aiGovernanceRoutes.put(
  "/ai/governance/quotas/:id",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const policyId = id.parse(c.req.param("id"));
    const payload = quotaSchema.parse(await c.req.json());
    const savedId = await runWithOperationLog(
      c,
      {
        module: "system.aiQuota",
        action: "update",
        resource: "/ai/governance/quotas",
        resourceId: policyId,
        riskLevel: "high",
        details: {
          subjectType: payload.subjectType,
          subjectId: payload.subjectId,
          period: payload.period,
        },
      },
      () => saveAiQuotaPolicy({ id: policyId, userId: c.get("user").id, payload }),
    );
    return c.json(success({ id: savedId }, "配额策略已保存"));
  },
);

aiGovernanceRoutes.get(
  "/ai/governance/billing",
  authRequired(),
  ability("system.aiGovernance.query"),
  async (c) => {
    const url = new URL(c.req.url);
    return c.json(
      success(
        await listAiBillingLedger({
          page: Number(url.searchParams.get("page") || 1),
          pageSize: Number(url.searchParams.get("pageSize") || 20),
          userId: url.searchParams.get("userId")
            ? Number(url.searchParams.get("userId"))
            : undefined,
        }),
      ),
    );
  },
);
aiGovernanceRoutes.post(
  "/ai/governance/billing/adjustments",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const payload = adjustmentSchema.parse(await c.req.json());
    const adjustmentId = await runWithOperationLog(
      c,
      {
        module: "system.aiBilling",
        action: "adjust",
        resource: "/ai/governance/billing",
        riskLevel: "critical",
        details: { userId: payload.userId, amount: payload.amount, currency: payload.currency },
      },
      () => addAiBillingAdjustment({ ...payload, createdBy: c.get("user").id }),
    );
    return c.json(success({ id: adjustmentId }, "计费调整已入账"));
  },
);
aiGovernanceRoutes.put(
  "/ai/governance/billing/:id/settlement",
  authRequired(),
  ability("system.aiGovernance.update"),
  async (c) => {
    const ledgerId = id.parse(c.req.param("id"));
    const payload = settlementSchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiBilling",
        action: "settle",
        resource: "/ai/governance/billing",
        resourceId: ledgerId,
        riskLevel: "critical",
        details: { status: payload.status, currency: payload.currency, source: payload.source },
      },
      () => settleAiBillingEntry({ id: ledgerId, ...payload }),
    );
    return c.json(success(null, payload.status === "confirmed" ? "费用已确认" : "费用已作废"));
  },
);

aiGovernanceRoutes.get(
  "/ai/governance/jobs",
  authRequired(),
  ability("system.aiGovernance.query"),
  async (c) => {
    const url = new URL(c.req.url);
    return c.json(
      success(
        await listAiJobs({
          page: Number(url.searchParams.get("page") || 1),
          pageSize: Number(url.searchParams.get("pageSize") || 20),
        }),
      ),
    );
  },
);
aiGovernanceRoutes.post(
  "/ai/governance/jobs/eval",
  authRequired(),
  ability("system.aiGovernance.execute"),
  async (c) => {
    const payload = evalJobSchema.parse(await c.req.json());
    const jobId = await runWithOperationLog(
      c,
      {
        module: "system.aiEval",
        action: "enqueue",
        resource: "/ai/governance/jobs/eval",
        resourceId: payload.datasetId,
        riskLevel: "medium",
        details: { datasetId: payload.datasetId },
      },
      () =>
        enqueueAiJob({
          jobType: "eval_dataset",
          payload: { datasetId: payload.datasetId, abilities: c.get("abilities") },
          userId: c.get("user").id,
          resourceType: "eval_dataset",
          resourceId: payload.datasetId,
          requestId: c.get("requestId"),
          idempotencyKey: payload.idempotencyKey,
        }),
    );
    return c.json(success({ jobId }, "Eval 任务已入队"));
  },
);
aiGovernanceRoutes.post(
  "/ai/governance/jobs/:id/retry",
  authRequired(),
  ability("system.aiGovernance.execute"),
  async (c) => {
    const jobId = id.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiJob",
        action: "retry",
        resource: "/ai/governance/jobs",
        resourceId: jobId,
        riskLevel: "medium",
      },
      () => retryAiJob(jobId),
    );
    return c.json(success(null, "任务已重新入队"));
  },
);
aiGovernanceRoutes.post(
  "/ai/governance/jobs/:id/cancel",
  authRequired(),
  ability("system.aiGovernance.execute"),
  async (c) => {
    const jobId = id.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiJob",
        action: "cancel",
        resource: "/ai/governance/jobs",
        resourceId: jobId,
        riskLevel: "high",
      },
      () => cancelAiJob(jobId),
    );
    return c.json(success(null, "任务已取消"));
  },
);
