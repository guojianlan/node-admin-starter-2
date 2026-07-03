import { Hono } from "hono";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { nowIso, sqlite } from "@/server/db";
import { sysFile, sysStorage } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildListQuery } from "@/server/services/list-query";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import {
  classifyFile,
  copyStoredObject,
  deleteStoredObject,
  readStoredObject,
  safeExt,
  uploadFileToDefaultStorage,
  type FileObjectRow,
} from "@/server/services/storage-service";

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

type FileGroupRow = {
  id: number;
  parentId: number;
  name: string;
  sort: number;
  describe: string | null;
};

type FileGroupNode = FileGroupRow & {
  children?: FileGroupNode[];
};

const fileGroupSchema = z.object({
  parentId: z.coerce.number().default(0),
  name: z.string().min(1),
  sort: z.coerce.number().default(0),
  describe: z.string().optional().nullable(),
});

async function getFileObjectRows(ids: number[]) {
  if (!ids.length) return [];
  return (await sqlite
    .prepare(
      `SELECT
        f.id,
        f.original_name AS originalName,
        f.filename,
        f.path,
        f.url,
        f.mime,
        f.storage_id AS storageId,
        COALESCE(s.type, 'local') AS storageType,
        s.endpoint,
        s.region,
        s.bucket,
        s.access_key AS accessKey,
        s.secret_key_encrypted AS secretKeyEncrypted,
        s.root_path AS rootPath
       FROM sys_file f
       LEFT JOIN sys_storage s ON s.id = f.storage_id
       WHERE f.id IN (${placeholders(ids)})`,
    )
    .all(...ids)) as FileObjectRow[];
}

async function assertFilesNotReferenced(ids: number[]) {
  if (!ids.length) return;
  const row = (await sqlite
    .prepare(
      `SELECT file_id AS fileId
       FROM sys_file_reference
       WHERE file_id IN (${placeholders(ids)})
       LIMIT 1`,
    )
    .get(...ids)) as { fileId: number } | undefined;
  if (row) throw new Error(`文件 ${row.fileId} 已被业务引用，不能物理删除`);
}

function chunkRoot() {
  return path.join(process.cwd(), "storage", "upload-parts");
}

const fileCrud = createCrudRoutes({
  basePath: "/file/list",
  table: sysFile,
  idColumn: sysFile.id,
  createSchema: z.object({}),
  updateSchema: z
    .object({
      originalName: z.string().min(1).optional(),
      groupId: z.coerce.number().nullable().optional(),
    })
    .partial(),
  actions: ["query", "update", "delete", "batchDelete", "restore", "forceDelete"],
  permissions: {
    prefix: "system.file",
    actions: {
      update: "system.file.upload",
      restore: "system.file.delete",
      forceDelete: "system.file.delete",
    },
  },
  list: {
    select: {
      id: sysFile.id,
      groupId: sysFile.groupId,
      storageId: sysFile.storageId,
      storageName: sysStorage.name,
      originalName: sysFile.originalName,
      filename: sysFile.filename,
      path: sysFile.path,
      url: sysFile.url,
      size: sysFile.size,
      ext: sysFile.ext,
      mime: sysFile.mime,
      type: sysFile.type,
      sha256: sysFile.sha256,
      thumbnailUrl: sysFile.thumbnailUrl,
      uploaderId: sysFile.uploaderId,
      createdAt: sysFile.createdAt,
      updatedAt: sysFile.updatedAt,
    },
    joins: [
      {
        type: "left",
        table: sysStorage,
        on: eq(sysStorage.id, sysFile.storageId),
      },
    ],
    searchable: {
      groupId: "=",
      storageId: "=",
      originalName: "like",
      ext: "=",
      mime: "like",
      type: "=",
      createdAt: "betweenDate",
    },
    quickSearchFields: ["originalName", "filename", "sha256"],
    sortableFields: ["id", "size", "createdAt", "updatedAt"],
    defaultSort: { field: "id", order: "desc" },
  },
  hooks: {
    beforeForceDelete: async (_ctx, ids) => {
      await assertFilesNotReferenced(ids);
      const rows = await getFileObjectRows(ids);
      await Promise.all(rows.map((row) => deleteStoredObject(row)));
    },
  },
});

function buildGroupTree(rows: FileGroupRow[], parentId = 0): FileGroupNode[] {
  return rows
    .filter((row) => row.parentId === parentId)
    .map((row) => {
      const children = buildGroupTree(rows, row.id);
      return children.length ? { ...row, children } : row;
    });
}

function collectDescendantIds(rows: FileGroupRow[], id: number): number[] {
  const children = rows.filter((row) => row.parentId === id);
  return children.flatMap((child) => [child.id, ...collectDescendantIds(rows, child.id)]);
}

export const fileRoutes = new Hono<{ Variables: HonoVariables }>();

fileRoutes.get("/file/group/tree", authRequired(), ability("system.file.query"), async (c) => {
  const groups = (await sqlite
    .prepare(
      `SELECT id, parent_id AS parentId, name, sort, describe
       FROM sys_file_group
       ORDER BY sort ASC, id ASC`,
    )
    .all()) as FileGroupRow[];

  return c.json(
    success([
      {
        id: 0,
        parentId: 0,
        name: "全部文件",
        sort: 0,
        describe: null,
        children: buildGroupTree(groups),
      },
    ]),
  );
});

fileRoutes.post("/file/group", authRequired(), ability("system.file.upload"), async (c) => {
  const payload = fileGroupSchema.parse(await c.req.json());
  await runWithOperationLog(
    c,
    {
      module: "system.file",
      action: "createGroup",
      resource: "/file/group",
      details: { parentId: payload.parentId, name: payload.name },
    },
    async () => {
      if (payload.parentId > 0) {
        const parent = await sqlite
          .prepare("SELECT id FROM sys_file_group WHERE id = ?")
          .get(payload.parentId);
        if (!parent) throw new Error("父级文件夹不存在");
      }
      const now = nowIso();
      await sqlite
        .prepare(
          `INSERT INTO sys_file_group
            (parent_id, name, sort, describe, created_at, updated_at)
           VALUES
            (?, ?, ?, ?, ?, ?)`,
        )
        .run(payload.parentId, payload.name, payload.sort, payload.describe || null, now, now);
    },
  );
  return c.json(success(null, "创建成功"));
});

fileRoutes.put("/file/group/:id", authRequired(), ability("system.file.upload"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = fileGroupSchema.parse(await c.req.json());
  await runWithOperationLog(
    c,
    {
      module: "system.file",
      action: "updateGroup",
      resource: "/file/group",
      resourceId: id,
      details: { parentId: payload.parentId, name: payload.name },
    },
    async () => {
      if (id <= 0) throw new Error("文件夹不存在");
      const rows = (await sqlite
        .prepare("SELECT id, parent_id AS parentId, name, sort, describe FROM sys_file_group")
        .all()) as FileGroupRow[];
      if (!rows.some((row) => row.id === id)) throw new Error("文件夹不存在");
      const descendantIds = collectDescendantIds(rows, id);
      if (payload.parentId === id || descendantIds.includes(payload.parentId)) {
        throw new Error("不能选择自身或子级作为父级");
      }
      await sqlite
        .prepare(
          `UPDATE sys_file_group
           SET parent_id = ?, name = ?, sort = ?, describe = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(payload.parentId, payload.name, payload.sort, payload.describe || null, nowIso(), id);
    },
  );
  return c.json(success(null, "更新成功"));
});

fileRoutes.delete("/file/group/:id", authRequired(), ability("system.file.delete"), async (c) => {
  const id = Number(c.req.param("id"));
  await runWithOperationLog(
    c,
    {
      module: "system.file",
      action: "deleteGroup",
      resource: "/file/group",
      resourceId: id,
    },
    async () => {
      if (id <= 0) throw new Error("不能删除根目录");
      const child = await sqlite
        .prepare("SELECT id FROM sys_file_group WHERE parent_id = ? LIMIT 1")
        .get(id);
      if (child) throw new Error("请先删除子文件夹");
      const file = await sqlite
        .prepare("SELECT id FROM sys_file WHERE group_id = ? AND deleted_at IS NULL LIMIT 1")
        .get(id);
      if (file) throw new Error("请先删除文件夹下的文件");
      await sqlite.prepare("DELETE FROM sys_file_group WHERE id = ?").run(id);
    },
  );
  return c.json(success(null, "删除成功"));
});

fileRoutes.post("/file/list/upload", authRequired(), ability("system.file.upload"), async (c) => {
  const user = c.get("user");
  const result = await runWithOperationLog(
    c,
    {
      module: "system.file",
      action: "upload",
      resource: "/file/list",
    },
    async () => {
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) throw new Error("请选择文件");
      return uploadFileToDefaultStorage({
        file,
        groupId: Number(body.groupId || 1),
        userId: user.id,
      });
    },
  );

  return c.json(
    success(
      {
        id: result.id,
        url: result.url,
        deduped: result.deduped,
      },
      result.deduped ? "文件已存在，已复用" : "上传成功",
    ),
  );
});

fileRoutes.get(
  "/file/list/download/:id",
  authRequired(),
  ability("system.file.download"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const row = (await sqlite
      .prepare(
        `SELECT
          f.original_name AS originalName,
          f.filename,
          f.path,
          f.mime,
          f.storage_id AS storageId,
          COALESCE(s.type, 'local') AS storageType,
          s.endpoint,
          s.region,
          s.bucket,
          s.access_key AS accessKey,
          s.secret_key_encrypted AS secretKeyEncrypted,
          s.root_path AS rootPath
         FROM sys_file f
         LEFT JOIN sys_storage s ON s.id = f.storage_id
         WHERE f.id = ? AND f.deleted_at IS NULL`,
      )
      .get(id)) as (FileObjectRow & { originalName: string }) | undefined;
    if (!row) throw new Error("文件不存在");

    const buffer = await readStoredObject(row);
    return new Response(buffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(row.originalName)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);

fileRoutes.post("/file/chunk/init", authRequired(), ability("system.file.upload"), async (c) => {
  const user = c.get("user");
  const payload = z
    .object({
      filename: z.string().min(1),
      mime: z.string().optional().nullable(),
      size: z.coerce.number().int().positive(),
      totalParts: z.coerce.number().int().positive(),
      groupId: z.coerce.number().optional().nullable(),
    })
    .parse(await c.req.json());
  const uploadId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await sqlite
    .prepare(
      `INSERT INTO sys_file_upload_session
        (upload_id, filename, mime, size, total_parts, group_id, user_id, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uploadId,
      payload.filename,
      payload.mime || null,
      payload.size,
      payload.totalParts,
      payload.groupId ?? 1,
      user.id,
      expiresAt,
    );
  return c.json(success({ uploadId, expiresAt }, "初始化成功"));
});

fileRoutes.post("/file/chunk/part", authRequired(), ability("system.file.upload"), async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const uploadId = String(body.uploadId || "");
  const partNumber = Number(body.partNumber || 0);
  const expectedSha256 = String(body.sha256 || "");
  const file = body.file;
  if (!uploadId || !Number.isFinite(partNumber) || partNumber <= 0) throw new Error("分片参数不正确");
  if (!(file instanceof File)) throw new Error("请选择分片文件");
  const session = (await sqlite
    .prepare(
      `SELECT upload_id AS uploadId, total_parts AS totalParts, status, user_id AS userId, expires_at AS expiresAt
       FROM sys_file_upload_session
       WHERE upload_id = ?`,
    )
    .get(uploadId)) as
    | { uploadId: string; totalParts: number; status: string; userId: number; expiresAt: string }
    | undefined;
  if (!session || session.userId !== user.id) throw new Error("上传会话不存在");
  if (session.status !== "uploading") throw new Error("上传会话状态不可用");
  if (new Date(session.expiresAt).getTime() <= Date.now()) throw new Error("上传会话已过期");
  if (partNumber > session.totalParts) throw new Error("分片编号超出范围");
  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  if (expectedSha256 && expectedSha256 !== sha256) throw new Error("分片 SHA256 校验失败");
  const dir = path.join(chunkRoot(), uploadId);
  await fs.mkdir(dir, { recursive: true });
  const partPath = path.join(dir, `${partNumber}.part`);
  await fs.writeFile(partPath, buffer);
  await sqlite
    .prepare(
      `INSERT INTO sys_file_upload_part (upload_id, part_number, size, sha256, path)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (upload_id, part_number)
       DO UPDATE SET size = excluded.size, sha256 = excluded.sha256, path = excluded.path, created_at = now()`,
    )
    .run(uploadId, partNumber, buffer.length, sha256, partPath);
  return c.json(success({ partNumber, sha256 }, "分片上传成功"));
});

fileRoutes.post("/file/chunk/complete", authRequired(), ability("system.file.upload"), async (c) => {
  const user = c.get("user");
  const payload = z.object({ uploadId: z.string().min(1) }).parse(await c.req.json());
  const result = await runWithOperationLog(
    c,
    {
      module: "system.file",
      action: "chunkComplete",
      resource: "/file/chunk",
      resourceId: payload.uploadId,
    },
    async () => {
      const session = (await sqlite
        .prepare(
          `SELECT upload_id AS uploadId, filename, mime, size, total_parts AS totalParts, group_id AS groupId, user_id AS userId, status, expires_at AS expiresAt
           FROM sys_file_upload_session
           WHERE upload_id = ?`,
        )
        .get(payload.uploadId)) as
        | {
            uploadId: string;
            filename: string;
            mime: string | null;
            size: number;
            totalParts: number;
            groupId: number | null;
            userId: number;
            status: string;
            expiresAt: string;
          }
        | undefined;
      if (!session || session.userId !== user.id) throw new Error("上传会话不存在");
      if (session.status !== "uploading") throw new Error("上传会话状态不可用");
      if (new Date(session.expiresAt).getTime() <= Date.now()) throw new Error("上传会话已过期");
      const parts = (await sqlite
        .prepare(
          `SELECT part_number AS partNumber, path, size, sha256
           FROM sys_file_upload_part
           WHERE upload_id = ?
           ORDER BY part_number ASC`,
        )
        .all(payload.uploadId)) as Array<{ partNumber: number; path: string; size: number; sha256: string }>;
      if (parts.length !== session.totalParts) throw new Error("分片数量不完整");
      for (let index = 0; index < session.totalParts; index += 1) {
        if (parts[index]?.partNumber !== index + 1) throw new Error("分片编号不连续");
      }
      const buffers = await Promise.all(
        parts.map(async (part) => {
          const content = await fs.readFile(part.path);
          const actualSha256 = crypto.createHash("sha256").update(content).digest("hex");
          if (actualSha256 !== part.sha256) throw new Error(`分片 ${part.partNumber} 校验失败`);
          return content;
        }),
      );
      const buffer = Buffer.concat(buffers);
      if (buffer.length !== Number(session.size)) throw new Error("合并文件大小不匹配");
      const file = new File([buffer], session.filename, {
        type: session.mime || "application/octet-stream",
      });
      const uploaded = await uploadFileToDefaultStorage({
        file,
        groupId: session.groupId ?? 1,
        userId: user.id,
      });
      await sqlite
        .prepare("UPDATE sys_file_upload_session SET status = 'completed', updated_at = now() WHERE upload_id = ?")
        .run(payload.uploadId);
      await fs.rm(path.join(chunkRoot(), payload.uploadId), { recursive: true, force: true });
      return uploaded;
    },
  );
  return c.json(success(result, "上传完成"));
});

fileRoutes.delete("/file/chunk/clean-expired", authRequired(), ability("system.file.delete"), async (c) => {
  await runWithOperationLog(
    c,
    {
      module: "system.file",
      action: "cleanExpiredUploadSessions",
      resource: "/file/chunk",
    },
    async () => {
      const rows = (await sqlite
        .prepare("SELECT upload_id AS uploadId FROM sys_file_upload_session WHERE expires_at < now() AND status = 'uploading'")
        .all()) as Array<{ uploadId: string }>;
      for (const row of rows) {
        await fs.rm(path.join(chunkRoot(), row.uploadId), { recursive: true, force: true });
      }
      await sqlite
        .prepare("UPDATE sys_file_upload_session SET status = 'expired', updated_at = now() WHERE expires_at < now() AND status = 'uploading'")
        .run();
    },
  );
  return c.json(success(null, "清理成功"));
});

fileRoutes.delete("/file/chunk/:uploadId", authRequired(), ability("system.file.upload"), async (c) => {
  const user = c.get("user");
  const uploadId = c.req.param("uploadId");
  await runWithOperationLog(
    c,
    {
      module: "system.file",
      action: "cancelChunkUpload",
      resource: "/file/chunk",
      resourceId: uploadId,
    },
    async () => {
      await sqlite
        .prepare(
          "UPDATE sys_file_upload_session SET status = 'cancelled', updated_at = now() WHERE upload_id = ? AND user_id = ?",
        )
        .run(uploadId, user.id);
      await fs.rm(path.join(chunkRoot(), uploadId), { recursive: true, force: true });
    },
  );
  return c.json(success(null, "已取消上传"));
});

const fileReferenceSchema = z.object({
  fileId: z.coerce.number(),
  module: z.string().min(1),
  resourceType: z.string().optional().nullable(),
  resourceId: z.string().optional().nullable(),
  field: z.string().optional().nullable(),
});

fileRoutes.post("/file/reference", authRequired(), ability("system.file.upload"), async (c) => {
  const payload = fileReferenceSchema.parse(await c.req.json());
  await runWithOperationLog(
    c,
    {
      module: "system.file",
      action: "reference",
      resource: "/file/reference",
      resourceId: payload.fileId,
      details: payload,
    },
    async () => {
      const file = await sqlite
        .prepare("SELECT id FROM sys_file WHERE id = ? AND deleted_at IS NULL")
        .get(payload.fileId);
      if (!file) throw new Error("文件不存在");
      await sqlite
        .prepare(
          `INSERT INTO sys_file_reference
            (file_id, module, resource_type, resource_id, field, created_at)
           VALUES (?, ?, ?, ?, ?, now())`,
        )
        .run(
          payload.fileId,
          payload.module,
          payload.resourceType || null,
          payload.resourceId || null,
          payload.field || null,
        );
    },
  );
  return c.json(success(null, "引用已记录"));
});

fileRoutes.delete("/file/reference", authRequired(), ability("system.file.upload"), async (c) => {
  const payload = fileReferenceSchema.parse(await c.req.json());
  await runWithOperationLog(
    c,
    {
      module: "system.file",
      action: "unreference",
      resource: "/file/reference",
      resourceId: payload.fileId,
      details: payload,
    },
    async () => {
      await sqlite
        .prepare(
          `DELETE FROM sys_file_reference
           WHERE file_id = ?
             AND module = ?
             AND COALESCE(resource_type, '') = COALESCE(?, '')
             AND COALESCE(resource_id, '') = COALESCE(?, '')
             AND COALESCE(field, '') = COALESCE(?, '')`,
        )
        .run(
          payload.fileId,
          payload.module,
          payload.resourceType || null,
          payload.resourceId || null,
          payload.field || null,
        );
    },
  );
  return c.json(success(null, "引用已移除"));
});

fileRoutes.get("/file/:id/references", authRequired(), ability("system.file.query"), async (c) => {
  const id = Number(c.req.param("id"));
  const rows = await sqlite
    .prepare(
      `SELECT
        id,
        file_id AS fileId,
        module,
        resource_type AS resourceType,
        resource_id AS resourceId,
        field,
        created_at AS createdAt
       FROM sys_file_reference
       WHERE file_id = ?
       ORDER BY id DESC`,
    )
    .all(id);
  return c.json(success(rows));
});

fileRoutes.get("/file/list/trash", authRequired(), ability("system.file.query"), async (c) => {
  const page = await buildListQuery(c.req.url, {
    table: "sys_file f LEFT JOIN sys_storage s ON s.id = f.storage_id",
    select: `
      f.id,
      f.group_id AS groupId,
      f.storage_id AS storageId,
      s.name AS storageName,
      f.original_name AS originalName,
      f.filename,
      f.path,
      f.url,
      f.size,
      f.ext,
      f.mime,
      f.type,
      f.sha256,
      f.uploader_id AS uploaderId,
      f.deleted_at AS deletedAt,
      f.created_at AS createdAt
    `,
    fieldMap: {
      id: "f.id",
      groupId: "f.group_id",
      storageId: "f.storage_id",
      originalName: "f.original_name",
      filename: "f.filename",
      ext: "f.ext",
      mime: "f.mime",
      type: "f.type",
      deletedAt: "f.deleted_at",
      createdAt: "f.created_at",
    },
    searchable: {
      groupId: "=",
      storageId: "=",
      originalName: "like",
      ext: "=",
      type: "=",
      deletedAt: "betweenDate",
    },
    quickSearchFields: ["originalName", "filename", "sha256"],
    sortableFields: ["id", "size", "deletedAt", "createdAt"],
    defaultSort: { field: "deletedAt", order: "desc" },
    baseWhere: ["f.deleted_at IS NOT NULL"],
  });
  return c.json(success(page));
});

fileRoutes.put(
  "/file/list/rename/:id",
  authRequired(),
  ability("system.file.upload"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = z.object({ originalName: z.string().min(1) }).parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.file",
        action: "rename",
        resource: "/file/list",
        resourceId: id,
        details: { originalName: payload.originalName },
      },
      async () => {
        await sqlite
          .prepare(
            "UPDATE sys_file SET original_name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
          )
          .run(payload.originalName, nowIso(), id);
      },
    );
    return c.json(success(null, "重命名成功"));
  },
);

fileRoutes.put("/file/list/move", authRequired(), ability("system.file.upload"), async (c) => {
  const payload = z
    .object({ ids: z.array(z.coerce.number()).min(1), groupId: z.coerce.number() })
    .parse(await c.req.json());
  await runWithOperationLog(
    c,
    {
      module: "system.file",
      action: "move",
      resource: "/file/list",
      details: { ids: payload.ids, groupId: payload.groupId },
    },
    async () => {
      await sqlite
        .prepare(
          `UPDATE sys_file SET group_id = ?, updated_at = ? WHERE id IN (${placeholders(payload.ids)})`,
        )
        .run(payload.groupId, nowIso(), ...payload.ids);
    },
  );
  return c.json(success(null, "移动成功"));
});

fileRoutes.post("/file/list/copy", authRequired(), ability("system.file.upload"), async (c) => {
  const user = c.get("user");
  const payload = z
    .object({ ids: z.array(z.coerce.number()).min(1), groupId: z.coerce.number() })
    .parse(await c.req.json());
  await runWithOperationLog(
    c,
    {
      module: "system.file",
      action: "copy",
      resource: "/file/list",
      details: { ids: payload.ids, groupId: payload.groupId },
    },
    async () => {
      const rows = (await sqlite
        .prepare(
          `SELECT
        f.*,
        COALESCE(s.type, 'local') AS storageType,
        s.endpoint,
        s.region,
        s.bucket,
        s.access_key AS accessKey,
        s.secret_key_encrypted AS secretKeyEncrypted,
        s.root_path AS rootPath
       FROM sys_file f
       LEFT JOIN sys_storage s ON s.id = f.storage_id
       WHERE f.id IN (${placeholders(payload.ids)}) AND f.deleted_at IS NULL`,
        )
        .all(...payload.ids)) as Array<{
        group_id: number | null;
        storage_id: number | null;
        original_name: string;
        filename: string;
        path: string;
        url: string;
        size: number;
        ext: string | null;
        mime: string | null;
        type: string | null;
        sha256: string | null;
        metadata_json: string | null;
        storageType: "local" | "s3";
        endpoint: string | null;
        region: string | null;
        bucket: string | null;
        accessKey: string | null;
        secretKeyEncrypted: string | null;
        rootPath: string | null;
      }>;
      const insert = sqlite.prepare(
        `INSERT INTO sys_file
      (group_id, storage_id, original_name, filename, path, url, size, ext, mime, type, sha256, metadata_json, uploader_id, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const row of rows) {
        const ext = row.ext ? `.${row.ext}` : safeExt(row.original_name);
        const dateDir = new Date().toISOString().slice(0, 10).replaceAll("-", "");
        const filename = `${crypto.randomUUID()}${ext}`;
        const relativePath = `${dateDir}/${filename}`;
        await copyStoredObject({
          source: {
            filename: row.filename,
            path: row.path,
            mime: row.mime,
            storageId: row.storage_id,
            storageType: row.storageType,
            endpoint: row.endpoint,
            region: row.region,
            bucket: row.bucket,
            accessKey: row.accessKey,
            secretKeyEncrypted: row.secretKeyEncrypted,
            rootPath: row.rootPath,
          },
          targetPath: relativePath,
          contentType: row.mime,
        });
        const now = nowIso();
        await insert.run(
          payload.groupId,
          row.storage_id,
          row.original_name,
          filename,
          relativePath,
          row.url.replace(row.path, relativePath),
          row.size,
          row.ext,
          row.mime,
          row.type ?? classifyFile({ ext: row.ext, mime: row.mime }),
          row.sha256,
          row.metadata_json,
          user.id,
          now,
          now,
        );
      }
    },
  );

  return c.json(success(null, "复制成功"));
});

fileRoutes.delete(
  "/file/list/clean-trash",
  authRequired(),
  ability("system.file.delete"),
  async (c) => {
    const count = await runWithOperationLog(
      c,
      {
        module: "system.file",
        action: "cleanTrash",
        resource: "/file/list",
      },
      async () => {
        const referenced = (await sqlite
          .prepare(
            `SELECT DISTINCT f.id
             FROM sys_file f
             INNER JOIN sys_file_reference r ON r.file_id = f.id
             WHERE f.deleted_at IS NOT NULL`,
          )
          .all()) as Array<{ id: number }>;
        if (referenced.length) throw new Error("回收站中存在被业务引用的文件，不能清空");
        const rows = (await sqlite
          .prepare(
            `SELECT
          f.id,
          f.filename,
          f.path,
          f.mime,
          f.storage_id AS storageId,
          COALESCE(s.type, 'local') AS storageType,
          s.endpoint,
          s.region,
          s.bucket,
          s.access_key AS accessKey,
          s.secret_key_encrypted AS secretKeyEncrypted,
          s.root_path AS rootPath
         FROM sys_file f
         LEFT JOIN sys_storage s ON s.id = f.storage_id
         WHERE f.deleted_at IS NOT NULL`,
          )
          .all()) as FileObjectRow[];
        await Promise.all(rows.map((row) => deleteStoredObject(row)));
        await sqlite.prepare("DELETE FROM sys_file WHERE deleted_at IS NOT NULL").run();
        return rows.length;
      },
    );
    return c.json(success({ count }, "清空成功"));
  },
);

fileRoutes.route("/", fileCrud.routes);
