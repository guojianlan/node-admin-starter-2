import path from "node:path";
import { HTTPException } from "hono/http-exception";
import { sqlite } from "@/server/db";
import { addKnowledgeDocument, indexKnowledgeDocument } from "./ai-knowledge-service";
import {
  addAiNotebookSource,
  assertAiNotebookWebsiteImportAccess,
  prepareAiNotebookWebsiteImport,
} from "./ai-notebook-service";
import {
  fetchWebsiteSource,
  type WebsiteSourceRuntime,
  type WebsiteSourceSnapshot,
} from "./ai-website-source-service";
import { storeTrustedGeneratedText } from "./storage-service";

function safeSnapshotName(snapshot: WebsiteSourceSnapshot) {
  const stem = `${snapshot.domain}-${snapshot.title}`
    .normalize("NFKD")
    .replaceAll(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 100);
  return `${stem || "website-snapshot"}-${snapshot.contentHash.slice(0, 10)}.md`;
}

async function findExistingWebsiteDocument(input: {
  knowledgeBaseId: number;
  canonicalUrl: string;
}) {
  return (await sqlite
    .prepare(
      `SELECT id, status, content_hash AS "contentHash"
       FROM sys_ai_document
       WHERE knowledge_base_id = ? AND source_type = 'web_url' AND canonical_url = ?
         AND deleted_at IS NULL
       ORDER BY version DESC, id DESC LIMIT 1`,
    )
    .get(input.knowledgeBaseId, input.canonicalUrl)) as
    | { id: number; status: string; contentHash: string | null }
    | undefined;
}

async function findActiveNotebookDocumentSource(notebookId: number, documentId: number) {
  return (await sqlite
    .prepare(
      `SELECT id FROM sys_ai_notebook_source
       WHERE notebook_id = ? AND source_type = 'document' AND document_id = ?
         AND deleted_at IS NULL`,
    )
    .get(notebookId, documentId)) as { id: number } | undefined;
}

async function updateWebsiteDocumentMetadata(input: {
  documentId: number;
  snapshot: WebsiteSourceSnapshot;
  userId: number;
}) {
  await sqlite
    .prepare(
      `UPDATE sys_ai_document
       SET source_type = 'web_url', source_url = ?, canonical_url = ?, source_domain = ?,
           source_title = ?, published_at = ?, fetched_at = ?, content_hash = ?,
           updated_by = ?, updated_at = now()
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      input.snapshot.sourceUrl,
      input.snapshot.canonicalUrl,
      input.snapshot.domain,
      input.snapshot.title,
      input.snapshot.publishedAt,
      input.snapshot.fetchedAt,
      input.snapshot.contentHash,
      input.userId,
      input.documentId,
    );
}

export async function importAiNotebookWebsite(input: {
  notebookId: number;
  url: string;
  userId: number;
  requestId?: string | null;
  runtime?: WebsiteSourceRuntime;
}) {
  await assertAiNotebookWebsiteImportAccess(input);
  const snapshot = await fetchWebsiteSource({ url: input.url, runtime: input.runtime });
  const prepared = await prepareAiNotebookWebsiteImport(input);
  const existing = await findExistingWebsiteDocument({
    knowledgeBaseId: prepared.knowledgeBaseId,
    canonicalUrl: snapshot.canonicalUrl,
  });

  if (existing?.status === "ready" && existing.contentHash === snapshot.contentHash) {
    await updateWebsiteDocumentMetadata({
      documentId: existing.id,
      snapshot,
      userId: input.userId,
    });
    const activeSource = await findActiveNotebookDocumentSource(input.notebookId, existing.id);
    const sourceId =
      activeSource?.id ??
      (await addAiNotebookSource({
        notebookId: input.notebookId,
        sourceType: "document",
        targetId: existing.id,
        userId: input.userId,
      }));
    return {
      sourceId,
      documentId: existing.id,
      knowledgeBaseId: prepared.knowledgeBaseId,
      reused: true,
      snapshot,
    };
  }

  const stored = await storeTrustedGeneratedText({
    name: path.basename(safeSnapshotName(snapshot)),
    content: snapshot.markdown,
    userId: input.userId,
    usageType: "knowledge",
    source: "notebook-website",
    metadata: {
      sourceType: "web_url",
      sourceUrl: snapshot.sourceUrl,
      canonicalUrl: snapshot.canonicalUrl,
      sourceDomain: snapshot.domain,
      fetchedAt: snapshot.fetchedAt,
    },
  });
  const documentId = await addKnowledgeDocument({
    knowledgeBaseId: prepared.knowledgeBaseId,
    fileId: stored.id,
    userId: input.userId,
  });
  await updateWebsiteDocumentMetadata({ documentId, snapshot, userId: input.userId });
  await indexKnowledgeDocument({ documentId, userId: input.userId, requestId: input.requestId });

  if (existing) {
    await sqlite
      .prepare(
        `UPDATE sys_ai_notebook_source
         SET document_id = ?
         WHERE notebook_id = ? AND source_type = 'document' AND document_id = ?
           AND deleted_at IS NULL`,
      )
      .run(documentId, input.notebookId, existing.id);
  }
  const currentSource = await findActiveNotebookDocumentSource(input.notebookId, documentId);
  const sourceId =
    currentSource?.id ??
    (await addAiNotebookSource({
      notebookId: input.notebookId,
      sourceType: "document",
      targetId: documentId,
      userId: input.userId,
    }));
  if (!sourceId) throw new HTTPException(500, { message: "网站来源写入失败" });

  return {
    sourceId,
    documentId,
    knowledgeBaseId: prepared.knowledgeBaseId,
    reused: false,
    snapshot,
  };
}
