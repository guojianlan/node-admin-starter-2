import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { PageResult } from "@/lib/response";
import { hasMeaningfulRichTextContent, sanitizeRichTextHtml } from "@/lib/rich-text";
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
  scope: z.enum(["all", "users", "roles", "depts"]).default("all"),
  targetUserIds: z.array(z.coerce.number()).optional(),
  targetRoleIds: z.array(z.coerce.number()).optional(),
  targetDeptIds: z.array(z.coerce.number()).optional(),
  priority: z.coerce.number().default(0),
  pinned: z.coerce.boolean().default(false),
  status: z.coerce.number().default(0),
  publishedAt: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.date().nullable().optional(),
  ),
  expiredAt: z.preprocess(
    (value) => (value === "" || value === undefined ? undefined : value),
    z.coerce.date().nullable().optional(),
  ),
});

function normalizeNotice(values: z.infer<typeof noticeSchema>) {
  const { expiredAt, publishedAt, targetDeptIds, targetRoleIds, targetUserIds, ...rest } = values;
  const content = sanitizeRichTextHtml(rest.content);
  if (!hasMeaningfulRichTextContent(content)) {
    throw new Error("请输入公告内容");
  }
  const uniqueTargetUserIds = [...new Set(targetUserIds ?? [])];
  const uniqueTargetRoleIds = [...new Set(targetRoleIds ?? [])];
  const uniqueTargetDeptIds = [...new Set(targetDeptIds ?? [])];
  if (rest.scope === "users" && uniqueTargetUserIds.length === 0) {
    throw new Error("请选择公告接收用户");
  }
  if (rest.scope === "roles" && uniqueTargetRoleIds.length === 0) {
    throw new Error("请选择公告接收角色");
  }
  if (rest.scope === "depts" && uniqueTargetDeptIds.length === 0) {
    throw new Error("请选择公告接收部门");
  }
  return {
    ...rest,
    content,
    targetUserIdsJson:
      rest.scope === "users" ? JSON.stringify(uniqueTargetUserIds) : null,
    targetRoleIdsJson:
      rest.scope === "roles" ? JSON.stringify(uniqueTargetRoleIds) : null,
    targetDeptIdsJson:
      rest.scope === "depts" ? JSON.stringify(uniqueTargetDeptIds) : null,
    publishedAt: publishedAt ?? (rest.status === 1 ? new Date() : null),
    expiredAt: expiredAt ?? null,
  };
}

function normalizePublishAtForUpdate(status: number | undefined, publishedAt: Date | null | undefined) {
  if (status === 1 && publishedAt == null) return new Date();
  return publishedAt;
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

const parseTargetIds = parseTargetUsers;

function pageParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function buildNoticeTargetUsersQuery(notice: {
  scope: "all" | "users" | "roles" | "depts";
  targetUserIdsJson: string | null;
  targetRoleIdsJson: string | null;
  targetDeptIdsJson: string | null;
}) {
  if (notice.scope === "users") {
    const ids = parseTargetIds(notice.targetUserIdsJson);
    return {
      sql: `SELECT u.id, u.username, u.nickname, u.dept_id AS deptId, d.name AS deptName
            FROM sys_user u
            LEFT JOIN sys_dept d ON d.id = u.dept_id
            WHERE u.deleted_at IS NULL AND u.status = 1
              ${ids.length ? `AND u.id IN (${ids.map(() => "?").join(", ")})` : "AND 1 = 0"}`,
      params: ids,
    };
  }
  if (notice.scope === "roles") {
    const ids = parseTargetIds(notice.targetRoleIdsJson);
    return {
      sql: `SELECT DISTINCT u.id, u.username, u.nickname, u.dept_id AS deptId, d.name AS deptName
            FROM sys_user u
            INNER JOIN sys_user_role sur ON sur.user_id = u.id
            LEFT JOIN sys_dept d ON d.id = u.dept_id
            WHERE u.deleted_at IS NULL AND u.status = 1
              ${ids.length ? `AND sur.role_id IN (${ids.map(() => "?").join(", ")})` : "AND 1 = 0"}`,
      params: ids,
    };
  }
  if (notice.scope === "depts") {
    const ids = parseTargetIds(notice.targetDeptIdsJson);
    return {
      sql: `SELECT u.id, u.username, u.nickname, u.dept_id AS deptId, d.name AS deptName
            FROM sys_user u
            LEFT JOIN sys_dept d ON d.id = u.dept_id
            WHERE u.deleted_at IS NULL AND u.status = 1
              ${ids.length ? `AND u.dept_id IN (${ids.map(() => "?").join(", ")})` : "AND 1 = 0"}`,
      params: ids,
    };
  }
  return {
    sql: `SELECT u.id, u.username, u.nickname, u.dept_id AS deptId, d.name AS deptName
          FROM sys_user u
          LEFT JOIN sys_dept d ON d.id = u.dept_id
          WHERE u.deleted_at IS NULL AND u.status = 1`,
    params: [] as number[],
  };
}

function visibleNoticeSql() {
  return `
    n.status = 1
    AND (n.published_at IS NULL OR n.published_at <= now())
    AND (n.expired_at IS NULL OR n.expired_at > now())
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
      OR (
        n.scope = 'roles'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(n.target_role_ids_json, '[]')::jsonb) AS target(role_id)
          INNER JOIN sys_user_role sur ON sur.role_id::text = target.role_id
          WHERE sur.user_id = ?
        )
      )
      OR (
        n.scope = 'depts'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(n.target_dept_ids_json, '[]')::jsonb) AS target(dept_id)
          WHERE target.dept_id = ?::text
        )
      )
    )`;
}

function visibleNoticeParams(user: { id: number; deptId?: number | null }) {
  return [String(user.id), user.id, String(user.deptId ?? 0)];
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
      targetRoleIdsJson: sysNotice.targetRoleIdsJson,
      targetDeptIdsJson: sysNotice.targetDeptIdsJson,
      priority: sysNotice.priority,
      pinned: sysNotice.pinned,
      status: sysNotice.status,
      publishedAt: sysNotice.publishedAt,
      expiredAt: sysNotice.expiredAt,
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
    sortableFields: ["id", "createdAt", "publishedAt", "expiredAt", "priority", "status"],
    defaultSort: { field: "createdAt", order: "desc" },
  },
  hooks: {
    beforeCreate: (_ctx, values) => normalizeNotice(values),
    beforeUpdate: (_ctx, _id, values) => {
      const { expiredAt, publishedAt, targetDeptIds, targetRoleIds, targetUserIds, ...rest } = values;
      const content = values.content === undefined ? undefined : sanitizeRichTextHtml(values.content);
      if (content !== undefined && !hasMeaningfulRichTextContent(content)) {
        throw new Error("请输入公告内容");
      }
      const uniqueTargetUserIds = [...new Set(targetUserIds ?? [])];
      const uniqueTargetRoleIds = [...new Set(targetRoleIds ?? [])];
      const uniqueTargetDeptIds = [...new Set(targetDeptIds ?? [])];
      if (values.scope === "users" && uniqueTargetUserIds.length === 0) {
        throw new Error("请选择公告接收用户");
      }
      if (values.scope === "roles" && uniqueTargetRoleIds.length === 0) {
        throw new Error("请选择公告接收角色");
      }
      if (values.scope === "depts" && uniqueTargetDeptIds.length === 0) {
        throw new Error("请选择公告接收部门");
      }
      return {
        ...rest,
        ...(content !== undefined ? { content } : {}),
        ...(values.scope !== undefined
          ? {
              targetUserIdsJson:
                values.scope === "users"
                  ? JSON.stringify(uniqueTargetUserIds)
                  : null,
              targetRoleIdsJson:
                values.scope === "roles"
                  ? JSON.stringify(uniqueTargetRoleIds)
                  : null,
              targetDeptIdsJson:
                values.scope === "depts"
                  ? JSON.stringify(uniqueTargetDeptIds)
                  : null,
            }
          : {}),
        ...(publishedAt !== undefined || values.status === 1
          ? { publishedAt: normalizePublishAtForUpdate(values.status, publishedAt) }
          : {}),
        ...(expiredAt !== undefined ? { expiredAt } : {}),
      };
    },
    afterList: (_ctx, page) => ({
      ...page,
      data: page.data.map((item) => ({
        ...item,
        targetUserIds: parseTargetUsers(item.targetUserIdsJson),
        targetRoleIds: parseTargetIds(item.targetRoleIdsJson),
        targetDeptIds: parseTargetIds(item.targetDeptIdsJson),
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
          .prepare(
            `UPDATE sys_notice
             SET status = 1,
                 published_at = COALESCE(published_at, now()),
                 updated_at = now()
             WHERE id = ? AND deleted_at IS NULL`,
          )
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
         AND ${visibleNoticeSql()}
         AND NOT EXISTS (
           SELECT 1 FROM sys_notice_read r
           WHERE r.notice_id = n.id AND r.user_id = ?
         )`,
    )
    .get(...visibleNoticeParams(user), user.id)) as { total: number } | undefined;
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
        n.priority,
        n.pinned,
        n.published_at AS publishedAt,
        n.expired_at AS expiredAt,
        r.read_at AS readAt
       FROM sys_notice n
       LEFT JOIN sys_notice_read r ON r.notice_id = n.id AND r.user_id = ?
       WHERE n.deleted_at IS NULL
         AND ${visibleNoticeSql()}
       ORDER BY n.pinned DESC, n.priority DESC, n.published_at DESC NULLS LAST, n.id DESC
       LIMIT 50`,
    )
    .all(user.id, ...visibleNoticeParams(user));
  return c.json(success(rows));
});

noticeRoutes.get(
  "/notice/:id/read-stats",
  authRequired(),
  ability("system.notice.query"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const notice = (await sqlite
      .prepare(
        `SELECT
          scope,
          target_user_ids_json AS targetUserIdsJson,
          target_role_ids_json AS targetRoleIdsJson,
          target_dept_ids_json AS targetDeptIdsJson
         FROM sys_notice
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id)) as
      | {
          scope: "all" | "users" | "roles" | "depts";
          targetUserIdsJson: string | null;
          targetRoleIdsJson: string | null;
          targetDeptIdsJson: string | null;
        }
      | undefined;
    if (!notice) throw new Error("公告不存在");

    const readRow = (await sqlite
      .prepare("SELECT COUNT(1)::int AS total FROM sys_notice_read WHERE notice_id = ?")
      .get(id)) as { total: number } | undefined;
    let targetTotal = 0;
    if (notice.scope === "all") {
      const row = (await sqlite
        .prepare("SELECT COUNT(1)::int AS total FROM sys_user WHERE deleted_at IS NULL AND status = 1")
        .get()) as { total: number } | undefined;
      targetTotal = Number(row?.total ?? 0);
    } else if (notice.scope === "users") {
      targetTotal = parseTargetIds(notice.targetUserIdsJson).length;
    } else if (notice.scope === "roles") {
      const roleIds = parseTargetIds(notice.targetRoleIdsJson);
      if (roleIds.length) {
        const row = (await sqlite
          .prepare(
            `SELECT COUNT(DISTINCT u.id)::int AS total
             FROM sys_user u
             INNER JOIN sys_user_role sur ON sur.user_id = u.id
             WHERE u.deleted_at IS NULL AND u.status = 1
               AND sur.role_id IN (${roleIds.map(() => "?").join(", ")})`,
          )
          .get(...roleIds)) as { total: number } | undefined;
        targetTotal = Number(row?.total ?? 0);
      }
    } else {
      const deptIds = parseTargetIds(notice.targetDeptIdsJson);
      if (deptIds.length) {
        const row = (await sqlite
          .prepare(
            `SELECT COUNT(1)::int AS total
             FROM sys_user
             WHERE deleted_at IS NULL AND status = 1
               AND dept_id IN (${deptIds.map(() => "?").join(", ")})`,
          )
          .get(...deptIds)) as { total: number } | undefined;
        targetTotal = Number(row?.total ?? 0);
      }
    }
    const readTotal = Number(readRow?.total ?? 0);
    return c.json(success({ targetTotal, readTotal, unreadTotal: Math.max(targetTotal - readTotal, 0) }));
  },
);

noticeRoutes.get(
  "/notice/:id/read-users",
  authRequired(),
  ability("system.notice.query"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const notice = (await sqlite
      .prepare(
        `SELECT
          scope,
          target_user_ids_json AS targetUserIdsJson,
          target_role_ids_json AS targetRoleIdsJson,
          target_dept_ids_json AS targetDeptIdsJson
         FROM sys_notice
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id)) as
      | {
          scope: "all" | "users" | "roles" | "depts";
          targetUserIdsJson: string | null;
          targetRoleIdsJson: string | null;
          targetDeptIdsJson: string | null;
        }
      | undefined;
    if (!notice) throw new Error("公告不存在");

    const params = new URL(c.req.url).searchParams;
    const page = pageParam(params.get("page"), 1);
    const pageSize = Math.min(pageParam(params.get("pageSize"), 10), 100);
    const readStatus = params.get("readStatus");
    const keyword = params.get("username")?.trim();
    const dept = params.get("dept")?.trim();
    const target = buildNoticeTargetUsersQuery(notice);
    const filters: string[] = [];
    const values: Array<string | number> = [...target.params];
    if (readStatus === "read") filters.push("r.read_at IS NOT NULL");
    if (readStatus === "unread") filters.push("r.read_at IS NULL");
    if (keyword) {
      filters.push("(target.username ILIKE ? OR target.nickname ILIKE ?)");
      values.push(`%${keyword}%`, `%${keyword}%`);
    }
    if (dept) {
      filters.push("target.deptName ILIKE ?");
      values.push(`%${dept}%`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const baseSql = `FROM (${target.sql}) target
      LEFT JOIN sys_notice_read r ON r.notice_id = ? AND r.user_id = target.id
      ${where}`;
    values.splice(target.params.length, 0, id);
    const count = (await sqlite
      .prepare(`SELECT COUNT(1)::int AS total ${baseSql}`)
      .get(...values)) as { total: number } | undefined;
    const rows = (await sqlite
      .prepare(
        `SELECT
          target.id AS userId,
          target.username,
          target.nickname,
          target.deptName,
          r.read_at AS readAt,
          CASE WHEN r.read_at IS NULL THEN 'unread' ELSE 'read' END AS readStatus
         ${baseSql}
         ORDER BY r.read_at DESC NULLS LAST, target.id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...values, pageSize, (page - 1) * pageSize)) as Array<{
      userId: number;
      username: string;
      nickname: string;
      deptName: string | null;
      readAt: string | null;
      readStatus: "read" | "unread";
    }>;
    const result: PageResult<(typeof rows)[number]> = {
      data: rows,
      page,
      pageSize,
      total: Number(count?.total ?? 0),
    };
    return c.json(success(result));
  },
);

noticeRoutes.post("/notice/my/:id/read", authRequired(), async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  await sqlite
    .prepare(
      `INSERT INTO sys_notice_read (notice_id, user_id, read_at)
       SELECT n.id, ?, now()
       FROM sys_notice n
       WHERE n.id = ?
         AND n.deleted_at IS NULL
         AND ${visibleNoticeSql()}
       ON CONFLICT (notice_id, user_id) DO UPDATE SET read_at = excluded.read_at`,
    )
    .run(user.id, id, ...visibleNoticeParams(user));
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
         AND ${visibleNoticeSql()}
       ON CONFLICT (notice_id, user_id) DO UPDATE SET read_at = excluded.read_at`,
    )
    .run(user.id, ...visibleNoticeParams(user));
  return c.json(success(null, "已全部标为已读"));
});

noticeRoutes.route("/", noticeCrud.routes);
