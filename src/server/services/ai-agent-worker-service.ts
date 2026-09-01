import { randomUUID } from "node:crypto";
import {
  appendAgentRunEvent,
  appendAgentRunStep,
  assertAgentRunLease,
  claimAgentRunLease,
  createToolApproval,
  finishAgentRun,
  getAiAgent,
} from "./ai-agent-service";
import { createAiAgentStream } from "./ai-agent-runtime-service";
import {
  appendAiChatMessage,
  getAiChatSession,
  listAiChatMessages,
  refreshAiChatSessionSummary,
  updateAiChatMessage,
} from "./ai-chat-service";
import { governAiChatContext } from "./ai-context-service";
import { resolveAiOutputTokens } from "./ai-runtime-service";
import { resolveAiRuntimeCandidates } from "./ai-reliability-service";
import { sqlite } from "@/server/db";

type ClaimedRun = NonNullable<Awaited<ReturnType<typeof claimAgentRunLease>>>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Execute a database-owned Run without an HTTP response. The same stream/runtime path is used by
 * Chat and by the long-running worker; only the delivery adapter differs.
 */
export async function processNextAgentRun(workerId = `agent-worker-${randomUUID().slice(0, 8)}`) {
  const claimed = await claimAgentRunLease({ workerId });
  if (!claimed) return null;
  try {
    return await executeClaimedAgentRun(claimed);
  } catch (error) {
    // A broken session/agent/config must fail this attempt without taking down the
    // resident worker. The lease predicate keeps a successor attempt protected.
    await finishAgentRun({
      id: claimed.id,
      status: "failed",
      durationMs: 0,
      errorMessage: errorMessage(error).slice(0, 2000),
      leaseOwner: claimed.leaseOwner,
    }).catch(() => undefined);
    return { id: claimed.id, status: "failed" as const, attempt: claimed.attempt };
  }
}

export async function executeClaimedAgentRun(claimed: ClaimedRun) {
  const session = await getAiChatSession({ id: claimed.sessionId, userId: claimed.userId });
  const agent = await getAiAgent(claimed.agentId);
  if (!session || !agent) throw new Error("Agent Run 关联的会话或 Agent 不存在");

  const messages = await listAiChatMessages({
    sessionId: claimed.sessionId,
    userId: claimed.userId,
  });
  const [config] = await resolveAiRuntimeCandidates({
    purpose: "agent",
    modelId: session.modelId || agent.modelId,
  });
  const governed = governAiChatContext({
    messages,
    systemPrompt: [agent.instructions, session.systemPrompt].filter(Boolean).join("\n\n"),
    previousSummary: session.contextSummary,
    previouslyCompactedThroughMessageId: session.compactedThroughMessageId,
    contextWindow: config.model.contextWindow,
    maxOutputTokens: resolveAiOutputTokens({ modelLimit: config.model.maxOutputTokens }),
  });

  let assistantMessageId = claimed.outputMessageId;
  const existingAssistant = assistantMessageId
    ? messages.find((message) => message.id === assistantMessageId)
    : undefined;
  if (!assistantMessageId) {
    assistantMessageId = await appendAiChatMessage({
      sessionId: claimed.sessionId,
      userId: claimed.userId,
      role: "assistant",
      content: "",
      status: "streaming",
      parentMessageId: claimed.inputMessageId,
      providerId: config.provider.id,
      modelId: config.model.id,
    });
  } else {
    await updateAiChatMessage({
      id: assistantMessageId,
      sessionId: claimed.sessionId,
      userId: claimed.userId,
      status: "streaming",
      errorMessage: null,
      providerId: config.provider.id,
      modelId: config.model.id,
    });
  }

  const abortController = new AbortController();
  let heartbeatError: unknown = null;
  const heartbeat = setInterval(() => {
    void import("./ai-agent-service")
      .then(({ heartbeatAgentRun }) =>
        heartbeatAgentRun({ id: claimed.id, leaseOwner: claimed.leaseOwner }),
      )
      .catch((error: unknown) => {
        heartbeatError = error;
        abortController.abort(error);
      });
  }, 10_000);

  let assistantText = existingAssistant?.content || "";
  let stepNo = 0;
  let waitingApproval = false;
  let finishReason = "stop";
  let rawFinishReason: string | undefined;
  let usage: Record<string, unknown> = {};
  const startedAt = performance.now();
  try {
    const runtime = await createAiAgentStream({
      agentId: claimed.agentId,
      sessionId: claimed.sessionId,
      userId: claimed.userId,
      inputMessageId: claimed.inputMessageId,
      messages: governed.messages,
      modelId: session.modelId || agent.modelId,
      maxOutputTokens: session.maxOutputTokens || agent.maxOutputTokens || undefined,
      temperature: session.temperatureMilli / 1000,
      abortSignal: abortController.signal,
      runLease: {
        id: claimed.id,
        attempt: claimed.attempt,
        leaseOwner: claimed.leaseOwner,
      },
      requestId: `ai-worker-run-${claimed.id}-${claimed.attempt}`,
    });

    await appendAgentRunEvent({
      runId: claimed.id,
      leaseOwner: claimed.leaseOwner,
      eventType: "worker-start",
      payload: { attempt: claimed.attempt, workerId: claimed.leaseOwner },
    });

    for await (const part of runtime.stream.fullStream) {
      if (part.type === "text-delta") {
        if (!part.text) continue;
        assistantText += part.text;
        await appendAgentRunEvent({
          runId: claimed.id,
          leaseOwner: claimed.leaseOwner,
          eventType: "delta",
          payload: { text: part.text },
        });
      } else if (part.type === "reasoning-start" || part.type === "reasoning-end") {
        await appendAgentRunEvent({
          runId: claimed.id,
          leaseOwner: claimed.leaseOwner,
          eventType: part.type,
          payload: {},
        });
      } else if (part.type === "reasoning-delta") {
        await appendAgentRunEvent({
          runId: claimed.id,
          leaseOwner: claimed.leaseOwner,
          eventType: "reasoning-delta",
          payload: { text: part.text },
        });
      } else if (part.type === "tool-call") {
        await appendAgentRunEvent({
          runId: claimed.id,
          leaseOwner: claimed.leaseOwner,
          eventType: "tool-call",
          payload: { toolCallId: part.toolCallId, toolName: part.toolName, input: part.input },
        });
      } else if (part.type === "tool-result") {
        await appendAgentRunEvent({
          runId: claimed.id,
          leaseOwner: claimed.leaseOwner,
          eventType: "tool-result",
          payload: { toolCallId: part.toolCallId, toolName: part.toolName, output: part.output },
        });
      } else if (part.type === "tool-approval-request") {
        if (waitingApproval) continue;
        waitingApproval = true;
        const tool = runtime.toolMap.get(part.toolCall.toolName);
        const stepId = await appendAgentRunStep({
          runId: claimed.id,
          stepNo: ++stepNo,
          stepType: "approval",
          status: "waiting_approval",
          toolId: tool?.id,
          toolName: part.toolCall.toolName,
          toolCallId: part.toolCall.toolCallId,
          input: part.toolCall.input,
          leaseOwner: claimed.leaseOwner,
        });
        const approvalId = await createToolApproval({
          runId: claimed.id,
          stepId,
          sessionId: claimed.sessionId,
          userId: claimed.userId,
          tool,
          toolName: part.toolCall.toolName,
          toolCallId: part.toolCall.toolCallId,
          toolInput: part.toolCall.input,
          leaseOwner: claimed.leaseOwner,
        });
        await appendAgentRunEvent({
          runId: claimed.id,
          leaseOwner: claimed.leaseOwner,
          eventType: "approval",
          payload: { id: approvalId, toolName: part.toolCall.toolName, input: part.toolCall.input },
        });
      } else if (part.type === "finish-step") {
        await appendAgentRunStep({
          runId: claimed.id,
          stepNo: ++stepNo,
          stepType: "model",
          status: "completed",
          usage: part.usage,
          durationMs: Math.round(part.performance.stepTimeMs),
          leaseOwner: claimed.leaseOwner,
        });
      } else if (part.type === "finish") {
        finishReason = part.finishReason;
        rawFinishReason = part.rawFinishReason;
        usage = runtime.runtime.normalizeUsage(part.totalUsage);
      } else if (part.type === "error") {
        throw part.error;
      }
    }

    if (heartbeatError) throw heartbeatError;
    // The stream can finish between heartbeat ticks. Re-check immediately before any
    // assistant/session/terminal write so a reclaimed attempt cannot overwrite its successor.
    await assertAgentRunLease({ id: claimed.id, leaseOwner: claimed.leaseOwner });
    const durationMs = Math.round(performance.now() - startedAt);
    const status = waitingApproval ? "waiting_approval" : "completed";
    await updateAiChatMessage({
      id: assistantMessageId,
      sessionId: claimed.sessionId,
      userId: claimed.userId,
      content: assistantText || (waitingApproval ? "等待工具调用审批" : ""),
      status: "completed",
      finishReason,
      usage,
      metadata: { worker: true, attempt: claimed.attempt, rawFinishReason, waitingApproval },
      durationMs,
      providerId: runtime.runtime.publicConfig.provider.id,
      modelId: runtime.runtime.publicConfig.model.id,
    });
    await refreshAiChatSessionSummary({
      sessionId: claimed.sessionId,
      userId: claimed.userId,
      runtime: runtime.runtime.publicConfig,
      usage,
      contextSummary: governed.summary,
      compactedThroughMessageId: governed.compactedThroughMessageId,
    });
    await assertAgentRunLease({ id: claimed.id, leaseOwner: claimed.leaseOwner });
    await appendAgentRunEvent({
      runId: claimed.id,
      leaseOwner: claimed.leaseOwner,
      eventType: "finish",
      payload: { finishReason, usage, durationMs, waitingApproval },
    });
    await finishAgentRun({
      id: claimed.id,
      status,
      outputMessageId: assistantMessageId,
      totalSteps: stepNo,
      usage,
      durationMs,
      leaseOwner: claimed.leaseOwner,
    });
    return { id: claimed.id, status, attempt: claimed.attempt };
  } catch (error) {
    const message = errorMessage(heartbeatError || error);
    const stopped = abortController.signal.aborted && Boolean(heartbeatError);
    try {
      await assertAgentRunLease({ id: claimed.id, leaseOwner: claimed.leaseOwner });
      await updateAiChatMessage({
        id: assistantMessageId,
        sessionId: claimed.sessionId,
        userId: claimed.userId,
        content: assistantText,
        status: stopped ? "stopped" : "failed",
        errorMessage: stopped ? message : message,
        finishReason: stopped ? "lease_lost" : "error",
        durationMs: Math.round(performance.now() - startedAt),
      });
      await appendAgentRunEvent({
        runId: claimed.id,
        leaseOwner: claimed.leaseOwner,
        eventType: "error",
        payload: { message, stopped },
      });
      await finishAgentRun({
        id: claimed.id,
        status: stopped ? "stopped" : "failed",
        outputMessageId: assistantMessageId,
        totalSteps: stepNo,
        durationMs: Math.round(performance.now() - startedAt),
        errorMessage: message,
        leaseOwner: claimed.leaseOwner,
      });
    } catch {
      // A lost lease is expected to make every old-attempt write fail closed.
    }
    return { id: claimed.id, status: stopped ? "stopped" : "failed", attempt: claimed.attempt };
  } finally {
    clearInterval(heartbeat);
  }
}

export async function getAgentRunWorkerHealth() {
  const row = (await sqlite
    .prepare(
      `SELECT COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
         COUNT(*) FILTER (WHERE status = 'running' AND lease_until <= now())::int AS expired,
         COUNT(*) FILTER (WHERE status = 'running')::int AS running
       FROM sys_ai_agent_run`,
    )
    .get()) as { queued: number; expired: number; running: number };
  return { queued: Number(row.queued), expired: Number(row.expired), running: Number(row.running) };
}
