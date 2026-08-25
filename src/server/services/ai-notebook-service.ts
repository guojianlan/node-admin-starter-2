import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import type { AdminUserContext } from "@/server/context";
import { sqlite } from "@/server/db";
import { askKnowledge } from "./ai-knowledge-service";
import { classifyAiError } from "./ai-reliability-service";
import { resolveDataScopeForUser, type ResolvedDataScope } from "./data-scope";

export type AiNotebookScopeType = "global" | "department" | "user";
export type AiNotebookSourceType = "knowledge_base" | "document";
export type AiNotebookArtifactType = "summary" | "outline" | "faq" | "brief";

export type AiNotebookInput = {
  name: string;
  description?: string | null;
  scopeType: AiNotebookScopeType;
  deptId?: number | null;
  defaultModelId?: number | null;
  systemPrompt?: string | null;
  status?: number;
  sort?: number;
};

type AiNotebookRow = {
  id: number;
  name: string;
  description: string | null;
  scopeType: AiNotebookScopeType;
  deptId: number | null;
  ownerId: number | null;
  defaultModelId: number | null;
  systemPrompt: string | null;
  status: number;
  sort: number;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
};

type NotebookSourceSnapshot = {
  sourceId: number;
  sourceType: AiNotebookSourceType;
  knowledgeBaseId: number;
  knowledgeBaseName: string;
  documentId: number;
  documentName: string;
  fileId: number;
  sha256: string;
  version: number;
};

type NotebookArtifactRow = {
  id: number;
  notebookId: number;
  artifactType: AiNotebookArtifactType;
  title: string;
  promptText: string;
  promptHash: string;
  content: string | null;
  status: "generating" | "completed" | "failed";
  version: number;
  ragRunId: number | null;
  invocationId: number | null;
  modelId: number | null;
  sourceSnapshotJson: string;
  citationsJson: string;
  errorMessage: string | null;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

function notebookVisibilityClause(scope: ResolvedDataScope, alias = "nb") {
  if (scope.kind === "all") return { sql: "1 = 1", params: [] as number[] };
  const conditions = [
    `${alias}.scope_type = 'global'`,
    `${alias}.owner_id = ?`,
    `EXISTS (SELECT 1 FROM sys_ai_notebook_member member
      WHERE member.notebook_id = ${alias}.id AND member.user_id = ?)`,
  ];
  const params = [scope.userId, scope.userId];
  if (scope.deptIds.length) {
    conditions.push(`${alias}.dept_id IN (${placeholders(scope.deptIds)})`);
    params.push(...scope.deptIds);
  }
  return { sql: `(${conditions.join(" OR ")})`, params };
}

function knowledgeVisibilityClause(scope: ResolvedDataScope, alias = "kb") {
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
  payload: AiNotebookInput,
  user: AdminUserContext,
  scope: ResolvedDataScope,
) {
  if (payload.scopeType === "global") return { deptId: null, ownerId: null };
  if (payload.scopeType === "user") return { deptId: null, ownerId: user.id };
  const deptId = Number(payload.deptId ?? user.deptId ?? 0);
  if (!deptId) throw new HTTPException(400, { message: "部门 Notebook 必须选择归属部门" });
  if (scope.kind !== "all" && !scope.deptIds.includes(deptId)) {
    throw new HTTPException(403, { message: "不能为数据权限范围外的部门创建 Notebook" });
  }
  return { deptId, ownerId: null };
}

async function validateDefaultModel(modelId?: number | null) {
  if (!modelId) return null;
  const model = await sqlite
    .prepare(
      `SELECT model.id FROM sys_ai_model model
       INNER JOIN sys_ai_provider provider ON provider.id = model.provider_id
       WHERE model.id = ? AND model.deleted_at IS NULL AND model.status = 1
         AND model.model_type = 'chat' AND provider.deleted_at IS NULL AND provider.status = 1`,
    )
    .get(modelId);
  if (!model) {
    throw new HTTPException(400, { message: "默认模型不存在、未启用或不是 Chat 模型" });
  }
  return modelId;
}

export async function listAiNotebooks(input: {
  userId: number;
  keyword?: string;
  status?: number;
}) {
  const scope = await resolveDataScopeForUser(input.userId);
  const visibility = notebookVisibilityClause(scope);
  const filters = ["nb.deleted_at IS NULL", visibility.sql];
  const params: Array<string | number> = [...visibility.params];
  const keyword = input.keyword?.trim();
  if (keyword) {
    filters.push("(nb.name ILIKE ? OR COALESCE(nb.description, '') ILIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (input.status != null) {
    filters.push("nb.status = ?");
    params.push(input.status);
  }
  return sqlite
    .prepare(
      `SELECT nb.id, nb.name, nb.description, nb.scope_type AS "scopeType",
        nb.dept_id AS "deptId", dept.name AS "deptName", nb.owner_id AS "ownerId",
        owner.nickname AS "ownerName", nb.default_model_id AS "defaultModelId",
        model.name AS "defaultModelName", nb.system_prompt AS "systemPrompt",
        nb.status, nb.sort, nb.created_at AS "createdAt", nb.updated_at AS "updatedAt",
        COUNT(DISTINCT source.id) FILTER (WHERE source.deleted_at IS NULL)::int AS "sourceCount",
        COUNT(DISTINCT artifact.id) FILTER (WHERE artifact.deleted_at IS NULL)::int AS "artifactCount"
       FROM sys_ai_notebook nb
       LEFT JOIN sys_dept dept ON dept.id = nb.dept_id
       LEFT JOIN sys_user owner ON owner.id = nb.owner_id
       LEFT JOIN sys_ai_model model ON model.id = nb.default_model_id
       LEFT JOIN sys_ai_notebook_source source ON source.notebook_id = nb.id
       LEFT JOIN sys_ai_notebook_artifact artifact ON artifact.notebook_id = nb.id
       WHERE ${filters.join(" AND ")}
       GROUP BY nb.id, dept.name, owner.nickname, model.name
       ORDER BY nb.sort ASC, nb.id DESC`,
    )
    .all(...params);
}

export async function getAiNotebookOptions(userId: number) {
  const scope = await resolveDataScopeForUser(userId);
  const departmentFilter =
    scope.kind === "all"
      ? "1 = 1"
      : scope.deptIds.length
        ? `dept.id IN (${placeholders(scope.deptIds)})`
        : "1 = 0";
  const models = await sqlite
    .prepare(
      `SELECT model.id, model.name, model.model_id AS "modelId",
        provider.name AS "providerName", provider.code AS "providerCode"
       FROM sys_ai_model model
       INNER JOIN sys_ai_provider provider ON provider.id = model.provider_id
       WHERE model.deleted_at IS NULL AND model.status = 1 AND model.model_type = 'chat'
         AND provider.deleted_at IS NULL AND provider.status = 1
       ORDER BY model.is_default_chat DESC, model.sort ASC, model.id DESC`,
    )
    .all();
  const departments = await sqlite
    .prepare(
      `SELECT dept.id, dept.name FROM sys_dept dept
       WHERE dept.deleted_at IS NULL AND dept.status = 1 AND ${departmentFilter}
       ORDER BY dept.sort ASC, dept.id ASC`,
    )
    .all();
  const users = await sqlite
    .prepare(
      `SELECT id, username, nickname FROM sys_user
       WHERE deleted_at IS NULL AND status = 1 ORDER BY id ASC`,
    )
    .all();
  return { models, departments, users };
}

export async function listAiNotebookSourceOptions(input: {
  userId: number;
  sourceType: AiNotebookSourceType;
  knowledgeBaseId?: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  const scope = await resolveDataScopeForUser(input.userId);
  const visibility = knowledgeVisibilityClause(scope);
  const page = Math.max(1, Math.round(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.round(input.pageSize ?? 50)));
  const keyword = input.keyword?.trim();
  if (input.sourceType === "knowledge_base") {
    const filters = ["kb.deleted_at IS NULL", "kb.status = 1", visibility.sql];
    const params: Array<string | number> = [...visibility.params];
    if (keyword) {
      filters.push("(kb.name ILIKE ? OR kb.code ILIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const count = (await sqlite
      .prepare(
        `SELECT COUNT(*)::int AS total FROM sys_ai_knowledge_base kb WHERE ${filters.join(" AND ")}`,
      )
      .get(...params)) as { total: number };
    const data = await sqlite
      .prepare(
        `SELECT kb.id, kb.name, kb.code, kb.scope_type AS "scopeType",
          COUNT(doc.id) FILTER (WHERE doc.deleted_at IS NULL AND doc.status = 'ready')::int
            AS "readyDocumentCount"
         FROM sys_ai_knowledge_base kb
         LEFT JOIN sys_ai_document doc ON doc.knowledge_base_id = kb.id
         WHERE ${filters.join(" AND ")}
         GROUP BY kb.id ORDER BY kb.sort ASC, kb.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize);
    return { data, page, pageSize, total: Number(count.total) };
  }

  if (!input.knowledgeBaseId) {
    throw new HTTPException(400, { message: "选择知识文档前必须指定知识库" });
  }
  const filters = [
    "doc.deleted_at IS NULL",
    "doc.status = 'ready'",
    "kb.deleted_at IS NULL",
    "kb.status = 1",
    "kb.id = ?",
    visibility.sql,
  ];
  const params: Array<string | number> = [input.knowledgeBaseId, ...visibility.params];
  if (keyword) {
    filters.push("doc.name ILIKE ?");
    params.push(`%${keyword}%`);
  }
  const count = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total FROM sys_ai_document doc
       INNER JOIN sys_ai_knowledge_base kb ON kb.id = doc.knowledge_base_id
       WHERE ${filters.join(" AND ")}`,
    )
    .get(...params)) as { total: number };
  const data = await sqlite
    .prepare(
      `SELECT doc.id, doc.name, doc.version, doc.file_id AS "fileId",
        kb.id AS "knowledgeBaseId", kb.name AS "knowledgeBaseName"
       FROM sys_ai_document doc
       INNER JOIN sys_ai_knowledge_base kb ON kb.id = doc.knowledge_base_id
       WHERE ${filters.join(" AND ")}
       ORDER BY doc.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize);
  return { data, page, pageSize, total: Number(count.total) };
}

export async function getVisibleAiNotebook(id: number, userId: number, requireEnabled = false) {
  const scope = await resolveDataScopeForUser(userId);
  const visibility = notebookVisibilityClause(scope);
  return (await sqlite
    .prepare(
      `SELECT nb.id, nb.name, nb.description, nb.scope_type AS "scopeType",
        nb.dept_id AS "deptId", nb.owner_id AS "ownerId",
        nb.default_model_id AS "defaultModelId", nb.system_prompt AS "systemPrompt",
        nb.status, nb.sort, nb.created_by AS "createdBy",
        nb.created_at AS "createdAt", nb.updated_at AS "updatedAt"
       FROM sys_ai_notebook nb
       WHERE nb.id = ? AND nb.deleted_at IS NULL AND ${visibility.sql}
         ${requireEnabled ? "AND nb.status = 1" : ""}`,
    )
    .get(id, ...visibility.params)) as AiNotebookRow | undefined;
}

async function requireNotebookRole(
  notebookId: number,
  userId: number,
  required: "viewer" | "editor" | "owner",
) {
  const notebook = await getVisibleAiNotebook(notebookId, userId, required === "viewer");
  if (!notebook) throw new HTTPException(404, { message: "Notebook 不存在或无权访问" });
  const scope = await resolveDataScopeForUser(userId);
  if (scope.kind === "all" || notebook.ownerId === userId || notebook.createdBy === userId) {
    return { notebook, role: "owner" as const };
  }
  const member = (await sqlite
    .prepare("SELECT role FROM sys_ai_notebook_member WHERE notebook_id = ? AND user_id = ?")
    .get(notebookId, userId)) as { role: "viewer" | "editor" } | undefined;
  const role = member?.role ?? "viewer";
  if (required === "owner" || (required === "editor" && role !== "editor")) {
    throw new HTTPException(403, {
      message: `Notebook 需要${required === "owner" ? "所有者" : "编辑者"}权限`,
    });
  }
  return { notebook, role };
}

export async function prepareAiNotebookWebsiteImport(input: {
  notebookId: number;
  userId: number;
}) {
  const { notebook } = await requireNotebookRole(input.notebookId, input.userId, "editor");
  const existing = (await sqlite
    .prepare(
      `SELECT id FROM sys_ai_knowledge_base
       WHERE managed_type = 'notebook' AND managed_resource_id = ? AND deleted_at IS NULL`,
    )
    .get(input.notebookId)) as { id: number } | undefined;
  if (existing) return { notebook, knowledgeBaseId: existing.id };

  const code = `notebook-${input.notebookId}-sources`;
  const inserted = await sqlite
    .prepare(
      `INSERT INTO sys_ai_knowledge_base
       (name, code, description, scope_type, dept_id, owner_id, chunk_preset,
        managed_type, managed_resource_id, status, sort, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 'documentation', 'notebook', ?, 1, 0, ?, ?)
       ON CONFLICT (managed_type, managed_resource_id)
         WHERE managed_type IS NOT NULL AND deleted_at IS NULL
       DO UPDATE SET updated_at = now()
       RETURNING id`,
    )
    .run(
      `${notebook.name} · Notebook 上传`,
      code,
      "由 Notebook 上传文件和网站来源自动维护。",
      notebook.scopeType,
      notebook.deptId,
      notebook.ownerId,
      input.notebookId,
      input.userId,
      input.userId,
    );
  return { notebook, knowledgeBaseId: Number(inserted.lastInsertRowid) };
}

export async function assertAiNotebookWebsiteImportAccess(input: {
  notebookId: number;
  userId: number;
}) {
  await requireNotebookRole(input.notebookId, input.userId, "editor");
}

export async function listAiNotebookMembers(input: { notebookId: number; userId: number }) {
  await requireNotebookRole(input.notebookId, input.userId, "viewer");
  return sqlite
    .prepare(
      `SELECT member.user_id AS "userId", user_account.username, user_account.nickname,
       member.role, member.created_at AS "createdAt"
       FROM sys_ai_notebook_member member
       INNER JOIN sys_user user_account ON user_account.id = member.user_id
       WHERE member.notebook_id = ? ORDER BY member.created_at ASC`,
    )
    .all(input.notebookId);
}

export async function saveAiNotebookMember(input: {
  notebookId: number;
  userId: number;
  memberUserId: number;
  role: "viewer" | "editor";
}) {
  const access = await requireNotebookRole(input.notebookId, input.userId, "owner");
  if (access.notebook.ownerId === input.memberUserId) {
    throw new HTTPException(409, { message: "Notebook 所有者不需要重复添加为成员" });
  }
  const user = await sqlite
    .prepare("SELECT id FROM sys_user WHERE id = ? AND deleted_at IS NULL AND status = 1")
    .get(input.memberUserId);
  if (!user) throw new HTTPException(404, { message: "协作用户不存在或已停用" });
  await sqlite
    .prepare(
      `INSERT INTO sys_ai_notebook_member (notebook_id, user_id, role, created_by)
       VALUES (?, ?, ?, ?) ON CONFLICT (notebook_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    )
    .run(input.notebookId, input.memberUserId, input.role, input.userId);
}

export async function removeAiNotebookMember(input: {
  notebookId: number;
  userId: number;
  memberUserId: number;
}) {
  await requireNotebookRole(input.notebookId, input.userId, "owner");
  await sqlite
    .prepare("DELETE FROM sys_ai_notebook_member WHERE notebook_id = ? AND user_id = ?")
    .run(input.notebookId, input.memberUserId);
}

export async function createAiNotebook(input: {
  payload: AiNotebookInput;
  user: AdminUserContext;
}) {
  const scope = await resolveDataScopeForUser(input.user.id);
  const ownership = resolveOwnedScope(input.payload, input.user, scope);
  const defaultModelId = await validateDefaultModel(input.payload.defaultModelId);
  const result = await sqlite
    .prepare(
      `INSERT INTO sys_ai_notebook
       (name, description, scope_type, dept_id, owner_id, default_model_id, system_prompt,
        status, sort, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      input.payload.name.trim(),
      input.payload.description?.trim() || null,
      input.payload.scopeType,
      ownership.deptId,
      ownership.ownerId,
      defaultModelId,
      input.payload.systemPrompt?.trim() || null,
      input.payload.status ?? 1,
      input.payload.sort ?? 0,
      input.user.id,
      input.user.id,
    );
  return Number(result.lastInsertRowid);
}

export async function updateAiNotebook(input: {
  id: number;
  payload: AiNotebookInput;
  user: AdminUserContext;
}) {
  const { notebook: current } = await requireNotebookRole(input.id, input.user.id, "owner");
  const scope = await resolveDataScopeForUser(input.user.id);
  const ownership = resolveOwnedScope(input.payload, input.user, scope);
  const defaultModelId = await validateDefaultModel(input.payload.defaultModelId);
  await sqlite
    .prepare(
      `UPDATE sys_ai_notebook
       SET name = ?, description = ?, scope_type = ?, dept_id = ?, owner_id = ?,
           default_model_id = ?, system_prompt = ?, status = ?, sort = ?, updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      input.payload.name.trim(),
      input.payload.description?.trim() || null,
      input.payload.scopeType,
      ownership.deptId,
      ownership.ownerId,
      defaultModelId,
      input.payload.systemPrompt?.trim() || null,
      input.payload.status ?? current.status,
      input.payload.sort ?? current.sort,
      input.user.id,
      input.id,
    );
}

export async function deleteAiNotebook(input: { id: number; userId: number }) {
  await requireNotebookRole(input.id, input.userId, "owner");
  await sqlite
    .prepare(
      `UPDATE sys_ai_notebook
       SET deleted_at = now(), deleted_by = ?, updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(input.userId, input.userId, input.id);
}

export async function listAiNotebookSources(input: { notebookId: number; userId: number }) {
  await requireNotebookRole(input.notebookId, input.userId, "viewer");
  const scope = await resolveDataScopeForUser(input.userId);
  const visibility = knowledgeVisibilityClause(scope);
  return sqlite
    .prepare(
      `SELECT source.id, source.source_type AS "sourceType",
        COALESCE(source.knowledge_base_id, doc.knowledge_base_id) AS "knowledgeBaseId",
        kb.name AS "knowledgeBaseName", source.document_id AS "documentId", doc.name AS "documentName",
        doc.file_id AS "fileId", doc.version AS "documentVersion", doc.status AS "documentStatus",
        doc.source_type AS "contentSourceType", doc.source_url AS "sourceUrl",
        doc.canonical_url AS "canonicalUrl", doc.source_domain AS "sourceDomain",
        doc.source_title AS "sourceTitle", doc.published_at AS "publishedAt",
        doc.fetched_at AS "fetchedAt",
        source.created_at AS "createdAt"
       FROM sys_ai_notebook_source source
       LEFT JOIN sys_ai_document doc ON doc.id = source.document_id AND doc.deleted_at IS NULL
       INNER JOIN sys_ai_knowledge_base kb
         ON kb.id = COALESCE(source.knowledge_base_id, doc.knowledge_base_id)
       WHERE source.notebook_id = ? AND source.deleted_at IS NULL
         AND kb.deleted_at IS NULL AND ${visibility.sql}
       ORDER BY source.id DESC`,
    )
    .all(input.notebookId, ...visibility.params);
}

async function resolveVisibleSource(input: {
  sourceType: AiNotebookSourceType;
  targetId: number;
  userId: number;
}) {
  const scope = await resolveDataScopeForUser(input.userId);
  const visibility = knowledgeVisibilityClause(scope);
  if (input.sourceType === "knowledge_base") {
    const base = (await sqlite
      .prepare(
        `SELECT kb.id, kb.name FROM sys_ai_knowledge_base kb
         WHERE kb.id = ? AND kb.deleted_at IS NULL AND kb.status = 1 AND ${visibility.sql}`,
      )
      .get(input.targetId, ...visibility.params)) as { id: number; name: string } | undefined;
    if (!base) throw new HTTPException(404, { message: "知识库不存在、未启用或无权访问" });
    return { knowledgeBaseId: base.id, documentId: null };
  }
  const document = (await sqlite
    .prepare(
      `SELECT doc.id, doc.knowledge_base_id AS "knowledgeBaseId"
       FROM sys_ai_document doc
       INNER JOIN sys_ai_knowledge_base kb ON kb.id = doc.knowledge_base_id
       WHERE doc.id = ? AND doc.deleted_at IS NULL AND doc.status = 'ready'
         AND kb.deleted_at IS NULL AND kb.status = 1 AND ${visibility.sql}`,
    )
    .get(input.targetId, ...visibility.params)) as
    | { id: number; knowledgeBaseId: number }
    | undefined;
  if (!document) throw new HTTPException(404, { message: "知识文档不存在、未就绪或无权访问" });
  return { knowledgeBaseId: null, documentId: document.id };
}

export async function addAiNotebookSource(input: {
  notebookId: number;
  sourceType: AiNotebookSourceType;
  targetId: number;
  userId: number;
}) {
  await requireNotebookRole(input.notebookId, input.userId, "editor");
  const target = await resolveVisibleSource(input);
  const duplicate = await sqlite
    .prepare(
      `SELECT id FROM sys_ai_notebook_source
       WHERE notebook_id = ? AND source_type = ? AND deleted_at IS NULL
         AND COALESCE(knowledge_base_id, 0) = COALESCE(?, 0)
         AND COALESCE(document_id, 0) = COALESCE(?, 0)`,
    )
    .get(input.notebookId, input.sourceType, target.knowledgeBaseId, target.documentId);
  if (duplicate) throw new HTTPException(409, { message: "该来源已经加入 Notebook" });

  const redundant =
    input.sourceType === "document"
      ? await sqlite
          .prepare(
            `SELECT source.id FROM sys_ai_notebook_source source
             INNER JOIN sys_ai_document doc ON doc.id = ?
             WHERE source.notebook_id = ? AND source.deleted_at IS NULL
               AND source.source_type = 'knowledge_base'
               AND source.knowledge_base_id = doc.knowledge_base_id`,
          )
          .get(input.targetId, input.notebookId)
      : await sqlite
          .prepare(
            `SELECT source.id FROM sys_ai_notebook_source source
             INNER JOIN sys_ai_document doc ON doc.id = source.document_id
             WHERE source.notebook_id = ? AND source.deleted_at IS NULL
               AND source.source_type = 'document' AND doc.knowledge_base_id = ?`,
          )
          .get(input.notebookId, input.targetId);
  if (redundant) {
    throw new HTTPException(409, { message: "该来源已被同一知识库来源覆盖，请避免重复添加" });
  }

  const result = await sqlite
    .prepare(
      `INSERT INTO sys_ai_notebook_source
       (notebook_id, source_type, knowledge_base_id, document_id, created_by)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      input.notebookId,
      input.sourceType,
      target.knowledgeBaseId,
      target.documentId,
      input.userId,
    );
  return Number(result.lastInsertRowid);
}

export async function removeAiNotebookSource(input: {
  notebookId: number;
  sourceId: number;
  userId: number;
}) {
  await requireNotebookRole(input.notebookId, input.userId, "editor");
  const source = await sqlite
    .prepare(
      `SELECT id FROM sys_ai_notebook_source
       WHERE id = ? AND notebook_id = ? AND deleted_at IS NULL`,
    )
    .get(input.sourceId, input.notebookId);
  if (!source) throw new HTTPException(404, { message: "Notebook 来源不存在" });
  await sqlite
    .prepare(
      `UPDATE sys_ai_notebook_source SET deleted_at = now(), deleted_by = ?
       WHERE id = ? AND notebook_id = ? AND deleted_at IS NULL`,
    )
    .run(input.userId, input.sourceId, input.notebookId);
}

async function resolveNotebookSourceContext(notebookId: number, userId: number) {
  const scope = await resolveDataScopeForUser(userId);
  const visibility = knowledgeVisibilityClause(scope);
  const sources = (await sqlite
    .prepare(
      `SELECT source.id, source.source_type AS "sourceType", source.knowledge_base_id AS "knowledgeBaseId",
        source.document_id AS "documentId"
       FROM sys_ai_notebook_source source
       LEFT JOIN sys_ai_document source_doc ON source_doc.id = source.document_id
       INNER JOIN sys_ai_knowledge_base kb
         ON kb.id = COALESCE(source.knowledge_base_id, source_doc.knowledge_base_id)
       WHERE source.notebook_id = ? AND source.deleted_at IS NULL
         AND kb.deleted_at IS NULL AND kb.status = 1 AND ${visibility.sql}`,
    )
    .all(notebookId, ...visibility.params)) as Array<{
    id: number;
    sourceType: AiNotebookSourceType;
    knowledgeBaseId: number | null;
    documentId: number | null;
  }>;
  const knowledgeBaseIds = sources.flatMap((source) =>
    source.sourceType === "knowledge_base" && source.knowledgeBaseId
      ? [source.knowledgeBaseId]
      : [],
  );
  const documentIds = sources.flatMap((source) =>
    source.sourceType === "document" && source.documentId ? [source.documentId] : [],
  );
  if (!knowledgeBaseIds.length && !documentIds.length) {
    throw new HTTPException(409, { message: "请先为 Notebook 添加可用来源" });
  }

  const sourceFilters: string[] = [];
  const params: Array<string | number> = [];
  if (knowledgeBaseIds.length) {
    sourceFilters.push(`kb.id IN (${placeholders(knowledgeBaseIds)})`);
    params.push(...knowledgeBaseIds);
  }
  if (documentIds.length) {
    sourceFilters.push(`doc.id IN (${placeholders(documentIds)})`);
    params.push(...documentIds);
  }
  const documents = (await sqlite
    .prepare(
      `SELECT doc.id AS "documentId", doc.name AS "documentName", doc.file_id AS "fileId",
        doc.sha256, doc.version, kb.id AS "knowledgeBaseId", kb.name AS "knowledgeBaseName"
       FROM sys_ai_document doc
       INNER JOIN sys_ai_knowledge_base kb ON kb.id = doc.knowledge_base_id
       WHERE doc.deleted_at IS NULL AND doc.status = 'ready' AND kb.deleted_at IS NULL
         AND kb.status = 1 AND (${sourceFilters.join(" OR ")}) AND ${visibility.sql}
       ORDER BY kb.id, doc.id`,
    )
    .all(...params, ...visibility.params)) as Array<
    Omit<NotebookSourceSnapshot, "sourceId" | "sourceType">
  >;
  if (!documents.length) {
    throw new HTTPException(409, { message: "Notebook 来源中没有已完成索引的可用文档" });
  }
  const sourceByBase = new Map(
    sources
      .filter((source) => source.sourceType === "knowledge_base")
      .map((source) => [source.knowledgeBaseId, source]),
  );
  const sourceByDocument = new Map(
    sources
      .filter((source) => source.sourceType === "document")
      .map((source) => [source.documentId, source]),
  );
  const snapshot = documents.map((document) => {
    const explicit = sourceByDocument.get(document.documentId);
    const source = explicit ?? sourceByBase.get(document.knowledgeBaseId)!;
    return {
      ...document,
      sourceId: source.id,
      sourceType: source.sourceType,
    } satisfies NotebookSourceSnapshot;
  });
  return {
    knowledgeBaseIds: [...new Set(knowledgeBaseIds)],
    documentIds: [...new Set(documentIds)],
    snapshot,
  };
}

export async function askAiNotebook(input: {
  notebookId: number;
  query: string;
  userId: number;
  requestId?: string | null;
  modelId?: number | null;
}) {
  const notebook = await getVisibleAiNotebook(input.notebookId, input.userId, true);
  if (!notebook) throw new HTTPException(404, { message: "Notebook 不存在、未启用或无权访问" });
  const sources = await resolveNotebookSourceContext(input.notebookId, input.userId);
  const modelId = input.modelId ?? notebook.defaultModelId;
  if (modelId) await validateDefaultModel(modelId);
  const result = await askKnowledge({
    query: input.query,
    knowledgeBaseIds: sources.knowledgeBaseIds,
    documentIds: sources.documentIds,
    userId: input.userId,
    requestId: input.requestId,
    modelId,
    systemPrompt: notebook.systemPrompt,
    traceSourceType: "notebook_ask",
    traceSourceId: input.notebookId,
  });
  return { ...result, sourceSnapshot: sources.snapshot };
}

function artifactPrompt(type: AiNotebookArtifactType, customPrompt?: string | null) {
  if (type === "summary") return "请基于全部可用来源生成一份结构清晰、带引用的综合摘要。";
  if (type === "outline") return "请基于全部可用来源生成分层提纲，并在关键节点标注引用。";
  if (type === "faq") return "请基于全部可用来源生成常见问题与答案，每个答案必须标注引用。";
  const prompt = customPrompt?.trim();
  if (!prompt) throw new HTTPException(400, { message: "自定义简报必须填写生成要求" });
  return `请基于全部可用来源生成自定义结构化简报。具体要求：${prompt}`;
}

function parseArtifact(row: NotebookArtifactRow) {
  return {
    ...row,
    sourceSnapshot: JSON.parse(row.sourceSnapshotJson) as unknown[],
    citations: JSON.parse(row.citationsJson) as unknown[],
  };
}

export async function listAiNotebookArtifacts(input: {
  notebookId: number;
  userId: number;
  page?: number;
  pageSize?: number;
}) {
  const notebook = await getVisibleAiNotebook(input.notebookId, input.userId);
  if (!notebook) throw new HTTPException(404, { message: "Notebook 不存在或无权访问" });
  const page = Math.max(1, Math.round(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.round(input.pageSize ?? 10)));
  const count = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total FROM sys_ai_notebook_artifact
       WHERE notebook_id = ? AND deleted_at IS NULL`,
    )
    .get(input.notebookId)) as { total: number };
  const rows = (await sqlite
    .prepare(
      `SELECT id, notebook_id AS "notebookId", artifact_type AS "artifactType", title,
        prompt_text AS "promptText", prompt_hash AS "promptHash", content, status, version,
        rag_run_id AS "ragRunId", invocation_id AS "invocationId", model_id AS "modelId",
        source_snapshot_json AS "sourceSnapshotJson", citations_json AS "citationsJson",
        error_message AS "errorMessage", generated_at AS "generatedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM sys_ai_notebook_artifact
       WHERE notebook_id = ? AND deleted_at IS NULL
       ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(input.notebookId, pageSize, (page - 1) * pageSize)) as NotebookArtifactRow[];
  return { data: rows.map(parseArtifact), page, pageSize, total: Number(count.total) };
}

async function getVisibleArtifact(id: number, userId: number) {
  const scope = await resolveDataScopeForUser(userId);
  const visibility = notebookVisibilityClause(scope);
  return (await sqlite
    .prepare(
      `SELECT artifact.id, artifact.notebook_id AS "notebookId",
        artifact.artifact_type AS "artifactType", artifact.title,
        artifact.prompt_text AS "promptText", artifact.prompt_hash AS "promptHash",
        artifact.content, artifact.status, artifact.version,
        artifact.rag_run_id AS "ragRunId", artifact.invocation_id AS "invocationId",
        artifact.model_id AS "modelId", artifact.source_snapshot_json AS "sourceSnapshotJson",
        artifact.citations_json AS "citationsJson", artifact.error_message AS "errorMessage",
        artifact.generated_at AS "generatedAt", artifact.created_at AS "createdAt",
        artifact.updated_at AS "updatedAt"
       FROM sys_ai_notebook_artifact artifact
       INNER JOIN sys_ai_notebook nb ON nb.id = artifact.notebook_id
       WHERE artifact.id = ? AND artifact.deleted_at IS NULL AND nb.deleted_at IS NULL
         AND ${visibility.sql}`,
    )
    .get(id, ...visibility.params)) as NotebookArtifactRow | undefined;
}

async function generateArtifact(input: {
  notebook: AiNotebookRow;
  artifactId: number;
  prompt: string;
  sourceContext: Awaited<ReturnType<typeof resolveNotebookSourceContext>>;
  userId: number;
  requestId?: string | null;
  traceSourceType?: string;
}) {
  try {
    const result = await askKnowledge({
      query: input.prompt,
      knowledgeBaseIds: input.sourceContext.knowledgeBaseIds,
      documentIds: input.sourceContext.documentIds,
      userId: input.userId,
      requestId: input.requestId,
      modelId: input.notebook.defaultModelId,
      systemPrompt: input.notebook.systemPrompt,
      traceSourceType: input.traceSourceType ?? "notebook_artifact",
      traceSourceId: input.artifactId,
    });
    if (result.insufficientEvidence) {
      throw new HTTPException(409, { message: "当前来源证据不足，无法生成 Artifact" });
    }
    const citations = result.citations.map((citation) => ({
      chunkId: citation.chunkId,
      documentId: citation.documentId,
      knowledgeBaseId: citation.knowledgeBaseId,
      documentName: citation.documentName,
      fileId: citation.fileId,
      chunkNo: citation.chunkNo,
      pageNumber: citation.pageNumber,
      paragraphStart: citation.paragraphStart,
      paragraphEnd: citation.paragraphEnd,
      quote: citation.content.slice(0, 1000),
      score: citation.score,
    }));
    await sqlite
      .prepare(
        `UPDATE sys_ai_notebook_artifact
         SET content = ?, status = 'completed', rag_run_id = ?, invocation_id = ?, model_id = ?,
             citations_json = ?, error_message = NULL, generated_at = now(), updated_by = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(
        result.answer,
        result.runId,
        result.invocationId,
        result.modelId,
        JSON.stringify(citations),
        input.userId,
        input.artifactId,
      );
    return { id: input.artifactId, ...result, citations };
  } catch (error) {
    const classified = classifyAiError(error);
    await sqlite
      .prepare(
        `UPDATE sys_ai_notebook_artifact
         SET status = 'failed', error_message = ?, updated_by = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(classified.message, input.userId, input.artifactId);
    throw error;
  }
}

export async function createAiNotebookResearchArtifact(input: {
  notebookId: number;
  topic: string;
  documentIds: number[];
  userId: number;
  requestId?: string | null;
}) {
  const { notebook } = await requireNotebookRole(input.notebookId, input.userId, "editor");
  if (notebook.status !== 1) throw new HTTPException(409, { message: "Notebook 已停用" });
  const available = await resolveNotebookSourceContext(input.notebookId, input.userId);
  const requestedIds = [...new Set(input.documentIds.map(Number).filter(Boolean))];
  const snapshot = available.snapshot.filter((item) => requestedIds.includes(item.documentId));
  if (!requestedIds.length || snapshot.length !== requestedIds.length) {
    throw new HTTPException(409, { message: "研究来源不完整或已从 Notebook 移除" });
  }

  const topic = input.topic.trim();
  const prompt = [
    `请针对“${topic}”生成一份严谨的深度研究报告。`,
    "报告必须包含：执行摘要、关键发现、证据与分歧、风险或限制、结论和建议。",
    "只能依据给定研究来源陈述事实；每个关键事实必须使用 [数字] 标注引用；来源冲突时明确展示不同说法，不得自行补全。",
  ].join("\n");
  const title = `研究报告：${topic}`.slice(0, 200);
  const promptHash = crypto.createHash("sha256").update(prompt).digest("hex");
  const inserted = await sqlite
    .prepare(
      `INSERT INTO sys_ai_notebook_artifact
       (notebook_id, artifact_type, title, prompt_text, prompt_hash, status, version,
        source_snapshot_json, citations_json, created_by, updated_by)
       VALUES (?, 'brief', ?, ?, ?, 'generating', 1, ?, '[]', ?, ?) RETURNING id`,
    )
    .run(
      input.notebookId,
      title,
      prompt,
      promptHash,
      JSON.stringify(snapshot),
      input.userId,
      input.userId,
    );
  const artifactId = Number(inserted.lastInsertRowid);
  return generateArtifact({
    notebook,
    artifactId,
    prompt,
    sourceContext: { knowledgeBaseIds: [], documentIds: requestedIds, snapshot },
    userId: input.userId,
    requestId: input.requestId,
    traceSourceType: "notebook_research_report",
  });
}

export async function createAiNotebookArtifact(input: {
  notebookId: number;
  artifactType: AiNotebookArtifactType;
  title?: string | null;
  customPrompt?: string | null;
  userId: number;
  requestId?: string | null;
  version?: number;
}) {
  const { notebook } = await requireNotebookRole(input.notebookId, input.userId, "editor");
  if (notebook.status !== 1) throw new HTTPException(409, { message: "Notebook 已停用" });
  const sourceContext = await resolveNotebookSourceContext(input.notebookId, input.userId);
  const prompt = artifactPrompt(input.artifactType, input.customPrompt);
  const title =
    input.title?.trim() ||
    ({ summary: "综合摘要", outline: "来源提纲", faq: "常见问题", brief: "结构化简报" } as const)[
      input.artifactType
    ];
  const promptHash = crypto.createHash("sha256").update(prompt).digest("hex");
  const inserted = await sqlite
    .prepare(
      `INSERT INTO sys_ai_notebook_artifact
       (notebook_id, artifact_type, title, prompt_text, prompt_hash, status, version,
        source_snapshot_json, citations_json, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 'generating', ?, ?, '[]', ?, ?) RETURNING id`,
    )
    .run(
      input.notebookId,
      input.artifactType,
      title,
      prompt,
      promptHash,
      input.version ?? 1,
      JSON.stringify(sourceContext.snapshot),
      input.userId,
      input.userId,
    );
  const artifactId = Number(inserted.lastInsertRowid);
  return generateArtifact({
    notebook,
    artifactId,
    prompt,
    sourceContext,
    userId: input.userId,
    requestId: input.requestId,
  });
}

export async function regenerateAiNotebookArtifact(input: {
  artifactId: number;
  userId: number;
  requestId?: string | null;
}) {
  const current = await getVisibleArtifact(input.artifactId, input.userId);
  if (!current) throw new HTTPException(404, { message: "Notebook Artifact 不存在或无权访问" });
  return createAiNotebookArtifact({
    notebookId: current.notebookId,
    artifactType: current.artifactType,
    title: current.title,
    customPrompt:
      current.artifactType === "brief"
        ? current.promptText.replace(/^请基于全部可用来源生成自定义结构化简报。具体要求：/, "")
        : null,
    userId: input.userId,
    requestId: input.requestId,
    version: current.version + 1,
  });
}

export async function deleteAiNotebookArtifact(input: { artifactId: number; userId: number }) {
  const current = await getVisibleArtifact(input.artifactId, input.userId);
  if (!current) throw new HTTPException(404, { message: "Notebook Artifact 不存在或无权访问" });
  await requireNotebookRole(current.notebookId, input.userId, "editor");
  await sqlite
    .prepare(
      `UPDATE sys_ai_notebook_artifact
       SET deleted_at = now(), deleted_by = ?, updated_by = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(input.userId, input.userId, input.artifactId);
}
