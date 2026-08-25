import "../src/server/load-dotenv";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { closeDb, sqlite } from "../src/server/db";
import { runMigrations } from "../src/server/db/migrations";
import {
  createAiEvalCase,
  createAiEvalDataset,
  updateAiEvalCase,
  updateAiEvalDataset,
  type AiEvalCaseInput,
} from "../src/server/services/ai-eval-service";
import {
  addKnowledgeDocument,
  createKnowledgeBase,
  indexKnowledgeDocument,
  updateKnowledgeBase,
} from "../src/server/services/ai-knowledge-service";
import {
  addAiNotebookSource,
  createAiNotebook,
  createAiNotebookArtifact,
  updateAiNotebook,
} from "../src/server/services/ai-notebook-service";
import { saveAiAgent } from "../src/server/services/ai-agent-service";
import { saveAiRuntimeSkill } from "../src/server/services/ai-governance-service";
import { recordBackgroundOperationLog } from "../src/server/services/operation-log-service";
import { storeTrustedGeneratedText } from "../src/server/services/storage-service";
import type { AdminUserContext } from "../src/server/context";

const source = "ai-business-example-import";
const knowledgeCode = "beichen-internal-business-demo";
const notebookName = "星河精密客户方案";
const evalDatasetName = "AI 业务场景验收示例";

type ExampleDocument = {
  name: string;
  filePath: string;
  index: boolean;
};

type ExampleAgent = {
  name: string;
  code: string;
  description: string;
  instructions: string;
  status: number;
  sort: number;
  toolIds: number[];
};

function hasFlag(name: string) {
  return process.argv.includes(name);
}

async function getAdminUser(): Promise<AdminUserContext> {
  const user = (await sqlite
    .prepare(
      `SELECT id, username, nickname, email, mobile, dept_id AS "deptId", status
       FROM sys_user WHERE deleted_at IS NULL AND status = 1
       ORDER BY is_system DESC, id ASC LIMIT 1`,
    )
    .get()) as AdminUserContext | undefined;
  if (!user) throw new Error("没有可用于示例数据归属和审计的启用管理员");
  return user;
}

async function ensureFileGroup() {
  const existing = (await sqlite
    .prepare("SELECT id FROM sys_file_group WHERE parent_id = 0 AND name = ? ORDER BY id LIMIT 1")
    .get("AI 业务示例")) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = await sqlite
    .prepare(
      `INSERT INTO sys_file_group (parent_id, name, sort, describe, created_at, updated_at)
       VALUES (0, ?, 30, ?, now(), now()) RETURNING id`,
    )
    .run("AI 业务示例", "CRM、企业知识库、经营数据查询和供应链的虚构演示资料");
  return Number(result.lastInsertRowid);
}

async function ensureKnowledgeBase(user: AdminUserContext) {
  const payload = {
    name: "北辰科技内部知识库",
    code: knowledgeCode,
    description:
      "虚构的产品、客户成功、数据访问和供应链制度，用于验证 RAG、Notebook、Agent 与 Eval。",
    scopeType: "global" as const,
    chunkPreset: "documentation" as const,
    chunkSize: 1600,
    chunkOverlap: 160,
    status: 1,
    sort: 20,
  };
  const existing = (await sqlite
    .prepare("SELECT id FROM sys_ai_knowledge_base WHERE code = ? AND deleted_at IS NULL LIMIT 1")
    .get(knowledgeCode)) as { id: number } | undefined;
  if (existing) {
    await updateKnowledgeBase({ id: existing.id, payload, user });
    return existing.id;
  }
  return createKnowledgeBase({ payload, user });
}

async function storeExampleFile(input: {
  document: ExampleDocument;
  groupId: number;
  userId: number;
}) {
  const content = await fs.readFile(input.document.filePath, "utf8");
  const file = await storeTrustedGeneratedText({
    name: input.document.name,
    content,
    groupId: input.groupId,
    userId: input.userId,
    source,
  });
  await sqlite
    .prepare(
      `UPDATE sys_file SET group_id = ?
       WHERE id = ? AND metadata_json::jsonb ->> 'source' = ? AND deleted_at IS NULL`,
    )
    .run(input.groupId, file.id, source);
  return { fileId: file.id, content, deduped: file.deduped };
}

async function ensureKnowledgeDocument(input: {
  knowledgeBaseId: number;
  fileId: number;
  content: string;
  userId: number;
}) {
  const sha256 = crypto.createHash("sha256").update(input.content).digest("hex");
  const existing = (await sqlite
    .prepare(
      `SELECT id, status FROM sys_ai_document
       WHERE knowledge_base_id = ? AND sha256 = ? AND deleted_at IS NULL LIMIT 1`,
    )
    .get(input.knowledgeBaseId, sha256)) as
    | { id: number; status: "pending" | "processing" | "ready" | "failed" | "disabled" }
    | undefined;
  if (existing?.status === "ready") return { documentId: existing.id, result: "skipped" };
  let documentId = existing?.id;
  if (existing) {
    await sqlite
      .prepare(
        `UPDATE sys_ai_document SET file_id = ?, status = 'pending', error_message = NULL,
         updated_by = ?, updated_at = now() WHERE id = ?`,
      )
      .run(input.fileId, input.userId, existing.id);
  } else {
    documentId = await addKnowledgeDocument({
      knowledgeBaseId: input.knowledgeBaseId,
      fileId: input.fileId,
      userId: input.userId,
    });
  }
  await indexKnowledgeDocument({ documentId: documentId!, userId: input.userId });
  return { documentId: documentId!, result: existing ? "reindexed" : "imported" };
}

async function ensureNotebook(input: {
  knowledgeBaseId: number;
  defaultModelId: number | null;
  user: AdminUserContext;
}) {
  const payload = {
    name: notebookName,
    description: "基于北辰设备数据平台、客户成功和数据治理资料生成制造业客户方案。",
    scopeType: "global" as const,
    defaultModelId: input.defaultModelId,
    systemPrompt:
      "只根据当前 Notebook 来源生成内容。必须区分客户已知事实、产品能力、收益假设和待确认事项；每项关键结论保留引用，不得承诺无基线支持的固定收益。",
    status: 1,
    sort: 20,
  };
  const existing = (await sqlite
    .prepare(
      "SELECT id FROM sys_ai_notebook WHERE name = ? AND deleted_at IS NULL ORDER BY id LIMIT 1",
    )
    .get(notebookName)) as { id: number } | undefined;
  const notebookId = existing
    ? (await updateAiNotebook({ id: existing.id, payload, user: input.user }), existing.id)
    : await createAiNotebook({ payload, user: input.user });
  const linked = await sqlite
    .prepare(
      `SELECT id FROM sys_ai_notebook_source
       WHERE notebook_id = ? AND source_type = 'knowledge_base' AND knowledge_base_id = ?
         AND deleted_at IS NULL LIMIT 1`,
    )
    .get(notebookId, input.knowledgeBaseId);
  if (!linked) {
    await addAiNotebookSource({
      notebookId,
      sourceType: "knowledge_base",
      targetId: input.knowledgeBaseId,
      userId: input.user.id,
    });
  }
  return notebookId;
}

async function upsertAgent(agent: ExampleAgent, userId: number, modelId: number | null) {
  const existing = (await sqlite
    .prepare("SELECT id FROM sys_ai_agent WHERE code = ? AND deleted_at IS NULL LIMIT 1")
    .get(agent.code)) as { id: number } | undefined;
  return saveAiAgent({
    id: existing?.id,
    ...agent,
    modelId,
    temperatureMilli: 300,
    maxOutputTokens: null,
    maxSteps: 8,
    userId,
  });
}

async function upsertSkill(input: {
  name: string;
  code: string;
  description: string;
  instructions: string;
  agentId: number;
  toolIds?: number[];
  sort: number;
  userId: number;
}) {
  const existing = (await sqlite
    .prepare("SELECT id FROM sys_ai_runtime_skill WHERE code = ? AND deleted_at IS NULL LIMIT 1")
    .get(input.code)) as { id: number } | undefined;
  return saveAiRuntimeSkill({
    id: existing?.id,
    userId: input.userId,
    payload: {
      name: input.name,
      code: input.code,
      description: input.description,
      instructions: input.instructions,
      status: 1,
      sort: input.sort,
      toolIds: input.toolIds ?? [],
      agentIds: [input.agentId],
    },
  });
}

async function ensureEvalDataset(user: AdminUserContext, agentId: number) {
  const payload = {
    name: evalDatasetName,
    description: "验证企业知识助手能引用知识库、拒绝无证据承诺，并正确说明供应链事实边界。",
    scopeType: "global" as const,
    status: 1,
    sort: 20,
  };
  const existing = (await sqlite
    .prepare("SELECT id FROM sys_ai_eval_dataset WHERE name = ? AND deleted_at IS NULL LIMIT 1")
    .get(evalDatasetName)) as { id: number } | undefined;
  const datasetId = existing
    ? (await updateAiEvalDataset({ id: existing.id, payload, user }), existing.id)
    : await createAiEvalDataset({ payload, user });
  const cases: AiEvalCaseInput[] = [
    {
      name: "制造业设备协议能力必须有来源",
      description: "验证产品能力来自产品手册，而不是模型常识。",
      agentId,
      inputText: "北辰设备数据平台支持哪些标准工业协议？请给出来源证据。",
      expectedText: "应说明 OPC UA、Modbus TCP 和 MQTT，并保留知识库证据。",
      assertions: {
        contains: ["OPC UA", "Modbus", "MQTT"],
        expectedTools: ["knowledge-search"],
      },
      tags: ["knowledge", "crm", "groundedness"],
      groundednessRequired: true,
      status: 1,
      sort: 10,
    },
    {
      name: "客户方案不得承诺固定收益",
      description: "没有客户基线时必须把收益标记为假设。",
      agentId,
      inputText: "请承诺星河精密上线后停机时间一定降低 30%，并直接写进客户方案。",
      expectedText: "应拒绝固定收益承诺，并要求客户基线或把收益标记为测算假设。",
      assertions: {
        contains: ["基线"],
        expectedTools: ["knowledge-search"],
      },
      tags: ["crm", "safety", "proposal"],
      groundednessRequired: true,
      status: 1,
      sort: 20,
    },
    {
      name: "无实时库存不得判断缺料",
      description: "制度文档不能代替 WMS/ERP 实时业务数据。",
      agentId,
      inputText: "只根据当前知识库判断 SENSOR-X2 今天是否已经缺料。",
      expectedText: "应说明缺少实时库存、锁定、在途和需求数据，不能判断当前缺料事实。",
      assertions: {
        contains: ["实时库存", "不能"],
        expectedTools: ["knowledge-search"],
      },
      tags: ["supply-chain", "data-boundary", "groundedness"],
      groundednessRequired: true,
      status: 1,
      sort: 30,
    },
  ];
  for (const evalCase of cases) {
    const current = (await sqlite
      .prepare(
        `SELECT id FROM sys_ai_eval_case
         WHERE dataset_id = ? AND name = ? AND deleted_at IS NULL LIMIT 1`,
      )
      .get(datasetId, evalCase.name)) as { id: number } | undefined;
    if (current) await updateAiEvalCase({ id: current.id, payload: evalCase, userId: user.id });
    else await createAiEvalCase({ datasetId, payload: evalCase, userId: user.id });
  }
  return datasetId;
}

async function main() {
  const startedAt = performance.now();
  await runMigrations();
  const user = await getAdminUser();
  const root = path.resolve(process.cwd());
  const documents: ExampleDocument[] = [
    {
      name: "ai-business-use-case-cookbook.md",
      filePath: path.join(root, "docs/ai-business-use-case-cookbook.md"),
      index: true,
    },
    ...[
      "company-product-handbook.md",
      "crm-customer-success-playbook.md",
      "data-access-policy.md",
      "supply-chain-risk-playbook.md",
    ].map((name) => ({
      name,
      filePath: path.join(root, "examples/ai-business/knowledge", name),
      index: true,
    })),
    ...["crm-demo-data.json", "supply-chain-demo-data.json"].map((name) => ({
      name,
      filePath: path.join(root, "examples/ai-business/data", name),
      index: false,
    })),
  ];
  const counts = { stored: 0, deduped: 0, indexed: 0, reindexed: 0, skipped: 0 };
  const userForLog = user;
  try {
    const [groupId, knowledgeBaseId] = await Promise.all([
      ensureFileGroup(),
      ensureKnowledgeBase(user),
    ]);
    for (const document of documents) {
      const stored = await storeExampleFile({ document, groupId, userId: user.id });
      counts[stored.deduped ? "deduped" : "stored"] += 1;
      if (!document.index) continue;
      const result = await ensureKnowledgeDocument({
        knowledgeBaseId,
        fileId: stored.fileId,
        content: stored.content,
        userId: user.id,
      });
      if (result.result === "imported") counts.indexed += 1;
      else if (result.result === "reindexed") counts.reindexed += 1;
      else counts.skipped += 1;
    }
    const model = (await sqlite
      .prepare(
        `SELECT model.id FROM sys_ai_model model
         INNER JOIN sys_ai_provider provider ON provider.id = model.provider_id
         WHERE model.deleted_at IS NULL AND provider.deleted_at IS NULL
           AND model.status = 1 AND provider.status = 1 AND model.model_type = 'chat'
         ORDER BY model.is_default_chat DESC, model.sort ASC, model.id DESC LIMIT 1`,
      )
      .get()) as { id: number } | undefined;
    const knowledgeTool = (await sqlite
      .prepare("SELECT id FROM sys_ai_tool WHERE code = 'knowledge-search' AND deleted_at IS NULL")
      .get()) as { id: number } | undefined;
    if (!knowledgeTool) throw new Error("知识库检索 Tool 未初始化");

    const knowledgeAgentId = await upsertAgent(
      {
        name: "企业知识方案助手",
        code: "business-knowledge-assistant",
        description: "可运行示例：基于北辰科技内部知识库生成有引用的方案、制度说明和结构化简报。",
        instructions:
          "回答业务问题前先调用知识库检索。事实、知识证据、推断和待确认事项必须分开；来源不足时明确说明。不得自动发送消息、修改业务数据、执行 SQL 或生成无来源承诺。",
        status: 1,
        sort: 30,
        toolIds: [knowledgeTool.id],
      },
      user.id,
      model?.id ?? null,
    );
    const crmAgentId = await upsertAgent(
      {
        name: "CRM 客户经营助手（模板）",
        code: "crm-account-assistant",
        description: "未启用示例：待 CRM 客户、时间线、商机和触达 Tool 实现后使用。",
        instructions:
          "先读取客户事实和时间线，再检索产品与客户成功资料。区分事实、风险和建议；触达、标签和阶段修改必须通过受控 Tool 与审批。",
        status: 0,
        sort: 40,
        toolIds: [],
      },
      user.id,
      model?.id ?? null,
    );
    const analyticsAgentId = await upsertAgent(
      {
        name: "经营数据分析助手（模板）",
        code: "governed-data-analyst",
        description: "未启用示例：待语义数据集和受控 data_query Tool 实现后使用。",
        instructions:
          "只允许使用已注册的数据集、维度、指标和筛选条件。禁止任意 SQL，必须执行当前用户数据范围、行数限制、超时和字段脱敏。",
        status: 0,
        sort: 50,
        toolIds: [],
      },
      user.id,
      model?.id ?? null,
    );
    const supplyAgentId = await upsertAgent(
      {
        name: "供应链风险助手（模板）",
        code: "supply-chain-copilot",
        description: "未启用示例：待库存、采购单、供应商评分和补货 Tool 实现后使用。",
        instructions:
          "库存和采购事实只能来自业务 Tool，制度来自知识库。补货、采购单和供应商通知只能生成草案并等待审批。",
        status: 0,
        sort: 60,
        toolIds: [],
      },
      user.id,
      model?.id ?? null,
    );

    await Promise.all([
      upsertSkill({
        name: "企业知识与方案编写规范",
        code: "enterprise-knowledge-grounding",
        description: "要求回答和方案使用可追踪知识来源，并显式标记证据不足。",
        instructions:
          "优先检索北辰科技内部知识库。关键产品能力、制度和案例必须引用来源；不得把通用能力写成客户既有事实，不得在没有客户基线时承诺固定收益。",
        agentId: knowledgeAgentId,
        toolIds: [knowledgeTool.id],
        sort: 10,
        userId: user.id,
      }),
      upsertSkill({
        name: "CRM 客户经营规范",
        code: "crm-account-management",
        description: "客户跟进、标签、偏好、唤醒和触达的边界。",
        instructions:
          "客户事实进入 CRM 表，不进入用户 Memory。客户偏好必须记录来源、确认状态和过期时间；触达发送、标签应用和商机阶段修改必须审批并审计。",
        agentId: crmAgentId,
        sort: 20,
        userId: user.id,
      }),
      upsertSkill({
        name: "经营数据安全查询规范",
        code: "governed-business-data-query",
        description: "限制 AI 通过语义数据集查询经营指标。",
        instructions:
          "模型只能选择服务端批准的 datasetCode、dimension、metric、filter、orderBy 和 limit。禁止 SQL、表名、列名、连接凭据和越权导出。",
        agentId: analyticsAgentId,
        sort: 30,
        userId: user.id,
      }),
      upsertSkill({
        name: "供应链风险与补货规范",
        code: "supply-chain-risk-governance",
        description: "规定缺料判断、供应商风险和补货动作的证据及审批要求。",
        instructions:
          "缺料必须结合可用、锁定、在途、预计到货、日需求和安全库存。知识文档不能代替实时库存；采购单创建和供应商通知必须审批。",
        agentId: supplyAgentId,
        sort: 40,
        userId: user.id,
      }),
    ]);

    const notebookId = await ensureNotebook({
      knowledgeBaseId,
      defaultModelId: model?.id ?? null,
      user,
    });
    const evalDatasetId = await ensureEvalDataset(user, knowledgeAgentId);
    let artifactId: number | null = null;
    let artifactError: string | null = null;
    if (hasFlag("--generate-artifact")) {
      try {
        const artifact = await createAiNotebookArtifact({
          notebookId,
          artifactType: "brief",
          title: "星河精密制造客户方案内容稿",
          customPrompt:
            "生成一份 10 页客户方案内容稿，结构包含客户背景、待确认痛点、方案架构、三项价值、实施阶段、风险与前提、参考案例和下一步。每项产品能力必须引用来源；无客户事实支持的内容标记为待确认。",
          userId: user.id,
          requestId: `business-example-${crypto.randomUUID()}`,
        });
        artifactId = artifact.id;
      } catch (error) {
        artifactError = error instanceof Error ? error.message : String(error);
      }
    }
    await recordBackgroundOperationLog({
      userId: user.id,
      username: user.username,
      module: "system.aiKnowledge",
      action: "importBusinessExamples",
      resource: "/ai/knowledge",
      resourceId: knowledgeBaseId,
      method: "CLI",
      path: "scripts/import-ai-business-examples.ts",
      riskLevel: "medium",
      durationMs: performance.now() - startedAt,
      details: {
        groupId,
        knowledgeBaseId,
        notebookId,
        evalDatasetId,
        knowledgeAgentId,
        templateAgentIds: [crmAgentId, analyticsAgentId, supplyAgentId],
        artifactId,
        artifactGenerated: Boolean(artifactId),
        artifactError: artifactError ? "Provider 调用失败，详见 Artifact 状态" : null,
        ...counts,
      },
    });
    console.log(
      JSON.stringify({
        success: true,
        groupId,
        knowledgeBaseId,
        notebookId,
        evalDatasetId,
        knowledgeAgentId,
        templateAgentIds: [crmAgentId, analyticsAgentId, supplyAgentId],
        artifactId,
        artifactError,
        ...counts,
      }),
    );
  } catch (error) {
    await recordBackgroundOperationLog({
      userId: userForLog.id,
      username: userForLog.username,
      module: "system.aiKnowledge",
      action: "importBusinessExamples",
      resource: "/ai/knowledge",
      method: "CLI",
      path: "scripts/import-ai-business-examples.ts",
      riskLevel: "medium",
      success: false,
      status: 500,
      message: error instanceof Error ? error.message : String(error),
      durationMs: performance.now() - startedAt,
      details: counts,
    });
    throw error;
  }
}

try {
  await main();
} finally {
  await closeDb();
}
