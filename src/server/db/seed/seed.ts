import bcrypt from "bcryptjs";
import { type DbClient, sqlite } from "@/server/db";
import { getAdminBaseEnv } from "@/server/env";
import { runMigrations } from "../migrations";
import { seedDicts, seedRules } from "./default-data";

function nowIso() {
  return new Date().toISOString();
}

async function syncSequences(dbClient: DbClient) {
  const tables = [
    "sys_dept",
    "sys_user",
    "sys_role",
    "sys_rule",
    "sys_access_token",
    "sys_login_record",
    "sys_operation_log",
    "sys_user_password_history",
    "sys_password_reset_token",
    "sys_dict",
    "sys_dict_item",
    "sys_config_group",
    "sys_config_items",
    "sys_storage",
    "sys_file_group",
    "sys_file",
    "sys_mail_account",
    "sys_notice",
  ];

  for (const table of tables) {
    await dbClient.exec(`
SELECT setval(
  pg_get_serial_sequence('${table}', 'id'),
  COALESCE((SELECT MAX(id) FROM ${table}), 1),
  (SELECT MAX(id) IS NOT NULL FROM ${table})
);
`);
  }
}

export async function seedDatabase(dbClient: DbClient = sqlite) {
  await runMigrations();

  const now = nowIso();
  const adminPasswordHash = await bcrypt.hash(getAdminBaseEnv().adminBaseAdminPassword, 10);
  const demoPasswordHash = await bcrypt.hash("123456", 10);

  await dbClient
    .prepare(
      `INSERT INTO sys_dept
        (id, parent_id, name, code, sort, leader, phone, status, is_system, created_at, updated_at)
       VALUES
        (1, 0, '总部', 'HQ', 1, 'admin', '', 1, true, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);

  await dbClient
    .prepare(
      `INSERT INTO sys_dept
        (id, parent_id, name, code, sort, leader, phone, status, created_at, updated_at)
       VALUES
        (2, 1, '产品部', 'PRODUCT', 2, 'demo', '13900000000', 1, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);

  await dbClient.prepare("UPDATE sys_dept SET is_system = true WHERE id = 1").run();

  await dbClient
    .prepare(
      `INSERT INTO sys_user
        (id, username, password_hash, nickname, sex, email, mobile, dept_id, status, is_system, password_updated_at, created_at, updated_at)
       VALUES
        (1, 'admin', ?, '超级管理员', 2, 'admin@xinadmin.test', '13800000000', 1, 1, true, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(adminPasswordHash, now, now, now);

  await dbClient
    .prepare(
      `INSERT INTO sys_user
        (id, username, password_hash, nickname, sex, email, mobile, dept_id, status, password_updated_at, created_at, updated_at)
       VALUES
        (2, 'demo', ?, '演示用户', 1, 'demo@xinadmin.test', '13900000000', 2, 1, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(demoPasswordHash, now, now, now);

  await dbClient.prepare("UPDATE sys_user SET is_system = true WHERE id = 1").run();

  await dbClient
    .prepare(
      `INSERT INTO sys_role
        (id, name, code, remark, sort, status, data_scope, is_system, created_at, updated_at)
       VALUES
        (1, '超级管理员', 'admin', '拥有系统全部权限', 1, 1, 'all', true, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);

  await dbClient
    .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (1, 1) ON CONFLICT DO NOTHING")
    .run();

  await dbClient
    .prepare(
      `INSERT INTO sys_role
        (id, name, code, remark, sort, status, data_scope, created_at, updated_at)
       VALUES
        (2, '运营人员', 'operator', '演示运营角色', 2, 1, 'current_dept_tree', ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);

  await dbClient
    .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (2, 2) ON CONFLICT DO NOTHING")
    .run();
  await dbClient
    .prepare("INSERT INTO sys_role_dept (role_id, dept_id) VALUES (2, 2) ON CONFLICT DO NOTHING")
    .run();
  await dbClient
    .prepare("UPDATE sys_role SET is_system = true, data_scope = 'all' WHERE id = 1")
    .run();

  const insertRule = dbClient.prepare(
    `INSERT INTO sys_rule
      (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, true, ?, ?)
     ON CONFLICT DO NOTHING`,
  );

  for (const rule of seedRules) {
    await insertRule.run(
      rule.id,
      rule.parentId,
      rule.type,
      rule.key,
      rule.name,
      rule.path ?? null,
      rule.icon ?? null,
      rule.order,
      rule.hidden ?? 1,
      now,
      now,
    );
  }
  const seedRuleIds = seedRules.map((rule) => rule.id);
  await dbClient
    .prepare(
      `UPDATE sys_rule SET is_system = true WHERE id IN (${seedRuleIds.map(() => "?").join(", ")})`,
    )
    .run(...seedRuleIds);

  const insertRoleRule = dbClient.prepare(
    "INSERT INTO sys_role_rule (role_id, rule_id) VALUES (1, ?) ON CONFLICT DO NOTHING",
  );
  for (const rule of seedRules) {
    await insertRoleRule.run(rule.id);
  }

  const insertDict = dbClient.prepare(
    `INSERT INTO sys_dict
      (id, name, code, remark, status, sort, is_system, created_at, updated_at)
     VALUES
      (?, ?, ?, '', 1, ?, true, ?, ?)
     ON CONFLICT DO NOTHING`,
  );
  const insertDictItem = dbClient.prepare(
    `INSERT INTO sys_dict_item
      (dict_id, label, value, color, status, sort, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  );

  for (const [index, dict] of seedDicts.entries()) {
    await insertDict.run(dict.id, dict.name, dict.code, index + 1, now, now);
    await dbClient.prepare("UPDATE sys_dict SET is_system = true WHERE id = ?").run(dict.id);
    for (const item of dict.items) {
      await insertDictItem.run(dict.id, item.label, item.value, item.color, item.sort, now, now);
    }
  }

  await dbClient
    .prepare(
      `INSERT INTO sys_config_group
        (id, name, code, sort, status, is_system, created_at, updated_at)
       VALUES
        (1, '基础配置', 'basic', 1, 1, true, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);
  await dbClient
    .prepare(
      `INSERT INTO sys_config_group
        (id, name, code, sort, status, is_system, created_at, updated_at)
       VALUES
        (2, '文件策略', 'file', 2, 1, true, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);
  for (const group of [
    { id: 3, name: "安全策略", code: "security", sort: 3 },
    { id: 4, name: "登录策略", code: "login", sort: 4 },
    { id: 5, name: "Token 策略", code: "token", sort: 5 },
  ]) {
    await dbClient
      .prepare(
        `INSERT INTO sys_config_group
          (id, name, code, sort, status, is_system, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, 1, true, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .run(group.id, group.name, group.code, group.sort, now, now);
  }
  await dbClient.prepare("UPDATE sys_config_group SET is_system = true WHERE id IN (1, 2, 3, 4, 5)").run();
  await dbClient.prepare("UPDATE sys_config_group SET name = '文件策略' WHERE code = 'file'").run();

  const insertConfig = dbClient.prepare(
    `INSERT INTO sys_config_items
      (group_id, key, title, describe, "values", type, sort, status, is_system, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, 1, true, ?, ?)
     ON CONFLICT DO NOTHING`,
  );

  for (const item of [
    {
      groupId: 1,
      key: "site_name",
      title: "站点名称",
      describe: "后台浏览器标题和默认品牌名",
      values: "Admin Base",
      type: "text",
      sort: 1,
    },
    {
      groupId: 1,
      key: "site_logo",
      title: "站点 Logo",
      describe: "后台 Logo 地址",
      values: "",
      type: "image",
      sort: 2,
    },
    {
      groupId: 1,
      key: "site_description",
      title: "站点描述",
      describe: "后台系统说明，用于设置页和后续系统信息展示",
      values: "PostgreSQL-first admin framework",
      type: "textarea",
      sort: 3,
    },
    {
      groupId: 2,
      key: "file.max_upload_size_mb",
      title: "最大上传大小",
      describe: "单文件最大上传大小，单位 MB",
      values: "50",
      type: "number",
      sort: 1,
    },
    {
      groupId: 2,
      key: "file.allowed_extensions",
      title: "允许扩展名",
      describe: "英文逗号分隔，留空时使用系统默认白名单",
      values: "jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,txt,csv,zip,mp3,mp4,webm",
      type: "textarea",
      sort: 2,
    },
    {
      groupId: 2,
      key: "file.denied_extensions",
      title: "禁止扩展名",
      describe: "英文逗号分隔，优先级高于允许扩展名",
      values: "exe,bat,cmd,sh,php,html,htm,js,mjs,svg",
      type: "textarea",
      sort: 3,
    },
    {
      groupId: 2,
      key: "file.public_base_url",
      title: "公开访问前缀",
      describe: "本地存储默认 /uploads，S3 建议配置 CDN 或 bucket public URL",
      values: "/uploads",
      type: "text",
      sort: 4,
    },
    {
      groupId: 2,
      key: "file.preview_max_size_mb",
      title: "预览大小上限",
      describe: "前端预览建议大小上限，单位 MB",
      values: "20",
      type: "number",
      sort: 5,
    },
    {
      groupId: 2,
      key: "file.trash_retention_days",
      title: "回收站保留天数",
      describe: "文件软删除后的建议保留天数",
      values: "30",
      type: "number",
      sort: 6,
    },
    {
      groupId: 2,
      key: "file.enable_sha256_dedupe",
      title: "启用哈希去重",
      describe: "启用后相同存储内相同 sha256 文件会直接复用元数据",
      values: "false",
      type: "switch",
      sort: 7,
    },
    {
      groupId: 2,
      key: "file.mime_check_enabled",
      title: "启用 MIME 校验",
      describe: "开启后校验文件 MIME 与扩展名是否匹配",
      values: "true",
      type: "switch",
      sort: 8,
    },
    {
      groupId: 2,
      key: "file.magic_check_enabled",
      title: "启用文件头校验",
      describe: "开启后校验常见文件类型的文件头魔数",
      values: "true",
      type: "switch",
      sort: 9,
    },
    {
      groupId: 2,
      key: "file.dangerous_file_strategy",
      title: "危险文件策略",
      describe: "reject=拒绝上传，isolated-download=隔离下载，force-download=强制下载",
      values: "reject",
      type: "select",
      sort: 10,
    },
    {
      groupId: 3,
      key: "security.password_min_length",
      title: "密码最小长度",
      describe: "新密码和重置密码的最小长度",
      values: "6",
      type: "digit",
      sort: 1,
    },
    {
      groupId: 3,
      key: "security.password_require_uppercase",
      title: "要求大写字母",
      describe: "开启后密码必须包含大写字母",
      values: "false",
      type: "switch",
      sort: 2,
    },
    {
      groupId: 3,
      key: "security.password_require_lowercase",
      title: "要求小写字母",
      describe: "开启后密码必须包含小写字母",
      values: "false",
      type: "switch",
      sort: 3,
    },
    {
      groupId: 3,
      key: "security.password_require_number",
      title: "要求数字",
      describe: "开启后密码必须包含数字",
      values: "false",
      type: "switch",
      sort: 4,
    },
    {
      groupId: 3,
      key: "security.password_require_symbol",
      title: "要求特殊字符",
      describe: "开启后密码必须包含特殊字符",
      values: "false",
      type: "switch",
      sort: 5,
    },
    {
      groupId: 3,
      key: "security.password_history_count",
      title: "密码历史数量",
      describe: "禁止复用最近 N 次密码，0 表示不检查",
      values: "3",
      type: "digit",
      sort: 6,
    },
    {
      groupId: 3,
      key: "security.password_expire_days",
      title: "密码有效天数",
      describe: "0 表示不过期",
      values: "0",
      type: "digit",
      sort: 7,
    },
    {
      groupId: 3,
      key: "security.force_change_on_first_login",
      title: "首次登录强制改密",
      describe: "预留策略项",
      values: "false",
      type: "switch",
      sort: 8,
    },
    {
      groupId: 4,
      key: "login.max_failed_attempts",
      title: "失败锁定次数",
      describe: "连续失败达到次数后锁定账号，0 表示不锁定",
      values: "5",
      type: "digit",
      sort: 1,
    },
    {
      groupId: 4,
      key: "login.lock_minutes",
      title: "锁定分钟数",
      describe: "失败锁定持续时间",
      values: "15",
      type: "digit",
      sort: 2,
    },
    {
      groupId: 4,
      key: "login.captcha_enabled",
      title: "启用验证码",
      describe: "开启后登录页显示验证码，并要求登录接口校验验证码",
      values: "false",
      type: "switch",
      sort: 3,
    },
    {
      groupId: 4,
      key: "login.allow_multi_session",
      title: "允许多端登录",
      describe: "关闭后登录会撤销该用户其他会话",
      values: "true",
      type: "switch",
      sort: 4,
    },
    {
      groupId: 4,
      key: "login.max_online_tokens",
      title: "最大在线会话数",
      describe: "每个用户最多保留的有效会话数，0 表示不限制",
      values: "0",
      type: "digit",
      sort: 5,
    },
    {
      groupId: 4,
      key: "login.captcha_after_failures",
      title: "失败后触发验证码",
      describe: "同一账号连续失败达到 N 次后要求验证码，0 表示只使用全局验证码开关",
      values: "0",
      type: "digit",
      sort: 6,
    },
    {
      groupId: 4,
      key: "login.oauth_providers_json",
      title: "第三方登录配置",
      describe:
        'JSON 数组；仅 enabled=true 且 authUrl 为 http(s) 的 provider 会显示在登录页，例如 [{"key":"github","name":"GitHub","enabled":true,"authUrl":"https://github.com/login/oauth/authorize?..."}]',
      values: "[]",
      type: "textarea",
      sort: 7,
    },
    {
      groupId: 5,
      key: "token.access_token_ttl_days",
      title: "Token 有效天数",
      describe: "未勾选记住登录时的 token 有效期",
      values: "7",
      type: "digit",
      sort: 1,
    },
    {
      groupId: 5,
      key: "token.remember_ttl_days",
      title: "记住登录有效天数",
      describe: "勾选记住登录时的 token 有效期，0 表示不过期",
      values: "30",
      type: "digit",
      sort: 2,
    },
    {
      groupId: 5,
      key: "token.refresh_last_used",
      title: "刷新最近活跃时间",
      describe: "请求时刷新 token 最近活跃时间",
      values: "true",
      type: "switch",
      sort: 3,
    },
    {
      groupId: 5,
      key: "token.cleanup_expired_days",
      title: "过期会话清理窗口",
      describe: "清理早于 N 天前过期的 token",
      values: "30",
      type: "digit",
      sort: 4,
    },
  ]) {
    await insertConfig.run(
      item.groupId,
      item.key,
      item.title,
      item.describe,
      item.values,
      item.type,
      item.sort,
      now,
      now,
    );
    await dbClient
      .prepare("UPDATE sys_config_items SET is_system = true WHERE key = ?")
      .run(item.key);
  }

  await dbClient
    .prepare(
      `INSERT INTO sys_storage
        (id, name, code, type, base_url, root_path, is_default, status, sort, is_system, created_at, updated_at)
       SELECT
        1, '本地存储', 'local', 'local', '/uploads', 'storage/uploads',
        NOT EXISTS (SELECT 1 FROM sys_storage WHERE is_default = true AND deleted_at IS NULL),
        1, 1, true, ?, ?
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);
  await dbClient
    .prepare(
      `UPDATE sys_storage
       SET
        is_system = true,
        is_default = CASE
          WHEN EXISTS (
            SELECT 1 FROM sys_storage
            WHERE is_default = true AND deleted_at IS NULL AND id <> 1
          ) THEN false
          ELSE true
        END,
        status = 1
       WHERE id = 1`,
    )
    .run();
  await dbClient.prepare("DELETE FROM sys_config_items WHERE key = 'file.default_storage'").run();

  await dbClient
    .prepare(
      `INSERT INTO sys_mail_account
        (id, name, code, host, port, secure, username, from_name, from_email, reply_to, is_default, status, sort, is_system, created_at, updated_at)
       SELECT
        1, '本地 SMTP', 'local', 'localhost', 1025, false, NULL, 'Admin Base',
        'noreply@admin-base.local', NULL,
        NOT EXISTS (SELECT 1 FROM sys_mail_account WHERE is_default = true AND deleted_at IS NULL),
        1, 1, true, ?, ?
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);
  await dbClient
    .prepare(
      `UPDATE sys_mail_account
       SET
        is_system = true,
        is_default = CASE
          WHEN EXISTS (
            SELECT 1 FROM sys_mail_account
            WHERE is_default = true AND deleted_at IS NULL AND id <> 1
          ) THEN false
          ELSE true
        END,
        status = 1
       WHERE id = 1`,
    )
    .run();

  await dbClient
    .prepare(
      `INSERT INTO sys_file_group
        (id, parent_id, name, sort, describe, created_at, updated_at)
       VALUES
        (1, 0, '默认分组', 1, '默认上传文件分组', ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);

  await syncSequences(dbClient);
}
