import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";
import { resolveAgentOrchestrator } from "@/server/mastra/config";
import { createAdminBaseMastraRequestContext } from "@/server/mastra/request-context";
import { getAiAgent, listAiTools } from "@/server/services/ai-agent-service";
import { isAiToolApprovalRequired } from "@/server/services/ai-agent-runtime-policy";
import { getAiRuntimeConfig } from "@/server/services/ai-provider-service";
import {
  createAiWorkflowRun,
  finishAiWorkflowRun,
  getAiWorkflowRun,
  runPersistedAiWorkflowStep,
} from "@/server/services/ai-workflow-service";
import { isAiToolHandlerKey } from "@/server/services/ai-tool-registry";
import { resolveDataScopeForUser } from "@/server/services/data-scope";

export const aiRuntimePreflightWorkflowCode = "ai-runtime-preflight";
export const aiRuntimePreflightInputSchema = z.object({
  agentId: z.coerce.number().int().positive(),
});

const preflightCheckSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["pass", "warning", "fail"]),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

const preflightStateSchema = z.object({
  agent: z
    .object({
      id: z.number(),
      name: z.string(),
      code: z.string(),
      modelId: z.number().nullable(),
      toolIds: z.array(z.number()),
      status: z.number(),
    })
    .nullable(),
  orchestrator: z.enum(["legacy", "mastra"]).nullable(),
  runtime: z
    .object({
      provider: z.object({ id: z.number(), code: z.string(), name: z.string() }),
      model: z.object({
        id: z.number(),
        name: z.string(),
        modelId: z.string(),
        capabilities: z.record(z.string(), z.unknown()),
        contextWindow: z.number().nullable(),
        maxOutputTokens: z.number().nullable(),
      }),
    })
    .nullable(),
  checks: z.array(preflightCheckSchema),
});

export const aiRuntimePreflightOutputSchema = z.object({
  status: z.enum(["ready", "warning", "failed"]),
  summary: z.object({
    passed: z.number(),
    warnings: z.number(),
    failed: z.number(),
  }),
  agent: preflightStateSchema.shape.agent,
  orchestrator: preflightStateSchema.shape.orchestrator,
  runtime: preflightStateSchema.shape.runtime,
  checks: z.array(preflightCheckSchema),
});

type PreflightState = z.infer<typeof preflightStateSchema>;

function workflowRunId(requestContext: { get: (key: "workflowRunId") => unknown }) {
  const id = requestContext.get("workflowRunId");
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new Error("Workflow RequestContext 缺少有效的 workflowRunId");
  }
  return id;
}

const inspectAgentStep = createStep({
  id: "inspect-agent",
  description: "检查 Agent 配置、编排器选择和请求治理上下文",
  inputSchema: aiRuntimePreflightInputSchema,
  outputSchema: preflightStateSchema,
  execute: async ({ inputData, requestContext }) =>
    runPersistedAiWorkflowStep({
      runId: workflowRunId(requestContext),
      stepNo: 1,
      stepCode: "inspect-agent",
      stepInput: inputData,
      execute: async () => {
        const agent = await getAiAgent(inputData.agentId);
        const abilities = requestContext.get("abilities") ?? [];
        const dataScope = requestContext.get("dataScope");
        const checks: PreflightState["checks"] = [];
        if (!agent) {
          checks.push({
            key: "agent.exists",
            label: "Agent 配置",
            status: "fail",
            message: "Agent 不存在或已删除",
          });
          return { agent: null, orchestrator: null, runtime: null, checks };
        }
        checks.push({
          key: "agent.exists",
          label: "Agent 配置",
          status: "pass",
          message: `已找到 ${agent.name}`,
        });
        checks.push({
          key: "agent.enabled",
          label: "Agent 状态",
          status: agent.status === 1 ? "pass" : "fail",
          message: agent.status === 1 ? "Agent 已启用" : "Agent 已停用",
        });
        checks.push({
          key: "governance.context",
          label: "治理上下文",
          status: "pass",
          message: "用户、权限和数据范围已注入 RequestContext",
          details: {
            abilityCount: Array.isArray(abilities) ? abilities.length : 0,
            dataScopeKind:
              dataScope && typeof dataScope === "object" && "kind" in dataScope
                ? String(dataScope.kind)
                : "unknown",
          },
        });
        return {
          agent: {
            id: agent.id,
            name: agent.name,
            code: agent.code,
            modelId: agent.modelId,
            toolIds: agent.toolIds,
            status: agent.status,
          },
          orchestrator: resolveAgentOrchestrator(agent.code),
          runtime: null,
          checks,
        };
      },
    }),
});

const inspectRuntimeStep = createStep({
  id: "inspect-runtime",
  description: "解析 Agent 使用的模型和 Provider，但不发起外部模型请求",
  inputSchema: preflightStateSchema,
  outputSchema: preflightStateSchema,
  execute: async ({ inputData, requestContext }) =>
    runPersistedAiWorkflowStep({
      runId: workflowRunId(requestContext),
      stepNo: 2,
      stepCode: "inspect-runtime",
      stepInput: inputData,
      execute: async () => {
        if (!inputData.agent) return inputData;
        try {
          const config = await getAiRuntimeConfig("chat", inputData.agent.modelId);
          const checks = [
            ...inputData.checks,
            {
              key: "runtime.provider",
              label: "Provider 连接",
              status: "pass" as const,
              message: `${config.provider.name} 已启用且凭据配置完整`,
              details: { providerCode: config.provider.code },
            },
            {
              key: "runtime.model",
              label: "Chat 模型",
              status: "pass" as const,
              message: `${config.model.name} 可用于 Chat Runtime`,
              details: { modelId: config.model.modelId },
            },
            {
              key: "runtime.contextWindow",
              label: "上下文限制",
              status: config.model.contextWindow ? ("pass" as const) : ("warning" as const),
              message: config.model.contextWindow
                ? `上下文窗口为 ${config.model.contextWindow} tokens`
                : "未登记上下文窗口，将使用运行时保守预算",
            },
          ];
          return {
            ...inputData,
            runtime: {
              provider: {
                id: config.provider.id,
                code: config.provider.code,
                name: config.provider.name,
              },
              model: {
                id: config.model.id,
                name: config.model.name,
                modelId: config.model.modelId,
                capabilities: config.model.capabilities,
                contextWindow: config.model.contextWindow ?? null,
                maxOutputTokens: config.model.maxOutputTokens ?? null,
              },
            },
            checks,
          };
        } catch (error) {
          return {
            ...inputData,
            runtime: null,
            checks: [
              ...inputData.checks,
              {
                key: "runtime.configuration",
                label: "模型运行时",
                status: "fail" as const,
                message: error instanceof Error ? error.message : String(error),
              },
            ],
          };
        }
      },
    }),
});

const inspectToolsStep = createStep({
  id: "inspect-tools",
  description: "检查 Tool Registry、启用状态、审批策略和模型能力声明",
  inputSchema: preflightStateSchema,
  outputSchema: preflightStateSchema,
  execute: async ({ inputData, requestContext }) =>
    runPersistedAiWorkflowStep({
      runId: workflowRunId(requestContext),
      stepNo: 3,
      stepCode: "inspect-tools",
      stepInput: inputData,
      execute: async () => {
        if (!inputData.agent) return inputData;
        const tools = await listAiTools({ agentId: inputData.agent.id });
        const activeTools = tools.filter((tool) => tool.status === 1);
        const invalidHandlers = activeTools.filter((tool) => !isAiToolHandlerKey(tool.handlerKey));
        const unprotectedHighRisk = activeTools.filter(
          (tool) =>
            (tool.riskLevel === "high" || tool.riskLevel === "critical") &&
            !isAiToolApprovalRequired(tool),
        );
        const checks: PreflightState["checks"] = [...inputData.checks];
        checks.push({
          key: "tools.registry",
          label: "工具注册表",
          status: invalidHandlers.length ? "fail" : "pass",
          message: invalidHandlers.length
            ? `${invalidHandlers.length} 个工具没有服务端注册处理器`
            : `${activeTools.length} 个启用工具均来自服务端注册表`,
          details: { active: activeTools.length, configured: tools.length },
        });
        if (tools.length !== activeTools.length) {
          checks.push({
            key: "tools.disabled",
            label: "工具启用状态",
            status: "warning",
            message: `${tools.length - activeTools.length} 个已绑定工具当前停用`,
          });
        }
        checks.push({
          key: "tools.approval",
          label: "高风险审批",
          status: unprotectedHighRisk.length ? "fail" : "pass",
          message: unprotectedHighRisk.length
            ? `${unprotectedHighRisk.length} 个高风险工具没有强制审批`
            : "高风险工具审批策略有效",
        });
        if (activeTools.length > 0 && inputData.runtime) {
          const capabilities = inputData.runtime.model.capabilities;
          const declaresToolCalling =
            capabilities.toolCalling === true || capabilities.tools === true;
          checks.push({
            key: "model.toolCalling",
            label: "Tool Calling 能力",
            status: declaresToolCalling ? "pass" : "warning",
            message: declaresToolCalling
              ? "模型已声明 Tool Calling 能力"
              : "模型未声明 Tool Calling 能力，正式使用前应进行 Agent 调试",
          });
        }
        return { ...inputData, checks };
      },
    }),
});

const summarizeStep = createStep({
  id: "summarize",
  description: "汇总确定性的预检结果",
  inputSchema: preflightStateSchema,
  outputSchema: aiRuntimePreflightOutputSchema,
  execute: async ({ inputData, requestContext }) =>
    runPersistedAiWorkflowStep({
      runId: workflowRunId(requestContext),
      stepNo: 4,
      stepCode: "summarize",
      stepInput: inputData,
      execute: async () => {
        const passed = inputData.checks.filter((check) => check.status === "pass").length;
        const warnings = inputData.checks.filter((check) => check.status === "warning").length;
        const failed = inputData.checks.filter((check) => check.status === "fail").length;
        return {
          status: failed ? ("failed" as const) : warnings ? ("warning" as const) : ("ready" as const),
          summary: { passed, warnings, failed },
          agent: inputData.agent,
          orchestrator: inputData.orchestrator,
          runtime: inputData.runtime,
          checks: inputData.checks,
        };
      },
    }),
});

const aiRuntimePreflightWorkflow = createWorkflow({
  id: aiRuntimePreflightWorkflowCode,
  description: "检查 Agent、Provider、Model、Tool 和治理上下文是否可以进入正式调试",
  inputSchema: aiRuntimePreflightInputSchema,
  outputSchema: aiRuntimePreflightOutputSchema,
})
  .then(inspectAgentStep)
  .then(inspectRuntimeStep)
  .then(inspectToolsStep)
  .then(summarizeStep)
  .commit();

export async function runAiRuntimePreflightWorkflow(input: {
  workflowInput: z.infer<typeof aiRuntimePreflightInputSchema>;
  userId: number;
  abilities: string[];
  requestId: string;
}) {
  const startedAt = performance.now();
  const parsedInput = aiRuntimePreflightInputSchema.parse(input.workflowInput);
  const persistedRun = await createAiWorkflowRun({
    workflowCode: aiRuntimePreflightWorkflowCode,
    userId: input.userId,
    requestId: input.requestId,
    resourceType: "ai-agent",
    resourceId: String(parsedInput.agentId),
    workflowInput: parsedInput,
  });
  try {
    const requestContext = createAdminBaseMastraRequestContext({
      userId: input.userId,
      abilities: input.abilities,
      requestId: input.requestId,
      dataScope: await resolveDataScopeForUser(input.userId),
      workflowRunId: persistedRun.id,
    });
    const workflowRun = await aiRuntimePreflightWorkflow.createRun({
      runId: persistedRun.orchestratorRunId,
      resourceId: String(parsedInput.agentId),
      disableScorers: true,
    });
    const execution = await workflowRun.start({
      inputData: parsedInput,
      requestContext: requestContext as RequestContext,
    });
    if (execution.status !== "success" || !execution.result) {
      throw new Error(`AI Runtime 预检工作流未完成：${execution.status}`);
    }
    await finishAiWorkflowRun({
      id: persistedRun.id,
      status: "completed",
      output: execution.result,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return getAiWorkflowRun({ id: persistedRun.id, userId: input.userId });
  } catch (error) {
    await finishAiWorkflowRun({
      id: persistedRun.id,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
}
