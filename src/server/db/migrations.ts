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
  "sys_file_group",
  "sys_file",
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

CREATE UNIQUE INDEX IF NOT EXISTS sys_user_username_active_unique ON sys_user(username) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_user_dept_id_idx ON sys_user(dept_id);
CREATE INDEX IF NOT EXISTS sys_user_status_created_at_idx ON sys_user(status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS sys_role_code_active_unique ON sys_role(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sys_role_status_sort_idx ON sys_role(status, sort);

CREATE INDEX IF NOT EXISTS sys_user_role_role_id_idx ON sys_user_role(role_id);

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

CREATE INDEX IF NOT EXISTS sys_file_group_parent_id_idx ON sys_file_group(parent_id);

CREATE INDEX IF NOT EXISTS sys_file_group_id_idx ON sys_file(group_id);
CREATE INDEX IF NOT EXISTS sys_file_uploader_id_idx ON sys_file(uploader_id);
CREATE INDEX IF NOT EXISTS sys_file_deleted_at_idx ON sys_file(deleted_at);
CREATE INDEX IF NOT EXISTS sys_file_created_at_idx ON sys_file(created_at);

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
