import { Hono } from "hono";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { sqlite } from "@/server/db";
import { authRequired } from "@/server/middleware/auth";
import { runReadinessChecks } from "@/server/services/readiness-service";

function numberValue(row: unknown) {
  return Number((row as { total?: number | string } | undefined)?.total ?? 0);
}

export const dashboardRoutes = new Hono<{ Variables: HonoVariables }>();

dashboardRoutes.get("/dashboard/summary", authRequired(), async (c) => {
  const abilities = new Set(c.get("abilities"));
  const visibility = {
    login: abilities.has("system.loginLog.query"),
    onlineUsers: abilities.has("system.onlineUser.query"),
    operationLogs: abilities.has("system.operationLog.query"),
    files: abilities.has("system.file.query"),
    storage: abilities.has("system.storage.query"),
    mail: abilities.has("system.mail.query"),
    notices: abilities.has("system.notice.query"),
    readiness: abilities.has("system.settings.query"),
  };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();
  const [
    loginSuccess,
    loginFailed,
    onlineUsers,
    operationLogs,
    fileStorage,
    defaultStorage,
    defaultMail,
    recentOperations,
    recentNotices,
    readiness,
  ] = await Promise.all([
    visibility.login
      ? sqlite
      .prepare("SELECT COUNT(1)::int AS total FROM sys_login_record WHERE status = 1 AND created_at >= ?")
          .get(todayIso)
      : null,
    visibility.login
      ? sqlite
      .prepare("SELECT COUNT(1)::int AS total FROM sys_login_record WHERE status = 0 AND created_at >= ?")
          .get(todayIso)
      : null,
    visibility.onlineUsers
      ? sqlite
      .prepare("SELECT COUNT(DISTINCT user_id)::int AS total FROM sys_access_token WHERE expires_at IS NULL OR expires_at > now()")
          .get()
      : null,
    visibility.operationLogs
      ? sqlite
      .prepare("SELECT COUNT(1)::int AS total FROM sys_operation_log WHERE created_at >= ?")
          .get(todayIso)
      : null,
    visibility.files
      ? sqlite
      .prepare("SELECT COUNT(1)::int AS total, COALESCE(SUM(size), 0)::bigint AS bytes FROM sys_file WHERE deleted_at IS NULL")
          .get()
      : null,
    visibility.storage
      ? sqlite
      .prepare("SELECT name, type, status FROM sys_storage WHERE is_default = true AND deleted_at IS NULL ORDER BY id ASC LIMIT 1")
          .get()
      : null,
    visibility.mail
      ? sqlite
      .prepare("SELECT name, host, status FROM sys_mail_account WHERE is_default = true AND deleted_at IS NULL ORDER BY id ASC LIMIT 1")
          .get()
      : null,
    visibility.operationLogs
      ? sqlite
      .prepare(
        `SELECT id, module, action, username, success, risk_level AS "riskLevel", created_at AS "createdAt"
         FROM sys_operation_log
         WHERE risk_level IN ('high', 'critical')
         ORDER BY created_at DESC
         LIMIT 8`,
      )
          .all()
      : [],
    visibility.notices
      ? sqlite
      .prepare(
        `SELECT id, title, type, published_at AS "publishedAt"
         FROM sys_notice
         WHERE deleted_at IS NULL AND status = 1
         ORDER BY published_at DESC NULLS LAST, id DESC
         LIMIT 5`,
      )
          .all()
      : [],
    visibility.readiness ? runReadinessChecks({ includeMail: visibility.mail }) : null,
  ]);

  return c.json(
    success({
      visibility,
      metrics: {
        loginSuccessToday: numberValue(loginSuccess),
        loginFailedToday: numberValue(loginFailed),
        onlineUsers: numberValue(onlineUsers),
        operationLogsToday: numberValue(operationLogs),
        fileCount: numberValue(fileStorage),
        fileBytes: Number((fileStorage as { bytes?: number | string } | undefined)?.bytes ?? 0),
      },
      defaultStorage,
      defaultMail,
      recentOperations,
      recentNotices,
      readiness,
    }),
  );
});
