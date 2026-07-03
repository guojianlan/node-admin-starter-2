import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import { getAiRuntimeConfig } from "@/server/services/ai-provider-service";
import { resetTestDatabase } from "../helpers/db";

type ApiResponse<T = unknown> = {
  success: boolean;
  msg: string;
  data?: T;
};

type Page<T> = {
  data: T[];
  total: number;
};

async function readJson<T = unknown>(response: Response) {
  return (await response.json()) as ApiResponse<T>;
}

async function login() {
  const response = await app.request("/api/system/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "123456" }),
  });
  const body = await readJson<{ token: string }>(response);
  return String(body.data?.token ?? "");
}

function authHeaders(token: string) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function latestOperation(module: string, action: string) {
  return (await sqlite
    .prepare(
      `SELECT request_id AS "requestId", success, status, risk_level AS "riskLevel"
       FROM sys_operation_log
       WHERE module = ? AND action = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(module, action)) as
    | {
        requestId: string | null;
        success: boolean;
        status: number;
        riskLevel: string;
      }
    | undefined;
}

function readRequestBody(init?: RequestInit) {
  return typeof init?.body === "string" ? JSON.parse(init.body) : {};
}

function openAiTextStream(chunks: string[]) {
  const body = [
    ...chunks.map(
      (chunk, index) =>
        `data: ${JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion.chunk",
          created: 0,
          model: "test-chat",
          choices: [
            {
              index: 0,
              delta: index === 0 ? { role: "assistant", content: chunk } : { content: chunk },
              finish_reason: null,
            },
          ],
        })}`,
    ),
    `data: ${JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "test-chat",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("AI provider configuration", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await resetTestDatabase();
  }, 120000);

  it("manages provider secrets, default protection and connection tests", async () => {
    const token = await login();
    const create = await app.request("/api/system/ai/provider", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "Local AI Gateway",
        code: "local-ai",
        providerType: "openai-compatible",
        baseUrl: "https://ai-gateway.test/v1",
        apiKey: "ai-secret",
        organization: "org-test",
        project: "project-test",
        status: 1,
        sort: 10,
        optionsJson: '{"timeout":15000}',
      }),
    });
    expect(create.status).toBe(200);

    const list = await app.request("/api/system/ai/provider?keyword=local-ai", {
      headers: { authorization: `Bearer ${token}` },
    });
    const listBody = await readJson<Page<Record<string, unknown>>>(list);
    expect(list.status).toBe(200);
    expect(listBody.data?.data[0]).toMatchObject({
      code: "local-ai",
      providerType: "openai-compatible",
      hasApiKey: true,
      organization: "org-test",
      project: "project-test",
    });
    expect(listBody.data?.data[0]).not.toHaveProperty("apiKey");
    expect(listBody.data?.data[0]).not.toHaveProperty("apiKeyEncrypted");

    const provider = listBody.data?.data[0] as { id: number };
    const stored = (await sqlite
      .prepare("SELECT api_key_encrypted AS apiKeyEncrypted FROM sys_ai_provider WHERE id = ?")
      .get(provider.id)) as { apiKeyEncrypted: string } | undefined;
    expect(stored?.apiKeyEncrypted).toBeTruthy();
    expect(stored?.apiKeyEncrypted).not.toContain("ai-secret");

    const setDefault = await app.request(`/api/system/ai/provider/default/${provider.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });
    expect(setDefault.status).toBe(200);

    const disableDefault = await app.request(`/api/system/ai/provider/status/${provider.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ status: 0 }),
    });
    expect(disableDefault.status).toBe(500);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://ai-gateway.test/v1/models");
      expect(init?.method).toBe("GET");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer ai-secret");
      expect((init?.headers as Record<string, string>)["openai-organization"]).toBe("org-test");
      expect((init?.headers as Record<string, string>)["openai-project"]).toBe("project-test");
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const test = await app.request("/api/system/ai/provider/test", {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "ai-provider-test" },
      body: JSON.stringify({ id: provider.id }),
    });
    expect(test.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await latestOperation("system.aiProvider", "test")).toMatchObject({
      requestId: "ai-provider-test",
      success: true,
      status: 200,
      riskLevel: "medium",
    });

    const chatFetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://ai-gateway.test/v1/chat/completions");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer ai-secret");
      expect(readRequestBody(init)).toMatchObject({
        model: "test-chat",
        messages: [{ role: "user", content: "请返回 OK" }],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", chatFetchMock);

    const chatTest = await app.request("/api/system/ai/provider/test", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        id: provider.id,
        mode: "chat",
        modelId: "test-chat",
        input: "请返回 OK",
      }),
    });
    const chatTestBody = await readJson<{ endpoint: string; preview: string }>(chatTest);
    expect(chatTest.status).toBe(200);
    expect(chatFetchMock).toHaveBeenCalledTimes(1);
    expect(chatTestBody.data?.endpoint).toBe("https://ai-gateway.test/v1/chat/completions");
    expect(chatTestBody.data?.preview).toContain("OK");

    const streamFetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://ai-gateway.test/v1/chat/completions");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer ai-secret");
      expect(readRequestBody(init)).toMatchObject({
        model: "test-chat",
        stream: true,
      });
      return openAiTextStream(["O", "K"]);
    });
    vi.stubGlobal("fetch", streamFetchMock);

    const streamTest = await app.request("/api/system/ai/provider/test/stream", {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "ai-provider-stream-test" },
      body: JSON.stringify({
        id: provider.id,
        mode: "chat",
        modelId: "test-chat",
        input: "请返回 OK",
      }),
    });
    expect(streamTest.status).toBe(200);
    expect(streamTest.headers.get("x-ai-test-endpoint")).toBe(
      "https://ai-gateway.test/v1/chat/completions",
    );
    await expect(streamTest.text()).resolves.toBe("OK");
    expect(streamFetchMock).toHaveBeenCalledTimes(1);
    expect(await latestOperation("system.aiProvider", "testStream")).toMatchObject({
      requestId: "ai-provider-stream-test",
      success: true,
      status: 200,
      riskLevel: "medium",
    });
  });

  it("manages default models and exposes runtime config for future business agents", async () => {
    const token = await login();
    await app.request("/api/system/ai/provider", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "Business AI",
        code: "business-ai",
        providerType: "openai-compatible",
        baseUrl: "https://business-ai.test/v1",
        apiKey: "business-secret",
        status: 1,
        sort: 20,
      }),
    });
    const providers = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/ai/provider?keyword=business-ai", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const providerId = Number(providers.data?.data[0]?.id);
    await app.request(`/api/system/ai/provider/default/${providerId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });

    const createChat = await app.request("/api/system/ai/model", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        providerId,
        name: "Business Chat",
        modelId: "business-chat",
        modelType: "chat",
        capabilitiesJson: '{"chat":true,"structured":true,"toolCalling":true}',
        contextWindow: 128000,
        maxOutputTokens: 4096,
        inputPrice: "0.15",
        outputPrice: "0.60",
        currency: "USD",
        status: 1,
        sort: 1,
      }),
    });
    expect(createChat.status).toBe(200);

    const createEmbedding = await app.request("/api/system/ai/model", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        providerId,
        name: "Business Embedding",
        modelId: "business-embedding",
        modelType: "embedding",
        capabilitiesJson: '{"embedding":true}',
        status: 1,
        sort: 2,
      }),
    });
    expect(createEmbedding.status).toBe(200);

    const models = await readJson<Page<{ id: number; modelId: string; providerName: string }>>(
      await app.request("/api/system/ai/model?keyword=Business", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(models.data?.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelId: "business-chat", providerName: "Business AI" }),
        expect.objectContaining({ modelId: "business-embedding", providerName: "Business AI" }),
      ]),
    );
    const chatModel = models.data?.data.find((item) => item.modelId === "business-chat") as {
      id: number;
    };
    const embeddingModel = models.data?.data.find(
      (item) => item.modelId === "business-embedding",
    ) as {
      id: number;
    };

    const setChat = await app.request(`/api/system/ai/model/default/${chatModel.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ usage: "chat" }),
    });
    expect(setChat.status).toBe(200);
    const setStructured = await app.request(`/api/system/ai/model/default/${chatModel.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ usage: "structured" }),
    });
    expect(setStructured.status).toBe(200);
    const setEmbedding = await app.request(`/api/system/ai/model/default/${embeddingModel.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ usage: "embedding" }),
    });
    expect(setEmbedding.status).toBe(200);

    const runtimeConfig = await getAiRuntimeConfig("chat");
    expect(runtimeConfig.provider).toMatchObject({
      code: "business-ai",
      providerType: "openai-compatible",
      baseUrl: "https://business-ai.test/v1",
      apiKey: "business-secret",
    });
    expect(runtimeConfig.model).toMatchObject({
      modelId: "business-chat",
      modelType: "chat",
      capabilities: expect.objectContaining({ structured: true, toolCalling: true }),
    });

    const publicRuntime = await app.request("/api/system/ai/runtime-config/chat", {
      headers: { authorization: `Bearer ${token}` },
    });
    const publicRuntimeBody = await readJson<{
      provider: { hasApiKey: boolean; apiKey?: string };
      model: { modelId: string };
    }>(publicRuntime);
    expect(publicRuntime.status).toBe(200);
    expect(publicRuntimeBody.data?.provider.hasApiKey).toBe(true);
    expect(publicRuntimeBody.data?.provider).not.toHaveProperty("apiKey");
    expect(publicRuntimeBody.data?.model.modelId).toBe("business-chat");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://business-ai.test/v1/chat/completions");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer business-secret",
      );
      expect(readRequestBody(init)).toMatchObject({
        model: "business-chat",
        messages: [{ role: "user", content: "请返回 OK" }],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const testModel = await app.request("/api/system/ai/model/test", {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "ai-model-test" },
      body: JSON.stringify({ id: chatModel.id, input: "请返回 OK" }),
    });
    expect(testModel.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await latestOperation("system.aiModel", "test")).toMatchObject({
      requestId: "ai-model-test",
      success: true,
      status: 200,
      riskLevel: "medium",
    });

    const streamFetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://business-ai.test/v1/chat/completions");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer business-secret",
      );
      expect(readRequestBody(init)).toMatchObject({
        model: "business-chat",
        stream: true,
      });
      return openAiTextStream(["O", "K"]);
    });
    vi.stubGlobal("fetch", streamFetchMock);

    const streamModel = await app.request("/api/system/ai/model/test/stream", {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "ai-model-stream-test" },
      body: JSON.stringify({ id: chatModel.id, input: "请返回 OK" }),
    });
    expect(streamModel.status).toBe(200);
    expect(streamModel.headers.get("x-ai-test-endpoint")).toBe(
      "https://business-ai.test/v1/chat/completions",
    );
    await expect(streamModel.text()).resolves.toBe("OK");
    expect(streamFetchMock).toHaveBeenCalledTimes(1);
    expect(await latestOperation("system.aiModel", "testStream")).toMatchObject({
      requestId: "ai-model-stream-test",
      success: true,
      status: 200,
      riskLevel: "medium",
    });
  });

  it("exposes an AI runtime playground for business calls", async () => {
    const unauthorized = await app.request("/api/system/ai/playground/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    });
    expect(unauthorized.status).toBe(401);

    const token = await login();
    await app.request("/api/system/ai/provider", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "Playground Gateway",
        code: "playground-gateway",
        providerType: "openai-compatible",
        baseUrl: "https://playground-ai.test/v1",
        apiKey: "playground-secret",
        status: 1,
        sort: 30,
      }),
    });
    const providers = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/ai/provider?keyword=playground-gateway", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const providerId = Number(providers.data?.data[0]?.id);

    await app.request("/api/system/ai/model", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        providerId,
        name: "Playground Chat",
        modelId: "playground-chat",
        modelType: "chat",
        capabilitiesJson: '{"chat":true,"structured":true}',
        contextWindow: 128000,
        maxOutputTokens: 2048,
        status: 1,
        sort: 1,
      }),
    });
    const models = await readJson<Page<{ id: number; modelId: string }>>(
      await app.request("/api/system/ai/model?keyword=Playground", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const modelId = Number(models.data?.data.find((item) => item.modelId === "playground-chat")?.id);
    await app.request(`/api/system/ai/model/default/${modelId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ usage: "chat" }),
    });

    const runtimeConfig = await app.request("/api/system/ai/playground/runtime-config/chat", {
      headers: { authorization: `Bearer ${token}` },
    });
    const runtimeConfigBody = await readJson<{
      provider: { code: string; hasApiKey: boolean; apiKey?: string };
      model: { modelId: string };
    }>(runtimeConfig);
    expect(runtimeConfig.status).toBe(200);
    expect(runtimeConfigBody.data?.provider).toMatchObject({
      code: "playground-gateway",
      hasApiKey: true,
    });
    expect(runtimeConfigBody.data?.provider).not.toHaveProperty("apiKey");
    expect(runtimeConfigBody.data?.model.modelId).toBe("playground-chat");

    const chatFetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://playground-ai.test/v1/chat/completions");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer playground-secret",
      );
      expect(readRequestBody(init)).toMatchObject({
        model: "playground-chat",
        messages: [{ role: "user", content: "请返回 OK" }],
      });
      return new Response(
        JSON.stringify({
          id: "chatcmpl-playground",
          object: "chat.completion",
          created: 0,
          model: "playground-chat",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "OK" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", chatFetchMock);

    const chat = await app.request("/api/system/ai/playground/chat", {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "ai-playground-chat" },
      body: JSON.stringify({
        usage: "chat",
        input: "请返回 OK",
        maxOutputTokens: 1024,
        timeoutMs: 30000,
      }),
    });
    const chatBody = await readJson<{
      text: string;
      finishReason: string;
      provider: { code: string; apiKey?: string };
      model: { modelId: string };
      request: { maxOutputTokens: number };
    }>(chat);
    expect(chat.status).toBe(200);
    expect(chatBody.data).toMatchObject({
      text: "OK",
      finishReason: "stop",
      provider: { code: "playground-gateway" },
      model: { modelId: "playground-chat" },
      request: { maxOutputTokens: 1024 },
    });
    expect(chatBody.data?.provider).not.toHaveProperty("apiKey");
    expect(await latestOperation("system.aiPlayground", "chat")).toMatchObject({
      requestId: "ai-playground-chat",
      success: true,
      status: 200,
      riskLevel: "low",
    });

    const streamFetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://playground-ai.test/v1/chat/completions");
      expect(readRequestBody(init)).toMatchObject({
        model: "playground-chat",
        stream: true,
      });
      return openAiTextStream(["O", "K"]);
    });
    vi.stubGlobal("fetch", streamFetchMock);

    const stream = await app.request("/api/system/ai/playground/chat/stream", {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "ai-playground-stream" },
      body: JSON.stringify({
        input: "请返回 OK",
        maxOutputTokens: 1024,
      }),
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.headers.get("x-ai-playground-provider")).toBe("playground-gateway");
    expect(stream.headers.get("x-ai-playground-model")).toBe("playground-chat");
    const streamText = await stream.text();
    expect(streamText).toContain("event: meta");
    expect(streamText).toContain('"text":"O"');
    expect(streamText).toContain('"text":"K"');
    expect(streamText).toContain('"finishReason":"stop"');
    expect(await latestOperation("system.aiPlayground", "chatStream")).toMatchObject({
      requestId: "ai-playground-stream",
      success: true,
      status: 200,
      riskLevel: "low",
    });
  });
});
