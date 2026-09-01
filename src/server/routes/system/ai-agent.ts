import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  decideToolApproval,
  getLatestSessionAgentRun,
  getAiAgentRunTrace,
  listAiAgentRunEvents,
  listAiAgents,
  listAiTools,
  listSessionApprovals,
  saveAiAgent,
  saveAiTool,
  softDeleteAiResource,
  submitClientToolResult,
} from "@/server/services/ai-agent-service";
import { aiToolHandlerKeys, listAiToolRegistryOptions } from "@/server/services/ai-tool-registry";
import { getAiRuntimeConfig } from "@/server/services/ai-provider-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { uploadFileToDefaultStorage } from "@/server/services/storage-service";
import {
  executeRegisteredAiWorkflow,
  AiWorkflowNotFoundError,
  getAiWorkflowDefinition,
  listAiWorkflowDefinitions,
} from "@/server/mastra/workflow-registry";
import {
  getAiWorkflowRun,
  listAiProgressEvents,
  listAiWorkflowRuns,
  listAiWorkflowWaits,
  resolveAiWorkflowWait,
  subscribeAiProgressNotifications,
} from "@/server/services/ai-workflow-service";
import {
  createVisualWorkflowVersion,
  executeVisualWorkflow,
  getVisualWorkflowDefinition,
  listVisualWorkflowDefinitions,
  publishVisualWorkflowVersion,
  resumeVisualWorkflow,
} from "@/server/services/ai-visual-workflow-service";

const jsonTextSchema = z
  .string()
  .max(20000)
  .refine((value) => {
    if (!value.trim()) return true;
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }, "请输入有效 JSON");

function validateHumanWorkflowInput(waitInput: unknown, value: unknown) {
  const input = waitInput && typeof waitInput === "object" && !Array.isArray(waitInput)
    ? waitInput as { schema?: unknown }
    : {};
  const schema = input.schema && typeof input.schema === "object" && !Array.isArray(input.schema)
    ? input.schema as {
        type?: string;
        required?: string[];
        properties?: Record<string, { type?: string; enum?: unknown[]; minimum?: number; maximum?: number }>;
      }
    : null;
  if (!schema || schema.type !== "object" || !schema.properties) {
    throw new HTTPException(409, { message: "人工输入节点缺少有效对象 Schema" });
  }
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.properties)) {
    let validator: z.ZodType = field.type === "string"
      ? z.string()
      : field.type === "number"
        ? z.number()
        : field.type === "integer"
          ? z.number().int()
          : field.type === "boolean"
            ? z.boolean()
            : field.type === "array"
              ? z.array(z.unknown())
              : field.type === "object"
                ? z.record(z.string(), z.unknown())
                : z.unknown();
    if (field.enum?.length) {
      validator = validator.refine((item) => field.enum?.some((allowed) => Object.is(allowed, item)), `${key} 不在允许值范围内`);
    }
    if (field.type === "number" || field.type === "integer") {
      if (field.minimum != null) validator = validator.refine((item) => Number(item) >= Number(field.minimum), `${key} 小于最小值`);
      if (field.maximum != null) validator = validator.refine((item) => Number(item) <= Number(field.maximum), `${key} 超过最大值`);
    }
    shape[key] = schema.required?.includes(key) ? validator : validator.optional();
  }
  return z.object(shape).strict().parse(value);
}

const clientToolResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("granted"),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative().max(100000).optional(),
  }),
  z.object({
    status: z.enum(["denied", "unavailable", "error"]),
    reason: z.string().trim().max(500).optional(),
  }),
]);

const agentSchema = z.object({
  name: z.string().min(1).max(100),
  code: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/)
    .max(100),
  description: z.string().max(500).optional().nullable(),
  instructions: z.string().min(1).max(20000),
  modelId: z.coerce.number().int().positive().optional().nullable(),
  temperature: z.coerce.number().min(0).max(2).default(0.7),
  maxOutputTokens: z.coerce.number().int().min(16).max(131072).optional().nullable(),
  maxSteps: z.coerce.number().int().min(1).max(20).default(6),
  status: z.coerce.number().int().min(0).max(1).default(1),
  sort: z.coerce.number().int().default(0),
  toolIds: z.array(z.coerce.number().int().positive()).default([]),
});

const toolSchema = z.object({
  name: z.string().min(1).max(100),
  code: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/)
    .max(100),
  description: z.string().min(1).max(500),
  handlerKey: z.enum(aiToolHandlerKeys),
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

aiAgentRoutes.get(
  "/ai/agent/options",
  authRequired(),
  ability("system.aiAgent.query"),
  async (c) => {
    const [models, skills] = await Promise.all([
      sqlite
        .prepare(
          `SELECT m.id, m.name, m.model_id AS "modelId", m.model_type AS "modelType",
            p.name AS "providerName"
           FROM sys_ai_model m INNER JOIN sys_ai_provider p ON p.id = m.provider_id
           WHERE m.deleted_at IS NULL AND p.deleted_at IS NULL AND m.status = 1 AND p.status = 1
             AND m.model_type = 'chat' ORDER BY p.sort ASC, m.sort ASC, m.id ASC`,
        )
        .all(),
      sqlite
        .prepare(
          `SELECT id, name, code FROM sys_ai_runtime_skill
           WHERE deleted_at IS NULL AND status = 1 ORDER BY sort ASC, id ASC`,
        )
        .all(),
    ]);
    return c.json(
      success({
        models,
        skills,
        tools: await listAiTools(),
        handlers: listAiToolRegistryOptions().map((item) => ({
          value: item.handlerKey,
          label: item.label,
          description: item.description,
          riskLevel: item.riskLevel,
          approvalRequired: item.approvalRequired,
          systemOnly: item.systemOnly,
        })),
      }),
    );
  },
);

aiAgentRoutes.post("/ai/agent", authRequired(), ability("system.aiAgent.create"), async (c) => {
  const user = c.get("user");
  const payload = agentSchema.parse(await c.req.json());
  let id = 0;
  await runWithOperationLog(
    c,
    {
      module: "system.aiAgent",
      action: "create",
      resource: "/ai/agent",
      details: { code: payload.code },
    },
    async () => {
      if (payload.modelId) await getAiRuntimeConfig("chat", payload.modelId);
      await sqlite.transaction(async (tx) => {
        id = await saveAiAgent({
          ...payload,
          temperatureMilli: Math.round(payload.temperature * 1000),
          userId: user.id,
          dbClient: tx,
        });
      });
    },
  );
  return c.json(success({ id }, "创建成功"));
});

aiAgentRoutes.put("/ai/agent/:id", authRequired(), ability("system.aiAgent.update"), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const payload = agentSchema.parse(await c.req.json());
  await runWithOperationLog(
    c,
    {
      module: "system.aiAgent",
      action: "update",
      resource: "/ai/agent",
      resourceId: id,
      details: { code: payload.code },
    },
    async () => {
      if (payload.modelId) await getAiRuntimeConfig("chat", payload.modelId);
      await sqlite.transaction(async (tx) => {
        await saveAiAgent({
          ...payload,
          id,
          temperatureMilli: Math.round(payload.temperature * 1000),
          userId: user.id,
          dbClient: tx,
        });
      });
    },
  );
  return c.json(success(null, "更新成功"));
});

aiAgentRoutes.delete(
  "/ai/agent/:id",
  authRequired(),
  ability("system.aiAgent.delete"),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiAgent",
        action: "delete",
        resource: "/ai/agent",
        resourceId: id,
        riskLevel: "high",
      },
      async () => {
        await softDeleteAiResource({ type: "agent", id, userId: user.id });
      },
    );
    return c.json(success(null, "删除成功"));
  },
);

aiAgentRoutes.get("/ai/tool", authRequired(), ability("system.aiAgent.query"), async (c) =>
  c.json(success(await listAiTools())),
);

aiAgentRoutes.get(
  "/ai/workflow/definitions",
  authRequired(),
  ability("system.aiAgent.query"),
  async (c) => c.json(success(listAiWorkflowDefinitions())),
);

aiAgentRoutes.get(
  "/ai/workflow/visual/definitions",
  authRequired(),
  ability("system.aiAgent.query"),
  async (c) => c.json(success(await listVisualWorkflowDefinitions())),
);

aiAgentRoutes.post(
  "/ai/workflow/assets",
  authRequired(),
  ability("system.aiAgent.executeWorkflow"),
  async (c) => {
    const user = c.get("user");
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiWorkflow",
        action: "uploadAsset",
        resource: "/ai/workflow/assets",
        riskLevel: "medium",
      },
      async () => {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File)) throw new Error("请选择图片文件");
        if (!file.type.startsWith("image/")) throw new Error("Workflow 资产只能上传图片");
        return uploadFileToDefaultStorage({
          file,
          groupId: null,
          userId: user.id,
          usageType: "user_content",
        });
      },
    );
    return c.json(success({ id: result.id, url: result.url }, "图片已上传"));
  },
);

aiAgentRoutes.get(
  "/ai/workflow/visual/definitions/:id",
  authRequired(),
  ability("system.aiAgent.query"),
  async (c) => {
    const definition = await getVisualWorkflowDefinition(Number(c.req.param("id")));
    if (!definition) throw new AiWorkflowNotFoundError("可视化工作流不存在");
    return c.json(success(definition));
  },
);

aiAgentRoutes.post(
  "/ai/workflow/visual/versions",
  authRequired(),
  ability("system.aiAgent.update"),
  async (c) => {
    const payload = z.object({
      code: z.string().regex(/^[a-z][a-z0-9-]*$/).max(100),
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000).nullable().optional(),
      graph: z.unknown(),
    }).parse(await c.req.json());
    const result = await runWithOperationLog(c, {
      module: "system.aiWorkflow",
      action: "createVisualVersion",
      resource: "/ai/workflow/visual/versions",
      riskLevel: "high",
      details: { code: payload.code },
    }, () => createVisualWorkflowVersion({ ...payload, userId: c.get("user").id }));
    return c.json(success(result, "可视化工作流草稿已保存"));
  },
);

aiAgentRoutes.post(
  "/ai/workflow/visual/definitions/:id/versions/:version/publish",
  authRequired(),
  ability("system.aiAgent.update"),
  async (c) => {
    const definitionId = Number(c.req.param("id"));
    const version = Number(c.req.param("version"));
    const result = await runWithOperationLog(c, {
      module: "system.aiWorkflow",
      action: "publishVisualVersion",
      resource: "/ai/workflow/visual/publish",
      resourceId: definitionId,
      riskLevel: "high",
      details: { definitionId, version },
    }, () => publishVisualWorkflowVersion({ definitionId, version, userId: c.get("user").id }));
    return c.json(success(result, "可视化工作流已发布"));
  },
);

aiAgentRoutes.post(
  "/ai/workflow/visual/definitions/:id/runs",
  authRequired(),
  ability("system.aiAgent.executeWorkflow"),
  async (c) => {
    const definitionId = Number(c.req.param("id"));
    const payload = z.object({ value: z.string().trim().min(1).max(20000) }).parse(await c.req.json());
    const result = await runWithOperationLog(c, {
      module: "system.aiWorkflow",
      action: "executeVisual",
      resource: "/ai/workflow/visual/run",
      resourceId: definitionId,
      riskLevel: "medium",
      details: { definitionId },
    }, () => executeVisualWorkflow({ definitionId, userId: c.get("user").id, value: payload.value }));
    return c.json(success(result, "可视化工作流执行完成"));
  },
);

aiAgentRoutes.get(
  "/ai/workflow/runs",
  authRequired(),
  ability("system.aiAgent.query"),
  async (c) => {
    const user = c.get("user");
    const workflowCode = new URL(c.req.url).searchParams.get("workflowCode");
    return c.json(success(await listAiWorkflowRuns({ userId: user.id, workflowCode })));
  },
);

aiAgentRoutes.get(
  "/ai/workflow/runs/:id",
  authRequired(),
  ability("system.aiAgent.query"),
  async (c) => {
    const user = c.get("user");
    const run = await getAiWorkflowRun({ id: Number(c.req.param("id")), userId: user.id });
    if (!run) throw new AiWorkflowNotFoundError("AI 工作流运行记录不存在");
    return c.json(success(run));
  },
);

aiAgentRoutes.post(
  "/ai/workflow/runs/:id/waits/:waitId/decision",
  authRequired(),
  ability("system.aiAgent.approve"),
  async (c) => {
    const runId = Number(c.req.param("id"));
    const waitId = Number(c.req.param("waitId"));
    const payload = z.object({
      approved: z.boolean(),
      reason: z.string().trim().max(1000).optional().nullable(),
      data: z.record(z.string(), z.unknown()).optional(),
    }).parse(await c.req.json());
    const userId = c.get("user").id;
    const result = await runWithOperationLog(c, {
      module: "system.aiWorkflow",
      action: payload.approved ? "approveWorkflow" : "rejectWorkflow",
      resource: "/ai/workflow/wait/decision",
      resourceId: waitId,
      riskLevel: payload.approved ? "high" : "medium",
      details: { runId, waitId, approved: payload.approved },
    }, async () => {
      const decision = await resolveAiWorkflowWait({
        id: waitId,
        runId,
        userId,
        status: payload.approved ? "approved" : "rejected",
        resolution: { reason: payload.reason ?? null, data: payload.data ?? null },
        expectedWaitType: "approval",
      });
      if (!decision) throw new HTTPException(409, { message: "审批已处理、已过期或不属于当前用户" });
      return resumeVisualWorkflow({ runId, userId, waitId });
    });
    return c.json(success(result, payload.approved ? "审批通过，Workflow 已继续" : "审批拒绝，Workflow 已进入拒绝分支"));
  },
);

aiAgentRoutes.post(
  "/ai/workflow/runs/:id/events",
  authRequired(),
  ability("system.aiAgent.executeWorkflow"),
  async (c) => {
    const runId = Number(c.req.param("id"));
    const payload = z.object({
      waitId: z.coerce.number().int().positive(),
      correlationKey: z.string().trim().min(1).max(300),
      data: z.unknown(),
    }).parse(await c.req.json());
    const userId = c.get("user").id;
    const result = await runWithOperationLog(c, {
      module: "system.aiWorkflow",
      action: "resolveWorkflowEvent",
      resource: "/ai/workflow/event",
      resourceId: payload.waitId,
      riskLevel: "medium",
      details: { runId, waitId: payload.waitId, correlationKey: payload.correlationKey },
    }, async () => {
      const pendingWaits = await listAiWorkflowWaits({ runId, userId, pendingOnly: true });
      const pendingWait = pendingWaits.find((item) => item.id === payload.waitId);
      if (!pendingWait || pendingWait.waitType !== "event" || pendingWait.correlationKey !== payload.correlationKey) {
        throw new HTTPException(404, { message: "等待事件不存在、已处理或已过期" });
      }
      const eventData = pendingWait.correlationKey?.startsWith("human-input:")
        ? validateHumanWorkflowInput(pendingWait.input, payload.data)
        : payload.data;
      const wait = await resolveAiWorkflowWait({
        id: payload.waitId,
        runId,
        userId,
        status: "resolved",
        resolution: { correlationKey: payload.correlationKey, data: eventData },
        correlationKey: payload.correlationKey,
        expectedWaitType: "event",
      });
      if (!wait) throw new HTTPException(404, { message: "等待事件不存在、已处理或已过期" });
      return resumeVisualWorkflow({ runId, userId, waitId: payload.waitId });
    });
    return c.json(success(result, "事件已接收，Workflow 已继续"));
  },
);

aiAgentRoutes.post(
  "/ai/workflow/runs/:id/resume",
  authRequired(),
  ability("system.aiAgent.executeWorkflow"),
  async (c) => {
    const runId = Number(c.req.param("id"));
    const payload = z.object({ waitId: z.coerce.number().int().positive().optional() }).parse(await c.req.json().catch(() => ({})));
    const result = await runWithOperationLog(c, {
      module: "system.aiWorkflow",
      action: "resumeWorkflow",
      resource: "/ai/workflow/run/resume",
      resourceId: runId,
      riskLevel: "medium",
      details: { runId, waitId: payload.waitId ?? null },
    }, () => resumeVisualWorkflow({ runId, userId: c.get("user").id, waitId: payload.waitId }));
    return c.json(success(result, "Workflow 恢复检查完成"));
  },
);

aiAgentRoutes.get(
  "/ai/workflow/runs/:id/events",
  authRequired(),
  ability("system.aiAgent.query"),
  async (c) => {
    const user = c.get("user");
    const runId = Number(c.req.param("id"));
    const run = await getAiWorkflowRun({ id: runId, userId: user.id });
    if (!run) throw new AiWorkflowNotFoundError("AI 工作流运行记录不存在");
    const url = new URL(c.req.url);
    let cursor = Math.max(
      Number(url.searchParams.get("afterEventId") ?? c.req.header("last-event-id") ?? 0),
      0,
    );
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let unsubscribe: (() => Promise<void>) | undefined;
        let wake: (() => void) | undefined;
        try {
          unsubscribe = await subscribeAiProgressNotifications({
            resourceType: "workflow_run",
            resourceId: runId,
            onNotify: () => wake?.(),
          }).catch(() => undefined);
          for (let tick = 0; tick < 120 && !c.req.raw.signal.aborted; tick += 1) {
            const events = (await listAiProgressEvents({
              resourceType: "workflow_run",
              resourceId: runId,
              afterId: cursor,
              limit: 200,
            })) as Array<{ id: number; eventType: string; payload: unknown }>;
            for (const event of events) {
              cursor = Number(event.id);
              controller.enqueue(
                encoder.encode(`id: ${event.id}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event.payload)}\n\n`),
              );
            }
            if (events.length === 0) {
              await Promise.race([
                new Promise((resolve) => setTimeout(resolve, 1000)),
                new Promise<void>((resolve) => {
                  wake = resolve;
                }),
              ]);
              wake = undefined;
            }
            if (["completed", "failed", "cancelled"].includes(String((run as unknown as { status: string }).status)) && !events.length) break;
          }
        } finally {
          await unsubscribe?.();
          controller.close();
        }
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  },
);

aiAgentRoutes.post(
  "/ai/workflow/:code/runs",
  authRequired(),
  ability("system.aiAgent.executeWorkflow"),
  async (c) => {
    const user = c.get("user");
    const code = c.req.param("code");
    const definition = getAiWorkflowDefinition(code);
    if (!definition) throw new AiWorkflowNotFoundError(`AI 工作流 ${code} 尚未注册`);
    const workflowInput = await c.req.json();
    let result: unknown = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiWorkflow",
        action: "execute",
        resource: "/ai/workflow",
        resourceId: code,
        riskLevel: definition.riskLevel,
        details: { workflowCode: code, category: definition.category },
      },
      async () => {
        result = await executeRegisteredAiWorkflow({
          code,
          workflowInput,
          context: {
            userId: user.id,
            abilities: c.get("abilities"),
            requestId: c.get("requestId"),
          },
        });
      },
    );
    return c.json(success(result, "工作流执行完成"));
  },
);

aiAgentRoutes.post("/ai/tool", authRequired(), ability("system.aiAgent.create"), async (c) => {
  const user = c.get("user");
  const payload = toolSchema.parse(await c.req.json());
  let id = 0;
  await runWithOperationLog(
    c,
    {
      module: "system.aiAgent",
      action: "createTool",
      resource: "/ai/tool",
      details: { code: payload.code, riskLevel: payload.riskLevel },
    },
    async () => {
      await sqlite.transaction(async (tx) => {
        id = await saveAiTool({ ...payload, userId: user.id, dbClient: tx });
      });
    },
  );
  return c.json(success({ id }, "创建成功"));
});

aiAgentRoutes.put("/ai/tool/:id", authRequired(), ability("system.aiAgent.update"), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const payload = toolSchema.parse(await c.req.json());
  await runWithOperationLog(
    c,
    {
      module: "system.aiAgent",
      action: "updateTool",
      resource: "/ai/tool",
      resourceId: id,
      details: { code: payload.code, riskLevel: payload.riskLevel },
    },
    async () => {
      await sqlite.transaction(async (tx) => {
        await saveAiTool({ ...payload, id, userId: user.id, dbClient: tx });
      });
    },
  );
  return c.json(success(null, "更新成功"));
});

aiAgentRoutes.delete(
  "/ai/tool/:id",
  authRequired(),
  ability("system.aiAgent.delete"),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiAgent",
        action: "deleteTool",
        resource: "/ai/tool",
        resourceId: id,
        riskLevel: "high",
      },
      async () => {
        await softDeleteAiResource({ type: "tool", id, userId: user.id });
      },
    );
    return c.json(success(null, "删除成功"));
  },
);

aiAgentRoutes.get("/ai/agent/runs", authRequired(), ability("system.aiAgent.query"), async (c) => {
  const user = c.get("user");
  const sessionId = Number(new URL(c.req.url).searchParams.get("sessionId") || 0);
  const runs = await sqlite
    .prepare(
      `SELECT r.id, r.session_id AS "sessionId", r.agent_id AS "agentId", a.name AS "agentName",
      r.status, r.total_steps AS "totalSteps", r.input_tokens AS "inputTokens",
      r.output_tokens AS "outputTokens", r.duration_ms AS "durationMs", r.error_message AS "errorMessage",
      r.started_at AS "startedAt", r.finished_at AS "finishedAt"
     FROM sys_ai_agent_run r INNER JOIN sys_ai_agent a ON a.id = r.agent_id
     WHERE r.user_id = ? AND (? = 0 OR r.session_id = ?) ORDER BY r.id DESC LIMIT 100`,
    )
    .all(user.id, sessionId, sessionId);
  return c.json(success(runs));
});

aiAgentRoutes.get(
  "/ai/agent/runs/:id/steps",
  authRequired(),
  ability("system.aiAgent.query"),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    const steps = await sqlite
      .prepare(
        `SELECT s.id, s.step_no AS "stepNo", s.step_type AS "stepType", s.status,
      s.tool_name AS "toolName", s.tool_call_id AS "toolCallId", s.input_json AS "inputJson",
      s.output_json AS "outputJson", s.usage_json AS "usageJson", s.duration_ms AS "durationMs",
      s.error_message AS "errorMessage", s.started_at AS "startedAt", s.finished_at AS "finishedAt"
     FROM sys_ai_agent_run_step s INNER JOIN sys_ai_agent_run r ON r.id = s.run_id
     WHERE s.run_id = ? AND r.user_id = ? ORDER BY s.step_no ASC, s.id ASC`,
      )
      .all(id, user.id);
    return c.json(success(steps));
  },
);

aiAgentRoutes.get(
  "/ai/agent/runs/:id/trace",
  authRequired(),
  ability("system.aiAgent.query"),
  async (c) => {
    const trace = await getAiAgentRunTrace({
      id: Number(c.req.param("id")),
      userId: c.get("user").id,
    });
    if (!trace) return c.json({ success: false, msg: "Agent Run 不存在" }, 404);
    return c.json(success(trace));
  },
);

aiAgentRoutes.get(
  "/ai/chat/sessions/:id/approvals",
  authRequired(),
  ability("system.aiChat.query"),
  async (c) => {
    const user = c.get("user");
    return c.json(
      success(
        await listSessionApprovals({ sessionId: Number(c.req.param("id")), userId: user.id }),
      ),
    );
  },
);

aiAgentRoutes.get(
  "/ai/chat/sessions/:id/run/latest",
  authRequired(),
  ability("system.aiChat.query"),
  async (c) => {
    const user = c.get("user");
    return c.json(
      success(
        await getLatestSessionAgentRun({
          sessionId: Number(c.req.param("id")),
          userId: user.id,
        }),
      ),
    );
  },
);

aiAgentRoutes.get(
  "/ai/chat/sessions/:id/runs/:runId/events",
  authRequired(),
  ability("system.aiChat.query"),
  async (c) => {
    const user = c.get("user");
    const query = new URL(c.req.url).searchParams;
    const headerEventId = Number(c.req.header("Last-Event-ID") || 0);
    const afterEventId = Number(query.get("afterEventId") || headerEventId || 0);
    const events = await listAiAgentRunEvents({
      runId: Number(c.req.param("runId")),
      userId: user.id,
      afterEventId: Number.isFinite(afterEventId) ? afterEventId : 0,
    });
    return c.json(
      success({
        events,
        lastEventId: events.length ? events[events.length - 1]?.id : afterEventId,
      }),
    );
  },
);

aiAgentRoutes.post(
  "/ai/chat/sessions/:sessionId/client-actions/:id/result",
  authRequired(),
  ability("system.aiChat.chat"),
  async (c) => {
    const user = c.get("user");
    const sessionId = Number(c.req.param("sessionId"));
    const id = Number(c.req.param("id"));
    const payload = clientToolResultSchema.parse(await c.req.json());
    let result: Awaited<ReturnType<typeof submitClientToolResult>> | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiChat",
        action: "submitClientToolResult",
        resource: "/ai/chat/client-action",
        resourceId: id,
        riskLevel: "medium",
        details: {
          capability: "browser_location",
          resultStatus: payload.status,
          granted: payload.status === "granted",
        },
      },
      async () => {
        result = await submitClientToolResult({ id, sessionId, userId: user.id, result: payload });
      },
    );
    return c.json(success(result, "浏览器位置结果已提交"));
  },
);

aiAgentRoutes.post(
  "/ai/approval/:id/decision",
  authRequired(),
  ability("system.aiAgent.approve"),
  async (c) => {
    const user = c.get("user");
    const id = Number(c.req.param("id"));
    const payload = z
      .object({ approved: z.boolean(), reason: z.string().max(500).optional().nullable() })
      .parse(await c.req.json());
    let result: Awaited<ReturnType<typeof decideToolApproval>> | null = null;
    await runWithOperationLog(
      c,
      {
        module: "system.aiAgent",
        action: payload.approved ? "approveTool" : "denyTool",
        resource: "/ai/approval",
        resourceId: id,
        riskLevel: payload.approved ? "high" : "medium",
        details: { reason: payload.reason },
      },
      async () => {
        result = await decideToolApproval({
          id,
          userId: user.id,
          approved: payload.approved,
          reason: payload.reason,
        });
      },
    );
    const decisionStatus = (result as { status?: string } | null)?.status;
    const message =
      decisionStatus === "expired"
        ? "审批已过期，工具未执行"
        : payload.approved
          ? "已批准并执行"
          : "已拒绝";
    return c.json(success(result, message));
  },
);
