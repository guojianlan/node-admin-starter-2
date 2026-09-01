import crypto from "node:crypto";
import path from "node:path";
import type { AdminUserContext } from "@/server/context";
import { sqlite, type DbClient } from "@/server/db";
import { classifyAiError, hasEnabledAiPurposeModels } from "./ai-reliability-service";
import { embedAiText, embedAiTexts } from "./ai-capability-runtime-service";
import { rerankAiDocuments } from "./ai-rerank-runtime-service";
import { generateAiText } from "./ai-runtime-service";
import { resolveDataScopeForUser, type ResolvedDataScope } from "./data-scope";
import {
  chunkKnowledgeDocument,
  KNOWLEDGE_CHUNKER_VERSION,
  resolveKnowledgeChunkConfig,
  type KnowledgeChunkPreset,
} from "./knowledge-chunker";
import {
  copyStoredFileToUsage,
  deleteUnreferencedStoredFile,
  readStoredObject,
  type FileObjectRow,
} from "./storage-service";

export type KnowledgeScopeType = "global" | "department" | "user";
export type KnowledgeDocumentStatus = "pending" | "processing" | "ready" | "failed" | "disabled";

export type KnowledgeBaseInput = {
  name: string;
  code: string;
  description?: string | null;
  scopeType: KnowledgeScopeType;
  deptId?: number | null;
  chunkPreset?: KnowledgeChunkPreset;
  chunkSize?: number;
  chunkOverlap?: number;
  status?: number;
  sort?: number;
};

type KnowledgeBaseRow = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  scopeType: KnowledgeScopeType;
  deptId: number | null;
  ownerId: number | null;
  chunkPreset: KnowledgeChunkPreset;
  chunkSize: number;
  chunkOverlap: number;
  chunkConfigJson: string | null;
  status: number;
  sort: number;
  createdAt: string;
  updatedAt: string;
};

type KnowledgeFileRow = FileObjectRow & {
  id: number;
  originalName: string;
  ext: string | null;
  usageType: "general" | "knowledge" | "user_content";
  sha256: string | null;
  deletedAt: string | null;
};

type ExtractedDocument = {
  text: string;
  metadata: Record<string, unknown>;
};

type RetrievalRow = {
  chunkId: number;
  documentId: number;
  knowledgeBaseId: number;
  knowledgeBaseName: string;
  documentName: string;
  fileId: number;
  chunkNo: number;
  content: string;
  pageNumber: number | null;
  paragraphStart: number | null;
  paragraphEnd: number | null;
  heading: string | null;
  embeddingJson: string | null;
  keywordRank: number | string;
};

export type KnowledgeSearchResult = Omit<RetrievalRow, "embeddingJson" | "keywordRank"> & {
  keywordScore: number;
  vectorScore: number | null;
  hybridScore: number;
  rerankScore: number | null;
  score: number;
  retrievalMode: "hybrid" | "hybrid_rerank";
  rerankInvocationId: number | null;
  rerankDegraded: boolean;
  rerankErrorType: string | null;
};

const supportedExtensions = new Set(["txt", "md", "markdown", "pdf", "docx"]);
const supportedExtensionList = [...supportedExtensions];

export const knowledgeRetrievalPolicy = Object.freeze({
  embeddingBatchSize: 10,
  rerankEnabled: true,
  rerankCandidateLimit: 50,
  rerankMaxDocumentChars: 1800,
});

function normalizeChunkProfile(input: KnowledgeBaseInput) {
  const preset = input.chunkPreset ?? "auto";
  const resolved = resolveKnowledgeChunkConfig({
    preset,
    targetChars: input.chunkSize,
    overlapChars: input.chunkOverlap,
  });
  return {
    chunkPreset: preset,
    chunkSize: resolved.targetChars,
    chunkOverlap: resolved.overlapChars,
  };
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

function normalizeCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]/g, "-")
    .replaceAll(/-+/g, "-");
}

function visibilityClause(scope: ResolvedDataScope, alias = "kb") {
  if (scope.kind === "all") return { sql: "1 = 1", params: [] as Array<number> };
  const conditions = [`${alias}.scope_type = 'global'`, `${alias}.owner_id = ?`];
  const params = [scope.userId];
  if (scope.deptIds.length) {
    conditions.push(`${alias}.dept_id IN (${placeholders(scope.deptIds)})`);
    params.push(...scope.deptIds);
  }
  return { sql: `(${conditions.join(" OR ")})`, params };
}

async function resolveKnowledgeScope(userId: number) {
  return resolveDataScopeForUser(userId);
}

function resolveOwnedScope(
  input: KnowledgeBaseInput,
  user: AdminUserContext,
  scope: ResolvedDataScope,
) {
  if (input.scopeType === "global") {
    return { deptId: null, ownerId: null };
  }
  if (input.scopeType === "user") {
    return { deptId: null, ownerId: user.id };
  }
  const deptId = Number(input.deptId ?? user.deptId ?? 0);
  if (!deptId) throw new Error("部门知识库必须选择归属部门");
  if (scope.kind !== "all" && !scope.deptIds.includes(deptId)) {
    throw new Error("不能为数据权限范围外的部门创建知识库");
  }
  return { deptId, ownerId: null };
}

export async function listKnowledgeBases(input: {
  userId: number;
  keyword?: string;
  status?: number;
}) {
  const scope = await resolveKnowledgeScope(input.userId);
  const visibility = visibilityClause(scope);
  const filters = ["kb.deleted_at IS NULL", visibility.sql];
  const params: Array<string | number> = [...visibility.params];
  const keyword = input.keyword?.trim();
  if (keyword) {
    filters.push("(kb.name ILIKE ? OR kb.code ILIKE ? OR COALESCE(kb.description, '') ILIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (input.status != null) {
    filters.push("kb.status = ?");
    params.push(input.status);
  }
  return sqlite
    .prepare(
      `SELECT kb.id, kb.name, kb.code, kb.description, kb.scope_type AS "scopeType",
        kb.dept_id AS "deptId", dept.name AS "deptName", kb.owner_id AS "ownerId",
        owner.nickname AS "ownerName", kb.chunk_preset AS "chunkPreset",
        kb.chunk_size AS "chunkSize", kb.chunk_overlap AS "chunkOverlap",
        kb.chunk_config_json AS "chunkConfigJson", kb.status, kb.sort,
        kb.created_at AS "createdAt", kb.updated_at AS "updatedAt",
        COUNT(doc.id)::int AS "documentCount",
        COUNT(doc.id) FILTER (WHERE doc.status = 'ready')::int AS "readyDocumentCount",
        COALESCE(SUM(doc.chunk_count) FILTER (WHERE doc.status = 'ready'), 0)::int AS "chunkCount"
       FROM sys_ai_knowledge_base kb
       LEFT JOIN sys_dept dept ON dept.id = kb.dept_id
       LEFT JOIN sys_user owner ON owner.id = kb.owner_id
       LEFT JOIN sys_ai_document doc ON doc.knowledge_base_id = kb.id AND doc.deleted_at IS NULL
       WHERE ${filters.join(" AND ")}
       GROUP BY kb.id, dept.name, owner.nickname
       ORDER BY kb.sort ASC, kb.id DESC`,
    )
    .all(...params);
}

export async function getVisibleKnowledgeBase(id: number, userId: number, requireEnabled = false) {
  const scope = await resolveKnowledgeScope(userId);
  const visibility = visibilityClause(scope);
  const row = (await sqlite
    .prepare(
      `SELECT kb.id, kb.name, kb.code, kb.description, kb.scope_type AS "scopeType",
        kb.dept_id AS "deptId", kb.owner_id AS "ownerId",
        kb.chunk_preset AS "chunkPreset", kb.chunk_size AS "chunkSize",
        kb.chunk_overlap AS "chunkOverlap", kb.chunk_config_json AS "chunkConfigJson",
        kb.status, kb.sort,
        kb.created_at AS "createdAt", kb.updated_at AS "updatedAt"
       FROM sys_ai_knowledge_base kb
       WHERE kb.id = ? AND kb.deleted_at IS NULL AND ${visibility.sql}
         ${requireEnabled ? "AND kb.status = 1" : ""}`,
    )
    .get(id, ...visibility.params)) as KnowledgeBaseRow | undefined;
  return row;
}

export async function createKnowledgeBase(input: {
  payload: KnowledgeBaseInput;
  user: AdminUserContext;
  dbClient?: DbClient;
}) {
  const dbClient = input.dbClient ?? sqlite;
  const scope = await resolveKnowledgeScope(input.user.id);
  const ownership = resolveOwnedScope(input.payload, input.user, scope);
  const chunkProfile = normalizeChunkProfile(input.payload);
  const code = normalizeCode(input.payload.code);
  if (!code) throw new Error("知识库编码不能为空");
  const result = await dbClient
    .prepare(
      `INSERT INTO sys_ai_knowledge_base
       (name, code, description, scope_type, dept_id, owner_id, chunk_preset, chunk_size,
        chunk_overlap, status, sort, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      input.payload.name.trim(),
      code,
      input.payload.description?.trim() || null,
      input.payload.scopeType,
      ownership.deptId,
      ownership.ownerId,
      chunkProfile.chunkPreset,
      chunkProfile.chunkSize,
      chunkProfile.chunkOverlap,
      input.payload.status ?? 1,
      input.payload.sort ?? 0,
      input.user.id,
      input.user.id,
    );
  return Number(result.lastInsertRowid);
}

export async function updateKnowledgeBase(input: {
  id: number;
  payload: KnowledgeBaseInput;
  user: AdminUserContext;
}) {
  const current = await getVisibleKnowledgeBase(input.id, input.user.id);
  if (!current) throw new Error("知识库不存在或无权访问");
  const scope = await resolveKnowledgeScope(input.user.id);
  const ownership = resolveOwnedScope(input.payload, input.user, scope);
  const chunkProfile = normalizeChunkProfile(input.payload);
  const code = normalizeCode(input.payload.code);
  if (!code) throw new Error("知识库编码不能为空");
  await sqlite
    .prepare(
      `UPDATE sys_ai_knowledge_base
       SET name = ?, code = ?, description = ?, scope_type = ?, dept_id = ?, owner_id = ?,
           chunk_preset = ?, chunk_size = ?, chunk_overlap = ?, status = ?, sort = ?,
           updated_by = ?, updated_at = now()
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      input.payload.name.trim(),
      code,
      input.payload.description?.trim() || null,
      input.payload.scopeType,
      ownership.deptId,
      ownership.ownerId,
      chunkProfile.chunkPreset,
      chunkProfile.chunkSize,
      chunkProfile.chunkOverlap,
      input.payload.status ?? current.status,
      input.payload.sort ?? current.sort,
      input.user.id,
      input.id,
    );
  await invalidateNotebookSourcesForKnowledgeBase(input.id);
}

async function invalidateNotebookSourcesForKnowledgeBase(knowledgeBaseId: number) {
  // A visibility change changes the effective source set for every Notebook that references
  // this Knowledge Base, even when no source row was added or removed.
  await sqlite
    .prepare(
      `UPDATE sys_ai_notebook notebook
       SET source_scope_version = notebook.source_scope_version + 1,
           updated_at = now()
       WHERE notebook.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM sys_ai_notebook_source source
           WHERE source.notebook_id = notebook.id
             AND source.knowledge_base_id = ? AND source.deleted_at IS NULL
         )`,
    )
    .run(knowledgeBaseId);
}

async function invalidateNotebookSourcesForDocument(documentId: number) {
  await sqlite
    .prepare(
      `UPDATE sys_ai_notebook notebook
       SET source_scope_version = notebook.source_scope_version + 1, updated_at = now()
       WHERE notebook.deleted_at IS NULL
         AND EXISTS (
           SELECT 1 FROM sys_ai_notebook_source source
           WHERE source.notebook_id = notebook.id
             AND source.document_id = ? AND source.deleted_at IS NULL
         )`,
    )
    .run(documentId);
}

export async function deleteKnowledgeBase(input: { id: number; userId: number }) {
  const current = await getVisibleKnowledgeBase(input.id, input.userId);
  if (!current) throw new Error("知识库不存在或无权访问");
  await sqlite
    .prepare(
      `UPDATE sys_ai_knowledge_base SET deleted_at = now(), deleted_by = ?, updated_at = now()
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(input.userId, input.id);
  await invalidateNotebookSourcesForKnowledgeBase(input.id);
}

async function getKnowledgeFile(fileId: number) {
  return (await sqlite
    .prepare(
      `SELECT f.id, f.original_name AS "originalName", f.filename, f.path, f.url, f.ext,
        f.mime, f.sha256, f.deleted_at AS "deletedAt", f.storage_id AS "storageId",
        f.usage_type AS "usageType",
        COALESCE(s.type, 'local') AS "storageType", s.endpoint, s.region, s.bucket,
        s.access_key AS "accessKey", s.secret_key_encrypted AS "secretKeyEncrypted",
        s.root_path AS "rootPath"
       FROM sys_file f LEFT JOIN sys_storage s ON s.id = f.storage_id
       WHERE f.id = ? AND f.deleted_at IS NULL`,
    )
    .get(fileId)) as KnowledgeFileRow | undefined;
}

function fileExtension(file: KnowledgeFileRow) {
  return (file.ext || path.extname(file.originalName).slice(1)).toLowerCase();
}

export async function addKnowledgeDocument(input: {
  knowledgeBaseId: number;
  fileId: number;
  userId: number;
}) {
  const base = await getVisibleKnowledgeBase(input.knowledgeBaseId, input.userId);
  if (!base) throw new Error("知识库不存在或无权访问");
  const file = await getKnowledgeFile(input.fileId);
  if (!file) throw new Error("文件不存在或已进入回收站");
  const ext = fileExtension(file);
  if (!supportedExtensions.has(ext)) {
    throw new Error("知识库仅支持 TXT、Markdown、PDF 和 DOCX 文件");
  }
  const buffer = file.sha256 ? null : await readStoredObject(file);
  const sha256 = file.sha256 || crypto.createHash("sha256").update(buffer!).digest("hex");
  const duplicate = await sqlite
    .prepare(
      `SELECT id FROM sys_ai_document
       WHERE knowledge_base_id = ? AND sha256 = ? AND deleted_at IS NULL`,
    )
    .get(input.knowledgeBaseId, sha256);
  if (duplicate) throw new Error("相同内容已经添加到该知识库");

  return sqlite.transaction(async (tx) => {
    const previous = (await tx
      .prepare(
        `SELECT id, version FROM sys_ai_document
         WHERE knowledge_base_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL
         ORDER BY version DESC, id DESC LIMIT 1`,
      )
      .get(input.knowledgeBaseId, file.originalName)) as
      | { id: number; version: number }
      | undefined;
    if (previous) {
      await tx
        .prepare(
          "UPDATE sys_ai_document SET status = 'disabled', updated_by = ?, updated_at = now() WHERE id = ?",
        )
        .run(input.userId, previous.id);
    }
    const inserted = await tx
      .prepare(
        `INSERT INTO sys_ai_document
         (knowledge_base_id, file_id, name, sha256, version, status, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?) RETURNING id`,
      )
      .run(
        input.knowledgeBaseId,
        input.fileId,
        file.originalName,
        sha256,
        (previous?.version ?? 0) + 1,
        input.userId,
        input.userId,
      );
    const documentId = Number(inserted.lastInsertRowid);
    await tx
      .prepare(
        `INSERT INTO sys_file_reference (file_id, module, resource_type, resource_id, field)
         VALUES (?, 'system.aiKnowledge', 'document', ?, 'fileId')`,
      )
      .run(input.fileId, String(documentId));
    return documentId;
  });
}

export async function importGeneralFileToKnowledge(input: {
  knowledgeBaseId: number;
  sourceFileId: number;
  userId: number;
}) {
  const base = await getVisibleKnowledgeBase(input.knowledgeBaseId, input.userId);
  if (!base) throw new Error("知识库不存在或无权访问");
  const source = await getKnowledgeFile(input.sourceFileId);
  if (!source || source.usageType !== "general") {
    throw new Error("普通文件不存在或已进入回收站");
  }
  const ext = fileExtension(source);
  if (!supportedExtensions.has(ext)) {
    throw new Error("知识库仅支持 TXT、Markdown、PDF 和 DOCX 文件");
  }
  const buffer = source.sha256 ? null : await readStoredObject(source);
  const sha256 = source.sha256 || crypto.createHash("sha256").update(buffer!).digest("hex");
  const duplicate = await sqlite
    .prepare(
      `SELECT id FROM sys_ai_document
       WHERE knowledge_base_id = ? AND sha256 = ? AND deleted_at IS NULL`,
    )
    .get(input.knowledgeBaseId, sha256);
  if (duplicate) throw new Error("相同内容已经添加到该知识库");

  const copied = await copyStoredFileToUsage({
    sourceFileId: input.sourceFileId,
    sourceUsageType: "general",
    targetUsageType: "knowledge",
    userId: input.userId,
    sha256,
    metadata: { knowledgeBaseId: input.knowledgeBaseId, importMode: "library_snapshot" },
  });
  try {
    const documentId = await addKnowledgeDocument({
      knowledgeBaseId: input.knowledgeBaseId,
      fileId: copied.id,
      userId: input.userId,
    });
    return { documentId, fileId: copied.id, sourceFileId: input.sourceFileId };
  } catch (error) {
    await deleteUnreferencedStoredFile({ fileId: copied.id, usageType: "knowledge" }).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function listKnowledgeDocuments(input: {
  knowledgeBaseId: number;
  userId: number;
  page?: number;
  pageSize?: number;
}) {
  const base = await getVisibleKnowledgeBase(input.knowledgeBaseId, input.userId);
  if (!base) throw new Error("知识库不存在或无权访问");
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 10));
  const totalRow = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total
       FROM sys_ai_document
       WHERE knowledge_base_id = ? AND deleted_at IS NULL`,
    )
    .get(input.knowledgeBaseId)) as { total: number };
  const data = await sqlite
    .prepare(
      `SELECT doc.id, doc.knowledge_base_id AS "knowledgeBaseId", doc.file_id AS "fileId",
        doc.name, doc.sha256, doc.version, doc.status,
        doc.character_count AS "characterCount", doc.chunk_count AS "chunkCount",
        doc.chunker_version AS "chunkerVersion", doc.chunk_config_json AS "chunkConfigJson",
        doc.error_message AS "errorMessage", doc.indexed_at AS "indexedAt",
        doc.created_at AS "createdAt", doc.updated_at AS "updatedAt",
        file.ext, file.mime, file.size, file.url
       FROM sys_ai_document doc
       INNER JOIN sys_file file ON file.id = doc.file_id
       WHERE doc.knowledge_base_id = ? AND doc.deleted_at IS NULL
       ORDER BY doc.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(input.knowledgeBaseId, pageSize, (page - 1) * pageSize);
  return { data, page, pageSize, total: Number(totalRow.total) };
}

export async function listAvailableKnowledgeSourceFiles(input: {
  knowledgeBaseId: number;
  userId: number;
  groupId: number;
  keyword?: string;
  page?: number;
  pageSize?: number;
}) {
  const base = await getVisibleKnowledgeBase(input.knowledgeBaseId, input.userId);
  if (!base) throw new Error("知识库不存在或无权访问");

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 50));
  const filters = [
    "f.deleted_at IS NULL",
    "f.usage_type = 'general'",
    "f.group_id = ?",
    `LOWER(COALESCE(f.ext, '')) IN (${placeholders(supportedExtensionList)})`,
    `NOT EXISTS (
      SELECT 1
      FROM sys_ai_document doc
      WHERE doc.knowledge_base_id = ?
        AND doc.deleted_at IS NULL
        AND (doc.file_id = f.id OR (f.sha256 IS NOT NULL AND doc.sha256 = f.sha256))
    )`,
  ];
  const params: Array<string | number> = [
    input.groupId,
    ...supportedExtensionList,
    input.knowledgeBaseId,
  ];
  const keyword = input.keyword?.trim();
  if (keyword) {
    filters.push("(f.original_name ILIKE ? OR f.filename ILIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const whereSql = filters.join(" AND ");
  const totalRow = (await sqlite
    .prepare(`SELECT COUNT(*)::int AS total FROM sys_file f WHERE ${whereSql}`)
    .get(...params)) as { total: number };
  const data = await sqlite
    .prepare(
      `SELECT f.id, f.group_id AS "groupId", f.original_name AS "originalName",
        f.ext, f.size, f.sha256
       FROM sys_file f
       WHERE ${whereSql}
       ORDER BY f.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize);

  return { data, page, pageSize, total: Number(totalRow.total) };
}

async function getVisibleDocument(documentId: number, userId: number) {
  const scope = await resolveKnowledgeScope(userId);
  const visibility = visibilityClause(scope);
  return (await sqlite
    .prepare(
      `SELECT doc.id, doc.knowledge_base_id AS "knowledgeBaseId", doc.file_id AS "fileId",
        doc.name, doc.version, doc.status, kb.status AS "knowledgeBaseStatus",
        kb.chunk_preset AS "chunkPreset", kb.chunk_size AS "chunkSize",
        kb.chunk_overlap AS "chunkOverlap", kb.chunk_config_json AS "chunkConfigJson"
       FROM sys_ai_document doc
       INNER JOIN sys_ai_knowledge_base kb ON kb.id = doc.knowledge_base_id
       WHERE doc.id = ? AND doc.deleted_at IS NULL AND kb.deleted_at IS NULL AND ${visibility.sql}`,
    )
    .get(documentId, ...visibility.params)) as
    | {
        id: number;
        knowledgeBaseId: number;
        fileId: number;
        name: string;
        version: number;
        status: KnowledgeDocumentStatus;
        chunkPreset: KnowledgeChunkPreset;
        chunkSize: number;
        chunkOverlap: number;
        chunkConfigJson: string | null;
      }
    | undefined;
}

async function extractDocument(file: KnowledgeFileRow, buffer: Buffer): Promise<ExtractedDocument> {
  const ext = fileExtension(file);
  if (ext === "txt" || ext === "md" || ext === "markdown") {
    return { text: buffer.toString("utf8"), metadata: { format: ext } };
  }
  if (ext === "pdf") {
    const pdfParser = await import("pdf-parse");
    const result = await pdfParser.default(buffer);
    return { text: result.text, metadata: { format: ext, pages: result.numpages } };
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: result.value,
      metadata: { format: ext, warnings: result.messages.map((message) => message.message) },
    };
  }
  throw new Error("不支持该文件格式");
}

export function chunkKnowledgeText(text: string, maxChars = 1200, overlapChars = 150) {
  return chunkKnowledgeDocument({
    text,
    format: "md",
    config: { preset: "documentation", targetChars: maxChars, overlapChars },
  });
}

export async function indexKnowledgeDocument(input: {
  documentId: number;
  userId: number;
  requestId?: string | null;
  expectedDocumentVersion?: number;
}) {
  const document = await getVisibleDocument(input.documentId, input.userId);
  if (!document) throw new Error("知识文档不存在或无权访问");
  if (document.status === "disabled") throw new Error("已停用文档不能建立索引");
  if (
    input.expectedDocumentVersion != null &&
    document.version !== input.expectedDocumentVersion
  ) {
    throw new Error("文档版本已变化，旧索引任务已失效");
  }
  const file = await getKnowledgeFile(document.fileId);
  if (!file) throw new Error("源文件不存在或已进入回收站");
  await sqlite
    .prepare(
      `UPDATE sys_ai_document SET status = 'processing', error_message = NULL,
       updated_by = ?, updated_at = now() WHERE id = ?`,
    )
    .run(input.userId, input.documentId);
  try {
    const buffer = await readStoredObject(file);
    const extracted = await extractDocument(file, buffer);
    const text = extracted.text.trim();
    if (!text) throw new Error("文档没有可索引的文本内容");
    const chunkConfig = resolveKnowledgeChunkConfig(
      {
        preset: document.chunkPreset,
        targetChars: document.chunkSize,
        overlapChars: document.chunkOverlap,
      },
      fileExtension(file),
    );
    const chunks = chunkKnowledgeDocument({
      text,
      format: fileExtension(file),
      config: chunkConfig,
    });
    if (!chunks.length) throw new Error("文档分块结果为空");
    const embeddings: number[][] = [];
    for (
      let offset = 0;
      offset < chunks.length;
      offset += knowledgeRetrievalPolicy.embeddingBatchSize
    ) {
      const batch = chunks.slice(offset, offset + knowledgeRetrievalPolicy.embeddingBatchSize);
      const result = await embedAiTexts({
        values: batch.map((chunk) => chunk.content),
        trace: {
          sourceType: "knowledge_index",
          sourceId: input.documentId,
          requestId: input.requestId,
          userId: input.userId,
        },
      });
      embeddings.push(...result.embeddings);
    }
    await sqlite.transaction(async (tx) => {
      await tx
        .prepare("DELETE FROM sys_ai_document_chunk WHERE document_id = ?")
        .run(input.documentId);
      for (const [index, chunk] of chunks.entries()) {
        await tx
          .prepare(
            `INSERT INTO sys_ai_document_chunk
             (document_id, chunk_no, content, token_count, paragraph_start, paragraph_end,
              heading, metadata_json, embedding_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            input.documentId,
            index + 1,
            chunk.content,
            chunk.tokenCount,
            chunk.paragraphStart,
            chunk.paragraphEnd,
            chunk.heading,
            JSON.stringify({
              ...extracted.metadata,
              chunkerVersion: KNOWLEDGE_CHUNKER_VERSION,
              chunkConfig,
            }),
            JSON.stringify(embeddings[index] ?? []),
          );
      }
      const versioned = await tx
        .prepare(
          `UPDATE sys_ai_document
           SET status = 'ready', character_count = ?, chunk_count = ?, error_message = NULL,
               chunker_version = ?, chunk_config_json = ?, indexed_at = now(),
               updated_by = ?, updated_at = now()
           WHERE id = ? AND version = ? RETURNING id`,
        )
        .run(
          text.length,
          chunks.length,
          KNOWLEDGE_CHUNKER_VERSION,
          JSON.stringify(chunkConfig),
          input.userId,
          input.documentId,
          document.version,
        );
      if (!versioned.changes) throw new Error("文档版本已变化，拒绝写入旧索引");
    });
    return { characterCount: text.length, chunkCount: chunks.length };
  } catch (error) {
    const classified = classifyAiError(error);
    // A newer document version owns the row now. Never mark that newer version
    // failed because an older Worker attempt completed late.
    await sqlite
      .prepare(
        `UPDATE sys_ai_document SET status = 'failed', error_message = ?,
         updated_by = ?, updated_at = now() WHERE id = ? AND version = ?`,
      )
      .run(classified.message, input.userId, input.documentId, document.version);
    throw error;
  }
}

export async function setKnowledgeDocumentStatus(input: {
  documentId: number;
  status: "ready" | "disabled";
  userId: number;
}) {
  const document = await getVisibleDocument(input.documentId, input.userId);
  if (!document) throw new Error("知识文档不存在或无权访问");
  if (input.status === "ready" && document.status !== "ready" && document.status !== "disabled") {
    throw new Error("只有已建立索引的文档可以重新启用");
  }
  const chunk = await sqlite
    .prepare("SELECT id FROM sys_ai_document_chunk WHERE document_id = ? LIMIT 1")
    .get(input.documentId);
  if (input.status === "ready" && !chunk) throw new Error("文档没有可用索引，请先重新索引");
  await sqlite
    .prepare(
      "UPDATE sys_ai_document SET status = ?, updated_by = ?, updated_at = now() WHERE id = ?",
    )
    .run(input.status, input.userId, input.documentId);
  await invalidateNotebookSourcesForDocument(input.documentId);
}

export async function deleteKnowledgeDocument(input: { documentId: number; userId: number }) {
  const document = await getVisibleDocument(input.documentId, input.userId);
  if (!document) throw new Error("知识文档不存在或无权访问");
  await sqlite
    .prepare(
      `UPDATE sys_ai_document SET deleted_at = now(), deleted_by = ?, status = 'disabled',
       updated_at = now() WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(input.userId, input.documentId);
  await invalidateNotebookSourcesForDocument(input.documentId);
}

function parseEmbedding(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => Number.isFinite(Number(item)))
      ? parsed.map(Number)
      : null;
  } catch {
    return null;
  }
}

function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return null;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function lexicalSimilarity(query: string, content: string) {
  const normalize = (value: string) => value.toLowerCase().replaceAll(/\s+/g, "").trim();
  const toTerms = (value: string) => {
    const normalized = normalize(value);
    const terms = new Set<string>();
    for (const word of value.toLowerCase().match(/[a-z0-9_-]{2,}/g) ?? []) terms.add(word);
    for (let index = 0; index < normalized.length - 1; index += 1) {
      terms.add(normalized.slice(index, index + 2));
    }
    return terms;
  };
  const queryTerms = toTerms(query);
  if (!queryTerms.size) return 0;
  const contentTerms = toTerms(content);
  let matched = 0;
  for (const term of queryTerms) if (contentTerms.has(term)) matched += 1;
  return matched / queryTerms.size;
}

export async function searchKnowledge(input: {
  query: string;
  knowledgeBaseIds?: number[];
  documentIds?: number[];
  userId: number;
  limit?: number;
  requestId?: string | null;
}) {
  const query = input.query.trim();
  if (!query) throw new Error("请输入检索问题");
  const scope = await resolveKnowledgeScope(input.userId);
  const visibility = visibilityClause(scope);
  const filters = [
    "kb.deleted_at IS NULL",
    "kb.status = 1",
    "doc.deleted_at IS NULL",
    "doc.status = 'ready'",
    visibility.sql,
  ];
  const params: Array<string | number> = [query, ...visibility.params];
  const knowledgeBaseIds = [...new Set((input.knowledgeBaseIds ?? []).map(Number).filter(Boolean))];
  const documentIds = [...new Set((input.documentIds ?? []).map(Number).filter(Boolean))];
  const sourceFilters: string[] = [];
  if (knowledgeBaseIds.length) {
    sourceFilters.push(`kb.id IN (${placeholders(knowledgeBaseIds)})`);
    params.push(...knowledgeBaseIds);
  }
  if (documentIds.length) {
    sourceFilters.push(`doc.id IN (${placeholders(documentIds)})`);
    params.push(...documentIds);
  }
  if (sourceFilters.length) {
    filters.push(`(${sourceFilters.join(" OR ")})`);
  }
  const rows = (await sqlite
    .prepare(
      `SELECT c.id AS "chunkId", doc.id AS "documentId", kb.id AS "knowledgeBaseId",
        kb.name AS "knowledgeBaseName", doc.name AS "documentName", doc.file_id AS "fileId",
        c.chunk_no AS "chunkNo", c.content, c.page_number AS "pageNumber",
        c.paragraph_start AS "paragraphStart", c.paragraph_end AS "paragraphEnd",
        c.heading, c.embedding_json AS "embeddingJson",
        ts_rank(c.search_vector, plainto_tsquery('simple', ?)) AS "keywordRank"
       FROM sys_ai_document_chunk c
       INNER JOIN sys_ai_document doc ON doc.id = c.document_id
       INNER JOIN sys_ai_knowledge_base kb ON kb.id = doc.knowledge_base_id
       WHERE ${filters.join(" AND ")}
       ORDER BY "keywordRank" DESC, c.id DESC
       LIMIT 500`,
    )
    .all(...params)) as RetrievalRow[];
  if (!rows.length) return [];

  let queryEmbedding: number[] | null = null;
  try {
    const embedded = await embedAiText({
      value: query,
      trace: {
        sourceType: "knowledge_search",
        requestId: input.requestId,
        userId: input.userId,
      },
    });
    queryEmbedding = embedded.embedding;
  } catch {
    queryEmbedding = null;
  }
  const ranked = rows.map((row) => {
    const keywordScore = Math.max(
      0,
      Number(row.keywordRank) || 0,
      lexicalSimilarity(query, row.content),
    );
    const embedding = parseEmbedding(row.embeddingJson);
    const vectorScore =
      queryEmbedding && embedding ? cosineSimilarity(queryEmbedding, embedding) : null;
    const normalizedKeyword = Math.min(1, keywordScore * 4);
    const score =
      vectorScore == null ? normalizedKeyword : vectorScore * 0.72 + normalizedKeyword * 0.28;
    const publicRow = {
      chunkId: row.chunkId,
      documentId: row.documentId,
      knowledgeBaseId: row.knowledgeBaseId,
      knowledgeBaseName: row.knowledgeBaseName,
      documentName: row.documentName,
      fileId: row.fileId,
      chunkNo: row.chunkNo,
      content: row.content,
      pageNumber: row.pageNumber,
      paragraphStart: row.paragraphStart,
      paragraphEnd: row.paragraphEnd,
      heading: row.heading,
    };
    return {
      ...publicRow,
      keywordScore,
      vectorScore,
      hybridScore: score,
      rerankScore: null,
      score,
      retrievalMode: "hybrid" as const,
      rerankInvocationId: null,
      rerankDegraded: false,
      rerankErrorType: null,
    };
  });
  const limit = Math.min(Math.max(Math.round(input.limit ?? 8), 1), 50);
  const hybridCandidates = ranked
    .sort((left, right) => right.score - left.score)
    .slice(0, knowledgeRetrievalPolicy.rerankCandidateLimit);
  const rerankConfigured =
    knowledgeRetrievalPolicy.rerankEnabled && (await hasEnabledAiPurposeModels("rerank"));
  if (!rerankConfigured) return hybridCandidates.slice(0, limit);

  try {
    const reranked = await rerankAiDocuments({
      query,
      documents: hybridCandidates.map((candidate) => ({
        id: candidate.chunkId,
        text: candidate.content,
      })),
      topN: limit,
      candidateLimit: knowledgeRetrievalPolicy.rerankCandidateLimit,
      maxDocumentChars: knowledgeRetrievalPolicy.rerankMaxDocumentChars,
      trace: {
        sourceType: "knowledge_rerank",
        requestId: input.requestId,
        userId: input.userId,
      },
    });
    const byChunkId = new Map(hybridCandidates.map((candidate) => [candidate.chunkId, candidate]));
    return reranked.results.flatMap((result) => {
      const candidate = byChunkId.get(Number(result.id));
      return candidate
        ? [
            {
              ...candidate,
              rerankScore: result.score,
              score: result.score,
              retrievalMode: "hybrid_rerank" as const,
              rerankInvocationId: reranked.invocationId,
            },
          ]
        : [];
    });
  } catch (error) {
    const classified = classifyAiError(error);
    return hybridCandidates.slice(0, limit).map((candidate) => ({
      ...candidate,
      rerankDegraded: true,
      rerankErrorType: classified.type,
    }));
  }
}

export async function askKnowledge(input: {
  query: string;
  knowledgeBaseIds?: number[];
  documentIds?: number[];
  userId: number;
  requestId?: string | null;
  modelId?: number | null;
  systemPrompt?: string | null;
  traceSourceType?: string;
  traceSourceId?: number | null;
}) {
  const startedAt = performance.now();
  const baseIds = [...new Set((input.knowledgeBaseIds ?? []).map(Number).filter(Boolean))];
  const documentIds = [...new Set((input.documentIds ?? []).map(Number).filter(Boolean))];
  const sourceFilter = { knowledgeBaseIds: baseIds, documentIds };
  const queryHash = crypto.createHash("sha256").update(input.query.trim()).digest("hex");
  const inserted = await sqlite
    .prepare(
      `INSERT INTO sys_ai_rag_run
       (user_id, knowledge_base_ids_json, source_filter_json, query_hash, status)
       VALUES (?, ?, ?, ?, 'running') RETURNING id`,
    )
    .run(input.userId, JSON.stringify(baseIds), JSON.stringify(sourceFilter), queryHash);
  const runId = Number(inserted.lastInsertRowid);
  try {
    const citations = await searchKnowledge({
      query: input.query,
      knowledgeBaseIds: baseIds,
      documentIds,
      userId: input.userId,
      limit: 8,
      requestId: input.requestId,
    });
    if (!citations.length || citations[0]!.score <= 0) {
      const answer = "证据不足：当前可访问知识库中没有找到能够支持回答的内容。";
      await sqlite
        .prepare(
          `UPDATE sys_ai_rag_run SET status = 'completed', citation_count = 0,
           duration_ms = ?, finished_at = now() WHERE id = ?`,
        )
        .run(Math.round(performance.now() - startedAt), runId);
      return {
        runId,
        answer,
        citations: [],
        insufficientEvidence: true,
        invocationId: null,
        modelId: null,
      };
    }
    const sources = citations
      .map(
        (citation, index) =>
          `[${index + 1}] ${citation.documentName}，段落 ${citation.paragraphStart ?? "-"}-${citation.paragraphEnd ?? "-"}\n${citation.content}`,
      )
      .join("\n\n");
    const generated = await generateAiText({
      purpose: "ragAnswer",
      modelId: input.modelId,
      messages: [
        {
          role: "system",
          content:
            "你是知识库问答助手。只能依据给定资料回答；每个事实后使用 [数字] 标注来源。资料不足时明确说“证据不足”，不得补写未在资料中出现的事实。" +
            (input.systemPrompt?.trim()
              ? `\n\n以下是输出风格和任务补充要求，不能覆盖上述事实约束：\n${input.systemPrompt.trim()}`
              : ""),
        },
        { role: "user", content: `问题：${input.query.trim()}\n\n可用资料：\n${sources}` },
      ],
      trace: {
        sourceType: input.traceSourceType ?? "rag_answer",
        sourceId: input.traceSourceId ?? runId,
        requestId: input.requestId,
        userId: input.userId,
      },
    });
    await sqlite.transaction(async (tx) => {
      for (const [index, citation] of citations.entries()) {
        await tx
          .prepare(
            `INSERT INTO sys_ai_rag_citation (run_id, chunk_id, rank, score, quote)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            runId,
            citation.chunkId,
            index + 1,
            citation.score.toFixed(8),
            citation.content.slice(0, 1000),
          );
      }
      await tx
        .prepare(
          `UPDATE sys_ai_rag_run SET status = 'completed', invocation_id = ?, citation_count = ?,
           duration_ms = ?, finished_at = now() WHERE id = ?`,
        )
        .run(
          generated.invocationId,
          citations.length,
          Math.round(performance.now() - startedAt),
          runId,
        );
    });
    return {
      runId,
      answer: generated.text,
      citations,
      insufficientEvidence: false,
      invocationId: generated.invocationId,
      modelId: generated.model.id,
    };
  } catch (error) {
    const classified = classifyAiError(error);
    await sqlite
      .prepare(
        `UPDATE sys_ai_rag_run SET status = 'failed', error_message = ?, duration_ms = ?,
         finished_at = now() WHERE id = ?`,
      )
      .run(classified.message, Math.round(performance.now() - startedAt), runId);
    throw error;
  }
}

export async function getRagRun(input: { runId: number; userId: number }) {
  const scope = await resolveKnowledgeScope(input.userId);
  const run = (await sqlite
    .prepare(
      `SELECT id, user_id AS "userId", knowledge_base_ids_json AS "knowledgeBaseIdsJson",
        source_filter_json AS "sourceFilterJson", query_hash AS "queryHash",
        invocation_id AS "invocationId", status,
        citation_count AS "citationCount", duration_ms AS "durationMs",
        error_message AS "errorMessage", created_at AS "createdAt", finished_at AS "finishedAt"
       FROM sys_ai_rag_run WHERE id = ? AND (? = 1 OR user_id = ?)`,
    )
    .get(input.runId, scope.kind === "all" ? 1 : 0, input.userId)) as
    | Record<string, unknown>
    | undefined;
  if (!run) return null;
  const citations = await sqlite
    .prepare(
      `SELECT cite.id, cite.rank, cite.score, cite.quote, cite.chunk_id AS "chunkId",
        chunk.chunk_no AS "chunkNo", chunk.page_number AS "pageNumber",
        chunk.paragraph_start AS "paragraphStart", chunk.paragraph_end AS "paragraphEnd",
        doc.id AS "documentId", doc.name AS "documentName", doc.file_id AS "fileId",
        kb.id AS "knowledgeBaseId", kb.name AS "knowledgeBaseName"
       FROM sys_ai_rag_citation cite
       INNER JOIN sys_ai_document_chunk chunk ON chunk.id = cite.chunk_id
       INNER JOIN sys_ai_document doc ON doc.id = chunk.document_id
       INNER JOIN sys_ai_knowledge_base kb ON kb.id = doc.knowledge_base_id
       WHERE cite.run_id = ? ORDER BY cite.rank`,
    )
    .all(input.runId);
  return { ...run, citations };
}
