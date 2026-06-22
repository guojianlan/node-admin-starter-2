import { Hono } from "hono";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { nowIso, sqlite } from "@/server/db";
import { sysFile, sysStorage } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildListQuery } from "@/server/services/list-query";
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
  return c.json(success(null, "创建成功"));
});

fileRoutes.put("/file/group/:id", authRequired(), ability("system.file.upload"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = fileGroupSchema.parse(await c.req.json());
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
  return c.json(success(null, "更新成功"));
});

fileRoutes.delete("/file/group/:id", authRequired(), ability("system.file.delete"), async (c) => {
  const id = Number(c.req.param("id"));
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
  return c.json(success(null, "删除成功"));
});

fileRoutes.post("/file/list/upload", authRequired(), ability("system.file.upload"), async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new Error("请选择文件");
  const result = await uploadFileToDefaultStorage({
    file,
    groupId: Number(body.groupId || 1),
    userId: user.id,
  });

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
      },
    });
  },
);

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
    await sqlite
      .prepare(
        "UPDATE sys_file SET original_name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      )
      .run(payload.originalName, nowIso(), id);
    return c.json(success(null, "重命名成功"));
  },
);

fileRoutes.put("/file/list/move", authRequired(), ability("system.file.upload"), async (c) => {
  const payload = z
    .object({ ids: z.array(z.coerce.number()).min(1), groupId: z.coerce.number() })
    .parse(await c.req.json());
  await sqlite
    .prepare(
      `UPDATE sys_file SET group_id = ?, updated_at = ? WHERE id IN (${placeholders(payload.ids)})`,
    )
    .run(payload.groupId, nowIso(), ...payload.ids);
  return c.json(success(null, "移动成功"));
});

fileRoutes.post("/file/list/copy", authRequired(), ability("system.file.upload"), async (c) => {
  const user = c.get("user");
  const payload = z
    .object({ ids: z.array(z.coerce.number()).min(1), groupId: z.coerce.number() })
    .parse(await c.req.json());
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

  return c.json(success(null, "复制成功"));
});

fileRoutes.delete(
  "/file/list/clean-trash",
  authRequired(),
  ability("system.file.delete"),
  async (c) => {
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
    return c.json(success({ count: rows.length }, "清空成功"));
  },
);

fileRoutes.route("/", fileCrud.routes);
