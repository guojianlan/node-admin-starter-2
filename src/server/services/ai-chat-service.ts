import { sqlite, type DbClient } from "@/server/db";
import type { AiRuntimeMessage, AiRuntimePublicConfig } from "./ai-runtime-service";

export type AiChatSessionRow = {
  id: number;
  userId: number;
  title: string;
  providerId: number | null;
  modelId: number | null;
  agentId: number | null;
  agentName: string | null;
  systemPrompt: string | null;
  temperatureMilli: number;
  maxOutputTokens: number | null;
  contextSummary: string | null;
  compactedThroughMessageId: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  providerCode: string | null;
  modelName: string | null;
  modelIdentifier: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  status: number;
  createdAt: string;
  updatedAt: string;
};

export type AiChatMessageRow = {
  id: number;
  sessionId: number;
  userId: number;
  role: "system" | "user" | "assistant";
  content: string;
  status: "pending" | "streaming" | "completed" | "stopped" | "failed" | "superseded";
  errorMessage: string | null;
  parentMessageId: number | null;
  regeneratedFromId: number | null;
  finishReason: string | null;
  usageJson: string | null;
  metadataJson: string | null;
  providerId: number | null;
  modelId: number | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
};

export type AiChatSessionPage = {
  data: AiChatSessionRow[];
  total: number;
  page: number;
  pageSize: number;
};

function normalizeTitle(value?: string | null) {
  const title = value?.trim();
  return title || "新的聊天";
}

export function titleFromContent(content: string) {
  const compact = content.trim().replace(/\s+/g, " ");
  if (!compact) return "新的聊天";
  return compact.length > 30 ? `${compact.slice(0, 30)}...` : compact;
}

export async function listAiChatSessions(input: {
  userId: number;
  page?: number;
  pageSize?: number;
  keyword?: string;
  dbClient?: DbClient;
}): Promise<AiChatSessionPage> {
  const dbClient = input.dbClient ?? sqlite;
  const page = Math.max(Number(input.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(input.pageSize || 20), 1), 100);
  const conditions = ["user_id = ?", "deleted_at IS NULL"];
  const values: Array<string | number> = [input.userId];
  const keyword = input.keyword?.trim();
  if (keyword) {
    conditions.push("(title ILIKE ? OR model_identifier ILIKE ? OR model_name ILIKE ?)");
    values.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const where = conditions.join(" AND ");
  const totalRow = (await dbClient
    .prepare(`SELECT COUNT(1)::int AS total FROM sys_ai_chat_session WHERE ${where}`)
    .get(...values)) as { total: number } | undefined;
  const rows = (await dbClient
    .prepare(
      `SELECT
        id,
        user_id AS "userId",
        title,
        provider_id AS "providerId",
        model_id AS "modelId",
        agent_id AS "agentId",
        (SELECT name FROM sys_ai_agent WHERE id = sys_ai_chat_session.agent_id) AS "agentName",
        system_prompt AS "systemPrompt",
        temperature_milli AS "temperatureMilli",
        max_output_tokens AS "maxOutputTokens",
        context_summary AS "contextSummary",
        compacted_through_message_id AS "compactedThroughMessageId",
        total_input_tokens AS "totalInputTokens",
        total_output_tokens AS "totalOutputTokens",
        provider_code AS "providerCode",
        model_name AS "modelName",
        model_identifier AS "modelIdentifier",
        message_count AS "messageCount",
        last_message_at AS "lastMessageAt",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
       FROM sys_ai_chat_session
       WHERE ${where}
       ORDER BY COALESCE(last_message_at, updated_at) DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...values, pageSize, (page - 1) * pageSize)) as AiChatSessionRow[];
  return {
    data: rows,
    total: Number(totalRow?.total ?? 0),
    page,
    pageSize,
  };
}

export async function createAiChatSession(input: {
  userId: number;
  title?: string | null;
  modelId?: number | null;
  agentId?: number | null;
  systemPrompt?: string | null;
  temperatureMilli?: number;
  maxOutputTokens?: number | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const result = await dbClient
    .prepare(
      `INSERT INTO sys_ai_chat_session
        (user_id, title, model_id, agent_id, system_prompt, temperature_milli, max_output_tokens,
         status, created_by, updated_by, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, now(), now())
       RETURNING id`,
    )
    .run(
      input.userId,
      normalizeTitle(input.title),
      input.modelId ?? null,
      input.agentId ?? null,
      input.systemPrompt?.trim() || null,
      input.temperatureMilli ?? 700,
      input.maxOutputTokens ?? null,
      input.userId,
      input.userId,
    );
  return Number(result.lastInsertRowid);
}

export async function getAiChatSession(input: {
  id: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  return (await dbClient
    .prepare(
      `SELECT
        id,
        user_id AS "userId",
        title,
        provider_id AS "providerId",
        model_id AS "modelId",
        agent_id AS "agentId",
        (SELECT name FROM sys_ai_agent WHERE id = sys_ai_chat_session.agent_id) AS "agentName",
        system_prompt AS "systemPrompt",
        temperature_milli AS "temperatureMilli",
        max_output_tokens AS "maxOutputTokens",
        context_summary AS "contextSummary",
        compacted_through_message_id AS "compactedThroughMessageId",
        total_input_tokens AS "totalInputTokens",
        total_output_tokens AS "totalOutputTokens",
        provider_code AS "providerCode",
        model_name AS "modelName",
        model_identifier AS "modelIdentifier",
        message_count AS "messageCount",
        last_message_at AS "lastMessageAt",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
       FROM sys_ai_chat_session
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .get(input.id, input.userId)) as AiChatSessionRow | undefined;
}

export async function updateAiChatSession(input: {
  id: number;
  userId: number;
  title?: string;
  modelId?: number | null;
  agentId?: number | null;
  systemPrompt?: string | null;
  temperatureMilli?: number;
  maxOutputTokens?: number | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const assignments: string[] = [];
  const values: Array<string | number | null> = [];
  if (input.title !== undefined) {
    assignments.push("title = ?");
    values.push(normalizeTitle(input.title));
  }
  if (input.modelId !== undefined) {
    assignments.push("model_id = ?");
    values.push(input.modelId);
  }
  if (input.agentId !== undefined) {
    assignments.push("agent_id = ?");
    values.push(input.agentId);
  }
  if (input.systemPrompt !== undefined) {
    assignments.push("system_prompt = ?");
    values.push(input.systemPrompt?.trim() || null);
  }
  if (input.temperatureMilli !== undefined) {
    assignments.push("temperature_milli = ?");
    values.push(input.temperatureMilli);
  }
  if (input.maxOutputTokens !== undefined) {
    assignments.push("max_output_tokens = ?");
    values.push(input.maxOutputTokens);
  }
  if (!assignments.length) return;
  await dbClient
    .prepare(
      `UPDATE sys_ai_chat_session
       SET ${assignments.join(", ")}, updated_by = ?, updated_at = now()
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .run(...values, input.userId, input.id, input.userId);
}

export async function softDeleteAiChatSession(input: {
  id: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient
    .prepare(
      `UPDATE sys_ai_chat_session
       SET deleted_at = now(), deleted_by = ?, updated_at = now()
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .run(input.userId, input.id, input.userId);
}

export async function listAiChatMessages(input: {
  sessionId: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient
    .prepare(
      `UPDATE sys_ai_chat_message
       SET status = 'failed', error_message = '生成进程已中断', updated_at = now()
       WHERE session_id = ? AND user_id = ? AND status IN ('pending', 'streaming')
         AND updated_at < now() - interval '10 minutes'`,
    )
    .run(input.sessionId, input.userId);
  return (await dbClient
    .prepare(
      `SELECT
        id,
        session_id AS "sessionId",
        user_id AS "userId",
        role,
        content,
        status,
        error_message AS "errorMessage",
        parent_message_id AS "parentMessageId",
        regenerated_from_id AS "regeneratedFromId",
        finish_reason AS "finishReason",
        usage_json AS "usageJson",
        metadata_json AS "metadataJson",
        provider_id AS "providerId",
        model_id AS "modelId",
        duration_ms AS "durationMs",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
       FROM sys_ai_chat_message
       WHERE session_id = ? AND user_id = ? AND status <> 'superseded'
       ORDER BY id ASC`,
    )
    .all(input.sessionId, input.userId)) as AiChatMessageRow[];
}

export async function appendAiChatMessage(input: {
  sessionId: number;
  userId: number;
  role: "system" | "user" | "assistant";
  content: string;
  status?: AiChatMessageRow["status"];
  errorMessage?: string | null;
  parentMessageId?: number | null;
  regeneratedFromId?: number | null;
  providerId?: number | null;
  modelId?: number | null;
  finishReason?: string | null;
  usage?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  durationMs?: number | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const result = await dbClient
    .prepare(
      `INSERT INTO sys_ai_chat_message
        (session_id, user_id, role, content, status, error_message, parent_message_id,
         regenerated_from_id, provider_id, model_id, finish_reason, usage_json,
         metadata_json, duration_ms, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())
       RETURNING id`,
    )
    .run(
      input.sessionId,
      input.userId,
      input.role,
      input.content,
      input.status ?? "completed",
      input.errorMessage ?? null,
      input.parentMessageId ?? null,
      input.regeneratedFromId ?? null,
      input.providerId ?? null,
      input.modelId ?? null,
      input.finishReason ?? null,
      input.usage ? JSON.stringify(input.usage) : null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.durationMs ?? null,
    );
  return Number(result.lastInsertRowid);
}

export async function updateAiChatMessage(input: {
  id: number;
  sessionId: number;
  userId: number;
  content?: string;
  status?: AiChatMessageRow["status"];
  errorMessage?: string | null;
  finishReason?: string | null;
  usage?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  providerId?: number | null;
  modelId?: number | null;
  durationMs?: number | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient
    .prepare(
      `UPDATE sys_ai_chat_message SET
        content = COALESCE(?, content),
        status = COALESCE(?, status),
        error_message = ?,
        finish_reason = ?,
        usage_json = ?,
        metadata_json = ?,
        provider_id = COALESCE(?, provider_id),
        model_id = COALESCE(?, model_id),
        duration_ms = ?,
        updated_at = now()
       WHERE id = ? AND session_id = ? AND user_id = ?`,
    )
    .run(
      input.content ?? null,
      input.status ?? null,
      input.errorMessage ?? null,
      input.finishReason ?? null,
      input.usage ? JSON.stringify(input.usage) : null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.providerId ?? null,
      input.modelId ?? null,
      input.durationMs ?? null,
      input.id,
      input.sessionId,
      input.userId,
    );
}

export async function supersedeAiChatMessage(input: {
  id: number;
  sessionId: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient
    .prepare(
      `UPDATE sys_ai_chat_message SET status = 'superseded', updated_at = now()
       WHERE id = ? AND session_id = ? AND user_id = ? AND role = 'assistant'`,
    )
    .run(input.id, input.sessionId, input.userId);
}

export async function getAiChatMessage(input: {
  id: number;
  sessionId: number;
  userId: number;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  return (await dbClient
    .prepare(
      `SELECT id, session_id AS "sessionId", user_id AS "userId", role, content, status,
        error_message AS "errorMessage", parent_message_id AS "parentMessageId",
        regenerated_from_id AS "regeneratedFromId", finish_reason AS "finishReason",
        usage_json AS "usageJson", metadata_json AS "metadataJson", provider_id AS "providerId",
        model_id AS "modelId", duration_ms AS "durationMs", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM sys_ai_chat_message WHERE id = ? AND session_id = ? AND user_id = ?`,
    )
    .get(input.id, input.sessionId, input.userId)) as AiChatMessageRow | undefined;
}

export function toRuntimeMessages(messages: AiChatMessageRow[]): AiRuntimeMessage[] {
  return messages.filter((message) => message.status === "completed" || message.status === "stopped").map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export async function refreshAiChatSessionSummary(input: {
  sessionId: number;
  userId: number;
  title?: string;
  runtime?: AiRuntimePublicConfig | null;
  usage?: Record<string, unknown> | null;
  contextSummary?: string | null;
  compactedThroughMessageId?: number | null;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const titleSql = input.title ? "title = ?," : "";
  const titleValues = input.title ? [normalizeTitle(input.title)] : [];
  await dbClient
    .prepare(
      `UPDATE sys_ai_chat_session
       SET
        ${titleSql}
        provider_id = COALESCE(?, provider_id),
        model_id = COALESCE(?, model_id),
        provider_code = COALESCE(?, provider_code),
        model_name = COALESCE(?, model_name),
        model_identifier = COALESCE(?, model_identifier),
        context_summary = COALESCE(?, context_summary),
        compacted_through_message_id = COALESCE(?, compacted_through_message_id),
        total_input_tokens = total_input_tokens + ?,
        total_output_tokens = total_output_tokens + ?,
        message_count = (
          SELECT COUNT(1)::int FROM sys_ai_chat_message WHERE session_id = ? AND status <> 'superseded'
        ),
        last_message_at = now(),
        updated_by = ?,
        updated_at = now()
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .run(
      ...titleValues,
      input.runtime?.provider.id ?? null,
      input.runtime?.model.id ?? null,
      input.runtime?.provider.code ?? null,
      input.runtime?.model.name ?? null,
      input.runtime?.model.modelId ?? null,
      input.contextSummary ?? null,
      input.compactedThroughMessageId ?? null,
      Number(input.usage?.inputTokens ?? input.usage?.promptTokens ?? 0),
      Number(input.usage?.outputTokens ?? input.usage?.completionTokens ?? 0),
      input.sessionId,
      input.userId,
      input.sessionId,
      input.userId,
    );
}
