import { stepCountIs, streamText, tool, type ModelMessage, type ToolSet } from "ai";
import { createMastraAiAgentStream } from "@/server/mastra/agent-runtime";
import { resolveAgentOrchestrator } from "@/server/mastra/config";
import {
  appendAgentRunStep,
  createAgentRun,
  executeAgentTool,
  finishAgentRun,
  getAiAgent,
  listAiTools,
} from "./ai-agent-service";
import { isAiToolApprovalRequired } from "./ai-agent-runtime-policy";
import { getAiToolInputSchema } from "./ai-tool-registry";
import type { AiRuntimeMessage } from "./ai-runtime-service";
import { createAiRuntime } from "./ai-runtime-service";

function toModelMessages(messages: AiRuntimeMessage[]): ModelMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

export type CreateAiAgentStreamInput = {
  agentId: number;
  sessionId: number;
  userId: number;
  inputMessageId?: number | null;
  parentRunId?: number | null;
  sourceApprovalId?: number | null;
  messages: AiRuntimeMessage[];
  modelId?: number | null;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  abortSignal: AbortSignal;
  abilities?: string[];
  requestId?: string;
};

export async function createLegacyAiAgentStream(input: CreateAiAgentStreamInput) {
  const startedAt = performance.now();
  const agent = await getAiAgent(input.agentId);
  if (!agent || agent.status !== 1) throw new Error("Agent 不存在或已停用");
  const runtime = await createAiRuntime({
    usage: "chat",
    messages: input.messages,
    modelId: input.modelId || agent.modelId,
    maxOutputTokens: input.maxOutputTokens || agent.maxOutputTokens || undefined,
    temperature: input.temperature ?? agent.temperatureMilli / 1000,
    timeoutMs: input.timeoutMs,
    abortSignal: input.abortSignal,
  });
  const runId = await createAgentRun({
    sessionId: input.sessionId,
    agentId: agent.id,
    userId: input.userId,
    inputMessageId: input.inputMessageId,
    parentRunId: input.parentRunId,
    sourceApprovalId: input.sourceApprovalId,
  });
  const toolRows = await listAiTools({ activeOnly: true, agentId: agent.id });
  const toolMap = new Map(toolRows.map((item) => [item.code, item]));
  let stepNo = 0;
  const tools: ToolSet = {};

  for (const toolRow of toolRows) {
    tools[toolRow.code] = tool({
      description: toolRow.description,
      inputSchema: getAiToolInputSchema(toolRow.handlerKey),
      needsApproval: isAiToolApprovalRequired(toolRow),
      execute: async (toolInput) => {
        const startedAt = performance.now();
        stepNo += 1;
        try {
          const output = await executeAgentTool(toolRow, toolInput as Record<string, unknown>, {
            userId: input.userId,
            requestId: input.requestId,
          });
          await appendAgentRunStep({
            runId,
            stepNo,
            stepType: "tool",
            status: "completed",
            toolId: toolRow.id,
            toolName: toolRow.code,
            input: toolInput,
            output,
            durationMs: Math.round(performance.now() - startedAt),
          });
          return output;
        } catch (error) {
          await appendAgentRunStep({
            runId,
            stepNo,
            stepType: "tool",
            status: "failed",
            toolId: toolRow.id,
            toolName: toolRow.code,
            input: toolInput,
            durationMs: Math.round(performance.now() - startedAt),
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    });
  }

  let stream: ReturnType<typeof streamText>;
  try {
    stream = streamText({
      model: runtime.sdkRuntime.model,
      messages: toModelMessages(runtime.messages),
      allowSystemInMessages: true,
      tools,
      stopWhen: stepCountIs(Math.min(Math.max(agent.maxSteps, 1), 20)),
      maxOutputTokens: runtime.maxOutputTokens,
      temperature: runtime.temperature,
      timeout: runtime.timeoutMs,
      abortSignal: input.abortSignal,
    });
  } catch (error) {
    await finishAgentRun({
      id: runId,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return {
    orchestrator: "legacy" as const,
    agent,
    runId,
    runtime: {
      ...runtime,
      startedAt,
      endpointHint: runtime.sdkRuntime.endpointHint,
      normalizeUsage: (usage: unknown): Record<string, unknown> =>
        usage && typeof usage === "object" && !Array.isArray(usage)
          ? Object.fromEntries(
              Object.entries(usage as Record<string, unknown>).filter(([, value]) => value != null),
            )
          : {},
      resolveDurationMs: () => Math.round(performance.now() - startedAt),
    },
    stream,
    toolMap,
    nextStepNo: () => {
      stepNo += 1;
      return stepNo;
    },
    currentStepNo: () => stepNo,
  };
}

export async function createAiAgentStream(input: CreateAiAgentStreamInput) {
  const agent = await getAiAgent(input.agentId);
  if (!agent || agent.status !== 1) throw new Error("Agent 不存在或已停用");
  if (resolveAgentOrchestrator(agent.code) === "mastra") {
    return createMastraAiAgentStream(input);
  }
  return createLegacyAiAgentStream(input);
}
