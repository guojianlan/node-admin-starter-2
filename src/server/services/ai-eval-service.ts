import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AdminUserContext } from "@/server/context";
import { sqlite } from "@/server/db";
import {
  appendAiChatMessage,
  createAiChatSession,
  softDeleteAiChatSession,
  updateAiChatMessage,
} from "./ai-chat-service";
import { createAiAgentStream } from "./ai-agent-runtime-service";
import { generateAiStructured } from "./ai-capability-runtime-service";
import {
  appendAgentRunStep,
  createToolApproval,
  decideToolApproval,
  finishAgentRun,
  getAiAgent,
  getAiAgentRunTrace,
  getLatestSessionAgentRun,
} from "./ai-agent-service";
import { resolveDataScopeForUser, type ResolvedDataScope } from "./data-scope";

export type AiEvalScopeType = "global" | "department" | "user";
export type AiEvalAssertions = {
  contains?: string[];
  notContains?: string[];
  expectedTools?: string[];
  forbiddenTools?: string[];
  maxLatencyMs?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxEstimatedCost?: number;
};

export type AiEvalDatasetInput = {
  name: string;
  description?: string | null;
  scopeType: AiEvalScopeType;
  deptId?: number | null;
  status?: number;
  sort?: number;
};

export type AiEvalCaseInput = {
  name: string;
  description?: string | null;
  agentId: number;
  inputText: string;
  expectedText?: string | null;
  assertions?: AiEvalAssertions;
  tags?: string[];
  status?: number;
  sort?: number;
  judgeEnabled?: boolean;
  judgeRubric?: string | null;
  groundednessRequired?: boolean;
};

type EvalDatasetRow = {
  id: number;
  name: string;
  description: string | null;
  scopeType: AiEvalScopeType;
  deptId: number | null;
  ownerId: number | null;
  status: number;
  sort: number;
};

type EvalCaseRow = {
  id: number;
  datasetId: number;
  name: string;
  description: string | null;
  agentId: number;
  agentName: string;
  sourceRunId: number | null;
  inputText: string;
  expectedText: string | null;
  assertionsJson: string;
  tagsJson: string;
  judgeEnabled: boolean;
  judgeRubric: string | null;
  groundednessRequired: boolean;
  status: number;
  sort: number;
};

type AssertionOutcome = {
  key: string;
  label: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
};

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

function datasetVisibilityClause(scope: ResolvedDataScope, alias = "dataset") {
  if (scope.kind === "all") return { sql: "1 = 1", params: [] as number[] };
  const conditions = [`${alias}.scope_type = 'global'`, `${alias}.owner_id = ?`];
  const params = [scope.userId];
  if (scope.deptIds.length) {
    conditions.push(`${alias}.dept_id IN (${placeholders(scope.deptIds)})`);
    params.push(...scope.deptIds);
  }
  return { sql: `(${conditions.join(" OR ")})`, params };
}

function resolveOwnedScope(
  payload: AiEvalDatasetInput,
  user: AdminUserContext,
  scope: ResolvedDataScope,
) {
  if (payload.scopeType === "global") return { deptId: null, ownerId: null };
  if (payload.scopeType === "user") return { deptId: null, ownerId: user.id };
  const deptId = Number(payload.deptId ?? user.deptId ?? 0);
  if (!deptId) throw new HTTPException(400, { message: "部门数据集必须选择归属部门" });
  if (scope.kind !== "all" && !scope.deptIds.includes(deptId)) {
    throw new HTTPException(403, { message: "不能为数据权限范围外的部门创建 Eval 数据集" });
  }
  return { deptId, ownerId: null };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeStringList(values?: string[]) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeAssertions(value: AiEvalAssertions = {}): AiEvalAssertions {
  const positive = (number: number | undefined) =>
    number != null && Number.isFinite(number) && number >= 0 ? number : undefined;
  return {
    contains: normalizeStringList(value.contains),
    notContains: normalizeStringList(value.notContains),
    expectedTools: normalizeStringList(value.expectedTools),
    forbiddenTools: normalizeStringList(value.forbiddenTools),
    maxLatencyMs: positive(value.maxLatencyMs),
    maxInputTokens: positive(value.maxInputTokens),
    maxOutputTokens: positive(value.maxOutputTokens),
    maxEstimatedCost: positive(value.maxEstimatedCost),
  };
}

async function assertAgent(agentId: number) {
  const agent = await getAiAgent(agentId);
  if (!agent || agent.status !== 1) {
    throw new HTTPException(400, { message: "Agent 不存在或已停用" });
  }
  return agent;
}

export async function getVisibleAiEvalDataset(id: number, userId: number, enabledOnly = false) {
  const scope = await resolveDataScopeForUser(userId);
  const visibility = datasetVisibilityClause(scope);
  return (await sqlite
    .prepare(
      `SELECT dataset.id, dataset.name, dataset.description,
        dataset.scope_type AS "scopeType", dataset.dept_id AS "deptId",
        dataset.owner_id AS "ownerId", dataset.status, dataset.sort
       FROM sys_ai_eval_dataset dataset
       WHERE dataset.id = ? AND dataset.deleted_at IS NULL AND ${visibility.sql}
         ${enabledOnly ? "AND dataset.status = 1" : ""}`,
    )
    .get(id, ...visibility.params)) as EvalDatasetRow | undefined;
}

export async function listAiEvalDatasets(input: {
  userId: number;
  keyword?: string;
  status?: number;
}) {
  const scope = await resolveDataScopeForUser(input.userId);
  const visibility = datasetVisibilityClause(scope);
  const filters = ["dataset.deleted_at IS NULL", visibility.sql];
  const params: Array<string | number> = [...visibility.params];
  if (input.keyword?.trim()) {
    filters.push("(dataset.name ILIKE ? OR COALESCE(dataset.description, '') ILIKE ?)");
    params.push(`%${input.keyword.trim()}%`, `%${input.keyword.trim()}%`);
  }
  if (input.status != null) {
    filters.push("dataset.status = ?");
    params.push(input.status);
  }
  return sqlite
    .prepare(
      `SELECT dataset.id, dataset.name, dataset.description,
        dataset.scope_type AS "scopeType", dataset.dept_id AS "deptId",
        dept.name AS "deptName", dataset.owner_id AS "ownerId", owner.nickname AS "ownerName",
        dataset.status, dataset.sort, dataset.created_at AS "createdAt",
        dataset.updated_at AS "updatedAt",
        COUNT(DISTINCT eval_case.id) FILTER (WHERE eval_case.deleted_at IS NULL)::int AS "caseCount",
        COUNT(DISTINCT eval_run.id)::int AS "runCount"
       FROM sys_ai_eval_dataset dataset
       LEFT JOIN sys_dept dept ON dept.id = dataset.dept_id
       LEFT JOIN sys_user owner ON owner.id = dataset.owner_id
       LEFT JOIN sys_ai_eval_case eval_case ON eval_case.dataset_id = dataset.id
       LEFT JOIN sys_ai_eval_run eval_run ON eval_run.dataset_id = dataset.id
       WHERE ${filters.join(" AND ")}
       GROUP BY dataset.id, dept.name, owner.nickname
       ORDER BY dataset.sort ASC, dataset.id DESC`,
    )
    .all(...params);
}

export async function getAiEvalOptions(userId: number) {
  const scope = await resolveDataScopeForUser(userId);
  const departmentFilter =
    scope.kind === "all"
      ? "1 = 1"
      : scope.deptIds.length
        ? `dept.id IN (${placeholders(scope.deptIds)})`
        : "1 = 0";
  const [agents, departments] = await Promise.all([
    sqlite
      .prepare(
        `SELECT agent.id, agent.name, agent.code FROM sys_ai_agent agent
         WHERE agent.deleted_at IS NULL AND agent.status = 1
         ORDER BY agent.sort ASC, agent.id ASC`,
      )
      .all(),
    sqlite
      .prepare(
        `SELECT dept.id, dept.name FROM sys_dept dept
         WHERE dept.deleted_at IS NULL AND dept.status = 1 AND ${departmentFilter}
         ORDER BY dept.sort ASC, dept.id ASC`,
      )
      .all(),
  ]);
  return { agents, departments };
}

export async function createAiEvalDataset(input: {
  payload: AiEvalDatasetInput;
  user: AdminUserContext;
}) {
  const scope = await resolveDataScopeForUser(input.user.id);
  const ownership = resolveOwnedScope(input.payload, input.user, scope);
  const result = await sqlite
    .prepare(
      `INSERT INTO sys_ai_eval_dataset
       (name, description, scope_type, dept_id, owner_id, status, sort, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      input.payload.name,
      input.payload.description ?? null,
      input.payload.scopeType,
      ownership.deptId,
      ownership.ownerId,
      input.payload.status ?? 1,
      input.payload.sort ?? 0,
      input.user.id,
      input.user.id,
    );
  return Number(result.lastInsertRowid);
}

export async function updateAiEvalDataset(input: {
  id: number;
  payload: AiEvalDatasetInput;
  user: AdminUserContext;
}) {
  if (!(await getVisibleAiEvalDataset(input.id, input.user.id))) {
    throw new HTTPException(404, { message: "Eval 数据集不存在或无权访问" });
  }
  const scope = await resolveDataScopeForUser(input.user.id);
  const ownership = resolveOwnedScope(input.payload, input.user, scope);
  await sqlite
    .prepare(
      `UPDATE sys_ai_eval_dataset SET name = ?, description = ?, scope_type = ?, dept_id = ?,
       owner_id = ?, status = ?, sort = ?, updated_by = ?, updated_at = now()
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      input.payload.name,
      input.payload.description ?? null,
      input.payload.scopeType,
      ownership.deptId,
      ownership.ownerId,
      input.payload.status ?? 1,
      input.payload.sort ?? 0,
      input.user.id,
      input.id,
    );
}

export async function deleteAiEvalDataset(id: number, userId: number) {
  if (!(await getVisibleAiEvalDataset(id, userId))) {
    throw new HTTPException(404, { message: "Eval 数据集不存在或无权访问" });
  }
  const activeRun = await sqlite
    .prepare(
      `SELECT id FROM sys_ai_eval_run
       WHERE dataset_id = ? AND status IN ('queued', 'running') LIMIT 1`,
    )
    .get(id);
  if (activeRun) throw new HTTPException(409, { message: "数据集正在执行，不能删除" });
  await sqlite
    .prepare(
      `UPDATE sys_ai_eval_dataset SET deleted_at = now(), deleted_by = ?, updated_at = now()
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(userId, id);
}

export async function listAiEvalCases(datasetId: number, userId: number) {
  if (!(await getVisibleAiEvalDataset(datasetId, userId))) {
    throw new HTTPException(404, { message: "Eval 数据集不存在或无权访问" });
  }
  const rows = (await sqlite
    .prepare(
      `SELECT eval_case.id, eval_case.dataset_id AS "datasetId", eval_case.name,
        eval_case.description, eval_case.agent_id AS "agentId", agent.name AS "agentName",
        eval_case.source_run_id AS "sourceRunId", eval_case.input_text AS "inputText",
        eval_case.expected_text AS "expectedText", eval_case.assertions_json AS "assertionsJson",
        eval_case.tags_json AS "tagsJson", eval_case.judge_enabled AS "judgeEnabled",
        eval_case.judge_rubric AS "judgeRubric",
        eval_case.groundedness_required AS "groundednessRequired", eval_case.status, eval_case.sort,
        eval_case.created_at AS "createdAt", eval_case.updated_at AS "updatedAt"
       FROM sys_ai_eval_case eval_case
       INNER JOIN sys_ai_agent agent ON agent.id = eval_case.agent_id
       WHERE eval_case.dataset_id = ? AND eval_case.deleted_at IS NULL
       ORDER BY eval_case.sort ASC, eval_case.id ASC`,
    )
    .all(datasetId)) as EvalCaseRow[];
  return rows.map((row) => ({
    ...row,
    assertions: parseJson<AiEvalAssertions>(row.assertionsJson, {}),
    tags: parseJson<string[]>(row.tagsJson, []),
  }));
}

export async function createAiEvalCase(input: {
  datasetId: number;
  payload: AiEvalCaseInput;
  userId: number;
  sourceRunId?: number | null;
}) {
  if (!(await getVisibleAiEvalDataset(input.datasetId, input.userId))) {
    throw new HTTPException(404, { message: "Eval 数据集不存在或无权访问" });
  }
  await assertAgent(input.payload.agentId);
  const result = await sqlite
    .prepare(
      `INSERT INTO sys_ai_eval_case
       (dataset_id, name, description, agent_id, source_run_id, input_text, expected_text,
        assertions_json, tags_json, judge_enabled, judge_rubric, groundedness_required,
        status, sort, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      input.datasetId,
      input.payload.name,
      input.payload.description ?? null,
      input.payload.agentId,
      input.sourceRunId ?? null,
      input.payload.inputText,
      input.payload.expectedText ?? null,
      JSON.stringify(normalizeAssertions(input.payload.assertions)),
      JSON.stringify(normalizeStringList(input.payload.tags)),
      input.payload.judgeEnabled ?? false,
      input.payload.judgeRubric?.trim() || null,
      input.payload.groundednessRequired ?? false,
      input.payload.status ?? 1,
      input.payload.sort ?? 0,
      input.userId,
      input.userId,
    );
  return Number(result.lastInsertRowid);
}

async function getVisibleEvalCase(id: number, userId: number) {
  const scope = await resolveDataScopeForUser(userId);
  const visibility = datasetVisibilityClause(scope);
  return (await sqlite
    .prepare(
      `SELECT eval_case.id, eval_case.dataset_id AS "datasetId"
       FROM sys_ai_eval_case eval_case
       INNER JOIN sys_ai_eval_dataset dataset ON dataset.id = eval_case.dataset_id
       WHERE eval_case.id = ? AND eval_case.deleted_at IS NULL
         AND dataset.deleted_at IS NULL AND ${visibility.sql}`,
    )
    .get(id, ...visibility.params)) as { id: number; datasetId: number } | undefined;
}

export async function updateAiEvalCase(input: {
  id: number;
  payload: AiEvalCaseInput;
  userId: number;
}) {
  if (!(await getVisibleEvalCase(input.id, input.userId))) {
    throw new HTTPException(404, { message: "Eval Case 不存在或无权访问" });
  }
  await assertAgent(input.payload.agentId);
  await sqlite
    .prepare(
      `UPDATE sys_ai_eval_case SET name = ?, description = ?, agent_id = ?, input_text = ?,
       expected_text = ?, assertions_json = ?, tags_json = ?, judge_enabled = ?,
       judge_rubric = ?, groundedness_required = ?, status = ?, sort = ?,
       updated_by = ?, updated_at = now() WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      input.payload.name,
      input.payload.description ?? null,
      input.payload.agentId,
      input.payload.inputText,
      input.payload.expectedText ?? null,
      JSON.stringify(normalizeAssertions(input.payload.assertions)),
      JSON.stringify(normalizeStringList(input.payload.tags)),
      input.payload.judgeEnabled ?? false,
      input.payload.judgeRubric?.trim() || null,
      input.payload.groundednessRequired ?? false,
      input.payload.status ?? 1,
      input.payload.sort ?? 0,
      input.userId,
      input.id,
    );
}

export async function deleteAiEvalCase(id: number, userId: number) {
  if (!(await getVisibleEvalCase(id, userId))) {
    throw new HTTPException(404, { message: "Eval Case 不存在或无权访问" });
  }
  await sqlite
    .prepare(
      `UPDATE sys_ai_eval_case SET deleted_at = now(), deleted_by = ?, updated_at = now()
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(userId, id);
}

export async function saveAiEvalCaseFromRun(input: {
  runId: number;
  datasetId: number;
  name?: string | null;
  userId: number;
}) {
  if (!(await getVisibleAiEvalDataset(input.datasetId, input.userId))) {
    throw new HTTPException(404, { message: "Eval 数据集不存在或无权访问" });
  }
  const run = (await sqlite
    .prepare(
      `SELECT run.id, run.agent_id AS "agentId", agent.name AS "agentName",
        input_message.content AS "inputText", output_message.content AS "actualOutput"
       FROM sys_ai_agent_run run
       INNER JOIN sys_ai_agent agent ON agent.id = run.agent_id
       LEFT JOIN sys_ai_chat_message input_message ON input_message.id = run.input_message_id
       LEFT JOIN sys_ai_chat_message output_message ON output_message.id = run.output_message_id
       WHERE run.id = ? AND run.user_id = ?`,
    )
    .get(input.runId, input.userId)) as
    | {
        id: number;
        agentId: number;
        agentName: string;
        inputText: string | null;
        actualOutput: string | null;
      }
    | undefined;
  if (!run?.inputText) throw new HTTPException(404, { message: "Agent Run 不存在或缺少输入" });
  const steps = (await sqlite
    .prepare(
      `SELECT DISTINCT tool_name AS "toolName" FROM sys_ai_agent_run_step
       WHERE run_id = ? AND step_type = 'tool' AND status = 'completed' AND tool_name IS NOT NULL`,
    )
    .all(run.id)) as Array<{ toolName: string }>;
  return createAiEvalCase({
    datasetId: input.datasetId,
    userId: input.userId,
    sourceRunId: run.id,
    payload: {
      name: input.name?.trim() || `Run #${run.id} · ${run.agentName}`,
      agentId: run.agentId,
      inputText: run.inputText,
      expectedText: run.actualOutput,
      assertions: { expectedTools: steps.map((step) => step.toolName) },
      tags: ["from-run"],
    },
  });
}

async function executeAgentCase(input: {
  evalCase: EvalCaseRow;
  userId: number;
  abilities: string[];
  requestId?: string;
}) {
  const agent = await assertAgent(input.evalCase.agentId);
  const sessionId = await createAiChatSession({
    userId: input.userId,
    title: `[Eval] ${input.evalCase.name}`,
    agentId: agent.id,
    modelId: agent.modelId,
    maxOutputTokens: agent.maxOutputTokens,
  });
  const inputMessageId = await appendAiChatMessage({
    sessionId,
    userId: input.userId,
    role: "user",
    content: input.evalCase.inputText,
  });
  const assistantMessageId = await appendAiChatMessage({
    sessionId,
    userId: input.userId,
    role: "assistant",
    content: "",
    status: "streaming",
    parentMessageId: inputMessageId,
  });
  let runtime: Awaited<ReturnType<typeof createAiAgentStream>> | null = null;
  let output = "";
  let usage: Record<string, unknown> = {};
  let approvalDenied = false;
  let finishReason = "stop";
  try {
    runtime = await createAiAgentStream({
      agentId: agent.id,
      sessionId,
      userId: input.userId,
      inputMessageId,
      messages: [
        { role: "system", content: agent.instructions },
        { role: "user", content: input.evalCase.inputText },
      ],
      modelId: agent.modelId,
      maxOutputTokens: agent.maxOutputTokens ?? undefined,
      temperature: agent.temperatureMilli / 1000,
      abortSignal: AbortSignal.timeout(10 * 60 * 1000),
      abilities: input.abilities,
      requestId: input.requestId,
    });
    for await (const part of runtime.stream.fullStream) {
      if (part.type === "text-delta") {
        output += part.text;
      } else if (part.type === "tool-approval-request") {
        approvalDenied = true;
        const toolRow = runtime.toolMap.get(part.toolCall.toolName);
        const stepId = await appendAgentRunStep({
          runId: runtime.runId,
          stepNo: runtime.nextStepNo(),
          stepType: "approval",
          status: "waiting_approval",
          toolId: toolRow?.id,
          toolName: part.toolCall.toolName,
          toolCallId: part.toolCall.toolCallId,
          input: part.toolCall.input,
        });
        const approvalId = await createToolApproval({
          runId: runtime.runId,
          stepId,
          sessionId,
          userId: input.userId,
          tool: toolRow,
          toolName: part.toolCall.toolName,
          toolCallId: part.toolCall.toolCallId,
          toolInput: part.toolCall.input,
        });
        await decideToolApproval({
          id: approvalId,
          userId: input.userId,
          approved: false,
          reason: "Eval v1 不在无人值守运行中批准工具",
        });
      } else if (part.type === "finish-step") {
        await appendAgentRunStep({
          runId: runtime.runId,
          stepNo: runtime.nextStepNo(),
          stepType: "model",
          status: "completed",
          usage: part.usage,
          durationMs: Math.round(part.performance.stepTimeMs),
        });
      } else if (part.type === "finish") {
        finishReason = part.finishReason;
        usage = runtime.runtime.normalizeUsage(part.totalUsage);
      } else if (part.type === "error") {
        throw part.error;
      }
    }
    const durationMs = runtime.runtime.resolveDurationMs();
    await updateAiChatMessage({
      id: assistantMessageId,
      sessionId,
      userId: input.userId,
      content: output,
      status: approvalDenied ? "stopped" : "completed",
      finishReason: approvalDenied ? "approval_required" : finishReason,
      usage,
      providerId: runtime.runtime.publicConfig.provider.id,
      modelId: runtime.runtime.publicConfig.model.id,
      durationMs,
    });
    await finishAgentRun({
      id: runtime.runId,
      status: approvalDenied ? "stopped" : "completed",
      outputMessageId: assistantMessageId,
      totalSteps: runtime.currentStepNo(),
      usage,
      durationMs,
      errorMessage: approvalDenied ? "Eval v1 不执行需要人工审批的工具" : null,
    });
    return { agentRunId: runtime.runId, output, approvalDenied };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const latestRun = (await getLatestSessionAgentRun({
      sessionId,
      userId: input.userId,
    })) as { id?: number } | null;
    const runId = runtime?.runId ?? Number(latestRun?.id ?? 0);
    await updateAiChatMessage({
      id: assistantMessageId,
      sessionId,
      userId: input.userId,
      content: output,
      status: "failed",
      finishReason: "error",
      errorMessage: message,
    });
    if (runId) {
      await finishAgentRun({
        id: runId,
        status: "failed",
        outputMessageId: assistantMessageId,
        errorMessage: message,
      });
    }
    throw Object.assign(error instanceof Error ? error : new Error(message), {
      agentRunId: runId || null,
    });
  } finally {
    await softDeleteAiChatSession({ id: sessionId, userId: input.userId });
  }
}

async function loadEvalMetrics(agentRunId: number) {
  const run = (await sqlite
    .prepare(
      `SELECT duration_ms AS "durationMs", input_tokens AS "inputTokens",
        output_tokens AS "outputTokens" FROM sys_ai_agent_run WHERE id = ?`,
    )
    .get(agentRunId)) as { durationMs: number | null; inputTokens: number; outputTokens: number };
  const invocations = (await sqlite
    .prepare(
      `SELECT id, resolved_model_id AS "modelId", duration_ms AS "durationMs",
        estimated_cost AS "estimatedCost", currency FROM sys_ai_invocation
       WHERE run_id = ? ORDER BY id ASC`,
    )
    .all(agentRunId)) as Array<{
    id: number;
    modelId: number | null;
    durationMs: number | null;
    estimatedCost: string | null;
    currency: string | null;
  }>;
  const toolRows = (await sqlite
    .prepare(
      `SELECT tool_name AS "toolName", status, output_json AS "outputJson" FROM sys_ai_agent_run_step
       WHERE run_id = ? AND step_type = 'tool' AND tool_name IS NOT NULL ORDER BY step_no ASC`,
    )
    .all(agentRunId)) as Array<{ toolName: string; status: string; outputJson: string | null }>;
  const approvalRows = (await sqlite
    .prepare("SELECT status FROM sys_ai_tool_approval WHERE run_id = ? ORDER BY id ASC")
    .all(agentRunId)) as Array<{ status: string }>;
  return {
    durationMs: Number(run?.durationMs ?? 0),
    inputTokens: Number(run?.inputTokens ?? 0),
    outputTokens: Number(run?.outputTokens ?? 0),
    estimatedCost: invocations.reduce(
      (sum, invocation) => sum + Number(invocation.estimatedCost ?? 0),
      0,
    ),
    currencies: [...new Set(invocations.map((item) => item.currency).filter(Boolean))],
    invocationIds: invocations.map((item) => item.id),
    modelIds: [...new Set(invocations.map((item) => item.modelId).filter(Boolean))],
    tools: [
      ...new Set(
        toolRows.filter((item) => item.status === "completed").map((item) => item.toolName),
      ),
    ],
    toolSteps: toolRows,
    knowledgeEvidence: toolRows
      .filter((item) => item.toolName === "knowledge-search" && item.status === "completed")
      .flatMap((item) => {
        const output = parseJson<{ results?: Array<{ documentName?: string; content?: string }> }>(
          item.outputJson,
          {},
        );
        return (output.results ?? []).slice(0, 12).map((evidence) => ({
          documentName: evidence.documentName ?? "Knowledge",
          content: String(evidence.content ?? "").slice(0, 2400),
        }));
      }),
    approvals: approvalRows.map((item) => item.status),
  };
}

const judgeResultSchema = z.object({
  passed: z.boolean(),
  score: z.number().int().min(0).max(100),
  reason: z.string().max(2000),
  groundednessScore: z.number().min(0).max(1).nullable(),
});

async function evaluateWithJudge(input: {
  evalCase: EvalCaseRow;
  output: string;
  metrics: Awaited<ReturnType<typeof loadEvalMetrics>>;
  evalRunId: number;
  userId: number;
  requestId?: string;
}) {
  if (!input.evalCase.judgeEnabled && !input.evalCase.groundednessRequired) return null;
  if (input.evalCase.groundednessRequired && !input.metrics.knowledgeEvidence.length) {
    return {
      passed: false,
      score: 0,
      reason: "要求 groundedness，但 Agent Run 没有可验证的 knowledge-search 证据。",
      groundednessScore: 0,
      invocationId: null,
    };
  }
  const evidence = input.metrics.knowledgeEvidence
    .map((item, index) => `[${index + 1}] ${item.documentName}\n${item.content}`)
    .join("\n\n");
  const generated = await generateAiStructured({
    purpose: "evalJudge",
    schema: judgeResultSchema,
    messages: [
      {
        role: "system",
        content:
          "你是受控 Eval Judge。根据输入、期望、评分标准和提供的证据评分。不得补充外部事实。groundednessScore 表示回答中的事实被证据支持的比例；没有 groundedness 要求时可返回 null。",
      },
      {
        role: "user",
        content: [
          `用例输入：${input.evalCase.inputText}`,
          `期望文本：${input.evalCase.expectedText ?? "未指定"}`,
          `评分标准：${input.evalCase.judgeRubric ?? "回答正确、相关、完整且不虚构"}`,
          `实际输出：${input.output}`,
          `检索证据：${evidence || "未提供"}`,
        ].join("\n\n"),
      },
    ],
    temperature: 0,
    trace: {
      sourceType: "eval_judge",
      sourceId: input.evalRunId,
      requestId: input.requestId,
      userId: input.userId,
    },
  });
  return { ...generated.object, invocationId: generated.invocationId };
}

function evaluateAssertions(input: {
  output: string;
  expectedText: string | null;
  assertions: AiEvalAssertions;
  metrics: Awaited<ReturnType<typeof loadEvalMetrics>>;
  approvalDenied: boolean;
}) {
  const outcomes: AssertionOutcome[] = [];
  const add = (outcome: AssertionOutcome) => outcomes.push(outcome);
  if (input.expectedText?.trim()) {
    add({
      key: "expectedText",
      label: "包含期望文本",
      passed: input.output.includes(input.expectedText.trim()),
      expected: input.expectedText.trim(),
      actual: input.output,
    });
  }
  for (const value of input.assertions.contains ?? []) {
    add({
      key: `contains:${value}`,
      label: "包含文本",
      passed: input.output.includes(value),
      expected: value,
      actual: input.output,
    });
  }
  for (const value of input.assertions.notContains ?? []) {
    add({
      key: `notContains:${value}`,
      label: "不包含文本",
      passed: !input.output.includes(value),
      expected: value,
      actual: input.output,
    });
  }
  for (const tool of input.assertions.expectedTools ?? []) {
    add({
      key: `expectedTool:${tool}`,
      label: "调用期望工具",
      passed: input.metrics.tools.includes(tool),
      expected: tool,
      actual: input.metrics.tools,
    });
  }
  for (const tool of input.assertions.forbiddenTools ?? []) {
    add({
      key: `forbiddenTool:${tool}`,
      label: "不调用禁止工具",
      passed: !input.metrics.tools.includes(tool),
      expected: tool,
      actual: input.metrics.tools,
    });
  }
  const thresholds: Array<[keyof AiEvalAssertions, string, number]> = [
    ["maxLatencyMs", "最大耗时", input.metrics.durationMs],
    ["maxInputTokens", "最大输入 Token", input.metrics.inputTokens],
    ["maxOutputTokens", "最大输出 Token", input.metrics.outputTokens],
    ["maxEstimatedCost", "最大估算费用", input.metrics.estimatedCost],
  ];
  for (const [key, label, actual] of thresholds) {
    const expected = input.assertions[key];
    if (typeof expected === "number") {
      add({ key, label, passed: actual <= expected, expected, actual });
    }
  }
  if (input.approvalDenied) {
    add({
      key: "unattendedApproval",
      label: "无需人工审批",
      passed: false,
      expected: "no approval",
      actual: input.metrics.approvals,
    });
  }
  return outcomes;
}

export async function executeAiEvalDataset(input: {
  datasetId: number;
  userId: number;
  abilities: string[];
  requestId?: string;
}) {
  const dataset = await getVisibleAiEvalDataset(input.datasetId, input.userId, true);
  if (!dataset) throw new HTTPException(404, { message: "Eval 数据集不存在、已停用或无权访问" });
  const cases = (await sqlite
    .prepare(
      `SELECT eval_case.id, eval_case.dataset_id AS "datasetId", eval_case.name,
        eval_case.description, eval_case.agent_id AS "agentId", agent.name AS "agentName",
        eval_case.source_run_id AS "sourceRunId", eval_case.input_text AS "inputText",
        eval_case.expected_text AS "expectedText", eval_case.assertions_json AS "assertionsJson",
        eval_case.tags_json AS "tagsJson", eval_case.judge_enabled AS "judgeEnabled",
        eval_case.judge_rubric AS "judgeRubric",
        eval_case.groundedness_required AS "groundednessRequired", eval_case.status, eval_case.sort
       FROM sys_ai_eval_case eval_case
       INNER JOIN sys_ai_agent agent ON agent.id = eval_case.agent_id
       WHERE eval_case.dataset_id = ? AND eval_case.deleted_at IS NULL AND eval_case.status = 1
       ORDER BY eval_case.sort ASC, eval_case.id ASC`,
    )
    .all(dataset.id)) as EvalCaseRow[];
  if (!cases.length) throw new HTTPException(409, { message: "数据集没有已启用的 Eval Case" });
  const startedAt = performance.now();
  const runResult = await sqlite
    .prepare(
      `INSERT INTO sys_ai_eval_run
       (dataset_id, user_id, status, total_cases, request_id, started_at)
       VALUES (?, ?, 'running', ?, ?, now()) RETURNING id`,
    )
    .run(dataset.id, input.userId, cases.length, input.requestId ?? null);
  const evalRunId = Number(runResult.lastInsertRowid);
  let passedCases = 0;
  let failedCases = 0;
  let errorCases = 0;
  try {
    for (const evalCase of cases) {
      const caseStartedAt = performance.now();
      let agentRunId: number | null = null;
      try {
        const execution = await executeAgentCase({
          evalCase,
          userId: input.userId,
          abilities: input.abilities,
          requestId: input.requestId,
        });
        agentRunId = execution.agentRunId;
        const metrics = await loadEvalMetrics(agentRunId);
        const outcomes = evaluateAssertions({
          output: execution.output,
          expectedText: evalCase.expectedText,
          assertions: normalizeAssertions(parseJson(evalCase.assertionsJson, {})),
          metrics,
          approvalDenied: execution.approvalDenied,
        });
        const judge = await evaluateWithJudge({
          evalCase,
          output: execution.output,
          metrics,
          evalRunId,
          userId: input.userId,
          requestId: input.requestId,
        });
        if (judge) {
          outcomes.push({
            key: "llmJudge",
            label: "LLM Judge 辅助评分",
            passed: judge.passed && judge.score >= 70,
            expected: ">= 70",
            actual: { score: judge.score, reason: judge.reason },
          });
          if (evalCase.groundednessRequired) {
            outcomes.push({
              key: "groundedness",
              label: "证据支持度",
              passed: Number(judge.groundednessScore ?? 0) >= 0.7,
              expected: ">= 0.7",
              actual: judge.groundednessScore,
            });
          }
        }
        const passed = outcomes.every((outcome) => outcome.passed);
        if (passed) passedCases += 1;
        else failedCases += 1;
        await sqlite
          .prepare(
            `INSERT INTO sys_ai_eval_result
             (eval_run_id, case_id, agent_run_id, status, actual_output, assertions_json,
              metrics_json, judge_score, judge_reason, groundedness_score,
              judge_invocation_id, duration_ms)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            evalRunId,
            evalCase.id,
            agentRunId,
            passed ? "passed" : "failed",
            execution.output,
            JSON.stringify(outcomes),
            JSON.stringify(metrics),
            judge?.score ?? null,
            judge?.reason ?? null,
            judge?.groundednessScore == null ? null : String(judge.groundednessScore),
            judge?.invocationId ?? null,
            Math.round(performance.now() - caseStartedAt),
          );
      } catch (error) {
        errorCases += 1;
        const errorWithRun = error as Error & { agentRunId?: number | null };
        agentRunId = errorWithRun.agentRunId ?? agentRunId;
        await sqlite
          .prepare(
            `INSERT INTO sys_ai_eval_result
             (eval_run_id, case_id, agent_run_id, status, actual_output, assertions_json,
              metrics_json, error_message, duration_ms)
             VALUES (?, ?, ?, 'error', NULL, '[]', '{}', ?, ?)`,
          )
          .run(
            evalRunId,
            evalCase.id,
            agentRunId,
            errorWithRun.message,
            Math.round(performance.now() - caseStartedAt),
          );
      }
    }
    await sqlite
      .prepare(
        `UPDATE sys_ai_eval_run SET status = 'completed', passed_cases = ?, failed_cases = ?,
         error_cases = ?, duration_ms = ?, finished_at = now() WHERE id = ?`,
      )
      .run(
        passedCases,
        failedCases,
        errorCases,
        Math.round(performance.now() - startedAt),
        evalRunId,
      );
  } catch (error) {
    await sqlite
      .prepare(
        `UPDATE sys_ai_eval_run SET status = 'failed', passed_cases = ?, failed_cases = ?,
         error_cases = ?, duration_ms = ?, error_message = ?, finished_at = now() WHERE id = ?`,
      )
      .run(
        passedCases,
        failedCases,
        errorCases,
        Math.round(performance.now() - startedAt),
        error instanceof Error ? error.message : String(error),
        evalRunId,
      );
    throw error;
  }
  return getAiEvalRun(evalRunId, input.userId);
}

export async function listAiEvalRuns(input: {
  userId: number;
  datasetId?: number;
  page?: number;
  pageSize?: number;
}) {
  const scope = await resolveDataScopeForUser(input.userId);
  const visibility = datasetVisibilityClause(scope);
  const page = Math.max(1, Math.round(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.round(input.pageSize ?? 20)));
  const filters = ["dataset.deleted_at IS NULL", visibility.sql];
  const params: number[] = [...visibility.params];
  if (input.datasetId) {
    filters.push("eval_run.dataset_id = ?");
    params.push(input.datasetId);
  }
  const count = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total FROM sys_ai_eval_run eval_run
       INNER JOIN sys_ai_eval_dataset dataset ON dataset.id = eval_run.dataset_id
       WHERE ${filters.join(" AND ")}`,
    )
    .get(...params)) as { total: number };
  const data = await sqlite
    .prepare(
      `SELECT eval_run.id, eval_run.dataset_id AS "datasetId", dataset.name AS "datasetName",
        eval_run.user_id AS "userId", user_row.nickname AS "userName", eval_run.status,
        eval_run.total_cases AS "totalCases", eval_run.passed_cases AS "passedCases",
        eval_run.failed_cases AS "failedCases", eval_run.error_cases AS "errorCases",
        eval_run.request_id AS "requestId", eval_run.duration_ms AS "durationMs",
        eval_run.error_message AS "errorMessage", eval_run.started_at AS "startedAt",
        eval_run.finished_at AS "finishedAt", eval_run.created_at AS "createdAt"
       FROM sys_ai_eval_run eval_run
       INNER JOIN sys_ai_eval_dataset dataset ON dataset.id = eval_run.dataset_id
       LEFT JOIN sys_user user_row ON user_row.id = eval_run.user_id
       WHERE ${filters.join(" AND ")}
       ORDER BY eval_run.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize);
  return { data, total: Number(count.total), page, pageSize };
}

export async function getAiEvalRun(id: number, userId: number) {
  const scope = await resolveDataScopeForUser(userId);
  const visibility = datasetVisibilityClause(scope);
  const run = await sqlite
    .prepare(
      `SELECT eval_run.id, eval_run.dataset_id AS "datasetId", dataset.name AS "datasetName",
        eval_run.user_id AS "userId", eval_run.status,
        eval_run.total_cases AS "totalCases", eval_run.passed_cases AS "passedCases",
        eval_run.failed_cases AS "failedCases", eval_run.error_cases AS "errorCases",
        eval_run.request_id AS "requestId", eval_run.duration_ms AS "durationMs",
        eval_run.error_message AS "errorMessage", eval_run.started_at AS "startedAt",
        eval_run.finished_at AS "finishedAt", eval_run.created_at AS "createdAt"
       FROM sys_ai_eval_run eval_run
       INNER JOIN sys_ai_eval_dataset dataset ON dataset.id = eval_run.dataset_id
       WHERE eval_run.id = ? AND dataset.deleted_at IS NULL AND ${visibility.sql}`,
    )
    .get(id, ...visibility.params);
  if (!run) throw new HTTPException(404, { message: "Eval Run 不存在或无权访问" });
  return run;
}

export async function listAiEvalResults(evalRunId: number, userId: number) {
  await getAiEvalRun(evalRunId, userId);
  const rows = (await sqlite
    .prepare(
      `SELECT result.id, result.eval_run_id AS "evalRunId", result.case_id AS "caseId",
        eval_case.name AS "caseName", eval_case.agent_id AS "agentId", agent.name AS "agentName",
        result.agent_run_id AS "agentRunId", result.status, result.actual_output AS "actualOutput",
        result.assertions_json AS "assertionsJson", result.metrics_json AS "metricsJson",
        result.judge_score AS "judgeScore", result.judge_reason AS "judgeReason",
        result.groundedness_score AS "groundednessScore",
        result.judge_invocation_id AS "judgeInvocationId",
        result.error_message AS "errorMessage", result.duration_ms AS "durationMs",
        result.created_at AS "createdAt"
       FROM sys_ai_eval_result result
       INNER JOIN sys_ai_eval_case eval_case ON eval_case.id = result.case_id
       INNER JOIN sys_ai_agent agent ON agent.id = eval_case.agent_id
       WHERE result.eval_run_id = ? ORDER BY result.id ASC`,
    )
    .all(evalRunId)) as Array<
    Record<string, unknown> & { assertionsJson: string; metricsJson: string }
  >;
  return rows.map((row) => ({
    ...row,
    assertions: parseJson(row.assertionsJson, []),
    metrics: parseJson(row.metricsJson, {}),
  }));
}

export async function getAiEvalResult(id: number, userId: number) {
  const result = (await sqlite
    .prepare(
      `SELECT result.id, result.eval_run_id AS "evalRunId", result.case_id AS "caseId",
        result.agent_run_id AS "agentRunId", result.status, result.actual_output AS "actualOutput",
        result.assertions_json AS "assertionsJson", result.metrics_json AS "metricsJson",
        result.judge_score AS "judgeScore", result.judge_reason AS "judgeReason",
        result.groundedness_score AS "groundednessScore",
        result.judge_invocation_id AS "judgeInvocationId",
        result.error_message AS "errorMessage", result.duration_ms AS "durationMs",
        eval_case.name AS "caseName", eval_case.input_text AS "inputText",
        eval_case.expected_text AS "expectedText"
       FROM sys_ai_eval_result result
       INNER JOIN sys_ai_eval_case eval_case ON eval_case.id = result.case_id
       WHERE result.id = ?`,
    )
    .get(id)) as
    | (Record<string, unknown> & {
        evalRunId: number;
        agentRunId: number | null;
        assertionsJson: string;
        metricsJson: string;
      })
    | undefined;
  if (!result) throw new HTTPException(404, { message: "Eval Result 不存在" });
  await getAiEvalRun(result.evalRunId, userId);
  const trace = result.agentRunId
    ? await getAiAgentRunTrace({ id: result.agentRunId, userId })
    : null;
  return {
    ...result,
    assertions: parseJson(result.assertionsJson, []),
    metrics: parseJson(result.metricsJson, {}),
    trace,
  };
}
