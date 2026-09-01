import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { type DbClient, sqlite } from "@/server/db";
import { getAdminBaseEnv } from "@/server/env";
import { runMigrations } from "../migrations";
import { seedDicts, seedRules } from "./default-data";

function nowIso() {
  return new Date().toISOString();
}

type SeedWebsiteFile = {
  key: string;
  originalName: string;
  filename: string;
  path: string;
  mime: string;
  type: "image" | "document";
  read: () => Promise<Buffer>;
};

const seedWebsiteFiles: SeedWebsiteFile[] = [
  {
    key: "website.login-background-light",
    originalName: "网站登录背景-浅色.png",
    filename: "site-login-light.png",
    path: "seed/site-login-light.png",
    mime: "image/png",
    type: "image",
    read: () => fs.readFile(path.join(process.cwd(), "public", "static", "bg.png")),
  },
  {
    key: "website.login-background-dark",
    originalName: "网站登录背景-暗色.jpg",
    filename: "site-login-dark.jpg",
    path: "seed/site-login-dark.jpg",
    mime: "image/jpeg",
    type: "image",
    read: () => fs.readFile(path.join(process.cwd(), "public", "static", "bg-dark.jpg")),
  },
  {
    key: "website.robots",
    originalName: "robots.txt",
    filename: "robots.txt",
    path: "seed/robots.txt",
    mime: "text/plain",
    type: "document",
    read: async () =>
      Buffer.from("User-agent: *\nDisallow: /system/\nDisallow: /api/system/\n", "utf8"),
  },
];

async function seedDefaultWebsiteFiles(dbClient: DbClient, now: string) {
  const uploadRoot = path.join(process.cwd(), "storage", "uploads");

  for (const item of seedWebsiteFiles) {
    const metadataJson = JSON.stringify({
      seedKey: item.key,
      source: "admin-base-default-seed",
      removable: true,
    });
    const existing = (await dbClient
      .prepare(
        `SELECT id, deleted_at AS deletedAt
         FROM sys_file
         WHERE metadata_json = ?
         ORDER BY id ASC
         LIMIT 1`,
      )
      .get(metadataJson)) as { id: number; deletedAt: string | null } | undefined;

    // A soft-deleted seed file stays deleted. A later full database reset creates it again.
    if (existing?.deletedAt) continue;

    const content = await item.read();
    const absolutePath = path.join(uploadRoot, item.path);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);

    if (existing) continue;

    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    await dbClient
      .prepare(
        `INSERT INTO sys_file
          (group_id, storage_id, original_name, filename, path, url, size, ext, mime, type,
           sha256, metadata_json, uploader_id, created_at, updated_at)
         VALUES
          (2, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        item.originalName,
        item.filename,
        item.path,
        `/uploads/${item.path}`,
        content.byteLength,
        path.extname(item.filename).slice(1),
        item.mime,
        item.type,
        sha256,
        metadataJson,
        now,
        now,
      );
  }
}

async function seedDefaultAiEvalDataset(dbClient: DbClient) {
  await dbClient
    .prepare(
      `INSERT INTO sys_ai_eval_dataset
        (name, description, scope_type, status, sort, created_by, updated_by)
       SELECT
        'Admin Base Agent 基线回归',
        '系统内置的 Agent 核心能力回归集。执行前需要配置可用的 Agent 用途模型；联网搜索用例还需要启用 Web Search Provider。',
        'global', 1, 0, 1, 1
       WHERE EXISTS (SELECT 1 FROM sys_user WHERE id = 1)
         AND EXISTS (SELECT 1 FROM sys_ai_agent WHERE code = 'general-assistant' AND deleted_at IS NULL)
         AND NOT EXISTS (
           SELECT 1 FROM sys_ai_eval_dataset
           WHERE name = 'Admin Base Agent 基线回归' AND deleted_at IS NULL
         )`,
    )
    .run();

  const cases = [
    {
      name: "基础指令遵循",
      description: "验证 Agent 能稳定遵循精确输出指令。",
      inputText: "请只回复：Admin Base Eval OK",
      expectedText: "Admin Base Eval OK",
      assertions: {
        contains: ["Admin Base Eval OK"],
        forbiddenTools: ["web-search", "browser-location"],
      },
      tags: ["baseline", "instruction"],
      sort: 10,
    },
    {
      name: "计算器工具调用",
      description: "验证确定性计算会调用受控 calculator 工具。",
      inputText: "请使用计算器计算 125 * 8，并在最终答案中包含计算结果。",
      expectedText: "1000",
      assertions: {
        contains: ["1000"],
        expectedTools: ["calculator"],
        forbiddenTools: ["web-search", "browser-location"],
      },
      tags: ["baseline", "tool", "calculator"],
      sort: 20,
    },
    {
      name: "联网搜索工具调用",
      description: "验证时效性问题会进入 Web Search；运行环境需要启用搜索 Provider。",
      inputText: "请联网查询深圳今天的天气，并给出信息来源。",
      expectedText: null,
      assertions: { expectedTools: ["web-search"], forbiddenTools: ["browser-location"] },
      tags: ["baseline", "tool", "web-search", "external"],
      sort: 30,
    },
  ];

  for (const item of cases) {
    await dbClient
      .prepare(
        `INSERT INTO sys_ai_eval_case
          (dataset_id, name, description, agent_id, input_text, expected_text,
           assertions_json, tags_json, status, sort, created_by, updated_by)
         SELECT dataset.id, ?, ?, agent.id, ?, ?, ?, ?, 1, ?, 1, 1
         FROM (
           SELECT id FROM sys_ai_eval_dataset
           WHERE name = 'Admin Base Agent 基线回归' AND deleted_at IS NULL
           ORDER BY id ASC LIMIT 1
         ) dataset
         CROSS JOIN (
           SELECT id FROM sys_ai_agent
           WHERE code = 'general-assistant' AND deleted_at IS NULL
           ORDER BY id ASC LIMIT 1
         ) agent
         WHERE NOT EXISTS (
           SELECT 1 FROM sys_ai_eval_case eval_case
           WHERE eval_case.dataset_id = dataset.id AND eval_case.name = ?
             AND eval_case.deleted_at IS NULL
         )`,
      )
      .run(
        item.name,
        item.description,
        item.inputText,
        item.expectedText,
        JSON.stringify(item.assertions),
        JSON.stringify(item.tags),
        item.sort,
        item.name,
      );
  }
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
    "sys_oauth_provider",
    "sys_sms_provider",
    "sys_ai_provider",
    "sys_ai_web_search_provider",
    "sys_ai_model",
    "sys_ai_agent",
    "sys_ai_tool",
    "sys_ai_chat_session",
    "sys_ai_chat_message",
    "sys_ai_agent_run",
    "sys_ai_agent_run_step",
    "sys_ai_agent_run_event",
    "sys_ai_tool_execution",
    "sys_ai_tool_approval",
    "sys_ai_workflow_run",
    "sys_ai_workflow_run_step",
    "sys_ai_invocation",
    "sys_ai_invocation_attempt",
    "sys_ai_knowledge_base",
    "sys_ai_document",
    "sys_ai_document_chunk",
    "sys_ai_rag_run",
    "sys_ai_rag_citation",
    "sys_ai_notebook",
    "sys_ai_notebook_source",
    "sys_ai_notebook_artifact",
    "sys_ai_eval_dataset",
    "sys_ai_eval_case",
    "sys_ai_eval_run",
    "sys_ai_eval_result",
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

  await seedDefaultAiEvalDataset(dbClient);

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
  const syncSeedRule = dbClient.prepare(
    `UPDATE sys_rule
     SET
      parent_id = ?,
      type = ?,
      key = ?,
      name = ?,
      path = ?,
      icon = ?,
      "order" = ?,
      hidden = ?,
      link = 0,
      is_system = true,
      updated_at = ?
     WHERE id = ?`,
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
    await syncSeedRule.run(
      rule.parentId,
      rule.type,
      rule.key,
      rule.name,
      rule.path ?? null,
      rule.icon ?? null,
      rule.order,
      rule.hidden ?? 1,
      now,
      rule.id,
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
  await dbClient.exec(`
INSERT INTO sys_role_rule (role_id, rule_id)
SELECT DISTINCT srr.role_id, child.parent_id
FROM sys_role_rule srr
INNER JOIN sys_rule child ON child.id = srr.rule_id
WHERE child.parent_id IN (170, 180, 190)
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT DISTINCT srr.role_id, 2
FROM sys_role_rule srr
INNER JOIN sys_rule rule ON rule.id = srr.rule_id
WHERE rule.parent_id = 2 OR rule.id IN (170, 180, 190)
ON CONFLICT DO NOTHING;
`);

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
  await dbClient
    .prepare("UPDATE sys_config_group SET is_system = true WHERE id IN (1, 2, 3, 4, 5)")
    .run();
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
      values: "jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,txt,md,markdown,csv,zip,mp3,mp4,webm",
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
      groupId: 4,
      key: "login.rate_limit_attempts",
      title: "组合限流失败次数",
      describe: "同一 IP 与账号在限流窗口内允许的失败次数，0 表示关闭",
      values: "10",
      type: "digit",
      sort: 8,
    },
    {
      groupId: 4,
      key: "login.rate_limit_window_minutes",
      title: "组合限流窗口",
      describe: "按 IP 与账号组合统计登录失败的时间窗口，单位分钟",
      values: "5",
      type: "digit",
      sort: 9,
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
      `INSERT INTO sys_oauth_provider
        (key, name, enabled, auth_url, token_url, user_info_url, scopes_json, user_mapping_json, status, sort, is_system, created_at, updated_at)
       VALUES
        ('github', 'GitHub', false, 'https://github.com/login/oauth/authorize', 'https://github.com/login/oauth/access_token', 'https://api.github.com/user', '["user:email"]', '{"id":"id","username":"login","email":"email","nickname":"name"}', 1, 1, true, ?, ?),
        ('gitee', 'Gitee', false, 'https://gitee.com/oauth/authorize', 'https://gitee.com/oauth/token', 'https://gitee.com/api/v5/user', '["user_info"]', '{"id":"id","username":"login","email":"email","nickname":"name"}', 1, 2, true, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now, now, now);

  await dbClient
    .prepare(
      `INSERT INTO sys_ai_provider
        (id, name, code, provider_type, base_url, is_default, status, sort, remark, is_system, created_at, updated_at)
       VALUES
        (1, 'OpenAI Compatible', 'openai-compatible', 'openai-compatible', 'https://api.openai.com/v1', false, 0, 1, '内置模板：配置 API Key 并启用后可作为业务默认 AI Provider', true, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);
  await dbClient
    .prepare(
      `INSERT INTO sys_ai_provider
        (id, name, code, provider_type, base_url, is_default, status, sort, remark, is_system, created_at, updated_at)
       VALUES
        (2, 'OpenAI', 'openai', 'openai', 'https://api.openai.com/v1', false, 0, 2, 'OpenAI 官方接口模板，配置 API Key 后启用', true, ?, ?),
        (3, 'Anthropic Claude', 'anthropic', 'anthropic', 'https://api.anthropic.com/v1', false, 0, 3, 'Anthropic Claude 原生接口模板', true, ?, ?),
        (4, 'Google Gemini', 'gemini', 'google', 'https://generativelanguage.googleapis.com/v1beta', false, 0, 4, 'Google Gemini 原生接口模板', true, ?, ?),
        (5, 'DeepSeek', 'deepseek', 'deepseek', 'https://api.deepseek.com/v1', false, 0, 5, 'DeepSeek OpenAI-compatible 接口模板', true, ?, ?),
        (6, 'Qwen / DashScope', 'qwen', 'qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', false, 0, 6, '通义千问 DashScope OpenAI-compatible 接口模板', true, ?, ?),
        (7, 'Moonshot / Kimi', 'moonshot', 'moonshot', 'https://api.moonshot.cn/v1', false, 0, 7, 'Moonshot Kimi OpenAI-compatible 接口模板', true, ?, ?),
        (8, 'Zhipu GLM', 'zhipu', 'zhipu', 'https://open.bigmodel.cn/api/paas/v4', false, 0, 8, '智谱 GLM OpenAI-compatible 接口模板', true, ?, ?),
        (9, 'SiliconFlow', 'siliconflow', 'siliconflow', 'https://api.siliconflow.cn/v1', false, 0, 9, 'SiliconFlow OpenAI-compatible 网关模板', true, ?, ?),
        (10, 'OpenRouter', 'openrouter', 'openrouter', 'https://openrouter.ai/api/v1', false, 0, 10, 'OpenRouter OpenAI-compatible 网关模板', true, ?, ?),
        (11, 'Ollama Local', 'ollama', 'ollama', 'http://localhost:11434/v1', false, 0, 11, '本地 Ollama OpenAI-compatible 模板，可在 optionsJson 设置 {"authRequired":false}', true, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
      now,
    );
  await dbClient
    .prepare(
      `UPDATE sys_ai_provider
       SET is_system = true
       WHERE id BETWEEN 1 AND 11`,
    )
    .run();

  await dbClient
    .prepare(
      `INSERT INTO sys_ai_model
        (id, provider_id, name, model_id, model_type, capabilities_json, context_window, max_output_tokens, status, sort, remark, is_system, created_at, updated_at)
       VALUES
        (1, 1, 'GPT-4.1 Mini', 'gpt-4.1-mini', 'chat', '{"chat":true,"structured":true,"toolCalling":true}', 1047576, 32768, 0, 1, '内置 Chat/Structured 模型模板', true, ?, ?),
        (2, 1, 'Text Embedding 3 Small', 'text-embedding-3-small', 'embedding', '{"embedding":true}', 8191, NULL, 0, 2, '内置 Embedding 模型模板', true, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now, now, now);
  await dbClient
    .prepare(
      `UPDATE sys_ai_model
       SET is_system = true
       WHERE id IN (1, 2)`,
    )
    .run();

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
        (1, 0, '默认分组', 1, '默认上传文件分组', ?, ?),
        (2, 0, '网站素材', 2, '可删除的网站默认素材', ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now, now, now);

  await seedDefaultWebsiteFiles(dbClient, now);

  await syncSequences(dbClient);
}
