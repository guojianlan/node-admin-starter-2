import crypto from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { sqlite } from "@/server/db";
import { getAdminBaseEnv } from "@/server/env";
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
  candidateId?: number;
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

function canonicalCandidateUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

async function persistResearchCandidates(input: {
  notebookId: number;
  userId: number;
  query: string;
  workflowRunId?: number | null;
  response: WebSearchResponse;
}) {
  const rows: WebSearchResult[] = [];
  for (const result of input.response.results) {
    const canonicalUrl = canonicalCandidateUrl(result.url);
    const inserted = await sqlite
      .prepare(
        `INSERT INTO sys_ai_notebook_research_candidate
         (notebook_id, workflow_run_id, query_text, url, canonical_url, title, snippet, source,
          published_at, status, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)
         ON CONFLICT (notebook_id, canonical_url) WHERE deleted_at IS NULL DO UPDATE SET
           workflow_run_id = COALESCE(EXCLUDED.workflow_run_id,
             sys_ai_notebook_research_candidate.workflow_run_id),
           query_text = EXCLUDED.query_text, url = EXCLUDED.url, title = EXCLUDED.title,
           snippet = EXCLUDED.snippet, source = EXCLUDED.source, published_at = EXCLUDED.published_at,
           updated_by = EXCLUDED.updated_by
         RETURNING id, status`,
      )
      .run(
        input.notebookId,
        input.workflowRunId ?? null,
        input.query,
        result.url,
        canonicalUrl,
        result.title,
        result.snippet,
        result.source,
        result.publishedAt ?? null,
        input.userId,
        input.userId,
      );
    const candidateId = Number(inserted.lastInsertRowid);
    rows.push({ ...result, candidateId });
  }
  return { ...input.response, results: rows };
}

async function transitionResearchCandidate(input: {
  notebookId: number;
  userId: number;
  candidateId?: number;
  url: string;
  status: "accepted" | "pending" | "parsing" | "ready" | "failed";
  documentId?: number | null;
  notebookSourceId?: number | null;
  errorMessage?: string | null;
}) {
  const canonicalUrl = canonicalCandidateUrl(input.url);
  const row = (await sqlite
    .prepare(
      `SELECT id FROM sys_ai_notebook_research_candidate
       WHERE notebook_id = ? AND deleted_at IS NULL
         AND (? = 0 OR id = ?) AND canonical_url = ?
       LIMIT 1`,
    )
    .get(input.notebookId, input.candidateId ?? 0, input.candidateId ?? 0, canonicalUrl)) as
    | { id: number }
    | undefined;
  if (!row) return null;
  const documentId = input.documentId
    ? Number(
        (
          (await sqlite
            .prepare("SELECT id FROM sys_ai_document WHERE id = ? AND deleted_at IS NULL")
            .get(input.documentId)) as { id?: number } | undefined
        )?.id ?? 0,
      ) || null
    : null;
  const notebookSourceId = input.notebookSourceId
    ? Number(
        (
          (await sqlite
            .prepare("SELECT id FROM sys_ai_notebook_source WHERE id = ? AND deleted_at IS NULL")
            .get(input.notebookSourceId)) as { id?: number } | undefined
        )?.id ?? 0,
      ) || null
    : null;
  await sqlite
    .prepare(
      `UPDATE sys_ai_notebook_research_candidate
       SET status = ?, document_id = COALESCE(?, document_id),
           notebook_source_id = COALESCE(?, notebook_source_id),
           error_message = ?, accepted_at = CASE WHEN ? = 'accepted' THEN now() ELSE accepted_at END,
           parsed_at = CASE WHEN ? = 'ready' THEN now() ELSE parsed_at END,
           updated_by = ?
       WHERE id = ? AND notebook_id = ? AND deleted_at IS NULL`,
    )
    .run(
      input.status,
      documentId,
      notebookSourceId,
      input.errorMessage ?? null,
      input.status,
      input.status,
      input.userId,
      row.id,
      input.notebookId,
    );
  return row.id;
}

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
    return [
      {
        candidateId: item.candidateId,
        url: value,
        title: item.title?.trim().slice(0, 300) || undefined,
      },
    ];
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
  const response = await (input.search ?? defaultDependencies().search)({
    query: input.query.trim(),
    limit: Math.min(Math.max(input.limit ?? 10, 1), 10),
  });
  return persistResearchCandidates({
    notebookId: input.notebookId,
    userId: input.userId,
    query: input.query.trim(),
    response,
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
    await transitionResearchCandidate({
      notebookId: input.notebookId,
      userId: input.userId,
      candidateId: item.candidateId,
      url: item.url,
      status: "accepted",
    });
    await transitionResearchCandidate({
      notebookId: input.notebookId,
      userId: input.userId,
      candidateId: item.candidateId,
      url: item.url,
      status: "pending",
    });
    await transitionResearchCandidate({
      notebookId: input.notebookId,
      userId: input.userId,
      candidateId: item.candidateId,
      url: item.url,
      status: "parsing",
    });
    try {
      const result = await importer({
        notebookId: input.notebookId,
        url: item.url,
        userId: input.userId,
        requestId: input.requestId,
      });
      await transitionResearchCandidate({
        notebookId: input.notebookId,
        userId: input.userId,
        candidateId: item.candidateId,
        url: item.url,
        status: "ready",
        documentId: result.documentId,
        notebookSourceId: result.sourceId,
      });
      return {
        status: result.reused ? ("reused" as const) : ("imported" as const),
        url: item.url,
        title: result.snapshot.title,
        documentId: result.documentId,
        sourceId: result.sourceId,
      };
    } catch (error) {
      await transitionResearchCandidate({
        notebookId: input.notebookId,
        userId: input.userId,
        candidateId: item.candidateId,
        url: item.url,
        status: "failed",
        errorMessage: classifyAiError(error).message,
      });
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

export async function listAiNotebookResearchCandidates(input: {
  notebookId: number;
  userId: number;
  page?: number;
  pageSize?: number;
  status?: string;
}) {
  const notebook = await getVisibleAiNotebook(input.notebookId, input.userId);
  if (!notebook) throw new HTTPException(404, { message: "Notebook 不存在或无权访问" });
  const page = Math.max(1, Math.round(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.round(input.pageSize ?? 20)));
  const status = input.status?.trim();
  const params: Array<string | number> = [input.notebookId];
  const filter = status ? "AND status = ?" : "";
  if (status) params.push(status);
  const count = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total FROM sys_ai_notebook_research_candidate
       WHERE notebook_id = ? AND deleted_at IS NULL ${filter}`,
    )
    .get(...params)) as { total: number };
  const rows = await sqlite
    .prepare(
      `SELECT id, workflow_run_id AS "workflowRunId", query_text AS "query",
        url, canonical_url AS "canonicalUrl", title, snippet, source, published_at AS "publishedAt",
        status, document_id AS "documentId", notebook_source_id AS "notebookSourceId",
        error_message AS "errorMessage", accepted_at AS "acceptedAt", parsed_at AS "parsedAt",
        created_at AS "createdAt", updated_at AS "updatedAt"
       FROM sys_ai_notebook_research_candidate
       WHERE notebook_id = ? AND deleted_at IS NULL ${filter}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize);
  return { data: rows, page, pageSize, total: Number(count.total) };
}

export async function rejectAiNotebookResearchCandidate(input: {
  notebookId: number;
  candidateId: number;
  userId: number;
  reason?: string | null;
}) {
  await assertAiNotebookWebsiteImportAccess({ notebookId: input.notebookId, userId: input.userId });
  const result = await sqlite
    .prepare(
      `UPDATE sys_ai_notebook_research_candidate
       SET status = 'rejected', error_message = ?, updated_by = ?, updated_at = now()
       WHERE id = ? AND notebook_id = ? AND deleted_at IS NULL
         AND status IN ('candidate', 'accepted', 'failed')
       RETURNING id`,
    )
    .run(
      input.reason?.trim().slice(0, 500) || "管理员拒绝该候选来源",
      input.userId,
      input.candidateId,
      input.notebookId,
    );
  if (!result.lastInsertRowid) throw new HTTPException(409, { message: "候选来源已处理或不存在" });
  return { id: input.candidateId, status: "rejected" as const };
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
      searches.push(
        await persistResearchCandidates({
          notebookId,
          userId: input.userId,
          query,
          workflowRunId: input.workflowRunId,
          response: result,
        }),
      );
    }
    const selected = selectResearchResults(searches, maxSources);
    if (!selected.length) throw new HTTPException(409, { message: "联网搜索没有返回可导入来源" });

    const importStepStart = 2 + plan.queries.length;
    const imported = await mapWithConcurrency(selected, 3, async (result, index) => {
      try {
        await assertResearchActive(input.workflowRunId);
        await transitionResearchCandidate({
          notebookId,
          userId: input.userId,
          candidateId: result.candidateId,
          url: result.url,
          status: "accepted",
        });
        await transitionResearchCandidate({
          notebookId,
          userId: input.userId,
          candidateId: result.candidateId,
          url: result.url,
          status: "pending",
        });
        await transitionResearchCandidate({
          notebookId,
          userId: input.userId,
          candidateId: result.candidateId,
          url: result.url,
          status: "parsing",
        });
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
        await transitionResearchCandidate({
          notebookId,
          userId: input.userId,
          candidateId: result.candidateId,
          url: result.url,
          status: "ready",
          documentId: value.documentId,
        });
        return {
          status: value.reused ? ("reused" as const) : ("imported" as const),
          url: result.url,
          title: value.snapshot.title,
          documentId: value.documentId,
        };
      } catch (error) {
        await transitionResearchCandidate({
          notebookId,
          userId: input.userId,
          candidateId: result.candidateId,
          url: result.url,
          status: "failed",
          errorMessage: classifyAiError(error).message,
        });
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
    if (!documentIds.length) {
      const failureMessages = [
        ...new Set(
          imported.flatMap((item) =>
            item.status === "failed" && item.error ? [item.error.trim()] : [],
          ),
        ),
      ];
      throw new HTTPException(409, {
        message:
          failureMessages.length === 1
            ? `搜索来源全部导入失败：${failureMessages[0]}`
            : "搜索来源全部导入失败",
      });
    }

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
  const stalledAfterSeconds = getAdminBaseEnv().aiWorkerStalledAfterSeconds;
  const count = (await sqlite
    .prepare(
      `SELECT COUNT(*)::int AS total FROM sys_ai_workflow_run
       WHERE workflow_code = 'notebook-deep-research' AND resource_type = 'notebook' AND resource_id = ?`,
    )
    .get(String(input.notebookId))) as { total: number };
  const rows = (await sqlite
    .prepare(
      `SELECT run.id, run.workflow_code AS "workflowCode", run.user_id AS "userId", run.status,
        run.request_id AS "requestId", run.resource_type AS "resourceType",
        run.resource_id AS "resourceId", run.input_json AS "inputJson",
        run.output_json AS "outputJson", run.error_message AS "errorMessage",
        run.duration_ms AS "durationMs", run.started_at AS "startedAt",
        run.finished_at AS "finishedAt", run.created_at AS "createdAt",
        run.updated_at AS "updatedAt", job.id AS "jobId", job.status AS "jobStatus",
        CASE WHEN job.status = 'queued' AND job.available_at <= now() - (? * interval '1 second')
          AND job.attempts < job.max_attempts THEN true ELSE false END AS "queueStalled",
        CASE WHEN job.status = 'queued'
          THEN GREATEST(EXTRACT(EPOCH FROM (now() - job.available_at))::int, 0)
          ELSE 0 END AS "queueWaitSeconds"
       FROM sys_ai_workflow_run run
       LEFT JOIN LATERAL (
         SELECT id, status, available_at, attempts, max_attempts
         FROM sys_ai_job
         WHERE resource_type = 'notebook_research' AND resource_id = run.id::text
         ORDER BY id DESC LIMIT 1
       ) job ON true
       WHERE run.workflow_code = 'notebook-deep-research' AND run.resource_type = 'notebook'
         AND run.resource_id = ?
       ORDER BY run.id DESC LIMIT ? OFFSET ?`,
    )
    .all(stalledAfterSeconds, String(input.notebookId), pageSize, (page - 1) * pageSize)) as Array<
    Record<string, unknown>
  >;
  return {
    data: rows.map(hydrateRun),
    page,
    pageSize,
    total: Number(count.total),
    workerStalledAfterSeconds: stalledAfterSeconds,
  };
}

export async function getAiNotebookResearchRun(input: {
  notebookId: number;
  runId: number;
  userId: number;
}) {
  const notebook = await getVisibleAiNotebook(input.notebookId, input.userId);
  if (!notebook) throw new HTTPException(404, { message: "Notebook 不存在或无权访问" });
  const stalledAfterSeconds = getAdminBaseEnv().aiWorkerStalledAfterSeconds;
  const row = (await sqlite
    .prepare(
      `SELECT run.id, run.workflow_code AS "workflowCode", run.user_id AS "userId", run.status,
        run.request_id AS "requestId", run.resource_type AS "resourceType",
        run.resource_id AS "resourceId", run.input_json AS "inputJson",
        run.output_json AS "outputJson", run.error_message AS "errorMessage",
        run.duration_ms AS "durationMs", run.started_at AS "startedAt",
        run.finished_at AS "finishedAt", run.created_at AS "createdAt",
        run.updated_at AS "updatedAt", job.id AS "jobId", job.status AS "jobStatus",
        CASE WHEN job.status = 'queued' AND job.available_at <= now() - (? * interval '1 second')
          AND job.attempts < job.max_attempts THEN true ELSE false END AS "queueStalled",
        CASE WHEN job.status = 'queued'
          THEN GREATEST(EXTRACT(EPOCH FROM (now() - job.available_at))::int, 0)
          ELSE 0 END AS "queueWaitSeconds"
       FROM sys_ai_workflow_run run
       LEFT JOIN LATERAL (
         SELECT id, status, available_at, attempts, max_attempts
         FROM sys_ai_job
         WHERE resource_type = 'notebook_research' AND resource_id = run.id::text
         ORDER BY id DESC LIMIT 1
       ) job ON true
       WHERE run.id = ? AND run.workflow_code = 'notebook-deep-research'
         AND run.resource_type = 'notebook' AND run.resource_id = ?`,
    )
    .get(stalledAfterSeconds, input.runId, String(input.notebookId))) as
    | Record<string, unknown>
    | undefined;
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
  return {
    ...hydrateRun(row),
    workerStalledAfterSeconds: stalledAfterSeconds,
    steps: steps.map(hydrateStep),
  };
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
