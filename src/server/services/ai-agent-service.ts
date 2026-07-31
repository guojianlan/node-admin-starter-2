import { sqlite, type DbClient } from "@/server/db";

export type AiAgentRow = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  instructions: string;
  modelId: number | null;
  modelName: string | null;
  temperatureMilli: number;
  maxOutputTokens: number | null;
  maxSteps: number;
  status: number;
  sort: number;
  isSystem: boolean;
  toolIds: number[];
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

function parseNumberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter(Number.isInteger);
}

export async function listAiAgents(input: { activeOnly?: boolean; dbClient?: DbClient } = {}) {
  const dbClient = input.dbClient ?? sqlite;
  const rows = (await dbClient
    .prepare(
      `SELECT a.id, a.name, a.code, a.description, a.instructions,
        a.model_id AS "modelId", m.name AS "modelName",
        a.temperature_milli AS "temperatureMilli", a.max_output_tokens AS "maxOutputTokens",
        a.max_steps AS "maxSteps", a.status, a.sort, a.is_system AS "isSystem",
        COALESCE((SELECT json_agg(at.tool_id ORDER BY at.tool_id) FROM sys_ai_agent_tool at WHERE at.agent_id = a.id), '[]') AS "toolIds",
        a.created_at AS "createdAt", a.updated_at AS "updatedAt"
       FROM sys_ai_agent a
       LEFT JOIN sys_ai_model m ON m.id = a.model_id
       WHERE a.deleted_at IS NULL ${input.activeOnly ? "AND a.status = 1" : ""}
       ORDER BY a.sort ASC, a.id ASC`,
    )
    .all()) as Array<Omit<AiAgentRow, "toolIds"> & { toolIds: unknown }>;
  return rows.map((row) => ({ ...row, toolIds: parseNumberArray(row.toolIds) }));
}

export async function getAiAgent(id: number, dbClient: DbClient = sqlite) {
  return (await listAiAgents({ dbClient })).find((item) => item.id === id);
}

export async function listAiTools(input: { activeOnly?: boolean; agentId?: number; dbClient?: DbClient } = {}) {
  const dbClient = input.dbClient ?? sqlite;
  const values: number[] = [];
  const joins = input.agentId
    ? "INNER JOIN sys_ai_agent_tool at ON at.tool_id = t.id AND at.agent_id = ?"
    : "LEFT JOIN sys_ai_agent_tool at ON false";
  if (input.agentId) values.push(input.agentId);
  return (await dbClient
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
    const existing = (await dbClient.prepare("SELECT code, is_system AS \"isSystem\" FROM sys_ai_agent WHERE id = ? AND deleted_at IS NULL").get(id)) as { code: string; isSystem: boolean } | undefined;
    if (!existing) throw new Error("Agent 不存在");
    if (existing.isSystem && existing.code !== input.code) throw new Error("系统内置 Agent 不允许修改编码");
    await dbClient
      .prepare(
        `UPDATE sys_ai_agent SET name = ?, code = ?, description = ?, instructions = ?, model_id = ?,
          temperature_milli = ?, max_output_tokens = ?, max_steps = ?, status = ?, sort = ?,
          updated_by = ?, updated_at = now() WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        input.name, input.code, input.description ?? null, input.instructions, input.modelId ?? null,
        input.temperatureMilli ?? 700, input.maxOutputTokens ?? null, input.maxSteps ?? 6,
        input.status ?? 1, input.sort ?? 0, input.userId, id,
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
        input.name, input.code, input.description ?? null, input.instructions, input.modelId ?? null,
        input.temperatureMilli ?? 700, input.maxOutputTokens ?? null, input.maxSteps ?? 6,
        input.status ?? 1, input.sort ?? 0, input.userId, input.userId,
      );
    id = Number(result.lastInsertRowid);
  }
  if (!id) throw new Error("Agent 保存失败");
  if (input.toolIds) {
    await dbClient.prepare("DELETE FROM sys_ai_agent_tool WHERE agent_id = ?").run(id);
    for (const toolId of input.toolIds) {
      await dbClient
        .prepare("INSERT INTO sys_ai_agent_tool (agent_id, tool_id, approval_mode) VALUES (?, ?, 'inherit') ON CONFLICT DO NOTHING")
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
    const existing = (await dbClient.prepare("SELECT code, handler_key AS \"handlerKey\", is_system AS \"isSystem\" FROM sys_ai_tool WHERE id = ? AND deleted_at IS NULL").get(input.id)) as { code: string; handlerKey: string; isSystem: boolean } | undefined;
    if (!existing) throw new Error("工具不存在");
    if (existing.isSystem && (existing.code !== input.code || existing.handlerKey !== input.handlerKey)) {
      throw new Error("系统内置工具不允许修改编码或处理器");
    }
    await dbClient
      .prepare(
        `UPDATE sys_ai_tool SET name = ?, code = ?, description = ?, handler_key = ?,
          input_schema_json = ?, config_json = ?, risk_level = ?, approval_required = ?,
          status = ?, sort = ?, updated_by = ?, updated_at = now()
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        input.name, input.code, input.description, input.handlerKey, input.inputSchemaJson ?? null,
        input.configJson ?? null, input.riskLevel ?? "low", input.approvalRequired ?? false,
        input.status ?? 1, input.sort ?? 0, input.userId, input.id,
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
      input.name, input.code, input.description, input.handlerKey, input.inputSchemaJson ?? null,
      input.configJson ?? null, input.riskLevel ?? "low", input.approvalRequired ?? false,
      input.status ?? 1, input.sort ?? 0, input.userId, input.userId,
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
  const row = (await dbClient.prepare(`SELECT is_system AS "isSystem" FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(input.id)) as { isSystem: boolean } | undefined;
  if (!row) throw new Error(input.type === "agent" ? "Agent 不存在" : "工具不存在");
  if (row.isSystem) throw new Error("系统内置资源不能删除");
  await dbClient.prepare(`UPDATE ${table} SET deleted_at = now(), deleted_by = ?, updated_at = now() WHERE id = ?`).run(input.userId, input.id);
}

export async function createAgentRun(input: { sessionId: number; agentId: number; userId: number; inputMessageId?: number | null; dbClient?: DbClient }) {
  const dbClient = input.dbClient ?? sqlite;
  const result = await dbClient.prepare(
    `INSERT INTO sys_ai_agent_run (session_id, agent_id, user_id, status, input_message_id, started_at)
     VALUES (?, ?, ?, 'running', ?, now()) RETURNING id`,
  ).run(input.sessionId, input.agentId, input.userId, input.inputMessageId ?? null);
  return Number(result.lastInsertRowid);
}

export async function finishAgentRun(input: { id: number; status: string; outputMessageId?: number | null; totalSteps?: number; usage?: Record<string, unknown>; durationMs?: number; errorMessage?: string | null; dbClient?: DbClient }) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient.prepare(
    `UPDATE sys_ai_agent_run SET status = ?, output_message_id = COALESCE(?, output_message_id),
      total_steps = COALESCE(?, total_steps), input_tokens = ?, output_tokens = ?, duration_ms = ?,
      error_message = ?, finished_at = CASE WHEN ? = 'waiting_approval' THEN NULL ELSE now() END,
      updated_at = now() WHERE id = ?`,
  ).run(
    input.status, input.outputMessageId ?? null, input.totalSteps ?? null,
    Number(input.usage?.inputTokens ?? input.usage?.promptTokens ?? 0),
    Number(input.usage?.outputTokens ?? input.usage?.completionTokens ?? 0),
    input.durationMs ?? null, input.errorMessage ?? null, input.status, input.id,
  );
}

export async function appendAgentRunStep(input: { runId: number; stepNo: number; stepType: "model" | "tool" | "approval"; status: string; toolId?: number | null; toolName?: string | null; toolCallId?: string | null; input?: unknown; output?: unknown; usage?: unknown; durationMs?: number | null; errorMessage?: string | null; dbClient?: DbClient }) {
  const dbClient = input.dbClient ?? sqlite;
  const result = await dbClient.prepare(
    `INSERT INTO sys_ai_agent_run_step
      (run_id, step_no, step_type, status, tool_id, tool_name, tool_call_id, input_json,
       output_json, usage_json, duration_ms, error_message, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'waiting_approval' THEN NULL ELSE now() END)
     RETURNING id`,
  ).run(
    input.runId, input.stepNo, input.stepType, input.status, input.toolId ?? null,
    input.toolName ?? null, input.toolCallId ?? null,
    input.input == null ? null : JSON.stringify(input.input),
    input.output == null ? null : JSON.stringify(input.output),
    input.usage == null ? null : JSON.stringify(input.usage), input.durationMs ?? null,
    input.errorMessage ?? null, input.status,
  );
  return Number(result.lastInsertRowid);
}

export async function createToolApproval(input: { runId: number; stepId: number; sessionId: number; userId: number; tool?: AiToolRow; toolName: string; toolCallId: string; toolInput: unknown; dbClient?: DbClient }) {
  const dbClient = input.dbClient ?? sqlite;
  const result = await dbClient.prepare(
    `INSERT INTO sys_ai_tool_approval
      (run_id, step_id, session_id, user_id, tool_id, tool_name, tool_call_id, input_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     ON CONFLICT DO NOTHING
     RETURNING id`,
  ).run(input.runId, input.stepId, input.sessionId, input.userId, input.tool?.id ?? null, input.toolName, input.toolCallId, JSON.stringify(input.toolInput ?? {}));
  if (result.lastInsertRowid) return Number(result.lastInsertRowid);
  const existing = await dbClient.prepare(
    "SELECT id FROM sys_ai_tool_approval WHERE run_id = ? AND tool_call_id = ?",
  ).get(input.runId, input.toolCallId) as { id?: number } | undefined;
  if (!existing?.id) throw new Error("工具审批调用标识冲突，请完成数据库迁移后重试");
  return Number(existing.id);
}

export async function listSessionApprovals(input: { sessionId: number; userId: number; dbClient?: DbClient }) {
  const dbClient = input.dbClient ?? sqlite;
  return dbClient.prepare(
    `SELECT a.id, a.run_id AS "runId", a.step_id AS "stepId", a.tool_id AS "toolId",
      a.tool_name AS "toolName", COALESCE(t.name, a.tool_name) AS "toolDisplayName",
      t.description AS "toolDescription", t.handler_key AS "handlerKey",
      COALESCE(t.risk_level, 'medium') AS "riskLevel",
      a.tool_call_id AS "toolCallId", a.input_json AS "inputJson", a.output_json AS "outputJson",
      a.status, a.reason, a.decided_at AS "decidedAt", a.created_at AS "createdAt"
     FROM sys_ai_tool_approval a
     LEFT JOIN sys_ai_tool t ON t.id = a.tool_id
     WHERE a.session_id = ? AND a.user_id = ? ORDER BY a.id DESC`,
  ).all(input.sessionId, input.userId);
}

export async function getLatestSessionAgentRun(input: {
  sessionId: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const run = await dbClient.prepare(
    `SELECT r.id, r.session_id AS "sessionId", r.agent_id AS "agentId", a.name AS "agentName",
      a.code AS "agentCode", COALESCE(s.model_name, m.name) AS "modelName",
      COALESCE(s.model_identifier, m.model_id) AS "modelIdentifier",
      r.status, r.total_steps AS "totalSteps", r.input_tokens AS "inputTokens",
      r.output_tokens AS "outputTokens", r.duration_ms AS "durationMs",
      r.error_message AS "errorMessage", r.started_at AS "startedAt", r.finished_at AS "finishedAt"
     FROM sys_ai_agent_run r
     INNER JOIN sys_ai_agent a ON a.id = r.agent_id
     INNER JOIN sys_ai_chat_session s ON s.id = r.session_id
     LEFT JOIN sys_ai_model m ON m.id = COALESCE(s.model_id, a.model_id)
     WHERE r.session_id = ? AND r.user_id = ? AND s.user_id = ? AND s.deleted_at IS NULL
     ORDER BY r.id DESC LIMIT 1`,
  ).get(input.sessionId, input.userId, input.userId) as Record<string, unknown> | undefined;
  if (!run) return null;
  const steps = await dbClient.prepare(
    `SELECT id, step_no AS "stepNo", step_type AS "stepType", status,
      tool_name AS "toolName", tool_call_id AS "toolCallId", input_json AS "inputJson",
      output_json AS "outputJson", usage_json AS "usageJson", duration_ms AS "durationMs",
      error_message AS "errorMessage", started_at AS "startedAt", finished_at AS "finishedAt"
     FROM sys_ai_agent_run_step WHERE run_id = ? ORDER BY step_no ASC, id ASC`,
  ).all(Number(run.id));
  return { ...run, steps };
}

async function refreshApprovalSession(input: { sessionId: number; userId: number; dbClient: DbClient }) {
  await input.dbClient.prepare(
    `UPDATE sys_ai_chat_session SET
      message_count = (
        SELECT COUNT(1)::int FROM sys_ai_chat_message
        WHERE session_id = ? AND status <> 'superseded'
      ),
      last_message_at = now(), updated_by = ?, updated_at = now()
     WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
  ).run(input.sessionId, input.userId, input.sessionId, input.userId);
}

function tokenizeExpression(expression: string) {
  const compact = expression.replace(/\s+/g, "");
  if (!/^[0-9+\-*/().]+$/.test(compact)) throw new Error("表达式只允许数字和 + - * / ( )");
  return compact;
}

function calculate(expression: string) {
  const value = tokenizeExpression(expression);
  const tokens = value.match(/\d+(?:\.\d+)?|[()+\-*/]/g) ?? [];
  let index = 0;
  const parsePrimary = (): number => {
    const token = tokens[index++];
    if (token === "(") {
      const result = parseAddSub();
      if (tokens[index++] !== ")") throw new Error("括号不匹配");
      return result;
    }
    if (token === "-") return -parsePrimary();
    const number = Number(token);
    if (!Number.isFinite(number)) throw new Error("表达式格式错误");
    return number;
  };
  const parseMulDiv = (): number => {
    let result = parsePrimary();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index++];
      const right = parsePrimary();
      result = operator === "*" ? result * right : result / right;
    }
    return result;
  };
  const parseAddSub = (): number => {
    let result = parseMulDiv();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = parseMulDiv();
      result = operator === "+" ? result + right : result - right;
    }
    return result;
  };
  const result = parseAddSub();
  if (index !== tokens.length || !Number.isFinite(result)) throw new Error("表达式无法计算");
  return result;
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
  options: { dbClient?: DbClient; userId?: number } = {},
) {
  const dbClient = options.dbClient ?? sqlite;
  if (tool.handlerKey === "current_time") {
    return { now: new Date().toISOString(), timezone: "Asia/Shanghai" };
  }
  if (tool.handlerKey === "calculator") {
    const expression = String(input.expression || "");
    return { expression, result: calculate(expression) };
  }
  if (tool.handlerKey === "system_status") {
    const total = (value: unknown) => Number((value as { total?: number } | undefined)?.total ?? 0);
    const metrics = [
      {
        key: "activeUsers",
        ability: "system.user.query",
        query: "SELECT COUNT(1)::int AS total FROM sys_user WHERE deleted_at IS NULL AND status = 1",
      },
      {
        key: "onlineSessions",
        ability: "system.onlineUser.query",
        query: "SELECT COUNT(1)::int AS total FROM sys_access_token WHERE expires_at > now()",
      },
      {
        key: "todayLogins",
        ability: "system.loginLog.query",
        query: "SELECT COUNT(1)::int AS total FROM sys_login_record WHERE created_at >= CURRENT_DATE",
      },
      {
        key: "todayOperations",
        ability: "system.operationLog.query",
        query: "SELECT COUNT(1)::int AS total FROM sys_operation_log WHERE created_at >= CURRENT_DATE",
      },
    ] as const;
    const result: Record<string, number> = {};
    const hiddenMetrics: string[] = [];
    for (const metric of metrics) {
      if (!(await userHasAbility(options.userId, metric.ability, dbClient))) {
        hiddenMetrics.push(metric.key);
        continue;
      }
      result[metric.key] = total(await dbClient.prepare(metric.query).get());
    }
    return { ...result, hiddenMetrics };
  }
  if (tool.handlerKey === "operation_log_summary") {
    if (!(await userHasAbility(options.userId, "system.operationLog.query", dbClient))) {
      throw new Error("没有操作日志查询权限");
    }
    const hours = Math.min(Math.max(Number(input.hours || 24), 1), 168);
    const rows = await dbClient.prepare(
      `SELECT module, risk_level AS "riskLevel", COUNT(1)::int AS total
       FROM sys_operation_log WHERE created_at >= now() - (? * interval '1 hour')
       GROUP BY module, risk_level ORDER BY total DESC LIMIT 30`,
    ).all(hours);
    return { hours, rows };
  }
  throw new Error(`工具处理器 ${tool.handlerKey} 尚未实现`);
}

export async function decideToolApproval(input: { id: number; userId: number; approved: boolean; reason?: string | null; dbClient?: DbClient }) {
  const dbClient = input.dbClient ?? sqlite;
  const approval = (await dbClient.prepare(
    `SELECT a.*, t.handler_key AS "handlerKey", t.code, t.description, t.risk_level AS "riskLevel",
      t.approval_required AS "approvalRequired", t.status AS "toolStatus", t.name
     FROM sys_ai_tool_approval a LEFT JOIN sys_ai_tool t ON t.id = a.tool_id
     WHERE a.id = ? AND a.user_id = ? AND a.status = 'pending'`,
  ).get(input.id, input.userId)) as (Record<string, unknown> & { input_json?: string; handlerKey?: string; name?: string }) | undefined;
  if (!approval) throw new Error("待审批记录不存在或已经处理");
  if (!input.approved) {
    await dbClient.prepare("UPDATE sys_ai_tool_approval SET status = 'denied', reason = ?, decided_by = ?, decided_at = now(), updated_at = now() WHERE id = ?")
      .run(input.reason ?? null, input.userId, input.id);
    await dbClient.prepare("UPDATE sys_ai_agent_run SET status = 'stopped', finished_at = now(), updated_at = now() WHERE id = ?")
      .run(Number(approval.run_id));
    await dbClient.prepare(
      `INSERT INTO sys_ai_chat_message (session_id, user_id, role, content, status)
       VALUES (?, ?, 'system', ?, 'completed')`,
    ).run(Number(approval.session_id), input.userId, `[工具调用已拒绝] ${String(approval.tool_name)}: ${input.reason || "用户拒绝执行"}`);
    await refreshApprovalSession({
      sessionId: Number(approval.session_id),
      userId: input.userId,
      dbClient,
    });
    return { status: "denied", output: null, sessionId: Number(approval.session_id) };
  }
  const tool: AiToolRow = {
    id: Number(approval.tool_id), name: String(approval.name || approval.tool_name),
    code: String(approval.code || ""), description: String(approval.description || ""),
    handlerKey: String(approval.handlerKey || ""), inputSchemaJson: null, configJson: null,
    riskLevel: String(approval.riskLevel || "medium") as AiToolRow["riskLevel"],
    approvalRequired: Boolean(approval.approvalRequired), status: Number(approval.toolStatus || 1), sort: 0, isSystem: false,
  };
  try {
    if (!approval.tool_id || Number(approval.toolStatus) !== 1 || !tool.handlerKey) {
      throw new Error("工具已停用或不存在，不能继续执行");
    }
    const toolInput = approval.input_json ? JSON.parse(String(approval.input_json)) as Record<string, unknown> : {};
    const output = await executeAgentTool(tool, toolInput, {
      dbClient,
      userId: input.userId,
    });
    await dbClient.prepare(
      "UPDATE sys_ai_tool_approval SET status = 'executed', output_json = ?, reason = ?, decided_by = ?, decided_at = now(), executed_at = now(), updated_at = now() WHERE id = ?",
    ).run(JSON.stringify(output), input.reason ?? null, input.userId, input.id);
    await dbClient.prepare("UPDATE sys_ai_agent_run_step SET status = 'completed', output_json = ?, finished_at = now(), updated_at = now() WHERE id = ?")
      .run(JSON.stringify(output), Number(approval.step_id));
    await dbClient.prepare("UPDATE sys_ai_agent_run SET status = 'completed', finished_at = now(), updated_at = now() WHERE id = ?")
      .run(Number(approval.run_id));
    await dbClient.prepare(
      `INSERT INTO sys_ai_chat_message (session_id, user_id, role, content, status)
       VALUES (?, ?, 'system', ?, 'completed')`,
    ).run(
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
    await dbClient.prepare(
      "UPDATE sys_ai_tool_approval SET status = 'failed', reason = ?, decided_by = ?, decided_at = now(), updated_at = now() WHERE id = ?",
    ).run(errorMessage, input.userId, input.id);
    await dbClient.prepare("UPDATE sys_ai_agent_run SET status = 'failed', error_message = ?, finished_at = now(), updated_at = now() WHERE id = ?")
      .run(errorMessage, Number(approval.run_id));
    if (approval.step_id) {
      await dbClient.prepare("UPDATE sys_ai_agent_run_step SET status = 'failed', error_message = ?, finished_at = now(), updated_at = now() WHERE id = ?")
        .run(errorMessage, Number(approval.step_id));
    }
    await dbClient.prepare(
      `INSERT INTO sys_ai_chat_message (session_id, user_id, role, content, status)
       VALUES (?, ?, 'system', ?, 'completed')`,
    ).run(Number(approval.session_id), input.userId, `[工具执行失败] ${String(approval.tool_name)}: ${errorMessage}`);
    await refreshApprovalSession({
      sessionId: Number(approval.session_id),
      userId: input.userId,
      dbClient,
    });
    throw error;
  }
}
