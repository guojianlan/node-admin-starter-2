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
    "sys_dict",
    "sys_dict_item",
    "sys_config_group",
    "sys_config_items",
    "sys_storage",
    "sys_file_group",
    "sys_file",
    "sys_mail_account",
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
        (id, username, password_hash, nickname, sex, email, mobile, dept_id, status, is_system, created_at, updated_at)
       VALUES
        (1, 'admin', ?, '超级管理员', 2, 'admin@xinadmin.test', '13800000000', 1, 1, true, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(adminPasswordHash, now, now);

  await dbClient
    .prepare(
      `INSERT INTO sys_user
        (id, username, password_hash, nickname, sex, email, mobile, dept_id, status, created_at, updated_at)
       VALUES
        (2, 'demo', ?, '演示用户', 1, 'demo@xinadmin.test', '13900000000', 2, 1, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(demoPasswordHash, now, now);

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
  await dbClient.prepare("UPDATE sys_config_group SET is_system = true WHERE id IN (1, 2)").run();
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
      values: "jpg,jpeg,png,gif,webp,svg,pdf,doc,docx,xls,xlsx,txt,csv,zip,mp3,mp4,webm",
      type: "textarea",
      sort: 2,
    },
    {
      groupId: 2,
      key: "file.denied_extensions",
      title: "禁止扩展名",
      describe: "英文逗号分隔，优先级高于允许扩展名",
      values: "exe,bat,cmd,sh,php",
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
