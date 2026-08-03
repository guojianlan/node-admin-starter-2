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
    forcePasswordChange: boolean("force_password_change").notNull().default(false),
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

export const sysOauthState = pgTable(
  "sys_oauth_state",
  {
    state: text("state").primaryKey(),
    provider: text("provider").notNull(),
    redirectUri: text("redirect_uri"),
    bindUserId: integer("bind_user_id").references(() => sysUser.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sys_oauth_state_expires_at_idx").on(table.expiresAt)],
);

export const sysOauthAccount = pgTable(
  "sys_oauth_account",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    providerUsername: text("provider_username"),
    email: text("email"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sys_oauth_account_provider_user_unique").on(table.provider, table.providerUserId),
    uniqueIndex("sys_oauth_account_user_provider_unique").on(table.userId, table.provider),
    index("sys_oauth_account_user_id_idx").on(table.userId),
  ],
);

export const sysOauthProvider = pgTable(
  "sys_oauth_provider",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    authUrl: text("auth_url").notNull(),
    tokenUrl: text("token_url"),
    userInfoUrl: text("user_info_url"),
    clientId: text("client_id"),
    clientSecretEncrypted: text("client_secret_encrypted"),
    scopesJson: text("scopes_json"),
    userMappingJson: text("user_mapping_json"),
    autoCreateUser: boolean("auto_create_user").notNull().default(false),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_oauth_provider_key_active_unique")
      .on(table.key)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_oauth_provider_status_sort_idx").on(table.status, table.sort),
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
    riskLevel: text("risk_level", { enum: ["low", "medium", "high", "critical"] })
      .notNull()
      .default("low"),
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
    index("sys_operation_log_risk_level_created_at_idx").on(table.riskLevel, table.createdAt),
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
    scope: text("scope", { enum: ["all", "users", "roles", "depts"] })
      .notNull()
      .default("all"),
    targetUserIdsJson: text("target_user_ids_json"),
    targetRoleIdsJson: text("target_role_ids_json"),
    targetDeptIdsJson: text("target_dept_ids_json"),
    priority: integer("priority").notNull().default(0),
    pinned: boolean("pinned").notNull().default(false),
    status: integer("status").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
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

export const sysFileReference = pgTable(
  "sys_file_reference",
  {
    id: serial("id").primaryKey(),
    fileId: integer("file_id")
      .notNull()
      .references(() => sysFile.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    field: text("field"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sys_file_reference_file_id_idx").on(table.fileId),
    index("sys_file_reference_module_resource_idx").on(table.module, table.resourceId),
    index("sys_file_reference_resource_type_idx").on(table.resourceType),
  ],
);

export const sysFileUploadSession = pgTable(
  "sys_file_upload_session",
  {
    id: serial("id").primaryKey(),
    uploadId: text("upload_id").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime"),
    size: integer("size").notNull(),
    totalParts: integer("total_parts").notNull(),
    groupId: integer("group_id"),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["uploading", "completed", "cancelled", "expired", "failed"],
    })
      .notNull()
      .default("uploading"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sys_file_upload_session_upload_id_unique").on(table.uploadId),
    index("sys_file_upload_session_user_id_idx").on(table.userId),
    index("sys_file_upload_session_expires_at_idx").on(table.expiresAt),
  ],
);

export const sysFileUploadPart = pgTable(
  "sys_file_upload_part",
  {
    uploadId: text("upload_id").notNull(),
    partNumber: integer("part_number").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    path: text("path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.uploadId, table.partNumber] })],
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

export const sysSmsProvider = pgTable(
  "sys_sms_provider",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    provider: text("provider").notNull().default("webhook"),
    endpoint: text("endpoint"),
    accessKey: text("access_key"),
    secretKeyEncrypted: text("secret_key_encrypted"),
    signature: text("signature"),
    templateCode: text("template_code"),
    isDefault: boolean("is_default").notNull().default(false),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    optionsJson: text("options_json"),
    remark: text("remark"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_sms_provider_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("sys_sms_provider_default_active_unique")
      .on(table.isDefault)
      .where(sql`${table.deletedAt} IS NULL AND ${table.isDefault} = true`),
    index("sys_sms_provider_provider_status_idx").on(table.provider, table.status),
    index("sys_sms_provider_status_sort_idx").on(table.status, table.sort),
  ],
);

export const sysAiProvider = pgTable(
  "sys_ai_provider",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    providerType: text("provider_type").notNull().default("openai-compatible"),
    baseUrl: text("base_url"),
    apiKeyEncrypted: text("api_key_encrypted"),
    organization: text("organization"),
    project: text("project"),
    isDefault: boolean("is_default").notNull().default(false),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    optionsJson: text("options_json"),
    remark: text("remark"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_ai_provider_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("sys_ai_provider_default_active_unique")
      .on(table.isDefault)
      .where(sql`${table.deletedAt} IS NULL AND ${table.isDefault} = true`),
    index("sys_ai_provider_type_status_idx").on(table.providerType, table.status),
    index("sys_ai_provider_status_sort_idx").on(table.status, table.sort),
  ],
);

export const sysAiModel = pgTable(
  "sys_ai_model",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => sysAiProvider.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    modelId: text("model_id").notNull(),
    modelType: text("model_type", { enum: ["chat", "embedding", "image", "rerank"] })
      .notNull()
      .default("chat"),
    capabilitiesJson: text("capabilities_json"),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    inputPrice: text("input_price"),
    outputPrice: text("output_price"),
    currency: text("currency").notNull().default("USD"),
    isDefaultChat: boolean("is_default_chat").notNull().default(false),
    isDefaultStructured: boolean("is_default_structured").notNull().default(false),
    isDefaultEmbedding: boolean("is_default_embedding").notNull().default(false),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    remark: text("remark"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_ai_model_provider_model_active_unique")
      .on(table.providerId, table.modelId)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("sys_ai_model_default_chat_active_unique")
      .on(table.isDefaultChat)
      .where(sql`${table.deletedAt} IS NULL AND ${table.isDefaultChat} = true`),
    uniqueIndex("sys_ai_model_default_structured_active_unique")
      .on(table.isDefaultStructured)
      .where(sql`${table.deletedAt} IS NULL AND ${table.isDefaultStructured} = true`),
    uniqueIndex("sys_ai_model_default_embedding_active_unique")
      .on(table.isDefaultEmbedding)
      .where(sql`${table.deletedAt} IS NULL AND ${table.isDefaultEmbedding} = true`),
    index("sys_ai_model_provider_id_idx").on(table.providerId),
    index("sys_ai_model_type_status_idx").on(table.modelType, table.status),
    index("sys_ai_model_status_sort_idx").on(table.status, table.sort),
  ],
);

export const sysAiAgent = pgTable(
  "sys_ai_agent",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    instructions: text("instructions").notNull(),
    modelId: integer("model_id").references(() => sysAiModel.id, { onDelete: "set null" }),
    temperatureMilli: integer("temperature_milli").notNull().default(700),
    maxOutputTokens: integer("max_output_tokens"),
    maxSteps: integer("max_steps").notNull().default(6),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_ai_agent_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_ai_agent_status_sort_idx").on(table.status, table.sort),
    index("sys_ai_agent_model_id_idx").on(table.modelId),
  ],
);

export const sysAiTool = pgTable(
  "sys_ai_tool",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    handlerKey: text("handler_key").notNull(),
    inputSchemaJson: text("input_schema_json"),
    configJson: text("config_json"),
    riskLevel: text("risk_level", { enum: ["low", "medium", "high", "critical"] })
      .notNull()
      .default("low"),
    approvalRequired: boolean("approval_required").notNull().default(false),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_ai_tool_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_ai_tool_status_sort_idx").on(table.status, table.sort),
    index("sys_ai_tool_handler_key_idx").on(table.handlerKey),
  ],
);

export const sysAiAgentTool = pgTable(
  "sys_ai_agent_tool",
  {
    agentId: integer("agent_id")
      .notNull()
      .references(() => sysAiAgent.id, { onDelete: "cascade" }),
    toolId: integer("tool_id")
      .notNull()
      .references(() => sysAiTool.id, { onDelete: "cascade" }),
    approvalMode: text("approval_mode", { enum: ["inherit", "always", "never"] })
      .notNull()
      .default("inherit"),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.toolId] }),
    index("sys_ai_agent_tool_tool_id_idx").on(table.toolId),
  ],
);

export const sysAiChatSession = pgTable(
  "sys_ai_chat_session",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    providerId: integer("provider_id").references(() => sysAiProvider.id, {
      onDelete: "set null",
    }),
    modelId: integer("model_id").references(() => sysAiModel.id, { onDelete: "set null" }),
    agentId: integer("agent_id").references(() => sysAiAgent.id, { onDelete: "set null" }),
    systemPrompt: text("system_prompt"),
    temperatureMilli: integer("temperature_milli").notNull().default(700),
    maxOutputTokens: integer("max_output_tokens"),
    contextSummary: text("context_summary"),
    compactedThroughMessageId: integer("compacted_through_message_id"),
    totalInputTokens: integer("total_input_tokens").notNull().default(0),
    totalOutputTokens: integer("total_output_tokens").notNull().default(0),
    providerCode: text("provider_code"),
    modelName: text("model_name"),
    modelIdentifier: text("model_identifier"),
    messageCount: integer("message_count").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    status: integer("status").notNull().default(1),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    index("sys_ai_chat_session_user_updated_idx").on(table.userId, table.updatedAt),
    index("sys_ai_chat_session_last_message_idx").on(table.lastMessageAt),
  ],
);

export const sysAiChatMessage = pgTable(
  "sys_ai_chat_message",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sysAiChatSession.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["system", "user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    status: text("status", {
      enum: ["pending", "streaming", "completed", "stopped", "failed", "superseded"],
    })
      .notNull()
      .default("completed"),
    errorMessage: text("error_message"),
    parentMessageId: integer("parent_message_id"),
    regeneratedFromId: integer("regenerated_from_id"),
    finishReason: text("finish_reason"),
    usageJson: text("usage_json"),
    metadataJson: text("metadata_json"),
    providerId: integer("provider_id").references(() => sysAiProvider.id, {
      onDelete: "set null",
    }),
    modelId: integer("model_id").references(() => sysAiModel.id, { onDelete: "set null" }),
    durationMs: integer("duration_ms"),
    ...timestamps,
  },
  (table) => [
    index("sys_ai_chat_message_session_id_idx").on(table.sessionId, table.id),
    index("sys_ai_chat_message_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const sysAiAgentRun = pgTable(
  "sys_ai_agent_run",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sysAiChatSession.id, { onDelete: "cascade" }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => sysAiAgent.id, { onDelete: "restrict" }),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "waiting_approval", "completed", "stopped", "failed"],
    })
      .notNull()
      .default("queued"),
    inputMessageId: integer("input_message_id"),
    outputMessageId: integer("output_message_id"),
    totalSteps: integer("total_steps").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("sys_ai_agent_run_session_id_idx").on(table.sessionId, table.id),
    index("sys_ai_agent_run_user_status_idx").on(table.userId, table.status),
  ],
);

export const sysAiAgentRunStep = pgTable(
  "sys_ai_agent_run_step",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => sysAiAgentRun.id, { onDelete: "cascade" }),
    stepNo: integer("step_no").notNull(),
    stepType: text("step_type", { enum: ["model", "tool", "approval"] }).notNull(),
    status: text("status", {
      enum: ["running", "waiting_approval", "completed", "denied", "failed"],
    })
      .notNull()
      .default("running"),
    toolId: integer("tool_id").references(() => sysAiTool.id, { onDelete: "set null" }),
    toolName: text("tool_name"),
    toolCallId: text("tool_call_id"),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    usageJson: text("usage_json"),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("sys_ai_agent_run_step_run_no_idx").on(table.runId, table.stepNo),
    index("sys_ai_agent_run_step_tool_call_idx").on(table.toolCallId),
  ],
);

export const sysAiToolApproval = pgTable(
  "sys_ai_tool_approval",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => sysAiAgentRun.id, { onDelete: "cascade" }),
    stepId: integer("step_id").references(() => sysAiAgentRunStep.id, { onDelete: "set null" }),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sysAiChatSession.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    toolId: integer("tool_id").references(() => sysAiTool.id, { onDelete: "set null" }),
    toolName: text("tool_name").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    planHash: text("plan_hash"),
    affectedFilesJson: text("affected_files_json"),
    validationJson: text("validation_json"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status", {
      enum: ["pending", "approved", "denied", "expired", "executed", "failed"],
    })
      .notNull()
      .default("pending"),
    reason: text("reason"),
    decidedBy: integer("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sys_ai_tool_approval_run_tool_call_unique").on(table.runId, table.toolCallId),
    index("sys_ai_tool_approval_session_status_idx").on(table.sessionId, table.status),
    index("sys_ai_tool_approval_user_status_idx").on(table.userId, table.status),
    index("sys_ai_tool_approval_expires_at_idx").on(table.expiresAt),
  ],
);

export const sysSmsTemplate = pgTable(
  "sys_sms_template",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => sysSmsProvider.id, { onDelete: "restrict" }),
    templateCode: text("template_code"),
    signature: text("signature"),
    content: text("content").notNull(),
    variablesJson: text("variables_json"),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    remark: text("remark"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_sms_template_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_sms_template_provider_id_idx").on(table.providerId),
    index("sys_sms_template_status_sort_idx").on(table.status, table.sort),
  ],
);
