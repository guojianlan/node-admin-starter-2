import bcrypt from "bcryptjs";
import type Database from "better-sqlite3";
import { runMigrations } from "../migrations";
import { seedDicts, seedRules } from "./default-data";

function nowIso() {
  return new Date().toISOString();
}

export async function seedDatabase(sqlite: Database.Database) {
  runMigrations(sqlite);

  const now = nowIso();
  const passwordHash = await bcrypt.hash("123456", 10);

  sqlite
    .prepare(
      `INSERT OR IGNORE INTO sys_dept
        (id, parent_id, name, code, sort, leader, phone, status, created_at, updated_at)
       VALUES
        (1, 0, '总部', 'HQ', 1, 'admin', '', 1, ?, ?)`,
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT OR IGNORE INTO sys_dept
        (id, parent_id, name, code, sort, leader, phone, status, created_at, updated_at)
       VALUES
        (2, 1, '产品部', 'PRODUCT', 2, 'demo', '13900000000', 1, ?, ?)`,
    )
    .run(now, now);

  sqlite
    .prepare(
      `INSERT OR IGNORE INTO sys_user
        (id, username, password_hash, nickname, sex, email, mobile, dept_id, status, created_at, updated_at)
       VALUES
        (1, 'admin', ?, '超级管理员', 2, 'admin@xinadmin.test', '13800000000', 1, 1, ?, ?)`,
    )
    .run(passwordHash, now, now);

  sqlite
    .prepare(
      `INSERT OR IGNORE INTO sys_user
        (id, username, password_hash, nickname, sex, email, mobile, dept_id, status, created_at, updated_at)
       VALUES
        (2, 'demo', ?, '演示用户', 1, 'demo@xinadmin.test', '13900000000', 2, 1, ?, ?)`,
    )
    .run(passwordHash, now, now);

  sqlite
    .prepare(
      `INSERT OR IGNORE INTO sys_role
        (id, name, code, remark, sort, status, created_at, updated_at)
       VALUES
        (1, '超级管理员', 'admin', '拥有系统全部权限', 1, 1, ?, ?)`,
    )
    .run(now, now);

  sqlite.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_id) VALUES (1, 1)").run();

  sqlite
    .prepare(
      `INSERT OR IGNORE INTO sys_role
        (id, name, code, remark, sort, status, created_at, updated_at)
       VALUES
        (2, '运营人员', 'operator', '演示运营角色', 2, 1, ?, ?)`,
    )
    .run(now, now);

  sqlite.prepare("INSERT OR IGNORE INTO sys_user_role (user_id, role_id) VALUES (2, 2)").run();

  const insertRule = sqlite.prepare(
    `INSERT OR IGNORE INTO sys_rule
      (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, created_at, updated_at)
     VALUES
      (@id, @parentId, @type, @key, @name, @path, @icon, @order, 1, @hidden, 0, @createdAt, @updatedAt)`,
  );

  seedRules.forEach((rule) => {
    insertRule.run({
      ...rule,
      path: rule.path ?? null,
      icon: rule.icon ?? null,
      hidden: rule.hidden ?? 1,
      createdAt: now,
      updatedAt: now,
    });
  });

  const insertRoleRule = sqlite.prepare(
    "INSERT OR IGNORE INTO sys_role_rule (role_id, rule_id) VALUES (1, ?)",
  );
  seedRules.forEach((rule) => insertRoleRule.run(rule.id));

  const insertDict = sqlite.prepare(
    `INSERT OR IGNORE INTO sys_dict
      (id, name, code, remark, status, sort, created_at, updated_at)
     VALUES
      (@id, @name, @code, '', 1, @sort, @createdAt, @updatedAt)`,
  );
  const insertDictItem = sqlite.prepare(
    `INSERT OR IGNORE INTO sys_dict_item
      (dict_id, label, value, color, status, sort, created_at, updated_at)
     VALUES
      (@dictId, @label, @value, @color, 1, @sort, @createdAt, @updatedAt)`,
  );

  seedDicts.forEach((dict, index) => {
    insertDict.run({
      id: dict.id,
      name: dict.name,
      code: dict.code,
      sort: index + 1,
      createdAt: now,
      updatedAt: now,
    });
    dict.items.forEach((item) => {
      insertDictItem.run({
        dictId: dict.id,
        label: item.label,
        value: item.value,
        color: item.color,
        sort: item.sort,
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  sqlite
    .prepare(
      `INSERT OR IGNORE INTO sys_config_group
        (id, name, code, sort, status, created_at, updated_at)
       VALUES
        (1, '基础配置', 'basic', 1, 1, ?, ?)`,
    )
    .run(now, now);

  const insertConfig = sqlite.prepare(
    `INSERT OR IGNORE INTO sys_config_items
      (group_id, key, title, describe, "values", type, sort, status, created_at, updated_at)
     VALUES
      (1, @key, @title, @describe, @values, @type, @sort, 1, @createdAt, @updatedAt)`,
  );

  [
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
  ].forEach((item) => insertConfig.run({ ...item, createdAt: now, updatedAt: now }));

  sqlite
    .prepare(
      `INSERT OR IGNORE INTO sys_file_group
        (id, name, sort, created_at, updated_at)
       VALUES
        (1, '默认分组', 1, ?, ?)`,
    )
    .run(now, now);
}
