import { Agent } from "@mastra/core/agent";
import type { ModelMessage } from "ai";
import {
  appendAgentRunStep,
  assertAgentRunLease,
  createAgentRunLease,
  executeAgentTool,
  finishAgentRun,
  getAiAgent,
  heartbeatAgentRun,
  listAiTools,
} from "@/server/services/ai-agent-service";
import { isAiToolApprovalRequired } from "@/server/services/ai-agent-runtime-policy";
import { createAiFallbackLanguageModel } from "@/server/services/ai-reliability-service";
import { resolveAgentGovernedContext } from "@/server/services/ai-governance-service";
import type { AiRuntimeMessage } from "@/server/services/ai-runtime-service";
import { createAiRuntimePool } from "@/server/services/ai-runtime-service";
import { resolveDataScopeForUser } from "@/server/services/data-scope";
import { createAdminBaseMastraRequestContext } from "./request-context";
import { toMastraLanguageModel } from "./model-adapter";
import { adaptMastraAgentStream } from "./stream-adapter";
import { createMastraToolSet } from "./tool-adapter";

function toModelMessages(messages: AiRuntimeMessage[]): ModelMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function separateAgentInstructions(messages: AiRuntimeMessage[], instructions: string) {
  const first = messages[0];
  const normalizedInstructions = instructions.trim();
  if (
    first?.role === "system" &&
    normalizedInstructions &&
    first.content.startsWith(normalizedInstructions)
  ) {
    return { instructions: first.content, messages: messages.slice(1) };
  }
  return { instructions: normalizedInstructions, messages };
}

function normalizeUsage(usage: unknown): Record<string, unknown> {
  return usage && typeof usage === "object" && !Array.isArray(usage)
    ? Object.fromEntries(
        Object.entries(usage as Record<string, unknown>).filter(([, value]) => value != null),
      )
    : {};
}

export async function createMastraAiAgentStream(input: {
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
  runLease?: {
    id: number;
    attempt: number;
    leaseOwner: string;
  };
}) {
  const startedAt = performance.now();
  const agentRow = await getAiAgent(input.agentId);
  if (!agentRow || agentRow.status !== 1) throw new Error("Agent 不存在或已停用");
  const governed = await resolveAgentGovernedContext({
    agentId: agentRow.id,
    userId: input.userId,
    query: input.messages.at(-1)?.content,
  });
  const governedMessages = governed.instructions
    ? ([
        { role: "system", content: governed.instructions },
        ...input.messages,
      ] as AiRuntimeMessage[])
    : input.messages;
  const runtimes = await createAiRuntimePool({
    purpose: "agent",
    messages: governedMessages,
    modelId: input.modelId || agentRow.modelId,
    maxOutputTokens: input.maxOutputTokens || agentRow.maxOutputTokens || undefined,
    temperature: input.temperature ?? agentRow.temperatureMilli / 1000,
    timeoutMs: input.timeoutMs,
    abortSignal: input.abortSignal,
  });
  const runtime = runtimes[0];
  const run = input.runLease
    ? (await assertAgentRunLease({ id: input.runLease.id, leaseOwner: input.runLease.leaseOwner }),
      input.runLease)
    : await createAgentRunLease({
        sessionId: input.sessionId,
        agentId: agentRow.id,
        userId: input.userId,
        inputMessageId: input.inputMessageId,
        parentRunId: input.parentRunId,
        sourceApprovalId: input.sourceApprovalId,
      });
  const runId = run.id;
  const configuredTools = await listAiTools({ activeOnly: true, agentId: agentRow.id });
  const toolRows = governed.allowedToolIds
    ? configuredTools.filter((item) => governed.allowedToolIds?.has(item.id))
    : configuredTools;
  const toolMap = new Map(toolRows.map((item) => [item.code, item]));
  let stepNo = 0;
  const tools = createMastraToolSet({
    tools: toolRows,
    requiresApproval: isAiToolApprovalRequired,
    execute: async (toolRow, toolInput, toolCallId) => {
      const toolStartedAt = performance.now();
      stepNo += 1;
      try {
        const output = await executeAgentTool(toolRow, toolInput, {
          userId: input.userId,
          requestId: input.requestId,
          runId,
          leaseOwner: run.leaseOwner,
          toolCallId,
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
          durationMs: Math.round(performance.now() - toolStartedAt),
          leaseOwner: run.leaseOwner,
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
          durationMs: Math.round(performance.now() - toolStartedAt),
          errorMessage: error instanceof Error ? error.message : String(error),
          leaseOwner: run.leaseOwner,
        });
        throw error;
      }
    },
  });
  const requestContext = createAdminBaseMastraRequestContext({
    userId: input.userId,
    abilities: input.abilities ?? [],
    requestId: input.requestId ?? `ai-agent-run-${runId}`,
    dataScope: await resolveDataScopeForUser(input.userId),
  });
  const fallbackModel = createAiFallbackLanguageModel({
    purpose: "agent",
    candidates: runtimes.map((item) => ({ config: item.config, model: item.sdkRuntime.model })),
    trace: {
      sourceType: "agent",
      sourceId: input.inputMessageId,
      requestId: input.requestId,
      userId: input.userId,
      sessionId: input.sessionId,
      runId,
    },
  });
  const agentInput = separateAgentInstructions(runtime.messages, agentRow.instructions);
  const mastraAgent = new Agent({
    id: `admin-base-${agentRow.code}`,
    name: agentRow.name,
    description: agentRow.description ?? undefined,
    instructions: agentInput.instructions,
    model: toMastraLanguageModel(fallbackModel),
    tools,
    maxRetries: 0,
  });

  try {
    const stream = await mastraAgent.stream(toModelMessages(agentInput.messages), {
      runId: `admin-base-run-${runId}`,
      requestContext,
      maxSteps: Math.min(Math.max(agentRow.maxSteps, 1), 20),
      modelSettings: {
        maxOutputTokens: runtime.maxOutputTokens,
        temperature: runtime.temperature,
      },
      abortSignal: AbortSignal.any([input.abortSignal, AbortSignal.timeout(runtime.timeoutMs)]),
    });
    return {
      orchestrator: "mastra" as const,
      agent: agentRow,
      runId,
      leaseOwner: run.leaseOwner,
      runtime: {
        ...runtime,
        startedAt,
        endpointHint: runtime.sdkRuntime.endpointHint,
        normalizeUsage,
        resolveDurationMs: () => Math.round(performance.now() - startedAt),
      },
      stream: { fullStream: adaptMastraAgentStream(stream) },
      toolMap,
      heartbeat: () => heartbeatAgentRun({ id: runId, leaseOwner: run.leaseOwner }),
      nextStepNo: () => {
        stepNo += 1;
        return stepNo;
      },
      currentStepNo: () => stepNo,
    };
  } catch (error) {
    await finishAgentRun({
      id: runId,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      leaseOwner: run.leaseOwner,
    });
    throw error;
  }
}
