import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import {
  addAiNotebookSource,
  createAiNotebookArtifact,
  createAiNotebook,
  getVisibleAiNotebook,
  listAiNotebookSources,
  removeAiNotebookSource,
  saveAiNotebookMember,
} from "@/server/services/ai-notebook-service";
import { encryptSecret } from "@/server/services/secret";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

type ApiResponse<T> = { success: boolean; msg: string; data?: T };
type PageResult<T> = { data: T[]; page: number; pageSize: number; total: number };

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

async function configureNotebookAnswerModel() {
  const provider = await sqlite
    .prepare(
      `INSERT INTO sys_ai_provider
       (name, code, provider_type, base_url, api_key_encrypted, timeout_ms, status, sort)
       VALUES ('Notebook Provider', 'notebook-provider', 'openai-compatible',
         'https://notebook.test/v1', ?, 30000, 1, 1) RETURNING id`,
    )
    .run(encryptSecret("notebook-test-secret"));
  const model = await sqlite
    .prepare(
      `INSERT INTO sys_ai_model
       (provider_id, name, model_id, model_type, capabilities_json, context_window,
        max_output_tokens, status, sort)
       VALUES (?, 'Notebook Chat', 'notebook-chat', 'chat', '{"chat":true}',
         128000, 8192, 1, 1) RETURNING id`,
    )
    .run(provider.lastInsertRowid);
  await sqlite.prepare("DELETE FROM sys_ai_purpose_model WHERE purpose = 'ragAnswer'").run();
  await sqlite
    .prepare(
      `INSERT INTO sys_ai_purpose_model (purpose, model_id, priority)
       VALUES ('ragAnswer', ?, 1)`,
    )
    .run(model.lastInsertRowid);
  return Number(model.lastInsertRowid);
}

async function createReadyDocument(input: {
  baseName: string;
  baseCode: string;
  documentName: string;
  content: string;
}) {
  const base = await sqlite
    .prepare(
      `INSERT INTO sys_ai_knowledge_base
       (name, code, scope_type, status, created_by, updated_by)
       VALUES (?, ?, 'global', 1, 1, 1) RETURNING id`,
    )
    .run(input.baseName, input.baseCode);
  const file = (await sqlite.prepare("SELECT id FROM sys_file ORDER BY id LIMIT 1").get()) as {
    id: number;
  };
  const document = await sqlite
    .prepare(
      `INSERT INTO sys_ai_document
       (knowledge_base_id, file_id, name, sha256, version, status, character_count,
        chunk_count, indexed_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, 1, 'ready', ?, 1, now(), 1, 1) RETURNING id`,
    )
    .run(
      base.lastInsertRowid,
      file.id,
      input.documentName,
      `${input.baseCode}-sha256`,
      input.content.length,
    );
  const chunk = await sqlite
    .prepare(
      `INSERT INTO sys_ai_document_chunk
       (document_id, chunk_no, content, token_count, paragraph_start, paragraph_end)
       VALUES (?, 1, ?, 20, 1, 1) RETURNING id`,
    )
    .run(document.lastInsertRowid, input.content);
  return {
    knowledgeBaseId: Number(base.lastInsertRowid),
    documentId: Number(document.lastInsertRowid),
    chunkId: Number(chunk.lastInsertRowid),
  };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await resetTestDatabase();
});

describe("AI Notebook v1", () => {
  it("enforces viewer and editor roles for collaborative source and artifact mutations", async () => {
    const document = await createReadyDocument({
      baseName: "协作资料",
      baseCode: "notebook-collaboration",
      documentName: "collaboration.md",
      content: "查看者可以阅读来源，但不能修改来源或生成产物。",
    });
    const notebookId = await createAiNotebook({
      user: {
        id: 1,
        username: "admin",
        nickname: "Administrator",
        deptId: 1,
        status: 1,
      },
      payload: { name: "协作 Notebook", scopeType: "global" },
    });
    const sourceId = await addAiNotebookSource({
      notebookId,
      sourceType: "document",
      targetId: document.documentId,
      userId: 1,
    });
    const member = await sqlite
      .prepare(
        `INSERT INTO sys_user (username, nickname, password_hash, dept_id, status)
         VALUES ('notebook-viewer', 'Notebook Viewer', 'not-used', 1, 1) RETURNING id`,
      )
      .run();
    const memberUserId = Number(member.lastInsertRowid);
    await saveAiNotebookMember({
      notebookId,
      userId: 1,
      memberUserId,
      role: "viewer",
    });

    await expect(listAiNotebookSources({ notebookId, userId: memberUserId })).resolves.toHaveLength(
      1,
    );
    await expect(
      removeAiNotebookSource({ notebookId, sourceId, userId: memberUserId }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createAiNotebookArtifact({
        notebookId,
        artifactType: "summary",
        userId: memberUserId,
      }),
    ).rejects.toMatchObject({ status: 403 });

    await saveAiNotebookMember({
      notebookId,
      userId: 1,
      memberUserId,
      role: "editor",
    });
    await expect(
      removeAiNotebookSource({ notebookId, sourceId, userId: memberUserId }),
    ).resolves.toBeUndefined();
  });

  it("restricts grounded answers to active sources and preserves historical snapshots", async () => {
    const modelId = await configureNotebookAnswerModel();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "chatcmpl-notebook",
          object: "chat.completion",
          created: 1,
          model: "notebook-chat",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "这是基于当前 Notebook 来源的回答。[1]" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
        }),
      ),
    );
    const first = await createReadyDocument({
      baseName: "架构资料",
      baseCode: "notebook-architecture",
      documentName: "architecture.md",
      content: "PostgreSQL 是 Admin Base 的业务事实来源。",
    });
    const second = await createReadyDocument({
      baseName: "部署资料",
      baseCode: "notebook-deployment",
      documentName: "deployment.md",
      content: "PM2 用于 Admin Base 的生产进程管理。",
    });
    const token = await login();

    expect((await app.request("/api/system/ai/notebook")).status).toBe(401);
    const options = await readJson<{ models: Array<{ id: number }> }>(
      await app.request("/api/system/ai/notebook/options", { headers: authHeaders(token) }),
    );
    expect(options.data?.models).toEqual([expect.objectContaining({ id: modelId })]);
    const sourceOptions = await readJson<PageResult<{ id: number; readyDocumentCount: number }>>(
      await app.request(
        "/api/system/ai/notebook/source-options?sourceType=knowledge_base&page=1&pageSize=1",
        { headers: authHeaders(token) },
      ),
    );
    expect(sourceOptions.data).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    const created = await readJson<{ id: number }>(
      await app.request("/api/system/ai/notebook", {
        method: "POST",
        headers: authHeaders(token, "notebook-create"),
        body: JSON.stringify({
          name: "框架 Notebook",
          scopeType: "user",
          defaultModelId: modelId,
          systemPrompt: "使用简洁中文回答。",
        }),
      }),
    );
    const notebookId = Number(created.data?.id);
    expect(notebookId).toBeGreaterThan(0);
    await expect(getVisibleAiNotebook(notebookId, 1)).resolves.toMatchObject({
      sourceScopeVersion: 1,
    });

    const noSource = await app.request(`/api/system/ai/notebook/${notebookId}/ask`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ query: "Admin Base 使用什么数据库？" }),
    });
    expect(noSource.status).toBe(409);

    const source = await readJson<{ id: number }>(
      await app.request(`/api/system/ai/notebook/${notebookId}/sources`, {
        method: "POST",
        headers: authHeaders(token, "notebook-source-add"),
        body: JSON.stringify({ sourceType: "document", targetId: first.documentId }),
      }),
    );
    const sourceId = Number(source.data?.id);
    expect(sourceId).toBeGreaterThan(0);
    await expect(getVisibleAiNotebook(notebookId, 1)).resolves.toMatchObject({
      sourceScopeVersion: 2,
    });
    const duplicate = await app.request(`/api/system/ai/notebook/${notebookId}/sources`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ sourceType: "document", targetId: first.documentId }),
    });
    expect(duplicate.status).toBe(409);

    const firstAnswer = await readJson<{
      runId: number;
      citations: Array<{ documentId: number }>;
      sourceSnapshot: Array<{ documentId: number; version: number }>;
    }>(
      await app.request(`/api/system/ai/notebook/${notebookId}/ask`, {
        method: "POST",
        headers: authHeaders(token, "notebook-first-ask"),
        body: JSON.stringify({ query: "PostgreSQL 是什么？" }),
      }),
    );
    expect(firstAnswer.data?.citations).toEqual([
      expect.objectContaining({ documentId: first.documentId }),
    ]);
    expect(firstAnswer.data?.sourceSnapshot).toEqual([
      expect.objectContaining({ documentId: first.documentId, version: 1 }),
    ]);

    const artifact = await readJson<{
      id: number;
      sourceScopeVersion: number;
      citations: Array<{ documentId: number }>;
    }>(
      await app.request(`/api/system/ai/notebook/${notebookId}/artifacts`, {
        method: "POST",
        headers: authHeaders(token, "notebook-artifact-generate"),
        body: JSON.stringify({ artifactType: "summary" }),
      }),
    );
    expect(artifact.data).toMatchObject({
      id: expect.any(Number),
      sourceScopeVersion: 2,
      citations: [expect.objectContaining({ documentId: first.documentId })],
    });

    const disabled = await app.request(`/api/system/ai/knowledge/documents/${first.documentId}/status`, {
      method: "PUT",
      headers: authHeaders(token, "notebook-knowledge-status-change"),
      body: JSON.stringify({ status: "disabled" }),
    });
    expect(disabled.status).toBe(200);
    await expect(getVisibleAiNotebook(notebookId, 1)).resolves.toMatchObject({
      sourceScopeVersion: 3,
    });

    const removed = await app.request(`/api/system/ai/notebook/${notebookId}/sources/${sourceId}`, {
      method: "DELETE",
      headers: authHeaders(token, "notebook-source-remove"),
    });
    expect(removed.status).toBe(200);
    await expect(getVisibleAiNotebook(notebookId, 1)).resolves.toMatchObject({
      sourceScopeVersion: 4,
    });
    await app.request(`/api/system/ai/notebook/${notebookId}/sources`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ sourceType: "document", targetId: second.documentId }),
    });

    const nextAnswer = await readJson<{ citations: Array<{ documentId: number }> }>(
      await app.request(`/api/system/ai/notebook/${notebookId}/ask`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ query: "PM2 如何使用？" }),
      }),
    );
    expect(nextAnswer.data?.citations).toEqual([
      expect.objectContaining({ documentId: second.documentId }),
    ]);

    const historicalRun = await readJson<{ citations: Array<{ documentId: number }> }>(
      await app.request(`/api/system/ai/knowledge/runs/${firstAnswer.data?.runId}`, {
        headers: authHeaders(token),
      }),
    );
    expect(historicalRun.data?.citations).toEqual([
      expect.objectContaining({ documentId: first.documentId }),
    ]);
    const artifacts = await readJson<{
      data: Array<{
        id: number;
        sourceSnapshot: Array<{ documentId: number }>;
        citations: Array<{ documentId: number }>;
      }>;
      total: number;
    }>(
      await app.request(`/api/system/ai/notebook/${notebookId}/artifacts?page=1&pageSize=10`, {
        headers: authHeaders(token),
      }),
    );
    expect(artifacts.data).toMatchObject({
      total: 1,
      data: [
        {
          id: artifact.data?.id,
          sourceSnapshot: [expect.objectContaining({ documentId: first.documentId })],
          citations: [expect.objectContaining({ documentId: first.documentId })],
        },
      ],
    });

    const regenerated = await readJson<{
      id: number;
      sourceScopeVersion: number;
      citations: Array<{ documentId: number }>;
    }>(
      await app.request(`/api/system/ai/notebook/artifacts/${artifact.data?.id}/regenerate`, {
        method: "POST",
        headers: authHeaders(token, "notebook-artifact-regenerate"),
      }),
    );
    expect(regenerated.data).toMatchObject({
      id: expect.any(Number),
      sourceScopeVersion: 5,
      citations: [expect.objectContaining({ documentId: second.documentId })],
    });
    expect(regenerated.data?.id).not.toBe(artifact.data?.id);
    const versionedArtifacts = await readJson<{
      data: Array<{ id: number; version: number; sourceScopeVersion: number }>;
      total: number;
    }>(
      await app.request(`/api/system/ai/notebook/${notebookId}/artifacts?page=1&pageSize=10`, {
        headers: authHeaders(token),
      }),
    );
    expect(versionedArtifacts.data).toMatchObject({
      total: 2,
      data: [
        { id: regenerated.data?.id, version: 2, sourceScopeVersion: 5 },
        { id: artifact.data?.id, version: 1, sourceScopeVersion: 2 },
      ],
    });

    const operationActions = (await sqlite
      .prepare(
        `SELECT action FROM sys_operation_log
         WHERE module = 'system.aiNotebook' AND success = true ORDER BY id`,
      )
      .all()) as Array<{ action: string }>;
    expect(operationActions.map((item) => item.action)).toEqual(
      expect.arrayContaining([
        "create",
        "addSource",
        "ask",
        "generateArtifact",
        "removeSource",
        "regenerateArtifact",
      ]),
    );
  });

  it("enforces notebook and source visibility across departments", async () => {
    const deptA = await sqlite
      .prepare(
        "INSERT INTO sys_dept (parent_id, name, code, status) VALUES (0, '研发部', 'notebook-a', 1) RETURNING id",
      )
      .run();
    const deptB = await sqlite
      .prepare(
        "INSERT INTO sys_dept (parent_id, name, code, status) VALUES (0, '财务部', 'notebook-b', 1) RETURNING id",
      )
      .run();
    const role = await sqlite
      .prepare(
        `INSERT INTO sys_role (name, code, data_scope, status)
         VALUES ('部门 Notebook 用户', 'notebook-dept-user', 'current_dept', 1) RETURNING id`,
      )
      .run();
    const user = await sqlite
      .prepare(
        `INSERT INTO sys_user (username, password_hash, nickname, dept_id, status)
         VALUES ('notebook-user', 'unused', 'Notebook 用户', ?, 1) RETURNING id`,
      )
      .run(deptA.lastInsertRowid);
    await sqlite
      .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)")
      .run(user.lastInsertRowid, role.lastInsertRowid);
    const hiddenNotebook = await sqlite
      .prepare(
        `INSERT INTO sys_ai_notebook
         (name, scope_type, dept_id, status, created_by, updated_by)
         VALUES ('财务 Notebook', 'department', ?, 1, 1, 1) RETURNING id`,
      )
      .run(deptB.lastInsertRowid);
    const hiddenSource = await sqlite
      .prepare(
        `INSERT INTO sys_ai_knowledge_base
         (name, code, scope_type, dept_id, status, created_by, updated_by)
         VALUES ('财务知识', 'notebook-finance', 'department', ?, 1, 1, 1) RETURNING id`,
      )
      .run(deptB.lastInsertRowid);
    const userId = Number(user.lastInsertRowid);

    expect(
      await getVisibleAiNotebook(Number(hiddenNotebook.lastInsertRowid), userId),
    ).toBeUndefined();
    await expect(
      addAiNotebookSource({
        notebookId: Number(hiddenNotebook.lastInsertRowid),
        sourceType: "knowledge_base",
        targetId: Number(hiddenSource.lastInsertRowid),
        userId,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const ownedId = await createAiNotebook({
      payload: { name: "个人 Notebook", scopeType: "user" },
      user: {
        id: userId,
        username: "notebook-user",
        nickname: "Notebook 用户",
        deptId: Number(deptA.lastInsertRowid),
        status: 1,
      },
    });
    expect(await getVisibleAiNotebook(ownedId, userId)).toMatchObject({
      scopeType: "user",
      ownerId: userId,
      deptId: null,
    });
    await expect(
      addAiNotebookSource({
        notebookId: ownedId,
        sourceType: "knowledge_base",
        targetId: Number(hiddenSource.lastInsertRowid),
        userId,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
