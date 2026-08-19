import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/server/app";
import { sqlite } from "@/server/db";
import { executeAgentTool, type AiToolRow } from "@/server/services/ai-agent-service";
import { getAiRuntimeConfig } from "@/server/services/ai-provider-service";
import { getAdminTestPassword } from "../helpers/auth";
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
    body: JSON.stringify({ username: "admin", password: getAdminTestPassword() }),
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

function openAiReasoningTextStream(reasoningChunks: string[], textChunks: string[]) {
  const body = [
    ...reasoningChunks.map(
      (chunk, index) =>
        `data: ${JSON.stringify({
          id: "chatcmpl-reasoning-test",
          object: "chat.completion.chunk",
          created: 0,
          model: "test-chat",
          choices: [
            {
              index: 0,
              delta:
                index === 0
                  ? { role: "assistant", reasoning_content: chunk }
                  : { reasoning_content: chunk },
              finish_reason: null,
            },
          ],
        })}`,
    ),
    ...textChunks.map(
      (chunk) =>
        `data: ${JSON.stringify({
          id: "chatcmpl-reasoning-test",
          object: "chat.completion.chunk",
          created: 0,
          model: "test-chat",
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
        })}`,
    ),
    `data: ${JSON.stringify({
      id: "chatcmpl-reasoning-test",
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

function openAiToolCallStream(toolName: string, input: Record<string, unknown>) {
  const body = [
    `data: ${JSON.stringify({
      id: "chatcmpl-tool",
      object: "chat.completion.chunk",
      created: 0,
      model: "test-chat",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call-approval-1",
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
      id: "chatcmpl-tool",
      object: "chat.completion.chunk",
      created: 0,
      model: "test-chat",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    })}`,
    "data: [DONE]",
    "",
  ].join("\n\n");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function readSseEvent(text: string, eventName: string) {
  const block = text
    .split(/\n\n/)
    .find((candidate) => candidate.split("\n").includes(`event: ${eventName}`));
  const data = block
    ?.split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  return data ? (JSON.parse(data) as Record<string, unknown>) : null;
}

describe("AI provider configuration", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await resetTestDatabase();
  }, 120000);

  it("reports an unconfigured runtime as a stable not-ready state", async () => {
    const token = await login();
    for (const path of [
      "/api/system/ai/chat/runtime-config",
      "/api/system/ai/playground/runtime-config/chat",
      "/api/system/ai/runtime-config/chat",
    ]) {
      const response = await app.request(path, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await readJson<{
        ready: boolean;
        reason: string;
        provider: null;
        model: null;
      }>(response);

      expect(response.status).toBe(200);
      expect(body.data).toEqual({
        ready: false,
        reason: "AI 模型未配置",
        provider: null,
        model: null,
      });
    }
  });

  it("discovers models without persistence and completes guided AI setup atomically", async () => {
    const token = await login();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://guided-ai.test/v1/models");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer guided-secret");
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "guided-chat",
              display_name: "Guided Chat",
              context_length: 128000,
              max_completion_tokens: 16384,
            },
            {
              id: "guided-embedding",
              display_name: "Guided Embedding",
              input_token_limit: 8192,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = {
      name: "Guided AI",
      providerType: "openai-compatible",
      baseUrl: "https://guided-ai.test/v1",
      apiKey: "guided-secret",
      timeoutMs: 420000,
    };
    const discover = await app.request("/api/system/ai/setup/discover", {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "ai-setup-discover" },
      body: JSON.stringify({ provider }),
    });
    const discoverBody = await readJson<{
      models: Array<{
        id: string;
        name: string;
        modelType: string;
        contextWindow: number | null;
        maxOutputTokens: number | null;
      }>;
    }>(discover);
    expect(discover.status).toBe(200);
    expect(discoverBody.data?.models).toEqual([
      {
        id: "guided-chat",
        name: "Guided Chat",
        modelType: "chat",
        contextWindow: 128000,
        maxOutputTokens: 16384,
      },
      {
        id: "guided-embedding",
        name: "Guided Embedding",
        modelType: "embedding",
        contextWindow: 8192,
        maxOutputTokens: null,
      },
    ]);
    const beforeComplete = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/ai/provider?keyword=Guided AI", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(beforeComplete.data?.total).toBe(0);

    const invalid = await app.request("/api/system/ai/setup/complete", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        provider: { ...provider, name: "Invalid Guided AI" },
        models: [
          {
            modelId: "guided-chat",
            name: "Guided Chat",
            modelType: "chat",
            contextWindow: 128000,
            maxOutputTokens: 16384,
          },
        ],
        defaults: { embedding: "guided-chat" },
      }),
    });
    expect(invalid.status).toBe(400);
    const invalidProvider = (await sqlite
      .prepare("SELECT id FROM sys_ai_provider WHERE name = ? AND deleted_at IS NULL")
      .get("Invalid Guided AI")) as { id: number } | undefined;
    expect(invalidProvider).toBeUndefined();

    const complete = await app.request("/api/system/ai/setup/complete", {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "ai-setup-complete" },
      body: JSON.stringify({
        provider,
        models: [
          {
            modelId: "guided-chat",
            name: "Guided Chat",
            modelType: "chat",
            contextWindow: 128000,
            maxOutputTokens: 16384,
          },
          {
            modelId: "guided-embedding",
            name: "Guided Embedding",
            modelType: "embedding",
            contextWindow: 8192,
          },
        ],
        defaults: {
          chat: "guided-chat",
          structured: "guided-chat",
          embedding: "guided-embedding",
        },
        makeDefaultProvider: true,
      }),
    });
    const completeBody = await readJson<{
      providerId: number;
      providerCode: string;
      importedModels: Array<{ id: number; modelId: string }>;
    }>(complete);
    expect(complete.status).toBe(200);
    expect(completeBody.data).toMatchObject({
      providerCode: "openai-compatible-2",
      importedModels: [{ modelId: "guided-chat" }, { modelId: "guided-embedding" }],
    });

    const storedProvider = (await sqlite
      .prepare(
        `SELECT timeout_ms AS "timeoutMs", is_default AS "isDefault",
          api_key_encrypted AS "apiKeyEncrypted"
         FROM sys_ai_provider WHERE id = ?`,
      )
      .get(Number(completeBody.data?.providerId))) as
      | { timeoutMs: number; isDefault: boolean; apiKeyEncrypted: string }
      | undefined;
    expect(storedProvider).toMatchObject({ timeoutMs: 420000, isDefault: true });
    expect(storedProvider?.apiKeyEncrypted).not.toContain("guided-secret");
    const storedModels = (await sqlite
      .prepare(
        `SELECT model_id AS "modelId", is_default_chat AS "isDefaultChat",
          is_default_structured AS "isDefaultStructured",
          is_default_embedding AS "isDefaultEmbedding"
         FROM sys_ai_model WHERE provider_id = ? ORDER BY id ASC`,
      )
      .all(Number(completeBody.data?.providerId))) as Array<Record<string, unknown>>;
    expect(storedModels).toEqual([
      expect.objectContaining({
        modelId: "guided-chat",
        isDefaultChat: true,
        isDefaultStructured: true,
      }),
      expect.objectContaining({
        modelId: "guided-embedding",
        isDefaultEmbedding: true,
      }),
    ]);
    const summary = await readJson<{
      defaults: {
        chat: { modelId: string } | null;
        structured: { modelId: string } | null;
        embedding: { modelId: string } | null;
      };
    }>(
      await app.request("/api/system/ai/setup/summary", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(summary.data?.defaults).toMatchObject({
      chat: { modelId: "guided-chat" },
      structured: { modelId: "guided-chat" },
      embedding: { modelId: "guided-embedding" },
    });
    expect(await latestOperation("system.aiSetup", "discover")).toMatchObject({
      requestId: "ai-setup-discover",
      success: true,
    });
    expect(await latestOperation("system.aiSetup", "complete")).toMatchObject({
      requestId: "ai-setup-complete",
      success: true,
      riskLevel: "high",
    });
    const setupLogs = (await sqlite
      .prepare(
        `SELECT details_json AS "detailsJson"
         FROM sys_operation_log
         WHERE module = 'system.aiSetup'`,
      )
      .all()) as Array<{ detailsJson: string | null }>;
    expect(JSON.stringify(setupLogs)).not.toContain("guided-secret");
  });

  it("creates a provider from common defaults and normalizes its model list", async () => {
    const token = await login();
    const create = await app.request("/api/system/ai/provider", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        providerType: "deepseek",
        apiKey: "deepseek-secret",
        timeoutMs: 180000,
        status: 1,
      }),
    });
    expect(create.status).toBe(200);

    const providers = await readJson<
      Page<{
        id: number;
        name: string;
        code: string;
        baseUrl: string;
        hasApiKey: boolean;
        timeoutMs: number;
      }>
    >(
      await app.request("/api/system/ai/provider?keyword=DeepSeek", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const provider = providers.data?.data.find((item) => item.code.startsWith("deepseek-"));
    expect(provider).toMatchObject({
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      hasApiKey: true,
      timeoutMs: 180000,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.deepseek.com/v1/models");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer deepseek-secret",
      );
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "deepseek-chat",
              display_name: "DeepSeek Chat",
              context_length: 1000000,
              top_provider: { max_completion_tokens: 65536 },
            },
            { id: "deepseek-embedding", context_window: 8192 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(`/api/system/ai/provider/${provider?.id}/models`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await readJson<{
      endpoint: string;
      models: Array<{ id: string; name: string; modelType: string; contextWindow: number | null }>;
    }>(response);
    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      endpoint: "https://api.deepseek.com/v1/models",
      models: [
        {
          id: "deepseek-chat",
          name: "DeepSeek Chat",
          modelType: "chat",
          contextWindow: 1000000,
          maxOutputTokens: 65536,
        },
        {
          id: "deepseek-embedding",
          name: "deepseek-embedding",
          modelType: "embedding",
          contextWindow: 8192,
          maxOutputTokens: null,
        },
      ],
    });
    const testModels = await app.request(`/api/system/ai/provider/${provider?.id}/test-models`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(testModels.status).toBe(200);
    expect(await readJson(testModels)).toMatchObject({ data: { models: body.data?.models } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("creates multiple connection instances for the same provider type", async () => {
    const token = await login();
    for (const name of ["OpenAI 生产账号", "OpenAI 备用账号"]) {
      const response = await app.request("/api/system/ai/provider", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          name,
          providerType: "openai",
          apiKey: `${name}-secret`,
          status: 1,
        }),
      });
      expect(response.status).toBe(200);
    }

    const response = await app.request("/api/system/ai/provider?page=1&pageSize=200", {
      headers: { authorization: `Bearer ${token}` },
    });
    const body =
      await readJson<
        Page<{ name: string; code: string; providerType: string; hasApiKey: boolean }>
      >(response);
    const connections = (body.data?.data ?? []).filter((item) =>
      ["OpenAI 生产账号", "OpenAI 备用账号"].includes(item.name),
    );

    expect(response.status).toBe(200);
    expect(connections).toHaveLength(2);
    expect(new Set(connections.map((item) => item.code)).size).toBe(2);
    expect(connections.every((item) => item.code.startsWith("openai"))).toBe(true);
    expect(connections.every((item) => item.providerType === "openai")).toBe(true);
    expect(connections.every((item) => item.hasApiKey)).toBe(true);
  });

  it("infers model names and base capabilities from a minimal model payload", async () => {
    const token = await login();
    const providers = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/ai/provider?keyword=openai-compatible", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const providerId = Number(providers.data?.data[0]?.id);
    const create = await app.request("/api/system/ai/model", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        providerId,
        modelId: "minimal-embedding",
        modelType: "embedding",
        status: 1,
      }),
    });
    expect(create.status).toBe(200);

    const models = await readJson<
      Page<{
        name: string;
        modelId: string;
        capabilitiesJson: string;
      }>
    >(
      await app.request("/api/system/ai/model?keyword=minimal-embedding", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(models.data?.data[0]).toMatchObject({
      name: "minimal-embedding",
      modelId: "minimal-embedding",
      capabilitiesJson: '{"embedding":true}',
    });
  });

  it("deletes ordinary AI model and provider records", async () => {
    const token = await login();
    const providerCreate = await app.request("/api/system/ai/provider", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "Disposable AI Connection",
        providerType: "openai-compatible",
        baseUrl: "https://disposable-ai.test/v1",
        apiKey: "disposable-secret",
        status: 1,
      }),
    });
    expect(providerCreate.status).toBe(200);
    const providers = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/ai/provider?keyword=Disposable", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const providerId = Number(providers.data?.data[0]?.id);
    const modelCreate = await app.request("/api/system/ai/model", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        providerId,
        name: "Disposable Model",
        modelId: "disposable-model",
        modelType: "chat",
        status: 1,
      }),
    });
    expect(modelCreate.status).toBe(200);
    const models = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/ai/model?keyword=Disposable", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const modelId = Number(models.data?.data[0]?.id);

    const deleteModel = await app.request(`/api/system/ai/model/${modelId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(deleteModel.status).toBe(200);
    const deleteProvider = await app.request(`/api/system/ai/provider/${providerId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(deleteProvider.status).toBe(200);
  });

  it("rejects deleting a provider while an active model still references it", async () => {
    const token = await login();
    expect(
      await app.request("/api/system/ai/provider", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          name: "Referenced AI Connection",
          providerType: "openai-compatible",
          baseUrl: "https://referenced-ai.test/v1",
          apiKey: "referenced-secret",
          status: 1,
        }),
      }),
    ).toHaveProperty("status", 200);
    const providers = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/ai/provider?keyword=Referenced", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const providerId = Number(providers.data?.data[0]?.id);
    expect(
      await app.request("/api/system/ai/model", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          providerId,
          name: "Referenced Model",
          modelId: "referenced-model",
          modelType: "chat",
          status: 1,
        }),
      }),
    ).toHaveProperty("status", 200);

    const response = await app.request(`/api/system/ai/provider/${providerId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    const body = await readJson(response);

    expect(response.status).toBe(500);
    expect(body.msg).toContain("仍被模型");
  });

  it("keeps a model visible and allows rebinding after its provider was soft deleted", async () => {
    const token = await login();
    expect(
      await app.request("/api/system/ai/provider", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          name: "Legacy AI Connection",
          providerType: "openai-compatible",
          baseUrl: "https://legacy-ai.test/v1",
          apiKey: "legacy-secret",
          status: 1,
        }),
      }),
    ).toHaveProperty("status", 200);
    const providers = await readJson<Page<{ id: number; name: string }>>(
      await app.request("/api/system/ai/provider?page=1&pageSize=200", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const legacyProviderId = Number(
      providers.data?.data.find((item) => item.name === "Legacy AI Connection")?.id,
    );
    const targetProviderId = Number(
      providers.data?.data.find((item) => item.name === "OpenAI Compatible")?.id,
    );
    expect(legacyProviderId).toBeGreaterThan(0);
    expect(targetProviderId).toBeGreaterThan(0);

    expect(
      await app.request("/api/system/ai/model", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          providerId: legacyProviderId,
          name: "Legacy Bound Model",
          modelId: "legacy-bound-model",
          modelType: "chat",
          status: 1,
        }),
      }),
    ).toHaveProperty("status", 200);
    const models = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/ai/model?keyword=Legacy%20Bound", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const modelId = Number(models.data?.data[0]?.id);
    await sqlite
      .prepare("UPDATE sys_ai_provider SET deleted_at = now() WHERE id = ?")
      .run(legacyProviderId);

    const orphanedModels = await readJson<
      Page<{ id: number; providerId: number; providerDeletedAt: string | null }>
    >(
      await app.request("/api/system/ai/model?keyword=Legacy%20Bound", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(orphanedModels.data?.data[0]).toMatchObject({
      id: modelId,
      providerId: legacyProviderId,
    });
    expect(orphanedModels.data?.data[0]?.providerDeletedAt).toBeTruthy();

    const update = await app.request(`/api/system/ai/model/${modelId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ providerId: targetProviderId }),
    });
    expect(update.status).toBe(200);
    expect(
      await sqlite
        .prepare('SELECT provider_id AS "providerId" FROM sys_ai_model WHERE id = ?')
        .get(modelId),
    ).toMatchObject({ providerId: targetProviderId });
  });

  it("manages the AI Agent and Tool lifecycle", async () => {
    const token = await login();
    const operationLogTool: AiToolRow = {
      id: 1,
      name: "操作日志摘要",
      code: "operation-log-summary",
      description: "读取操作日志统计",
      handlerKey: "operation_log_summary",
      inputSchemaJson: null,
      configJson: null,
      riskLevel: "medium",
      approvalRequired: true,
      status: 1,
      sort: 1,
      isSystem: true,
    };
    await expect(executeAgentTool(operationLogTool, { hours: 6 }, { userId: 2 })).rejects.toThrow(
      "没有操作日志查询权限",
    );
    await expect(
      executeAgentTool(operationLogTool, { hours: 6 }, { userId: 1 }),
    ).resolves.toMatchObject({ hours: 6, rows: expect.any(Array) });

    const limitedStatus = await executeAgentTool(
      { ...operationLogTool, handlerKey: "system_status", code: "system-status" },
      {},
      { userId: 2 },
    );
    expect(limitedStatus).toMatchObject({
      hiddenMetrics: expect.arrayContaining([
        "activeUsers",
        "onlineSessions",
        "todayLogins",
        "todayOperations",
      ]),
    });
    expect(limitedStatus).not.toHaveProperty("todayOperations");

    const createTool = await app.request("/api/system/ai/tool", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "验收计算器",
        code: "acceptance-calculator",
        description: "用于 Agent CRUD 验收的计算器",
        handlerKey: "calculator",
        inputSchemaJson: JSON.stringify({ expression: "string" }),
        riskLevel: "low",
        approvalRequired: false,
        status: 1,
        sort: 20,
      }),
    });
    const createToolBody = await readJson<{ id: number }>(createTool);
    expect(createTool.status).toBe(200);

    const createAgent = await app.request("/api/system/ai/agent", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "验收 Agent",
        code: "acceptance-agent",
        description: "用于 Agent CRUD 验收",
        instructions: "回答前先确认输入，必要时使用计算器。",
        modelId: null,
        temperature: 0.3,
        maxOutputTokens: 2048,
        maxSteps: 4,
        status: 1,
        sort: 20,
        toolIds: [createToolBody.data?.id],
      }),
    });
    const createAgentBody = await readJson<{ id: number }>(createAgent);
    expect(createAgent.status).toBe(200);

    const agents = await readJson<Array<{ id: number; code: string; toolIds: number[] }>>(
      await app.request("/api/system/ai/agent", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(agents.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createAgentBody.data?.id,
          code: "acceptance-agent",
          toolIds: [createToolBody.data?.id],
        }),
      ]),
    );

    const updateAgent = await app.request(`/api/system/ai/agent/${createAgentBody.data?.id}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "验收 Agent 更新",
        code: "acceptance-agent",
        description: "已更新",
        instructions: "只输出经过确认的结果。",
        modelId: null,
        temperature: 0.2,
        maxOutputTokens: 1024,
        maxSteps: 3,
        status: 0,
        sort: 21,
        toolIds: [],
      }),
    });
    expect(updateAgent.status).toBe(200);

    const removeAgent = await app.request(`/api/system/ai/agent/${createAgentBody.data?.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removeAgent.status).toBe(200);
    const removeTool = await app.request(`/api/system/ai/tool/${createToolBody.data?.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removeTool.status).toBe(200);
  });

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
        timeoutMs: 180000,
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
      timeoutMs: 180000,
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
    const modelId = Number(
      models.data?.data.find((item) => item.modelId === "playground-chat")?.id,
    );

    const playgroundOptions = await readJson<{
      models: Array<{ id: number; modelId: string; providerCode: string }>;
    }>(
      await app.request("/api/system/ai/playground/options", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(playgroundOptions.data?.models).toContainEqual(
      expect.objectContaining({
        id: modelId,
        modelId: "playground-chat",
        providerCode: "playground-gateway",
      }),
    );
    await app.request(`/api/system/ai/model/default/${modelId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ usage: "chat" }),
    });

    await app.request("/api/system/ai/model", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        providerId,
        name: "Playground Alternate",
        modelId: "playground-alternate",
        modelType: "chat",
        capabilitiesJson: '{"chat":true,"structured":true}',
        contextWindow: 64000,
        maxOutputTokens: 4096,
        status: 1,
        sort: 2,
      }),
    });
    const updatedModels = await readJson<Page<{ id: number; modelId: string }>>(
      await app.request("/api/system/ai/model?keyword=Playground", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const alternateModelId = Number(
      updatedModels.data?.data.find((item) => item.modelId === "playground-alternate")?.id,
    );

    const updatedPlaygroundOptions = await readJson<{
      models: Array<{ id: number; modelId: string; providerCode: string }>;
    }>(
      await app.request("/api/system/ai/playground/options", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(updatedPlaygroundOptions.data?.models).toContainEqual(
      expect.objectContaining({
        id: alternateModelId,
        modelId: "playground-alternate",
        providerCode: "playground-gateway",
      }),
    );

    const runtimeConfig = await app.request(
      `/api/system/ai/playground/runtime-config/chat?modelId=${modelId}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
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

    const selectedRuntime = await readJson<{
      model: { id: number; modelId: string };
    }>(
      await app.request(
        `/api/system/ai/playground/runtime-config/chat?modelId=${alternateModelId}`,
        { headers: { authorization: `Bearer ${token}` } },
      ),
    );
    expect(selectedRuntime.data?.model).toMatchObject({
      id: alternateModelId,
      modelId: "playground-alternate",
    });

    const chatFetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://playground-ai.test/v1/chat/completions");
      expect((init?.headers as Record<string, string>).authorization).toBe(
        "Bearer playground-secret",
      );
      expect(readRequestBody(init)).toMatchObject({
        model: "playground-alternate",
        messages: [{ role: "user", content: "请返回 OK" }],
      });
      return new Response(
        JSON.stringify({
          id: "chatcmpl-playground",
          object: "chat.completion",
          created: 0,
          model: "playground-alternate",
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
        modelId: alternateModelId,
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
      model: { modelId: "playground-alternate" },
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
        model: "playground-alternate",
        stream: true,
      });
      return openAiTextStream(["O", "K"]);
    });
    vi.stubGlobal("fetch", streamFetchMock);

    const stream = await app.request("/api/system/ai/playground/chat/stream", {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "ai-playground-stream" },
      body: JSON.stringify({
        modelId: alternateModelId,
        input: "请返回 OK",
        maxOutputTokens: 1024,
      }),
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.headers.get("x-ai-playground-provider")).toBe("playground-gateway");
    expect(stream.headers.get("x-ai-playground-model")).toBe("playground-alternate");
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

  it("persists AI chat sessions and streamed messages", async () => {
    const token = await login();
    await app.request("/api/system/ai/provider", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        name: "Chat Gateway",
        code: "chat-gateway",
        providerType: "openai-compatible",
        baseUrl: "https://chat-ai.test/v1",
        apiKey: "chat-secret",
        timeoutMs: 180000,
        status: 1,
        sort: 40,
      }),
    });
    const providers = await readJson<Page<{ id: number }>>(
      await app.request("/api/system/ai/provider?keyword=chat-gateway", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const providerId = Number(providers.data?.data[0]?.id);
    await app.request(`/api/system/ai/provider/default/${providerId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({}),
    });

    await app.request("/api/system/ai/model", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        providerId,
        name: "Chat Model",
        modelId: "chat-model",
        modelType: "chat",
        capabilitiesJson: '{"chat":true}',
        maxOutputTokens: 2048,
        status: 1,
        sort: 1,
      }),
    });
    const models = await readJson<Page<{ id: number; modelId: string }>>(
      await app.request("/api/system/ai/model?keyword=Chat Model", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const modelId = Number(models.data?.data.find((item) => item.modelId === "chat-model")?.id);
    await app.request(`/api/system/ai/model/default/${modelId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ usage: "chat" }),
    });

    const createSession = await app.request("/api/system/ai/chat/sessions", {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "ai-chat-create" },
      body: JSON.stringify({ title: "测试聊天" }),
    });
    const createSessionBody = await readJson<{ id: number }>(createSession);
    expect(createSession.status).toBe(200);
    const sessionId = Number(createSessionBody.data?.id);
    expect(sessionId).toBeGreaterThan(0);
    expect(await latestOperation("system.aiChat", "create")).toMatchObject({
      requestId: "ai-chat-create",
      success: true,
      status: 200,
      riskLevel: "medium",
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://chat-ai.test/v1/chat/completions");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer chat-secret");
      expect(readRequestBody(init)).toMatchObject({
        model: "chat-model",
        stream: true,
        max_tokens: 2048,
        messages: [{ role: "user", content: "你好，回复 OK" }],
      });
      return openAiReasoningTextStream(["先分析问题"], ["O", "K"]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const stream = await app.request(`/api/system/ai/chat/sessions/${sessionId}/messages/stream`, {
      method: "POST",
      headers: { ...authHeaders(token), "x-request-id": "ai-chat-stream" },
      body: JSON.stringify({
        content: "你好，回复 OK",
        maxOutputTokens: 1024,
      }),
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(stream.headers.get("x-ai-chat-session-id")).toBe(String(sessionId));
    expect(stream.headers.get("x-ai-chat-max-output-tokens")).toBe("2048");
    expect(stream.headers.get("x-ai-chat-timeout-ms")).toBe("180000");
    const streamText = await stream.text();
    expect(streamText).toContain("event: meta");
    expect(streamText).toContain('"text":"O"');
    expect(streamText).toContain('"text":"K"');
    expect(streamText).toContain('"finishReason":"stop"');
    const finishEvent = readSseEvent(streamText, "finish");
    const timing = finishEvent?.timing as Record<string, unknown> | undefined;
    expect(timing).toMatchObject({ reasoningObserved: true });
    expect(timing?.totalMs).toEqual(expect.any(Number));
    expect(timing?.firstResponseMs).toEqual(expect.any(Number));
    expect(timing?.firstTextMs).toEqual(expect.any(Number));
    expect(timing?.reasoningMs).toEqual(expect.any(Number));
    expect(Number(timing?.totalMs)).toBeGreaterThanOrEqual(Number(timing?.firstResponseMs));
    expect(await latestOperation("system.aiChat", "chatStream")).toMatchObject({
      requestId: "ai-chat-stream",
      success: true,
      status: 200,
      riskLevel: "low",
    });

    const messages = await app.request(`/api/system/ai/chat/sessions/${sessionId}/messages`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const messagesBody = await readJson<
      Array<{
        id: number;
        role: string;
        content: string;
        status: string;
        finishReason?: string;
        usageJson?: string;
        metadataJson?: string;
        durationMs?: number;
      }>
    >(messages);
    expect(messages.status).toBe(200);
    expect(messagesBody.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "你好，回复 OK" }),
        expect.objectContaining({
          role: "assistant",
          content: "OK",
          status: "completed",
          finishReason: "stop",
        }),
      ]),
    );
    expect(messagesBody.data?.find((item) => item.role === "assistant")?.usageJson).toBeTruthy();
    const assistantMessage = messagesBody.data?.find((item) => item.role === "assistant");
    const persistedTiming = JSON.parse(String(assistantMessage?.metadataJson || "{}")) as {
      timing?: Record<string, unknown>;
    };
    expect(assistantMessage?.durationMs).toEqual(expect.any(Number));
    expect(persistedTiming.timing).toMatchObject({ reasoningObserved: true });
    expect(persistedTiming.timing?.firstTextMs).toEqual(expect.any(Number));
    expect(persistedTiming.timing?.reasoningMs).toEqual(expect.any(Number));

    const configureSession = await app.request(`/api/system/ai/chat/sessions/${sessionId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({
        modelId,
        agentId: 1,
        systemPrompt: "只用简短中文回答。",
        temperature: 0.2,
        maxOutputTokens: 1536,
      }),
    });
    expect(configureSession.status).toBe(200);

    const agentFetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = readRequestBody(init) as {
        messages?: Array<{ role: string; content: string }>;
        tools?: unknown[];
      };
      expect(body.messages?.[0]).toMatchObject({
        role: "system",
        content: expect.stringContaining("Admin Base 后台工作助手"),
      });
      expect(body.messages?.[0]?.content).toContain("只用简短中文回答。");
      expect(body.tools).toBeTruthy();
      return openAiTextStream(["Agent OK"]);
    });
    vi.stubGlobal("fetch", agentFetchMock);
    vi.stubEnv("ADMIN_BASE_AI_ORCHESTRATOR", "mastra");
    const agentStream = await app.request(
      `/api/system/ai/chat/sessions/${sessionId}/messages/stream`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ content: "使用 Agent 回答" }),
      },
    );
    expect(agentStream.status).toBe(200);
    expect(await agentStream.text()).toContain("Agent OK");
    const runs = await readJson<Array<{ status: string; totalSteps: number }>>(
      await app.request(`/api/system/ai/agent/runs?sessionId=${sessionId}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(runs.data?.[0]).toMatchObject({ status: "completed" });
    const latestRun = await readJson<{
      id: number;
      status: string;
      agentName: string;
      modelIdentifier: string;
      steps: Array<{ stepType: string; status: string }>;
    }>(
      await app.request(`/api/system/ai/chat/sessions/${sessionId}/run/latest`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(latestRun.data).toMatchObject({
      status: "completed",
      agentName: "通用工作助手",
      modelIdentifier: "chat-model",
    });
    expect(latestRun.data?.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ stepType: "model", status: "completed" })]),
    );

    const agentMessages = await readJson<Array<{ id: number; role: string }>>(
      await app.request(`/api/system/ai/chat/sessions/${sessionId}/messages`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const latestAssistantId = Number(
      [...(agentMessages.data ?? [])].reverse().find((item) => item.role === "assistant")?.id,
    );

    const regenerateMock = vi.fn(async () => openAiTextStream(["重新生成"]));
    vi.stubGlobal("fetch", regenerateMock);
    const regenerate = await app.request(
      `/api/system/ai/chat/sessions/${sessionId}/messages/${latestAssistantId}/regenerate`,
      { method: "POST", headers: authHeaders(token), body: JSON.stringify({}) },
    );
    expect(regenerate.status).toBe(200);
    expect(await regenerate.text()).toContain("重新生成");

    const regeneratedMessages = await readJson<
      Array<{ id: number; role: string; content: string; status: string }>
    >(
      await app.request(`/api/system/ai/chat/sessions/${sessionId}/messages`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const regeneratedAssistant = [...(regeneratedMessages.data ?? [])]
      .reverse()
      .find((item) => item.role === "assistant" && item.status === "completed");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("provider failed", { status: 500 })),
    );
    const failedRegenerate = await app.request(
      `/api/system/ai/chat/sessions/${sessionId}/messages/${regeneratedAssistant?.id}/regenerate`,
      { method: "POST", headers: authHeaders(token), body: JSON.stringify({}) },
    );
    expect(failedRegenerate.status).toBe(200);
    expect(await failedRegenerate.text()).toContain("event: error");
    const messagesAfterFailedRegenerate = await readJson<
      Array<{ id: number; role: string; content: string; status: string }>
    >(
      await app.request(`/api/system/ai/chat/sessions/${sessionId}/messages`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(messagesAfterFailedRegenerate.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: regeneratedAssistant?.id,
          role: "assistant",
          content: "重新生成",
          status: "completed",
        }),
        expect.objectContaining({ role: "assistant", status: "failed" }),
      ]),
    );

    const approvalFetchMock = vi.fn(async () =>
      openAiToolCallStream("operation-log-summary", { hours: 6 }),
    );
    vi.stubGlobal("fetch", approvalFetchMock);
    const approvalStream = await app.request(
      `/api/system/ai/chat/sessions/${sessionId}/messages/stream`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ content: "查看最近操作日志摘要" }),
      },
    );
    const approvalStreamText = await approvalStream.text();
    expect(approvalStreamText).toContain("event: approval");
    const approvals = await readJson<
      Array<{
        id: number;
        runId: number;
        status: string;
        toolName: string;
        toolDisplayName: string;
        toolDescription: string;
        riskLevel: string;
      }>
    >(
      await app.request(`/api/system/ai/chat/sessions/${sessionId}/approvals`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(approvals.data?.[0]).toMatchObject({
      status: "pending",
      toolName: "operation-log-summary",
      toolDisplayName: "操作日志摘要",
      riskLevel: "medium",
    });
    expect(approvals.data?.[0]?.toolDescription).toContain("操作日志");
    const approve = await app.request(
      `/api/system/ai/approval/${approvals.data?.[0]?.id}/decision`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ approved: true }),
      },
    );
    const approveBody = await readJson<{ status: string; output: unknown }>(approve);
    expect(approve.status).toBe(200);
    expect(approveBody.data).toMatchObject({
      status: "executed",
      output: expect.objectContaining({ hours: 6, rows: expect.any(Array) }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => openAiTextStream(["审批后继续完成"])),
    );
    const continuation = await app.request(
      `/api/system/ai/chat/sessions/${sessionId}/messages/stream`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ resumeApprovalId: approvals.data?.[0]?.id }),
      },
    );
    expect(continuation.status).toBe(200);
    expect(await continuation.text()).toContain("审批后继续完成");
    const continuedRun = await readJson<{
      id: number;
      status: string;
      parentRunId: number;
      sourceApprovalId: number;
    }>(
      await app.request(`/api/system/ai/chat/sessions/${sessionId}/run/latest`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(continuedRun.data).toMatchObject({
      status: "completed",
      parentRunId: approvals.data?.[0]?.runId,
      sourceApprovalId: approvals.data?.[0]?.id,
    });
    const duplicateContinuation = await app.request(
      `/api/system/ai/chat/sessions/${sessionId}/messages/stream`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ resumeApprovalId: approvals.data?.[0]?.id }),
      },
    );
    expect(duplicateContinuation.status).toBe(409);
    const duplicateApprove = await app.request(
      `/api/system/ai/approval/${approvals.data?.[0]?.id}/decision`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ approved: true }),
      },
    );
    expect(duplicateApprove.status).toBe(409);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => openAiToolCallStream("operation-log-summary", { hours: 12 })),
    );
    const denyStream = await app.request(
      `/api/system/ai/chat/sessions/${sessionId}/messages/stream`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ content: "再次请求操作日志摘要" }),
      },
    );
    expect(await denyStream.text()).toContain("event: approval");
    const pendingApprovals = await readJson<Array<{ id: number; status: string }>>(
      await app.request(`/api/system/ai/chat/sessions/${sessionId}/approvals`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const pendingApproval = pendingApprovals.data?.find((item) => item.status === "pending");
    const deny = await app.request(`/api/system/ai/approval/${pendingApproval?.id}/decision`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ approved: false, reason: "本次不允许读取审计摘要" }),
    });
    const denyBody = await readJson<{ status: string }>(deny);
    expect(deny.status).toBe(200);
    expect(denyBody.data?.status).toBe("denied");

    const exported = await app.request(
      `/api/system/ai/chat/sessions/${sessionId}/export?format=markdown`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-disposition")).toContain("ai-chat");
    expect(await exported.text()).toContain("# 测试聊天");

    const sessions = await app.request("/api/system/ai/chat/sessions", {
      headers: { authorization: `Bearer ${token}` },
    });
    const sessionsBody =
      await readJson<
        Page<{ id: number; messageCount: number; modelIdentifier: string; agentName?: string }>
      >(sessions);
    expect(sessionsBody.data?.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sessionId,
          modelIdentifier: "chat-model",
          agentName: "通用工作助手",
        }),
      ]),
    );
    expect(
      sessionsBody.data?.data.find((item) => item.id === sessionId)?.messageCount,
    ).toBeGreaterThanOrEqual(4);

    const rename = await app.request(`/api/system/ai/chat/sessions/${sessionId}`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ title: "重命名聊天" }),
    });
    expect(rename.status).toBe(200);

    const remove = await app.request(`/api/system/ai/chat/sessions/${sessionId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(remove.status).toBe(200);
    const afterDelete = await app.request(`/api/system/ai/chat/sessions/${sessionId}/messages`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterDelete.status).toBe(500);
  });
});
