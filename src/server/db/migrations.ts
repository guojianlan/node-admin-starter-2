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
