import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import {
  cancelAiNotebookResearchRun,
  enqueueAiNotebookDeepResearch,
  executeAiNotebookDeepResearch,
  getAiNotebookResearchRun,
  importAiNotebookSearchResults,
  listAiNotebookResearchRuns,
} from "@/server/services/ai-notebook-research-service";
import { createAiNotebook } from "@/server/services/ai-notebook-service";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

type ApiResponse<T> = { success: boolean; msg: string; data?: T };
type PageResult<T> = { data: T[]; total: number };
const createdPaths: string[] = [];

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

function authHeaders(token: string, json = true) {
  return {
    authorization: `Bearer ${token}`,
    ...(json ? { "content-type": "application/json" } : {}),
  };
}

async function createNotebook(name = "Research Notebook") {
  return createAiNotebook({
    user: { id: 1, username: "admin", nickname: "Admin", deptId: 1, status: 1 },
    payload: { name, scopeType: "user" },
  });
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await resetTestDatabase();
});

afterEach(async () => {
  await Promise.all(createdPaths.splice(0).map((item) => fs.rm(item, { force: true })));
});

describe("AI Notebook web research", () => {
  it("searches through the governed Provider chain and audits only query evidence", async () => {
    const notebookId = await createNotebook();
    const token = await login();
    await sqlite
      .prepare(
        `UPDATE sys_ai_web_search_provider
         SET status = 1, sort = 1, endpoint = 'https://search.test/search'
         WHERE code = 'searxng-local'`,
      )
      .run();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [
            {
              title: "Admin Base RAG",
              url: "https://example.com/rag#overview",
              content: "A source about governed retrieval.",
              engine: "documentation",
            },
          ],
        }),
      ),
    );

    const unauthorized = await app.request(`/api/system/ai/notebook/${notebookId}/sources/search`, {
      method: "POST",
      body: JSON.stringify({ query: "private topic" }),
    });
    expect(unauthorized.status).toBe(401);

    const response = await app.request(`/api/system/ai/notebook/${notebookId}/sources/search`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ query: "private topic", limit: 10 }),
    });
    expect(response.status).toBe(200);
    const body = await readJson<{ results: Array<{ url: string }>; attempts: unknown[] }>(response);
    expect(body.data?.results).toEqual([
      expect.objectContaining({ url: "https://example.com/rag" }),
    ]);
    expect(body.data?.attempts).toHaveLength(1);

    const log = (await sqlite
      .prepare(
        `SELECT details_json AS "detailsJson" FROM sys_operation_log
         WHERE module = 'system.aiNotebook' AND action = 'searchSources'
         ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { detailsJson: string };
    expect(log.detailsJson).toContain("queryHash");
    expect(log.detailsJson).not.toContain("private topic");
  });

  it("imports selected results with duplicate reuse and isolated partial failure", async () => {
    const notebookId = await createNotebook();
    const importer = vi.fn(async ({ url }: { url: string }) => {
      if (url.includes("failed")) throw new Error("抓取失败");
      const reused = url.includes("reused");
      return {
        sourceId: reused ? 2 : 1,
        documentId: reused ? 12 : 11,
        knowledgeBaseId: 3,
        reused,
        snapshot: {
          sourceUrl: url,
          canonicalUrl: url,
          domain: new URL(url).hostname,
          title: reused ? "Reused" : "Imported",
          publishedAt: null,
          fetchedAt: new Date().toISOString(),
          contentHash: reused ? "reused-hash" : "imported-hash",
          markdown: "content",
        },
      };
    });

    const result = await importAiNotebookSearchResults({
      notebookId,
      userId: 1,
      items: [
        { url: "https://example.com/imported" },
        { url: "https://example.com/reused" },
        { url: "https://example.com/failed" },
        { url: "https://example.com/imported#duplicate" },
      ],
      importWebsite: importer as never,
    });
    expect(result.imported).toHaveLength(1);
    expect(result.reused).toHaveLength(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ status: "failed", error: expect.stringContaining("抓取失败") }),
    ]);
    expect(importer).toHaveBeenCalledTimes(3);

    await expect(
      importAiNotebookSearchResults({
        notebookId,
        userId: 1,
        items: Array.from({ length: 11 }, (_, index) => ({
          url: `https://example.com/${index}`,
        })),
        importWebsite: importer as never,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("persists plan, search, import and cited report steps for Deep Research", async () => {
    const notebookId = await createNotebook();
    const queued = await enqueueAiNotebookDeepResearch({
      notebookId,
      topic: "Admin Base knowledge architecture",
      queryCount: 2,
      maxSources: 3,
      userId: 1,
      requestId: "deep-research-acceptance",
    });
    const importedDocumentIds = new Map<string, number>();
    const result = await executeAiNotebookDeepResearch({
      workflowRunId: queued.runId,
      userId: 1,
      requestId: "deep-research-acceptance",
      dependencies: {
        plan: async () => ({
          queries: ["Admin Base RAG", "Admin Base citations"],
          mode: "model",
          invocationId: 41,
        }),
        search: async ({ query }) => ({
          query,
          provider: { id: 1, code: "test", name: "Test Search", providerType: "searxng" },
          attempts: [
            {
              providerId: 1,
              providerCode: "test",
              providerName: "Test Search",
              providerType: "searxng",
              status: "completed",
              durationMs: 10,
              resultCount: 2,
            },
          ],
          results:
            query === "Admin Base RAG"
              ? [
                  { title: "RAG", url: "https://example.com/rag", snippet: "rag", source: "test" },
                  {
                    title: "Failure",
                    url: "https://example.com/failure",
                    snippet: "failure",
                    source: "test",
                  },
                ]
              : [
                  {
                    title: "Citations",
                    url: "https://example.com/citations",
                    snippet: "citations",
                    source: "test",
                  },
                ],
        }),
        importWebsite: (async ({ url }: { url: string }) => {
          if (url.includes("failure")) throw new Error("source rejected");
          const documentId = importedDocumentIds.size + 101;
          importedDocumentIds.set(url, documentId);
          return {
            sourceId: documentId,
            documentId,
            knowledgeBaseId: 1,
            reused: false,
            snapshot: {
              sourceUrl: url,
              canonicalUrl: url,
              domain: new URL(url).hostname,
              title: url.includes("rag") ? "RAG" : "Citations",
              publishedAt: null,
              fetchedAt: new Date().toISOString(),
              contentHash: String(documentId),
              markdown: "content",
            },
          };
        }) as never,
        createArtifact: (async ({ documentIds }: { documentIds: number[] }) => ({
          id: 88,
          runId: 77,
          invocationId: 66,
          citations: documentIds.map((documentId) => ({ documentId })),
        })) as never,
      },
    });
    expect(result).toMatchObject({
      artifactId: 88,
      selectedCount: 3,
      imported: 2,
      reused: 0,
      citationCount: 2,
    });
    expect(result.failed).toHaveLength(1);

    const detail = (await getAiNotebookResearchRun({
      notebookId,
      runId: queued.runId,
      userId: 1,
    })) as unknown as {
      status: string;
      steps: Array<{ stepCode: string; status: string }>;
    };
    expect(detail.status).toBe("completed");
    expect(detail.steps.map((step) => step.stepCode)).toEqual([
      "plan",
      "search",
      "search",
      "import_source",
      "import_source",
      "import_source",
      "synthesize_report",
    ]);
    expect(detail.steps.filter((step) => step.status === "failed")).toHaveLength(1);
    const list = await listAiNotebookResearchRuns({ notebookId, userId: 1 });
    expect(list.total).toBe(1);
    expect(list.data[0]).toMatchObject({ id: queued.runId, status: "completed" });

    const audit = await sqlite
      .prepare(
        `SELECT success, details_json AS "detailsJson" FROM sys_operation_log
         WHERE action = 'completeDeepResearch' ORDER BY id DESC LIMIT 1`,
      )
      .get();
    expect(audit).toMatchObject({ success: true });
    expect(JSON.stringify(audit)).not.toContain("Admin Base knowledge architecture");
  });

  it("cancels a queued research run and its Worker job atomically", async () => {
    const notebookId = await createNotebook();
    const queued = await enqueueAiNotebookDeepResearch({
      notebookId,
      topic: "Cancellation acceptance",
      userId: 1,
    });
    await cancelAiNotebookResearchRun({ notebookId, runId: queued.runId, userId: 1 });
    const run = await sqlite
      .prepare("SELECT status FROM sys_ai_workflow_run WHERE id = ?")
      .get(queued.runId);
    const job = await sqlite
      .prepare("SELECT status FROM sys_ai_job WHERE id = ?")
      .get(queued.jobId);
    expect(run).toEqual({ status: "cancelled" });
    expect(job).toEqual({ status: "cancelled" });
  });

  it("keeps knowledge uploads out of ordinary file management", async () => {
    const token = await login();
    const baseResponse = await app.request("/api/system/ai/knowledge", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "Isolated Knowledge",
        code: "isolated-knowledge",
        scopeType: "global",
        chunkPreset: "auto",
        chunkSize: 1600,
        chunkOverlap: 160,
        status: 1,
        sort: 0,
      }),
    });
    expect(baseResponse.status).toBe(200);
    const base = (await sqlite
      .prepare("SELECT id FROM sys_ai_knowledge_base WHERE code = 'isolated-knowledge'")
      .get()) as { id: number };
    const formData = new FormData();
    formData.append(
      "file",
      new File(["isolated knowledge source"], "isolated.md", { type: "text/markdown" }),
    );
    const upload = await app.request(`/api/system/ai/knowledge/${base.id}/documents/upload`, {
      method: "POST",
      headers: authHeaders(token, false),
      body: formData,
    });
    expect(upload.status, await upload.clone().text()).toBe(200);
    const uploaded = await readJson<{ fileId: number; documentId: number }>(upload);
    expect(uploaded.data).toBeDefined();
    const fileId = uploaded.data!.fileId;
    const file = (await sqlite
      .prepare('SELECT path, usage_type AS "usageType" FROM sys_file WHERE id = ?')
      .get(fileId)) as { path: string; usageType: string };
    createdPaths.push(path.join(process.cwd(), "storage", file.path));
    expect(file.usageType).toBe("knowledge");

    const ordinary = await readJson<PageResult<{ id: number }>>(
      await app.request("/api/system/file/list?page=1&pageSize=100", {
        headers: authHeaders(token),
      }),
    );
    expect(ordinary.data?.data.some((item) => item.id === fileId)).toBe(false);
    const download = await app.request(`/api/system/file/list/download/${fileId}`, {
      headers: authHeaders(token),
    });
    expect(download.status).not.toBe(200);

    const documents = await readJson<PageResult<{ id: number; fileId: number }>>(
      await app.request(`/api/system/ai/knowledge/${base.id}/documents?page=1&pageSize=10`, {
        headers: authHeaders(token),
      }),
    );
    expect(documents.data?.data).toEqual([
      expect.objectContaining({ id: uploaded.data?.documentId, fileId: uploaded.data?.fileId }),
    ]);
  });
});
