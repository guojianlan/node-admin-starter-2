import bcrypt from "bcryptjs";
import { type DbClient, sqlite } from "@/server/db";
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
    "sys_file_group",
    "sys_file",
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
  const passwordHash = await bcrypt.hash("123456", 10);

  await dbClient
    .prepare(
      `INSERT INTO sys_dept
        (id, parent_id, name, code, sort, leader, phone, status, created_at, updated_at)
       VALUES
        (1, 0, '总部', 'HQ', 1, 'admin', '', 1, ?, ?)
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

  await dbClient
    .prepare(
      `INSERT INTO sys_user
        (id, username, password_hash, nickname, sex, email, mobile, dept_id, status, created_at, updated_at)
       VALUES
        (1, 'admin', ?, '超级管理员', 2, 'admin@xinadmin.test', '13800000000', 1, 1, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(passwordHash, now, now);

  await dbClient
    .prepare(
      `INSERT INTO sys_user
        (id, username, password_hash, nickname, sex, email, mobile, dept_id, status, created_at, updated_at)
       VALUES
        (2, 'demo', ?, '演示用户', 1, 'demo@xinadmin.test', '13900000000', 2, 1, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(passwordHash, now, now);

  await dbClient
    .prepare(
      `INSERT INTO sys_role
        (id, name, code, remark, sort, status, created_at, updated_at)
       VALUES
        (1, '超级管理员', 'admin', '拥有系统全部权限', 1, 1, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);

  await dbClient
    .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (1, 1) ON CONFLICT DO NOTHING")
    .run();

  await dbClient
    .prepare(
      `INSERT INTO sys_role
        (id, name, code, remark, sort, status, created_at, updated_at)
       VALUES
        (2, '运营人员', 'operator', '演示运营角色', 2, 1, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);

  await dbClient
    .prepare("INSERT INTO sys_user_role (user_id, role_id) VALUES (2, 2) ON CONFLICT DO NOTHING")
    .run();

  const insertRule = dbClient.prepare(
    `INSERT INTO sys_rule
      (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, created_at, updated_at)
     VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)
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

  const insertRoleRule = dbClient.prepare(
    "INSERT INTO sys_role_rule (role_id, rule_id) VALUES (1, ?) ON CONFLICT DO NOTHING",
  );
  for (const rule of seedRules) {
    await insertRoleRule.run(rule.id);
  }

  const insertDict = dbClient.prepare(
    `INSERT INTO sys_dict
      (id, name, code, remark, status, sort, created_at, updated_at)
     VALUES
      (?, ?, ?, '', 1, ?, ?, ?)
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
    for (const item of dict.items) {
      await insertDictItem.run(dict.id, item.label, item.value, item.color, item.sort, now, now);
    }
  }

  await dbClient
    .prepare(
      `INSERT INTO sys_config_group
        (id, name, code, sort, status, created_at, updated_at)
       VALUES
        (1, '基础配置', 'basic', 1, 1, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(now, now);

  const insertConfig = dbClient.prepare(
    `INSERT INTO sys_config_items
      (group_id, key, title, describe, "values", type, sort, status, created_at, updated_at)
     VALUES
      (1, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT DO NOTHING`,
  );

  for (const item of [
    {
      key: "site_name",
      title: "站点名称",
      describe: "后台浏览器标题和默认品牌名",
      values: "Admin Base",
      type: "text",
      sort: 1,
    },
    {
      key: "site_logo",
      title: "站点 Logo",
      describe: "后台 Logo 地址",
      values: "",
      type: "image",
      sort: 2,
    },
  ]) {
    await insertConfig.run(
      item.key,
      item.title,
      item.describe,
      item.values,
      item.type,
      item.sort,
      now,
      now,
    );
  }

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
