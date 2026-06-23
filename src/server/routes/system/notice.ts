import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { sqlite } from "@/server/db";
import { sysNotice } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { runWithOperationLog } from "@/server/services/operation-log-service";

const noticeSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  type: z.enum(["notice", "announcement"]).default("notice"),
  scope: z.enum(["all", "users"]).default("all"),
  targetUserIds: z.array(z.coerce.number()).optional(),
  status: z.coerce.number().default(0),
});

function normalizeNotice(values: z.infer<typeof noticeSchema>) {
  const { targetUserIds, ...rest } = values;
  return {
    ...rest,
    targetUserIdsJson:
      rest.scope === "users" ? JSON.stringify([...(new Set(targetUserIds ?? []))]) : null,
    publishedAt: rest.status === 1 ? new Date() : null,
  };
}

function parseTargetUsers(value: unknown) {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

const noticeCrud = createCrudRoutes({
  basePath: "/notice",
  table: sysNotice,
  idColumn: sysNotice.id,
  createSchema: noticeSchema,
  updateSchema: noticeSchema.partial(),
  permissions: { prefix: "system.notice" },
  list: {
    select: {
      id: sysNotice.id,
      title: sysNotice.title,
      content: sysNotice.content,
      type: sysNotice.type,
      scope: sysNotice.scope,
      targetUserIdsJson: sysNotice.targetUserIdsJson,
      status: sysNotice.status,
      publishedAt: sysNotice.publishedAt,
      isSystem: sysNotice.isSystem,
      createdAt: sysNotice.createdAt,
      updatedAt: sysNotice.updatedAt,
    },
    searchable: {
      title: "like",
      type: "=",
      scope: "=",
      status: "=",
      createdAt: "betweenDate",
    },
    quickSearchFields: ["title", "content"],
    sortableFields: ["id", "createdAt", "publishedAt", "status"],
    defaultSort: { field: "createdAt", order: "desc" },
  },
  hooks: {
    beforeCreate: (_ctx, values) => normalizeNotice(values),
    beforeUpdate: (_ctx, _id, values) => {
      const { targetUserIds, ...rest } = values;
      return {
        ...rest,
        ...(values.scope !== undefined
          ? {
              targetUserIdsJson:
                values.scope === "users"
                  ? JSON.stringify([...(new Set(targetUserIds ?? []))])
                  : null,
            }
          : {}),
        ...(values.status === 1 ? { publishedAt: new Date() } : {}),
      };
    },
    afterList: (_ctx, page) => ({
      ...page,
      data: page.data.map((item) => ({
        ...item,
        targetUserIds: parseTargetUsers(item.targetUserIdsJson),
      })),
    }),
  },
});

export const noticeRoutes = new Hono<{ Variables: HonoVariables }>();

noticeRoutes.put(
  "/notice/publish/:id",
  authRequired(),
  ability("system.notice.publish"),
  async (c) => {
    const id = Number(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.notice",
        action: "publish",
        resource: "/notice",
        resourceId: id,
      },
      async () => {
        await sqlite
          .prepare("UPDATE sys_notice SET status = 1, published_at = now(), updated_at = now() WHERE id = ? AND deleted_at IS NULL")
          .run(id);
      },
    );
    return c.json(success(null, "发布成功"));
  },
);

noticeRoutes.put(
  "/notice/revoke/:id",
  authRequired(),
  ability("system.notice.revoke"),
  async (c) => {
    const id = Number(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.notice",
        action: "revoke",
        resource: "/notice",
        resourceId: id,
      },
      async () => {
        await sqlite
          .prepare("UPDATE sys_notice SET status = 0, updated_at = now() WHERE id = ? AND deleted_at IS NULL")
          .run(id);
      },
    );
    return c.json(success(null, "撤回成功"));
  },
);

noticeRoutes.get("/notice/my/unread-count", authRequired(), async (c) => {
  const user = c.get("user");
  const row = (await sqlite
    .prepare(
      `SELECT COUNT(1)::int AS total
       FROM sys_notice n
       WHERE n.deleted_at IS NULL
         AND n.status = 1
         AND (
           n.scope = 'all'
           OR (
             n.scope = 'users'
             AND EXISTS (
               SELECT 1
               FROM jsonb_array_elements_text(COALESCE(n.target_user_ids_json, '[]')::jsonb) AS target(user_id)
               WHERE target.user_id = ?::text
             )
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM sys_notice_read r
           WHERE r.notice_id = n.id AND r.user_id = ?
         )`,
    )
    .get(String(user.id), user.id)) as { total: number } | undefined;
  return c.json(success({ total: Number(row?.total ?? 0) }));
});

noticeRoutes.get("/notice/my", authRequired(), async (c) => {
  const user = c.get("user");
  const rows = await sqlite
    .prepare(
      `SELECT
        n.id,
        n.title,
        n.content,
        n.type,
        n.published_at AS publishedAt,
        r.read_at AS readAt
       FROM sys_notice n
       LEFT JOIN sys_notice_read r ON r.notice_id = n.id AND r.user_id = ?
       WHERE n.deleted_at IS NULL
         AND n.status = 1
         AND (
           n.scope = 'all'
           OR (
             n.scope = 'users'
             AND EXISTS (
               SELECT 1
               FROM jsonb_array_elements_text(COALESCE(n.target_user_ids_json, '[]')::jsonb) AS target(user_id)
               WHERE target.user_id = ?::text
             )
           )
         )
       ORDER BY n.published_at DESC NULLS LAST, n.id DESC
       LIMIT 50`,
    )
    .all(user.id, String(user.id));
  return c.json(success(rows));
});

noticeRoutes.post("/notice/my/:id/read", authRequired(), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  await sqlite
    .prepare(
      `INSERT INTO sys_notice_read (notice_id, user_id, read_at)
       VALUES (?, ?, now())
       ON CONFLICT (notice_id, user_id) DO UPDATE SET read_at = excluded.read_at`,
    )
    .run(id, user.id);
  return c.json(success(null, "已读"));
});

noticeRoutes.post("/notice/my/read-all", authRequired(), async (c) => {
  const user = c.get("user");
  await sqlite
    .prepare(
      `INSERT INTO sys_notice_read (notice_id, user_id, read_at)
       SELECT n.id, ?, now()
       FROM sys_notice n
       WHERE n.deleted_at IS NULL
         AND n.status = 1
         AND (
           n.scope = 'all'
           OR (
             n.scope = 'users'
             AND EXISTS (
               SELECT 1
               FROM jsonb_array_elements_text(COALESCE(n.target_user_ids_json, '[]')::jsonb) AS target(user_id)
               WHERE target.user_id = ?::text
             )
           )
         )
       ON CONFLICT (notice_id, user_id) DO UPDATE SET read_at = excluded.read_at`,
    )
    .run(user.id, String(user.id));
  return c.json(success(null, "已全部标为已读"));
});

noticeRoutes.route("/", noticeCrud.routes);
