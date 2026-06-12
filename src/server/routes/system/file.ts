import { Hono } from "hono";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
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

export const fileRoutes = new Hono<{ Variables: HonoVariables }>();

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

fileRoutes.delete("/file/list/:id", authRequired(), ability("system.file.delete"), (c) => {
  const id = Number(c.req.param("id"));
  sqlite.prepare("UPDATE sys_file SET deleted_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), id);
  return c.json(success(null, "删除成功"));
});
