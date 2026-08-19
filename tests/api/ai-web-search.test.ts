import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import { executeAgentTool, listAiTools } from "@/server/services/ai-agent-service";
import { encryptSecret } from "@/server/services/secret";
import { getAdminTestPassword } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/db";

type ApiResponse<T = unknown> = { success: boolean; msg: string; data?: T };
type Page<T> = { data: T[]; total: number };

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

function openAiToolCallStream(toolName: string, input: Record<string, unknown>) {
  const body = [
    `data: ${JSON.stringify({
      id: "chatcmpl-search-tool",
      object: "chat.completion.chunk",
      created: 0,
      model: "search-chat",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call-web-search-1",
                type: "function",
                function: { name: toolName, arguments: JSON.stringify(input) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    })}`,
    `data: ${JSON.stringify({
      id: "chatcmpl-search-tool",
      object: "chat.completion.chunk",
      created: 0,
      model: "search-chat",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function openAiTextStream(text: string) {
  const body = [
    `data: ${JSON.stringify({
      id: "chatcmpl-search-answer",
      object: "chat.completion.chunk",
      created: 0,
      model: "search-chat",
      choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
    })}`,
    `data: ${JSON.stringify({
      id: "chatcmpl-search-answer",
      object: "chat.completion.chunk",
      created: 0,
      model: "search-chat",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await resetTestDatabase();
}, 120000);

describe("AI Web Search governance", () => {
  it("manages masked Provider resources and rejects unsafe activation", async () => {
    const unauthorized = await app.request("/api/system/ai/web-search/provider");
    expect(unauthorized.status).toBe(401);
    const token = await login();

    const templates = await readJson<Page<Record<string, unknown>>>(
      await app.request("/api/system/ai/web-search/provider?page=1&pageSize=20", {
        headers: authHeaders(token),
      }),
    );
    expect(templates.data?.total).toBe(3);

    const enableWithoutKey = await app.request("/api/system/ai/web-search/provider/status/1", {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ status: 1 }),
    });
    expect(enableWithoutKey.status).toBe(500);
    expect((await readJson(enableWithoutKey)).msg).toContain("API Key");

    const createEnabledWithoutKey = await app.request("/api/system/ai/web-search/provider", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "Unsafe Tavily",
        code: "unsafe-tavily",
        providerType: "tavily",
        status: 1,
      }),
    });
    expect(createEnabledWithoutKey.status).toBe(500);
    expect((await readJson(createEnabledWithoutKey)).msg).toContain("API Key");

    const create = await app.request("/api/system/ai/web-search/provider", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "Private SearXNG",
        code: "searxng-private",
        providerType: "searxng",
        endpoint: "https://search.example.test/search",
        apiKey: "search-secret",
        timeoutMs: 5000,
        maxResults: 6,
        status: 1,
        sort: 1,
      }),
    });
    expect(create.status).toBe(200);
    const list = await readJson<
      Page<{
        id: number;
        code: string;
        hasApiKey: boolean;
        isPrimary: boolean;
        sort: number;
        apiKey?: string;
        apiKeyEncrypted?: string;
      }>
    >(
      await app.request("/api/system/ai/web-search/provider?page=1&pageSize=20", {
        headers: authHeaders(token),
      }),
    );
    const created = list.data?.data.find((item) => item.code === "searxng-private");
    expect(created).toMatchObject({
      code: "searxng-private",
      hasApiKey: true,
      isPrimary: true,
    });
    expect(created).not.toHaveProperty("apiKey");
    expect(created).not.toHaveProperty("apiKeyEncrypted");
    expect(list.data?.data.filter((item) => item.isPrimary)).toHaveLength(1);

    const descending = await readJson<Page<{ id: number; sort: number; isPrimary: boolean }>>(
      await app.request("/api/system/ai/web-search/provider?page=1&pageSize=20&sort=sort.desc", {
        headers: authHeaders(token),
      }),
    );
    expect(descending.data?.data.map((item) => item.sort)).toEqual(
      [...(descending.data?.data ?? [])].map((item) => item.sort).sort((a, b) => b - a),
    );
    expect(descending.data?.data.filter((item) => item.isPrimary)).toHaveLength(1);
  });

  it("fails over by priority, stops after success, and records sanitized attempts", async () => {
    const token = await login();
    await sqlite
      .prepare(
        `UPDATE sys_ai_web_search_provider
       SET api_key_encrypted = ?, status = 1, sort = 1, updated_at = now()
       WHERE code = 'tavily-default'`,
      )
      .run(encryptSecret("tavily-secret"));
    await sqlite
      .prepare(
        `UPDATE sys_ai_web_search_provider
       SET status = 1, sort = 2, endpoint = 'https://searxng.test/search', updated_at = now()
       WHERE code = 'searxng-local'`,
      )
      .run();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("api.tavily.com")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ api_key: "tavily-secret" });
        return new Response("quota exceeded", { status: 429 });
      }
      expect(url).toContain("https://searxng.test/search?q=Admin+Base");
      return Response.json({
        results: [
          {
            title: "Admin Base documentation",
            url: "https://docs.example.test/admin-base#intro",
            content: "Production admin framework documentation.",
            engine: "bing",
          },
          {
            title: "Duplicate",
            url: "https://docs.example.test/admin-base",
            content: "Duplicate result.",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const tool = (await listAiTools()).find((item) => item.handlerKey === "web_search");
    expect(tool).toBeTruthy();
    const fallback = (await executeAgentTool(
      tool!,
      { query: "Admin Base", limit: 5 },
      { userId: 1, requestId: "web-search-fallback" },
    )) as {
      results: Array<{ title: string; url: string; source: string }>;
      attempts: Array<{ status: string; error?: string }>;
    };
    expect(fallback.results).toEqual([
      expect.objectContaining({
        title: "Admin Base documentation",
        url: "https://docs.example.test/admin-base",
        source: "bing",
      }),
    ]);
    expect(fallback.attempts).toEqual([
      expect.objectContaining({ status: "failed", error: expect.stringContaining("429") }),
      expect.objectContaining({ status: "completed" }),
    ]);

    const response = await app.request("/api/system/ai/web-search/provider/test", {
      method: "POST",
      headers: authHeaders(token, "web-search-provider-test"),
      body: JSON.stringify({ id: 3, query: "Admin Base", limit: 5 }),
    });
    const body = await readJson<{
      results: Array<{ title: string; url: string; source: string }>;
      attempts: Array<{ status: string; error?: string }>;
    }>(response);
    expect(response.status).toBe(200);
    expect(body.data?.results).toEqual([
      expect.objectContaining({
        title: "Admin Base documentation",
        url: "https://docs.example.test/admin-base",
        source: "bing",
      }),
    ]);
    expect(body.data?.attempts).toEqual([expect.objectContaining({ status: "completed" })]);

    const searchOperation = (await sqlite
      .prepare(
        `SELECT request_id AS "requestId", details_json AS "detailsJson"
       FROM sys_operation_log
       WHERE module = 'system.aiWebSearch' AND action = 'search'
       ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { requestId: string; detailsJson: string };
    expect(searchOperation.requestId).toBe("web-search-fallback");
    expect(searchOperation.detailsJson).not.toContain("tavily-secret");

    const operation = (await sqlite
      .prepare(
        `SELECT request_id AS "requestId", details_json AS "detailsJson"
       FROM sys_operation_log
       WHERE module = 'system.aiWebSearch' AND action = 'test'
       ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { requestId: string; detailsJson: string };
    expect(operation.requestId).toBe("web-search-provider-test");
    expect(operation.detailsJson).not.toContain("tavily-secret");

    const successFirstFetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("api.tavily.com");
      return Response.json({
        results: [
          {
            title: "Primary provider result",
            url: "https://primary.example.test/result",
            content: "The highest-priority provider succeeded.",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", successFirstFetch);

    const primary = (await executeAgentTool(
      tool!,
      { query: "Primary provider", limit: 5 },
      { userId: 1, requestId: "web-search-primary" },
    )) as {
      results: Array<{ title: string }>;
      attempts: Array<{ providerCode: string; status: string }>;
    };
    expect(primary.results).toEqual([
      expect.objectContaining({ title: "Primary provider result" }),
    ]);
    expect(primary.attempts).toEqual([
      expect.objectContaining({ providerCode: "tavily-default", status: "completed" }),
    ]);
    expect(successFirstFetch).toHaveBeenCalledTimes(1);
  });

  it("hides the Tool while disabled and persists trusted Chat sources when enabled", async () => {
    const token = await login();
    expect(
      (await listAiTools({ activeOnly: true, agentId: 1 })).map((item) => item.code),
    ).not.toContain("web-search");
    const disabledOptions = await readJson<{
      agents: Array<{ code: string; toolCodes: string[] }>;
    }>(
      await app.request("/api/system/ai/chat/options", {
        headers: authHeaders(token),
      }),
    );
    expect(
      disabledOptions.data?.agents.find((agent) => agent.code === "general-assistant")?.toolCodes,
    ).not.toContain("web-search");
    await sqlite
      .prepare(
        `UPDATE sys_ai_web_search_provider
       SET status = 1, endpoint = 'https://searxng.test/search', updated_at = now()
       WHERE code = 'searxng-local'`,
      )
      .run();
    expect(
      (await listAiTools({ activeOnly: true, agentId: 1 })).map((item) => item.code),
    ).toContain("web-search");
    const enabledOptions = await readJson<{
      agents: Array<{ code: string; toolCodes: string[] }>;
    }>(
      await app.request("/api/system/ai/chat/options", {
        headers: authHeaders(token),
      }),
    );
    expect(
      enabledOptions.data?.agents.find((agent) => agent.code === "general-assistant")?.toolCodes,
    ).toContain("web-search");

    const providerResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_provider
        (name, code, provider_type, base_url, api_key_encrypted, is_default, status)
       VALUES ('Search Model Provider', 'search-model-provider', 'openai-compatible',
         'https://model.test/v1', ?, true, 1) RETURNING id`,
      )
      .run(encryptSecret("model-secret"));
    const providerId = Number(providerResult.lastInsertRowid);
    const modelResult = await sqlite
      .prepare(
        `INSERT INTO sys_ai_model
        (provider_id, name, model_id, model_type, capabilities_json, context_window,
         max_output_tokens, is_default_chat, status)
       VALUES (?, 'Search Chat', 'search-chat', 'chat', ?, 128000, 4096, true, 1)
       RETURNING id`,
      )
      .run(providerId, JSON.stringify({ chat: true, toolCalling: true }));
    const modelId = Number(modelResult.lastInsertRowid);
    await sqlite.prepare("UPDATE sys_ai_agent SET model_id = ? WHERE id = 1").run(modelId);

    let modelCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://searxng.test/search")) {
        return Response.json({
          results: [
            {
              title: "Shenzhen weather",
              url: "https://weather.example.test/shenzhen",
              content: "Shenzhen is cloudy today.",
              engine: "weather-index",
            },
          ],
        });
      }
      expect(url).toBe("https://model.test/v1/chat/completions");
      modelCalls += 1;
      return modelCalls === 1
        ? openAiToolCallStream("web-search", { query: "深圳天气", limit: 3 })
        : openAiTextStream("深圳今天多云，详细信息见下方联网来源。");
    });
    vi.stubGlobal("fetch", fetchMock);

    const createSession = await app.request("/api/system/ai/chat/sessions", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ title: "天气", modelId, agentId: 1 }),
    });
    const sessionId = Number((await readJson<{ id: number }>(createSession)).data?.id);
    const stream = await app.request(`/api/system/ai/chat/sessions/${sessionId}/messages/stream`, {
      method: "POST",
      headers: authHeaders(token, "web-search-chat"),
      body: JSON.stringify({ content: "深圳今天的天气如何？" }),
    });
    const streamText = await stream.text();
    expect(stream.status).toBe(200);
    expect(streamText).toContain("event: sources");
    expect(streamText).toContain("https://weather.example.test/shenzhen");
    expect(streamText).toContain("深圳今天多云");

    const messages = await readJson<
      Array<{
        role: string;
        metadataJson: string | null;
      }>
    >(
      await app.request(`/api/system/ai/chat/sessions/${sessionId}/messages`, {
        headers: authHeaders(token),
      }),
    );
    const assistant = messages.data?.find((item) => item.role === "assistant");
    expect(JSON.parse(String(assistant?.metadataJson))).toMatchObject({
      sources: [
        expect.objectContaining({
          title: "Shenzhen weather",
          url: "https://weather.example.test/shenzhen",
        }),
      ],
    });
    const step = (await sqlite
      .prepare(
        `SELECT output_json AS "outputJson" FROM sys_ai_agent_run_step
       WHERE tool_name = 'web-search' ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { outputJson: string };
    expect(JSON.parse(step.outputJson)).toMatchObject({
      results: [expect.objectContaining({ source: "weather-index" })],
    });
    const operation = (await sqlite
      .prepare(
        `SELECT request_id AS "requestId", details_json AS "detailsJson"
       FROM sys_operation_log
       WHERE module = 'system.aiWebSearch' AND action = 'search'
       ORDER BY id DESC LIMIT 1`,
      )
      .get()) as { requestId: string; detailsJson: string };
    expect(operation.requestId).toBe("web-search-chat");
    expect(operation.detailsJson).not.toContain("model-secret");
  });
});
