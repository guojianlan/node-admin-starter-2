import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const sysUser = sqliteTable(
  "sys_user",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    nickname: text("nickname").notNull(),
    avatarId: integer("avatar_id"),
    sex: integer("sex").notNull().default(0),
    bio: text("bio"),
    mobile: text("mobile"),
    email: text("email"),
    deptId: integer("dept_id"),
    loginIp: text("login_ip"),
    loginTime: text("login_time"),
    status: integer("status").notNull().default(1),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("sys_user_username_unique").on(table.username)],
);

export const sysRole = sqliteTable(
  "sys_role",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    remark: text("remark"),
    sort: integer("sort").notNull().default(0),
    status: integer("status").notNull().default(1),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("sys_role_code_unique").on(table.code)],
);

export const sysUserRole = sqliteTable(
  "sys_user_role",
  {
    userId: integer("user_id").notNull(),
    roleId: integer("role_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.roleId] })],
);

export const sysDept = sqliteTable("sys_dept", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  parentId: integer("parent_id").notNull().default(0),
  name: text("name").notNull(),
  code: text("code"),
  sort: integer("sort").notNull().default(0),
  leader: text("leader"),
  phone: text("phone"),
  status: integer("status").notNull().default(1),
  deletedAt: text("deleted_at"),
  ...timestamps,
});

export const sysRule = sqliteTable(
  "sys_rule",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    parentId: integer("parent_id").notNull().default(0),
    type: text("type", { enum: ["menu", "route", "action"] }).notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    path: text("path"),
    icon: text("icon"),
    order: integer("order").notNull().default(0),
    i18nKey: text("i18n_key"),
    status: integer("status").notNull().default(1),
    hidden: integer("hidden").notNull().default(1),
    link: integer("link").notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex("sys_rule_key_unique").on(table.key)],
);

export const sysRoleRule = sqliteTable(
  "sys_role_rule",
  {
    roleId: integer("role_id").notNull(),
    ruleId: integer("rule_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.ruleId] })],
);

export const sysAccessToken = sqliteTable("sys_access_token", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  abilitiesJson: text("abilities_json").notNull(),
  lastUsedAt: text("last_used_at"),
  expiresAt: text("expires_at"),
  ...timestamps,
});

export const sysLoginRecord = sqliteTable("sys_login_record", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  status: integer("status").notNull(),
  message: text("message"),
  createdAt: text("created_at").notNull(),
});

export const sysDict = sqliteTable(
  "sys_dict",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    remark: text("remark"),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("sys_dict_code_unique").on(table.code)],
);

export const sysDictItem = sqliteTable("sys_dict_item", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dictId: integer("dict_id").notNull(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  color: text("color"),
  status: integer("status").notNull().default(1),
  sort: integer("sort").notNull().default(0),
  deletedAt: text("deleted_at"),
  ...timestamps,
});

export const sysConfigGroup = sqliteTable(
  "sys_config_group",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    sort: integer("sort").notNull().default(0),
    status: integer("status").notNull().default(1),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("sys_config_group_code_unique").on(table.code)],
);

export const sysConfigItems = sqliteTable(
  "sys_config_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id").notNull(),
    key: text("key").notNull(),
    title: text("title").notNull(),
    describe: text("describe"),
    values: text("values"),
    type: text("type").notNull().default("text"),
    optionsJson: text("options_json"),
    propsJson: text("props_json"),
    sort: integer("sort").notNull().default(0),
    status: integer("status").notNull().default(1),
    deletedAt: text("deleted_at"),
    ...timestamps,
  },
  (table) => [uniqueIndex("sys_config_items_key_unique").on(table.key)],
);

export const sysFileGroup = sqliteTable("sys_file_group", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  ...timestamps,
});

export const sysFile = sqliteTable("sys_file", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupId: integer("group_id"),
  originalName: text("original_name").notNull(),
  filename: text("filename").notNull(),
  path: text("path").notNull(),
  url: text("url").notNull(),
  size: integer("size").notNull(),
  ext: text("ext"),
  mime: text("mime"),
  uploaderId: integer("uploader_id"),
  deletedAt: text("deleted_at"),
  ...timestamps,
});
