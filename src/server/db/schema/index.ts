import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

const auditUsers = {
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  deletedBy: integer("deleted_by"),
};

export const sysUser = pgTable(
  "sys_user",
  {
    id: serial("id").primaryKey(),
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
    loginTime: timestamp("login_time", { withTimezone: true }),
    status: integer("status").notNull().default(1),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_user_username_active_unique")
      .on(table.username)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_user_dept_id_idx").on(table.deptId),
    index("sys_user_status_created_at_idx").on(table.status, table.createdAt),
  ],
);

export const sysRole = pgTable(
  "sys_role",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    remark: text("remark"),
    sort: integer("sort").notNull().default(0),
    status: integer("status").notNull().default(1),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_role_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_role_status_sort_idx").on(table.status, table.sort),
  ],
);

export const sysUserRole = pgTable(
  "sys_user_role",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => sysRole.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index("sys_user_role_role_id_idx").on(table.roleId),
  ],
);

export const sysDept = pgTable(
  "sys_dept",
  {
    id: serial("id").primaryKey(),
    parentId: integer("parent_id").notNull().default(0),
    name: text("name").notNull(),
    code: text("code"),
    sort: integer("sort").notNull().default(0),
    leader: text("leader"),
    phone: text("phone"),
    status: integer("status").notNull().default(1),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    index("sys_dept_parent_id_idx").on(table.parentId),
    uniqueIndex("sys_dept_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL AND ${table.code} IS NOT NULL`),
  ],
);

export const sysRule = pgTable(
  "sys_rule",
  {
    id: serial("id").primaryKey(),
    parentId: integer("parent_id").notNull().default(0),
    type: text("type", { enum: ["menu", "route", "nested", "action"] }).notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    displayName: text("display_name"),
    path: text("path"),
    icon: text("icon"),
    order: integer("order").notNull().default(0),
    i18nKey: text("i18n_key"),
    component: text("component"),
    status: integer("status").notNull().default(1),
    hidden: integer("hidden").notNull().default(1),
    link: integer("link").notNull().default(0),
    defaultAuth: integer("default_auth").notNull().default(0),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_rule_key_active_unique")
      .on(table.key)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_rule_parent_id_idx").on(table.parentId),
    index("sys_rule_type_status_idx").on(table.type, table.status),
  ],
);

export const sysRoleRule = pgTable(
  "sys_role_rule",
  {
    roleId: integer("role_id")
      .notNull()
      .references(() => sysRole.id, { onDelete: "cascade" }),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => sysRule.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.ruleId] }),
    index("sys_role_rule_rule_id_idx").on(table.ruleId),
  ],
);

export const sysAccessToken = pgTable(
  "sys_access_token",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    abilitiesJson: text("abilities_json").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sys_access_token_token_hash_unique").on(table.tokenHash),
    index("sys_access_token_user_id_idx").on(table.userId),
    index("sys_access_token_expires_at_idx").on(table.expiresAt),
  ],
);

export const sysLoginRecord = pgTable(
  "sys_login_record",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    status: integer("status").notNull(),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sys_login_record_created_at_idx").on(table.createdAt)],
);

export const sysDict = pgTable(
  "sys_dict",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    remark: text("remark"),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_dict_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const sysDictItem = pgTable(
  "sys_dict_item",
  {
    id: serial("id").primaryKey(),
    dictId: integer("dict_id")
      .notNull()
      .references(() => sysDict.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    value: text("value").notNull(),
    color: text("color"),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_dict_item_value_active_unique")
      .on(table.dictId, table.value)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_dict_item_dict_status_sort_idx").on(table.dictId, table.status, table.sort),
  ],
);

export const sysConfigGroup = pgTable(
  "sys_config_group",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    sort: integer("sort").notNull().default(0),
    status: integer("status").notNull().default(1),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_config_group_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);

export const sysConfigItems = pgTable(
  "sys_config_items",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => sysConfigGroup.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    title: text("title").notNull(),
    describe: text("describe"),
    values: text("values"),
    type: text("type").notNull().default("text"),
    optionsJson: text("options_json"),
    propsJson: text("props_json"),
    sort: integer("sort").notNull().default(0),
    status: integer("status").notNull().default(1),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_config_items_key_active_unique")
      .on(table.key)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_config_items_group_id_idx").on(table.groupId),
  ],
);

export const sysFileGroup = pgTable(
  "sys_file_group",
  {
    id: serial("id").primaryKey(),
    parentId: integer("parent_id").notNull().default(0),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    describe: text("describe"),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [index("sys_file_group_parent_id_idx").on(table.parentId)],
);

export const sysFile = pgTable(
  "sys_file",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id").references(() => sysFileGroup.id, { onDelete: "set null" }),
    originalName: text("original_name").notNull(),
    filename: text("filename").notNull(),
    path: text("path").notNull(),
    url: text("url").notNull(),
    size: integer("size").notNull(),
    ext: text("ext"),
    mime: text("mime"),
    uploaderId: integer("uploader_id").references(() => sysUser.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    index("sys_file_group_id_idx").on(table.groupId),
    index("sys_file_uploader_id_idx").on(table.uploaderId),
    index("sys_file_deleted_at_idx").on(table.deletedAt),
    index("sys_file_created_at_idx").on(table.createdAt),
  ],
);
