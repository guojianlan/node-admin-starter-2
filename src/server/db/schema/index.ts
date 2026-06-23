import { sql } from "drizzle-orm";
import {
  boolean,
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
    passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    status: integer("status").notNull().default(1),
    isSystem: boolean("is_system").notNull().default(false),
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
    dataScope: text("data_scope", {
      enum: ["all", "custom_dept", "current_dept", "current_dept_tree", "self"],
    })
      .notNull()
      .default("all"),
    isSystem: boolean("is_system").notNull().default(false),
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
    isSystem: boolean("is_system").notNull().default(false),
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

export const sysRoleDept = pgTable(
  "sys_role_dept",
  {
    roleId: integer("role_id")
      .notNull()
      .references(() => sysRole.id, { onDelete: "cascade" }),
    deptId: integer("dept_id")
      .notNull()
      .references(() => sysDept.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.deptId] }),
    index("sys_role_dept_dept_id_idx").on(table.deptId),
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
    isSystem: boolean("is_system").notNull().default(false),
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
    ip: text("ip"),
    userAgent: text("user_agent"),
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

export const sysUserPasswordHistory = pgTable(
  "sys_user_password_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sys_user_password_history_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const sysPasswordResetToken = pgTable(
  "sys_password_reset_token",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sys_password_reset_token_hash_unique").on(table.tokenHash),
    index("sys_password_reset_token_user_id_idx").on(table.userId),
    index("sys_password_reset_token_expires_at_idx").on(table.expiresAt),
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

export const sysOperationLog = pgTable(
  "sys_operation_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => sysUser.id, { onDelete: "set null" }),
    username: text("username"),
    module: text("module").notNull(),
    action: text("action").notNull(),
    resource: text("resource"),
    resourceId: text("resource_id"),
    method: text("method").notNull(),
    path: text("path").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    status: integer("status").notNull(),
    success: boolean("success").notNull(),
    message: text("message"),
    durationMs: integer("duration_ms"),
    detailsJson: text("details_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sys_operation_log_created_at_idx").on(table.createdAt),
    index("sys_operation_log_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("sys_operation_log_module_action_idx").on(table.module, table.action),
    index("sys_operation_log_success_created_at_idx").on(table.success, table.createdAt),
    index("sys_operation_log_request_id_idx").on(table.requestId),
  ],
);

export const sysNotice = pgTable(
  "sys_notice",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    type: text("type", { enum: ["notice", "announcement"] })
      .notNull()
      .default("notice"),
    scope: text("scope", { enum: ["all", "users"] }).notNull().default("all"),
    targetUserIdsJson: text("target_user_ids_json"),
    status: integer("status").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    index("sys_notice_status_published_at_idx").on(table.status, table.publishedAt),
    index("sys_notice_type_status_idx").on(table.type, table.status),
  ],
);

export const sysNoticeRead = pgTable(
  "sys_notice_read",
  {
    noticeId: integer("notice_id")
      .notNull()
      .references(() => sysNotice.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.noticeId, table.userId] }),
    index("sys_notice_read_user_id_idx").on(table.userId),
  ],
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
    isSystem: boolean("is_system").notNull().default(false),
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
    isSystem: boolean("is_system").notNull().default(false),
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
    isSystem: boolean("is_system").notNull().default(false),
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

export const sysStorage = pgTable(
  "sys_storage",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    type: text("type", { enum: ["local", "s3"] }).notNull(),
    endpoint: text("endpoint"),
    region: text("region"),
    bucket: text("bucket"),
    accessKey: text("access_key"),
    secretKeyEncrypted: text("secret_key_encrypted"),
    baseUrl: text("base_url"),
    rootPath: text("root_path"),
    isDefault: boolean("is_default").notNull().default(false),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    optionsJson: text("options_json"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_storage_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("sys_storage_default_active_unique")
      .on(table.isDefault)
      .where(sql`${table.deletedAt} IS NULL AND ${table.isDefault} = true`),
    index("sys_storage_type_status_idx").on(table.type, table.status),
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
    storageId: integer("storage_id").references(() => sysStorage.id, { onDelete: "set null" }),
    originalName: text("original_name").notNull(),
    filename: text("filename").notNull(),
    path: text("path").notNull(),
    url: text("url").notNull(),
    size: integer("size").notNull(),
    ext: text("ext"),
    mime: text("mime"),
    type: text("type").notNull().default("other"),
    sha256: text("sha256"),
    metadataJson: text("metadata_json"),
    thumbnailPath: text("thumbnail_path"),
    thumbnailUrl: text("thumbnail_url"),
    uploaderId: integer("uploader_id").references(() => sysUser.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    index("sys_file_group_id_idx").on(table.groupId),
    index("sys_file_storage_id_idx").on(table.storageId),
    index("sys_file_uploader_id_idx").on(table.uploaderId),
    index("sys_file_type_idx").on(table.type),
    index("sys_file_sha256_idx").on(table.sha256),
    index("sys_file_deleted_at_idx").on(table.deletedAt),
    index("sys_file_created_at_idx").on(table.createdAt),
  ],
);

export const sysMailAccount = pgTable(
  "sys_mail_account",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull(),
    secure: boolean("secure").notNull().default(false),
    username: text("username"),
    passwordEncrypted: text("password_encrypted"),
    fromName: text("from_name"),
    fromEmail: text("from_email").notNull(),
    replyTo: text("reply_to"),
    isDefault: boolean("is_default").notNull().default(false),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_mail_account_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("sys_mail_account_default_active_unique")
      .on(table.isDefault)
      .where(sql`${table.deletedAt} IS NULL AND ${table.isDefault} = true`),
    index("sys_mail_account_status_sort_idx").on(table.status, table.sort),
  ],
);
