import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { sqlite } from "@/server/db";
import { generateAiStructured } from "./ai-capability-runtime-service";
import { enqueueAiJob } from "./ai-job-service";
import {
  assertAiNotebookWebsiteImportAccess,
  createAiNotebookResearchArtifact,
  getVisibleAiNotebook,
} from "./ai-notebook-service";
import { importAiNotebookWebsite } from "./ai-notebook-website-service";
import { classifyAiError } from "./ai-reliability-service";
import {
  executeWebSearch,
  type WebSearchResponse,
  type WebSearchResult,
} from "./ai-web-search-service";
import {
  createAiWorkflowRun,
  finishAiWorkflowRun,
  runPersistedAiWorkflowStep,
  startAiWorkflowRun,
} from "./ai-workflow-service";
import { recordBackgroundOperationLog } from "./operation-log-service";

const researchPlanSchema = z.object({
  queries: z.array(z.string().trim().min(2).max(300)).min(1).max(5),
});

export type NotebookSearchImportItem = {
  url: string;
  title?: string;
};

export type AiNotebookResearchDependencies = {
  plan: (input: {
    topic: string;
    queryCount: number;
    workflowRunId: number;
    userId: number;
  }) => Promise<{
    queries: string[];
    mode: "model" | "fallback";
    invocationId?: number | null;
  }>;
  search: (input: { query: string; limit: number }) => Promise<WebSearchResponse>;
  importWebsite: typeof importAiNotebookWebsite;
  createArtifact: typeof createAiNotebookResearchArtifact;
};

function parseJson(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function hydrateRun<T extends Record<string, unknown>>(row: T) {
  return { ...row, input: parseJson(row.inputJson), output: parseJson(row.outputJson) };
}

function hydrateStep<T extends Record<string, unknown>>(row: T) {
  return { ...row, input: parseJson(row.inputJson), output: parseJson(row.outputJson) };
}

function queryEvidence(query: string) {
  return {
    queryLength: query.length,
    queryHash: crypto.createHash("sha256").update(query).digest("hex"),
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  callback: (value: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await callback(values[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return output;
}

function normalizeImportItems(items: NotebookSearchImportItem[]) {
  const seen = new Set<string>();
  return items.flatMap((item) => {
    let url: URL;
    try {
      url = new URL(item.url.trim());
    } catch {
      throw new HTTPException(400, { message: "搜索结果包含无效 URL" });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new HTTPException(400, { message: "搜索结果仅支持 HTTP 或 HTTPS URL" });
    }
    url.hash = "";
    const value = url.toString();
    const key = value.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ url: value, title: item.title?.trim().slice(0, 300) || undefined }];
  });
}

async function defaultPlan(input: {
  topic: string;
  queryCount: number;
  workflowRunId: number;
  userId: number;
}) {
  try {
    const generated = await generateAiStructured({
      schema: researchPlanSchema,
      maxOutputTokens: 1200,
      temperature: 0.2,
      prompt: [
        `研究主题：${input.topic}`,
        `生成 ${input.queryCount} 个互补的联网检索词。`,
        "检索词要分别覆盖定义与背景、最新事实或数据、争议与限制；不要输出解释。",
      ].join("\n"),
      trace: {
        sourceType: "notebook_research_plan",
        sourceId: input.workflowRunId,
        userId: input.userId,
      },
    });
    return {
      queries: [
        ...new Set(generated.object.queries.map((item) => item.trim()).filter(Boolean)),
      ].slice(0, input.queryCount),
      mode: "model" as const,
      invocationId: generated.invocationId,
    };
  } catch {
    return { queries: [input.topic], mode: "fallback" as const, invocationId: null };
  }
}

function defaultDependencies(): AiNotebookResearchDependencies {
  return {
    plan: defaultPlan,
    search: ({ query, limit }) => executeWebSearch({ query, limit }),
    importWebsite: importAiNotebookWebsite,
    createArtifact: createAiNotebookResearchArtifact,
  };
}

export async function searchAiNotebookWebSources(input: {
  notebookId: number;
  query: string;
  limit?: number;
  userId: number;
  search?: AiNotebookResearchDependencies["search"];
}) {
  await assertAiNotebookWebsiteImportAccess(input);
  return (input.search ?? defaultDependencies().search)({
    query: input.query.trim(),
    limit: Math.min(Math.max(input.limit ?? 10, 1), 10),
  });
}

export async function importAiNotebookSearchResults(input: {
  notebookId: number;
  items: NotebookSearchImportItem[];
  userId: number;
  requestId?: string | null;
  importWebsite?: AiNotebookResearchDependencies["importWebsite"];
}) {
  await assertAiNotebookWebsiteImportAccess(input);
  const items = normalizeImportItems(input.items);
  if (!items.length) throw new HTTPException(400, { message: "请选择需要导入的搜索结果" });
  if (items.length > 10) throw new HTTPException(400, { message: "单次最多导入 10 个网站来源" });
  const importer = input.importWebsite ?? defaultDependencies().importWebsite;
  const results = await mapWithConcurrency(items, 3, async (item) => {
    try {
      const result = await importer({
        notebookId: input.notebookId,
        url: item.url,
        userId: input.userId,
        requestId: input.requestId,
      });
      return {
        status: result.reused ? ("reused" as const) : ("imported" as const),
        url: item.url,
        title: result.snapshot.title,
        documentId: result.documentId,
        sourceId: result.sourceId,
      };
    } catch (error) {
      return {
        status: "failed" as const,
        url: item.url,
        title: item.title,
        error: classifyAiError(error).message,
      };
    }
  });
  return {
    imported: results.filter((item) => item.status === "imported"),
    reused: results.filter((item) => item.status === "reused"),
    failed: results.filter((item) => item.status === "failed"),
  };
}

export async function enqueueAiNotebookDeepResearch(input: {
  notebookId: number;
  topic: string;
  queryCount?: number;
  maxSources?: number;
  userId: number;
  requestId?: string | null;
}) {
  await assertAiNotebookWebsiteImportAccess(input);
  const payload = {
    notebookId: input.notebookId,
    topic: input.topic.trim(),
    queryCount: Math.min(Math.max(input.queryCount ?? 3, 1), 5),
    maxSources: Math.min(Math.max(input.maxSources ?? 6, 1), 10),
  };
  const run = await createAiWorkflowRun({
    workflowCode: "notebook-deep-research",
    userId: input.userId,
    requestId: input.requestId,
    resourceType: "notebook",
    resourceId: String(input.notebookId),
    workflowInput: payload,
    initialStatus: "queued",
  });
  const jobId = await enqueueAiJob({
    jobType: "notebook_deep_research",
    payload: { workflowRunId: run.id },
    userId: input.userId,
    resourceType: "notebook_research",
    resourceId: run.id,
    requestId: input.requestId ?? undefined,
    maxAttempts: 1,
    idempotencyKey: `notebook-research-${run.id}`,
  });
  return { runId: run.id, jobId };
}

async function getResearchRunForExecution(workflowRunId: number, userId: number) {
  const row = (await sqlite
    .prepare(
      `SELECT id, status, input_json AS "inputJson"
       FROM sys_ai_workflow_run
       WHERE id = ? AND user_id = ? AND workflow_code = 'notebook-deep-research'`,
    )
    .get(workflowRunId, userId)) as { id: number; status: string; inputJson: string } | undefined;
  if (!row) throw new Error("Deep Research Run 不存在");
  return { ...row, input: parseJson(row.inputJson) as Record<string, unknown> | null };
}

async function assertResearchActive(workflowRunId: number) {
  const row = (await sqlite
    .prepare("SELECT status FROM sys_ai_workflow_run WHERE id = ?")
    .get(workflowRunId)) as { status: string } | undefined;
  if (!row || row.status === "cancelled") {
    throw new HTTPException(409, { message: "Deep Research 已取消" });
  }
}

function selectResearchResults(searches: WebSearchResponse[], limit: number) {
  const selected: WebSearchResult[] = [];
  const seen = new Set<string>();
  let index = 0;
  while (selected.length < limit && searches.some((search) => search.results[index])) {
    for (const search of searches) {
      const result = search.results[index];
      if (!result) continue;
      const key = result.url.replace(/\/$/, "").toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(result);
      if (selected.length >= limit) break;
    }
    index += 1;
  }
  return selected;
}

export async function executeAiNotebookDeepResearch(input: {
  workflowRunId: number;
  userId: number;
  requestId?: string | null;
  dependencies?: Partial<AiNotebookResearchDependencies>;
}) {
  const startedAt = performance.now();
  const run = await getResearchRunForExecution(input.workflowRunId, input.userId);
  const notebookId = Number(run.input?.notebookId);
  const topic = String(run.input?.topic ?? "").trim();
  const queryCount = Math.min(Math.max(Number(run.input?.queryCount) || 3, 1), 5);
  const maxSources = Math.min(Math.max(Number(run.input?.maxSources) || 6, 1), 10);
  if (!notebookId || !topic) throw new Error("Deep Research 输入不完整");
  await assertAiNotebookWebsiteImportAccess({ notebookId, userId: input.userId });
  await startAiWorkflowRun(input.workflowRunId);
  const dependencies = { ...defaultDependencies(), ...input.dependencies };

  try {
    const plan = await runPersistedAiWorkflowStep({
      runId: input.workflowRunId,
      stepNo: 1,
      stepCode: "plan",
      stepInput: { topicLength: topic.length, queryCount },
      execute: () =>
        dependencies.plan({
          topic,
          queryCount,
          workflowRunId: input.workflowRunId,
          userId: input.userId,
        }),
    });
    const searches: WebSearchResponse[] = [];
    for (const [index, query] of plan.queries.entries()) {
      await assertResearchActive(input.workflowRunId);
      const result = await runPersistedAiWorkflowStep({
        runId: input.workflowRunId,
        stepNo: 2 + index,
        stepCode: "search",
        stepInput: queryEvidence(query),
        execute: () => dependencies.search({ query, limit: 10 }),
      });
      searches.push(result);
    }
    const selected = selectResearchResults(searches, maxSources);
    if (!selected.length) throw new HTTPException(409, { message: "联网搜索没有返回可导入来源" });

    const importStepStart = 2 + plan.queries.length;
    const imported = await mapWithConcurrency(selected, 3, async (result, index) => {
      try {
        await assertResearchActive(input.workflowRunId);
        const value = await runPersistedAiWorkflowStep({
          runId: input.workflowRunId,
          stepNo: importStepStart + index,
          stepCode: "import_source",
          stepInput: { url: result.url, title: result.title },
          execute: () =>
            dependencies.importWebsite({
              notebookId,
              url: result.url,
              userId: input.userId,
              requestId: input.requestId,
            }),
        });
        return {
          status: value.reused ? ("reused" as const) : ("imported" as const),
          url: result.url,
          title: value.snapshot.title,
          documentId: value.documentId,
        };
      } catch (error) {
        return {
          status: "failed" as const,
          url: result.url,
          title: result.title,
          error: classifyAiError(error).message,
        };
      }
    });
    const documentIds = [
      ...new Set(imported.flatMap((item) => (item.status === "failed" ? [] : [item.documentId]))),
    ];
    if (!documentIds.length) throw new HTTPException(409, { message: "搜索来源全部导入失败" });

    await assertResearchActive(input.workflowRunId);
    const artifact = await runPersistedAiWorkflowStep({
      runId: input.workflowRunId,
      stepNo: importStepStart + selected.length,
      stepCode: "synthesize_report",
      stepInput: { topicLength: topic.length, documentIds },
      execute: () =>
        dependencies.createArtifact({
          notebookId,
          topic,
          documentIds,
          userId: input.userId,
          requestId: input.requestId,
        }),
    });
    await assertResearchActive(input.workflowRunId);
    const output = {
      notebookId,
      artifactId: artifact.id,
      ragRunId: artifact.runId,
      invocationId: artifact.invocationId,
      citationCount: artifact.citations.length,
      queries: plan.queries,
      selectedCount: selected.length,
      imported: imported.filter((item) => item.status === "imported").length,
      reused: imported.filter((item) => item.status === "reused").length,
      failed: imported.filter((item) => item.status === "failed"),
    };
    await finishAiWorkflowRun({
      id: input.workflowRunId,
      status: "completed",
      output,
      durationMs: Math.round(performance.now() - startedAt),
    });
    await recordBackgroundOperationLog({
      userId: input.userId,
      module: "system.aiNotebook",
      action: "completeDeepResearch",
      resource: "/ai/notebook/research",
      resourceId: input.workflowRunId,
      requestId: input.requestId,
      riskLevel: "medium",
      details: {
        notebookId,
        ...queryEvidence(topic),
        artifactId: artifact.id,
        selectedCount: selected.length,
        importedCount: output.imported,
        reusedCount: output.reused,
        failedCount: output.failed.length,
      },
    });
    return output;
  } catch (error) {
    const current = (await sqlite
      .prepare("SELECT status FROM sys_ai_workflow_run WHERE id = ?")
      .get(input.workflowRunId)) as { status: string } | undefined;
    if (current?.status !== "cancelled") {
      const classified = classifyAiError(error);
      await finishAiWorkflowRun({
        id: input.workflowRunId,
        status: "failed",
        errorMessage: classified.message,
        durationMs: Math.round(performance.now() - startedAt),
      });
      await recordBackgroundOperationLog({
        userId: input.userId,
        module: "system.aiNotebook",
        action: "completeDeepResearch",
        resource: "/ai/notebook/research",
        resourceId: input.workflowRunId,
        requestId: input.requestId,
        riskLevel: "medium",
        success: false,
        status: 500,
        message: classified.message,
        details: { notebookId, ...queryEvidence(topic) },
      });
    }
    throw error;
  }
}

export async function listAiNotebookResearchRuns(input: {
  notebookId: number;
  userId: number;
  page?: number;
  pageSize?: number;
}) {
  const notebook = await getVisibleAiNotebook(input.notebookId, input.userId);
  if (!notebook) throw new HTTPException(404, { message: "Notebook 不存在或无权访问" });
  const page = Math.max(input.page ?? 1, 1);
  const pageSize = Math.min(Math.max(input.pageSize ?? 10, 1), 50);
  const count = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total FROM sys_ai_workflow_run
       WHERE workflow_code = 'notebook-deep-research' AND resource_type = 'notebook' AND resource_id = ?`,
    )
    .get(String(input.notebookId))) as { total: number };
  const rows = (await sqlite
    .prepare(
      `SELECT id, workflow_code AS "workflowCode", user_id AS "userId", status,
        request_id AS "requestId", resource_type AS "resourceType", resource_id AS "resourceId",
        input_json AS "inputJson", output_json AS "outputJson", error_message AS "errorMessage",
        duration_ms AS "durationMs", started_at AS "startedAt", finished_at AS "finishedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM sys_ai_workflow_run
       WHERE workflow_code = 'notebook-deep-research' AND resource_type = 'notebook' AND resource_id = ?
       ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(String(input.notebookId), pageSize, (page - 1) * pageSize)) as Array<
    Record<string, unknown>
  >;
  return { data: rows.map(hydrateRun), page, pageSize, total: Number(count.total) };
}

export async function getAiNotebookResearchRun(input: {
  notebookId: number;
  runId: number;
  userId: number;
}) {
  const notebook = await getVisibleAiNotebook(input.notebookId, input.userId);
  if (!notebook) throw new HTTPException(404, { message: "Notebook 不存在或无权访问" });
  const row = (await sqlite
    .prepare(
      `SELECT id, workflow_code AS "workflowCode", user_id AS "userId", status,
        request_id AS "requestId", resource_type AS "resourceType", resource_id AS "resourceId",
        input_json AS "inputJson", output_json AS "outputJson", error_message AS "errorMessage",
        duration_ms AS "durationMs", started_at AS "startedAt", finished_at AS "finishedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM sys_ai_workflow_run
       WHERE id = ? AND workflow_code = 'notebook-deep-research'
         AND resource_type = 'notebook' AND resource_id = ?`,
    )
    .get(input.runId, String(input.notebookId))) as Record<string, unknown> | undefined;
  if (!row) throw new HTTPException(404, { message: "Deep Research Run 不存在" });
  const steps = (await sqlite
    .prepare(
      `SELECT id, run_id AS "runId", step_no AS "stepNo", step_code AS "stepCode", status,
        input_json AS "inputJson", output_json AS "outputJson", error_message AS "errorMessage",
        duration_ms AS "durationMs", started_at AS "startedAt", finished_at AS "finishedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM sys_ai_workflow_run_step WHERE run_id = ? ORDER BY step_no ASC, id ASC`,
    )
    .all(input.runId)) as Array<Record<string, unknown>>;
  return { ...hydrateRun(row), steps: steps.map(hydrateStep) };
}

export async function cancelAiNotebookResearchRun(input: {
  notebookId: number;
  runId: number;
  userId: number;
}) {
  await assertAiNotebookWebsiteImportAccess(input);
  const result = await sqlite
    .prepare(
      `UPDATE sys_ai_workflow_run
       SET status = 'cancelled', finished_at = now(), updated_at = now()
       WHERE id = ? AND workflow_code = 'notebook-deep-research'
         AND resource_type = 'notebook' AND resource_id = ?
         AND status IN ('queued', 'running') RETURNING id`,
    )
    .run(input.runId, String(input.notebookId));
  if (!result.changes) throw new HTTPException(409, { message: "该研究任务当前不能取消" });
  await sqlite
    .prepare(
      `UPDATE sys_ai_job SET status = 'cancelled', finished_at = now(), updated_at = now()
       WHERE resource_type = 'notebook_research' AND resource_id = ?
         AND status IN ('queued', 'running')`,
    )
    .run(String(input.runId));
}
