import { randomUUID } from "node:crypto";
import { sqlite, type DbClient } from "@/server/db";
import {
  isModuleAgentHandlerKey,
  moduleAgentRiskLevels,
  prepareModuleAgentApproval,
} from "./ai-module-agent-service";
import { executeRegisteredAiTool, isAiToolRuntimeAvailable } from "./ai-tool-registry";

export type AiAgentRow = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  instructions: string;
  modelId: number | null;
  modelName: string | null;
  modelIdentifier: string | null;
  temperatureMilli: number;
  maxOutputTokens: number | null;
  maxSteps: number;
  status: number;
  sort: number;
  isSystem: boolean;
  toolIds: number[];
  skillIds: number[];
  createdAt: string;
  updatedAt: string;
};

export type AiToolRow = {
  id: number;
  name: string;
  code: string;
  description: string;
  handlerKey: string;
  inputSchemaJson: string | null;
  configJson: string | null;
  riskLevel: "low" | "medium" | "high" | "critical";
  approvalRequired: boolean;
  approvalMode?: "inherit" | "always" | "never";
  status: number;
  sort: number;
  isSystem: boolean;
};

export class AiApprovalDecisionConflictError extends Error {
  readonly status = 409;

  constructor(message = "审批已经处理或正在执行，请刷新后查看最新状态") {
    super(message);
    this.name = "AiApprovalDecisionConflictError";
  }
}

export class AiAgentRunLeaseLostError extends Error {
  readonly status = 409;

  constructor(message = "AI Agent 运行租约已失效，旧执行不能继续写入") {
    super(message);
    this.name = "AiAgentRunLeaseLostError";
  }
}

export class AiToolExecutionConflictError extends Error {
  readonly status = 409;

  constructor(message = "该工具调用已经在执行或已完成，拒绝重复执行") {
    super(message);
    this.name = "AiToolExecutionConflictError";
  }
}

const DEFAULT_AGENT_RUN_LEASE_SECONDS = 120;

function createAgentRunLeaseOwner() {
  return `admin-base-agent-run-${randomUUID()}`;
}

export type ClientToolResultInput =
  | {
      status: "granted";
      latitude: number;
      longitude: number;
      accuracy?: number;
    }
  | {
      status: "denied" | "unavailable" | "error";
      reason?: string;
    };

function parseNumberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter(Number.isInteger);
}

export async function listAiAgents(input: { activeOnly?: boolean; dbClient?: DbClient } = {}) {
  const dbClient = input.dbClient ?? sqlite;
  const rows = (await dbClient
    .prepare(
      `SELECT a.id, a.name, a.code, a.description, a.instructions,
        a.model_id AS "modelId", m.name AS "modelName", m.model_id AS "modelIdentifier",
        a.temperature_milli AS "temperatureMilli", a.max_output_tokens AS "maxOutputTokens",
        a.max_steps AS "maxSteps", a.status, a.sort, a.is_system AS "isSystem",
        COALESCE((SELECT json_agg(at.tool_id ORDER BY at.tool_id) FROM sys_ai_agent_tool at WHERE at.agent_id = a.id), '[]') AS "toolIds",
        COALESCE((SELECT json_agg(agent_skill.skill_id ORDER BY agent_skill.skill_id) FROM sys_ai_agent_skill agent_skill WHERE agent_skill.agent_id = a.id), '[]') AS "skillIds",
        a.created_at AS "createdAt", a.updated_at AS "updatedAt"
       FROM sys_ai_agent a
       LEFT JOIN sys_ai_model m ON m.id = a.model_id
       WHERE a.deleted_at IS NULL ${input.activeOnly ? "AND a.status = 1" : ""}
       ORDER BY a.sort ASC, a.id ASC`,
    )
    .all()) as Array<Omit<AiAgentRow, "toolIds" | "skillIds"> & { toolIds: unknown; skillIds: unknown }>;
  return rows.map((row) => ({
    ...row,
    toolIds: parseNumberArray(row.toolIds),
    skillIds: parseNumberArray(row.skillIds),
  }));
}

export async function getAiAgent(id: number, dbClient: DbClient = sqlite) {
  return (await listAiAgents({ dbClient })).find((item) => item.id === id);
}

export async function listAiTools(
  input: { activeOnly?: boolean; agentId?: number; dbClient?: DbClient } = {},
) {
  const dbClient = input.dbClient ?? sqlite;
  const values: number[] = [];
  const joins = input.agentId
    ? "INNER JOIN sys_ai_agent_tool at ON at.tool_id = t.id AND at.agent_id = ?"
    : "LEFT JOIN sys_ai_agent_tool at ON false";
  if (input.agentId) values.push(input.agentId);
  const rows = (await dbClient
    .prepare(
      `SELECT t.id, t.name, t.code, t.description, t.handler_key AS "handlerKey",
        t.input_schema_json AS "inputSchemaJson", t.config_json AS "configJson",
        t.risk_level AS "riskLevel", t.approval_required AS "approvalRequired",
        COALESCE(at.approval_mode, 'inherit') AS "approvalMode",
        t.status, t.sort, t.is_system AS "isSystem"
       FROM sys_ai_tool t ${joins}
       WHERE t.deleted_at IS NULL ${input.activeOnly ? "AND t.status = 1" : ""}
       ORDER BY t.sort ASC, t.id ASC`,
    )
    .all(...values)) as AiToolRow[];
  if (!input.activeOnly || !input.agentId) return rows;
  const available = await Promise.all(
    rows.map(async (tool) => ({
      tool,
      available: await isAiToolRuntimeAvailable(tool.handlerKey, dbClient),
    })),
  );
  return available.filter((item) => item.available).map((item) => item.tool);
}

export async function saveAiAgent(input: {
  id?: number;
  name: string;
  code: string;
  description?: string | null;
  instructions: string;
  modelId?: number | null;
  temperatureMilli?: number;
  maxOutputTokens?: number | null;
  maxSteps?: number;
  status?: number;
  sort?: number;
  toolIds?: number[];
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  let id = input.id;
  if (id) {
    const existing = (await dbClient
      .prepare(
        'SELECT code, is_system AS "isSystem" FROM sys_ai_agent WHERE id = ? AND deleted_at IS NULL',
      )
      .get(id)) as { code: string; isSystem: boolean } | undefined;
    if (!existing) throw new Error("Agent 不存在");
    if (existing.isSystem && existing.code !== input.code)
      throw new Error("系统内置 Agent 不允许修改编码");
    await dbClient
      .prepare(
        `UPDATE sys_ai_agent SET name = ?, code = ?, description = ?, instructions = ?, model_id = ?,
          temperature_milli = ?, max_output_tokens = ?, max_steps = ?, status = ?, sort = ?,
          updated_by = ?, updated_at = now() WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        input.name,
        input.code,
        input.description ?? null,
        input.instructions,
        input.modelId ?? null,
        input.temperatureMilli ?? 700,
        input.maxOutputTokens ?? null,
        input.maxSteps ?? 6,
        input.status ?? 1,
        input.sort ?? 0,
        input.userId,
        id,
      );
  } else {
    const result = await dbClient
      .prepare(
        `INSERT INTO sys_ai_agent
          (name, code, description, instructions, model_id, temperature_milli, max_output_tokens,
           max_steps, status, sort, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .run(
        input.name,
        input.code,
        input.description ?? null,
        input.instructions,
        input.modelId ?? null,
        input.temperatureMilli ?? 700,
        input.maxOutputTokens ?? null,
        input.maxSteps ?? 6,
        input.status ?? 1,
        input.sort ?? 0,
        input.userId,
        input.userId,
      );
    id = Number(result.lastInsertRowid);
  }
  if (!id) throw new Error("Agent 保存失败");
  if (input.toolIds) {
    await dbClient.prepare("DELETE FROM sys_ai_agent_tool WHERE agent_id = ?").run(id);
    for (const toolId of input.toolIds) {
      await dbClient
        .prepare(
          "INSERT INTO sys_ai_agent_tool (agent_id, tool_id, approval_mode) VALUES (?, ?, 'inherit') ON CONFLICT DO NOTHING",
        )
        .run(id, toolId);
    }
  }
  return id;
}

export async function saveAiTool(input: {
  id?: number;
  name: string;
  code: string;
  description: string;
  handlerKey: string;
  inputSchemaJson?: string | null;
  configJson?: string | null;
  riskLevel?: AiToolRow["riskLevel"];
  approvalRequired?: boolean;
  status?: number;
  sort?: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  if (input.id) {
    const existing = (await dbClient
      .prepare(
        'SELECT code, handler_key AS "handlerKey", is_system AS "isSystem" FROM sys_ai_tool WHERE id = ? AND deleted_at IS NULL',
      )
      .get(input.id)) as { code: string; handlerKey: string; isSystem: boolean } | undefined;
    if (!existing) throw new Error("工具不存在");
    if (
      existing.isSystem &&
      (existing.code !== input.code || existing.handlerKey !== input.handlerKey)
    ) {
      throw new Error("系统内置工具不允许修改编码或处理器");
    }
    if (isModuleAgentHandlerKey(existing.handlerKey)) {
      const approvalRequired = ["module_publish", "module_rollback"].includes(existing.handlerKey);
      if (
        input.riskLevel !== moduleAgentRiskLevels[existing.handlerKey] ||
        Boolean(input.approvalRequired) !== approvalRequired
      ) {
        throw new Error("模块开发工具的风险等级和审批策略由系统固定");
      }
    }
    await dbClient
      .prepare(
        `UPDATE sys_ai_tool SET name = ?, code = ?, description = ?, handler_key = ?,
          input_schema_json = ?, config_json = ?, risk_level = ?, approval_required = ?,
          status = ?, sort = ?, updated_by = ?, updated_at = now()
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        input.name,
        input.code,
        input.description,
        input.handlerKey,
        input.inputSchemaJson ?? null,
        input.configJson ?? null,
        input.riskLevel ?? "low",
        input.approvalRequired ?? false,
        input.status ?? 1,
        input.sort ?? 0,
        input.userId,
        input.id,
      );
    return input.id;
  }
  const result = await dbClient
    .prepare(
      `INSERT INTO sys_ai_tool
        (name, code, description, handler_key, input_schema_json, config_json, risk_level,
         approval_required, status, sort, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      input.name,
      input.code,
      input.description,
      input.handlerKey,
      input.inputSchemaJson ?? null,
      input.configJson ?? null,
      input.riskLevel ?? "low",
      input.approvalRequired ?? false,
      input.status ?? 1,
      input.sort ?? 0,
      input.userId,
      input.userId,
    );
  return Number(result.lastInsertRowid);
}

export async function softDeleteAiResource(input: {
  type: "agent" | "tool";
  id: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const table = input.type === "agent" ? "sys_ai_agent" : "sys_ai_tool";
  const row = (await dbClient
    .prepare(`SELECT is_system AS "isSystem" FROM ${table} WHERE id = ? AND deleted_at IS NULL`)
    .get(input.id)) as { isSystem: boolean } | undefined;
  if (!row) throw new Error(input.type === "agent" ? "Agent 不存在" : "工具不存在");
  if (row.isSystem) throw new Error("系统内置资源不能删除");
  await dbClient
    .prepare(
      `UPDATE ${table} SET deleted_at = now(), deleted_by = ?, updated_at = now() WHERE id = ?`,
    )
    .run(input.userId, input.id);
}

export async function createAgentRunLease(input: {
  sessionId: number;
  agentId: number;
  userId: number;
  inputMessageId?: number | null;
  parentRunId?: number | null;
  sourceApprovalId?: number | null;
  leaseOwner?: string;
  leaseSeconds?: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const leaseOwner = input.leaseOwner ?? createAgentRunLeaseOwner();
  const leaseSeconds = Math.max(30, Math.min(input.leaseSeconds ?? DEFAULT_AGENT_RUN_LEASE_SECONDS, 15 * 60));
  if (input.sourceApprovalId) {
    const resumed = (await dbClient
      .prepare(
        `UPDATE sys_ai_agent_run
       SET status = 'running', output_message_id = NULL, total_steps = 0,
         input_tokens = 0, output_tokens = 0, duration_ms = NULL, error_message = NULL,
         attempt = attempt + 1, lease_owner = ?,
         lease_until = now() + (? * interval '1 second'), heartbeat_at = now(),
         started_at = now(), finished_at = NULL, updated_at = now()
       WHERE source_approval_id = ? AND session_id = ? AND user_id = ?
         AND status IN ('failed', 'stopped', 'waiting_continuation')
       RETURNING id, attempt, lease_owner AS "leaseOwner", lease_until AS "leaseUntil"`,
      )
      .get(
        leaseOwner,
        leaseSeconds,
        input.sourceApprovalId,
        input.sessionId,
        input.userId,
      )) as
      | { id: number; attempt: number; leaseOwner: string; leaseUntil: string }
      | undefined;
    if (resumed?.id) return resumed;
  }
  const created = (await dbClient
    .prepare(
      `INSERT INTO sys_ai_agent_run
      (session_id, agent_id, user_id, status, attempt, lease_owner, lease_until, heartbeat_at,
       input_message_id, parent_run_id, source_approval_id, started_at)
     VALUES (?, ?, ?, 'running', 1, ?, now() + (? * interval '1 second'), now(), ?, ?, ?, now())
     ON CONFLICT (source_approval_id) WHERE source_approval_id IS NOT NULL DO NOTHING
     RETURNING id, attempt, lease_owner AS "leaseOwner", lease_until AS "leaseUntil"`,
    )
    .get(
      input.sessionId,
      input.agentId,
      input.userId,
      leaseOwner,
      leaseSeconds,
      input.inputMessageId ?? null,
      input.parentRunId ?? null,
      input.sourceApprovalId ?? null,
    )) as
    | { id: number; attempt: number; leaseOwner: string; leaseUntil: string }
    | undefined;
  if (!created?.id && input.sourceApprovalId) {
    throw new AiApprovalDecisionConflictError("该审批已经创建续跑任务，请刷新后查看最新运行状态");
  }
  if (!created?.id) throw new Error("AI Agent Run 创建失败");
  return created;
}

export async function createAgentRun(input: {
  sessionId: number;
  agentId: number;
  userId: number;
  inputMessageId?: number | null;
  parentRunId?: number | null;
  sourceApprovalId?: number | null;
  dbClient?: DbClient;
}) {
  const run = await createAgentRunLease(input);
  return Number(run.id);
}

export async function heartbeatAgentRun(input: {
  id: number;
  leaseOwner: string;
  leaseSeconds?: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const leaseSeconds = Math.max(30, Math.min(input.leaseSeconds ?? DEFAULT_AGENT_RUN_LEASE_SECONDS, 15 * 60));
  const result = await dbClient
    .prepare(
      `UPDATE sys_ai_agent_run
       SET lease_until = now() + (? * interval '1 second'), heartbeat_at = now(), updated_at = now()
       WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_until > now()
       RETURNING id`,
    )
    .run(leaseSeconds, input.id, input.leaseOwner);
  if (!result.changes) throw new AiAgentRunLeaseLostError();
}

export async function assertAgentRunLease(input: {
  id: number;
  leaseOwner: string;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const row = await dbClient
    .prepare(
      `SELECT id FROM sys_ai_agent_run
       WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_until > now()`,
    )
    .get(input.id, input.leaseOwner);
  if (!row) throw new AiAgentRunLeaseLostError();
}

export async function getAgentRunLease(input: {
  id: number;
  sessionId: number;
  agentId: number;
  userId: number;
  attempt: number;
  leaseOwner: string;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const row = (await dbClient
    .prepare(
      `SELECT id, session_id AS "sessionId", agent_id AS "agentId", user_id AS "userId",
         attempt, input_message_id AS "inputMessageId", output_message_id AS "outputMessageId",
         lease_owner AS "leaseOwner", lease_until AS "leaseUntil"
       FROM sys_ai_agent_run
       WHERE id = ? AND session_id = ? AND agent_id = ? AND user_id = ?
         AND attempt = ? AND lease_owner = ? AND status = 'running' AND lease_until > now()`,
    )
    .get(
      input.id,
      input.sessionId,
      input.agentId,
      input.userId,
      input.attempt,
      input.leaseOwner,
    )) as
    | {
        id: number;
        sessionId: number;
        agentId: number;
        userId: number;
        attempt: number;
        inputMessageId: number | null;
        outputMessageId: number | null;
        leaseOwner: string;
        leaseUntil: string;
      }
    | undefined;
  if (!row) throw new AiAgentRunLeaseLostError();
  return row;
}

export async function claimAgentRunLease(input: {
  workerId: string;
  leaseSeconds?: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const leaseSeconds = Math.max(
    30,
    Math.min(input.leaseSeconds ?? DEFAULT_AGENT_RUN_LEASE_SECONDS, 15 * 60),
  );
  const rows = await dbClient
    .prepare(
      `WITH candidate AS (
         SELECT id, status
         FROM sys_ai_agent_run
         WHERE status = 'queued'
            OR (status = 'running' AND lease_until IS NOT NULL AND lease_until <= now()
                AND NOT EXISTS (
                  SELECT 1 FROM sys_ai_tool_approval approval
                  WHERE approval.run_id = sys_ai_agent_run.id
                    AND approval.status IN ('pending', 'executing')
                ))
         ORDER BY id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE sys_ai_agent_run AS run
       SET status = 'running',
           attempt = CASE WHEN candidate.status = 'running' THEN run.attempt + 1 ELSE run.attempt END,
           lease_owner = ?,
           lease_until = now() + (? * interval '1 second'),
           heartbeat_at = now(),
           started_at = COALESCE(run.started_at, now()),
           finished_at = NULL,
           updated_at = now()
       FROM candidate
       WHERE run.id = candidate.id
       RETURNING run.id, run.session_id AS "sessionId", run.agent_id AS "agentId",
         run.user_id AS "userId", run.attempt, run.input_message_id AS "inputMessageId",
         run.output_message_id AS "outputMessageId", run.lease_owner AS "leaseOwner",
         run.lease_until AS "leaseUntil"`,
    )
    .all(input.workerId, leaseSeconds);
  const result = rows[0] as {
    id?: number;
    sessionId?: number;
    agentId?: number;
    userId?: number;
    attempt?: number;
    inputMessageId?: number | null;
    outputMessageId?: number | null;
    leaseOwner?: string;
    leaseUntil?: string;
  } | undefined;
  if (!result?.id) return null;
  return result as {
    id: number;
    sessionId: number;
    agentId: number;
    userId: number;
    attempt: number;
    inputMessageId: number | null;
    outputMessageId: number | null;
    leaseOwner: string;
    leaseUntil: string;
  };
}

export async function claimAgentRunLeaseForRun(input: {
  runId: number;
  workerId: string;
  leaseSeconds?: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const leaseSeconds = Math.max(
    30,
    Math.min(input.leaseSeconds ?? DEFAULT_AGENT_RUN_LEASE_SECONDS, 15 * 60),
  );
  return (await dbClient
    .prepare(
      `UPDATE sys_ai_agent_run
       SET status = 'running', attempt = attempt + 1, lease_owner = ?,
         lease_until = now() + (? * interval '1 second'), heartbeat_at = now(),
         started_at = COALESCE(started_at, now()), finished_at = NULL, updated_at = now()
       WHERE id = ? AND (
         status IN ('waiting_continuation', 'waiting_approval')
         OR (status = 'running' AND EXISTS (
           SELECT 1 FROM sys_ai_tool_approval approval
           WHERE approval.run_id = sys_ai_agent_run.id
             AND approval.status IN ('pending', 'executing')
         ))
       )
       RETURNING id, session_id AS "sessionId", agent_id AS "agentId", user_id AS "userId",
         attempt, input_message_id AS "inputMessageId", output_message_id AS "outputMessageId",
         lease_owner AS "leaseOwner", lease_until AS "leaseUntil"`,
    )
    .get(input.workerId, leaseSeconds, input.runId)) as
    | {
        id: number;
        sessionId: number;
        agentId: number;
        userId: number;
        attempt: number;
        inputMessageId: number | null;
        outputMessageId: number | null;
        leaseOwner: string;
        leaseUntil: string;
      }
    | undefined;
}

export async function finishAgentRun(input: {
  id: number;
  status: string;
  outputMessageId?: number | null;
  totalSteps?: number;
  usage?: Record<string, unknown>;
  durationMs?: number;
  errorMessage?: string | null;
  leaseOwner?: string;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const leaseCondition = input.leaseOwner
    ? "AND lease_owner = ? AND lease_until > now() AND status IN ('running', 'waiting_approval', 'waiting_continuation')"
    : "";
  const params = [
    input.status,
    input.outputMessageId ?? null,
    input.totalSteps ?? null,
    Number(input.usage?.inputTokens ?? input.usage?.promptTokens ?? 0),
    Number(input.usage?.outputTokens ?? input.usage?.completionTokens ?? 0),
    input.durationMs ?? null,
    input.errorMessage ?? null,
    input.status,
    input.id,
    ...(input.leaseOwner ? [input.leaseOwner] : []),
  ] as const;
  await dbClient
    .prepare(
      `UPDATE sys_ai_agent_run SET status = ?, output_message_id = COALESCE(?, output_message_id),
      total_steps = COALESCE(?, total_steps), input_tokens = ?, output_tokens = ?, duration_ms = ?,
      error_message = ?, finished_at = CASE WHEN ? = 'waiting_approval' THEN NULL ELSE now() END,
      lease_owner = NULL, lease_until = NULL, heartbeat_at = now(),
      updated_at = now() WHERE id = ? ${leaseCondition}`,
    )
    .run(...params);
}

export async function appendAgentRunStep(input: {
  runId: number;
  stepNo: number;
  stepType: "model" | "tool" | "approval";
  status: string;
  toolId?: number | null;
  toolName?: string | null;
  toolCallId?: string | null;
  input?: unknown;
  output?: unknown;
  usage?: unknown;
  durationMs?: number | null;
  errorMessage?: string | null;
  leaseOwner?: string;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const leaseOwner = input.leaseOwner;
  if (leaseOwner) await assertAgentRunLease({ id: input.runId, leaseOwner, dbClient });
  const insert = leaseOwner
    ? `INSERT INTO sys_ai_agent_run_step
      (run_id, step_no, step_type, status, tool_id, tool_name, tool_call_id, input_json,
       output_json, usage_json, duration_ms, error_message, finished_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       CASE WHEN ? = 'waiting_approval' THEN NULL ELSE now() END
     FROM sys_ai_agent_run
     WHERE id = ? AND status = 'running' AND lease_owner = ? AND lease_until > now()
     RETURNING id`
    : `INSERT INTO sys_ai_agent_run_step
      (run_id, step_no, step_type, status, tool_id, tool_name, tool_call_id, input_json,
       output_json, usage_json, duration_ms, error_message, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'waiting_approval' THEN NULL ELSE now() END)
     RETURNING id`;
  const params = [
    input.runId,
    input.stepNo,
    input.stepType,
    input.status,
    input.toolId ?? null,
    input.toolName ?? null,
    input.toolCallId ?? null,
    input.input == null ? null : JSON.stringify(input.input),
    input.output == null ? null : JSON.stringify(input.output),
    input.usage == null ? null : JSON.stringify(input.usage),
    input.durationMs ?? null,
    input.errorMessage ?? null,
    input.status,
    ...(leaseOwner ? [input.runId, leaseOwner] : []),
  ] as const;
  const result = await dbClient
    .prepare(insert)
    .run(...params);
  if (!result.lastInsertRowid && leaseOwner) throw new AiAgentRunLeaseLostError();
  return Number(result.lastInsertRowid);
}

export async function appendAgentRunEvent(input: {
  runId: number;
  eventType: string;
  payload: unknown;
  leaseOwner: string;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const result = (await dbClient
    .prepare(
      `WITH active_run AS (
         SELECT id, attempt FROM sys_ai_agent_run
         WHERE id = ? AND status IN ('running', 'waiting_approval', 'waiting_continuation')
           AND lease_owner = ? AND lease_until > now()
       )
       INSERT INTO sys_ai_agent_run_event
         (run_id, attempt, sequence, event_type, payload_json, created_at)
       SELECT active_run.id, active_run.attempt,
         COALESCE((
           SELECT MAX(previous.sequence) FROM sys_ai_agent_run_event previous
           WHERE previous.run_id = active_run.id AND previous.attempt = active_run.attempt
         ), 0) + 1,
         ?, ?, now()
       FROM active_run
       RETURNING id, run_id AS "runId", attempt, sequence, event_type AS "eventType",
         payload_json AS "payloadJson", created_at AS "createdAt"`,
    )
    .get(input.runId, input.leaseOwner, input.eventType, JSON.stringify(input.payload))) as
    | {
        id: number;
        runId: number;
        attempt: number;
        sequence: number;
        eventType: string;
        payloadJson: string;
        createdAt: string;
      }
    | undefined;
  if (!result) throw new AiAgentRunLeaseLostError();
  return { ...result, payload: JSON.parse(result.payloadJson) as unknown };
}

export async function listAiAgentRunEvents(input: {
  runId: number;
  userId: number;
  afterEventId?: number;
  limit?: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const limit = Math.min(Math.max(input.limit ?? 1000, 1), 5000);
  const rows = (await dbClient
    .prepare(
      `SELECT event.id, event.run_id AS "runId", event.attempt, event.sequence,
        event.event_type AS "eventType", event.payload_json AS "payloadJson",
        event.created_at AS "createdAt"
       FROM sys_ai_agent_run_event event
       INNER JOIN sys_ai_agent_run run ON run.id = event.run_id
       WHERE event.run_id = ? AND run.user_id = ? AND event.id > ?
       ORDER BY event.id ASC LIMIT ?`,
    )
    .all(input.runId, input.userId, Math.max(input.afterEventId ?? 0, 0), limit)) as Array<{
    id: number;
    runId: number;
    attempt: number;
    sequence: number;
    eventType: string;
    payloadJson: string;
    createdAt: string;
  }>;
  return rows.map((row) => ({ ...row, payload: JSON.parse(row.payloadJson) as unknown }));
}

export async function createToolApproval(input: {
  runId: number;
  stepId: number;
  sessionId: number;
  userId: number;
  tool?: AiToolRow;
  toolName: string;
  toolCallId: string;
  toolInput: unknown;
  leaseOwner?: string;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  if (input.leaseOwner) {
    await assertAgentRunLease({ id: input.runId, leaseOwner: input.leaseOwner, dbClient });
  }
  const toolInput = (input.toolInput ?? {}) as Record<string, unknown>;
  const moduleApproval =
    input.tool && isModuleAgentHandlerKey(input.tool.handlerKey)
      ? await prepareModuleAgentApproval(input.tool, toolInput, {
          userId: input.userId,
          dbClient,
        })
      : null;
  const expiresAt =
    moduleApproval?.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const result = await dbClient
    .prepare(
      `INSERT INTO sys_ai_tool_approval
      (run_id, step_id, session_id, user_id, tool_id, tool_name, tool_call_id, input_json,
       plan_hash, affected_files_json, validation_json, expires_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    )
    .run(
      input.runId,
      input.stepId,
      input.sessionId,
      input.userId,
      input.tool?.id ?? null,
      input.toolName,
      input.toolCallId,
      JSON.stringify(toolInput),
      moduleApproval?.planHash ?? null,
      moduleApproval ? JSON.stringify(moduleApproval.affectedFiles) : null,
      moduleApproval?.validation ? JSON.stringify(moduleApproval.validation) : null,
      expiresAt,
    );
  if (result.lastInsertRowid) return Number(result.lastInsertRowid);
  const existing = (await dbClient
    .prepare("SELECT id FROM sys_ai_tool_approval WHERE run_id = ? AND tool_call_id = ?")
    .get(input.runId, input.toolCallId)) as { id?: number } | undefined;
  if (!existing?.id) throw new Error("工具审批调用标识冲突，请完成数据库迁移后重试");
  return Number(existing.id);
}

export async function listSessionApprovals(input: {
  sessionId: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  return dbClient
    .prepare(
      `SELECT a.id, a.run_id AS "runId", a.step_id AS "stepId", a.tool_id AS "toolId",
      a.tool_name AS "toolName", COALESCE(t.name, a.tool_name) AS "toolDisplayName",
      t.description AS "toolDescription", t.handler_key AS "handlerKey",
      COALESCE(t.risk_level, 'medium') AS "riskLevel",
      a.tool_call_id AS "toolCallId", a.input_json AS "inputJson", a.output_json AS "outputJson",
      a.plan_hash AS "planHash", a.affected_files_json AS "affectedFilesJson",
      a.validation_json AS "validationJson", a.expires_at AS "expiresAt",
      a.status, a.reason, a.decided_by AS "decidedBy", a.decided_at AS "decidedAt",
      a.executed_at AS "executedAt", a.created_at AS "createdAt",
      continuation.id AS "continuationRunId", continuation.status AS "continuationRunStatus"
     FROM sys_ai_tool_approval a
     LEFT JOIN sys_ai_tool t ON t.id = a.tool_id
     LEFT JOIN sys_ai_agent_run continuation ON continuation.source_approval_id = a.id
     WHERE a.session_id = ? AND a.user_id = ? ORDER BY a.id DESC`,
    )
    .all(input.sessionId, input.userId);
}

export async function getApprovalContinuationContext(input: {
  id: number;
  sessionId: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const row = (await dbClient
    .prepare(
      `SELECT a.id, a.run_id AS "parentRunId", a.status, r.agent_id AS "agentId",
      continuation.id AS "continuationRunId", continuation.status AS "continuationRunStatus"
     FROM sys_ai_tool_approval a
     INNER JOIN sys_ai_agent_run r ON r.id = a.run_id
     LEFT JOIN sys_ai_agent_run continuation ON continuation.source_approval_id = a.id
     WHERE a.id = ? AND a.session_id = ? AND a.user_id = ? AND r.user_id = ?`,
    )
    .get(input.id, input.sessionId, input.userId, input.userId)) as
    | {
        id: number;
        parentRunId: number;
        status: string;
        agentId: number;
        continuationRunId: number | null;
        continuationRunStatus: string | null;
      }
    | undefined;
  if (!row) throw new Error("审批记录不存在或不属于当前会话");
  if (row.status !== "executed") {
    throw new AiApprovalDecisionConflictError("工具审批尚未执行成功，不能继续 Agent");
  }
  if (
    row.continuationRunId &&
    row.continuationRunStatus !== "failed" &&
    row.continuationRunStatus !== "stopped"
  ) {
    throw new AiApprovalDecisionConflictError("该审批已经创建续跑任务，请刷新后查看最新运行状态");
  }
  return row;
}

export async function getLatestSessionAgentRun(input: {
  sessionId: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const run = (await dbClient
    .prepare(
      `SELECT r.id, r.session_id AS "sessionId", r.agent_id AS "agentId", a.name AS "agentName",
      a.code AS "agentCode", COALESCE(s.model_name, m.name) AS "modelName",
      COALESCE(s.model_identifier, m.model_id) AS "modelIdentifier",
      r.status, r.attempt, r.lease_until AS "leaseUntil", r.heartbeat_at AS "heartbeatAt",
      r.total_steps AS "totalSteps", r.input_tokens AS "inputTokens",
      r.output_tokens AS "outputTokens", r.duration_ms AS "durationMs",
      r.error_message AS "errorMessage", r.parent_run_id AS "parentRunId",
      r.source_approval_id AS "sourceApprovalId",
      r.started_at AS "startedAt", r.finished_at AS "finishedAt"
     FROM sys_ai_agent_run r
     INNER JOIN sys_ai_agent a ON a.id = r.agent_id
     INNER JOIN sys_ai_chat_session s ON s.id = r.session_id
     LEFT JOIN sys_ai_model m ON m.id = COALESCE(s.model_id, a.model_id)
     WHERE r.session_id = ? AND r.user_id = ? AND s.user_id = ? AND s.deleted_at IS NULL
     ORDER BY r.id DESC LIMIT 1`,
    )
    .get(input.sessionId, input.userId, input.userId)) as Record<string, unknown> | undefined;
  if (!run) return null;
  const steps = await dbClient
    .prepare(
      `SELECT id, step_no AS "stepNo", step_type AS "stepType", status,
      tool_name AS "toolName", tool_call_id AS "toolCallId", input_json AS "inputJson",
      output_json AS "outputJson", usage_json AS "usageJson", duration_ms AS "durationMs",
      error_message AS "errorMessage", started_at AS "startedAt", finished_at AS "finishedAt"
     FROM sys_ai_agent_run_step WHERE run_id = ? ORDER BY step_no ASC, id ASC`,
    )
    .all(Number(run.id));
  const events = await listAiAgentRunEvents({
    runId: Number(run.id),
    userId: input.userId,
    dbClient,
  });
  return { ...run, steps, events };
}

export async function getAiAgentRunTrace(input: {
  id: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const run = (await dbClient
    .prepare(
      `SELECT r.id, r.session_id AS "sessionId", r.agent_id AS "agentId", a.name AS "agentName",
        a.code AS "agentCode", r.status, r.attempt,
        r.lease_until AS "leaseUntil", r.heartbeat_at AS "heartbeatAt",
        r.total_steps AS "totalSteps",
        r.input_tokens AS "inputTokens", r.output_tokens AS "outputTokens",
        r.duration_ms AS "durationMs", r.error_message AS "errorMessage",
        r.parent_run_id AS "parentRunId", r.source_approval_id AS "sourceApprovalId",
        r.started_at AS "startedAt", r.finished_at AS "finishedAt"
       FROM sys_ai_agent_run r INNER JOIN sys_ai_agent a ON a.id = r.agent_id
       WHERE r.id = ? AND r.user_id = ?`,
    )
    .get(input.id, input.userId)) as Record<string, unknown> | undefined;
  if (!run) return null;
  const steps = await dbClient
    .prepare(
      `SELECT id, step_no AS "stepNo", step_type AS "stepType", status,
        tool_name AS "toolName", tool_call_id AS "toolCallId", input_json AS "inputJson",
        output_json AS "outputJson", usage_json AS "usageJson", duration_ms AS "durationMs",
        error_message AS "errorMessage", started_at AS "startedAt", finished_at AS "finishedAt"
       FROM sys_ai_agent_run_step WHERE run_id = ? ORDER BY step_no ASC, id ASC`,
    )
    .all(input.id);
  const invocations = (await dbClient
    .prepare(
      `SELECT i.id, i.purpose, i.source_type AS "sourceType", i.status,
        i.attempt_count AS "attemptCount", i.fallback_used AS "fallbackUsed",
        i.input_tokens AS "inputTokens", i.output_tokens AS "outputTokens",
        i.estimated_cost AS "estimatedCost", i.currency, i.duration_ms AS "durationMs",
        i.error_type AS "errorType", i.error_message AS "errorMessage",
        i.started_at AS "startedAt", i.finished_at AS "finishedAt"
       FROM sys_ai_invocation i WHERE i.run_id = ? ORDER BY i.id ASC`,
    )
    .all(input.id)) as Array<Record<string, unknown> & { id: number }>;
  const invocationIds = invocations.map((item) => Number((item as { id: number }).id));
  const attempts: Array<Record<string, unknown> & { invocationId: number }> = invocationIds.length
    ? ((await dbClient
        .prepare(
          `SELECT invocation_id AS "invocationId", attempt_no AS "attemptNo", status,
            provider_name AS "providerName", provider_code AS "providerCode",
            model_name AS "modelName", model_identifier AS "modelIdentifier",
            input_tokens AS "inputTokens", output_tokens AS "outputTokens",
            estimated_cost AS "estimatedCost", currency, latency_ms AS "latencyMs",
            first_token_ms AS "firstTokenMs", error_type AS "errorType",
            error_message AS "errorMessage", started_at AS "startedAt", finished_at AS "finishedAt"
           FROM sys_ai_invocation_attempt
           WHERE invocation_id IN (${invocationIds.map(() => "?").join(", ")})
           ORDER BY invocation_id ASC, attempt_no ASC`,
        )
        .all(...invocationIds)) as Array<Record<string, unknown> & { invocationId: number }>)
    : [];
  const events = await listAiAgentRunEvents({
    runId: input.id,
    userId: input.userId,
    dbClient,
  });
  return {
    ...run,
    steps,
    events,
    invocations: invocations.map((invocation) => ({
      ...invocation,
      attempts: attempts.filter(
        (attempt) =>
          Number((attempt as { invocationId: number }).invocationId) ===
          Number((invocation as { id: number }).id),
      ),
    })),
  };
}

async function refreshApprovalSession(input: {
  sessionId: number;
  userId: number;
  dbClient: DbClient;
}) {
  await input.dbClient
    .prepare(
      `UPDATE sys_ai_chat_session SET
      message_count = (
        SELECT COUNT(1)::int FROM sys_ai_chat_message
        WHERE session_id = ? AND status <> 'superseded'
      ),
      last_message_at = now(), updated_by = ?, updated_at = now()
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .run(input.sessionId, input.userId, input.sessionId, input.userId);
}

async function userHasAbility(userId: number | undefined, ability: string, dbClient: DbClient) {
  if (userId === 1) return true;
  if (!userId) return false;
  const row = await dbClient
    .prepare(
      `SELECT 1
       FROM sys_user_role ur
       INNER JOIN sys_role r ON r.id = ur.role_id
       INNER JOIN sys_role_rule rr ON rr.role_id = r.id
       INNER JOIN sys_rule rule ON rule.id = rr.rule_id
       WHERE ur.user_id = ?
         AND r.status = 1
         AND r.deleted_at IS NULL
         AND rule.key = ?
         AND rule.status = 1
         AND rule.deleted_at IS NULL
       LIMIT 1`,
    )
    .get(userId, ability);
  return Boolean(row);
}

export async function executeAgentTool(
  tool: AiToolRow,
  input: Record<string, unknown>,
  options: {
    dbClient?: DbClient;
    userId?: number;
    requestId?: string;
    runId?: number;
    leaseOwner?: string;
    toolCallId?: string;
    approvedExecution?: boolean;
    approvedModuleMutation?: boolean;
  } = {},
) {
  const dbClient = options.dbClient ?? sqlite;
  if (options.runId && options.leaseOwner) {
    await assertAgentRunLease({ id: options.runId, leaseOwner: options.leaseOwner, dbClient });
  }
  const toolCallId = options.toolCallId?.trim();
  const shouldRecordExecution = Boolean(options.runId && toolCallId);
  if (shouldRecordExecution && !options.leaseOwner && !options.approvedExecution) {
    throw new AiAgentRunLeaseLostError("工具调用缺少有效运行租约，不能执行外部副作用");
  }

  let executionId: number | null = null;
  let attempt: number | null = null;
  if (shouldRecordExecution) {
    const executionToolCallId = toolCallId as string;
    const run = (await dbClient
      .prepare(
        `SELECT attempt, status FROM sys_ai_agent_run WHERE id = ?`,
      )
      .get(options.runId as number)) as { attempt: number; status: string } | undefined;
    if (!run) throw new Error("AI Agent Run 不存在");
    attempt = Number(run.attempt);
    const claimed = await dbClient
      .prepare(
        `INSERT INTO sys_ai_tool_execution
         (run_id, attempt, tool_id, tool_name, tool_call_id, input_json, status)
         VALUES (?, ?, ?, ?, ?, ?, 'running')
         ON CONFLICT (run_id, attempt, tool_call_id) DO NOTHING
         RETURNING id`,
      )
      .run(
        options.runId as number,
        attempt,
        tool.id,
        tool.code,
        executionToolCallId,
        JSON.stringify(input),
      );
    if (claimed.lastInsertRowid) {
      executionId = Number(claimed.lastInsertRowid);
    } else {
      const previousAttempt = (await dbClient
        .prepare(
          `SELECT status, output_json AS "outputJson", error_message AS "errorMessage"
           FROM sys_ai_tool_execution
           WHERE run_id = ? AND tool_call_id = ?
           ORDER BY attempt DESC LIMIT 1`,
        )
        .get(options.runId as number, executionToolCallId)) as
        | { status: string; outputJson: string | null; errorMessage: string | null }
        | undefined;
      if (previousAttempt?.status === "completed") {
        return previousAttempt.outputJson ? JSON.parse(previousAttempt.outputJson) : null;
      }
      const previous = (await dbClient
        .prepare(
          `SELECT status, output_json AS "outputJson", error_message AS "errorMessage"
           FROM sys_ai_tool_execution
           WHERE run_id = ? AND attempt = ? AND tool_call_id = ?`,
        )
        .get(options.runId as number, attempt, executionToolCallId)) as
        | { status: string; outputJson: string | null; errorMessage: string | null }
        | undefined;
      if (previous?.status === "completed") {
        return previous.outputJson ? JSON.parse(previous.outputJson) : null;
      }
      throw new AiToolExecutionConflictError(
        previous?.status === "failed"
          ? previous.errorMessage || "该工具调用已失败，不能使用相同调用标识重试"
          : undefined,
      );
    }
  }

  try {
    if (options.runId && options.leaseOwner) {
      // The first check fences the database claim; this second check is deliberately
      // adjacent to the side effect so an expired attempt cannot continue after takeover.
      await assertAgentRunLease({ id: options.runId, leaseOwner: options.leaseOwner, dbClient });
    }
    const output = await executeRegisteredAiTool(tool, input, {
      dbClient,
      userId: options.userId,
      requestId: options.requestId,
      approvedModuleMutation: options.approvedModuleMutation,
      hasAbility: (ability) => userHasAbility(options.userId, ability, dbClient),
    });
    if (executionId) {
      await dbClient
        .prepare(
          `UPDATE sys_ai_tool_execution
           SET status = 'completed', output_json = ?, error_message = NULL,
             finished_at = now(), updated_at = now()
           WHERE id = ? AND status = 'running'`,
        )
        .run(JSON.stringify(output), executionId);
    }
    return output;
  } catch (error) {
    if (executionId) {
      await dbClient
        .prepare(
          `UPDATE sys_ai_tool_execution
           SET status = 'failed', error_message = ?, finished_at = now(), updated_at = now()
           WHERE id = ? AND status = 'running'`,
        )
        .run(error instanceof Error ? error.message : String(error), executionId);
    }
    throw error;
  }
}

export async function decideToolApproval(input: {
  id: number;
  userId: number;
  approved: boolean;
  reason?: string | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient
    .prepare(
      `UPDATE sys_ai_tool_approval
     SET status = 'failed', reason = COALESCE(reason, '审批执行超时，请重新发起工具调用'), updated_at = now()
     WHERE id = ? AND user_id = ? AND status = 'executing' AND updated_at < now() - interval '10 minutes'`,
    )
    .run(input.id, input.userId);
  const claimStatus = input.approved ? "executing" : "denied";
  const approval = (await dbClient
    .prepare(
      `WITH claimed AS (
       UPDATE sys_ai_tool_approval
       SET status = ?, reason = ?, decided_by = ?, decided_at = now(), updated_at = now()
       WHERE id = ? AND user_id = ? AND status = 'pending'
         AND (expires_at IS NULL OR expires_at > now())
       RETURNING *
     )
     SELECT claimed.*, t.handler_key AS "handlerKey", t.code, t.description,
       t.risk_level AS "riskLevel", t.approval_required AS "approvalRequired",
       t.status AS "toolStatus", t.is_system AS "isSystem", t.name,
       t.config_json AS "configJson"
     FROM claimed LEFT JOIN sys_ai_tool t ON t.id = claimed.tool_id`,
    )
    .get(claimStatus, input.reason ?? null, input.userId, input.id, input.userId)) as
    | (Record<string, unknown> & {
        input_json?: string;
        handlerKey?: string;
        name?: string;
        configJson?: string | null;
      })
    | undefined;

  if (!approval) {
    const expired = (await dbClient
      .prepare(
        `UPDATE sys_ai_tool_approval
       SET status = 'expired', reason = '审批已过期，未执行工具', decided_by = ?,
         decided_at = now(), updated_at = now()
       WHERE id = ? AND user_id = ? AND status = 'pending'
         AND expires_at IS NOT NULL AND expires_at <= now()
       RETURNING run_id AS "runId", step_id AS "stepId", session_id AS "sessionId", tool_name AS "toolName"`,
      )
      .get(input.userId, input.id, input.userId)) as
      | { runId: number; stepId: number | null; sessionId: number; toolName: string }
      | undefined;

    if (!expired) throw new AiApprovalDecisionConflictError();
    if (expired.stepId) {
      await dbClient
        .prepare(
          "UPDATE sys_ai_agent_run_step SET status = 'denied', error_message = ?, finished_at = now(), updated_at = now() WHERE id = ?",
        )
        .run("审批已过期，未执行工具", expired.stepId);
    }
    await dbClient
      .prepare(
        "UPDATE sys_ai_agent_run SET status = 'stopped', error_message = ?, finished_at = now(), updated_at = now() WHERE id = ?",
      )
      .run("审批已过期，未执行工具", expired.runId);
    await dbClient
      .prepare(
        `INSERT INTO sys_ai_chat_message (session_id, user_id, role, content, status)
       VALUES (?, ?, 'system', ?, 'completed')`,
      )
      .run(expired.sessionId, input.userId, `[工具审批已过期] ${expired.toolName}`);
    await refreshApprovalSession({
      sessionId: expired.sessionId,
      userId: input.userId,
      dbClient,
    });
    return { status: "expired", output: null, sessionId: expired.sessionId };
  }
  const expiresAt = approval.expires_at ? new Date(String(approval.expires_at)).getTime() : 0;
  if (expiresAt && expiresAt <= Date.now()) throw new AiApprovalDecisionConflictError();
  if (!input.approved) {
    await dbClient
      .prepare(
        "UPDATE sys_ai_agent_run SET status = 'stopped', finished_at = now(), updated_at = now() WHERE id = ?",
      )
      .run(Number(approval.run_id));
    if (approval.step_id) {
      await dbClient
        .prepare(
          "UPDATE sys_ai_agent_run_step SET status = 'denied', error_message = ?, finished_at = now(), updated_at = now() WHERE id = ?",
        )
        .run(input.reason || "用户拒绝执行", Number(approval.step_id));
    }
    await dbClient
      .prepare(
        `INSERT INTO sys_ai_chat_message (session_id, user_id, role, content, status)
       VALUES (?, ?, 'system', ?, 'completed')`,
      )
      .run(
        Number(approval.session_id),
        input.userId,
        `[工具调用已拒绝] ${String(approval.tool_name)}: ${input.reason || "用户拒绝执行"}`,
      );
    await refreshApprovalSession({
      sessionId: Number(approval.session_id),
      userId: input.userId,
      dbClient,
    });
    return { status: "denied", output: null, sessionId: Number(approval.session_id) };
  }
  const continuationLease = await claimAgentRunLeaseForRun({
    runId: Number(approval.run_id),
    workerId: `approval-${input.id}-${randomUUID().slice(0, 8)}`,
  });
  if (!continuationLease) {
    await dbClient
      .prepare(
        `UPDATE sys_ai_tool_approval
         SET status = 'failed', reason = '运行已被其他执行器接管，请重新发起审批', updated_at = now()
         WHERE id = ? AND status = 'executing'`,
      )
      .run(input.id);
    throw new AiApprovalDecisionConflictError("该运行已被其他执行器接管，请刷新后重试");
  }
  const tool: AiToolRow = {
    id: Number(approval.tool_id),
    name: String(approval.name || approval.tool_name),
    code: String(approval.code || ""),
    description: String(approval.description || ""),
    handlerKey: String(approval.handlerKey || ""),
    inputSchemaJson: null,
    configJson: approval.configJson ? String(approval.configJson) : null,
    riskLevel: String(approval.riskLevel || "medium") as AiToolRow["riskLevel"],
    approvalRequired: Boolean(approval.approvalRequired),
    status: Number(approval.toolStatus ?? 0),
    sort: 0,
    isSystem: Boolean(approval.isSystem),
  };
  try {
    if (!approval.tool_id || Number(approval.toolStatus) !== 1 || !tool.handlerKey) {
      throw new Error("工具已停用或不存在，不能继续执行");
    }
    if (tool.handlerKey === "browser_location") {
      throw new Error("浏览器位置需要由当前用户在聊天窗口中授权，不能通过服务端审批执行");
    }
    const toolInput = approval.input_json
      ? (JSON.parse(String(approval.input_json)) as Record<string, unknown>)
      : {};
    if (
      isModuleAgentHandlerKey(tool.handlerKey) &&
      approval.plan_hash &&
      String(toolInput.planHash || "") !== String(approval.plan_hash)
    ) {
      throw new Error("审批记录的发布计划哈希与工具参数不一致");
    }
    const output = await executeAgentTool(tool, toolInput, {
      dbClient,
      userId: input.userId,
      runId: Number(approval.run_id),
      leaseOwner: continuationLease.leaseOwner,
      toolCallId: String(approval.tool_call_id),
      approvedExecution: true,
      approvedModuleMutation: true,
    });
    await dbClient
      .prepare(
        "UPDATE sys_ai_tool_approval SET status = 'executed', output_json = ?, executed_at = now(), updated_at = now() WHERE id = ? AND status = 'executing'",
      )
      .run(JSON.stringify(output), input.id);
    await dbClient
      .prepare(
        "UPDATE sys_ai_agent_run_step SET status = 'completed', output_json = ?, finished_at = now(), updated_at = now() WHERE id = ?",
      )
      .run(JSON.stringify(output), Number(approval.step_id));
    await dbClient
      .prepare(
        "UPDATE sys_ai_agent_run SET status = 'waiting_continuation', error_message = NULL, finished_at = NULL, updated_at = now() WHERE id = ? AND lease_owner = ? AND lease_until > now()",
      )
      .run(Number(approval.run_id), continuationLease.leaseOwner);
    await dbClient
      .prepare(
        `INSERT INTO sys_ai_chat_message (session_id, user_id, role, content, status)
       VALUES (?, ?, 'system', ?, 'completed')`,
      )
      .run(
        Number(approval.session_id),
        input.userId,
        `[已审批工具执行结果] ${String(approval.tool_name)}\n${JSON.stringify(output)}`,
      );
    await refreshApprovalSession({
      sessionId: Number(approval.session_id),
      userId: input.userId,
      dbClient,
    });
    return { status: "executed", output, sessionId: Number(approval.session_id) };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await dbClient
      .prepare(
        "UPDATE sys_ai_tool_approval SET status = 'failed', reason = ?, decided_by = ?, decided_at = now(), updated_at = now() WHERE id = ?",
      )
      .run(errorMessage, input.userId, input.id);
    await dbClient
      .prepare(
        "UPDATE sys_ai_agent_run SET status = 'failed', error_message = ?, finished_at = now(), updated_at = now() WHERE id = ? AND lease_owner = ? AND lease_until > now()",
      )
      .run(errorMessage, Number(approval.run_id), continuationLease.leaseOwner);
    if (approval.step_id) {
      await dbClient
        .prepare(
          "UPDATE sys_ai_agent_run_step SET status = 'failed', error_message = ?, finished_at = now(), updated_at = now() WHERE id = ?",
        )
        .run(errorMessage, Number(approval.step_id));
    }
    await dbClient
      .prepare(
        `INSERT INTO sys_ai_chat_message (session_id, user_id, role, content, status)
       VALUES (?, ?, 'system', ?, 'completed')`,
      )
      .run(
        Number(approval.session_id),
        input.userId,
        `[工具执行失败] ${String(approval.tool_name)}: ${errorMessage}`,
      );
    await refreshApprovalSession({
      sessionId: Number(approval.session_id),
      userId: input.userId,
      dbClient,
    });
    throw error;
  }
}

function normalizeClientLocationResult(result: ClientToolResultInput) {
  if (result.status !== "granted") {
    return {
      status: result.status,
      reason: result.reason?.trim().slice(0, 500) || "用户未提供大致位置",
    };
  }
  return {
    status: "granted" as const,
    latitude: Math.round(result.latitude * 100) / 100,
    longitude: Math.round(result.longitude * 100) / 100,
    ...(result.accuracy == null
      ? {}
      : { accuracy: Math.min(100000, Math.max(0, Math.round(result.accuracy))) }),
  };
}

export async function submitClientToolResult(input: {
  id: number;
  sessionId: number;
  userId: number;
  result: ClientToolResultInput;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const output = normalizeClientLocationResult(input.result);
  const approval = (await dbClient
    .prepare(
      `WITH claimed AS (
       UPDATE sys_ai_tool_approval approval
       SET status = 'executing', decided_by = ?, decided_at = now(), updated_at = now()
       FROM sys_ai_tool tool, sys_ai_chat_session session
       WHERE approval.id = ? AND approval.session_id = ? AND approval.user_id = ?
         AND approval.status = 'pending'
         AND (approval.expires_at IS NULL OR approval.expires_at > now())
         AND tool.id = approval.tool_id AND tool.handler_key = 'browser_location'
         AND tool.status = 1 AND tool.deleted_at IS NULL
         AND session.id = approval.session_id AND session.user_id = ? AND session.deleted_at IS NULL
       RETURNING approval.*
     )
     SELECT claimed.*, tool.handler_key AS "handlerKey"
     FROM claimed INNER JOIN sys_ai_tool tool ON tool.id = claimed.tool_id`,
    )
    .get(input.userId, input.id, input.sessionId, input.userId, input.userId)) as
    | (Record<string, unknown> & { handlerKey: string })
    | undefined;

  if (!approval) {
    const expired = (await dbClient
      .prepare(
        `UPDATE sys_ai_tool_approval
         SET status = 'expired', reason = '浏览器位置授权已过期', decided_by = ?,
           decided_at = now(), updated_at = now()
         WHERE id = ? AND session_id = ? AND user_id = ? AND status = 'pending'
           AND expires_at IS NOT NULL AND expires_at <= now()
         RETURNING run_id AS "runId", step_id AS "stepId", session_id AS "sessionId"`,
      )
      .get(input.userId, input.id, input.sessionId, input.userId)) as
      | { runId: number; stepId: number | null; sessionId: number }
      | undefined;
    if (expired) {
      if (expired.stepId) {
        await dbClient
          .prepare(
            `UPDATE sys_ai_agent_run_step
             SET status = 'denied', error_message = '浏览器位置授权已过期',
               finished_at = now(), updated_at = now()
             WHERE id = ?`,
          )
          .run(expired.stepId);
      }
      await dbClient
        .prepare(
          `UPDATE sys_ai_agent_run
           SET status = 'stopped', error_message = '浏览器位置授权已过期',
             finished_at = now(), updated_at = now()
           WHERE id = ?`,
        )
        .run(expired.runId);
      await dbClient
        .prepare(
          `INSERT INTO sys_ai_chat_message (session_id, user_id, role, content, status)
           VALUES (?, ?, 'system', '[浏览器位置结果] 本次位置授权已过期，请重新提问或直接提供城市。', 'completed')`,
        )
        .run(expired.sessionId, input.userId);
      await refreshApprovalSession({
        sessionId: expired.sessionId,
        userId: input.userId,
        dbClient,
      });
      throw new AiApprovalDecisionConflictError("浏览器位置授权已过期，请重新发起请求");
    }
    throw new AiApprovalDecisionConflictError("位置授权已经处理、不可用或不属于当前会话");
  }

  const sessionId = Number(approval.session_id);
  const systemMessage =
    output.status === "granted"
      ? `[浏览器位置结果] 用户已允许本次使用大致位置：纬度 ${output.latitude.toFixed(2)}，经度 ${output.longitude.toFixed(2)}${output.accuracy == null ? "" : `，精度约 ${output.accuracy} 米`}。请继续处理原问题；天气等实时信息应调用 web-search。`
      : `[浏览器位置结果] 用户未提供位置：${output.reason}。请继续处理原问题，并询问用户所在城市或地区；不得虚构位置。`;

  try {
    await dbClient
      .prepare(
        `UPDATE sys_ai_tool_approval
         SET status = 'executed', output_json = ?, reason = ?, executed_at = now(), updated_at = now()
         WHERE id = ? AND status = 'executing'`,
      )
      .run(JSON.stringify(output), output.status === "granted" ? null : output.reason, input.id);
    if (approval.step_id) {
      await dbClient
        .prepare(
          `UPDATE sys_ai_agent_run_step
           SET status = 'completed', output_json = ?, finished_at = now(), updated_at = now()
           WHERE id = ?`,
        )
        .run(JSON.stringify(output), Number(approval.step_id));
    }
    await dbClient
      .prepare(
        `UPDATE sys_ai_agent_run
         SET status = 'waiting_continuation', error_message = NULL, finished_at = NULL, updated_at = now()
         WHERE id = ?`,
      )
      .run(Number(approval.run_id));
    await dbClient
      .prepare(
        `INSERT INTO sys_ai_chat_message (session_id, user_id, role, content, status)
         VALUES (?, ?, 'system', ?, 'completed')`,
      )
      .run(sessionId, input.userId, systemMessage);
    await refreshApprovalSession({ sessionId, userId: input.userId, dbClient });
    return { status: "executed" as const, sessionId, output };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await dbClient
      .prepare(
        `UPDATE sys_ai_tool_approval
         SET status = 'failed', reason = ?, updated_at = now()
         WHERE id = ? AND status = 'executing'`,
      )
      .run(errorMessage, input.id);
    await dbClient
      .prepare(
        `UPDATE sys_ai_agent_run
         SET status = 'failed', error_message = ?, finished_at = now(), updated_at = now()
         WHERE id = ?`,
      )
      .run(errorMessage, Number(approval.run_id));
    if (approval.step_id) {
      await dbClient
        .prepare(
          `UPDATE sys_ai_agent_run_step
           SET status = 'failed', error_message = ?, finished_at = now(), updated_at = now()
           WHERE id = ?`,
        )
        .run(errorMessage, Number(approval.step_id));
    }
    throw error;
  }
}
