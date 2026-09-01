import type postgres from "postgres";
import { sql } from "@/server/db";

type Migration = {
  id: string;
  sql: string;
};

const triggerTables = [
  "sys_user",
  "sys_role",
  "sys_dept",
  "sys_rule",
  "sys_access_token",
  "sys_dict",
  "sys_dict_item",
  "sys_config_group",
  "sys_config_items",
  "sys_storage",
  "sys_file_group",
  "sys_file",
  "sys_mail_account",
];

const updatedAtTriggers = triggerTables
  .map(
    (table) => `
DROP TRIGGER IF EXISTS trg_${table}_updated_at ON ${table};
CREATE TRIGGER trg_${table}_updated_at
BEFORE UPDATE ON ${table}
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
`,
  )
  .join("\n");

const migrations: Migration[] = [
  {
    id: "0001_pg_baseline",
    sql: `
CREATE TABLE IF NOT EXISTS sys_dept (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  code TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  leader TEXT,
  phone TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_role (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  remark TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_user (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar_id INTEGER,
  sex INTEGER NOT NULL DEFAULT 0,
  bio TEXT,
  mobile TEXT,
  email TEXT,
  dept_id INTEGER REFERENCES sys_dept(id) ON DELETE SET NULL,
  login_ip TEXT,
  login_time TIMESTAMPTZ,
  status INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_rule (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT,
  path TEXT,
  icon TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  i18n_key TEXT,
  component TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  hidden INTEGER NOT NULL DEFAULT 1,
  link INTEGER NOT NULL DEFAULT 0,
  default_auth INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_user_role (
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES sys_role(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS sys_role_rule (
  role_id INTEGER NOT NULL REFERENCES sys_role(id) ON DELETE CASCADE,
  rule_id INTEGER NOT NULL REFERENCES sys_rule(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, rule_id)
);

CREATE TABLE IF NOT EXISTS sys_access_token (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  abilities_json TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sys_login_record (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  status INTEGER NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sys_dict (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  remark TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_dict_item (
  id SERIAL PRIMARY KEY,
  dict_id INTEGER NOT NULL REFERENCES sys_dict(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  color TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_config_group (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_config_items (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES sys_config_group(id) ON DELETE RESTRICT,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  describe TEXT,
  "values" TEXT,
  type TEXT NOT NULL DEFAULT 'text',
  options_json TEXT,
  props_json TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_file_group (
  id SERIAL PRIMARY KEY,
  parent_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  describe TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_file (
  id SERIAL PRIMARY KEY,
  group_id INTEGER REFERENCES sys_file_group(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  url TEXT NOT NULL,
  size INTEGER NOT NULL,
  ext TEXT,
  mime TEXT,
  uploader_id INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_storage (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL,
  endpoint TEXT,
  region TEXT,
  bucket TEXT,
  access_key TEXT,
  secret_key_encrypted TEXT,
  base_url TEXT,
  root_path TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_mail_account (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  secure BOOLEAN NOT NULL DEFAULT false,
  username TEXT,
  password_encrypted TEXT,
  from_name TEXT,
  from_email TEXT NOT NULL,
  reply_to TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_role_dept (
  role_id INTEGER NOT NULL REFERENCES sys_role(id) ON DELETE CASCADE,
  dept_id INTEGER NOT NULL REFERENCES sys_dept(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, dept_id)
);

ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_role ADD COLUMN IF NOT EXISTS data_scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE sys_role ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_dept ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_rule ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_dict ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_config_group ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_config_items ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS storage_id INTEGER REFERENCES sys_storage(id) ON DELETE SET NULL;
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS metadata_json TEXT;
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS sys_user_username_active_unique ON sys_user(username) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_user_dept_id_idx ON sys_user(dept_id);
CREATE INDEX IF NOT EXISTS sys_user_status_created_at_idx ON sys_user(status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS sys_role_code_active_unique ON sys_role(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_role_status_sort_idx ON sys_role(status, sort);

CREATE INDEX IF NOT EXISTS sys_user_role_role_id_idx ON sys_user_role(role_id);
CREATE INDEX IF NOT EXISTS sys_role_dept_dept_id_idx ON sys_role_dept(dept_id);

CREATE INDEX IF NOT EXISTS sys_dept_parent_id_idx ON sys_dept(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS sys_dept_code_active_unique ON sys_dept(code) WHERE deleted_at IS NULL AND code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sys_rule_key_active_unique ON sys_rule(key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_rule_parent_id_idx ON sys_rule(parent_id);
CREATE INDEX IF NOT EXISTS sys_rule_type_status_idx ON sys_rule(type, status);

CREATE INDEX IF NOT EXISTS sys_role_rule_rule_id_idx ON sys_role_rule(rule_id);

CREATE UNIQUE INDEX IF NOT EXISTS sys_access_token_token_hash_unique ON sys_access_token(token_hash);
CREATE INDEX IF NOT EXISTS sys_access_token_user_id_idx ON sys_access_token(user_id);
CREATE INDEX IF NOT EXISTS sys_access_token_expires_at_idx ON sys_access_token(expires_at);

CREATE INDEX IF NOT EXISTS sys_login_record_created_at_idx ON sys_login_record(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS sys_dict_code_active_unique ON sys_dict(code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sys_dict_item_value_active_unique ON sys_dict_item(dict_id, value) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_dict_item_dict_status_sort_idx ON sys_dict_item(dict_id, status, sort);

CREATE UNIQUE INDEX IF NOT EXISTS sys_config_group_code_active_unique ON sys_config_group(code) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sys_config_items_key_active_unique ON sys_config_items(key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_config_items_group_id_idx ON sys_config_items(group_id);

CREATE UNIQUE INDEX IF NOT EXISTS sys_storage_code_active_unique ON sys_storage(code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sys_storage_default_active_unique ON sys_storage(is_default) WHERE deleted_at IS NULL AND is_default = true;
CREATE INDEX IF NOT EXISTS sys_storage_type_status_idx ON sys_storage(type, status);

CREATE INDEX IF NOT EXISTS sys_file_group_parent_id_idx ON sys_file_group(parent_id);

CREATE INDEX IF NOT EXISTS sys_file_group_id_idx ON sys_file(group_id);
CREATE INDEX IF NOT EXISTS sys_file_storage_id_idx ON sys_file(storage_id);
CREATE INDEX IF NOT EXISTS sys_file_uploader_id_idx ON sys_file(uploader_id);
CREATE INDEX IF NOT EXISTS sys_file_type_idx ON sys_file(type);
CREATE INDEX IF NOT EXISTS sys_file_sha256_idx ON sys_file(sha256);
CREATE INDEX IF NOT EXISTS sys_file_deleted_at_idx ON sys_file(deleted_at);
CREATE INDEX IF NOT EXISTS sys_file_created_at_idx ON sys_file(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS sys_mail_account_code_active_unique ON sys_mail_account(code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sys_mail_account_default_active_unique ON sys_mail_account(is_default) WHERE deleted_at IS NULL AND is_default = true;
CREATE INDEX IF NOT EXISTS sys_mail_account_status_sort_idx ON sys_mail_account(status, sort);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

${updatedAtTriggers}
`,
  },
  {
    id: "0002_admin_base_completion",
    sql: `
CREATE TABLE IF NOT EXISTS sys_storage (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT NOT NULL,
  endpoint TEXT,
  region TEXT,
  bucket TEXT,
  access_key TEXT,
  secret_key_encrypted TEXT,
  base_url TEXT,
  root_path TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_mail_account (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  secure BOOLEAN NOT NULL DEFAULT false,
  username TEXT,
  password_encrypted TEXT,
  from_name TEXT,
  from_email TEXT NOT NULL,
  reply_to TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_role_dept (
  role_id INTEGER NOT NULL REFERENCES sys_role(id) ON DELETE CASCADE,
  dept_id INTEGER NOT NULL REFERENCES sys_dept(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, dept_id)
);

ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_role ADD COLUMN IF NOT EXISTS data_scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE sys_role ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_dept ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_rule ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_dict ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_config_group ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_config_items ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS storage_id INTEGER REFERENCES sys_storage(id) ON DELETE SET NULL;
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS metadata_json TEXT;
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS thumbnail_path TEXT;
ALTER TABLE sys_file ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

CREATE INDEX IF NOT EXISTS sys_role_dept_dept_id_idx ON sys_role_dept(dept_id);
CREATE UNIQUE INDEX IF NOT EXISTS sys_storage_code_active_unique ON sys_storage(code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sys_storage_default_active_unique ON sys_storage(is_default) WHERE deleted_at IS NULL AND is_default = true;
CREATE INDEX IF NOT EXISTS sys_storage_type_status_idx ON sys_storage(type, status);
CREATE INDEX IF NOT EXISTS sys_file_storage_id_idx ON sys_file(storage_id);
CREATE INDEX IF NOT EXISTS sys_file_type_idx ON sys_file(type);
CREATE INDEX IF NOT EXISTS sys_file_sha256_idx ON sys_file(sha256);
CREATE UNIQUE INDEX IF NOT EXISTS sys_mail_account_code_active_unique ON sys_mail_account(code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sys_mail_account_default_active_unique ON sys_mail_account(is_default) WHERE deleted_at IS NULL AND is_default = true;
CREATE INDEX IF NOT EXISTS sys_mail_account_status_sort_idx ON sys_mail_account(status, sort);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

${updatedAtTriggers}
`,
  },
  {
    id: "0003_file_policy_cleanup",
    sql: `
UPDATE sys_rule SET name = '用户管理' WHERE id = 10 AND key = 'system.user';
UPDATE sys_config_group SET name = '文件策略' WHERE code = 'file';
DELETE FROM sys_config_items WHERE key = 'file.default_storage';
`,
  },
  {
    id: "0004_operation_log",
    sql: `
CREATE TABLE IF NOT EXISTS sys_operation_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  username TEXT,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT,
  resource_id TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  request_id TEXT,
  status INTEGER NOT NULL,
  success BOOLEAN NOT NULL,
  message TEXT,
  duration_ms INTEGER,
  details_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sys_operation_log_created_at_idx ON sys_operation_log(created_at);
CREATE INDEX IF NOT EXISTS sys_operation_log_user_id_created_at_idx ON sys_operation_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS sys_operation_log_module_action_idx ON sys_operation_log(module, action);
CREATE INDEX IF NOT EXISTS sys_operation_log_success_created_at_idx ON sys_operation_log(success, created_at);
CREATE INDEX IF NOT EXISTS sys_operation_log_request_id_idx ON sys_operation_log(request_id);
`,
  },
  {
    id: "0005_operation_log_menu",
    sql: `
UPDATE sys_rule
SET parent_id = 2,
    type = 'route',
    key = 'system.operationLog',
    name = '操作日志',
    path = '/system/operation/log',
    icon = 'operationLog',
    "order" = 100,
    status = 1,
    hidden = 1,
    link = 0,
    is_system = true,
    updated_at = now()
WHERE id = 100;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (101, 100, 'action', 'system.operationLog.query', '查询操作日志', 1, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (100), (101)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0006_framework_completeness_core",
    sql: `
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ;
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sys_access_token ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE sys_access_token ADD COLUMN IF NOT EXISTS user_agent TEXT;

CREATE TABLE IF NOT EXISTS sys_user_password_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sys_notice (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'notice',
  scope TEXT NOT NULL DEFAULT 'all',
  target_user_ids_json TEXT,
  status INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE TABLE IF NOT EXISTS sys_notice_read (
  notice_id INTEGER NOT NULL REFERENCES sys_notice(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

CREATE INDEX IF NOT EXISTS sys_user_password_history_user_id_created_at_idx ON sys_user_password_history(user_id, created_at);
CREATE INDEX IF NOT EXISTS sys_notice_status_published_at_idx ON sys_notice(status, published_at);
CREATE INDEX IF NOT EXISTS sys_notice_type_status_idx ON sys_notice(type, status);
CREATE INDEX IF NOT EXISTS sys_notice_read_user_id_idx ON sys_notice_read(user_id);
CREATE INDEX IF NOT EXISTS sys_access_token_user_agent_idx ON sys_access_token(user_agent);

UPDATE sys_user SET password_updated_at = COALESCE(password_updated_at, updated_at);
UPDATE sys_config_items
SET "values" = 'jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,txt,csv,zip,mp3,mp4,webm'
WHERE key = 'file.allowed_extensions';
UPDATE sys_config_items
SET "values" = 'exe,bat,cmd,sh,php,html,htm,js,mjs,svg'
WHERE key = 'file.denied_extensions';

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (110, 2, 'route', 'system.loginLog', '登录日志', '/system/login/log', 'loginLog', 110, 1, 1, 0, true, now(), now()),
  (120, 2, 'route', 'system.onlineUser', '在线用户', '/system/online/user', 'onlineUser', 120, 1, 1, 0, true, now(), now()),
  (130, 2, 'route', 'system.notice', '通知公告', '/system/notice', 'notice', 130, 1, 1, 0, true, now(), now()),
  (140, 0, 'route', 'profile', '个人中心', '/profile', 'profile', 30, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (111, 110, 'action', 'system.loginLog.query', '查询登录日志', 1, 1, 0, 0, true, now(), now()),
  (112, 110, 'action', 'system.loginLog.delete', '删除登录日志', 2, 1, 0, 0, true, now(), now()),
  (113, 110, 'action', 'system.loginLog.clean', '清理登录日志', 3, 1, 0, 0, true, now(), now()),
  (121, 120, 'action', 'system.onlineUser.query', '查询在线用户', 1, 1, 0, 0, true, now(), now()),
  (122, 120, 'action', 'system.onlineUser.kick', '强制下线', 2, 1, 0, 0, true, now(), now()),
  (123, 120, 'action', 'system.onlineUser.clean', '清理过期会话', 3, 1, 0, 0, true, now(), now()),
  (131, 130, 'action', 'system.notice.query', '查询公告', 1, 1, 0, 0, true, now(), now()),
  (132, 130, 'action', 'system.notice.create', '新增公告', 2, 1, 0, 0, true, now(), now()),
  (133, 130, 'action', 'system.notice.update', '编辑公告', 3, 1, 0, 0, true, now(), now()),
  (134, 130, 'action', 'system.notice.delete', '删除公告', 4, 1, 0, 0, true, now(), now()),
  (135, 130, 'action', 'system.notice.publish', '发布公告', 5, 1, 0, 0, true, now(), now()),
  (136, 130, 'action', 'system.notice.revoke', '撤回公告', 6, 1, 0, 0, true, now(), now()),
  (141, 140, 'action', 'profile.query', '查看个人中心', 1, 1, 0, 0, true, now(), now()),
  (142, 140, 'action', 'profile.update', '更新个人资料', 2, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES
  (110), (111), (112), (113),
  (120), (121), (122), (123),
  (130), (131), (132), (133), (134), (135), (136),
  (140), (141), (142)
) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;

INSERT INTO sys_config_group
  (id, name, code, sort, status, is_system, created_at, updated_at)
VALUES
  (3, '安全策略', 'security', 3, 1, true, now(), now()),
  (4, '登录策略', 'login', 4, 1, true, now(), now()),
  (5, 'Token 策略', 'token', 5, 1, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_config_items
  (group_id, key, title, describe, "values", type, sort, status, is_system, created_at, updated_at)
VALUES
  (3, 'security.password_min_length', '密码最小长度', '新密码和重置密码的最小长度', '6', 'digit', 1, 1, true, now(), now()),
  (3, 'security.password_require_uppercase', '要求大写字母', '开启后密码必须包含大写字母', 'false', 'switch', 2, 1, true, now(), now()),
  (3, 'security.password_require_lowercase', '要求小写字母', '开启后密码必须包含小写字母', 'false', 'switch', 3, 1, true, now(), now()),
  (3, 'security.password_require_number', '要求数字', '开启后密码必须包含数字', 'false', 'switch', 4, 1, true, now(), now()),
  (3, 'security.password_require_symbol', '要求特殊字符', '开启后密码必须包含特殊字符', 'false', 'switch', 5, 1, true, now(), now()),
  (3, 'security.password_history_count', '密码历史数量', '禁止复用最近 N 次密码，0 表示不检查', '3', 'digit', 6, 1, true, now(), now()),
  (3, 'security.password_expire_days', '密码有效天数', '0 表示不过期', '0', 'digit', 7, 1, true, now(), now()),
  (3, 'security.force_change_on_first_login', '首次登录强制改密', '预留策略项', 'false', 'switch', 8, 1, true, now(), now()),
  (4, 'login.max_failed_attempts', '失败锁定次数', '连续失败达到次数后锁定账号，0 表示不锁定', '5', 'digit', 1, 1, true, now(), now()),
  (4, 'login.lock_minutes', '锁定分钟数', '失败锁定持续时间', '15', 'digit', 2, 1, true, now(), now()),
  (4, 'login.captcha_enabled', '启用验证码', '预留策略项', 'false', 'switch', 3, 1, true, now(), now()),
  (4, 'login.allow_multi_session', '允许多端登录', '关闭后登录会撤销该用户其他会话', 'true', 'switch', 4, 1, true, now(), now()),
  (4, 'login.max_online_tokens', '最大在线会话数', '每个用户最多保留的有效会话数，0 表示不限制', '0', 'digit', 5, 1, true, now(), now()),
  (5, 'token.access_token_ttl_days', 'Token 有效天数', '未勾选记住登录时的 token 有效期', '7', 'digit', 1, 1, true, now(), now()),
  (5, 'token.remember_ttl_days', '记住登录有效天数', '勾选记住登录时的 token 有效期，0 表示不过期', '30', 'digit', 2, 1, true, now(), now()),
  (5, 'token.refresh_last_used', '刷新最近活跃时间', '请求时刷新 token 最近活跃时间', 'true', 'switch', 3, 1, true, now(), now()),
  (5, 'token.cleanup_expired_days', '过期会话清理窗口', '清理早于 N 天前过期的 token', '30', 'digit', 4, 1, true, now(), now())
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sys_notice_updated_at ON sys_notice;
CREATE TRIGGER trg_sys_notice_updated_at
BEFORE UPDATE ON sys_notice
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
`,
  },
  {
    id: "0007_login_captcha_password_reset",
    sql: `
CREATE TABLE IF NOT EXISTS sys_password_reset_token (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sys_password_reset_token_hash_unique
  ON sys_password_reset_token(token_hash);
CREATE INDEX IF NOT EXISTS sys_password_reset_token_user_id_idx
  ON sys_password_reset_token(user_id);
CREATE INDEX IF NOT EXISTS sys_password_reset_token_expires_at_idx
  ON sys_password_reset_token(expires_at);

UPDATE sys_config_items
SET describe = '开启后登录页显示验证码，并要求登录接口校验验证码'
WHERE key = 'login.captcha_enabled'
  AND describe = '预留策略项';

INSERT INTO sys_config_items
  (group_id, key, title, describe, "values", type, sort, status, is_system, created_at, updated_at)
VALUES
  (4, 'login.oauth_providers_json', '第三方登录配置', 'JSON 数组；仅 enabled=true 且 authUrl 为 http(s) 的 provider 会显示在登录页', '[]', 'textarea', 6, 1, true, now(), now())
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0008_system_settings_route",
    sql: `
INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (150, 2, 'route', 'system.settings', '系统设置', '/system/settings', 'settings', 65, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (151, 150, 'action', 'system.settings.query', '查看系统设置', 1, 1, 0, 0, true, now(), now()),
  (152, 150, 'action', 'system.settings.save', '保存系统设置', 2, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (150), (151), (152)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0009_notice_v2",
    sql: `
ALTER TABLE sys_notice ADD COLUMN IF NOT EXISTS target_role_ids_json TEXT;
ALTER TABLE sys_notice ADD COLUMN IF NOT EXISTS target_dept_ids_json TEXT;
ALTER TABLE sys_notice ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sys_notice ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_notice ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS sys_notice_expired_at_idx ON sys_notice(expired_at);
CREATE INDEX IF NOT EXISTS sys_notice_pinned_priority_idx ON sys_notice(pinned, priority);
`,
  },
  {
    id: "0010_file_upload_sessions",
    sql: `
CREATE TABLE IF NOT EXISTS sys_file_reference (
  id SERIAL PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES sys_file(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  resource_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sys_file_reference_file_id_idx ON sys_file_reference(file_id);
CREATE INDEX IF NOT EXISTS sys_file_reference_module_resource_idx ON sys_file_reference(module, resource_id);

CREATE TABLE IF NOT EXISTS sys_file_upload_session (
  id SERIAL PRIMARY KEY,
  upload_id TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime TEXT,
  size BIGINT NOT NULL,
  total_parts INTEGER NOT NULL,
  group_id INTEGER,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'uploading',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sys_file_upload_session_user_id_idx ON sys_file_upload_session(user_id);
CREATE INDEX IF NOT EXISTS sys_file_upload_session_expires_at_idx ON sys_file_upload_session(expires_at);

CREATE TABLE IF NOT EXISTS sys_file_upload_part (
  upload_id TEXT NOT NULL,
  part_number INTEGER NOT NULL,
  size BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (upload_id, part_number)
);
`,
  },
  {
    id: "0011_oauth_login",
    sql: `
CREATE TABLE IF NOT EXISTS sys_oauth_state (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  redirect_uri TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sys_oauth_state_expires_at_idx ON sys_oauth_state(expires_at);

CREATE TABLE IF NOT EXISTS sys_oauth_account (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_username TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_user_id),
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS sys_oauth_account_user_id_idx ON sys_oauth_account(user_id);
`,
  },
  {
    id: "0012_force_password_change",
    sql: `
ALTER TABLE sys_user ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT false;
`,
  },
  {
    id: "0013_operation_log_governance_rules",
    sql: `
INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (102, 100, 'action', 'system.operationLog.export', '导出操作日志', 2, 1, 0, 0, true, now(), now()),
  (103, 100, 'action', 'system.operationLog.clean', '清理操作日志', 3, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (102), (103)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0014_role_copy_rule",
    sql: `
INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (27, 20, 'action', 'system.role.copy', '复制角色', 7, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, 27
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = 27)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0015_oauth_provider_resource",
    sql: `
CREATE TABLE IF NOT EXISTS sys_oauth_provider (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  auth_url TEXT NOT NULL DEFAULT '',
  token_url TEXT,
  user_info_url TEXT,
  client_id TEXT,
  client_secret_encrypted TEXT,
  scopes_json TEXT,
  user_mapping_json TEXT,
  auto_create_user BOOLEAN NOT NULL DEFAULT false,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS sys_oauth_provider_key_active_unique
  ON sys_oauth_provider(key)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_oauth_provider_status_sort_idx
  ON sys_oauth_provider(status, sort);

ALTER TABLE sys_oauth_state ADD COLUMN IF NOT EXISTS bind_user_id INTEGER;

INSERT INTO sys_oauth_provider
  (key, name, enabled, auth_url, token_url, user_info_url, scopes_json, user_mapping_json, status, sort, is_system, created_at, updated_at)
VALUES
  ('github', 'GitHub', false, 'https://github.com/login/oauth/authorize', 'https://github.com/login/oauth/access_token', 'https://api.github.com/user', '["user:email"]', '{"id":"id","username":"login","email":"email","nickname":"name"}', 1, 1, true, now(), now()),
  ('gitee', 'Gitee', false, 'https://gitee.com/oauth/authorize', 'https://gitee.com/oauth/token', 'https://gitee.com/api/v5/user', '["user_info"]', '{"id":"id","username":"login","email":"email","nickname":"name"}', 1, 2, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (160, 2, 'route', 'system.oauthProvider', '第三方登录', '/system/oauth/provider', 'login', 95, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (161, 160, 'action', 'system.oauthProvider.query', '查询第三方登录', 1, 1, 0, 0, true, now(), now()),
  (162, 160, 'action', 'system.oauthProvider.create', '新增第三方登录', 2, 1, 0, 0, true, now(), now()),
  (163, 160, 'action', 'system.oauthProvider.update', '编辑第三方登录', 3, 1, 0, 0, true, now(), now()),
  (164, 160, 'action', 'system.oauthProvider.delete', '删除第三方登录', 4, 1, 0, 0, true, now(), now()),
  (165, 160, 'action', 'system.oauthProvider.status', '启停第三方登录', 5, 1, 0, 0, true, now(), now()),
  (166, 160, 'action', 'system.oauthProvider.test', '测试第三方登录', 6, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (160), (161), (162), (163), (164), (165), (166)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0016_operation_log_risk_level",
    sql: `
ALTER TABLE sys_operation_log ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'low';
CREATE INDEX IF NOT EXISTS sys_operation_log_risk_level_created_at_idx
  ON sys_operation_log(risk_level, created_at);
`,
  },
  {
    id: "0017_file_reference_fields",
    sql: `
ALTER TABLE sys_file_reference ADD COLUMN IF NOT EXISTS resource_type TEXT;
ALTER TABLE sys_file_reference ADD COLUMN IF NOT EXISTS field TEXT;
CREATE INDEX IF NOT EXISTS sys_file_reference_resource_type_idx
  ON sys_file_reference(resource_type);
`,
  },
  {
    id: "0018_sms_provider_resource",
    sql: `
CREATE TABLE IF NOT EXISTS sys_sms_provider (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'webhook',
  endpoint TEXT,
  access_key TEXT,
  secret_key_encrypted TEXT,
  signature TEXT,
  template_code TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  remark TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS sys_sms_provider_code_active_unique
  ON sys_sms_provider(code)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sys_sms_provider_default_active_unique
  ON sys_sms_provider(is_default)
  WHERE deleted_at IS NULL AND is_default = true;
CREATE INDEX IF NOT EXISTS sys_sms_provider_provider_status_idx
  ON sys_sms_provider(provider, status);
CREATE INDEX IF NOT EXISTS sys_sms_provider_status_sort_idx
  ON sys_sms_provider(status, sort);

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (200, 180, 'route', 'system.smsProvider', '短信配置', '/system/sms/provider', 'message', 70, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (201, 200, 'action', 'system.smsProvider.query', '查询短信配置', 1, 1, 0, 0, true, now(), now()),
  (202, 200, 'action', 'system.smsProvider.create', '新增短信配置', 2, 1, 0, 0, true, now(), now()),
  (203, 200, 'action', 'system.smsProvider.update', '编辑短信配置', 3, 1, 0, 0, true, now(), now()),
  (204, 200, 'action', 'system.smsProvider.delete', '删除短信配置', 4, 1, 0, 0, true, now(), now()),
  (205, 200, 'action', 'system.smsProvider.status', '启停短信配置', 5, 1, 0, 0, true, now(), now()),
  (206, 200, 'action', 'system.smsProvider.setDefault', '设为默认短信配置', 6, 1, 0, 0, true, now(), now()),
  (207, 200, 'action', 'system.smsProvider.test', '测试短信配置', 7, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (200), (201), (202), (203), (204), (205), (206), (207)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0019_module_generator_web",
    sql: `
INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (210, 180, 'route', 'system.moduleGenerator', '模块生成器', '/system/module/generator', 'code', 90, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (211, 210, 'action', 'system.moduleGenerator.query', '查看模块生成器', 1, 1, 0, 0, true, now(), now()),
  (212, 210, 'action', 'system.moduleGenerator.generate', '生成模块草稿', 2, 1, 0, 0, true, now(), now()),
  (213, 210, 'action', 'system.moduleGenerator.publish', '发布模块', 3, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (210), (211), (212), (213)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0020_ai_provider_resource",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_provider (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  provider_type TEXT NOT NULL DEFAULT 'openai-compatible',
  base_url TEXT,
  api_key_encrypted TEXT,
  organization TEXT,
  project TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  options_json TEXT,
  remark TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_provider_code_active_unique
  ON sys_ai_provider(code)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_provider_default_active_unique
  ON sys_ai_provider(is_default)
  WHERE deleted_at IS NULL AND is_default = true;
CREATE INDEX IF NOT EXISTS sys_ai_provider_type_status_idx
  ON sys_ai_provider(provider_type, status);
CREATE INDEX IF NOT EXISTS sys_ai_provider_status_sort_idx
  ON sys_ai_provider(status, sort);

CREATE TABLE IF NOT EXISTS sys_ai_model (
  id SERIAL PRIMARY KEY,
  provider_id INTEGER NOT NULL REFERENCES sys_ai_provider(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_type TEXT NOT NULL DEFAULT 'chat',
  capabilities_json TEXT,
  context_window INTEGER,
  max_output_tokens INTEGER,
  input_price TEXT,
  output_price TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_default_chat BOOLEAN NOT NULL DEFAULT false,
  is_default_structured BOOLEAN NOT NULL DEFAULT false,
  is_default_embedding BOOLEAN NOT NULL DEFAULT false,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_model_provider_model_active_unique
  ON sys_ai_model(provider_id, model_id)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_model_default_chat_active_unique
  ON sys_ai_model(is_default_chat)
  WHERE deleted_at IS NULL AND is_default_chat = true;
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_model_default_structured_active_unique
  ON sys_ai_model(is_default_structured)
  WHERE deleted_at IS NULL AND is_default_structured = true;
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_model_default_embedding_active_unique
  ON sys_ai_model(is_default_embedding)
  WHERE deleted_at IS NULL AND is_default_embedding = true;
CREATE INDEX IF NOT EXISTS sys_ai_model_provider_id_idx
  ON sys_ai_model(provider_id);
CREATE INDEX IF NOT EXISTS sys_ai_model_type_status_idx
  ON sys_ai_model(model_type, status);
CREATE INDEX IF NOT EXISTS sys_ai_model_status_sort_idx
  ON sys_ai_model(status, sort);

INSERT INTO sys_ai_provider
  (id, name, code, provider_type, base_url, is_default, status, sort, remark, is_system, created_at, updated_at)
VALUES
  (1, 'OpenAI Compatible', 'openai-compatible', 'openai-compatible', 'https://api.openai.com/v1', false, 0, 1, '内置模板：配置 API Key 并启用后可作为业务默认 AI Provider', true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_ai_model
  (id, provider_id, name, model_id, model_type, capabilities_json, context_window, max_output_tokens, status, sort, remark, is_system, created_at, updated_at)
VALUES
  (1, 1, 'GPT-4.1 Mini', 'gpt-4.1-mini', 'chat', '{"chat":true,"structured":true,"toolCalling":true}', 1047576, 32768, 0, 1, '内置 Chat/Structured 模型模板', true, now(), now()),
  (2, 1, 'Text Embedding 3 Small', 'text-embedding-3-small', 'embedding', '{"embedding":true}', 8191, NULL, 0, 2, '内置 Embedding 模型模板', true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (230, 180, 'route', 'system.aiProvider', 'AI Provider', '/system/ai/provider', 'api', 80, 1, 1, 0, true, now(), now()),
  (240, 180, 'route', 'system.aiModel', 'AI 模型', '/system/ai/model', 'api', 81, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (231, 230, 'action', 'system.aiProvider.query', '查询 AI Provider', 1, 1, 0, 0, true, now(), now()),
  (232, 230, 'action', 'system.aiProvider.create', '新增 AI Provider', 2, 1, 0, 0, true, now(), now()),
  (233, 230, 'action', 'system.aiProvider.update', '编辑 AI Provider', 3, 1, 0, 0, true, now(), now()),
  (234, 230, 'action', 'system.aiProvider.delete', '删除 AI Provider', 4, 1, 0, 0, true, now(), now()),
  (235, 230, 'action', 'system.aiProvider.status', '启停 AI Provider', 5, 1, 0, 0, true, now(), now()),
  (236, 230, 'action', 'system.aiProvider.setDefault', '设为默认 AI Provider', 6, 1, 0, 0, true, now(), now()),
  (237, 230, 'action', 'system.aiProvider.test', '测试 AI Provider', 7, 1, 0, 0, true, now(), now()),
  (241, 240, 'action', 'system.aiModel.query', '查询 AI 模型', 1, 1, 0, 0, true, now(), now()),
  (242, 240, 'action', 'system.aiModel.create', '新增 AI 模型', 2, 1, 0, 0, true, now(), now()),
  (243, 240, 'action', 'system.aiModel.update', '编辑 AI 模型', 3, 1, 0, 0, true, now(), now()),
  (244, 240, 'action', 'system.aiModel.delete', '删除 AI 模型', 4, 1, 0, 0, true, now(), now()),
  (245, 240, 'action', 'system.aiModel.status', '启停 AI 模型', 5, 1, 0, 0, true, now(), now()),
  (246, 240, 'action', 'system.aiModel.setDefault', '设为默认 AI 模型', 6, 1, 0, 0, true, now(), now()),
  (247, 240, 'action', 'system.aiModel.test', '测试 AI 模型', 7, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES
  (230), (231), (232), (233), (234), (235), (236), (237),
  (240), (241), (242), (243), (244), (245), (246), (247)
) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0021_ai_provider_templates",
    sql: `
INSERT INTO sys_ai_provider
  (id, name, code, provider_type, base_url, is_default, status, sort, remark, is_system, created_at, updated_at)
VALUES
  (2, 'OpenAI', 'openai', 'openai', 'https://api.openai.com/v1', false, 0, 2, 'OpenAI 官方接口模板，配置 API Key 后启用', true, now(), now()),
  (3, 'Anthropic Claude', 'anthropic', 'anthropic', 'https://api.anthropic.com/v1', false, 0, 3, 'Anthropic Claude 原生接口模板', true, now(), now()),
  (4, 'Google Gemini', 'gemini', 'google', 'https://generativelanguage.googleapis.com/v1beta', false, 0, 4, 'Google Gemini 原生接口模板', true, now(), now()),
  (5, 'DeepSeek', 'deepseek', 'deepseek', 'https://api.deepseek.com/v1', false, 0, 5, 'DeepSeek OpenAI-compatible 接口模板', true, now(), now()),
  (6, 'Qwen / DashScope', 'qwen', 'qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', false, 0, 6, '通义千问 DashScope OpenAI-compatible 接口模板', true, now(), now()),
  (7, 'Moonshot / Kimi', 'moonshot', 'moonshot', 'https://api.moonshot.cn/v1', false, 0, 7, 'Moonshot Kimi OpenAI-compatible 接口模板', true, now(), now()),
  (8, 'Zhipu GLM', 'zhipu', 'zhipu', 'https://open.bigmodel.cn/api/paas/v4', false, 0, 8, '智谱 GLM OpenAI-compatible 接口模板', true, now(), now()),
  (9, 'SiliconFlow', 'siliconflow', 'siliconflow', 'https://api.siliconflow.cn/v1', false, 0, 9, 'SiliconFlow OpenAI-compatible 网关模板', true, now(), now()),
  (10, 'OpenRouter', 'openrouter', 'openrouter', 'https://openrouter.ai/api/v1', false, 0, 10, 'OpenRouter OpenAI-compatible 网关模板', true, now(), now()),
  (11, 'Ollama Local', 'ollama', 'ollama', 'http://localhost:11434/v1', false, 0, 11, '本地 Ollama OpenAI-compatible 模板，可在 optionsJson 设置 {"authRequired":false}', true, now(), now())
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0022_sms_template_resource",
    sql: `
CREATE TABLE IF NOT EXISTS sys_sms_template (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  provider_id INTEGER NOT NULL REFERENCES sys_sms_provider(id) ON DELETE RESTRICT,
  template_code TEXT,
  signature TEXT,
  content TEXT NOT NULL,
  variables_json TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS sys_sms_template_code_active_unique
  ON sys_sms_template(code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS sys_sms_template_provider_id_idx
  ON sys_sms_template(provider_id);

CREATE INDEX IF NOT EXISTS sys_sms_template_status_sort_idx
  ON sys_sms_template(status, sort)
  WHERE deleted_at IS NULL;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (220, 180, 'route', 'system.smsTemplate', '短信模板', '/system/sms/template', 'message', 71, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (221, 220, 'action', 'system.smsTemplate.query', '查询短信模板', 1, 1, 0, 0, true, now(), now()),
  (222, 220, 'action', 'system.smsTemplate.create', '新增短信模板', 2, 1, 0, 0, true, now(), now()),
  (223, 220, 'action', 'system.smsTemplate.update', '编辑短信模板', 3, 1, 0, 0, true, now(), now()),
  (224, 220, 'action', 'system.smsTemplate.delete', '删除短信模板', 4, 1, 0, 0, true, now(), now()),
  (225, 220, 'action', 'system.smsTemplate.status', '启停短信模板', 5, 1, 0, 0, true, now(), now()),
  (226, 220, 'action', 'system.smsTemplate.test', '测试短信模板', 6, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (220), (221), (222), (223), (224), (225), (226)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0023_ai_playground_permissions",
    sql: `
INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (260, 180, 'route', 'system.aiPlayground', 'AI Playground', '/system/ai/playground', 'api', 82, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (261, 260, 'action', 'system.aiPlayground.query', '查看 AI Playground', 1, 1, 0, 0, true, now(), now()),
  (262, 260, 'action', 'system.aiPlayground.chat', '调用 AI Runtime', 2, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (260), (261), (262)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0024_ai_chat_resource",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_chat_session (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  provider_id INTEGER REFERENCES sys_ai_provider(id) ON DELETE SET NULL,
  model_id INTEGER REFERENCES sys_ai_model(id) ON DELETE SET NULL,
  provider_code TEXT,
  model_name TEXT,
  model_identifier TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  status INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);

CREATE INDEX IF NOT EXISTS sys_ai_chat_session_user_updated_idx
  ON sys_ai_chat_session(user_id, updated_at);
CREATE INDEX IF NOT EXISTS sys_ai_chat_session_last_message_idx
  ON sys_ai_chat_session(last_message_at);

CREATE TABLE IF NOT EXISTS sys_ai_chat_message (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sys_ai_chat_session(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  finish_reason TEXT,
  usage_json TEXT,
  metadata_json TEXT,
  provider_id INTEGER REFERENCES sys_ai_provider(id) ON DELETE SET NULL,
  model_id INTEGER REFERENCES sys_ai_model(id) ON DELETE SET NULL,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sys_ai_chat_message_session_id_idx
  ON sys_ai_chat_message(session_id, id);
CREATE INDEX IF NOT EXISTS sys_ai_chat_message_user_created_idx
  ON sys_ai_chat_message(user_id, created_at);

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (270, 180, 'route', 'system.aiChat', 'AI Chat', '/system/ai/chat', 'message', 83, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (271, 270, 'action', 'system.aiChat.query', '查看 AI Chat', 1, 1, 0, 0, true, now(), now()),
  (272, 270, 'action', 'system.aiChat.create', '创建 AI Chat 会话', 2, 1, 0, 0, true, now(), now()),
  (273, 270, 'action', 'system.aiChat.chat', '发送 AI Chat 消息', 3, 1, 0, 0, true, now(), now()),
  (274, 270, 'action', 'system.aiChat.update', '编辑 AI Chat 会话', 4, 1, 0, 0, true, now(), now()),
  (275, 270, 'action', 'system.aiChat.delete', '删除 AI Chat 会话', 5, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (270), (271), (272), (273), (274), (275)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0025_ai_agent_and_chat_governance",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_agent (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  instructions TEXT NOT NULL,
  model_id INTEGER REFERENCES sys_ai_model(id) ON DELETE SET NULL,
  temperature_milli INTEGER NOT NULL DEFAULT 700,
  max_output_tokens INTEGER,
  max_steps INTEGER NOT NULL DEFAULT 6,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_agent_code_active_unique ON sys_ai_agent(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_ai_agent_status_sort_idx ON sys_ai_agent(status, sort);
CREATE INDEX IF NOT EXISTS sys_ai_agent_model_id_idx ON sys_ai_agent(model_id);

CREATE TABLE IF NOT EXISTS sys_ai_tool (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  handler_key TEXT NOT NULL,
  input_schema_json TEXT,
  config_json TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  approval_required BOOLEAN NOT NULL DEFAULT false,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_tool_code_active_unique ON sys_ai_tool(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_ai_tool_status_sort_idx ON sys_ai_tool(status, sort);
CREATE INDEX IF NOT EXISTS sys_ai_tool_handler_key_idx ON sys_ai_tool(handler_key);

CREATE TABLE IF NOT EXISTS sys_ai_agent_tool (
  agent_id INTEGER NOT NULL REFERENCES sys_ai_agent(id) ON DELETE CASCADE,
  tool_id INTEGER NOT NULL REFERENCES sys_ai_tool(id) ON DELETE CASCADE,
  approval_mode TEXT NOT NULL DEFAULT 'inherit' CHECK (approval_mode IN ('inherit', 'always', 'never')),
  PRIMARY KEY (agent_id, tool_id)
);
CREATE INDEX IF NOT EXISTS sys_ai_agent_tool_tool_id_idx ON sys_ai_agent_tool(tool_id);

ALTER TABLE sys_ai_chat_session ADD COLUMN IF NOT EXISTS agent_id INTEGER REFERENCES sys_ai_agent(id) ON DELETE SET NULL;
ALTER TABLE sys_ai_chat_session ADD COLUMN IF NOT EXISTS system_prompt TEXT;
ALTER TABLE sys_ai_chat_session ADD COLUMN IF NOT EXISTS temperature_milli INTEGER NOT NULL DEFAULT 700;
ALTER TABLE sys_ai_chat_session ADD COLUMN IF NOT EXISTS max_output_tokens INTEGER;
ALTER TABLE sys_ai_chat_session ADD COLUMN IF NOT EXISTS context_summary TEXT;
ALTER TABLE sys_ai_chat_session ADD COLUMN IF NOT EXISTS compacted_through_message_id INTEGER;
ALTER TABLE sys_ai_chat_session ADD COLUMN IF NOT EXISTS total_input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sys_ai_chat_session ADD COLUMN IF NOT EXISTS total_output_tokens INTEGER NOT NULL DEFAULT 0;

ALTER TABLE sys_ai_chat_message ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE sys_ai_chat_message ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE sys_ai_chat_message ADD COLUMN IF NOT EXISTS parent_message_id INTEGER;
ALTER TABLE sys_ai_chat_message ADD COLUMN IF NOT EXISTS regenerated_from_id INTEGER;

CREATE TABLE IF NOT EXISTS sys_ai_agent_run (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sys_ai_chat_session(id) ON DELETE CASCADE,
  agent_id INTEGER NOT NULL REFERENCES sys_ai_agent(id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  input_message_id INTEGER,
  output_message_id INTEGER,
  total_steps INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sys_ai_agent_run_session_id_idx ON sys_ai_agent_run(session_id, id);
CREATE INDEX IF NOT EXISTS sys_ai_agent_run_user_status_idx ON sys_ai_agent_run(user_id, status);

CREATE TABLE IF NOT EXISTS sys_ai_agent_run_step (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES sys_ai_agent_run(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  tool_id INTEGER REFERENCES sys_ai_tool(id) ON DELETE SET NULL,
  tool_name TEXT,
  tool_call_id TEXT,
  input_json TEXT,
  output_json TEXT,
  usage_json TEXT,
  duration_ms INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sys_ai_agent_run_step_run_no_idx ON sys_ai_agent_run_step(run_id, step_no);
CREATE INDEX IF NOT EXISTS sys_ai_agent_run_step_tool_call_idx ON sys_ai_agent_run_step(tool_call_id);

CREATE TABLE IF NOT EXISTS sys_ai_tool_approval (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES sys_ai_agent_run(id) ON DELETE CASCADE,
  step_id INTEGER REFERENCES sys_ai_agent_run_step(id) ON DELETE SET NULL,
  session_id INTEGER NOT NULL REFERENCES sys_ai_chat_session(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  tool_id INTEGER REFERENCES sys_ai_tool(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  decided_by INTEGER,
  decided_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_tool_approval_run_tool_call_unique ON sys_ai_tool_approval(run_id, tool_call_id);
CREATE INDEX IF NOT EXISTS sys_ai_tool_approval_session_status_idx ON sys_ai_tool_approval(session_id, status);
CREATE INDEX IF NOT EXISTS sys_ai_tool_approval_user_status_idx ON sys_ai_tool_approval(user_id, status);

INSERT INTO sys_ai_agent
  (id, name, code, description, instructions, model_id, temperature_milli, max_output_tokens, max_steps, status, sort, is_system)
VALUES
  (1, '通用工作助手', 'general-assistant', '用于日常问答和后台信息查询的默认 Agent',
   '你是 Admin Base 后台工作助手。回答应准确、简洁；调用工具前先判断是否必要；高风险工具必须等待人工审批。',
   NULL, 700, 16384, 6, 1, 1, true)
ON CONFLICT DO NOTHING;

INSERT INTO sys_ai_tool
  (id, name, code, description, handler_key, input_schema_json, risk_level, approval_required, status, sort, is_system)
VALUES
  (1, '当前时间', 'current-time', '读取服务器当前时间和时区', 'current_time', '{}', 'low', false, 1, 1, true),
  (2, '计算器', 'calculator', '执行基础四则运算', 'calculator', '{"expression":"string"}', 'low', false, 1, 2, true),
  (3, '系统状态', 'system-status', '读取用户、在线会话、今日登录和操作日志摘要', 'system_status', '{}', 'low', false, 1, 3, true),
  (4, '操作日志摘要', 'operation-log-summary', '读取近期操作日志模块和风险等级统计', 'operation_log_summary', '{"hours":"number"}', 'medium', true, 1, 4, true)
ON CONFLICT DO NOTHING;

INSERT INTO sys_ai_agent_tool (agent_id, tool_id, approval_mode)
SELECT 1, id, 'inherit' FROM sys_ai_tool WHERE id IN (1, 2, 3, 4)
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (280, 180, 'route', 'system.aiAgent', 'AI Agent', '/system/ai/agent', 'api', 84, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (281, 280, 'action', 'system.aiAgent.query', '查询 Agent 和工具', 1, 1, 0, 0, true, now(), now()),
  (282, 280, 'action', 'system.aiAgent.create', '新增 Agent 和工具', 2, 1, 0, 0, true, now(), now()),
  (283, 280, 'action', 'system.aiAgent.update', '编辑 Agent 和工具', 3, 1, 0, 0, true, now(), now()),
  (284, 280, 'action', 'system.aiAgent.delete', '删除 Agent 和工具', 4, 1, 0, 0, true, now(), now()),
  (285, 280, 'action', 'system.aiAgent.approve', '审批 Agent 工具调用', 5, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (280), (281), (282), (283), (284), (285)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;

SELECT setval(pg_get_serial_sequence('sys_ai_agent', 'id'), COALESCE((SELECT MAX(id) FROM sys_ai_agent), 1), true);
SELECT setval(pg_get_serial_sequence('sys_ai_tool', 'id'), COALESCE((SELECT MAX(id) FROM sys_ai_tool), 1), true);
`,
  },
  {
    id: "0026_ai_tool_approval_unique_scope",
    sql: `
DROP INDEX IF EXISTS sys_ai_tool_approval_tool_call_unique;
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_tool_approval_run_tool_call_unique
  ON sys_ai_tool_approval(run_id, tool_call_id);
`,
  },
  {
    id: "0027_constrained_module_development_agent",
    sql: `
ALTER TABLE sys_ai_tool_approval ADD COLUMN IF NOT EXISTS plan_hash TEXT;
ALTER TABLE sys_ai_tool_approval ADD COLUMN IF NOT EXISTS affected_files_json TEXT;
ALTER TABLE sys_ai_tool_approval ADD COLUMN IF NOT EXISTS validation_json TEXT;
ALTER TABLE sys_ai_tool_approval ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
UPDATE sys_ai_tool_approval
SET expires_at = created_at + interval '30 minutes'
WHERE expires_at IS NULL AND status = 'pending';
CREATE INDEX IF NOT EXISTS sys_ai_tool_approval_expires_at_idx ON sys_ai_tool_approval(expires_at);

INSERT INTO sys_ai_agent
  (name, code, description, instructions, model_id, temperature_milli, max_output_tokens,
   max_steps, status, sort, is_system)
VALUES
  ('模块开发助手', 'module-development-agent',
   '通过受控工具设计、生成、检查、验证、发布和回滚 Admin Base CRUD 模块',
   '你是 Admin Base 模块开发助手。你只能使用系统提供的 module_design、module_generate_draft、module_preview_diff、module_validate、module_publish、module_rollback 工具完成模块交付。先根据用户需求调用 module_design 输出严格的模块契约，并请用户确认字段、权限和路由；确认后生成草稿，再检查逐文件差异，使用返回的 planHash 做隔离验证。只有验证通过后才能请求发布。module_publish 和 module_rollback 必须等待人工审批。不得要求或尝试 shell、任意文件系统、原始 Git 或未注册工具访问。发布完成后汇总页面、API、权限、文件和验证结果。',
   NULL, 200, 16384, 12, 1, 2, true)
ON CONFLICT DO NOTHING;

UPDATE sys_ai_agent
SET name = '模块开发助手',
    description = '通过受控工具设计、生成、检查、验证、发布和回滚 Admin Base CRUD 模块',
    instructions = '你是 Admin Base 模块开发助手。你只能使用系统提供的 module_design、module_generate_draft、module_preview_diff、module_validate、module_publish、module_rollback 工具完成模块交付。先根据用户需求调用 module_design 输出严格的模块契约，并请用户确认字段、权限和路由；确认后生成草稿，再检查逐文件差异，使用返回的 planHash 做隔离验证。只有验证通过后才能请求发布。module_publish 和 module_rollback 必须等待人工审批。不得要求或尝试 shell、任意文件系统、原始 Git 或未注册工具访问。发布完成后汇总页面、API、权限、文件和验证结果。',
    max_steps = 12,
    status = 1,
    sort = 2,
    is_system = true,
    updated_at = now()
WHERE code = 'module-development-agent' AND deleted_at IS NULL;

INSERT INTO sys_ai_tool
  (name, code, description, handler_key, input_schema_json, risk_level,
   approval_required, status, sort, is_system)
VALUES
  ('设计模块契约', 'module_design',
   '把模块需求转换为 admin-module.schema.json 约束下的结构化契约；只返回契约 JSON',
   'module_design', '{"contract":"admin-module.schema.json"}', 'low', false, 1, 10, true),
  ('生成模块草稿', 'module_generate_draft',
   '使用已确认的模块契约生成未上线草稿，不激活页面或 API',
   'module_generate_draft', '{"contract":"admin-module.schema.json","force":"boolean"}', 'medium', false, 1, 11, true),
  ('预览发布差异', 'module_preview_diff',
   '读取模块草稿并生成逐文件发布差异、冲突和 planHash，不修改项目源码',
   'module_preview_diff', '{"name":"kebab-case"}', 'low', false, 1, 12, true),
  ('验证模块草稿', 'module_validate',
   '使用当前 planHash 在隔离目录执行模块验证，不修改项目源码',
   'module_validate', '{"name":"kebab-case","planHash":"sha256"}', 'medium', false, 1, 13, true),
  ('发布模块', 'module_publish',
   '发布已通过当前 planHash 隔离验证的模块；执行前必须人工审批',
   'module_publish', '{"name":"kebab-case","planHash":"sha256"}', 'high', true, 1, 14, true),
  ('回滚模块源码', 'module_rollback',
   '回滚生成器最近一次受保护的源码发布；数据库 migration 不会逆向删除；执行前必须人工审批',
   'module_rollback', '{"name":"kebab-case","publishId":"optional"}', 'critical', true, 1, 15, true)
ON CONFLICT DO NOTHING;

UPDATE sys_ai_tool
SET handler_key = code,
    approval_required = code IN ('module_publish', 'module_rollback'),
    risk_level = CASE
      WHEN code = 'module_rollback' THEN 'critical'
      WHEN code = 'module_publish' THEN 'high'
      WHEN code IN ('module_generate_draft', 'module_validate') THEN 'medium'
      ELSE 'low'
    END,
    status = 1,
    is_system = true,
    updated_at = now()
WHERE code IN (
  'module_design', 'module_generate_draft', 'module_preview_diff',
  'module_validate', 'module_publish', 'module_rollback'
) AND deleted_at IS NULL;

INSERT INTO sys_ai_agent_tool (agent_id, tool_id, approval_mode)
SELECT agent.id, tool.id,
  CASE WHEN tool.handler_key IN ('module_publish', 'module_rollback') THEN 'always' ELSE 'never' END
FROM sys_ai_agent agent
CROSS JOIN sys_ai_tool tool
WHERE agent.code = 'module-development-agent'
  AND agent.deleted_at IS NULL
  AND tool.code IN (
    'module_design', 'module_generate_draft', 'module_preview_diff',
    'module_validate', 'module_publish', 'module_rollback'
  )
  AND tool.deleted_at IS NULL
ON CONFLICT (agent_id, tool_id) DO UPDATE SET approval_mode = EXCLUDED.approval_mode;
`,
  },
  {
    id: "0028_atomic_ai_tool_approval",
    sql: `
ALTER TABLE sys_ai_agent_run ADD COLUMN IF NOT EXISTS parent_run_id INTEGER REFERENCES sys_ai_agent_run(id) ON DELETE SET NULL;
ALTER TABLE sys_ai_agent_run ADD COLUMN IF NOT EXISTS source_approval_id INTEGER REFERENCES sys_ai_tool_approval(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sys_ai_agent_run_parent_run_id_idx ON sys_ai_agent_run(parent_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_agent_run_source_approval_unique ON sys_ai_agent_run(source_approval_id) WHERE source_approval_id IS NOT NULL;

UPDATE sys_ai_tool_approval
SET status = 'failed', reason = COALESCE(reason, '审批执行被部署中断，请重新发起工具调用'), updated_at = now()
WHERE status = 'executing';
`,
  },
  {
    id: "0029_ai_resource_navigation_labels",
    sql: `
UPDATE sys_rule
SET name = 'AI 服务商', updated_at = now()
WHERE key = 'system.aiProvider' AND type = 'route';

UPDATE sys_rule
SET name = '模型管理', updated_at = now()
WHERE key = 'system.aiModel' AND type = 'route';
`,
  },
  {
    id: "0030_ai_workflow_runtime",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_workflow_run (
  id SERIAL PRIMARY KEY,
  workflow_code TEXT NOT NULL,
  orchestrator_run_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'suspended', 'completed', 'failed', 'cancelled')),
  request_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  input_json TEXT,
  output_json TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_workflow_run_orchestrator_unique
  ON sys_ai_workflow_run(orchestrator_run_id);
CREATE INDEX IF NOT EXISTS sys_ai_workflow_run_user_status_idx
  ON sys_ai_workflow_run(user_id, status);
CREATE INDEX IF NOT EXISTS sys_ai_workflow_run_code_created_idx
  ON sys_ai_workflow_run(workflow_code, created_at);
CREATE INDEX IF NOT EXISTS sys_ai_workflow_run_request_id_idx
  ON sys_ai_workflow_run(request_id);

CREATE TABLE IF NOT EXISTS sys_ai_workflow_run_step (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES sys_ai_workflow_run(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL,
  step_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'suspended', 'completed', 'failed', 'skipped')),
  input_json TEXT,
  output_json TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_workflow_run_step_run_no_unique
  ON sys_ai_workflow_run_step(run_id, step_no);
CREATE INDEX IF NOT EXISTS sys_ai_workflow_run_step_code_idx
  ON sys_ai_workflow_run_step(step_code);

DROP TRIGGER IF EXISTS trg_sys_ai_workflow_run_updated_at ON sys_ai_workflow_run;
CREATE TRIGGER trg_sys_ai_workflow_run_updated_at
BEFORE UPDATE ON sys_ai_workflow_run
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sys_ai_workflow_run_step_updated_at ON sys_ai_workflow_run_step;
CREATE TRIGGER trg_sys_ai_workflow_run_step_updated_at
BEFORE UPDATE ON sys_ai_workflow_run_step
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (286, 280, 'action', 'system.aiAgent.executeWorkflow', '执行 AI 工作流', 6, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, 286
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = 286)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0031_ai_web_search_provider",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_web_search_provider (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('tavily', 'brave', 'searxng')),
  endpoint TEXT NOT NULL,
  api_key_encrypted TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 60000),
  max_results INTEGER NOT NULL DEFAULT 8 CHECK (max_results BETWEEN 1 AND 10),
  status INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  remark TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_web_search_provider_code_active_unique
  ON sys_ai_web_search_provider(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_ai_web_search_provider_type_status_idx
  ON sys_ai_web_search_provider(provider_type, status);
CREATE INDEX IF NOT EXISTS sys_ai_web_search_provider_status_sort_idx
  ON sys_ai_web_search_provider(status, sort);

DROP TRIGGER IF EXISTS trg_sys_ai_web_search_provider_updated_at ON sys_ai_web_search_provider;
CREATE TRIGGER trg_sys_ai_web_search_provider_updated_at
BEFORE UPDATE ON sys_ai_web_search_provider
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO sys_ai_web_search_provider
  (name, code, provider_type, endpoint, timeout_ms, max_results, status, sort, is_system, remark)
VALUES
  ('Tavily Search', 'tavily-default', 'tavily', 'https://api.tavily.com/search', 10000, 8, 0, 10, true,
   '配置 API Key 后启用；适合 Agent 联网搜索'),
  ('Brave Search', 'brave-default', 'brave', 'https://api.search.brave.com/res/v1/web/search', 10000, 8, 0, 20, true,
   '配置 Brave Search API Key 后启用'),
  ('Local SearXNG', 'searxng-local', 'searxng', 'http://127.0.0.1:18082/search', 10000, 8, 0, 30, true,
   '本地或内网 SearXNG；默认端口 18082')
ON CONFLICT DO NOTHING;

INSERT INTO sys_ai_tool
  (name, code, description, handler_key, input_schema_json, risk_level,
   approval_required, status, sort, is_system)
VALUES
  ('联网搜索', 'web-search',
   '搜索公开网络信息并返回可追溯来源；只接受搜索词和结果数量，不访问任意指定 URL',
   'web_search', '{"query":"string","limit":"number"}', 'low', false, 1, 5, true)
ON CONFLICT DO NOTHING;

UPDATE sys_ai_tool
SET name = '联网搜索',
    description = '搜索公开网络信息并返回可追溯来源；只接受搜索词和结果数量，不访问任意指定 URL',
    handler_key = 'web_search', input_schema_json = '{"query":"string","limit":"number"}',
    risk_level = 'low', approval_required = false, status = 1, sort = 5,
    is_system = true, updated_at = now()
WHERE code = 'web-search' AND deleted_at IS NULL;

INSERT INTO sys_ai_agent_tool (agent_id, tool_id, approval_mode)
SELECT agent.id, tool.id, 'never'
FROM sys_ai_agent agent
CROSS JOIN sys_ai_tool tool
WHERE agent.code = 'general-assistant' AND agent.deleted_at IS NULL
  AND tool.code = 'web-search' AND tool.deleted_at IS NULL
ON CONFLICT (agent_id, tool_id) DO UPDATE SET approval_mode = 'never';

UPDATE sys_ai_agent
SET instructions = '你是 Admin Base 后台工作助手。回答应准确、简洁。遇到天气、新闻、时效性事实或需要公开网络信息的问题时，在联网搜索工具可用的情况下应先调用 web-search，并基于工具返回的真实来源回答；不得虚构搜索、来源或实时信息。高风险工具必须等待人工审批。',
    updated_at = now()
WHERE code = 'general-assistant' AND deleted_at IS NULL;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (290, 180, 'route', 'system.aiWebSearch', '联网搜索', '/system/ai/web-search', 'global', 85, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (291, 290, 'action', 'system.aiWebSearch.query', '查询搜索 Provider', 1, 1, 0, 0, true, now(), now()),
  (292, 290, 'action', 'system.aiWebSearch.create', '新增搜索 Provider', 2, 1, 0, 0, true, now(), now()),
  (293, 290, 'action', 'system.aiWebSearch.update', '编辑搜索 Provider', 3, 1, 0, 0, true, now(), now()),
  (294, 290, 'action', 'system.aiWebSearch.delete', '删除搜索 Provider', 4, 1, 0, 0, true, now(), now()),
  (295, 290, 'action', 'system.aiWebSearch.status', '启停搜索 Provider', 5, 1, 0, 0, true, now(), now()),
  (296, 290, 'action', 'system.aiWebSearch.test', '测试搜索 Provider', 6, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (290), (291), (292), (293), (294), (295), (296)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('sys_ai_web_search_provider', 'id'),
  COALESCE((SELECT MAX(id) FROM sys_ai_web_search_provider), 1), true
);
SELECT setval(
  pg_get_serial_sequence('sys_ai_tool', 'id'),
  COALESCE((SELECT MAX(id) FROM sys_ai_tool), 1), true
);
`,
  },
  {
    id: "0032_ai_provider_timeout",
    sql: `
ALTER TABLE sys_ai_provider
  ADD COLUMN IF NOT EXISTS timeout_ms INTEGER;

UPDATE sys_ai_provider
SET timeout_ms = 300000
WHERE timeout_ms IS NULL;

ALTER TABLE sys_ai_provider
  ALTER COLUMN timeout_ms SET DEFAULT 300000,
  ALTER COLUMN timeout_ms SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sys_ai_provider_timeout_ms_check'
  ) THEN
    ALTER TABLE sys_ai_provider
      ADD CONSTRAINT sys_ai_provider_timeout_ms_check
      CHECK (timeout_ms BETWEEN 5000 AND 3600000);
  END IF;
END $$;
`,
  },
  {
    id: "0033_ai_setup_workbench",
    sql: `
INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (300, 180, 'route', 'system.aiSetup', 'AI 接入', '/system/ai/setup', 'api', 79, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (301, 300, 'action', 'system.aiSetup.query', '查看 AI 接入', 1, 1, 0, 0, true, now(), now()),
  (302, 300, 'action', 'system.aiSetup.configure', '配置 AI 接入', 2, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (300), (301), (302)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0034_ai_browser_location_client_tool",
    sql: `
INSERT INTO sys_ai_tool
  (name, code, description, handler_key, input_schema_json, risk_level,
   approval_required, status, sort, is_system)
VALUES
  ('浏览器位置', 'browser-location',
   '请求当前用户一次性授权浏览器大致位置；仅由浏览器执行，服务端不读取精确位置',
   'browser_location', '{"reason":"string"}', 'medium', true, 1, 6, true)
ON CONFLICT DO NOTHING;

UPDATE sys_ai_tool
SET name = '浏览器位置',
    description = '请求当前用户一次性授权浏览器大致位置；仅由浏览器执行，服务端不读取精确位置',
    handler_key = 'browser_location', input_schema_json = '{"reason":"string"}',
    risk_level = 'medium', approval_required = true, status = 1, sort = 6,
    is_system = true, updated_at = now()
WHERE code = 'browser-location' AND deleted_at IS NULL;

INSERT INTO sys_ai_agent_tool (agent_id, tool_id, approval_mode)
SELECT agent.id, tool.id, 'always'
FROM sys_ai_agent agent
CROSS JOIN sys_ai_tool tool
WHERE agent.code = 'general-assistant' AND agent.deleted_at IS NULL
  AND tool.code = 'browser-location' AND tool.deleted_at IS NULL
ON CONFLICT (agent_id, tool_id) DO UPDATE SET approval_mode = 'always';

UPDATE sys_ai_agent
SET instructions = '你是 Admin Base 后台工作助手。回答应准确、简洁。遇到天气、附近服务、路线等依赖当前位置的问题且用户未提供城市或地区时，应先调用 browser-location 请求一次性大致位置；获得位置后再调用 web-search。用户拒绝或定位失败时应询问城市，不得虚构位置。遇到新闻、时效性事实或需要公开网络信息的问题时，在联网搜索工具可用的情况下应先调用 web-search，并基于工具返回的真实来源回答；不得虚构搜索、来源或实时信息。高风险工具必须等待人工审批。',
    updated_at = now()
WHERE code = 'general-assistant' AND deleted_at IS NULL;

SELECT setval(
  pg_get_serial_sequence('sys_ai_tool', 'id'),
  COALESCE((SELECT MAX(id) FROM sys_ai_tool), 1), true
);
`,
  },
  {
    id: "0035_ai_runtime_reliability",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_purpose_route (
  purpose TEXT PRIMARY KEY
    CHECK (purpose IN ('chat', 'structured', 'embedding', 'rerank', 'agent', 'ragAnswer', 'evalJudge')),
  name TEXT NOT NULL,
  description TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER,
  updated_by INTEGER
);
CREATE INDEX IF NOT EXISTS sys_ai_purpose_route_status_idx ON sys_ai_purpose_route(status);

CREATE TABLE IF NOT EXISTS sys_ai_purpose_model (
  purpose TEXT NOT NULL REFERENCES sys_ai_purpose_route(purpose) ON DELETE CASCADE,
  model_id INTEGER NOT NULL REFERENCES sys_ai_model(id) ON DELETE RESTRICT,
  priority INTEGER NOT NULL CHECK (priority > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER,
  PRIMARY KEY (purpose, model_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_purpose_model_priority_unique
  ON sys_ai_purpose_model(purpose, priority);
CREATE INDEX IF NOT EXISTS sys_ai_purpose_model_model_id_idx ON sys_ai_purpose_model(model_id);

CREATE TABLE IF NOT EXISTS sys_ai_invocation (
  id SERIAL PRIMARY KEY,
  purpose TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  request_id TEXT,
  user_id INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  session_id INTEGER REFERENCES sys_ai_chat_session(id) ON DELETE SET NULL,
  run_id INTEGER,
  step_id INTEGER,
  requested_model_id INTEGER REFERENCES sys_ai_model(id) ON DELETE SET NULL,
  resolved_model_id INTEGER REFERENCES sys_ai_model(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'aborted')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost TEXT,
  currency TEXT,
  duration_ms INTEGER,
  error_type TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sys_ai_invocation_purpose_created_idx
  ON sys_ai_invocation(purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_invocation_status_created_idx
  ON sys_ai_invocation(status, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_invocation_request_id_idx ON sys_ai_invocation(request_id);
CREATE INDEX IF NOT EXISTS sys_ai_invocation_user_created_idx
  ON sys_ai_invocation(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_invocation_run_id_idx ON sys_ai_invocation(run_id);

CREATE TABLE IF NOT EXISTS sys_ai_invocation_attempt (
  id SERIAL PRIMARY KEY,
  invocation_id INTEGER NOT NULL REFERENCES sys_ai_invocation(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL CHECK (attempt_no > 0),
  provider_id INTEGER REFERENCES sys_ai_provider(id) ON DELETE SET NULL,
  model_id INTEGER REFERENCES sys_ai_model(id) ON DELETE SET NULL,
  provider_code TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  model_identifier TEXT NOT NULL,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'aborted')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost TEXT,
  currency TEXT,
  latency_ms INTEGER,
  first_token_ms INTEGER,
  error_type TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_invocation_attempt_no_unique
  ON sys_ai_invocation_attempt(invocation_id, attempt_no);
CREATE INDEX IF NOT EXISTS sys_ai_invocation_attempt_provider_created_idx
  ON sys_ai_invocation_attempt(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_invocation_attempt_model_created_idx
  ON sys_ai_invocation_attempt(model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_invocation_attempt_status_created_idx
  ON sys_ai_invocation_attempt(status, created_at DESC);

DROP TRIGGER IF EXISTS trg_sys_ai_purpose_route_updated_at ON sys_ai_purpose_route;
CREATE TRIGGER trg_sys_ai_purpose_route_updated_at
BEFORE UPDATE ON sys_ai_purpose_route
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO sys_ai_purpose_route (purpose, name, description, status)
VALUES
  ('chat', '普通对话', 'AI Chat 和普通文本生成', 1),
  ('structured', '结构化生成', 'JSON、表单和结构化内容生成', 1),
  ('embedding', '向量化', 'Knowledge/RAG 文档和查询向量化', 1),
  ('rerank', '重排序', 'RAG 检索结果重排序', 1),
  ('agent', 'Agent 执行', '需要工具调用能力的 Agent 运行', 1),
  ('ragAnswer', 'RAG 回答', '基于检索上下文生成带引用回答', 1),
  ('evalJudge', 'Eval 裁判', '评测数据集和输出质量判定', 1)
ON CONFLICT (purpose) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;

INSERT INTO sys_ai_purpose_model (purpose, model_id, priority)
SELECT 'chat', id, 1 FROM sys_ai_model
WHERE deleted_at IS NULL AND is_default_chat = true
ON CONFLICT DO NOTHING;
INSERT INTO sys_ai_purpose_model (purpose, model_id, priority)
SELECT 'structured', id, 1 FROM sys_ai_model
WHERE deleted_at IS NULL AND is_default_structured = true
ON CONFLICT DO NOTHING;
INSERT INTO sys_ai_purpose_model (purpose, model_id, priority)
SELECT 'embedding', id, 1 FROM sys_ai_model
WHERE deleted_at IS NULL AND is_default_embedding = true
ON CONFLICT DO NOTHING;
INSERT INTO sys_ai_purpose_model (purpose, model_id, priority)
SELECT 'agent', id, 1 FROM sys_ai_model
WHERE deleted_at IS NULL AND is_default_chat = true
  AND COALESCE(capabilities_json, '{}')::jsonb @> '{"toolCalling": true}'::jsonb
ON CONFLICT DO NOTHING;
INSERT INTO sys_ai_purpose_model (purpose, model_id, priority)
SELECT purpose, model_id, 1
FROM (
  SELECT 'ragAnswer' AS purpose, id AS model_id FROM sys_ai_model
  WHERE deleted_at IS NULL AND is_default_chat = true
  UNION ALL
  SELECT 'evalJudge' AS purpose, id AS model_id FROM sys_ai_model
  WHERE deleted_at IS NULL AND is_default_structured = true
) defaults
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (310, 180, 'route', 'system.aiRuntime', '运行与追踪', '/system/ai/runtime', 'dashboard', 82, 1, 1, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (311, 310, 'action', 'system.aiRuntime.query', '查询 AI 运行与追踪', 1, 1, 0, 0, true, now(), now()),
  (312, 310, 'action', 'system.aiRuntime.update', '配置 AI 用途路由', 2, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (310), (311), (312)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0036_ai_knowledge_rag",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_knowledge_base (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  scope_type TEXT NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global', 'department', 'user')),
  dept_id INTEGER REFERENCES sys_dept(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER,
  CONSTRAINT sys_ai_knowledge_base_scope_owner_check CHECK (
    (scope_type = 'global' AND dept_id IS NULL AND owner_id IS NULL) OR
    (scope_type = 'department' AND dept_id IS NOT NULL AND owner_id IS NULL) OR
    (scope_type = 'user' AND owner_id IS NOT NULL AND dept_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_knowledge_base_code_active_unique
  ON sys_ai_knowledge_base(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_ai_knowledge_base_scope_status_idx
  ON sys_ai_knowledge_base(scope_type, status);

CREATE TABLE IF NOT EXISTS sys_ai_document (
  id SERIAL PRIMARY KEY,
  knowledge_base_id INTEGER NOT NULL REFERENCES sys_ai_knowledge_base(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES sys_file(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'disabled')),
  character_count INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_document_base_hash_active_unique
  ON sys_ai_document(knowledge_base_id, sha256) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_ai_document_base_status_idx
  ON sys_ai_document(knowledge_base_id, status);
CREATE INDEX IF NOT EXISTS sys_ai_document_file_id_idx ON sys_ai_document(file_id);

CREATE TABLE IF NOT EXISTS sys_ai_document_chunk (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES sys_ai_document(id) ON DELETE CASCADE,
  chunk_no INTEGER NOT NULL CHECK (chunk_no > 0),
  content TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  page_number INTEGER,
  paragraph_start INTEGER,
  paragraph_end INTEGER,
  heading TEXT,
  metadata_json TEXT,
  embedding_json TEXT,
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_document_chunk_no_unique
  ON sys_ai_document_chunk(document_id, chunk_no);
CREATE INDEX IF NOT EXISTS sys_ai_document_chunk_document_id_idx
  ON sys_ai_document_chunk(document_id);
CREATE INDEX IF NOT EXISTS sys_ai_document_chunk_search_idx
  ON sys_ai_document_chunk USING GIN(search_vector);

CREATE TABLE IF NOT EXISTS sys_ai_rag_run (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  knowledge_base_ids_json TEXT NOT NULL,
  query_hash TEXT NOT NULL,
  invocation_id INTEGER REFERENCES sys_ai_invocation(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  citation_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sys_ai_rag_run_user_created_idx
  ON sys_ai_rag_run(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_rag_run_status_created_idx
  ON sys_ai_rag_run(status, created_at DESC);

CREATE TABLE IF NOT EXISTS sys_ai_rag_citation (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES sys_ai_rag_run(id) ON DELETE CASCADE,
  chunk_id INTEGER NOT NULL REFERENCES sys_ai_document_chunk(id) ON DELETE RESTRICT,
  rank INTEGER NOT NULL CHECK (rank > 0),
  score TEXT NOT NULL,
  quote TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_rag_citation_run_chunk_unique
  ON sys_ai_rag_citation(run_id, chunk_id);
CREATE INDEX IF NOT EXISTS sys_ai_rag_citation_run_rank_idx
  ON sys_ai_rag_citation(run_id, rank);

DROP TRIGGER IF EXISTS trg_sys_ai_knowledge_base_updated_at ON sys_ai_knowledge_base;
CREATE TRIGGER trg_sys_ai_knowledge_base_updated_at
BEFORE UPDATE ON sys_ai_knowledge_base
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_sys_ai_document_updated_at ON sys_ai_document;
CREATE TRIGGER trg_sys_ai_document_updated_at
BEFORE UPDATE ON sys_ai_document
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (320, 180, 'route', 'system.aiKnowledge', '知识库', '/system/ai/knowledge', 'book', 83, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (321, 320, 'action', 'system.aiKnowledge.query', '查询知识库', 1, 1, 0, 0, true, now(), now()),
  (322, 320, 'action', 'system.aiKnowledge.create', '创建知识库', 2, 1, 0, 0, true, now(), now()),
  (323, 320, 'action', 'system.aiKnowledge.update', '更新知识库', 3, 1, 0, 0, true, now(), now()),
  (324, 320, 'action', 'system.aiKnowledge.delete', '删除知识库', 4, 1, 0, 0, true, now(), now()),
  (325, 320, 'action', 'system.aiKnowledge.index', '索引知识文档', 5, 1, 0, 0, true, now(), now()),
  (326, 320, 'action', 'system.aiKnowledge.search', '检索和问答', 6, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (320), (321), (322), (323), (324), (325), (326)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0037_ai_knowledge_chunk_profiles",
    sql: `
ALTER TABLE sys_ai_knowledge_base
  ADD COLUMN IF NOT EXISTS chunk_preset TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS chunk_size INTEGER NOT NULL DEFAULT 1600,
  ADD COLUMN IF NOT EXISTS chunk_overlap INTEGER NOT NULL DEFAULT 160,
  ADD COLUMN IF NOT EXISTS chunk_config_json TEXT;

ALTER TABLE sys_ai_knowledge_base
  DROP CONSTRAINT IF EXISTS sys_ai_knowledge_base_chunk_preset_check;
ALTER TABLE sys_ai_knowledge_base
  ADD CONSTRAINT sys_ai_knowledge_base_chunk_preset_check
  CHECK (chunk_preset IN ('auto', 'documentation', 'paragraph', 'sentence', 'recursive', 'fixed'));
ALTER TABLE sys_ai_knowledge_base
  DROP CONSTRAINT IF EXISTS sys_ai_knowledge_base_chunk_size_check;
ALTER TABLE sys_ai_knowledge_base
  ADD CONSTRAINT sys_ai_knowledge_base_chunk_size_check
  CHECK (chunk_size BETWEEN 200 AND 12000);
ALTER TABLE sys_ai_knowledge_base
  DROP CONSTRAINT IF EXISTS sys_ai_knowledge_base_chunk_overlap_check;
ALTER TABLE sys_ai_knowledge_base
  ADD CONSTRAINT sys_ai_knowledge_base_chunk_overlap_check
  CHECK (chunk_overlap BETWEEN 0 AND 2000 AND chunk_overlap < chunk_size);

ALTER TABLE sys_ai_document
  ADD COLUMN IF NOT EXISTS chunker_version TEXT,
  ADD COLUMN IF NOT EXISTS chunk_config_json TEXT;
`,
  },
  {
    id: "0038_ai_notebook_v1",
    sql: `
ALTER TABLE sys_ai_rag_run
  ADD COLUMN IF NOT EXISTS source_filter_json TEXT;

CREATE TABLE IF NOT EXISTS sys_ai_notebook (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  scope_type TEXT NOT NULL DEFAULT 'user'
    CHECK (scope_type IN ('global', 'department', 'user')),
  dept_id INTEGER REFERENCES sys_dept(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  default_model_id INTEGER REFERENCES sys_ai_model(id) ON DELETE SET NULL,
  system_prompt TEXT,
  status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER,
  CONSTRAINT sys_ai_notebook_scope_owner_check CHECK (
    (scope_type = 'global' AND dept_id IS NULL AND owner_id IS NULL) OR
    (scope_type = 'department' AND dept_id IS NOT NULL AND owner_id IS NULL) OR
    (scope_type = 'user' AND owner_id IS NOT NULL AND dept_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS sys_ai_notebook_scope_status_idx
  ON sys_ai_notebook(scope_type, status);
CREATE INDEX IF NOT EXISTS sys_ai_notebook_owner_created_idx
  ON sys_ai_notebook(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_notebook_dept_created_idx
  ON sys_ai_notebook(dept_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sys_ai_notebook_source (
  id SERIAL PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES sys_ai_notebook(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('knowledge_base', 'document')),
  knowledge_base_id INTEGER REFERENCES sys_ai_knowledge_base(id) ON DELETE RESTRICT,
  document_id INTEGER REFERENCES sys_ai_document(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER,
  CONSTRAINT sys_ai_notebook_source_target_check CHECK (
    (source_type = 'knowledge_base' AND knowledge_base_id IS NOT NULL AND document_id IS NULL) OR
    (source_type = 'document' AND document_id IS NOT NULL AND knowledge_base_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS sys_ai_notebook_source_notebook_idx
  ON sys_ai_notebook_source(notebook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_notebook_source_base_idx
  ON sys_ai_notebook_source(knowledge_base_id);
CREATE INDEX IF NOT EXISTS sys_ai_notebook_source_document_idx
  ON sys_ai_notebook_source(document_id);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_notebook_source_base_active_unique
  ON sys_ai_notebook_source(notebook_id, knowledge_base_id)
  WHERE deleted_at IS NULL AND source_type = 'knowledge_base';
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_notebook_source_document_active_unique
  ON sys_ai_notebook_source(notebook_id, document_id)
  WHERE deleted_at IS NULL AND source_type = 'document';

CREATE TABLE IF NOT EXISTS sys_ai_notebook_artifact (
  id SERIAL PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES sys_ai_notebook(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('summary', 'outline', 'faq', 'brief')),
  title TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  content TEXT,
  status TEXT NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating', 'completed', 'failed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  rag_run_id INTEGER REFERENCES sys_ai_rag_run(id) ON DELETE SET NULL,
  invocation_id INTEGER REFERENCES sys_ai_invocation(id) ON DELETE SET NULL,
  model_id INTEGER REFERENCES sys_ai_model(id) ON DELETE SET NULL,
  source_snapshot_json TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  error_message TEXT,
  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);
CREATE INDEX IF NOT EXISTS sys_ai_notebook_artifact_notebook_created_idx
  ON sys_ai_notebook_artifact(notebook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_notebook_artifact_status_created_idx
  ON sys_ai_notebook_artifact(status, created_at DESC);

DROP TRIGGER IF EXISTS trg_sys_ai_notebook_updated_at ON sys_ai_notebook;
CREATE TRIGGER trg_sys_ai_notebook_updated_at
BEFORE UPDATE ON sys_ai_notebook
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_sys_ai_notebook_artifact_updated_at ON sys_ai_notebook_artifact;
CREATE TRIGGER trg_sys_ai_notebook_artifact_updated_at
BEFORE UPDATE ON sys_ai_notebook_artifact
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (330, 180, 'route', 'system.aiNotebook', 'AI Notebook', '/system/ai/notebook', 'book', 84, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (331, 330, 'action', 'system.aiNotebook.query', '查询 Notebook', 1, 1, 0, 0, true, now(), now()),
  (332, 330, 'action', 'system.aiNotebook.create', '创建 Notebook', 2, 1, 0, 0, true, now(), now()),
  (333, 330, 'action', 'system.aiNotebook.update', '更新 Notebook', 3, 1, 0, 0, true, now(), now()),
  (334, 330, 'action', 'system.aiNotebook.delete', '删除 Notebook', 4, 1, 0, 0, true, now(), now()),
  (335, 330, 'action', 'system.aiNotebook.source', '管理 Notebook 来源', 5, 1, 0, 0, true, now(), now()),
  (336, 330, 'action', 'system.aiNotebook.ask', 'Notebook 检索问答', 6, 1, 0, 0, true, now(), now()),
  (337, 330, 'action', 'system.aiNotebook.artifact', '生成 Notebook 产物', 7, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (330), (331), (332), (333), (334), (335), (336), (337)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0039_ai_eval_v1",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_eval_dataset (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  scope_type TEXT NOT NULL DEFAULT 'user'
    CHECK (scope_type IN ('global', 'department', 'user')),
  dept_id INTEGER REFERENCES sys_dept(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER,
  CONSTRAINT sys_ai_eval_dataset_scope_owner_check CHECK (
    (scope_type = 'global' AND dept_id IS NULL AND owner_id IS NULL) OR
    (scope_type = 'department' AND dept_id IS NOT NULL AND owner_id IS NULL) OR
    (scope_type = 'user' AND owner_id IS NOT NULL AND dept_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS sys_ai_eval_dataset_scope_status_idx
  ON sys_ai_eval_dataset(scope_type, status);
CREATE INDEX IF NOT EXISTS sys_ai_eval_dataset_owner_created_idx
  ON sys_ai_eval_dataset(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_eval_dataset_dept_created_idx
  ON sys_ai_eval_dataset(dept_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sys_ai_eval_case (
  id SERIAL PRIMARY KEY,
  dataset_id INTEGER NOT NULL REFERENCES sys_ai_eval_dataset(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  agent_id INTEGER NOT NULL REFERENCES sys_ai_agent(id) ON DELETE RESTRICT,
  source_run_id INTEGER REFERENCES sys_ai_agent_run(id) ON DELETE SET NULL,
  input_text TEXT NOT NULL,
  expected_text TEXT,
  assertions_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status INTEGER NOT NULL DEFAULT 1 CHECK (status IN (0, 1)),
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);
CREATE INDEX IF NOT EXISTS sys_ai_eval_case_dataset_status_idx
  ON sys_ai_eval_case(dataset_id, status);
CREATE INDEX IF NOT EXISTS sys_ai_eval_case_agent_id_idx ON sys_ai_eval_case(agent_id);
CREATE INDEX IF NOT EXISTS sys_ai_eval_case_source_run_idx ON sys_ai_eval_case(source_run_id);

CREATE TABLE IF NOT EXISTS sys_ai_eval_run (
  id SERIAL PRIMARY KEY,
  dataset_id INTEGER NOT NULL REFERENCES sys_ai_eval_dataset(id) ON DELETE RESTRICT,
  user_id INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  total_cases INTEGER NOT NULL DEFAULT 0,
  passed_cases INTEGER NOT NULL DEFAULT 0,
  failed_cases INTEGER NOT NULL DEFAULT 0,
  error_cases INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sys_ai_eval_run_dataset_created_idx
  ON sys_ai_eval_run(dataset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_eval_run_user_created_idx
  ON sys_ai_eval_run(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_eval_run_status_created_idx
  ON sys_ai_eval_run(status, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_eval_run_request_id_idx ON sys_ai_eval_run(request_id);

CREATE TABLE IF NOT EXISTS sys_ai_eval_result (
  id SERIAL PRIMARY KEY,
  eval_run_id INTEGER NOT NULL REFERENCES sys_ai_eval_run(id) ON DELETE CASCADE,
  case_id INTEGER NOT NULL REFERENCES sys_ai_eval_case(id) ON DELETE RESTRICT,
  agent_run_id INTEGER REFERENCES sys_ai_agent_run(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'error')),
  actual_output TEXT,
  assertions_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sys_ai_eval_result_run_case_unique UNIQUE (eval_run_id, case_id)
);
CREATE INDEX IF NOT EXISTS sys_ai_eval_result_agent_run_idx
  ON sys_ai_eval_result(agent_run_id);
CREATE INDEX IF NOT EXISTS sys_ai_eval_result_status_created_idx
  ON sys_ai_eval_result(status, created_at DESC);

DROP TRIGGER IF EXISTS trg_sys_ai_eval_dataset_updated_at ON sys_ai_eval_dataset;
CREATE TRIGGER trg_sys_ai_eval_dataset_updated_at
BEFORE UPDATE ON sys_ai_eval_dataset
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_sys_ai_eval_case_updated_at ON sys_ai_eval_case;
CREATE TRIGGER trg_sys_ai_eval_case_updated_at
BEFORE UPDATE ON sys_ai_eval_case
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (340, 180, 'route', 'system.aiEval', 'AI Eval', '/system/ai/eval', 'bug', 86, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system, created_at, updated_at)
VALUES
  (341, 340, 'action', 'system.aiEval.query', '查询 Eval', 1, 1, 0, 0, true, now(), now()),
  (342, 340, 'action', 'system.aiEval.create', '创建 Eval 数据', 2, 1, 0, 0, true, now(), now()),
  (343, 340, 'action', 'system.aiEval.update', '更新 Eval 数据', 3, 1, 0, 0, true, now(), now()),
  (344, 340, 'action', 'system.aiEval.delete', '删除 Eval 数据', 4, 1, 0, 0, true, now(), now()),
  (345, 340, 'action', 'system.aiEval.execute', '执行 Eval', 5, 1, 0, 0, true, now(), now()),
  (346, 340, 'action', 'system.aiEval.saveCase', '从 Run 保存用例', 6, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT 1, rules.rule_id
FROM (VALUES (340), (341), (342), (343), (344), (345), (346)) AS rules(rule_id)
WHERE EXISTS (SELECT 1 FROM sys_role WHERE id = 1)
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0040_ai_pricing_and_eval_baseline",
    sql: `
ALTER TABLE sys_ai_model ADD COLUMN IF NOT EXISTS cached_input_price TEXT;
ALTER TABLE sys_ai_model ADD COLUMN IF NOT EXISTS cache_write_price TEXT;
ALTER TABLE sys_ai_model ADD COLUMN IF NOT EXISTS pricing_source_url TEXT;
ALTER TABLE sys_ai_model ADD COLUMN IF NOT EXISTS pricing_verified_at DATE;
ALTER TABLE sys_ai_invocation ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sys_ai_invocation_attempt ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER NOT NULL DEFAULT 0;

INSERT INTO sys_ai_eval_dataset
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
  );

INSERT INTO sys_ai_eval_case
  (dataset_id, name, description, agent_id, input_text, expected_text,
   assertions_json, tags_json, status, sort, created_by, updated_by)
SELECT
  dataset.id, seed.name, seed.description, agent.id, seed.input_text, seed.expected_text,
  seed.assertions_json, seed.tags_json, 1, seed.sort, 1, 1
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
CROSS JOIN (VALUES
  ('基础指令遵循', '验证 Agent 能稳定遵循精确输出指令。',
   '请只回复：Admin Base Eval OK', 'Admin Base Eval OK',
   '{"contains":["Admin Base Eval OK"],"forbiddenTools":["web-search","browser-location"]}',
   '["baseline","instruction"]', 10),
  ('计算器工具调用', '验证确定性计算会调用受控 calculator 工具。',
   '请使用计算器计算 125 * 8，并在最终答案中包含计算结果。', '1000',
   '{"contains":["1000"],"expectedTools":["calculator"],"forbiddenTools":["web-search","browser-location"]}',
   '["baseline","tool","calculator"]', 20),
  ('联网搜索工具调用', '验证时效性问题会进入 Web Search；运行环境需要启用搜索 Provider。',
   '请联网查询深圳今天的天气，并给出信息来源。', NULL,
   '{"expectedTools":["web-search"],"forbiddenTools":["browser-location"]}',
   '["baseline","tool","web-search","external"]', 30)
) AS seed(name, description, input_text, expected_text, assertions_json, tags_json, sort)
WHERE NOT EXISTS (
  SELECT 1 FROM sys_ai_eval_case eval_case
  WHERE eval_case.dataset_id = dataset.id
    AND eval_case.name = seed.name
    AND eval_case.deleted_at IS NULL
);
`,
  },
  {
    id: "0041_ai_pricing_source_backfill",
    sql: `
UPDATE sys_ai_model AS model
SET pricing_source_url = CASE provider.provider_type
    WHEN 'openai' THEN 'https://openai.com/api/pricing/'
    WHEN 'anthropic' THEN 'https://platform.claude.com/docs/en/about-claude/pricing'
    WHEN 'google' THEN 'https://ai.google.dev/gemini-api/docs/pricing'
    WHEN 'deepseek' THEN 'https://api-docs.deepseek.com/quick_start/pricing/'
    WHEN 'qwen' THEN 'https://help.aliyun.com/zh/model-studio/model-pricing'
    WHEN 'moonshot' THEN 'https://platform.kimi.com/docs/pricing/chat'
    WHEN 'zhipu' THEN 'https://open.bigmodel.cn/pricing'
    WHEN 'siliconflow' THEN 'https://www.siliconflow.com/pricing'
    WHEN 'openrouter' THEN 'https://openrouter.ai/models'
    ELSE model.pricing_source_url
  END,
  updated_at = now()
FROM sys_ai_provider AS provider
WHERE model.provider_id = provider.id
  AND model.pricing_source_url IS NULL
  AND provider.provider_type IN (
    'openai', 'anthropic', 'google', 'deepseek', 'qwen',
    'moonshot', 'zhipu', 'siliconflow', 'openrouter'
  );
`,
  },
  {
    id: "0042_ai_pricing_catalog",
    sql: `
ALTER TABLE sys_ai_model ADD COLUMN IF NOT EXISTS pricing_source_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE sys_ai_model ADD COLUMN IF NOT EXISTS pricing_catalog_key TEXT;
ALTER TABLE sys_ai_model ADD COLUMN IF NOT EXISTS pricing_source_hash TEXT;
ALTER TABLE sys_ai_model ADD COLUMN IF NOT EXISTS pricing_synced_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS sys_ai_pricing_catalog_snapshot (
  id SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL DEFAULT 'litellm',
  source_url TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  model_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_pricing_catalog_snapshot_hash_unique
  ON sys_ai_pricing_catalog_snapshot(source_type, source_hash);
CREATE INDEX IF NOT EXISTS sys_ai_pricing_catalog_snapshot_fetched_idx
  ON sys_ai_pricing_catalog_snapshot(fetched_at DESC);

CREATE TABLE IF NOT EXISTS sys_ai_pricing_catalog_item (
  id SERIAL PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES sys_ai_pricing_catalog_snapshot(id) ON DELETE CASCADE,
  catalog_key TEXT NOT NULL,
  model_identifier TEXT NOT NULL,
  provider_type TEXT,
  mode TEXT,
  input_price TEXT,
  cached_input_price TEXT,
  cache_write_price TEXT,
  output_price TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  context_window INTEGER,
  max_output_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_pricing_catalog_item_snapshot_key_unique
  ON sys_ai_pricing_catalog_item(snapshot_id, catalog_key);
CREATE INDEX IF NOT EXISTS sys_ai_pricing_catalog_item_snapshot_provider_idx
  ON sys_ai_pricing_catalog_item(snapshot_id, provider_type);
CREATE INDEX IF NOT EXISTS sys_ai_pricing_catalog_item_snapshot_model_idx
  ON sys_ai_pricing_catalog_item(snapshot_id, model_identifier);

INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, default_auth, is_system,
   created_at, updated_at)
SELECT 248, parent.id, 'action', 'system.aiModel.syncPricing', '同步 AI 模型价格', 8,
       1, 0, 0, 0, true, now(), now()
FROM sys_rule parent
WHERE parent.key = 'system.aiModel' AND parent.deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO sys_role_rule (role_id, rule_id)
SELECT role.id, rule.id
FROM sys_role role
JOIN sys_rule rule ON rule.key = 'system.aiModel.syncPricing' AND rule.deleted_at IS NULL
WHERE role.code = 'admin' AND role.deleted_at IS NULL
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0043_ai_governance_foundation",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_memory (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  agent_id INTEGER REFERENCES sys_ai_agent(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'agent')),
  content TEXT NOT NULL,
  write_policy TEXT NOT NULL DEFAULT 'manual' CHECK (write_policy IN ('manual', 'confirmed')),
  source_session_id INTEGER REFERENCES sys_ai_chat_session(id) ON DELETE SET NULL,
  source_message_id INTEGER REFERENCES sys_ai_chat_message(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER,
  CONSTRAINT sys_ai_memory_scope_agent_check CHECK (
    (scope_type = 'user' AND agent_id IS NULL) OR
    (scope_type = 'agent' AND agent_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS sys_ai_memory_user_agent_status_idx
  ON sys_ai_memory(user_id, agent_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_memory_expires_idx ON sys_ai_memory(expires_at);

CREATE TABLE IF NOT EXISTS sys_ai_runtime_skill (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  instructions TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_runtime_skill_code_active_unique
  ON sys_ai_runtime_skill(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_ai_runtime_skill_status_sort_idx
  ON sys_ai_runtime_skill(status, sort, id);

CREATE TABLE IF NOT EXISTS sys_ai_runtime_skill_tool (
  skill_id INTEGER NOT NULL REFERENCES sys_ai_runtime_skill(id) ON DELETE CASCADE,
  tool_id INTEGER NOT NULL REFERENCES sys_ai_tool(id) ON DELETE CASCADE,
  PRIMARY KEY (skill_id, tool_id)
);
CREATE TABLE IF NOT EXISTS sys_ai_agent_skill (
  agent_id INTEGER NOT NULL REFERENCES sys_ai_agent(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES sys_ai_runtime_skill(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS sys_ai_mcp_server (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'streamable_http'
    CHECK (transport IN ('streamable_http', 'sse')),
  oauth_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (oauth_mode IN ('none', 'client_credentials', 'authorization_code')),
  client_id TEXT,
  client_secret_encrypted TEXT,
  authorization_url TEXT,
  token_url TEXT,
  scopes TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'disabled', 'error')),
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_mcp_server_code_active_unique
  ON sys_ai_mcp_server(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_ai_mcp_server_status_idx ON sys_ai_mcp_server(status, id);

CREATE TABLE IF NOT EXISTS sys_ai_mcp_connection (
  id SERIAL PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES sys_ai_mcp_server(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES sys_user(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'expired', 'revoked', 'error')),
  state_hash TEXT,
  code_verifier_encrypted TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_type TEXT,
  scopes TEXT,
  expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sys_ai_mcp_connection_server_user_idx
  ON sys_ai_mcp_connection(server_id, user_id, status);

CREATE TABLE IF NOT EXISTS sys_ai_mcp_tool (
  id SERIAL PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES sys_ai_mcp_server(id) ON DELETE CASCADE,
  remote_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  input_schema_json TEXT,
  risk_level TEXT NOT NULL DEFAULT 'medium'
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  approval_required BOOLEAN NOT NULL DEFAULT true,
  allowlisted BOOLEAN NOT NULL DEFAULT false,
  status INTEGER NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (server_id, remote_name)
);
CREATE INDEX IF NOT EXISTS sys_ai_mcp_tool_server_status_idx
  ON sys_ai_mcp_tool(server_id, status, allowlisted);

CREATE TABLE IF NOT EXISTS sys_ai_provider_circuit (
  provider_id INTEGER NOT NULL REFERENCES sys_ai_provider(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open', 'half_open')),
  failure_threshold INTEGER NOT NULL DEFAULT 3 CHECK (failure_threshold BETWEEN 1 AND 100),
  cooldown_ms INTEGER NOT NULL DEFAULT 60000 CHECK (cooldown_ms BETWEEN 1000 AND 86400000),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  next_probe_at TIMESTAMPTZ,
  probe_lease_until TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error_type TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, purpose)
);
CREATE INDEX IF NOT EXISTS sys_ai_provider_circuit_state_probe_idx
  ON sys_ai_provider_circuit(state, next_probe_at);

CREATE TABLE IF NOT EXISTS sys_ai_job (
  id SERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 100,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by TEXT,
  lease_until TIMESTAMPTZ,
  idempotency_key TEXT,
  user_id INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  resource_type TEXT,
  resource_id TEXT,
  request_id TEXT,
  result_json TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_job_idempotency_unique
  ON sys_ai_job(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sys_ai_job_claim_idx
  ON sys_ai_job(status, available_at, priority, id);
CREATE INDEX IF NOT EXISTS sys_ai_job_user_created_idx ON sys_ai_job(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sys_ai_quota_policy (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('system', 'department', 'user')),
  subject_id INTEGER,
  period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('daily', 'monthly')),
  max_input_tokens INTEGER,
  max_output_tokens INTEGER,
  max_cost TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  status INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER,
  updated_by INTEGER,
  CONSTRAINT sys_ai_quota_policy_subject_check CHECK (
    (subject_type = 'system' AND subject_id IS NULL) OR
    (subject_type <> 'system' AND subject_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_quota_policy_subject_period_unique
  ON sys_ai_quota_policy(subject_type, COALESCE(subject_id, 0), period);

CREATE TABLE IF NOT EXISTS sys_ai_billing_ledger (
  id SERIAL PRIMARY KEY,
  invocation_id INTEGER REFERENCES sys_ai_invocation(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  provider_id INTEGER REFERENCES sys_ai_provider(id) ON DELETE SET NULL,
  model_id INTEGER REFERENCES sys_ai_model(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'usage' CHECK (entry_type IN ('usage', 'adjustment')),
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'estimated'
    CHECK (status IN ('estimated', 'confirmed', 'void')),
  source TEXT NOT NULL DEFAULT 'runtime_estimate',
  description TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_billing_ledger_invocation_usage_unique
  ON sys_ai_billing_ledger(invocation_id) WHERE entry_type = 'usage' AND invocation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sys_ai_billing_ledger_user_occurred_idx
  ON sys_ai_billing_ledger(user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS sys_ai_notebook_member (
  notebook_id INTEGER NOT NULL REFERENCES sys_ai_notebook(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER,
  PRIMARY KEY (notebook_id, user_id)
);
CREATE INDEX IF NOT EXISTS sys_ai_notebook_member_user_idx
  ON sys_ai_notebook_member(user_id, notebook_id);

ALTER TABLE sys_ai_eval_case ADD COLUMN IF NOT EXISTS judge_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_ai_eval_case ADD COLUMN IF NOT EXISTS judge_rubric TEXT;
ALTER TABLE sys_ai_eval_case ADD COLUMN IF NOT EXISTS groundedness_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sys_ai_eval_result ADD COLUMN IF NOT EXISTS judge_score INTEGER;
ALTER TABLE sys_ai_eval_result ADD COLUMN IF NOT EXISTS judge_reason TEXT;
ALTER TABLE sys_ai_eval_result ADD COLUMN IF NOT EXISTS groundedness_score TEXT;
ALTER TABLE sys_ai_eval_result ADD COLUMN IF NOT EXISTS judge_invocation_id INTEGER
  REFERENCES sys_ai_invocation(id) ON DELETE SET NULL;

INSERT INTO sys_ai_tool
  (name, code, description, handler_key, input_schema_json, risk_level,
   approval_required, status, sort, is_system)
VALUES
  ('知识库检索', 'knowledge-search', '从当前用户可访问的知识库检索证据',
   'knowledge_search', '{"query":"string","knowledgeBaseIds":"number[]","limit":"number"}',
   'low', false, 1, 7, true)
ON CONFLICT (code) WHERE deleted_at IS NULL DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  handler_key = EXCLUDED.handler_key, input_schema_json = EXCLUDED.input_schema_json,
  risk_level = EXCLUDED.risk_level, approval_required = EXCLUDED.approval_required,
  status = EXCLUDED.status, is_system = EXCLUDED.is_system, updated_at = now();

INSERT INTO sys_ai_agent_tool (agent_id, tool_id, approval_mode)
SELECT agent.id, tool.id, 'inherit'
FROM sys_ai_agent agent CROSS JOIN sys_ai_tool tool
WHERE agent.code = 'general-assistant' AND agent.deleted_at IS NULL
  AND tool.code = 'knowledge-search' AND tool.deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO sys_rule
  (id, parent_id, type, key, name, path, icon, "order", status, hidden, link, is_system,
   created_at, updated_at)
VALUES
  (350, 180, 'route', 'system.aiGovernance', 'AI 治理', '/system/ai/governance',
   'safety', 87, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;
INSERT INTO sys_rule
  (id, parent_id, type, key, name, "order", status, hidden, link, is_system,
   created_at, updated_at)
VALUES
  (351, 350, 'action', 'system.aiGovernance.query', '查询 AI 治理', 1, 1, 0, 0, true, now(), now()),
  (352, 350, 'action', 'system.aiGovernance.update', '配置 AI 治理', 2, 1, 0, 0, true, now(), now()),
  (353, 350, 'action', 'system.aiGovernance.execute', '执行 AI 治理任务', 3, 1, 0, 0, true, now(), now()),
  (354, 350, 'action', 'system.aiGovernance.approve', '审批 MCP 工具', 4, 1, 0, 0, true, now(), now())
ON CONFLICT DO NOTHING;
INSERT INTO sys_role_rule (role_id, rule_id)
SELECT role.id, rule_id
FROM sys_role role
CROSS JOIN (VALUES (350), (351), (352), (353), (354)) rules(rule_id)
WHERE role.code = 'admin' AND role.deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM sys_rule WHERE id = rules.rule_id)
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0044_ai_knowledge_tool_reconciliation",
    sql: `
INSERT INTO sys_ai_tool
  (name, code, description, handler_key, input_schema_json, risk_level,
   approval_required, status, sort, is_system)
VALUES
  ('知识库检索', 'knowledge-search', '从当前用户可访问的知识库检索证据',
   'knowledge_search', '{"query":"string","knowledgeBaseIds":"number[]","limit":"number"}',
   'low', false, 1, 7, true)
ON CONFLICT (code) WHERE deleted_at IS NULL DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  handler_key = EXCLUDED.handler_key, input_schema_json = EXCLUDED.input_schema_json,
  risk_level = EXCLUDED.risk_level, approval_required = EXCLUDED.approval_required,
  status = EXCLUDED.status, is_system = EXCLUDED.is_system, updated_at = now();

INSERT INTO sys_ai_agent_tool (agent_id, tool_id, approval_mode)
SELECT agent.id, tool.id, 'inherit'
FROM sys_ai_agent agent CROSS JOIN sys_ai_tool tool
WHERE agent.code = 'general-assistant' AND agent.deleted_at IS NULL
  AND tool.code = 'knowledge-search' AND tool.deleted_at IS NULL
ON CONFLICT DO NOTHING;
`,
  },
  {
    id: "0045_ai_notebook_website_sources",
    sql: `
ALTER TABLE sys_ai_knowledge_base
  ADD COLUMN IF NOT EXISTS managed_type TEXT;
ALTER TABLE sys_ai_knowledge_base
  ADD COLUMN IF NOT EXISTS managed_resource_id INTEGER;
ALTER TABLE sys_ai_knowledge_base DROP CONSTRAINT IF EXISTS sys_ai_knowledge_base_managed_type_check;
ALTER TABLE sys_ai_knowledge_base ADD CONSTRAINT sys_ai_knowledge_base_managed_type_check
  CHECK (managed_type IS NULL OR managed_type IN ('notebook'));
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_knowledge_base_managed_resource_unique
  ON sys_ai_knowledge_base(managed_type, managed_resource_id)
  WHERE managed_type IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE sys_ai_document
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'file';
ALTER TABLE sys_ai_document
  ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE sys_ai_document
  ADD COLUMN IF NOT EXISTS canonical_url TEXT;
ALTER TABLE sys_ai_document
  ADD COLUMN IF NOT EXISTS source_domain TEXT;
ALTER TABLE sys_ai_document
  ADD COLUMN IF NOT EXISTS source_title TEXT;
ALTER TABLE sys_ai_document
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE sys_ai_document
  ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ;
ALTER TABLE sys_ai_document
  ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE sys_ai_document DROP CONSTRAINT IF EXISTS sys_ai_document_source_type_check;
ALTER TABLE sys_ai_document ADD CONSTRAINT sys_ai_document_source_type_check
  CHECK (source_type IN ('file', 'web_url'));
CREATE INDEX IF NOT EXISTS sys_ai_document_source_type_idx
  ON sys_ai_document(source_type, fetched_at DESC);
`,
  },
  {
    id: "0046_ai_research_and_file_usage",
    sql: `
ALTER TABLE sys_file
  ADD COLUMN IF NOT EXISTS usage_type TEXT NOT NULL DEFAULT 'general';
ALTER TABLE sys_file DROP CONSTRAINT IF EXISTS sys_file_usage_type_check;
ALTER TABLE sys_file ADD CONSTRAINT sys_file_usage_type_check
  CHECK (usage_type IN ('general', 'knowledge', 'user_content'));
CREATE INDEX IF NOT EXISTS sys_file_usage_type_created_idx
  ON sys_file(usage_type, created_at DESC);

UPDATE sys_file file
SET usage_type = 'knowledge', updated_at = now()
WHERE EXISTS (
  SELECT 1 FROM sys_ai_document document
  WHERE document.file_id = file.id AND document.deleted_at IS NULL
)
AND NOT EXISTS (
  SELECT 1 FROM sys_file_reference reference
  WHERE reference.file_id = file.id AND reference.module <> 'system.aiKnowledge'
);

CREATE INDEX IF NOT EXISTS sys_ai_workflow_run_resource_idx
  ON sys_ai_workflow_run(resource_type, resource_id, created_at DESC);

UPDATE sys_config_items
SET "values" = concat_ws(',', nullif("values", ''), 'md'), updated_at = now()
WHERE key = 'file.allowed_extensions'
  AND deleted_at IS NULL
  AND lower(',' || coalesce("values", '') || ',') NOT LIKE '%,md,%';

UPDATE sys_config_items
SET "values" = concat_ws(',', nullif("values", ''), 'markdown'), updated_at = now()
WHERE key = 'file.allowed_extensions'
  AND deleted_at IS NULL
  AND lower(',' || coalesce("values", '') || ',') NOT LIKE '%,markdown,%';
`,
  },
  {
    id: "0047_ai_agent_run_leases",
    sql: `
ALTER TABLE sys_ai_agent_run
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sys_ai_agent_run
  ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE sys_ai_agent_run
  ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
ALTER TABLE sys_ai_agent_run
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS sys_ai_agent_run_lease_idx
  ON sys_ai_agent_run(status, lease_until);

UPDATE sys_ai_agent_run
SET attempt = 1
WHERE attempt IS NULL OR attempt < 1;
`,
  },
  {
    id: "0048_ai_agent_run_events",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_agent_run_event (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES sys_ai_agent_run(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_agent_run_event_sequence_unique
  ON sys_ai_agent_run_event(run_id, attempt, sequence);
CREATE INDEX IF NOT EXISTS sys_ai_agent_run_event_run_id_idx
  ON sys_ai_agent_run_event(run_id, id);
`,
  },
  {
    id: "0049_ai_tool_execution_idempotency",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_tool_execution (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES sys_ai_agent_run(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  tool_id INTEGER REFERENCES sys_ai_tool(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  error_message TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_tool_execution_run_attempt_call_unique
  ON sys_ai_tool_execution(run_id, attempt, tool_call_id);
CREATE INDEX IF NOT EXISTS sys_ai_tool_execution_run_status_idx
  ON sys_ai_tool_execution(run_id, status);
`,
  },
  {
    id: "0050_ai_notebook_source_scope_version",
    sql: `
ALTER TABLE sys_ai_notebook
  ADD COLUMN IF NOT EXISTS source_scope_version INTEGER NOT NULL DEFAULT 1;
UPDATE sys_ai_notebook
SET source_scope_version = 1
WHERE source_scope_version IS NULL OR source_scope_version < 1;
`,
  },
  {
    id: "0051_ai_notebook_artifact_source_scope_version",
    sql: `
ALTER TABLE sys_ai_notebook_artifact
  ADD COLUMN IF NOT EXISTS source_scope_version INTEGER NOT NULL DEFAULT 1;
UPDATE sys_ai_notebook_artifact
SET source_scope_version = 1
WHERE source_scope_version IS NULL OR source_scope_version < 1;
`,
  },
  {
    id: "0052_ai_notebook_research_candidates",
    sql: `
CREATE TABLE IF NOT EXISTS sys_ai_notebook_research_candidate (
  id SERIAL PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES sys_ai_notebook(id) ON DELETE CASCADE,
  workflow_run_id INTEGER REFERENCES sys_ai_workflow_run(id) ON DELETE SET NULL,
  query_text TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT,
  source TEXT,
  published_at TEXT,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'accepted', 'pending', 'parsing', 'ready', 'failed', 'rejected')),
  document_id INTEGER REFERENCES sys_ai_document(id) ON DELETE SET NULL,
  notebook_source_id INTEGER REFERENCES sys_ai_notebook_source(id) ON DELETE SET NULL,
  error_message TEXT,
  accepted_at TIMESTAMPTZ,
  parsed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER,
  updated_by INTEGER,
  deleted_by INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_notebook_research_candidate_url_unique
  ON sys_ai_notebook_research_candidate(notebook_id, canonical_url)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_ai_notebook_research_candidate_notebook_status_idx
  ON sys_ai_notebook_research_candidate(notebook_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_notebook_research_candidate_workflow_idx
  ON sys_ai_notebook_research_candidate(workflow_run_id);
DROP TRIGGER IF EXISTS trg_sys_ai_notebook_research_candidate_updated_at
  ON sys_ai_notebook_research_candidate;
CREATE TRIGGER trg_sys_ai_notebook_research_candidate_updated_at
BEFORE UPDATE ON sys_ai_notebook_research_candidate
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `,
  },
  {
    id: "0053_ai_governance_worker_foundations",
    sql: `
ALTER TABLE sys_ai_memory ADD COLUMN IF NOT EXISTS importance INTEGER NOT NULL DEFAULT 50;
ALTER TABLE sys_ai_memory ADD COLUMN IF NOT EXISTS normalized_key TEXT;
ALTER TABLE sys_ai_memory ADD COLUMN IF NOT EXISTS embedding_json TEXT;
ALTER TABLE sys_ai_memory ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;
ALTER TABLE sys_ai_memory ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS sys_ai_memory_normalized_key_idx
  ON sys_ai_memory(user_id, normalized_key);

CREATE TABLE IF NOT EXISTS sys_ai_memory_candidate (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  agent_id INTEGER REFERENCES sys_ai_agent(id) ON DELETE CASCADE,
  source_session_id INTEGER REFERENCES sys_ai_chat_session(id) ON DELETE SET NULL,
  source_message_id INTEGER REFERENCES sys_ai_chat_message(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 80,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'rejected', 'merged', 'expired')),
  conflict_group TEXT,
  embedding_json TEXT,
  merged_memory_id INTEGER REFERENCES sys_ai_memory(id) ON DELETE SET NULL,
  rejection_reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sys_ai_memory_candidate_user_status_idx
  ON sys_ai_memory_candidate(user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS sys_ai_memory_candidate_key_idx
  ON sys_ai_memory_candidate(user_id, normalized_key);

CREATE TABLE IF NOT EXISTS sys_ai_runtime_skill_version (
  id SERIAL PRIMARY KEY,
  skill_id INTEGER NOT NULL REFERENCES sys_ai_runtime_skill(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  instructions TEXT NOT NULL,
  tool_ids_json TEXT NOT NULL DEFAULT '[]',
  agent_ids_json TEXT NOT NULL DEFAULT '[]',
  compatibility_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  published_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(skill_id, version)
);
CREATE INDEX IF NOT EXISTS sys_ai_runtime_skill_version_status_idx
  ON sys_ai_runtime_skill_version(skill_id, status);

ALTER TABLE sys_ai_mcp_connection ADD COLUMN IF NOT EXISTS revoke_url TEXT;
ALTER TABLE sys_ai_mcp_connection ADD COLUMN IF NOT EXISTS remote_session_id TEXT;
ALTER TABLE sys_ai_mcp_connection ADD COLUMN IF NOT EXISTS capabilities_json TEXT;
ALTER TABLE sys_ai_mcp_connection ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE sys_ai_mcp_server ADD COLUMN IF NOT EXISTS revoke_url TEXT;
ALTER TABLE sys_ai_mcp_tool ADD COLUMN IF NOT EXISTS schema_hash TEXT;
ALTER TABLE sys_ai_mcp_tool ADD COLUMN IF NOT EXISTS lifecycle TEXT NOT NULL DEFAULT 'discovered';
ALTER TABLE sys_ai_mcp_tool ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;
ALTER TABLE sys_ai_mcp_tool ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE sys_ai_mcp_tool DROP CONSTRAINT IF EXISTS sys_ai_mcp_tool_lifecycle_check;
ALTER TABLE sys_ai_mcp_tool ADD CONSTRAINT sys_ai_mcp_tool_lifecycle_check
  CHECK (lifecycle IN ('discovered', 'approved', 'active', 'stale', 'revoked'));
CREATE TABLE IF NOT EXISTS sys_ai_mcp_tool_version (
  id SERIAL PRIMARY KEY,
  tool_id INTEGER NOT NULL REFERENCES sys_ai_mcp_tool(id) ON DELETE CASCADE,
  schema_hash TEXT NOT NULL,
  input_schema_json TEXT,
  description TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tool_id, schema_hash)
);
CREATE INDEX IF NOT EXISTS sys_ai_mcp_tool_version_tool_idx
  ON sys_ai_mcp_tool_version(tool_id, discovered_at DESC);
CREATE TABLE IF NOT EXISTS sys_ai_mcp_session (
  id SERIAL PRIMARY KEY,
  server_id INTEGER NOT NULL REFERENCES sys_ai_mcp_server(id) ON DELETE CASCADE,
  connection_id INTEGER REFERENCES sys_ai_mcp_connection(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES sys_user(id) ON DELETE CASCADE,
  remote_session_id TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'closed')),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(server_id, user_id)
);
CREATE INDEX IF NOT EXISTS sys_ai_mcp_session_status_idx
  ON sys_ai_mcp_session(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS sys_ai_progress_event (
  id SERIAL PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  run_id INTEGER,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sys_ai_progress_event_resource_idx
  ON sys_ai_progress_event(resource_type, resource_id, id);
CREATE INDEX IF NOT EXISTS sys_ai_progress_event_run_idx
  ON sys_ai_progress_event(run_id, id);

CREATE TABLE IF NOT EXISTS sys_ai_workflow_definition (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'disabled')),
  current_version INTEGER,
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER
);
CREATE INDEX IF NOT EXISTS sys_ai_workflow_definition_status_idx
  ON sys_ai_workflow_definition(status, updated_at DESC);
CREATE TABLE IF NOT EXISTS sys_ai_workflow_definition_version (
  id SERIAL PRIMARY KEY,
  definition_id INTEGER NOT NULL REFERENCES sys_ai_workflow_definition(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  graph_json TEXT NOT NULL,
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  compatibility_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  published_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(definition_id, version)
);
CREATE INDEX IF NOT EXISTS sys_ai_workflow_definition_version_status_idx
  ON sys_ai_workflow_definition_version(definition_id, status);
`,
  },
  {
    id: "0054_ai_visual_workflow_tables",
    sql: `
-- 0053 was already applied in some development databases before the visual
-- Workflow tables were added to that migration. Keep this repair additive so
-- existing databases converge without rewriting migration history.
CREATE TABLE IF NOT EXISTS sys_ai_workflow_definition (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'disabled')),
  current_version INTEGER,
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER
);
CREATE INDEX IF NOT EXISTS sys_ai_workflow_definition_status_idx
  ON sys_ai_workflow_definition(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS sys_ai_workflow_definition_version (
  id SERIAL PRIMARY KEY,
  definition_id INTEGER NOT NULL REFERENCES sys_ai_workflow_definition(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  graph_json TEXT NOT NULL,
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  compatibility_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  published_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(definition_id, version)
);
CREATE INDEX IF NOT EXISTS sys_ai_workflow_definition_version_status_idx
  ON sys_ai_workflow_definition_version(definition_id, status);
`,
  },
  {
    id: "0055_ai_image_workflow_tool",
    sql: `
INSERT INTO sys_ai_tool
  (name, code, description, handler_key, input_schema_json, risk_level,
   approval_required, status, sort, is_system)
VALUES
  ('图片创意改造', 'image-transform',
   '读取有权限的图片，调用已配置的 Image Provider 生成改造结果并保存为新文件',
   'image_transform',
   '{"fileId":"number","instruction":"string","modelId":"number?","size":"string?","style":"string?"}',
   'medium', false, 1, 8, true)
ON CONFLICT (code) WHERE deleted_at IS NULL DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  handler_key = EXCLUDED.handler_key,
  input_schema_json = EXCLUDED.input_schema_json,
  risk_level = EXCLUDED.risk_level,
  approval_required = EXCLUDED.approval_required,
  status = EXCLUDED.status,
  sort = EXCLUDED.sort,
  is_system = EXCLUDED.is_system,
  updated_at = now();

INSERT INTO sys_ai_agent_tool (agent_id, tool_id, approval_mode)
SELECT agent.id, tool.id, 'never'
FROM sys_ai_agent agent CROSS JOIN sys_ai_tool tool
WHERE agent.code = 'general-assistant'
  AND agent.deleted_at IS NULL
  AND tool.code = 'image-transform'
  AND tool.deleted_at IS NULL
ON CONFLICT (agent_id, tool_id) DO UPDATE SET approval_mode = 'never';

INSERT INTO sys_ai_workflow_definition
  (code, name, description, status, current_version)
VALUES
  ('funny-image-transform', '搞怪图片生成器',
   '上传图片后，按要求调用受控 Image Tool 生成一张新的搞怪图片；原图不会被覆盖。',
   'draft', 1)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  current_version = COALESCE(sys_ai_workflow_definition.current_version, EXCLUDED.current_version),
  updated_at = now();

INSERT INTO sys_ai_workflow_definition_version
  (definition_id, version, graph_json, input_schema_json, output_schema_json,
   compatibility_json, status)
SELECT
  definition.id,
  1,
  '{
    "nodes": [
      {"id":"input","type":"input","position":{"x":80,"y":180},"data":{"label":"图片输入"}},
      {"id":"args","type":"mapping","position":{"x":300,"y":180},"data":{"label":"生成参数","mapConfig":{"fileId":{"initData":true,"path":"fileId"},"instruction":{"initData":true,"path":"instruction"},"modelId":{"initData":true,"path":"modelId"},"size":{"initData":true,"path":"size"},"style":{"initData":true,"path":"style"}}}},
      {"id":"transform","type":"tool","position":{"x":560,"y":180},"data":{"label":"图片创意改造","toolId":"image-transform"}},
      {"id":"output","type":"output","position":{"x":820,"y":180},"data":{"label":"生成结果"}}
    ],
    "edges": [
      {"id":"input-args","source":"input","target":"args"},
      {"id":"args-transform","source":"args","target":"transform"},
      {"id":"transform-output","source":"transform","target":"output"}
    ]
  }',
  '{"type":"object","required":["fileId","instruction"]}',
  '{"type":"object","required":["fileId","url"]}',
  '{"requires":"active-image-provider-and-model","tool":"image_transform"}',
  'draft'
FROM sys_ai_workflow_definition definition
WHERE definition.code = 'funny-image-transform'
ON CONFLICT (definition_id, version) DO NOTHING;
`,
  },
  {
    id: "0056_ai_image_workflow_draft_pointer",
    sql: `
UPDATE sys_ai_workflow_definition definition
SET current_version = 1,
    updated_at = now()
WHERE definition.code = 'funny-image-transform'
  AND definition.status = 'draft'
  AND definition.current_version IS NULL
  AND EXISTS (
    SELECT 1 FROM sys_ai_workflow_definition_version version
    WHERE version.definition_id = definition.id AND version.version = 1
  );
    `,
  },
  {
    id: "0057_ai_image_workflow_schemas",
    sql: `
UPDATE sys_ai_workflow_definition_version version
SET input_schema_json = '{
  "type": "object",
  "title": "搞怪图片输入",
  "required": ["fileId", "instruction"],
  "properties": {
    "fileId": {"type":"number","title":"原图","x-input":"image","description":"上传需要改造的图片"},
    "instruction": {"type":"string","title":"改造指令","description":"描述希望图片变成什么样"},
    "size": {"type":"string","title":"输出尺寸","default":"1024x1024"},
    "style": {"type":"string","title":"风格","default":"cartoon"}
  }
}',
    output_schema_json = '{
  "type": "object",
  "title": "图片生成结果",
  "required": ["fileId", "url"],
  "properties": {
    "fileId": {"type":"number","title":"结果文件 ID"},
    "url": {"type":"string","format":"uri","title":"结果图片"},
    "sourceFileId": {"type":"number","title":"原图文件 ID"}
  }
}'
WHERE version.definition_id = (SELECT definition.id FROM sys_ai_workflow_definition definition WHERE definition.code = 'funny-image-transform')
  AND version.version = 1;

UPDATE sys_ai_workflow_definition_version version
SET graph_json = jsonb_set(
  jsonb_set(
    version.graph_json::jsonb,
    '{nodes,0,data}',
    '{"label":"图片输入","type":"input","schema":{"type":"object","title":"搞怪图片输入","required":["fileId","instruction"],"properties":{"fileId":{"type":"number","title":"原图","x-input":"image","description":"上传需要改造的图片"},"instruction":{"type":"string","title":"改造指令","description":"描述希望图片变成什么样"},"size":{"type":"string","title":"输出尺寸","default":"1024x1024"},"style":{"type":"string","title":"风格","default":"cartoon"}}}}'::jsonb,
    true
  ),
  '{nodes,3,data}',
  '{"label":"生成结果","type":"output","schema":{"type":"object","title":"图片生成结果","required":["fileId","url"],"properties":{"fileId":{"type":"number","title":"结果文件 ID"},"url":{"type":"string","format":"uri","title":"结果图片"},"sourceFileId":{"type":"number","title":"原图文件 ID"}}}}'::jsonb,
  true
)
WHERE version.definition_id = (SELECT definition.id FROM sys_ai_workflow_definition definition WHERE definition.code = 'funny-image-transform')
  AND version.version = 1;
`,
  },
  {
    id: "0058_ai_image_workflow_complete_template",
    sql: `
UPDATE sys_ai_workflow_definition_version version
SET input_schema_json = '{
  "type":"object",
  "title":"搞怪图片输入",
  "required":["fileId","instruction"],
  "properties":{
    "fileId":{"type":"number","title":"原图","x-input":"image","description":"上传需要改造的图片"},
    "instruction":{"type":"string","title":"改造指令","description":"描述希望图片变成什么样"},
    "size":{"type":"string","title":"输出尺寸","default":"1024x1024"},
    "style":{"type":"string","title":"风格","default":"cartoon"}
  }
}',
    output_schema_json = '{
  "type":"object",
  "title":"图片生成结果",
  "required":["fileId","url"],
  "properties":{
    "fileId":{"type":"number","title":"结果文件 ID"},
    "url":{"type":"string","format":"uri","title":"结果图片"},
    "sourceFileId":{"type":"number","title":"原图文件 ID"}
  }
}',
    graph_json = jsonb_set(
      version.graph_json::jsonb,
      '{nodes}',
      (
        SELECT jsonb_agg(
          CASE node->>'id'
            WHEN 'input' THEN node || jsonb_build_object(
              'type', 'input',
              'data', (node->'data') || jsonb_build_object(
                'label', '图片输入',
                'type', 'input',
                'description', '接收一张图片和改造要求',
                'schema', '{"type":"object","title":"搞怪图片输入","required":["fileId","instruction"],"properties":{"fileId":{"type":"number","title":"原图","x-input":"image","description":"上传需要改造的图片"},"instruction":{"type":"string","title":"改造指令","description":"描述希望图片变成什么样"},"size":{"type":"string","title":"输出尺寸","default":"1024x1024"},"style":{"type":"string","title":"风格","default":"cartoon"}}}'::jsonb
              )
            )
            WHEN 'args' THEN node || jsonb_build_object(
              'type', 'mapping',
              'data', (node->'data') || jsonb_build_object(
                'label', '生成参数',
                'type', 'mapping',
                'description', '把输入 Schema 映射成图片 Tool 的参数',
                'mapConfig', '{"fileId":{"initData":true,"path":"fileId"},"instruction":{"initData":true,"path":"instruction"},"size":{"initData":true,"path":"size"},"style":{"initData":true,"path":"style"}}'::jsonb
              )
            )
            WHEN 'transform' THEN node || jsonb_build_object(
              'type', 'tool',
              'data', (node->'data') || jsonb_build_object(
                'label', '图片创意改造',
                'type', 'tool',
                'toolId', 'image-transform',
                'modelSelection', 'active',
                'description', '使用当前启用的 Image Model 生成新图片'
              )
            )
            WHEN 'output' THEN node || jsonb_build_object(
              'type', 'output',
              'data', (node->'data') || jsonb_build_object(
                'label', '生成结果',
                'type', 'output',
                'description', '返回新图片文件 ID、URL 和原图文件 ID',
                'schema', '{"type":"object","title":"图片生成结果","required":["fileId","url"],"properties":{"fileId":{"type":"number","title":"结果文件 ID"},"url":{"type":"string","format":"uri","title":"结果图片"},"sourceFileId":{"type":"number","title":"原图文件 ID"}}}'::jsonb
              )
            )
            ELSE node
          END ORDER BY node_order
        )
        FROM jsonb_array_elements(version.graph_json::jsonb->'nodes') WITH ORDINALITY AS item(node, node_order)
      ),
      true
    )
WHERE version.definition_id = (SELECT definition.id FROM sys_ai_workflow_definition definition WHERE definition.code = 'funny-image-transform')
  AND version.version = 1
  AND version.status = 'draft';
`,
  },
  {
    id: "0059_ai_image_workflow_refresh_current_draft",
    sql: `
INSERT INTO sys_ai_workflow_definition_version
  (definition_id, version, graph_json, input_schema_json, output_schema_json, compatibility_json, status)
SELECT
  definition.id,
  COALESCE(MAX(version.version), 0) + 1,
  '{
    "nodes": [
      {"id":"input","type":"input","position":{"x":80,"y":180},"data":{"label":"图片输入","type":"input","description":"接收一张图片和改造要求","schema":{"type":"object","title":"搞怪图片输入","required":["fileId","instruction"],"properties":{"fileId":{"type":"number","title":"原图","x-input":"image","description":"上传需要改造的图片"},"instruction":{"type":"string","title":"改造指令","description":"描述希望图片变成什么样"},"size":{"type":"string","title":"输出尺寸","default":"1024x1024"},"style":{"type":"string","title":"风格","default":"cartoon"}}}}},
      {"id":"args","type":"mapping","position":{"x":400,"y":180},"data":{"label":"生成参数","type":"mapping","description":"把输入 Schema 映射成图片 Tool 的参数","mapConfig":{"fileId":{"initData":true,"path":"fileId"},"instruction":{"initData":true,"path":"instruction"},"size":{"initData":true,"path":"size"},"style":{"initData":true,"path":"style"}}}},
      {"id":"transform","type":"tool","position":{"x":720,"y":180},"data":{"label":"图片创意改造","type":"tool","toolId":"image-transform","modelSelection":"active","description":"使用当前启用的 Image Model 生成新图片"}},
      {"id":"output","type":"output","position":{"x":1040,"y":180},"data":{"label":"生成结果","type":"output","description":"返回新图片文件 ID、URL 和原图文件 ID","schema":{"type":"object","title":"图片生成结果","required":["fileId","url"],"properties":{"fileId":{"type":"number","title":"结果文件 ID"},"url":{"type":"string","format":"uri","title":"结果图片"},"sourceFileId":{"type":"number","title":"原图文件 ID"}}}}}
    ],
    "edges": [
      {"id":"input-args","source":"input","target":"args"},
      {"id":"args-transform","source":"args","target":"transform"},
      {"id":"transform-output","source":"transform","target":"output"}
    ]
  }',
  '{"type":"object","title":"搞怪图片输入","required":["fileId","instruction"],"properties":{"fileId":{"type":"number","title":"原图","x-input":"image"},"instruction":{"type":"string","title":"改造指令"},"size":{"type":"string","title":"输出尺寸","default":"1024x1024"},"style":{"type":"string","title":"风格","default":"cartoon"}}}',
  '{"type":"object","title":"图片生成结果","required":["fileId","url"],"properties":{"fileId":{"type":"number","title":"结果文件 ID"},"url":{"type":"string","format":"uri","title":"结果图片"},"sourceFileId":{"type":"number","title":"原图文件 ID"}}}',
  '{"requires":"active-image-provider-and-model","tool":"image_transform","template":"fully-configured-funny-image-transform"}',
  'draft'
FROM sys_ai_workflow_definition definition
LEFT JOIN sys_ai_workflow_definition_version version ON version.definition_id = definition.id
WHERE definition.code = 'funny-image-transform'
  AND NOT EXISTS (
    SELECT 1 FROM sys_ai_workflow_definition_version existing
    WHERE existing.definition_id = definition.id
      AND existing.compatibility_json LIKE '%fully-configured-funny-image-transform%'
  )
GROUP BY definition.id;

UPDATE sys_ai_workflow_definition definition
SET status = 'draft',
    current_version = (
      SELECT version.version
      FROM sys_ai_workflow_definition_version version
      WHERE version.definition_id = definition.id
        AND version.compatibility_json LIKE '%fully-configured-funny-image-transform%'
      ORDER BY version.version DESC
      LIMIT 1
    ),
    updated_at = now()
WHERE definition.code = 'funny-image-transform'
  AND EXISTS (
    SELECT 1 FROM sys_ai_workflow_definition_version version
    WHERE version.definition_id = definition.id
      AND version.compatibility_json LIKE '%fully-configured-funny-image-transform%'
  );
`,
  },
  {
    id: "0060_ai_visual_workflow_examples",
    sql: `
INSERT INTO sys_ai_workflow_definition
  (code, name, description, status, current_version)
VALUES
  ('demo-customer-priority-routing', '客户优先级路由', '根据客户等级执行第一个命中的处理分支，演示条件判断与默认分支。', 'published', 1),
  ('demo-parallel-system-snapshot', '并行系统快照', '同时读取当前时间和管理员有权查看的系统指标，演示并行执行与结果汇总。', 'published', 1),
  ('demo-foreach-batch-calculation', '批量计算任务', '以受控并发遍历表达式数组，演示 Foreach 的逐项执行和顺序汇总。', 'published', 1),
  ('demo-loop-until-result', '循环直到得到结果', '重复调用计算器并检查声明式停止条件，演示 Loop 与 20 次安全上限。', 'published', 1),
  ('demo-delayed-notification', '延迟处理通知', '等待短暂时间后组装处理结果，演示 Sleep 节点和后续字段映射。', 'published', 1),
  ('demo-ai-parallel-review', 'AI 并行双视角评审', '让两个 Agent 分支并行评审同一段内容；发布运行前需要配置可用的 Chat Provider 和模型。', 'draft', 1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO sys_ai_workflow_definition_version
  (definition_id, version, graph_json, input_schema_json, output_schema_json,
   compatibility_json, status, published_at)
SELECT definition.id, 1, example.graph_json, example.input_schema_json,
  example.output_schema_json, example.compatibility_json, example.version_status,
  CASE WHEN example.version_status = 'published' THEN now() ELSE NULL END
FROM sys_ai_workflow_definition definition
INNER JOIN (VALUES
  (
    'demo-customer-priority-routing',
    $graph$ {"nodes":[{"id":"input","type":"input","position":{"x":80,"y":180},"data":{"label":"客户请求","type":"input","description":"输入客户等级和计算表达式","schema":{"type":"object","title":"客户路由输入","required":["route","expression"],"properties":{"route":{"type":"string","title":"客户等级","description":"输入 high 进入高优先级分支","default":"high"},"expression":{"type":"string","title":"报价表达式","default":"1200*0.92"}}}}},{"id":"route","type":"condition","position":{"x":420,"y":180},"data":{"label":"判断客户优先级","type":"condition","description":"从上到下判断，执行第一个命中的分支","children":[{"type":"tool","id":"high-priority","label":"高优先级客户","toolId":"calculator","predicate":{"op":"eq","left":{"path":"inputData.route"},"right":{"literal":"high"}}},{"type":"tool","id":"default-route","label":"默认处理","toolId":"calculator","isDefault":true}]}},{"id":"output","type":"output","position":{"x":800,"y":180},"data":{"label":"路由结果","type":"output","description":"返回被选中分支的计算结果"}}],"edges":[{"id":"input-route","source":"input","target":"route"},{"id":"route-output","source":"route","target":"output"}]}$graph$,
    $schema$ {"type":"object","title":"客户路由输入","required":["route","expression"],"properties":{"route":{"type":"string","title":"客户等级","default":"high"},"expression":{"type":"string","title":"报价表达式","default":"1200*0.92"}}}$schema$,
    $schema$ {"type":"object","title":"计算结果"}$schema$,
    $compat$ {"template":"condition-with-default","requires":[],"runtime":"deterministic"}$compat$,
    'published'
  ),
  (
    'demo-parallel-system-snapshot',
    $graph$ {"nodes":[{"id":"input","type":"input","position":{"x":80,"y":180},"data":{"label":"快照请求","type":"input","description":"触发一次系统快照","schema":{"type":"object","title":"系统快照输入","properties":{"scope":{"type":"string","title":"快照范围","default":"overview"}}}}},{"id":"parallel","type":"parallel","position":{"x":420,"y":180},"data":{"label":"并行读取系统信息","type":"parallel","description":"两个任务同时开始，全部完成后合并结果","children":[{"type":"tool","id":"clock","label":"读取当前时间","toolId":"current-time"},{"type":"tool","id":"health","label":"读取系统状态","toolId":"system-status"}]}},{"id":"output","type":"output","position":{"x":800,"y":180},"data":{"label":"系统快照","type":"output","description":"按分支 key 返回时间和系统指标"}}],"edges":[{"id":"input-parallel","source":"input","target":"parallel"},{"id":"parallel-output","source":"parallel","target":"output"}]}$graph$,
    $schema$ {"type":"object","title":"系统快照输入","properties":{"scope":{"type":"string","title":"快照范围","default":"overview"}}}$schema$,
    $schema$ {"type":"object","title":"并行结果"}$schema$,
    $compat$ {"template":"parallel-tools","requires":["system-status abilities"],"runtime":"deterministic"}$compat$,
    'published'
  ),
  (
    'demo-foreach-batch-calculation',
    $graph$ {"nodes":[{"id":"input","type":"input","position":{"x":80,"y":180},"data":{"label":"表达式列表","type":"input","description":"输入任意数量的计算任务","schema":{"type":"array","title":"批量表达式","default":[{"expression":"12*3"},{"expression":"99/3"},{"expression":"(18+6)*2"}],"items":{"type":"object","required":["expression"],"properties":{"expression":{"type":"string"}}}}}},{"id":"foreach","type":"foreach","position":{"x":420,"y":180},"data":{"label":"并发遍历计算","type":"foreach","description":"最多 3 项同时执行，返回顺序与输入一致","concurrency":3,"body":{"type":"tool","id":"calculate-item","label":"计算当前表达式","toolId":"calculator"}}},{"id":"output","type":"output","position":{"x":800,"y":180},"data":{"label":"批量结果","type":"output","description":"返回每个表达式对应的结果数组"}}],"edges":[{"id":"input-foreach","source":"input","target":"foreach"},{"id":"foreach-output","source":"foreach","target":"output"}]}$graph$,
    $schema$ {"type":"array","title":"批量表达式","default":[{"expression":"12*3"},{"expression":"99/3"},{"expression":"(18+6)*2"}],"items":{"type":"object","required":["expression"],"properties":{"expression":{"type":"string"}}}}$schema$,
    $schema$ {"type":"array","title":"批量计算结果"}$schema$,
    $compat$ {"template":"foreach-concurrency","requires":[],"runtime":"deterministic"}$compat$,
    'published'
  ),
  (
    'demo-loop-until-result',
    $graph$ {"nodes":[{"id":"input","type":"input","position":{"x":80,"y":180},"data":{"label":"循环输入","type":"input","description":"输入一个待计算表达式","schema":{"type":"object","title":"循环计算输入","required":["expression"],"properties":{"expression":{"type":"string","title":"表达式","default":"21*2"}}}}},{"id":"loop","type":"loop","position":{"x":420,"y":180},"data":{"label":"计算直到结果存在","type":"loop","description":"先执行循环体，再检查 result 是否有值","loopType":"dountil","body":{"type":"tool","id":"calculate","label":"执行计算","toolId":"calculator"},"predicate":{"op":"truthy","value":{"path":"inputData.result"}}}},{"id":"output","type":"output","position":{"x":800,"y":180},"data":{"label":"循环结果","type":"output","description":"返回最后一次循环体输出"}}],"edges":[{"id":"input-loop","source":"input","target":"loop"},{"id":"loop-output","source":"loop","target":"output"}]}$graph$,
    $schema$ {"type":"object","title":"循环计算输入","required":["expression"],"properties":{"expression":{"type":"string","title":"表达式","default":"21*2"}}}$schema$,
    $schema$ {"type":"object","title":"循环结果"}$schema$,
    $compat$ {"template":"loop-until-predicate","maxIterations":20,"requires":[],"runtime":"deterministic"}$compat$,
    'published'
  ),
  (
    'demo-delayed-notification',
    $graph$ {"nodes":[{"id":"input","type":"input","position":{"x":80,"y":180},"data":{"label":"通知内容","type":"input","description":"输入需要延迟处理的消息","schema":{"type":"object","title":"延迟通知输入","required":["message"],"properties":{"message":{"type":"string","title":"消息内容","default":"订单已进入处理队列"}}}}},{"id":"wait","type":"sleep","position":{"x":360,"y":180},"data":{"label":"等待 800 毫秒","type":"sleep","description":"暂停当前流程后继续，不阻塞其他并行分支","duration":800}},{"id":"result","type":"mapping","position":{"x":640,"y":180},"data":{"label":"组装通知结果","type":"mapping","description":"从初始输入读取消息并标记完成","mapConfig":{"status":{"value":"completed"},"message":{"initData":true,"path":"message"}}}},{"id":"output","type":"output","position":{"x":940,"y":180},"data":{"label":"通知结果","type":"output","description":"返回延迟处理状态和原消息"}}],"edges":[{"id":"input-wait","source":"input","target":"wait"},{"id":"wait-result","source":"wait","target":"result"},{"id":"result-output","source":"result","target":"output"}]}$graph$,
    $schema$ {"type":"object","title":"延迟通知输入","required":["message"],"properties":{"message":{"type":"string","title":"消息内容","default":"订单已进入处理队列"}}}$schema$,
    $schema$ {"type":"object","title":"延迟通知结果","properties":{"status":{"type":"string"},"message":{"type":"string"}}}$schema$,
    $compat$ {"template":"sleep-and-map","maxInlineSleepMs":86400000,"requires":[],"runtime":"deterministic"}$compat$,
    'published'
  ),
  (
    'demo-ai-parallel-review',
    $graph$ {"nodes":[{"id":"input","type":"input","position":{"x":80,"y":180},"data":{"label":"待评审内容","type":"input","description":"输入需要从两个视角评审的文本","schema":{"type":"object","title":"AI 并行评审输入","required":["prompt"],"properties":{"prompt":{"type":"string","title":"评审内容","description":"例如一段产品方案或客户跟进计划","default":"评审这份 CRM 客户唤醒方案，指出风险和可执行改进。"}}}}},{"id":"parallel","type":"parallel","position":{"x":420,"y":180},"data":{"label":"双视角并行评审","type":"parallel","description":"两个 Agent 分支并行处理同一份输入","children":[{"type":"agent","id":"risk-review","label":"风险视角","agentId":"1"},{"type":"agent","id":"action-review","label":"执行视角","agentId":"1"}]}},{"id":"output","type":"output","position":{"x":800,"y":180},"data":{"label":"评审意见","type":"output","description":"按分支返回两份独立评审结果"}}],"edges":[{"id":"input-parallel","source":"input","target":"parallel"},{"id":"parallel-output","source":"parallel","target":"output"}]}$graph$,
    $schema$ {"type":"object","title":"AI 并行评审输入","required":["prompt"],"properties":{"prompt":{"type":"string","title":"评审内容","default":"评审这份 CRM 客户唤醒方案，指出风险和可执行改进。"}}}$schema$,
    $schema$ {"type":"object","title":"AI 并行评审结果"}$schema$,
    $compat$ {"template":"parallel-agents","requires":["enabled chat provider","enabled chat model","general-assistant model binding"],"runtime":"ai-sdk-7"}$compat$,
    'draft'
  )
) AS example(code, graph_json, input_schema_json, output_schema_json, compatibility_json, version_status)
  ON example.code = definition.code
WHERE NOT EXISTS (
  SELECT 1 FROM sys_ai_workflow_definition_version existing
  WHERE existing.definition_id = definition.id AND existing.version = 1
);
`,
  },
  {
    id: "0061_ai_workflow_runtime_nodes",
    sql: `
ALTER TABLE sys_ai_workflow_run
  ADD COLUMN IF NOT EXISTS definition_id INTEGER REFERENCES sys_ai_workflow_definition(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS continuation_json TEXT;

CREATE INDEX IF NOT EXISTS sys_ai_workflow_run_definition_idx
  ON sys_ai_workflow_run(definition_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS sys_ai_workflow_wait (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES sys_ai_workflow_run(id) ON DELETE CASCADE,
  step_id INTEGER REFERENCES sys_ai_workflow_run_step(id) ON DELETE SET NULL,
  node_id TEXT NOT NULL,
  wait_type TEXT NOT NULL CHECK (wait_type IN ('approval', 'event', 'timer')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'resolved', 'expired', 'cancelled')),
  correlation_key TEXT,
  input_json TEXT,
  resolution_json TEXT,
  resume_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ,
  decided_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_workflow_wait_run_node_pending_unique
  ON sys_ai_workflow_wait(run_id, node_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS sys_ai_workflow_wait_status_resume_idx
  ON sys_ai_workflow_wait(status, resume_at);
CREATE INDEX IF NOT EXISTS sys_ai_workflow_wait_correlation_idx
  ON sys_ai_workflow_wait(correlation_key, status);

DROP TRIGGER IF EXISTS trg_sys_ai_workflow_wait_updated_at ON sys_ai_workflow_wait;
CREATE TRIGGER trg_sys_ai_workflow_wait_updated_at
BEFORE UPDATE ON sys_ai_workflow_wait
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
`,
  },
  {
    id: "0062_ai_workflow_parent_child_resume",
    sql: `
ALTER TABLE sys_ai_workflow_run
  ADD COLUMN IF NOT EXISTS parent_run_id INTEGER,
  ADD COLUMN IF NOT EXISTS parent_node_id TEXT,
  ADD COLUMN IF NOT EXISTS call_depth INTEGER NOT NULL DEFAULT 0;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sys_ai_workflow_run_parent_fk'
  ) THEN
    ALTER TABLE sys_ai_workflow_run
      ADD CONSTRAINT sys_ai_workflow_run_parent_fk
      FOREIGN KEY (parent_run_id) REFERENCES sys_ai_workflow_run(id) ON DELETE SET NULL;
  END IF;
END
$migration$;

CREATE INDEX IF NOT EXISTS sys_ai_workflow_run_parent_idx
  ON sys_ai_workflow_run(parent_run_id, status, created_at DESC);

ALTER TABLE sys_ai_workflow_wait
  ADD COLUMN IF NOT EXISTS child_run_id INTEGER REFERENCES sys_ai_workflow_run(id) ON DELETE SET NULL;

ALTER TABLE sys_ai_workflow_wait
  DROP CONSTRAINT IF EXISTS sys_ai_workflow_wait_wait_type_check;
ALTER TABLE sys_ai_workflow_wait
  ADD CONSTRAINT sys_ai_workflow_wait_wait_type_check
  CHECK (wait_type IN ('approval', 'event', 'timer', 'child_workflow'));

CREATE UNIQUE INDEX IF NOT EXISTS sys_ai_workflow_wait_child_pending_unique
  ON sys_ai_workflow_wait(child_run_id)
  WHERE child_run_id IS NOT NULL AND status = 'pending';
`,
  },
  {
    id: "0063_saas_tenant_workspace_foundation",
    sql: `
CREATE TABLE IF NOT EXISTS saas_tenant (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT 'global',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  retention_days INTEGER NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 1 AND 3650),
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  deleted_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS saas_tenant_code_active_unique
  ON saas_tenant(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS saas_tenant_status_created_idx
  ON saas_tenant(status, created_at DESC);

CREATE TABLE IF NOT EXISTS saas_workspace (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES saas_tenant(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  deleted_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS saas_workspace_tenant_code_active_unique
  ON saas_workspace(tenant_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS saas_workspace_tenant_status_idx
  ON saas_workspace(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS saas_tenant_member (
  tenant_id INTEGER NOT NULL REFERENCES saas_tenant(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS saas_tenant_member_user_status_idx
  ON saas_tenant_member(user_id, status, tenant_id);

CREATE TABLE IF NOT EXISTS saas_workspace_member (
  workspace_id INTEGER NOT NULL REFERENCES saas_workspace(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES sys_user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'reviewer', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS saas_workspace_member_user_status_idx
  ON saas_workspace_member(user_id, status, workspace_id);

DROP TRIGGER IF EXISTS trg_saas_tenant_updated_at ON saas_tenant;
CREATE TRIGGER trg_saas_tenant_updated_at
BEFORE UPDATE ON saas_tenant
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_saas_workspace_updated_at ON saas_workspace;
CREATE TRIGGER trg_saas_workspace_updated_at
BEFORE UPDATE ON saas_workspace
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO saas_tenant (name, code, region, status, retention_days, is_system)
VALUES ('默认租户', 'default', 'global', 'active', 365, true)
ON CONFLICT (code) WHERE deleted_at IS NULL DO NOTHING;

INSERT INTO saas_workspace (tenant_id, name, code, description, status, is_system)
SELECT id, '默认工作区', 'default', '现有单组织数据的兼容工作区', 'active', true
FROM saas_tenant WHERE code = 'default' AND deleted_at IS NULL
ON CONFLICT (tenant_id, code) WHERE deleted_at IS NULL DO NOTHING;

INSERT INTO saas_tenant_member (tenant_id, user_id, role, status, created_by)
SELECT tenant.id, app_user.id, CASE WHEN app_user.id = 1 THEN 'owner' ELSE 'member' END,
       'active', 1
FROM saas_tenant tenant CROSS JOIN sys_user app_user
WHERE tenant.code = 'default' AND tenant.deleted_at IS NULL AND app_user.deleted_at IS NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;

INSERT INTO saas_workspace_member (workspace_id, user_id, role, status, created_by)
SELECT workspace.id, app_user.id, CASE WHEN app_user.id = 1 THEN 'owner' ELSE 'viewer' END,
       'active', 1
FROM saas_workspace workspace
INNER JOIN saas_tenant tenant ON tenant.id = workspace.tenant_id AND tenant.code = 'default'
CROSS JOIN sys_user app_user
WHERE workspace.code = 'default' AND workspace.deleted_at IS NULL AND app_user.deleted_at IS NULL
ON CONFLICT (workspace_id, user_id) DO NOTHING;
`,
  },
  {
    id: "0064_saas_membership_and_entitlements",
    sql: `
CREATE TABLE IF NOT EXISTS saas_invitation (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES saas_tenant(id) ON DELETE CASCADE,
  workspace_id INTEGER REFERENCES saas_workspace(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  tenant_role TEXT NOT NULL DEFAULT 'member' CHECK (tenant_role IN ('admin', 'member', 'viewer')),
  workspace_role TEXT CHECK (workspace_role IN ('editor', 'reviewer', 'viewer')),
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  CHECK ((workspace_id IS NULL AND workspace_role IS NULL) OR
         (workspace_id IS NOT NULL AND workspace_role IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS saas_invitation_token_hash_unique
  ON saas_invitation(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS saas_invitation_tenant_email_pending_unique
  ON saas_invitation(tenant_id, email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS saas_invitation_tenant_status_created_idx
  ON saas_invitation(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS saas_invitation_email_status_idx
  ON saas_invitation(email, status);

CREATE TABLE IF NOT EXISTS saas_module (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '0.1.0',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled', 'retired')),
  route_key TEXT NOT NULL,
  route_path TEXT NOT NULL,
  required_ability TEXT NOT NULL,
  dependencies_json TEXT NOT NULL DEFAULT '[]',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  deleted_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS saas_module_code_active_unique
  ON saas_module(code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS saas_module_route_key_active_unique
  ON saas_module(route_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS saas_module_status_created_idx
  ON saas_module(status, created_at DESC);

CREATE TABLE IF NOT EXISTS saas_tenant_entitlement (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES saas_tenant(id) ON DELETE CASCADE,
  module_id INTEGER NOT NULL REFERENCES saas_module(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'suspended', 'expired')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'trial', 'plan')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  member_limit_override INTEGER CHECK (member_limit_override IS NULL OR member_limit_override >= 1),
  monthly_task_limit_override INTEGER CHECK (monthly_task_limit_override IS NULL OR monthly_task_limit_override >= 0),
  max_concurrent_task_override INTEGER CHECK (max_concurrent_task_override IS NULL OR max_concurrent_task_override >= 1),
  export_profile_override TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL,
  deleted_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS saas_tenant_entitlement_tenant_module_active_unique
  ON saas_tenant_entitlement(tenant_id, module_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS saas_tenant_entitlement_tenant_status_idx
  ON saas_tenant_entitlement(tenant_id, status, expires_at);
CREATE INDEX IF NOT EXISTS saas_tenant_entitlement_module_status_idx
  ON saas_tenant_entitlement(module_id, status);

DROP TRIGGER IF EXISTS trg_saas_invitation_updated_at ON saas_invitation;
CREATE TRIGGER trg_saas_invitation_updated_at
BEFORE UPDATE ON saas_invitation
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_saas_module_updated_at ON saas_module;
CREATE TRIGGER trg_saas_module_updated_at
BEFORE UPDATE ON saas_module
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_saas_tenant_entitlement_updated_at ON saas_tenant_entitlement;
CREATE TRIGGER trg_saas_tenant_entitlement_updated_at
BEFORE UPDATE ON saas_tenant_entitlement
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO saas_module
  (code, name, version, description, status, route_key, route_path, required_ability,
   dependencies_json, capabilities_json, is_system)
VALUES
  ('novel', '小说', '0.1.0', '长文本创作与版本化交付', 'draft', 'studio.novel', '/studio/novel', 'studio.novel.query', '[]', '["text","knowledge","export"]', true),
  ('canvas', '无限画布', '0.1.0', '多模态创意组织画布', 'draft', 'studio.canvas', '/studio/canvas', 'studio.canvas.query', '[]', '["canvas","asset","version"]', true),
  ('roundtable', 'AI 圆桌会议', '0.1.0', '受控多角色讨论与纪要', 'draft', 'studio.roundtable', '/studio/roundtable', 'studio.roundtable.query', '[]', '["agent","knowledge","citation"]', true),
  ('image-story', '图片叙事', '0.1.0', '图文故事与静态视频生产', 'draft', 'studio.imageStory', '/studio/image-story', 'studio.imageStory.query', '["image","characters","assets"]', '["storyboard","image","render"]', true),
  ('reading-video', '名著阅读视频', '0.1.0', '原著到图片 TTS 字幕视频', 'draft', 'studio.readingVideo', '/studio/reading-video', 'studio.readingVideo.query', '["image","characters","assets"]', '["storyboard","tts","subtitle","ffmpeg"]', true),
  ('music-video', '歌曲 MV', '0.1.0', '歌曲与歌词驱动的 MV 生产', 'draft', 'studio.musicVideo', '/studio/music-video', 'studio.musicVideo.query', '["actors","assets"]', '["audio","timeline","video"]', true),
  ('characters', '人物中心', '0.1.0', '跨项目人物 Canon 与版本', 'draft', 'studio.character', '/studio/characters', 'studio.character.query', '[]', '["character","version","license"]', true),
  ('talk-show', 'AI 脱口秀', '0.1.0', '研究、脚本、演员和视频交付', 'draft', 'studio.talkShow', '/studio/talk-show', 'studio.talkShow.query', '["actors","assets"]', '["research","script","safety","render"]', true),
  ('lecture', '百家讲坛', '0.1.0', '来源驱动的课程与讲解交付', 'draft', 'studio.lecture', '/studio/lecture', 'studio.lecture.query', '["actors","assets"]', '["knowledge","citation","slides","render"]', true),
  ('science-explainer', '知识科普讲解', '0.1.0', 'Claim 与 Evidence 驱动的科普生产', 'draft', 'studio.science', '/studio/science-explainer', 'studio.science.query', '["actors","assets"]', '["knowledge","claim","review","render"]', true),
  ('actors', '演员库', '0.1.0', '真人与数字演员许可治理', 'draft', 'studio.actor', '/studio/actors', 'studio.actor.query', '["assets"]', '["actor","consent","license"]', true),
  ('assets', '素材/场景库', '0.1.0', '共享资产、场景、版权和血缘', 'draft', 'studio.asset', '/studio/assets', 'studio.asset.query', '[]', '["asset","scene","lineage","license"]', true),
  ('image', '画图', '0.1.0', '文生图、图生图与受控编辑', 'draft', 'studio.image', '/studio/image', 'studio.image.query', '["assets"]', '["image-generate","image-edit","upscale"]', true)
ON CONFLICT (code) WHERE deleted_at IS NULL DO NOTHING;
`,
  },
];

export async function runMigrations(client: postgres.Sql = sql) {
  await client.unsafe(`
CREATE TABLE IF NOT EXISTS __migrations (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`);

  for (const migration of migrations) {
    const existing = await client`SELECT id FROM __migrations WHERE id = ${migration.id}`;
    if (existing.length) continue;
    await client.begin(async (transaction) => {
      await transaction.unsafe(migration.sql);
      await transaction`INSERT INTO __migrations (id) VALUES (${migration.id})`;
    });
  }
}
