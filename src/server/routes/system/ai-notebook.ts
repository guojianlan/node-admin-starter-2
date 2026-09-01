import crypto from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  addAiNotebookSource,
  askAiNotebook,
  createAiNotebook,
  createAiNotebookArtifact,
  deleteAiNotebook,
  deleteAiNotebookArtifact,
  getVisibleAiNotebook,
  getAiNotebookOptions,
  listAiNotebookArtifacts,
  listAiNotebooks,
  listAiNotebookSources,
  listAiNotebookMembers,
  listAiNotebookSourceOptions,
  regenerateAiNotebookArtifact,
  removeAiNotebookSource,
  removeAiNotebookMember,
  saveAiNotebookMember,
  updateAiNotebook,
} from "@/server/services/ai-notebook-service";
import { enqueueAiJob } from "@/server/services/ai-job-service";
import { importAiNotebookWebsite } from "@/server/services/ai-notebook-website-service";
import {
  cancelAiNotebookResearchRun,
  enqueueAiNotebookDeepResearch,
  getAiNotebookResearchRun,
  importAiNotebookSearchResults,
  listAiNotebookResearchRuns,
  listAiNotebookResearchCandidates,
  rejectAiNotebookResearchCandidate,
  searchAiNotebookWebSources,
} from "@/server/services/ai-notebook-research-service";
import { sanitizePersistedUrl } from "@/server/services/ai-website-source-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";

const idSchema = z.coerce.number().int().positive();
const notebookSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1200).nullable().optional(),
  scopeType: z.enum(["global", "department", "user"]).default("user"),
  deptId: idSchema.nullable().optional(),
  defaultModelId: idSchema.nullable().optional(),
  systemPrompt: z.string().trim().max(8000).nullable().optional(),
  status: z.coerce.number().int().min(0).max(1).default(1),
  sort: z.coerce.number().int().min(0).max(999999).default(0),
});
const sourceSchema = z.discriminatedUnion("sourceType", [
  z.object({ sourceType: z.literal("knowledge_base"), targetId: idSchema }),
  z.object({ sourceType: z.literal("document"), targetId: idSchema }),
]);
const websiteSourceSchema = z.object({
  url: z.string().trim().url().max(2048),
});
const webSearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(10).default(10),
});
const webSearchImportSchema = z.object({
  items: z
    .array(
      z.object({
        candidateId: idSchema.optional(),
        url: z.string().trim().url().max(2048),
        title: z.string().trim().max(300).optional(),
      }),
    )
    .min(1)
    .max(10),
});
const researchCandidateStatusSchema = z.enum([
  "candidate",
  "accepted",
  "pending",
  "parsing",
  "ready",
  "failed",
  "rejected",
]);
const deepResearchSchema = z.object({
  topic: z.string().trim().min(2).max(1000),
  queryCount: z.coerce.number().int().min(1).max(5).default(3),
  maxSources: z.coerce.number().int().min(1).max(10).default(6),
});
const askSchema = z.object({
  query: z.string().trim().min(1).max(8000),
  modelId: idSchema.nullable().optional(),
});
const artifactSchema = z.object({
  artifactType: z.enum(["summary", "outline", "faq", "brief"]),
  title: z.string().trim().max(200).nullable().optional(),
  customPrompt: z.string().trim().max(4000).nullable().optional(),
});
const memberSchema = z.object({
  userId: idSchema,
  role: z.enum(["viewer", "editor"]),
});
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
const sourceOptionsSchema = paginationSchema.extend({
  sourceType: z.enum(["knowledge_base", "document"]),
  knowledgeBaseId: idSchema.optional(),
  keyword: z.string().trim().max(200).optional(),
});

export const aiNotebookRoutes = new Hono<{ Variables: HonoVariables }>();

aiNotebookRoutes.get(
  "/ai/notebook",
  authRequired(),
  ability("system.aiNotebook.query"),
  async (c) => {
    const url = new URL(c.req.url);
    const rawStatus = url.searchParams.get("status");
    return c.json(
      success(
        await listAiNotebooks({
          userId: c.get("user").id,
          keyword: url.searchParams.get("keyword") ?? undefined,
          status: rawStatus == null || rawStatus === "" ? undefined : Number(rawStatus),
        }),
      ),
    );
  },
);

aiNotebookRoutes.post(
  "/ai/notebook/:id/sources/search/candidates/:candidateId/reject",
  authRequired(),
  ability("system.aiNotebook.update"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const candidateId = idSchema.parse(c.req.param("candidateId"));
    const payload = z.object({ reason: z.string().trim().max(500).optional() }).parse(
      await c.req.json().catch(() => ({})),
    );
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "rejectResearchCandidate",
        resource: "/ai/notebook/research-candidate",
        resourceId: candidateId,
        riskLevel: "medium",
        details: { notebookId, candidateId },
      },
      () =>
        rejectAiNotebookResearchCandidate({
          notebookId,
          candidateId,
          userId: c.get("user").id,
          reason: payload.reason,
        }),
    );
    return c.json(success(result, "候选来源已拒绝"));
  },
);

aiNotebookRoutes.post(
  "/ai/notebook",
  authRequired(),
  ability("system.aiNotebook.create"),
  async (c) => {
    const payload = notebookSchema.parse(await c.req.json());
    const id = await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "create",
        resource: "/ai/notebook",
        riskLevel: "medium",
        details: {
          scopeType: payload.scopeType,
          deptId: payload.deptId,
          defaultModelId: payload.defaultModelId,
        },
      },
      () => createAiNotebook({ payload, user: c.get("user") }),
    );
    return c.json(success({ id }, "Notebook 已创建"));
  },
);

aiNotebookRoutes.get(
  "/ai/notebook/:id/members",
  authRequired(),
  ability("system.aiNotebook.query"),
  async (c) =>
    c.json(
      success(
        await listAiNotebookMembers({
          notebookId: idSchema.parse(c.req.param("id")),
          userId: c.get("user").id,
        }),
      ),
    ),
);

aiNotebookRoutes.put(
  "/ai/notebook/:id/members",
  authRequired(),
  ability("system.aiNotebook.update"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const payload = memberSchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "saveMember",
        resource: "/ai/notebook/members",
        resourceId: notebookId,
        riskLevel: "high",
        details: payload,
      },
      () =>
        saveAiNotebookMember({
          notebookId,
          userId: c.get("user").id,
          memberUserId: payload.userId,
          role: payload.role,
        }),
    );
    return c.json(success(null, "Notebook 协作者已更新"));
  },
);

aiNotebookRoutes.delete(
  "/ai/notebook/:id/members/:userId",
  authRequired(),
  ability("system.aiNotebook.update"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const memberUserId = idSchema.parse(c.req.param("userId"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "removeMember",
        resource: "/ai/notebook/members",
        resourceId: notebookId,
        riskLevel: "high",
        details: { memberUserId },
      },
      () => removeAiNotebookMember({ notebookId, userId: c.get("user").id, memberUserId }),
    );
    return c.json(success(null, "Notebook 协作者已移除"));
  },
);

aiNotebookRoutes.get(
  "/ai/notebook/options",
  authRequired(),
  ability("system.aiNotebook.query"),
  async (c) => c.json(success(await getAiNotebookOptions(c.get("user").id))),
);

aiNotebookRoutes.get(
  "/ai/notebook/source-options",
  authRequired(),
  ability("system.aiNotebook.source"),
  async (c) => {
    const url = new URL(c.req.url);
    const query = sourceOptionsSchema.parse({
      sourceType: url.searchParams.get("sourceType") ?? undefined,
      knowledgeBaseId: url.searchParams.get("knowledgeBaseId") ?? undefined,
      keyword: url.searchParams.get("keyword") || undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    return c.json(
      success(await listAiNotebookSourceOptions({ userId: c.get("user").id, ...query })),
    );
  },
);

aiNotebookRoutes.get(
  "/ai/notebook/:id",
  authRequired(),
  ability("system.aiNotebook.query"),
  async (c) => {
    const notebook = await getVisibleAiNotebook(
      idSchema.parse(c.req.param("id")),
      c.get("user").id,
    );
    if (!notebook) throw new HTTPException(404, { message: "Notebook 不存在或无权访问" });
    return c.json(success(notebook));
  },
);

aiNotebookRoutes.put(
  "/ai/notebook/:id",
  authRequired(),
  ability("system.aiNotebook.update"),
  async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    const payload = notebookSchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "update",
        resource: "/ai/notebook",
        resourceId: id,
        riskLevel: "medium",
        details: {
          scopeType: payload.scopeType,
          deptId: payload.deptId,
          defaultModelId: payload.defaultModelId,
          status: payload.status,
        },
      },
      () => updateAiNotebook({ id, payload, user: c.get("user") }),
    );
    return c.json(success(null, "Notebook 已更新"));
  },
);

aiNotebookRoutes.delete(
  "/ai/notebook/:id",
  authRequired(),
  ability("system.aiNotebook.delete"),
  async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "delete",
        resource: "/ai/notebook",
        resourceId: id,
        riskLevel: "high",
      },
      () => deleteAiNotebook({ id, userId: c.get("user").id }),
    );
    return c.json(success(null, "Notebook 已删除"));
  },
);

aiNotebookRoutes.get(
  "/ai/notebook/:id/sources",
  authRequired(),
  ability("system.aiNotebook.query"),
  async (c) =>
    c.json(
      success(
        await listAiNotebookSources({
          notebookId: idSchema.parse(c.req.param("id")),
          userId: c.get("user").id,
        }),
      ),
    ),
);

aiNotebookRoutes.post(
  "/ai/notebook/:id/sources",
  authRequired(),
  ability("system.aiNotebook.source"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const payload = sourceSchema.parse(await c.req.json());
    const id = await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "addSource",
        resource: "/ai/notebook/sources",
        resourceId: notebookId,
        riskLevel: "medium",
        details: payload,
      },
      () =>
        addAiNotebookSource({
          notebookId,
          ...payload,
          userId: c.get("user").id,
        }),
    );
    return c.json(success({ id }, "Notebook 来源已添加"));
  },
);

aiNotebookRoutes.post(
  "/ai/notebook/:id/sources/website",
  authRequired(),
  ability("system.aiNotebook.source"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const payload = websiteSourceSchema.parse(await c.req.json());
    const safeUrl = sanitizePersistedUrl(payload.url);
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "importWebsite",
        resource: "/ai/notebook/sources/website",
        resourceId: notebookId,
        riskLevel: "medium",
        details: { url: safeUrl, domain: new URL(safeUrl).hostname },
      },
      () =>
        importAiNotebookWebsite({
          notebookId,
          url: payload.url,
          userId: c.get("user").id,
          requestId: c.get("requestId"),
        }),
    );
    return c.json(
      success(
        {
          sourceId: result.sourceId,
          documentId: result.documentId,
          knowledgeBaseId: result.knowledgeBaseId,
          reused: result.reused,
          title: result.snapshot.title,
          sourceUrl: result.snapshot.sourceUrl,
          canonicalUrl: result.snapshot.canonicalUrl,
          domain: result.snapshot.domain,
          fetchedAt: result.snapshot.fetchedAt,
        },
        result.reused ? "网站来源已存在，已更新抓取时间" : "网站来源已导入并完成索引",
      ),
    );
  },
);

aiNotebookRoutes.post(
  "/ai/notebook/:id/sources/search",
  authRequired(),
  ability("system.aiNotebook.source"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const payload = webSearchSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "searchSources",
        resource: "/ai/notebook/sources/search",
        resourceId: notebookId,
        riskLevel: "low",
        details: {
          queryLength: payload.query.length,
          queryHash: crypto.createHash("sha256").update(payload.query).digest("hex"),
          limit: payload.limit,
        },
      },
      () =>
        searchAiNotebookWebSources({
          notebookId,
          ...payload,
          userId: c.get("user").id,
        }),
    );
    return c.json(success(result));
  },
);

aiNotebookRoutes.post(
  "/ai/notebook/:id/sources/search/import",
  authRequired(),
  ability("system.aiNotebook.source"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const payload = webSearchImportSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "importSearchSources",
        resource: "/ai/notebook/sources/search/import",
        resourceId: notebookId,
        riskLevel: "medium",
        details: {
          itemCount: payload.items.length,
          domains: [...new Set(payload.items.map((item) => new URL(item.url).hostname))],
        },
      },
      () =>
        importAiNotebookSearchResults({
          notebookId,
          items: payload.items,
          userId: c.get("user").id,
          requestId: c.get("requestId"),
        }),
    );
    const successCount = result.imported.length + result.reused.length;
    return c.json(
      success(
        result,
        result.failed.length
          ? `已导入 ${successCount} 项，${result.failed.length} 项失败`
          : `已导入 ${successCount} 项来源`,
      ),
    );
  },
);

aiNotebookRoutes.get(
  "/ai/notebook/:id/sources/search/candidates",
  authRequired(),
  ability("system.aiNotebook.query"),
  async (c) => {
    const url = new URL(c.req.url);
    const pagination = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    return c.json(
      success(
        await listAiNotebookResearchCandidates({
          notebookId: idSchema.parse(c.req.param("id")),
          userId: c.get("user").id,
          status: url.searchParams.get("status")
            ? researchCandidateStatusSchema.parse(url.searchParams.get("status"))
            : undefined,
          ...pagination,
        }),
      ),
    );
  },
);

aiNotebookRoutes.post(
  "/ai/notebook/:id/research",
  authRequired(),
  ability("system.aiNotebook.artifact"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const payload = deepResearchSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "enqueueDeepResearch",
        resource: "/ai/notebook/research",
        resourceId: notebookId,
        riskLevel: "medium",
        details: {
          topicLength: payload.topic.length,
          topicHash: crypto.createHash("sha256").update(payload.topic).digest("hex"),
          queryCount: payload.queryCount,
          maxSources: payload.maxSources,
        },
      },
      () =>
        enqueueAiNotebookDeepResearch({
          notebookId,
          ...payload,
          userId: c.get("user").id,
          requestId: c.get("requestId"),
        }),
    );
    return c.json(success(result, "Deep Research 已进入后台队列"));
  },
);

aiNotebookRoutes.get(
  "/ai/notebook/:id/research",
  authRequired(),
  ability("system.aiNotebook.query"),
  async (c) => {
    const url = new URL(c.req.url);
    const pagination = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    return c.json(
      success(
        await listAiNotebookResearchRuns({
          notebookId: idSchema.parse(c.req.param("id")),
          userId: c.get("user").id,
          ...pagination,
        }),
      ),
    );
  },
);

aiNotebookRoutes.get(
  "/ai/notebook/:id/research/:runId",
  authRequired(),
  ability("system.aiNotebook.query"),
  async (c) =>
    c.json(
      success(
        await getAiNotebookResearchRun({
          notebookId: idSchema.parse(c.req.param("id")),
          runId: idSchema.parse(c.req.param("runId")),
          userId: c.get("user").id,
        }),
      ),
    ),
);

aiNotebookRoutes.delete(
  "/ai/notebook/:id/research/:runId",
  authRequired(),
  ability("system.aiNotebook.artifact"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const runId = idSchema.parse(c.req.param("runId"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "cancelDeepResearch",
        resource: "/ai/notebook/research",
        resourceId: runId,
        riskLevel: "medium",
        details: { notebookId },
      },
      () => cancelAiNotebookResearchRun({ notebookId, runId, userId: c.get("user").id }),
    );
    return c.json(success(null, "Deep Research 已取消"));
  },
);

aiNotebookRoutes.delete(
  "/ai/notebook/:id/sources/:sourceId",
  authRequired(),
  ability("system.aiNotebook.source"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const sourceId = idSchema.parse(c.req.param("sourceId"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "removeSource",
        resource: "/ai/notebook/sources",
        resourceId: sourceId,
        riskLevel: "medium",
        details: { notebookId },
      },
      () => removeAiNotebookSource({ notebookId, sourceId, userId: c.get("user").id }),
    );
    return c.json(success(null, "Notebook 来源已移除"));
  },
);

aiNotebookRoutes.post(
  "/ai/notebook/:id/ask",
  authRequired(),
  ability("system.aiNotebook.ask"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const payload = askSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "ask",
        resource: "/ai/notebook/ask",
        resourceId: notebookId,
        riskLevel: "medium",
        details: { queryLength: payload.query.length, modelId: payload.modelId },
      },
      () =>
        askAiNotebook({
          notebookId,
          ...payload,
          userId: c.get("user").id,
          requestId: c.get("requestId"),
        }),
    );
    return c.json(success(result));
  },
);

aiNotebookRoutes.get(
  "/ai/notebook/:id/artifacts",
  authRequired(),
  ability("system.aiNotebook.query"),
  async (c) => {
    const url = new URL(c.req.url);
    const pagination = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    return c.json(
      success(
        await listAiNotebookArtifacts({
          notebookId: idSchema.parse(c.req.param("id")),
          userId: c.get("user").id,
          ...pagination,
        }),
      ),
    );
  },
);

aiNotebookRoutes.post(
  "/ai/notebook/:id/artifacts",
  authRequired(),
  ability("system.aiNotebook.artifact"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const payload = artifactSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "generateArtifact",
        resource: "/ai/notebook/artifacts",
        resourceId: notebookId,
        riskLevel: "medium",
        details: {
          artifactType: payload.artifactType,
          title: payload.title,
          customPromptLength: payload.customPrompt?.length ?? 0,
        },
      },
      () =>
        createAiNotebookArtifact({
          notebookId,
          ...payload,
          userId: c.get("user").id,
          requestId: c.get("requestId"),
        }),
    );
    return c.json(success(result, "Notebook Artifact 已生成"));
  },
);

aiNotebookRoutes.post(
  "/ai/notebook/:id/artifacts/async",
  authRequired(),
  ability("system.aiNotebook.artifact"),
  async (c) => {
    const notebookId = idSchema.parse(c.req.param("id"));
    const payload = artifactSchema.parse(await c.req.json());
    const jobId = await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "enqueueArtifact",
        resource: "/ai/notebook/artifacts/async",
        resourceId: notebookId,
        riskLevel: "medium",
        details: { artifactType: payload.artifactType },
      },
      () =>
        enqueueAiJob({
          jobType: "notebook_artifact",
          payload: { notebookId, ...payload },
          userId: c.get("user").id,
          resourceType: "notebook",
          resourceId: notebookId,
          requestId: c.get("requestId"),
        }),
    );
    return c.json(success({ jobId }, "Notebook Artifact 任务已入队"));
  },
);

aiNotebookRoutes.post(
  "/ai/notebook/artifacts/:id/regenerate",
  authRequired(),
  ability("system.aiNotebook.artifact"),
  async (c) => {
    const artifactId = idSchema.parse(c.req.param("id"));
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "regenerateArtifact",
        resource: "/ai/notebook/artifacts/regenerate",
        resourceId: artifactId,
        riskLevel: "medium",
      },
      () =>
        regenerateAiNotebookArtifact({
          artifactId,
          userId: c.get("user").id,
          requestId: c.get("requestId"),
        }),
    );
    return c.json(success(result, "Notebook Artifact 已重新生成"));
  },
);

aiNotebookRoutes.delete(
  "/ai/notebook/artifacts/:id",
  authRequired(),
  ability("system.aiNotebook.artifact"),
  async (c) => {
    const artifactId = idSchema.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiNotebook",
        action: "deleteArtifact",
        resource: "/ai/notebook/artifacts",
        resourceId: artifactId,
        riskLevel: "medium",
      },
      () => deleteAiNotebookArtifact({ artifactId, userId: c.get("user").id }),
    );
    return c.json(success(null, "Notebook Artifact 已删除"));
  },
);
