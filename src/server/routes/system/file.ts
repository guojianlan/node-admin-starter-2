import { Hono } from "hono";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { nowIso, sqlite } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildListQuery } from "@/server/services/list-query";

function uploadRoot() {
  return path.join(process.cwd(), "storage", "uploads");
}

function safeExt(filename: string) {
  return path.extname(filename).replace(/[^a-zA-Z0-9.]/g, "").toLowerCase();
}

function normalizeIds(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return values.map(Number).filter((item) => Number.isFinite(item));
}

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(", ");
}

export const fileRoutes = new Hono<{ Variables: HonoVariables }>();

fileRoutes.get("/file/group/tree", authRequired(), ability("system.file.query"), (c) => {
  const groups = sqlite
    .prepare(
      `SELECT id, name, sort
       FROM sys_file_group
       ORDER BY sort ASC, id ASC`,
    )
    .all() as Array<{ id: number; name: string; sort: number }>;

  return c.json(
    success([
      {
        id: 0,
        name: "全部文件",
        children: groups,
      },
    ]),
  );
});

fileRoutes.get("/file/list", authRequired(), ability("system.file.query"), (c) => {
  const page = buildListQuery(c.req.url, {
    table: "sys_file f",
    select: `
      f.id,
      f.group_id AS groupId,
      f.original_name AS originalName,
      f.filename,
      f.path,
      f.url,
      f.size,
      f.ext,
      f.mime,
      f.uploader_id AS uploaderId,
      f.created_at AS createdAt
    `,
    fieldMap: {
      id: "f.id",
      groupId: "f.group_id",
      originalName: "f.original_name",
      filename: "f.filename",
      ext: "f.ext",
      mime: "f.mime",
      createdAt: "f.created_at",
    },
    searchable: {
      groupId: "=",
      originalName: "like",
      ext: "=",
      createdAt: "betweenDate",
    },
    quickSearchFields: ["originalName", "filename"],
    sortableFields: ["id", "size", "createdAt"],
    defaultSort: { field: "id", order: "desc" },
    baseWhere: ["f.deleted_at IS NULL"],
  });
  return c.json(success(page));
});

fileRoutes.post("/file/list/upload", authRequired(), ability("system.file.upload"), async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) throw new Error("请选择文件");

  const dateDir = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const ext = safeExt(file.name);
  const filename = `${crypto.randomUUID()}${ext}`;
  const relativePath = `${dateDir}/${filename}`;
  const absoluteDir = path.join(uploadRoot(), dateDir);
  const absolutePath = path.join(absoluteDir, filename);
  await fs.mkdir(absoluteDir, { recursive: true });
  await fs.writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

  const now = nowIso();
  const result = sqlite
    .prepare(
      `INSERT INTO sys_file
        (group_id, original_name, filename, path, url, size, ext, mime, uploader_id, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Number(body.groupId || 1),
      file.name,
      filename,
      relativePath,
      `/uploads/${relativePath}`,
      file.size,
      ext.replace(".", ""),
      file.type,
      user.id,
      now,
      now,
    );

  return c.json(
    success(
      {
        id: Number(result.lastInsertRowid),
        url: `/uploads/${relativePath}`,
      },
      "上传成功",
    ),
  );
});

fileRoutes.get("/file/list/download/:id", authRequired(), ability("system.file.download"), async (c) => {
  const id = Number(c.req.param("id"));
  const row = sqlite
    .prepare("SELECT original_name AS originalName, path FROM sys_file WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { originalName: string; path: string } | undefined;
  if (!row) throw new Error("文件不存在");

  const filePath = path.join(uploadRoot(), row.path);
  const buffer = await fs.readFile(filePath);
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(row.originalName)}"`,
    },
  });
});

fileRoutes.get("/file/list/trash", authRequired(), ability("system.file.query"), (c) => {
  const page = buildListQuery(c.req.url, {
    table: "sys_file f",
    select: `
      f.id,
      f.group_id AS groupId,
      f.original_name AS originalName,
      f.filename,
      f.path,
      f.url,
      f.size,
      f.ext,
      f.mime,
      f.uploader_id AS uploaderId,
      f.deleted_at AS deletedAt,
      f.created_at AS createdAt
    `,
    fieldMap: {
      id: "f.id",
      groupId: "f.group_id",
      originalName: "f.original_name",
      filename: "f.filename",
      ext: "f.ext",
      mime: "f.mime",
      deletedAt: "f.deleted_at",
      createdAt: "f.created_at",
    },
    searchable: {
      groupId: "=",
      originalName: "like",
      ext: "=",
      deletedAt: "betweenDate",
    },
    quickSearchFields: ["originalName", "filename"],
    sortableFields: ["id", "size", "deletedAt", "createdAt"],
    defaultSort: { field: "deletedAt", order: "desc" },
    baseWhere: ["f.deleted_at IS NOT NULL"],
  });
  return c.json(success(page));
});

fileRoutes.put("/file/list/rename/:id", authRequired(), ability("system.file.upload"), async (c) => {
  const id = Number(c.req.param("id"));
  const payload = z.object({ originalName: z.string().min(1) }).parse(await c.req.json());
  sqlite
    .prepare("UPDATE sys_file SET original_name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .run(payload.originalName, nowIso(), id);
  return c.json(success(null, "重命名成功"));
});

fileRoutes.put("/file/list/move", authRequired(), ability("system.file.upload"), async (c) => {
  const payload = z.object({ ids: z.array(z.coerce.number()).min(1), groupId: z.coerce.number() }).parse(await c.req.json());
  sqlite
    .prepare(`UPDATE sys_file SET group_id = ?, updated_at = ? WHERE id IN (${placeholders(payload.ids)})`)
    .run(payload.groupId, nowIso(), ...payload.ids);
  return c.json(success(null, "移动成功"));
});

fileRoutes.post("/file/list/copy", authRequired(), ability("system.file.upload"), async (c) => {
  const user = c.get("user");
  const payload = z.object({ ids: z.array(z.coerce.number()).min(1), groupId: z.coerce.number() }).parse(await c.req.json());
  const rows = sqlite
    .prepare(`SELECT * FROM sys_file WHERE id IN (${placeholders(payload.ids)}) AND deleted_at IS NULL`)
    .all(...payload.ids) as Array<{
    original_name: string;
    path: string;
    size: number;
    ext: string | null;
    mime: string | null;
  }>;
  const insert = sqlite.prepare(
    `INSERT INTO sys_file
      (group_id, original_name, filename, path, url, size, ext, mime, uploader_id, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const row of rows) {
    const ext = row.ext ? `.${row.ext}` : safeExt(row.original_name);
    const dateDir = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const filename = `${crypto.randomUUID()}${ext}`;
    const relativePath = `${dateDir}/${filename}`;
    await fs.mkdir(path.join(uploadRoot(), dateDir), { recursive: true });
    await fs.copyFile(path.join(uploadRoot(), row.path), path.join(uploadRoot(), relativePath));
    const now = nowIso();
    insert.run(
      payload.groupId,
      row.original_name,
      filename,
      relativePath,
      `/uploads/${relativePath}`,
      row.size,
      row.ext,
      row.mime,
      user.id,
      now,
      now,
    );
  }

  return c.json(success(null, "复制成功"));
});

fileRoutes.post("/file/list/batch-delete", authRequired(), ability("system.file.delete"), async (c) => {
  const ids = normalizeIds((await c.req.json()).ids);
  if (!ids.length) throw new Error("请选择文件");
  sqlite
    .prepare(`UPDATE sys_file SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders(ids)})`)
    .run(nowIso(), nowIso(), ...ids);
  return c.json(success(null, "删除成功"));
});

fileRoutes.put("/file/list/restore/:id", authRequired(), ability("system.file.delete"), (c) => {
  const id = Number(c.req.param("id"));
  sqlite.prepare("UPDATE sys_file SET deleted_at = NULL, updated_at = ? WHERE id = ?").run(nowIso(), id);
  return c.json(success(null, "恢复成功"));
});

fileRoutes.post("/file/list/batch-restore", authRequired(), ability("system.file.delete"), async (c) => {
  const ids = normalizeIds((await c.req.json()).ids);
  if (!ids.length) throw new Error("请选择文件");
  sqlite
    .prepare(`UPDATE sys_file SET deleted_at = NULL, updated_at = ? WHERE id IN (${placeholders(ids)})`)
    .run(nowIso(), ...ids);
  return c.json(success(null, "恢复成功"));
});

fileRoutes.delete("/file/list/force/:id", authRequired(), ability("system.file.delete"), async (c) => {
  const id = Number(c.req.param("id"));
  const row = sqlite.prepare("SELECT path FROM sys_file WHERE id = ?").get(id) as { path: string } | undefined;
  if (row) {
    await fs.rm(path.join(uploadRoot(), row.path), { force: true });
  }
  sqlite.prepare("DELETE FROM sys_file WHERE id = ?").run(id);
  return c.json(success(null, "彻底删除成功"));
});

fileRoutes.post("/file/list/batch-force", authRequired(), ability("system.file.delete"), async (c) => {
  const ids = normalizeIds((await c.req.json()).ids);
  if (!ids.length) throw new Error("请选择文件");
  const rows = sqlite
    .prepare(`SELECT path FROM sys_file WHERE id IN (${placeholders(ids)})`)
    .all(...ids) as Array<{ path: string }>;
  await Promise.all(rows.map((row) => fs.rm(path.join(uploadRoot(), row.path), { force: true })));
  sqlite.prepare(`DELETE FROM sys_file WHERE id IN (${placeholders(ids)})`).run(...ids);
  return c.json(success(null, "彻底删除成功"));
});

fileRoutes.delete("/file/list/clean-trash", authRequired(), ability("system.file.delete"), async (c) => {
  const rows = sqlite.prepare("SELECT path FROM sys_file WHERE deleted_at IS NOT NULL").all() as Array<{ path: string }>;
  await Promise.all(rows.map((row) => fs.rm(path.join(uploadRoot(), row.path), { force: true })));
  sqlite.prepare("DELETE FROM sys_file WHERE deleted_at IS NOT NULL").run();
  return c.json(success({ count: rows.length }, "清空成功"));
});

fileRoutes.delete("/file/list/:id", authRequired(), ability("system.file.delete"), (c) => {
  const id = Number(c.req.param("id"));
  sqlite.prepare("UPDATE sys_file SET deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), id);
  return c.json(success(null, "删除成功"));
});
