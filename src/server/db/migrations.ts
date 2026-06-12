import type Database from "better-sqlite3";

type Migration = {
  id: string;
  sql: string;
};

const migrations: Migration[] = [
  {
    id: "0001_initial",
    sql: `
CREATE TABLE IF NOT EXISTS sys_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar_id INTEGER,
  sex INTEGER NOT NULL DEFAULT 0,
  bio TEXT,
  mobile TEXT,
  email TEXT,
  dept_id INTEGER,
  login_ip TEXT,
  login_time TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_role (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  remark TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_user_role (
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS sys_dept (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  code TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  leader TEXT,
  phone TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_rule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  path TEXT,
  icon TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  i18n_key TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  hidden INTEGER NOT NULL DEFAULT 1,
  link INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_role_rule (
  role_id INTEGER NOT NULL,
  rule_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, rule_id)
);

CREATE TABLE IF NOT EXISTS sys_access_token (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  abilities_json TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS sys_access_token_token_hash_idx ON sys_access_token(token_hash);

CREATE TABLE IF NOT EXISTS sys_login_record (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  status INTEGER NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_dict (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  remark TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_dict_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dict_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  color TEXT,
  status INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_config_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_config_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  describe TEXT,
  "values" TEXT,
  type TEXT NOT NULL DEFAULT 'text',
  options_json TEXT,
  props_json TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  status INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_file_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sys_file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER,
  original_name TEXT NOT NULL,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  url TEXT NOT NULL,
  size INTEGER NOT NULL,
  ext TEXT,
  mime TEXT,
  uploader_id INTEGER,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
];

export function runMigrations(sqlite: Database.Database) {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS __migrations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
`);

  const hasMigration = sqlite.prepare("SELECT id FROM __migrations WHERE id = ?");
  const insertMigration = sqlite.prepare("INSERT INTO __migrations (id, created_at) VALUES (?, ?)");

  migrations.forEach((migration) => {
    if (hasMigration.get(migration.id)) return;
    const transaction = sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      insertMigration.run(migration.id, new Date().toISOString());
    });
    transaction();
  });
}
