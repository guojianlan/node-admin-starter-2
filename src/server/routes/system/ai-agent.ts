import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  decideToolApproval,
  getLatestSessionAgentRun,
  listAiAgents,
  listAiTools,
  listSessionApprovals,
  saveAiAgent,
  saveAiTool,
  softDeleteAiResource,
} from "@/server/services/ai-agent-service";
import { getAiRuntimeConfig } from "@/server/services/ai-provider-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";

const jsonTextSchema = z.string().max(20000).refine((value) => {
  if (!value.trim()) return true;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}, "请输入有效 JSON");

const agentSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().regex(/^[a-z][a-z0-9-]*$/).max(100),
  description: z.string().max(500).optional().nullable(),
  instructions: z.string().min(1).max(20000),
  modelId: z.coerce.number().int().positive().optional().nullable(),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
  maxOutputTokens: z.coerce.number().int().min(16).max(32768).optional().nullable(),
  maxSteps: z.coerce.number().int().min(1).max(20).default(6),
  status: z.coerce.number().int().min(0).max(1).default(1),
  sort: z.coerce.number().int().default(0),
  toolIds: z.array(z.coerce.number().int().positive()).default([]),
});

const toolSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().regex(/^[a-z][a-z0-9-]*$/).max(100),
  description: z.string().min(1).max(500),
  handlerKey: z.enum(["current_time", "calculator", "system_status", "operation_log_summary"]),
  inputSchemaJson: jsonTextSchema.optional().nullable(),
  configJson: jsonTextSchema.optional().nullable(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]).default("low"),
  approvalRequired: z.boolean().default(false),
  status: z.coerce.number().int().min(0).max(1).default(1),
  sort: z.coerce.number().int().default(0),
});

export const aiAgentRoutes = new Hono<{ Variables: HonoVariables }>();

aiAgentRoutes.get("/ai/agent", authRequired(), ability("system.aiAgent.query"), async (c) =>
  c.json(success(await listAiAgents())),
);

aiAgentRoutes.get("/ai/agent/options", authRequired(), ability("system.aiAgent.query"), async (c) => {
  const models = await sqlite.prepare(
    `SELECT m.id, m.name, m.model_id AS "modelId", p.name AS "providerName"
     FROM sys_ai_model m INNER JOIN sys_ai_provider p ON p.id = m.provider_id
     WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND m.status = 1 AND p.status = 1
       AND m.model_type = 'chat' ORDER BY p.sort ASC, m.sort ASC, m.id ASC`,
  ).all();
  return c.json(success({ models, tools: await listAiTools() }));
});

aiAgentRoutes.post("/ai/agent", authRequired(), ability("system.aiAgent.create"), async (c) => {
  const user = c.get("user");
  const payload = agentSchema.parse(await c.req.json());
  let id = 0;
  await runWithOperationLog(c, { module: "system.aiAgent", action: "create", resource: "/ai/agent", details: { code: payload.code } }, async () => {
    if (payload.modelId) await getAiRuntimeConfig("chat", payload.modelId);
    await sqlite.transaction(async (tx) => {
      id = await saveAiAgent({ ...payload, temperatureMilli: Math.round(payload.temperature * 1000), userId: user.id, dbClient: tx });
    });
  });
  return c.json(success({ id }, "创建成功"));
});

aiAgentRoutes.put("/ai/agent/:id", authRequired(), ability("system.aiAgent.update"), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const payload = agentSchema.parse(await c.req.json());
  await runWithOperationLog(c, { module: "system.aiAgent", action: "update", resource: "/ai/agent", resourceId: id, details: { code: payload.code } }, async () => {
    if (payload.modelId) await getAiRuntimeConfig("chat", payload.modelId);
    await sqlite.transaction(async (tx) => {
      await saveAiAgent({ ...payload, id, temperatureMilli: Math.round(payload.temperature * 1000), userId: user.id, dbClient: tx });
    });
  });
  return c.json(success(null, "更新成功"));
});

aiAgentRoutes.delete("/ai/agent/:id", authRequired(), ability("system.aiAgent.delete"), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  await runWithOperationLog(c, { module: "system.aiAgent", action: "delete", resource: "/ai/agent", resourceId: id, riskLevel: "high" }, async () => {
    await softDeleteAiResource({ type: "agent", id, userId: user.id });
  });
  return c.json(success(null, "删除成功"));
});

aiAgentRoutes.get("/ai/tool", authRequired(), ability("system.aiAgent.query"), async (c) =>
  c.json(success(await listAiTools())),
);

aiAgentRoutes.post("/ai/tool", authRequired(), ability("system.aiAgent.create"), async (c) => {
  const user = c.get("user");
  const payload = toolSchema.parse(await c.req.json());
  let id = 0;
  await runWithOperationLog(c, { module: "system.aiAgent", action: "createTool", resource: "/ai/tool", details: { code: payload.code, riskLevel: payload.riskLevel } }, async () => {
    await sqlite.transaction(async (tx) => {
      id = await saveAiTool({ ...payload, userId: user.id, dbClient: tx });
    });
  });
  return c.json(success({ id }, "创建成功"));
});

aiAgentRoutes.put("/ai/tool/:id", authRequired(), ability("system.aiAgent.update"), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const payload = toolSchema.parse(await c.req.json());
  await runWithOperationLog(c, { module: "system.aiAgent", action: "updateTool", resource: "/ai/tool", resourceId: id, details: { code: payload.code, riskLevel: payload.riskLevel } }, async () => {
    await sqlite.transaction(async (tx) => {
      await saveAiTool({ ...payload, id, userId: user.id, dbClient: tx });
    });
  });
  return c.json(success(null, "更新成功"));
});

aiAgentRoutes.delete("/ai/tool/:id", authRequired(), ability("system.aiAgent.delete"), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  await runWithOperationLog(c, { module: "system.aiAgent", action: "deleteTool", resource: "/ai/tool", resourceId: id, riskLevel: "high" }, async () => {
    await softDeleteAiResource({ type: "tool", id, userId: user.id });
  });
  return c.json(success(null, "删除成功"));
});

aiAgentRoutes.get("/ai/agent/runs", authRequired(), ability("system.aiAgent.query"), async (c) => {
  const user = c.get("user");
  const sessionId = Number(new URL(c.req.url).searchParams.get("sessionId") || 0);
  const runs = await sqlite.prepare(
    `SELECT r.id, r.session_id AS "sessionId", r.agent_id AS "agentId", a.name AS "agentName",
      r.status, r.total_steps AS "totalSteps", r.input_tokens AS "inputTokens",
      r.output_tokens AS "outputTokens", r.duration_ms AS "durationMs", r.error_message AS "errorMessage",
      r.started_at AS "startedAt", r.finished_at AS "finishedAt"
     FROM sys_ai_agent_run r INNER JOIN sys_ai_agent a ON a.id = r.agent_id
     WHERE r.user_id = ? AND (? = 0 OR r.session_id = ?) ORDER BY r.id DESC LIMIT 100`,
  ).all(user.id, sessionId, sessionId);
  return c.json(success(runs));
});

aiAgentRoutes.get("/ai/agent/runs/:id/steps", authRequired(), ability("system.aiAgent.query"), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const steps = await sqlite.prepare(
    `SELECT s.id, s.step_no AS "stepNo", s.step_type AS "stepType", s.status,
      s.tool_name AS "toolName", s.tool_call_id AS "toolCallId", s.input_json AS "inputJson",
      s.output_json AS "outputJson", s.usage_json AS "usageJson", s.duration_ms AS "durationMs",
      s.error_message AS "errorMessage", s.started_at AS "startedAt", s.finished_at AS "finishedAt"
     FROM sys_ai_agent_run_step s INNER JOIN sys_ai_agent_run r ON r.id = s.run_id
     WHERE s.run_id = ? AND r.user_id = ? ORDER BY s.step_no ASC, s.id ASC`,
  ).all(id, user.id);
  return c.json(success(steps));
});

aiAgentRoutes.get("/ai/chat/sessions/:id/approvals", authRequired(), ability("system.aiChat.query"), async (c) => {
  const user = c.get("user");
  return c.json(success(await listSessionApprovals({ sessionId: Number(c.req.param("id")), userId: user.id })));
});

aiAgentRoutes.get("/ai/chat/sessions/:id/run/latest", authRequired(), ability("system.aiChat.query"), async (c) => {
  const user = c.get("user");
  return c.json(success(await getLatestSessionAgentRun({
    sessionId: Number(c.req.param("id")),
    userId: user.id,
  })));
});

aiAgentRoutes.post("/ai/approval/:id/decision", authRequired(), ability("system.aiAgent.approve"), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const payload = z.object({ approved: z.boolean(), reason: z.string().max(500).optional().nullable() }).parse(await c.req.json());
  let result: Awaited<ReturnType<typeof decideToolApproval>> | null = null;
  await runWithOperationLog(c, {
    module: "system.aiAgent", action: payload.approved ? "approveTool" : "denyTool",
    resource: "/ai/approval", resourceId: id, riskLevel: payload.approved ? "high" : "medium",
    details: { reason: payload.reason },
  }, async () => {
    result = await decideToolApproval({ id, userId: user.id, approved: payload.approved, reason: payload.reason });
  });
  return c.json(success(result, payload.approved ? "已批准并执行" : "已拒绝"));
});
