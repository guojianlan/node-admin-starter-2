import "../src/server/load-dotenv";
import { closeDb, type DbClient, sqlite } from "../src/server/db";
import { encryptSecret } from "../src/server/services/secret";

function requiredText(name: string, value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function positiveInteger(name: string, value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function booleanValue(value: string | undefined, fallback: boolean) {
  if (value == null || value.trim() === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

function assertExpectedPolicy(name: string, value: string | undefined, expected: string) {
  if (value != null && value.trim() !== expected) {
    throw new Error(
      `${name}=${value.trim()} does not match the source-governed Knowledge policy (${expected})`,
    );
  }
}

async function readStdinSecret() {
  if (process.env.ADMIN_BASE_READ_AI_KEY_FROM_STDIN !== "true") return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim() || null;
}

async function upsertProvider(
  dbClient: DbClient,
  input: {
    name: string;
    code: string;
    baseUrl: string;
    apiKey: string;
    sort: number;
    userId: number;
  },
) {
  const existing = (await dbClient
    .prepare("SELECT id FROM sys_ai_provider WHERE code = ? AND deleted_at IS NULL LIMIT 1")
    .get(input.code)) as { id: number } | undefined;
  if (existing) {
    await dbClient
      .prepare(
        `UPDATE sys_ai_provider
         SET name = ?, provider_type = 'qwen', base_url = ?, api_key_encrypted = ?,
             timeout_ms = 300000, status = 1, sort = ?, updated_by = ?, updated_at = now()
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.baseUrl,
        encryptSecret(input.apiKey),
        input.sort,
        input.userId,
        existing.id,
      );
    return existing.id;
  }
  const inserted = await dbClient
    .prepare(
      `INSERT INTO sys_ai_provider
       (name, code, provider_type, base_url, api_key_encrypted, timeout_ms, status, sort,
        created_by, updated_by)
       VALUES (?, ?, 'qwen', ?, ?, 300000, 1, ?, ?, ?) RETURNING id`,
    )
    .run(
      input.name,
      input.code,
      input.baseUrl,
      encryptSecret(input.apiKey),
      input.sort,
      input.userId,
      input.userId,
    );
  return Number(inserted.lastInsertRowid);
}

async function upsertModel(
  dbClient: DbClient,
  input: {
    providerId: number;
    name: string;
    modelId: string;
    modelType: "embedding" | "rerank";
    capabilities: Record<string, unknown>;
    sort: number;
    userId: number;
  },
) {
  const existing = (await dbClient
    .prepare(
      `SELECT id FROM sys_ai_model
       WHERE provider_id = ? AND model_id = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(input.providerId, input.modelId)) as { id: number } | undefined;
  const capabilitiesJson = JSON.stringify(input.capabilities);
  if (existing) {
    await dbClient
      .prepare(
        `UPDATE sys_ai_model
         SET name = ?, model_type = ?, capabilities_json = ?, status = 1, sort = ?,
             updated_by = ?, updated_at = now()
         WHERE id = ?`,
      )
      .run(input.name, input.modelType, capabilitiesJson, input.sort, input.userId, existing.id);
    return existing.id;
  }
  const inserted = await dbClient
    .prepare(
      `INSERT INTO sys_ai_model
       (provider_id, name, model_id, model_type, capabilities_json, status, sort,
        created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?) RETURNING id`,
    )
    .run(
      input.providerId,
      input.name,
      input.modelId,
      input.modelType,
      capabilitiesJson,
      input.sort,
      input.userId,
      input.userId,
    );
  return Number(inserted.lastInsertRowid);
}

async function assignPurposeModel(
  dbClient: DbClient,
  input: { purpose: "embedding" | "rerank"; modelId: number; userId: number },
) {
  await dbClient
    .prepare(
      `INSERT INTO sys_ai_purpose_route (purpose, name, description, status, updated_by)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (purpose) DO UPDATE
       SET status = 1, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    )
    .run(
      input.purpose,
      input.purpose === "embedding" ? "向量化" : "重排序",
      input.purpose === "embedding" ? "Knowledge/RAG 文档和查询向量化" : "RAG 检索结果重排序",
      input.userId,
    );
  await dbClient.prepare("DELETE FROM sys_ai_purpose_model WHERE purpose = ?").run(input.purpose);
  await dbClient
    .prepare(
      `INSERT INTO sys_ai_purpose_model (purpose, model_id, priority, created_by)
       VALUES (?, ?, 1, ?)`,
    )
    .run(input.purpose, input.modelId, input.userId);
}

async function configureDashScopeRag() {
  const embeddingProvider = (process.env.EMBEDDING_PROVIDER || "dashscope").trim().toLowerCase();
  if (!new Set(["dashscope", "qwen"]).has(embeddingProvider)) {
    throw new Error("EMBEDDING_PROVIDER must be dashscope or qwen for this bootstrap command");
  }
  assertExpectedPolicy("EMBEDDING_BATCH_SIZE", process.env.EMBEDDING_BATCH_SIZE, "10");
  assertExpectedPolicy("RERANKER_CANDIDATE_LIMIT", process.env.RERANKER_CANDIDATE_LIMIT, "50");
  assertExpectedPolicy(
    "RERANKER_MAX_DOCUMENT_CHARS",
    process.env.RERANKER_MAX_DOCUMENT_CHARS,
    "1800",
  );
  const stdinSecret = await readStdinSecret();
  const embeddingKey = requiredText(
    "DASHSCOPE_API_KEY",
    process.env.DASHSCOPE_API_KEY || stdinSecret,
  );
  const rerankerEnabled = booleanValue(process.env.RERANKER_ENABLED, true);
  const rerankerKey = rerankerEnabled
    ? requiredText("RERANKER_API_KEY", process.env.RERANKER_API_KEY || stdinSecret || embeddingKey)
    : null;
  const embeddingBaseUrl = requiredText(
    "DASHSCOPE_BASE_URL",
    process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
  );
  const embeddingModelId = requiredText(
    "EMBEDDING_MODEL",
    process.env.EMBEDDING_MODEL || "text-embedding-v4",
  );
  const embeddingDimensions = positiveInteger(
    "EMBEDDING_DIMENSIONS",
    process.env.EMBEDDING_DIMENSIONS,
    1024,
  );
  const rerankerBaseUrl = requiredText(
    "RERANKER_BASE_URL",
    process.env.RERANKER_BASE_URL || "https://dashscope.aliyuncs.com/compatible-api/v1",
  );
  const rerankerModelId = requiredText(
    "RERANKER_MODEL",
    process.env.RERANKER_MODEL || "qwen3-rerank",
  );
  const admin = (await sqlite
    .prepare(
      `SELECT id, username FROM sys_user
       WHERE deleted_at IS NULL AND status = 1 ORDER BY is_system DESC, id ASC LIMIT 1`,
    )
    .get()) as { id: number; username: string } | undefined;
  if (!admin) throw new Error("No active administrator is available for audit ownership");

  const configured = await sqlite.transaction(async (dbClient) => {
    const embeddingProviderId = await upsertProvider(dbClient, {
      name: "Qwen / DashScope Embedding",
      code: "qwen",
      baseUrl: embeddingBaseUrl,
      apiKey: embeddingKey,
      sort: 60,
      userId: admin.id,
    });
    const embeddingModelIdNumber = await upsertModel(dbClient, {
      providerId: embeddingProviderId,
      name: embeddingModelId,
      modelId: embeddingModelId,
      modelType: "embedding",
      capabilities: { embedding: true, dimensions: embeddingDimensions },
      sort: 1,
      userId: admin.id,
    });
    await dbClient.prepare("UPDATE sys_ai_model SET is_default_embedding = false").run();
    await dbClient
      .prepare("UPDATE sys_ai_model SET is_default_embedding = true WHERE id = ?")
      .run(embeddingModelIdNumber);
    await assignPurposeModel(dbClient, {
      purpose: "embedding",
      modelId: embeddingModelIdNumber,
      userId: admin.id,
    });

    let rerankerProviderId: number | null = null;
    let rerankerModelIdNumber: number | null = null;
    if (rerankerEnabled && rerankerKey) {
      rerankerProviderId = await upsertProvider(dbClient, {
        name: "Qwen / DashScope Rerank",
        code: "qwen-rerank",
        baseUrl: rerankerBaseUrl,
        apiKey: rerankerKey,
        sort: 61,
        userId: admin.id,
      });
      rerankerModelIdNumber = await upsertModel(dbClient, {
        providerId: rerankerProviderId,
        name: rerankerModelId,
        modelId: rerankerModelId,
        modelType: "rerank",
        capabilities: { rerank: true, protocol: "dashscope-compatible" },
        sort: 1,
        userId: admin.id,
      });
      await assignPurposeModel(dbClient, {
        purpose: "rerank",
        modelId: rerankerModelIdNumber,
        userId: admin.id,
      });
    }

    await dbClient
      .prepare(
        `INSERT INTO sys_operation_log
         (user_id, username, module, action, resource, method, path, request_id,
          status, success, risk_level, message, details_json)
         VALUES (?, ?, 'system.aiRuntime', 'configureDashscopeRag', '/ai/runtime/purposes',
          'CLI', 'scripts/configure-dashscope-rag.ts', ?, 200, true, 'high', ?, ?)`,
      )
      .run(
        admin.id,
        admin.username,
        `dashscope-rag-config-${Date.now()}`,
        "DashScope Embedding/Rerank configuration updated",
        JSON.stringify({
          embeddingProviderId,
          embeddingModelId: embeddingModelIdNumber,
          embeddingDimensions,
          rerankerEnabled,
          rerankerProviderId,
          rerankerModelId: rerankerModelIdNumber,
        }),
      );
    return {
      embeddingProviderId,
      embeddingModelId: embeddingModelIdNumber,
      rerankerProviderId,
      rerankerModelId: rerankerModelIdNumber,
    };
  });

  console.log(JSON.stringify({ success: true, ...configured }));
}

try {
  await configureDashScopeRag();
} finally {
  await closeDb();
}
