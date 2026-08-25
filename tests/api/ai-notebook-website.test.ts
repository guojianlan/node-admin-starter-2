import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import { createAiNotebook } from "@/server/services/ai-notebook-service";
import {
  defaultWebsiteSourceRuntime,
  fetchWebsiteSource,
  type WebsiteSourceRuntime,
} from "@/server/services/ai-website-source-service";
import { encryptSecret } from "@/server/services/secret";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

type ApiResponse<T> = { success: boolean; msg: string; data?: T };

const originalLookup = defaultWebsiteSourceRuntime.lookup;
const originalRequest = defaultWebsiteSourceRuntime.request;
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

function authHeaders(token: string, requestId?: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...(requestId ? { "x-request-id": requestId } : {}),
  };
}

async function configureEmbeddingModel() {
  const provider = await sqlite
    .prepare(
      `INSERT INTO sys_ai_provider
       (name, code, provider_type, base_url, api_key_encrypted, timeout_ms, status, sort)
       VALUES ('Website Embedding', 'website-embedding', 'openai-compatible',
         'https://embedding.test/v1', ?, 30000, 1, 1) RETURNING id`,
    )
    .run(encryptSecret("website-embedding-secret"));
  const model = await sqlite
    .prepare(
      `INSERT INTO sys_ai_model
       (provider_id, name, model_id, model_type, capabilities_json, context_window,
        max_output_tokens, status, sort)
       VALUES (?, 'Website Embedding', 'website-embedding', 'embedding',
         '{"embedding":true,"dimensions":3}', 8192, 1024, 1, 1) RETURNING id`,
    )
    .run(provider.lastInsertRowid);
  await sqlite.prepare("DELETE FROM sys_ai_purpose_model WHERE purpose = 'embedding'").run();
  await sqlite
    .prepare(
      "INSERT INTO sys_ai_purpose_model (purpose, model_id, priority) VALUES ('embedding', ?, 1)",
    )
    .run(model.lastInsertRowid);
}

function htmlResponse(body: string, headers: Record<string, string> = {}) {
  return {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
    body: Buffer.from(body),
  };
}

function testRuntime(
  request: WebsiteSourceRuntime["request"],
  addresses = [{ address: "93.184.216.34", family: 4 }],
): WebsiteSourceRuntime {
  return { lookup: async () => addresses, request };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await resetTestDatabase();
});

afterEach(async () => {
  defaultWebsiteSourceRuntime.lookup = originalLookup;
  defaultWebsiteSourceRuntime.request = originalRequest;
  await Promise.all(createdPaths.splice(0).map((item) => fs.rm(item, { force: true })));
});

describe("AI Notebook website sources", () => {
  it("extracts article content into normalized Markdown and follows a public redirect", async () => {
    const request = vi
      .fn<WebsiteSourceRuntime["request"]>()
      .mockResolvedValueOnce({
        status: 302,
        headers: { location: "https://www.example.com/guide" },
        body: Buffer.alloc(0),
      })
      .mockResolvedValueOnce(
        htmlResponse(`
          <html><head>
            <title>Fallback title</title>
            <link rel="canonical" href="https://www.example.com/guide?token=secret&lang=zh" />
            <meta property="article:published_time" content="2026-08-20T10:00:00Z" />
          </head><body><nav>Navigation noise</nav><article>
            <h1>Admin Base Website Guide</h1>
            <p>This article explains how website sources become durable Notebook evidence.</p>
            <p>The normalized snapshot is indexed through the existing Knowledge pipeline.</p>
          </article></body></html>`),
      );

    const snapshot = await fetchWebsiteSource({
      url: "https://example.com/start",
      runtime: testRuntime(request),
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(snapshot.title).toBe("Fallback title");
    expect(snapshot.markdown).toContain("website sources become durable Notebook evidence");
    expect(snapshot.markdown).not.toContain("Navigation noise");
    expect(snapshot.canonicalUrl).toBe("https://www.example.com/guide?lang=zh");
    expect(snapshot.publishedAt).toBe("2026-08-20T10:00:00.000Z");
  });

  it.each([
    "http://127.0.0.1/admin",
    "http://10.0.0.1/private",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/private",
    "file:///etc/passwd",
  ])("rejects unsafe URL %s", async (url) => {
    await expect(fetchWebsiteSource({ url, runtime: testRuntime(vi.fn()) })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejects private DNS answers and redirects that cross into a private host", async () => {
    await expect(
      fetchWebsiteSource({
        url: "https://private-dns.example.com",
        runtime: testRuntime(vi.fn(), [{ address: "192.168.1.10", family: 4 }]),
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      fetchWebsiteSource({
        url: "https://public.example.com",
        runtime: testRuntime(async () => ({
          status: 302,
          headers: { location: "http://127.0.0.1/internal" },
          body: Buffer.alloc(0),
        })),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("returns useful errors for unsupported content, oversized responses, and timeouts", async () => {
    await expect(
      fetchWebsiteSource({
        url: "https://example.com/file.pdf",
        runtime: testRuntime(async () => ({
          status: 200,
          headers: { "content-type": "application/pdf" },
          body: Buffer.from("pdf"),
        })),
      }),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      fetchWebsiteSource({
        url: "https://example.com/large",
        runtime: testRuntime(async () => {
          throw new Error("网页内容超过允许的大小");
        }),
      }),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      fetchWebsiteSource({
        url: "https://example.com/slow",
        runtime: testRuntime(async () => {
          throw new Error("抓取网站超时");
        }),
      }),
    ).rejects.toMatchObject({ status: 504 });
  });

  it("imports, indexes, lists, deduplicates, and audits a website source", async () => {
    await configureEmbeddingModel();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          object: "list",
          model: "website-embedding",
          data: [{ object: "embedding", index: 0, embedding: [1, 0, 0] }],
          usage: { prompt_tokens: 20, total_tokens: 20 },
        }),
      ),
    );
    defaultWebsiteSourceRuntime.lookup = async () => [{ address: "93.184.216.34", family: 4 }];
    defaultWebsiteSourceRuntime.request = async () =>
      htmlResponse(`
        <html><head><title>Website Import Acceptance</title></head><body><main>
          <h1>Website Import Acceptance</h1>
          <p>Website snapshots are stored as managed Markdown files.</p>
          <p>Knowledge indexing makes the source available to grounded Notebook answers.</p>
        </main></body></html>`);
    const notebookId = await createAiNotebook({
      user: { id: 1, username: "admin", nickname: "Admin", deptId: 1, status: 1 },
      payload: { name: "Website Notebook", scopeType: "user" },
    });
    const token = await login();
    const endpoint = `/api/system/ai/notebook/${notebookId}/sources/website`;
    const response = await app.request(endpoint, {
      method: "POST",
      headers: authHeaders(token, "notebook-website-import"),
      body: JSON.stringify({ url: "https://example.com/article?api_key=do-not-log" }),
    });
    const payload = await readJson<{
      sourceId: number;
      documentId: number;
      knowledgeBaseId: number;
      reused: boolean;
    }>(response);
    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      sourceId: expect.any(Number),
      documentId: expect.any(Number),
      knowledgeBaseId: expect.any(Number),
      reused: false,
    });

    const document = (await sqlite
      .prepare(
        `SELECT doc.status, doc.source_type AS "sourceType", doc.source_url AS "sourceUrl",
          doc.source_domain AS "sourceDomain", doc.chunk_count AS "chunkCount",
          kb.managed_type AS "managedType", kb.managed_resource_id AS "managedResourceId",
          file.path, storage.root_path AS "rootPath"
         FROM sys_ai_document doc
         INNER JOIN sys_ai_knowledge_base kb ON kb.id = doc.knowledge_base_id
         INNER JOIN sys_file file ON file.id = doc.file_id
         INNER JOIN sys_storage storage ON storage.id = file.storage_id
         WHERE doc.id = ?`,
      )
      .get(payload.data?.documentId ?? 0)) as {
      status: string;
      sourceType: string;
      sourceUrl: string;
      sourceDomain: string;
      chunkCount: number;
      managedType: string;
      managedResourceId: number;
      path: string;
      rootPath: string | null;
    };
    createdPaths.push(
      path.resolve(process.cwd(), document.rootPath || "storage/uploads", document.path),
    );
    expect(document).toMatchObject({
      status: "ready",
      sourceType: "web_url",
      sourceDomain: "example.com",
      managedType: "notebook",
      managedResourceId: notebookId,
    });
    expect(document.chunkCount).toBeGreaterThan(0);
    expect(document.sourceUrl).not.toContain("do-not-log");

    const sources = await readJson<Array<Record<string, unknown>>>(
      await app.request(`/api/system/ai/notebook/${notebookId}/sources`, {
        headers: authHeaders(token),
      }),
    );
    expect(sources.data).toEqual([
      expect.objectContaining({
        contentSourceType: "web_url",
        sourceDomain: "example.com",
        documentStatus: "ready",
      }),
    ]);

    const repeated = await readJson<{ sourceId: number; reused: boolean }>(
      await app.request(endpoint, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ url: "https://example.com/article?api_key=do-not-log" }),
      }),
    );
    expect(repeated.data).toMatchObject({ sourceId: payload.data?.sourceId, reused: true });

    const log = (await sqlite
      .prepare(
        `SELECT success, details_json AS "detailsJson" FROM sys_operation_log
         WHERE request_id = 'notebook-website-import' AND action = 'importWebsite'`,
      )
      .get()) as { success: boolean; detailsJson: string };
    expect(log.success).toBe(true);
    expect(log.detailsJson).not.toContain("do-not-log");
    expect(log.detailsJson).toContain("https://example.com/article");
  });

  it("rejects unauthenticated and private website imports and records sanitized failures", async () => {
    const notebookId = await createAiNotebook({
      user: { id: 1, username: "admin", nickname: "Admin", deptId: 1, status: 1 },
      payload: { name: "Private URL Notebook", scopeType: "user" },
    });
    const endpoint = `/api/system/ai/notebook/${notebookId}/sources/website`;
    expect(
      (
        await app.request(endpoint, {
          method: "POST",
          body: JSON.stringify({ url: "http://127.0.0.1" }),
        })
      ).status,
    ).toBe(401);

    const token = await login();
    const response = await app.request(endpoint, {
      method: "POST",
      headers: authHeaders(token, "notebook-website-private"),
      body: JSON.stringify({ url: "http://127.0.0.1/admin?token=private-value" }),
    });
    expect(response.status).toBe(400);
    const managedBase = await sqlite
      .prepare(
        "SELECT id FROM sys_ai_knowledge_base WHERE managed_type = 'notebook' AND managed_resource_id = ?",
      )
      .get(notebookId);
    expect(managedBase).toBeUndefined();
    const log = (await sqlite
      .prepare(
        `SELECT success, details_json AS "detailsJson" FROM sys_operation_log
         WHERE request_id = 'notebook-website-private' AND action = 'importWebsite'`,
      )
      .get()) as { success: boolean; detailsJson: string };
    expect(log.success).toBe(false);
    expect(log.detailsJson).not.toContain("private-value");
  });
});
