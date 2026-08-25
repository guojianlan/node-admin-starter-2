import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import {
  chunkKnowledgeText,
  getVisibleKnowledgeBase,
  knowledgeRetrievalPolicy,
  listAvailableKnowledgeSourceFiles,
  searchKnowledge,
} from "@/server/services/ai-knowledge-service";
import {
  chunkKnowledgeDocument,
  KNOWLEDGE_CHUNKER_VERSION,
  resolveKnowledgeChunkConfig,
} from "@/server/services/knowledge-chunker";
import { rerankAiDocuments } from "@/server/services/ai-rerank-runtime-service";
import { encryptSecret } from "@/server/services/secret";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

type ApiResponse<T> = { success: boolean; msg: string; data?: T };

async function readJson<T>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

async function login() {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: getAdminTestPassword() }),
  });
  return String((await readJson<{ token: string }>(response)).data?.token ?? "");
}

function authHeaders(token: string, requestId?: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...(requestId ? { "x-request-id": requestId } : {}),
  };
}

async function configureRagModels() {
  const provider = await sqlite
    .prepare(
      `INSERT INTO sys_ai_provider
       (name, code, provider_type, base_url, api_key_encrypted, timeout_ms, status, sort)
       VALUES ('RAG Test Provider', 'rag-test', 'openai-compatible',
         'https://rag.test/v1', ?, 30000, 1, 1) RETURNING id`,
    )
    .run(encryptSecret("rag-test-secret"));
  const embedding = await sqlite
    .prepare(
      `INSERT INTO sys_ai_model
       (provider_id, name, model_id, model_type, capabilities_json, context_window,
        max_output_tokens, input_price, output_price, currency, status, sort)
       VALUES (?, 'RAG Embedding', 'rag-embedding', 'embedding', '{"embedding":true,"dimensions":3}',
         8192, 1024, '0.02', '0', 'USD', 1, 1) RETURNING id`,
    )
    .run(provider.lastInsertRowid);
  const rerankProvider = await sqlite
    .prepare(
      `INSERT INTO sys_ai_provider
       (name, code, provider_type, base_url, api_key_encrypted, timeout_ms, status, sort)
       VALUES ('RAG Rerank Provider', 'rag-rerank-test', 'qwen',
         'https://rag-rerank.test/compatible-api/v1', ?, 30000, 1, 2) RETURNING id`,
    )
    .run(encryptSecret("rag-rerank-test-secret"));
  const rerank = await sqlite
    .prepare(
      `INSERT INTO sys_ai_model
       (provider_id, name, model_id, model_type, capabilities_json, context_window,
        max_output_tokens, input_price, output_price, currency, status, sort)
       VALUES (?, 'RAG Rerank', 'qwen3-rerank', 'rerank', '{"rerank":true}',
         32768, NULL, NULL, NULL, 'USD', 1, 1) RETURNING id`,
    )
    .run(rerankProvider.lastInsertRowid);
  const chat = await sqlite
    .prepare(
      `INSERT INTO sys_ai_model
       (provider_id, name, model_id, model_type, capabilities_json, context_window,
        max_output_tokens, input_price, output_price, currency, status, sort)
       VALUES (?, 'RAG Chat', 'rag-chat', 'chat', '{"chat":true}',
         128000, 8192, '0.10', '0.40', 'USD', 1, 2) RETURNING id`,
    )
    .run(provider.lastInsertRowid);
  await sqlite
    .prepare(
      "DELETE FROM sys_ai_purpose_model WHERE purpose IN ('embedding', 'rerank', 'ragAnswer')",
    )
    .run();
  await sqlite
    .prepare(
      "INSERT INTO sys_ai_purpose_model (purpose, model_id, priority) VALUES ('rerank', ?, 1)",
    )
    .run(rerank.lastInsertRowid);
  await sqlite
    .prepare(
      "INSERT INTO sys_ai_purpose_model (purpose, model_id, priority) VALUES ('embedding', ?, 1)",
    )
    .run(embedding.lastInsertRowid);
  await sqlite
    .prepare(
      "INSERT INTO sys_ai_purpose_model (purpose, model_id, priority) VALUES ('ragAnswer', ?, 1)",
    )
    .run(chat.lastInsertRowid);
}

const createdPaths: string[] = [];

async function createTextFile(content: string, name = "rag-guide.txt") {
  const storage = (await sqlite
    .prepare('SELECT id, root_path AS "rootPath" FROM sys_storage WHERE is_default = true LIMIT 1')
    .get()) as { id: number; rootPath: string | null };
  const root = path.resolve(process.cwd(), storage.rootPath || "storage/uploads");
  const ext = name.split(".").pop()?.toLowerCase() || "txt";
  const relativePath = `rag-tests/${crypto.randomUUID()}.${ext}`;
  const fullPath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf8");
  createdPaths.push(fullPath);
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  const inserted = await sqlite
    .prepare(
      `INSERT INTO sys_file
       (group_id, storage_id, original_name, filename, path, url, size, ext, mime, type,
        sha256, uploader_id, created_by, updated_by)
       VALUES (2, ?, ?, ?, ?, ?, ?, ?, 'text/plain', 'document', ?, 1, 1, 1)
       RETURNING id`,
    )
    .run(
      storage.id,
      name,
      path.basename(relativePath),
      relativePath,
      `/uploads/${relativePath}`,
      Buffer.byteLength(content),
      ext,
      sha256,
    );
  return Number(inserted.lastInsertRowid);
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await resetTestDatabase();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  const imported = (await sqlite
    .prepare(
      `SELECT f.path, s.root_path AS "rootPath"
       FROM sys_file f LEFT JOIN sys_storage s ON s.id = f.storage_id
       WHERE f.usage_type = 'knowledge' AND f.metadata_json LIKE '%library_snapshot%'`,
    )
    .all()) as Array<{ path: string; rootPath: string | null }>;
  createdPaths.push(
    ...imported.map((item) =>
      path.join(path.resolve(process.cwd(), item.rootPath || "storage/uploads"), item.path),
    ),
  );
  await Promise.all(createdPaths.splice(0).map((item) => fs.rm(item, { force: true })));
});

describe("AI Knowledge and RAG", () => {
  it("chunks text deterministically with paragraph metadata", () => {
    const text = ["# 第一章", "A".repeat(800), "第二段是检索依据。", "B".repeat(900)].join("\n\n");
    const first = chunkKnowledgeText(text, 900, 100);
    const second = chunkKnowledgeText(text, 900, 100);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(1);
    expect(first[0]).toMatchObject({ paragraphStart: 1, heading: "第一章" });
    expect(first.every((chunk) => chunk.content.length > 0 && chunk.tokenCount > 0)).toBe(true);
  });

  it("paginates and remotely filters eligible source files", async () => {
    const token = await login();
    const created = await readJson<{ id: number }>(
      await app.request("/api/system/ai/knowledge", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          name: "来源文件分页测试",
          code: "source-file-pagination",
          scopeType: "global",
        }),
      }),
    );
    const knowledgeBaseId = Number(created.data?.id);
    const attachedId = await createTextFile("same source hash", "scale-attached.md");
    await createTextFile("same source hash", "scale-duplicate.md");
    const firstId = await createTextFile("alpha", "scale-source-alpha.md");
    const secondId = await createTextFile("beta", "scale-source-beta.pdf");
    await createTextFile("unsupported", "scale-unsupported.png");
    await app.request(`/api/system/ai/knowledge/${knowledgeBaseId}/documents`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ fileId: attachedId }),
    });

    const firstPage = await readJson<{
      data: Array<{ id: number; originalName: string }>;
      page: number;
      pageSize: number;
      total: number;
    }>(
      await app.request(
        `/api/system/ai/knowledge/${knowledgeBaseId}/source-files?groupId=2&keyword=scale-source&page=1&pageSize=1`,
        { headers: authHeaders(token) },
      ),
    );
    expect(firstPage.data).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      data: [{ id: secondId, originalName: "scale-source-beta.pdf" }],
    });

    const secondPage = await readJson<{ data: Array<{ id: number }>; total: number }>(
      await app.request(
        `/api/system/ai/knowledge/${knowledgeBaseId}/source-files?groupId=2&keyword=scale-source&page=2&pageSize=1`,
        { headers: authHeaders(token) },
      ),
    );
    expect(secondPage.data).toMatchObject({ total: 2, data: [{ id: firstId }] });

    for (const keyword of ["scale-attached", "scale-duplicate", "scale-unsupported"]) {
      const filtered = await readJson<{ data: unknown[]; total: number }>(
        await app.request(
          `/api/system/ai/knowledge/${knowledgeBaseId}/source-files?groupId=2&keyword=${keyword}`,
          { headers: authHeaders(token) },
        ),
      );
      expect(filtered.data).toMatchObject({ data: [], total: 0 });
    }

    const invalidPage = await app.request(
      `/api/system/ai/knowledge/${knowledgeBaseId}/source-files?groupId=2&page=0&pageSize=101`,
      { headers: authHeaders(token) },
    );
    expect(invalidPage.status).toBe(400);
  });

  it("imports an independent Knowledge copy from the ordinary file library", async () => {
    const token = await login();
    const created = await readJson<{ id: number }>(
      await app.request("/api/system/ai/knowledge", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          name: "独立副本测试",
          code: "independent-library-copy",
          scopeType: "global",
        }),
      }),
    );
    const knowledgeBaseId = Number(created.data?.id);
    const sourceFileId = await createTextFile("independent knowledge content", "independent.md");
    await sqlite.prepare("UPDATE sys_file SET sha256 = NULL WHERE id = ?").run(sourceFileId);
    const source = (await sqlite
      .prepare("SELECT path FROM sys_file WHERE id = ?")
      .get(sourceFileId)) as { path: string };

    const imported = await readJson<{ id: number; fileId: number }>(
      await app.request(`/api/system/ai/knowledge/${knowledgeBaseId}/documents`, {
        method: "POST",
        headers: authHeaders(token, "knowledge-library-import"),
        body: JSON.stringify({ fileId: sourceFileId }),
      }),
    );
    expect(imported.data?.id).toBeGreaterThan(0);
    expect(imported.data?.fileId).not.toBe(sourceFileId);
    const importedDocumentId = Number(imported.data?.id);
    const copiedFileId = Number(imported.data?.fileId);
    expect(importedDocumentId).toBeGreaterThan(0);
    expect(copiedFileId).toBeGreaterThan(0);
    const copied = (await sqlite
      .prepare(
        `SELECT path, usage_type AS "usageType", sha256, metadata_json AS "metadataJson"
         FROM sys_file WHERE id = ?`,
      )
      .get(copiedFileId)) as {
      path: string;
      usageType: string;
      sha256: string;
      metadataJson: string;
    };
    expect(copied.path).not.toBe(source.path);
    expect(copied.usageType).toBe("knowledge");
    const expectedSha256 = crypto
      .createHash("sha256")
      .update("independent knowledge content")
      .digest("hex");
    expect(copied.sha256).toBe(expectedSha256);
    expect(JSON.parse(copied.metadataJson)).toMatchObject({
      importedFromFileId: sourceFileId,
      importMode: "library_snapshot",
      sourceSha256: expectedSha256,
    });
    const importLog = (await sqlite
      .prepare(
        `SELECT action, success, details_json AS "detailsJson"
         FROM sys_operation_log WHERE request_id = 'knowledge-library-import' LIMIT 1`,
      )
      .get()) as { action: string; success: boolean; detailsJson: string };
    expect(importLog).toMatchObject({ action: "importDocument", success: true });
    expect(JSON.parse(importLog.detailsJson)).toMatchObject({
      knowledgeBaseId,
      sourceFileId,
      importMode: "library_snapshot",
    });

    const copyCountBeforeDuplicate = (await sqlite
      .prepare(
        `SELECT COUNT(*)::int AS total FROM sys_file
         WHERE usage_type = 'knowledge' AND metadata_json LIKE ?`,
      )
      .get(`%\"importedFromFileId\":${sourceFileId}%`)) as { total: number };
    const duplicate = await app.request(`/api/system/ai/knowledge/${knowledgeBaseId}/documents`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ fileId: sourceFileId }),
    });
    expect(duplicate.status).not.toBe(200);
    const copyCountAfterDuplicate = (await sqlite
      .prepare(
        `SELECT COUNT(*)::int AS total FROM sys_file
         WHERE usage_type = 'knowledge' AND metadata_json LIKE ?`,
      )
      .get(`%\"importedFromFileId\":${sourceFileId}%`)) as { total: number };
    expect(copyCountAfterDuplicate.total).toBe(copyCountBeforeDuplicate.total);

    expect(
      (
        await app.request(`/api/system/file/list/${sourceFileId}`, {
          method: "DELETE",
          headers: authHeaders(token),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/system/file/list/force/${sourceFileId}`, {
          method: "DELETE",
          headers: authHeaders(token),
        })
      ).status,
    ).toBe(200);

    const storage = (await sqlite
      .prepare('SELECT root_path AS "rootPath" FROM sys_storage WHERE is_default = true LIMIT 1')
      .get()) as { rootPath: string | null };
    const copiedContent = await fs.readFile(
      path.join(path.resolve(process.cwd(), storage.rootPath || "storage/uploads"), copied.path),
      "utf8",
    );
    expect(copiedContent).toBe("independent knowledge content");
    expect(
      await sqlite.prepare("SELECT id FROM sys_ai_document WHERE id = ?").get(importedDocumentId),
    ).toBeTruthy();
  });

  it("preserves documentation structure and uses sentence-boundary overlap", () => {
    const source = [
      "# RAG 索引",
      "",
      "第一段说明解析文档时应保留标题层级，并识别完整段落。",
      "",
      "```ts",
      'const purpose = "embedding";',
      "```",
      "",
      "第二段说明需要按中文句子边界切分。第三句用于验证后续分块获得上文语义。",
      "",
      "## 检索",
      "",
      "检索阶段先混合召回，再使用 rerank 对候选内容重新排序。",
    ].join("\n");
    const chunks = chunkKnowledgeDocument({
      text: source,
      format: "md",
      config: { preset: "documentation", targetChars: 120, overlapChars: 20 },
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((chunk) => chunk.content.includes('const purpose = "embedding";'))).toBe(
      true,
    );
    expect(chunks.find((chunk) => chunk.heading === "检索")?.content).toContain("## 检索");
    expect(chunks.every((chunk) => chunk.content.length > 0)).toBe(true);
  });

  it("resolves auto presets by file format and rejects unsafe overlap", () => {
    expect(resolveKnowledgeChunkConfig({ preset: "auto" }, "md").preset).toBe("documentation");
    expect(resolveKnowledgeChunkConfig({ preset: "auto" }, "pdf").preset).toBe("recursive");
    expect(() =>
      resolveKnowledgeChunkConfig({
        preset: "paragraph",
        targetChars: 1000,
        overlapChars: 400,
      }),
    ).toThrow("35%");
  });

  it("indexes existing files, prevents duplicate content, and returns inspectable citations", async () => {
    await configureRagModels();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/embeddings")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string | string[] };
        expect(body).toMatchObject({ dimensions: 3 });
        const values = Array.isArray(body.input) ? body.input : [body.input ?? ""];
        return Response.json({
          object: "list",
          model: "rag-embedding",
          data: values.map((_value, index) => ({
            object: "embedding",
            index,
            embedding: [1, 0, 0],
          })),
          usage: { prompt_tokens: values.length * 10, total_tokens: values.length * 10 },
        });
      }
      if (String(input).endsWith("/compatible-api/v1/reranks")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          model: string;
          query: string;
          documents: string[];
          top_n: number;
          return_documents: boolean;
        };
        expect(body).toMatchObject({
          model: "qwen3-rerank",
          top_n: expect.any(Number),
          return_documents: false,
        });
        expect(body.documents.length).toBeLessThanOrEqual(50);
        expect(body.documents.every((document) => document.length <= 1800)).toBe(true);
        return Response.json({
          id: "rerank-rag",
          results: body.documents.map((_document, index) => ({
            index,
            relevance_score: 0.98 - index * 0.01,
          })),
        });
      }
      return Response.json({
        id: "chatcmpl-rag",
        object: "chat.completion",
        created: 1,
        model: "rag-chat",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Admin Base 使用 PostgreSQL 保存业务事实。[1]" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const token = await login();
    const invalidChunkProfile = await app.request("/api/system/ai/knowledge", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "非法分块配置",
        code: "invalid-chunk-profile",
        scopeType: "global",
        chunkPreset: "paragraph",
        chunkSize: 1000,
        chunkOverlap: 400,
      }),
    });
    expect(invalidChunkProfile.status).toBe(400);
    const fileId = await createTextFile(
      "# 架构约束\n\nAdmin Base 使用 PostgreSQL 保存业务事实。\n\n菜单权限由 sys_rule 统一管理。",
    );

    const unauthorized = await app.request("/api/system/ai/knowledge");
    expect(unauthorized.status).toBe(401);
    const created = await readJson<{ id: number }>(
      await app.request("/api/system/ai/knowledge", {
        method: "POST",
        headers: authHeaders(token, "knowledge-create"),
        body: JSON.stringify({
          name: "框架知识",
          code: "framework-knowledge",
          scopeType: "global",
          chunkPreset: "documentation",
          chunkSize: 1500,
          chunkOverlap: 150,
          status: 1,
          sort: 0,
        }),
      }),
    );
    const knowledgeBaseId = Number(created.data?.id);
    expect(knowledgeBaseId).toBeGreaterThan(0);
    expect(await getVisibleKnowledgeBase(knowledgeBaseId, 1)).toMatchObject({
      chunkPreset: "documentation",
      chunkSize: 1500,
      chunkOverlap: 150,
    });

    const attached = await readJson<{ id: number }>(
      await app.request(`/api/system/ai/knowledge/${knowledgeBaseId}/documents`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ fileId }),
      }),
    );
    const documentId = Number(attached.data?.id);
    expect(documentId).toBeGreaterThan(0);

    const duplicate = await app.request(`/api/system/ai/knowledge/${knowledgeBaseId}/documents`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ fileId }),
    });
    expect(duplicate.status).not.toBe(200);

    const indexed = await app.request(`/api/system/ai/knowledge/documents/${documentId}/index`, {
      method: "POST",
      headers: authHeaders(token, "knowledge-index"),
    });
    expect(indexed.status).toBe(200);
    const document = (await sqlite
      .prepare(
        `SELECT status, chunk_count AS "chunkCount", error_message AS "errorMessage"
         FROM sys_ai_document WHERE id = ?`,
      )
      .get(documentId)) as Record<string, unknown>;
    expect(document).toMatchObject({ status: "ready", errorMessage: null });
    expect(Number(document.chunkCount)).toBeGreaterThan(0);
    const chunkSnapshot = (await sqlite
      .prepare(
        `SELECT chunker_version AS "chunkerVersion", chunk_config_json AS "chunkConfigJson"
         FROM sys_ai_document WHERE id = ?`,
      )
      .get(documentId)) as { chunkerVersion: string; chunkConfigJson: string };
    expect(chunkSnapshot.chunkerVersion).toBe(KNOWLEDGE_CHUNKER_VERSION);
    expect(JSON.parse(chunkSnapshot.chunkConfigJson)).toMatchObject({
      preset: "documentation",
      targetChars: 1500,
      overlapChars: 150,
    });

    const search = await readJson<
      Array<{
        documentId: number;
        score: number;
        rerankScore: number;
        retrievalMode: string;
        rerankInvocationId: number;
      }>
    >(
      await app.request("/api/system/ai/knowledge/search", {
        method: "POST",
        headers: authHeaders(token, "knowledge-search"),
        body: JSON.stringify({
          query: "业务事实保存在哪里？",
          knowledgeBaseIds: [knowledgeBaseId],
        }),
      }),
    );
    expect(search.data?.[0]).toMatchObject({
      documentId,
      rerankScore: 0.98,
      retrievalMode: "hybrid_rerank",
    });
    expect(Number(search.data?.[0]?.score)).toBeGreaterThan(0);
    expect(search.data?.[0]?.rerankInvocationId).toBeGreaterThan(0);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes("/embeddings")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { input?: string | string[] };
          const values = Array.isArray(body.input) ? body.input : [body.input ?? ""];
          return Response.json({
            object: "list",
            model: "rag-embedding",
            data: values.map((_value, index) => ({
              object: "embedding",
              index,
              embedding: [1, 0, 0],
            })),
          });
        }
        return Response.json({ error: { code: "upstream_unavailable" } }, { status: 503 });
      }),
    );
    const degraded = await searchKnowledge({
      query: "业务事实保存在哪里？",
      knowledgeBaseIds: [knowledgeBaseId],
      userId: 1,
      requestId: "knowledge-rerank-degraded",
    });
    expect(degraded[0]).toMatchObject({
      documentId,
      retrievalMode: "hybrid",
      rerankDegraded: true,
      rerankErrorType: "provider_error",
    });
    vi.stubGlobal("fetch", fetchMock);

    const answer = await readJson<{
      runId: number;
      invocationId: number;
      answer: string;
      citations: Array<{ documentId: number; content: string }>;
    }>(
      await app.request("/api/system/ai/knowledge/ask", {
        method: "POST",
        headers: authHeaders(token, "knowledge-ask"),
        body: JSON.stringify({
          query: "Admin Base 用什么保存业务事实？",
          knowledgeBaseIds: [knowledgeBaseId],
        }),
      }),
    );
    expect(answer.data?.answer).toContain("PostgreSQL");
    expect(answer.data?.citations[0]).toMatchObject({ documentId });
    expect(answer.data?.invocationId).toBeGreaterThan(0);

    const run = await readJson<{ invocationId: number; citations: Array<{ documentId: number }> }>(
      await app.request(`/api/system/ai/knowledge/runs/${answer.data?.runId}`, {
        headers: authHeaders(token),
      }),
    );
    expect(run.data?.invocationId).toBe(answer.data?.invocationId);
    expect(run.data?.citations[0]).toMatchObject({ documentId });
    const invocationSources = (await sqlite
      .prepare(
        `SELECT source_type AS "sourceType" FROM sys_ai_invocation
         WHERE source_type IN ('knowledge_index', 'knowledge_search', 'knowledge_rerank', 'rag_answer')
         ORDER BY id`,
      )
      .all()) as Array<{ sourceType: string }>;
    expect(invocationSources.map((item) => item.sourceType)).toEqual(
      expect.arrayContaining([
        "knowledge_index",
        "knowledge_search",
        "knowledge_rerank",
        "rag_answer",
      ]),
    );
    const log = (await sqlite
      .prepare(
        `SELECT risk_level AS "riskLevel" FROM sys_operation_log
         WHERE request_id = 'knowledge-index' LIMIT 1`,
      )
      .get()) as { riskLevel: string };
    expect(log.riskLevel).toBe("high");

    const nextFileId = await createTextFile(
      "# 架构约束\n\nAdmin Base 的新版本仍以 PostgreSQL 作为业务事实来源。",
      "rag-guide.txt",
    );
    const nextVersion = await readJson<{ id: number }>(
      await app.request(`/api/system/ai/knowledge/${knowledgeBaseId}/documents`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ fileId: nextFileId }),
      }),
    );
    expect(nextVersion.data?.id).toBeGreaterThan(documentId);
    const versions = (await sqlite
      .prepare(
        `SELECT id, version, status FROM sys_ai_document
         WHERE knowledge_base_id = ? ORDER BY version`,
      )
      .all(knowledgeBaseId)) as Array<{ id: number; version: number; status: string }>;
    expect(versions).toMatchObject([
      { id: documentId, version: 1, status: "disabled" },
      { id: nextVersion.data?.id, version: 2, status: "pending" },
    ]);

    const documentPage = await readJson<{
      data: Array<{ id: number; name: string }>;
      page: number;
      pageSize: number;
      total: number;
    }>(
      await app.request(`/api/system/ai/knowledge/${knowledgeBaseId}/documents?page=1&pageSize=1`, {
        headers: authHeaders(token),
      }),
    );
    expect(documentPage.data).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
      data: [{ id: nextVersion.data?.id, name: "rag-guide.txt" }],
    });

    const removed = await app.request(`/api/system/ai/knowledge/documents/${documentId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(removed.status).toBe(200);
    const reference = await sqlite
      .prepare(
        `SELECT id FROM sys_file_reference
         WHERE module = 'system.aiKnowledge' AND resource_id = ?`,
      )
      .get(String(documentId));
    expect(reference).toBeTruthy();
    const historicalRun = await readJson<{ citations: Array<{ documentId: number }> }>(
      await app.request(`/api/system/ai/knowledge/runs/${answer.data?.runId}`, {
        headers: authHeaders(token),
      }),
    );
    expect(historicalRun.data?.citations[0]).toMatchObject({ documentId });
    expect(
      await searchKnowledge({
        query: "PostgreSQL",
        knowledgeBaseIds: [knowledgeBaseId],
        userId: 1,
      }),
    ).toEqual([]);
  });

  it("does not allow explicit IDs to bypass department visibility", async () => {
    await configureRagModels();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const deptA = await sqlite
      .prepare(
        "INSERT INTO sys_dept (parent_id, name, code, status) VALUES (0, '研发部', 'rag-a', 1) RETURNING id",
      )
      .run();
    const deptB = await sqlite
      .prepare(
        "INSERT INTO sys_dept (parent_id, name, code, status) VALUES (0, '财务部', 'rag-b', 1) RETURNING id",
      )
      .run();
    const role = await sqlite
      .prepare(
        "INSERT INTO sys_role (name, code, data_scope, status) VALUES ('部门知识用户', 'rag-dept-user', 'current_dept', 1) RETURNING id",
      )
      .run();
    const user = await sqlite
      .prepare(
        `INSERT INTO sys_user (username, password_hash, nickname, dept_id, status)
         VALUES ('rag-user', 'unused', 'RAG 用户', ?, 1) RETURNING id`,
      )
      .run(deptA.lastInsertRowid);
    await sqlite
      .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)")
      .run(user.lastInsertRowid, role.lastInsertRowid);
    const hiddenBase = await sqlite
      .prepare(
        `INSERT INTO sys_ai_knowledge_base
         (name, code, scope_type, dept_id, status, created_by)
         VALUES ('财务知识', 'finance-private', 'department', ?, 1, 1) RETURNING id`,
      )
      .run(deptB.lastInsertRowid);

    expect(
      await getVisibleKnowledgeBase(
        Number(hiddenBase.lastInsertRowid),
        Number(user.lastInsertRowid),
      ),
    ).toBeUndefined();
    await expect(
      listAvailableKnowledgeSourceFiles({
        knowledgeBaseId: Number(hiddenBase.lastInsertRowid),
        userId: Number(user.lastInsertRowid),
        groupId: 2,
      }),
    ).rejects.toThrow("知识库不存在或无权访问");
    const results = await searchKnowledge({
      query: "财务数据",
      knowledgeBaseIds: [Number(hiddenBase.lastInsertRowid)],
      userId: Number(user.lastInsertRowid),
    });
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps rerank inputs, normalizes rankings, and falls back without persisting content", async () => {
    expect(knowledgeRetrievalPolicy).toMatchObject({
      embeddingBatchSize: 10,
      rerankEnabled: true,
      rerankCandidateLimit: 50,
      rerankMaxDocumentChars: 1800,
    });
    const firstProvider = await sqlite
      .prepare(
        `INSERT INTO sys_ai_provider
         (name, code, provider_type, base_url, api_key_encrypted, timeout_ms, status, sort)
         VALUES ('Rerank First', 'rerank-first', 'qwen', 'https://rerank-first.test/v1', ?, 30000, 1, 1)
         RETURNING id`,
      )
      .run(encryptSecret("first-secret"));
    const secondProvider = await sqlite
      .prepare(
        `INSERT INTO sys_ai_provider
         (name, code, provider_type, base_url, api_key_encrypted, timeout_ms, status, sort)
         VALUES ('Rerank Second', 'rerank-second', 'qwen', 'https://rerank-second.test/v1', ?, 30000, 1, 2)
         RETURNING id`,
      )
      .run(encryptSecret("second-secret"));
    const firstModel = await sqlite
      .prepare(
        `INSERT INTO sys_ai_model
         (provider_id, name, model_id, model_type, capabilities_json, status, sort)
         VALUES (?, 'Rerank First', 'qwen3-rerank', 'rerank', '{"rerank":true}', 1, 1)
         RETURNING id`,
      )
      .run(firstProvider.lastInsertRowid);
    const secondModel = await sqlite
      .prepare(
        `INSERT INTO sys_ai_model
         (provider_id, name, model_id, model_type, capabilities_json, status, sort)
         VALUES (?, 'Rerank Second', 'qwen3-rerank', 'rerank', '{"rerank":true}', 1, 1)
         RETURNING id`,
      )
      .run(secondProvider.lastInsertRowid);
    await sqlite.prepare("DELETE FROM sys_ai_purpose_model WHERE purpose = 'rerank'").run();
    await sqlite
      .prepare(
        "INSERT INTO sys_ai_purpose_model (purpose, model_id, priority) VALUES ('rerank', ?, 1), ('rerank', ?, 2)",
      )
      .run(firstModel.lastInsertRowid, secondModel.lastInsertRowid);

    const privateQuery = "private rerank question";
    const privatePrefix = "sensitive-document-content-";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("rerank-first")) {
        return Response.json({ error: { code: "temporary_failure" } }, { status: 503 });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        query: string;
        documents: string[];
        top_n: number;
      };
      expect(body.query).toBe(privateQuery);
      expect(body.documents).toHaveLength(50);
      expect(body.documents.every((document) => document.length === 1800)).toBe(true);
      expect(body.top_n).toBe(5);
      return Response.json({
        results: [
          { index: 3, relevance_score: 0.7 },
          { index: 1, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.1 },
          { index: 999, relevance_score: 1 },
          { index: 2, relevance_score: "invalid" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const reranked = await rerankAiDocuments({
      query: privateQuery,
      documents: Array.from({ length: 55 }, (_, index) => ({
        id: index + 100,
        text: `${privatePrefix}${index}-${"x".repeat(2200)}`,
      })),
      topN: 5,
      candidateLimit: 50,
      maxDocumentChars: 1800,
      trace: { sourceType: "rerank_privacy_test", requestId: "rerank-fallback" },
    });
    expect(reranked.results).toEqual([
      { id: 101, originalIndex: 1, score: 0.9 },
      { id: 103, originalIndex: 3, score: 0.7 },
    ]);
    const invocation = (await sqlite
      .prepare(
        `SELECT attempt_count AS "attemptCount", fallback_used AS "fallbackUsed"
         FROM sys_ai_invocation WHERE id = ?`,
      )
      .get(reranked.invocationId)) as { attemptCount: number; fallbackUsed: boolean };
    expect(invocation).toMatchObject({ attemptCount: 2, fallbackUsed: true });
    const persistedTrace = JSON.stringify(
      await sqlite
        .prepare(
          `SELECT i.*, COALESCE(json_agg(a.*) FILTER (WHERE a.id IS NOT NULL), '[]') AS attempts
           FROM sys_ai_invocation i
           LEFT JOIN sys_ai_invocation_attempt a ON a.invocation_id = i.id
           WHERE i.id = ? GROUP BY i.id`,
        )
        .get(reranked.invocationId),
    );
    expect(persistedTrace).not.toContain(privateQuery);
    expect(persistedTrace).not.toContain(privatePrefix);
    expect(persistedTrace).not.toContain("first-secret");
    expect(persistedTrace).not.toContain("second-secret");
  });
});
