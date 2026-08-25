import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import {
  addKnowledgeDocument,
  askKnowledge,
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  getRagRun,
  indexKnowledgeDocument,
  importGeneralFileToKnowledge,
  listAvailableKnowledgeSourceFiles,
  listKnowledgeBases,
  listKnowledgeDocuments,
  searchKnowledge,
  setKnowledgeDocumentStatus,
  updateKnowledgeBase,
} from "@/server/services/ai-knowledge-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { uploadFileToDefaultStorage } from "@/server/services/storage-service";

const idSchema = z.coerce.number().int().positive();
const knowledgeBaseSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    code: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1000).nullable().optional(),
    scopeType: z.enum(["global", "department", "user"]).default("global"),
    deptId: z.coerce.number().int().positive().nullable().optional(),
    chunkPreset: z
      .enum(["auto", "documentation", "paragraph", "sentence", "recursive", "fixed"])
      .default("auto"),
    chunkSize: z.coerce.number().int().min(200).max(12000).default(1600),
    chunkOverlap: z.coerce.number().int().min(0).max(2000).default(160),
    status: z.coerce.number().int().min(0).max(1).default(1),
    sort: z.coerce.number().int().min(0).max(999999).default(0),
  })
  .superRefine((value, context) => {
    if (value.chunkOverlap >= value.chunkSize || value.chunkOverlap > value.chunkSize * 0.35) {
      context.addIssue({
        code: "custom",
        path: ["chunkOverlap"],
        message: "重叠长度必须小于目标长度的 35%",
      });
    }
  });
const searchSchema = z.object({
  query: z.string().trim().min(1).max(8000),
  knowledgeBaseIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
const askSchema = searchSchema.omit({ limit: true }).extend({
  modelId: z.coerce.number().int().positive().nullable().optional(),
});
const documentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
const sourceFileListQuerySchema = z.object({
  groupId: z.coerce.number().int().positive(),
  keyword: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const aiKnowledgeRoutes = new Hono<{ Variables: HonoVariables }>();

aiKnowledgeRoutes.get(
  "/ai/knowledge",
  authRequired(),
  ability("system.aiKnowledge.query"),
  async (c) => {
    const url = new URL(c.req.url);
    const statusValue = url.searchParams.get("status");
    return c.json(
      success(
        await listKnowledgeBases({
          userId: c.get("user").id,
          keyword: url.searchParams.get("keyword") ?? undefined,
          status: statusValue == null || statusValue === "" ? undefined : Number(statusValue),
        }),
      ),
    );
  },
);

aiKnowledgeRoutes.post(
  "/ai/knowledge",
  authRequired(),
  ability("system.aiKnowledge.create"),
  async (c) => {
    const payload = knowledgeBaseSchema.parse(await c.req.json());
    const id = await runWithOperationLog(
      c,
      {
        module: "system.aiKnowledge",
        action: "create",
        resource: "/ai/knowledge",
        riskLevel: "medium",
        details: {
          code: payload.code,
          scopeType: payload.scopeType,
          deptId: payload.deptId,
          chunkPreset: payload.chunkPreset,
          chunkSize: payload.chunkSize,
          chunkOverlap: payload.chunkOverlap,
        },
      },
      () => createKnowledgeBase({ payload, user: c.get("user") }),
    );
    return c.json(success({ id }, "知识库已创建"));
  },
);

aiKnowledgeRoutes.put(
  "/ai/knowledge/:id",
  authRequired(),
  ability("system.aiKnowledge.update"),
  async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    const payload = knowledgeBaseSchema.parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiKnowledge",
        action: "update",
        resource: "/ai/knowledge",
        resourceId: id,
        riskLevel: "medium",
        details: {
          code: payload.code,
          scopeType: payload.scopeType,
          deptId: payload.deptId,
          chunkPreset: payload.chunkPreset,
          chunkSize: payload.chunkSize,
          chunkOverlap: payload.chunkOverlap,
        },
      },
      () => updateKnowledgeBase({ id, payload, user: c.get("user") }),
    );
    return c.json(success(null, "知识库已更新"));
  },
);

aiKnowledgeRoutes.delete(
  "/ai/knowledge/:id",
  authRequired(),
  ability("system.aiKnowledge.delete"),
  async (c) => {
    const id = idSchema.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiKnowledge",
        action: "delete",
        resource: "/ai/knowledge",
        resourceId: id,
        riskLevel: "high",
      },
      () => deleteKnowledgeBase({ id, userId: c.get("user").id }),
    );
    return c.json(success(null, "知识库已删除"));
  },
);

aiKnowledgeRoutes.get(
  "/ai/knowledge/:id/source-files",
  authRequired(),
  ability("system.aiKnowledge.query"),
  ability("system.file.query"),
  async (c) => {
    const url = new URL(c.req.url);
    const query = sourceFileListQuerySchema.parse({
      groupId: url.searchParams.get("groupId") ?? undefined,
      keyword: url.searchParams.get("keyword") || undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    return c.json(
      success(
        await listAvailableKnowledgeSourceFiles({
          knowledgeBaseId: idSchema.parse(c.req.param("id")),
          userId: c.get("user").id,
          ...query,
        }),
      ),
    );
  },
);

aiKnowledgeRoutes.get(
  "/ai/knowledge/:id/documents",
  authRequired(),
  ability("system.aiKnowledge.query"),
  async (c) => {
    const url = new URL(c.req.url);
    const query = documentListQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    return c.json(
      success(
        await listKnowledgeDocuments({
          knowledgeBaseId: idSchema.parse(c.req.param("id")),
          userId: c.get("user").id,
          page: query.page,
          pageSize: query.pageSize,
        }),
      ),
    );
  },
);

aiKnowledgeRoutes.post(
  "/ai/knowledge/:id/documents/upload",
  authRequired(),
  ability("system.aiKnowledge.create"),
  async (c) => {
    const knowledgeBaseId = idSchema.parse(c.req.param("id"));
    const user = c.get("user");
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiKnowledge",
        action: "uploadDocument",
        resource: "/ai/knowledge/documents/upload",
        resourceId: knowledgeBaseId,
        riskLevel: "medium",
        details: { knowledgeBaseId },
      },
      async () => {
        const body = await c.req.parseBody();
        const file = body.file;
        if (!(file instanceof File)) throw new Error("请选择来源文件");
        const uploaded = await uploadFileToDefaultStorage({
          file,
          groupId: null,
          userId: user.id,
          usageType: "knowledge",
        });
        const documentId = await addKnowledgeDocument({
          knowledgeBaseId,
          fileId: uploaded.id,
          userId: user.id,
        });
        return { documentId, fileId: uploaded.id, deduped: uploaded.deduped };
      },
    );
    return c.json(success(result, result.deduped ? "知识来源已复用并添加" : "知识来源已上传"));
  },
);

aiKnowledgeRoutes.post(
  "/ai/knowledge/:id/documents",
  authRequired(),
  ability("system.aiKnowledge.create"),
  ability("system.file.query"),
  async (c) => {
    const knowledgeBaseId = idSchema.parse(c.req.param("id"));
    const { fileId } = z.object({ fileId: idSchema }).parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiKnowledge",
        action: "importDocument",
        resource: "/ai/knowledge/documents",
        resourceId: knowledgeBaseId,
        riskLevel: "medium",
        details: { knowledgeBaseId, sourceFileId: fileId, importMode: "library_snapshot" },
      },
      () =>
        importGeneralFileToKnowledge({
          knowledgeBaseId,
          sourceFileId: fileId,
          userId: c.get("user").id,
        }),
    );
    return c.json(
      success({ id: result.documentId, fileId: result.fileId }, "文件副本已导入知识库"),
    );
  },
);

aiKnowledgeRoutes.post(
  "/ai/knowledge/documents/:id/index",
  authRequired(),
  ability("system.aiKnowledge.index"),
  async (c) => {
    const documentId = idSchema.parse(c.req.param("id"));
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiKnowledge",
        action: "indexDocument",
        resource: "/ai/knowledge/documents/index",
        resourceId: documentId,
        riskLevel: "high",
      },
      () =>
        indexKnowledgeDocument({
          documentId,
          userId: c.get("user").id,
          requestId: c.get("requestId"),
        }),
    );
    return c.json(success(result, "文档索引已完成"));
  },
);

aiKnowledgeRoutes.put(
  "/ai/knowledge/documents/:id/status",
  authRequired(),
  ability("system.aiKnowledge.update"),
  async (c) => {
    const documentId = idSchema.parse(c.req.param("id"));
    const { status } = z
      .object({ status: z.enum(["ready", "disabled"]) })
      .parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.aiKnowledge",
        action: "updateDocumentStatus",
        resource: "/ai/knowledge/documents/status",
        resourceId: documentId,
        riskLevel: "medium",
        details: { status },
      },
      () => setKnowledgeDocumentStatus({ documentId, status, userId: c.get("user").id }),
    );
    return c.json(success(null, status === "ready" ? "文档已启用" : "文档已停用"));
  },
);

aiKnowledgeRoutes.delete(
  "/ai/knowledge/documents/:id",
  authRequired(),
  ability("system.aiKnowledge.delete"),
  async (c) => {
    const documentId = idSchema.parse(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.aiKnowledge",
        action: "deleteDocument",
        resource: "/ai/knowledge/documents",
        resourceId: documentId,
        riskLevel: "high",
      },
      () => deleteKnowledgeDocument({ documentId, userId: c.get("user").id }),
    );
    return c.json(success(null, "知识文档已删除"));
  },
);

aiKnowledgeRoutes.post(
  "/ai/knowledge/search",
  authRequired(),
  ability("system.aiKnowledge.search"),
  async (c) => {
    const payload = searchSchema.parse(await c.req.json());
    const data = await runWithOperationLog(
      c,
      {
        module: "system.aiKnowledge",
        action: "search",
        resource: "/ai/knowledge/search",
        riskLevel: "low",
        details: { knowledgeBaseIds: payload.knowledgeBaseIds ?? [], limit: payload.limit },
      },
      () =>
        searchKnowledge({
          ...payload,
          userId: c.get("user").id,
          requestId: c.get("requestId"),
        }),
    );
    return c.json(success(data));
  },
);

aiKnowledgeRoutes.post(
  "/ai/knowledge/ask",
  authRequired(),
  ability("system.aiKnowledge.search"),
  async (c) => {
    const payload = askSchema.parse(await c.req.json());
    const result = await runWithOperationLog(
      c,
      {
        module: "system.aiKnowledge",
        action: "ask",
        resource: "/ai/knowledge/ask",
        riskLevel: "medium",
        details: { knowledgeBaseIds: payload.knowledgeBaseIds ?? [], modelId: payload.modelId },
      },
      () =>
        askKnowledge({
          ...payload,
          userId: c.get("user").id,
          requestId: c.get("requestId"),
        }),
    );
    return c.json(success(result));
  },
);

aiKnowledgeRoutes.get(
  "/ai/knowledge/runs/:id",
  authRequired(),
  ability("system.aiKnowledge.query"),
  async (c) => {
    const run = await getRagRun({
      runId: idSchema.parse(c.req.param("id")),
      userId: c.get("user").id,
    });
    if (!run) throw new HTTPException(404, { message: "RAG Run 不存在" });
    return c.json(success(run));
  },
);
