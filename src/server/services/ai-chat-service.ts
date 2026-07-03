import { sqlite, type DbClient } from "@/server/db";
import type { AiRuntimeMessage, AiRuntimePublicConfig } from "./ai-runtime-service";

export type AiChatSessionRow = {
  id: number;
  userId: number;
  title: string;
  providerId: number | null;
  modelId: number | null;
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
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const result = await dbClient
    .prepare(
      `INSERT INTO sys_ai_chat_session
        (user_id, title, status, created_by, updated_by, created_at, updated_at)
       VALUES
        (?, ?, 1, ?, ?, now(), now())
       RETURNING id`,
    )
    .run(input.userId, normalizeTitle(input.title), input.userId, input.userId);
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
  title: string;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  await dbClient
    .prepare(
      `UPDATE sys_ai_chat_session
       SET title = ?, updated_by = ?, updated_at = now()
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .run(normalizeTitle(input.title), input.userId, input.id, input.userId);
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
  return (await dbClient
    .prepare(
      `SELECT
        id,
        session_id AS "sessionId",
        user_id AS "userId",
        role,
        content,
        finish_reason AS "finishReason",
        usage_json AS "usageJson",
        metadata_json AS "metadataJson",
        provider_id AS "providerId",
        model_id AS "modelId",
        duration_ms AS "durationMs",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
       FROM sys_ai_chat_message
       WHERE session_id = ? AND user_id = ?
       ORDER BY id ASC`,
    )
    .all(input.sessionId, input.userId)) as AiChatMessageRow[];
}

export async function appendAiChatMessage(input: {
  sessionId: number;
  userId: number;
  role: "system" | "user" | "assistant";
  content: string;
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
        (session_id, user_id, role, content, provider_id, model_id, finish_reason, usage_json,
         metadata_json, duration_ms, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now(), now())
       RETURNING id`,
    )
    .run(
      input.sessionId,
      input.userId,
      input.role,
      input.content,
      input.providerId ?? null,
      input.modelId ?? null,
      input.finishReason ?? null,
      input.usage ? JSON.stringify(input.usage) : null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.durationMs ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function toRuntimeMessages(messages: AiChatMessageRow[]): AiRuntimeMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

export async function refreshAiChatSessionSummary(input: {
  sessionId: number;
  userId: number;
  title?: string;
  runtime?: AiRuntimePublicConfig | null;
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
        provider_id = ?,
        model_id = ?,
        provider_code = ?,
        model_name = ?,
        model_identifier = ?,
        message_count = (
          SELECT COUNT(1)::int FROM sys_ai_chat_message WHERE session_id = ?
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
      input.sessionId,
      input.userId,
      input.sessionId,
      input.userId,
    );
}
