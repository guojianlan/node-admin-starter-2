import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
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

export const saasTenant = pgTable(
  "saas_tenant",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    region: text("region").notNull().default("global"),
    status: text("status", { enum: ["active", "suspended", "archived"] })
      .notNull()
      .default("active"),
    retentionDays: integer("retention_days").notNull().default(365),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("saas_tenant_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index("saas_tenant_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const saasWorkspace = pgTable(
  "saas_workspace",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => saasTenant.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("saas_workspace_tenant_code_active_unique")
      .on(table.tenantId, table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index("saas_workspace_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
  ],
);

export const saasTenantMember = pgTable(
  "saas_tenant_member",
  {
    tenantId: integer("tenant_id")
      .notNull()
      .references(() => saasTenant.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member", "viewer"] })
      .notNull()
      .default("member"),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by"),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.userId] }),
    index("saas_tenant_member_user_status_idx").on(table.userId, table.status, table.tenantId),
  ],
);

export const saasWorkspaceMember = pgTable(
  "saas_workspace_member",
  {
    workspaceId: integer("workspace_id")
      .notNull()
      .references(() => saasWorkspace.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "editor", "reviewer", "viewer"] })
      .notNull()
      .default("viewer"),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("saas_workspace_member_user_status_idx").on(
      table.userId,
      table.status,
      table.workspaceId,
    ),
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
    usageType: text("usage_type", { enum: ["general", "knowledge", "user_content"] })
      .notNull()
      .default("general"),
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
    index("sys_file_usage_type_created_idx").on(table.usageType, table.createdAt),
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
    timeoutMs: integer("timeout_ms").notNull().default(300000),
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

export const sysAiWebSearchProvider = pgTable(
  "sys_ai_web_search_provider",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    providerType: text("provider_type", { enum: ["tavily", "brave", "searxng"] }).notNull(),
    endpoint: text("endpoint").notNull(),
    apiKeyEncrypted: text("api_key_encrypted"),
    timeoutMs: integer("timeout_ms").notNull().default(10000),
    maxResults: integer("max_results").notNull().default(8),
    status: integer("status").notNull().default(0),
    sort: integer("sort").notNull().default(0),
    remark: text("remark"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_ai_web_search_provider_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_ai_web_search_provider_type_status_idx").on(table.providerType, table.status),
    index("sys_ai_web_search_provider_status_sort_idx").on(table.status, table.sort),
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
    cachedInputPrice: text("cached_input_price"),
    cacheWritePrice: text("cache_write_price"),
    outputPrice: text("output_price"),
    currency: text("currency").notNull().default("USD"),
    pricingSourceUrl: text("pricing_source_url"),
    pricingVerifiedAt: date("pricing_verified_at"),
    pricingSourceType: text("pricing_source_type", {
      enum: ["manual", "catalog", "provider"],
    })
      .notNull()
      .default("manual"),
    pricingCatalogKey: text("pricing_catalog_key"),
    pricingSourceHash: text("pricing_source_hash"),
    pricingSyncedAt: timestamp("pricing_synced_at", { withTimezone: true }),
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

export const sysAiPricingCatalogSnapshot = pgTable(
  "sys_ai_pricing_catalog_snapshot",
  {
    id: serial("id").primaryKey(),
    sourceType: text("source_type", { enum: ["litellm"] })
      .notNull()
      .default("litellm"),
    sourceUrl: text("source_url").notNull(),
    sourceHash: text("source_hash").notNull(),
    modelCount: integer("model_count").notNull().default(0),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by"),
  },
  (table) => [
    uniqueIndex("sys_ai_pricing_catalog_snapshot_hash_unique").on(
      table.sourceType,
      table.sourceHash,
    ),
    index("sys_ai_pricing_catalog_snapshot_fetched_idx").on(table.fetchedAt),
  ],
);

export const sysAiPricingCatalogItem = pgTable(
  "sys_ai_pricing_catalog_item",
  {
    id: serial("id").primaryKey(),
    snapshotId: integer("snapshot_id")
      .notNull()
      .references(() => sysAiPricingCatalogSnapshot.id, { onDelete: "cascade" }),
    catalogKey: text("catalog_key").notNull(),
    modelIdentifier: text("model_identifier").notNull(),
    providerType: text("provider_type"),
    mode: text("mode"),
    inputPrice: text("input_price"),
    cachedInputPrice: text("cached_input_price"),
    cacheWritePrice: text("cache_write_price"),
    outputPrice: text("output_price"),
    currency: text("currency").notNull().default("USD"),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sys_ai_pricing_catalog_item_snapshot_key_unique").on(
      table.snapshotId,
      table.catalogKey,
    ),
    index("sys_ai_pricing_catalog_item_snapshot_provider_idx").on(
      table.snapshotId,
      table.providerType,
    ),
    index("sys_ai_pricing_catalog_item_snapshot_model_idx").on(
      table.snapshotId,
      table.modelIdentifier,
    ),
  ],
);

export const sysAiPurposeRoute = pgTable(
  "sys_ai_purpose_route",
  {
    purpose: text("purpose", {
      enum: ["chat", "structured", "embedding", "rerank", "agent", "ragAnswer", "evalJudge"],
    }).primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    status: integer("status").notNull().default(1),
    ...timestamps,
    createdBy: integer("created_by"),
    updatedBy: integer("updated_by"),
  },
  (table) => [index("sys_ai_purpose_route_status_idx").on(table.status)],
);

export const sysAiPurposeModel = pgTable(
  "sys_ai_purpose_model",
  {
    purpose: text("purpose")
      .notNull()
      .references(() => sysAiPurposeRoute.purpose, { onDelete: "cascade" }),
    modelId: integer("model_id")
      .notNull()
      .references(() => sysAiModel.id, { onDelete: "restrict" }),
    priority: integer("priority").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by"),
  },
  (table) => [
    primaryKey({ columns: [table.purpose, table.modelId] }),
    uniqueIndex("sys_ai_purpose_model_priority_unique").on(table.purpose, table.priority),
    index("sys_ai_purpose_model_model_id_idx").on(table.modelId),
  ],
);

export const sysAiInvocation = pgTable(
  "sys_ai_invocation",
  {
    id: serial("id").primaryKey(),
    purpose: text("purpose").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    requestId: text("request_id"),
    userId: integer("user_id").references(() => sysUser.id, { onDelete: "set null" }),
    sessionId: integer("session_id"),
    runId: integer("run_id"),
    stepId: integer("step_id"),
    requestedModelId: integer("requested_model_id").references(() => sysAiModel.id, {
      onDelete: "set null",
    }),
    resolvedModelId: integer("resolved_model_id").references(() => sysAiModel.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["running", "completed", "failed", "aborted"],
    })
      .notNull()
      .default("running"),
    attemptCount: integer("attempt_count").notNull().default(0),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    estimatedCost: text("estimated_cost"),
    currency: text("currency"),
    durationMs: integer("duration_ms"),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sys_ai_invocation_purpose_created_idx").on(table.purpose, table.createdAt),
    index("sys_ai_invocation_status_created_idx").on(table.status, table.createdAt),
    index("sys_ai_invocation_request_id_idx").on(table.requestId),
    index("sys_ai_invocation_user_created_idx").on(table.userId, table.createdAt),
    index("sys_ai_invocation_run_id_idx").on(table.runId),
  ],
);

export const sysAiInvocationAttempt = pgTable(
  "sys_ai_invocation_attempt",
  {
    id: serial("id").primaryKey(),
    invocationId: integer("invocation_id")
      .notNull()
      .references(() => sysAiInvocation.id, { onDelete: "cascade" }),
    attemptNo: integer("attempt_no").notNull(),
    providerId: integer("provider_id").references(() => sysAiProvider.id, {
      onDelete: "set null",
    }),
    modelId: integer("model_id").references(() => sysAiModel.id, { onDelete: "set null" }),
    providerCode: text("provider_code").notNull(),
    providerName: text("provider_name").notNull(),
    modelIdentifier: text("model_identifier").notNull(),
    modelName: text("model_name").notNull(),
    status: text("status", { enum: ["running", "completed", "failed", "aborted"] })
      .notNull()
      .default("running"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    estimatedCost: text("estimated_cost"),
    currency: text("currency"),
    latencyMs: integer("latency_ms"),
    firstTokenMs: integer("first_token_ms"),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sys_ai_invocation_attempt_no_unique").on(table.invocationId, table.attemptNo),
    index("sys_ai_invocation_attempt_provider_created_idx").on(table.providerId, table.createdAt),
    index("sys_ai_invocation_attempt_model_created_idx").on(table.modelId, table.createdAt),
    index("sys_ai_invocation_attempt_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const sysAiKnowledgeBase = pgTable(
  "sys_ai_knowledge_base",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    scopeType: text("scope_type", { enum: ["global", "department", "user"] })
      .notNull()
      .default("global"),
    deptId: integer("dept_id").references(() => sysDept.id, { onDelete: "set null" }),
    ownerId: integer("owner_id").references(() => sysUser.id, { onDelete: "set null" }),
    chunkPreset: text("chunk_preset", {
      enum: ["auto", "documentation", "paragraph", "sentence", "recursive", "fixed"],
    })
      .notNull()
      .default("auto"),
    chunkSize: integer("chunk_size").notNull().default(1600),
    chunkOverlap: integer("chunk_overlap").notNull().default(160),
    chunkConfigJson: text("chunk_config_json"),
    managedType: text("managed_type", { enum: ["notebook"] }),
    managedResourceId: integer("managed_resource_id"),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_ai_knowledge_base_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_ai_knowledge_base_scope_status_idx").on(table.scopeType, table.status),
    uniqueIndex("sys_ai_knowledge_base_managed_resource_unique")
      .on(table.managedType, table.managedResourceId)
      .where(sql`${table.managedType} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  ],
);

export const sysAiDocument = pgTable(
  "sys_ai_document",
  {
    id: serial("id").primaryKey(),
    knowledgeBaseId: integer("knowledge_base_id")
      .notNull()
      .references(() => sysAiKnowledgeBase.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => sysFile.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    sha256: text("sha256").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status", {
      enum: ["pending", "processing", "ready", "failed", "disabled"],
    })
      .notNull()
      .default("pending"),
    characterCount: integer("character_count").notNull().default(0),
    chunkCount: integer("chunk_count").notNull().default(0),
    chunkerVersion: text("chunker_version"),
    chunkConfigJson: text("chunk_config_json"),
    errorMessage: text("error_message"),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),
    sourceType: text("source_type", { enum: ["file", "web_url"] })
      .notNull()
      .default("file"),
    sourceUrl: text("source_url"),
    canonicalUrl: text("canonical_url"),
    sourceDomain: text("source_domain"),
    sourceTitle: text("source_title"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    contentHash: text("content_hash"),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_ai_document_base_hash_active_unique")
      .on(table.knowledgeBaseId, table.sha256)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_ai_document_base_status_idx").on(table.knowledgeBaseId, table.status),
    index("sys_ai_document_file_id_idx").on(table.fileId),
    index("sys_ai_document_source_type_idx").on(table.sourceType, table.fetchedAt),
  ],
);

export const sysAiDocumentChunk = pgTable(
  "sys_ai_document_chunk",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => sysAiDocument.id, { onDelete: "cascade" }),
    chunkNo: integer("chunk_no").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    pageNumber: integer("page_number"),
    paragraphStart: integer("paragraph_start"),
    paragraphEnd: integer("paragraph_end"),
    heading: text("heading"),
    metadataJson: text("metadata_json"),
    embeddingJson: text("embedding_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sys_ai_document_chunk_no_unique").on(table.documentId, table.chunkNo),
    index("sys_ai_document_chunk_document_id_idx").on(table.documentId),
  ],
);

export const sysAiRagRun = pgTable(
  "sys_ai_rag_run",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => sysUser.id, { onDelete: "set null" }),
    knowledgeBaseIdsJson: text("knowledge_base_ids_json").notNull(),
    sourceFilterJson: text("source_filter_json"),
    queryHash: text("query_hash").notNull(),
    invocationId: integer("invocation_id").references(() => sysAiInvocation.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    citationCount: integer("citation_count").notNull().default(0),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("sys_ai_rag_run_user_created_idx").on(table.userId, table.createdAt),
    index("sys_ai_rag_run_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const sysAiRagCitation = pgTable(
  "sys_ai_rag_citation",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => sysAiRagRun.id, { onDelete: "cascade" }),
    chunkId: integer("chunk_id")
      .notNull()
      .references(() => sysAiDocumentChunk.id, { onDelete: "restrict" }),
    rank: integer("rank").notNull(),
    score: text("score").notNull(),
    quote: text("quote").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sys_ai_rag_citation_run_chunk_unique").on(table.runId, table.chunkId),
    index("sys_ai_rag_citation_run_rank_idx").on(table.runId, table.rank),
  ],
);

export const sysAiNotebook = pgTable(
  "sys_ai_notebook",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    scopeType: text("scope_type", { enum: ["global", "department", "user"] })
      .notNull()
      .default("user"),
    deptId: integer("dept_id").references(() => sysDept.id, { onDelete: "set null" }),
    ownerId: integer("owner_id").references(() => sysUser.id, { onDelete: "set null" }),
    defaultModelId: integer("default_model_id").references(() => sysAiModel.id, {
      onDelete: "set null",
    }),
    systemPrompt: text("system_prompt"),
    sourceScopeVersion: integer("source_scope_version").notNull().default(1),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    index("sys_ai_notebook_scope_status_idx").on(table.scopeType, table.status),
    index("sys_ai_notebook_owner_created_idx").on(table.ownerId, table.createdAt),
    index("sys_ai_notebook_dept_created_idx").on(table.deptId, table.createdAt),
  ],
);

export const sysAiNotebookSource = pgTable(
  "sys_ai_notebook_source",
  {
    id: serial("id").primaryKey(),
    notebookId: integer("notebook_id")
      .notNull()
      .references(() => sysAiNotebook.id, { onDelete: "cascade" }),
    sourceType: text("source_type", { enum: ["knowledge_base", "document"] }).notNull(),
    knowledgeBaseId: integer("knowledge_base_id").references(() => sysAiKnowledgeBase.id, {
      onDelete: "restrict",
    }),
    documentId: integer("document_id").references(() => sysAiDocument.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: integer("deleted_by"),
  },
  (table) => [
    index("sys_ai_notebook_source_notebook_idx").on(table.notebookId, table.createdAt),
    index("sys_ai_notebook_source_base_idx").on(table.knowledgeBaseId),
    index("sys_ai_notebook_source_document_idx").on(table.documentId),
  ],
);

export const sysAiNotebookArtifact = pgTable(
  "sys_ai_notebook_artifact",
  {
    id: serial("id").primaryKey(),
    notebookId: integer("notebook_id")
      .notNull()
      .references(() => sysAiNotebook.id, { onDelete: "cascade" }),
    artifactType: text("artifact_type", { enum: ["summary", "outline", "faq", "brief"] }).notNull(),
    title: text("title").notNull(),
    promptText: text("prompt_text").notNull(),
    promptHash: text("prompt_hash").notNull(),
    content: text("content"),
    status: text("status", { enum: ["generating", "completed", "failed"] })
      .notNull()
      .default("generating"),
    version: integer("version").notNull().default(1),
    ragRunId: integer("rag_run_id").references(() => sysAiRagRun.id, { onDelete: "set null" }),
    invocationId: integer("invocation_id").references(() => sysAiInvocation.id, {
      onDelete: "set null",
    }),
    modelId: integer("model_id").references(() => sysAiModel.id, { onDelete: "set null" }),
    sourceScopeVersion: integer("source_scope_version").notNull().default(1),
    sourceSnapshotJson: text("source_snapshot_json").notNull(),
    citationsJson: text("citations_json").notNull().default("[]"),
    errorMessage: text("error_message"),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    index("sys_ai_notebook_artifact_notebook_created_idx").on(table.notebookId, table.createdAt),
    index("sys_ai_notebook_artifact_status_created_idx").on(table.status, table.createdAt),
  ],
);

export const sysAiEvalDataset = pgTable(
  "sys_ai_eval_dataset",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    scopeType: text("scope_type", { enum: ["global", "department", "user"] })
      .notNull()
      .default("user"),
    deptId: integer("dept_id").references(() => sysDept.id, { onDelete: "set null" }),
    ownerId: integer("owner_id").references(() => sysUser.id, { onDelete: "set null" }),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    index("sys_ai_eval_dataset_scope_status_idx").on(table.scopeType, table.status),
    index("sys_ai_eval_dataset_owner_created_idx").on(table.ownerId, table.createdAt),
    index("sys_ai_eval_dataset_dept_created_idx").on(table.deptId, table.createdAt),
  ],
);

export const sysAiEvalCase = pgTable(
  "sys_ai_eval_case",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id")
      .notNull()
      .references(() => sysAiEvalDataset.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    agentId: integer("agent_id")
      .notNull()
      .references(() => sysAiAgent.id, { onDelete: "restrict" }),
    sourceRunId: integer("source_run_id").references(() => sysAiAgentRun.id, {
      onDelete: "set null",
    }),
    inputText: text("input_text").notNull(),
    expectedText: text("expected_text"),
    assertionsJson: text("assertions_json").notNull().default("{}"),
    tagsJson: text("tags_json").notNull().default("[]"),
    judgeEnabled: boolean("judge_enabled").notNull().default(false),
    judgeRubric: text("judge_rubric"),
    groundednessRequired: boolean("groundedness_required").notNull().default(false),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    index("sys_ai_eval_case_dataset_status_idx").on(table.datasetId, table.status),
    index("sys_ai_eval_case_agent_id_idx").on(table.agentId),
    index("sys_ai_eval_case_source_run_idx").on(table.sourceRunId),
  ],
);

export const sysAiEvalRun = pgTable(
  "sys_ai_eval_run",
  {
    id: serial("id").primaryKey(),
    datasetId: integer("dataset_id")
      .notNull()
      .references(() => sysAiEvalDataset.id, { onDelete: "restrict" }),
    userId: integer("user_id").references(() => sysUser.id, { onDelete: "set null" }),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    totalCases: integer("total_cases").notNull().default(0),
    passedCases: integer("passed_cases").notNull().default(0),
    failedCases: integer("failed_cases").notNull().default(0),
    errorCases: integer("error_cases").notNull().default(0),
    requestId: text("request_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sys_ai_eval_run_dataset_created_idx").on(table.datasetId, table.createdAt),
    index("sys_ai_eval_run_user_created_idx").on(table.userId, table.createdAt),
    index("sys_ai_eval_run_status_created_idx").on(table.status, table.createdAt),
    index("sys_ai_eval_run_request_id_idx").on(table.requestId),
  ],
);

export const sysAiEvalResult = pgTable(
  "sys_ai_eval_result",
  {
    id: serial("id").primaryKey(),
    evalRunId: integer("eval_run_id")
      .notNull()
      .references(() => sysAiEvalRun.id, { onDelete: "cascade" }),
    caseId: integer("case_id")
      .notNull()
      .references(() => sysAiEvalCase.id, { onDelete: "restrict" }),
    agentRunId: integer("agent_run_id").references(() => sysAiAgentRun.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["passed", "failed", "error"] }).notNull(),
    actualOutput: text("actual_output"),
    assertionsJson: text("assertions_json").notNull().default("[]"),
    metricsJson: text("metrics_json").notNull().default("{}"),
    judgeScore: integer("judge_score"),
    judgeReason: text("judge_reason"),
    groundednessScore: text("groundedness_score"),
    judgeInvocationId: integer("judge_invocation_id").references(() => sysAiInvocation.id, {
      onDelete: "set null",
    }),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sys_ai_eval_result_run_case_unique").on(table.evalRunId, table.caseId),
    index("sys_ai_eval_result_agent_run_idx").on(table.agentRunId),
    index("sys_ai_eval_result_status_created_idx").on(table.status, table.createdAt),
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
      enum: [
        "queued",
        "running",
        "waiting_approval",
        "waiting_continuation",
        "completed",
        "stopped",
        "failed",
      ],
    })
      .notNull()
      .default("queued"),
    attempt: integer("attempt").notNull().default(1),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    inputMessageId: integer("input_message_id"),
    outputMessageId: integer("output_message_id"),
    parentRunId: integer("parent_run_id"),
    sourceApprovalId: integer("source_approval_id"),
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
    index("sys_ai_agent_run_lease_idx").on(table.status, table.leaseUntil),
    uniqueIndex("sys_ai_agent_run_source_approval_unique").on(table.sourceApprovalId),
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

export const sysAiAgentRunEvent = pgTable(
  "sys_ai_agent_run_event",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => sysAiAgentRun.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sys_ai_agent_run_event_sequence_unique").on(
      table.runId,
      table.attempt,
      table.sequence,
    ),
    index("sys_ai_agent_run_event_run_id_idx").on(table.runId, table.id),
  ],
);

export const sysAiToolExecution = pgTable(
  "sys_ai_tool_execution",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => sysAiAgentRun.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    toolId: integer("tool_id").references(() => sysAiTool.id, { onDelete: "set null" }),
    toolName: text("tool_name").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    errorMessage: text("error_message"),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sys_ai_tool_execution_run_attempt_call_unique").on(
      table.runId,
      table.attempt,
      table.toolCallId,
    ),
    index("sys_ai_tool_execution_run_status_idx").on(table.runId, table.status),
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
      enum: ["pending", "executing", "approved", "denied", "expired", "executed", "failed"],
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

export const sysAiWorkflowRun = pgTable(
  "sys_ai_workflow_run",
  {
    id: serial("id").primaryKey(),
    workflowCode: text("workflow_code").notNull(),
    orchestratorRunId: text("orchestrator_run_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "suspended", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    requestId: text("request_id"),
    definitionId: integer("definition_id").references(() => sysAiWorkflowDefinition.id, {
      onDelete: "set null",
    }),
    parentRunId: integer("parent_run_id"),
    parentNodeId: text("parent_node_id"),
    callDepth: integer("call_depth").notNull().default(0),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    continuationJson: text("continuation_json"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.parentRunId],
      foreignColumns: [table.id],
      name: "sys_ai_workflow_run_parent_fk",
    }).onDelete("set null"),
    uniqueIndex("sys_ai_workflow_run_orchestrator_unique").on(table.orchestratorRunId),
    index("sys_ai_workflow_run_user_status_idx").on(table.userId, table.status),
    index("sys_ai_workflow_run_code_created_idx").on(table.workflowCode, table.createdAt),
    index("sys_ai_workflow_run_request_id_idx").on(table.requestId),
  ],
);

export const sysAiWorkflowDefinition = pgTable(
  "sys_ai_workflow_definition",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status", { enum: ["draft", "published", "disabled"] }).notNull().default("draft"),
    currentVersion: integer("current_version"),
    createdBy: integer("created_by").references(() => sysUser.id, { onDelete: "set null" }),
    updatedBy: integer("updated_by").references(() => sysUser.id, { onDelete: "set null" }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex("sys_ai_workflow_definition_code_unique").on(table.code),
    index("sys_ai_workflow_definition_status_idx").on(table.status, table.updatedAt),
  ],
);

export const sysAiWorkflowDefinitionVersion = pgTable(
  "sys_ai_workflow_definition_version",
  {
    id: serial("id").primaryKey(),
    definitionId: integer("definition_id")
      .notNull()
      .references(() => sysAiWorkflowDefinition.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    graphJson: text("graph_json").notNull(),
    inputSchemaJson: text("input_schema_json").notNull().default("{}"),
    outputSchemaJson: text("output_schema_json").notNull().default("{}"),
    compatibilityJson: text("compatibility_json").notNull().default("{}"),
    status: text("status", { enum: ["draft", "published", "retired"] }).notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => sysUser.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sys_ai_workflow_definition_version_unique").on(table.definitionId, table.version),
    index("sys_ai_workflow_definition_version_status_idx").on(table.definitionId, table.status),
  ],
);

export const sysAiWorkflowRunStep = pgTable(
  "sys_ai_workflow_run_step",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => sysAiWorkflowRun.id, { onDelete: "cascade" }),
    stepNo: integer("step_no").notNull(),
    stepCode: text("step_code").notNull(),
    status: text("status", {
      enum: ["running", "suspended", "completed", "failed", "skipped"],
    })
      .notNull()
      .default("running"),
    inputJson: text("input_json"),
    outputJson: text("output_json"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sys_ai_workflow_run_step_run_no_unique").on(table.runId, table.stepNo),
    index("sys_ai_workflow_run_step_code_idx").on(table.stepCode),
  ],
);

export const sysAiWorkflowWait = pgTable(
  "sys_ai_workflow_wait",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => sysAiWorkflowRun.id, { onDelete: "cascade" }),
    stepId: integer("step_id").references(() => sysAiWorkflowRunStep.id, {
      onDelete: "set null",
    }),
    nodeId: text("node_id").notNull(),
    waitType: text("wait_type", {
      enum: ["approval", "event", "timer", "child_workflow"],
    }).notNull(),
    childRunId: integer("child_run_id").references(() => sysAiWorkflowRun.id, {
      onDelete: "set null",
    }),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "resolved", "expired", "cancelled"],
    })
      .notNull()
      .default("pending"),
    correlationKey: text("correlation_key"),
    inputJson: text("input_json"),
    resolutionJson: text("resolution_json"),
    resumeAt: timestamp("resume_at", { withTimezone: true }),
    timeoutAt: timestamp("timeout_at", { withTimezone: true }),
    decidedBy: integer("decided_by").references(() => sysUser.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sys_ai_workflow_wait_run_node_pending_unique")
      .on(table.runId, table.nodeId)
      .where(sql`status = 'pending'`),
    index("sys_ai_workflow_wait_status_resume_idx").on(table.status, table.resumeAt),
    index("sys_ai_workflow_wait_correlation_idx").on(table.correlationKey, table.status),
    uniqueIndex("sys_ai_workflow_wait_child_pending_unique")
      .on(table.childRunId)
      .where(sql`child_run_id IS NOT NULL AND status = 'pending'`),
  ],
);

export const sysAiNotebookResearchCandidate = pgTable(
  "sys_ai_notebook_research_candidate",
  {
    id: serial("id").primaryKey(),
    notebookId: integer("notebook_id")
      .notNull()
      .references(() => sysAiNotebook.id, { onDelete: "cascade" }),
    workflowRunId: integer("workflow_run_id").references(() => sysAiWorkflowRun.id, {
      onDelete: "set null",
    }),
    queryText: text("query_text").notNull(),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    snippet: text("snippet"),
    source: text("source"),
    publishedAt: text("published_at"),
    status: text("status", {
      enum: ["candidate", "accepted", "pending", "parsing", "ready", "failed", "rejected"],
    })
      .notNull()
      .default("candidate"),
    documentId: integer("document_id").references(() => sysAiDocument.id, {
      onDelete: "set null",
    }),
    notebookSourceId: integer("notebook_source_id").references(() => sysAiNotebookSource.id, {
      onDelete: "set null",
    }),
    errorMessage: text("error_message"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_ai_notebook_research_candidate_url_unique")
      .on(table.notebookId, table.canonicalUrl)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_ai_notebook_research_candidate_notebook_status_idx").on(
      table.notebookId,
      table.status,
      table.createdAt,
    ),
    index("sys_ai_notebook_research_candidate_workflow_idx").on(table.workflowRunId),
  ],
);

export const sysAiMemory = pgTable(
  "sys_ai_memory",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    agentId: integer("agent_id").references(() => sysAiAgent.id, { onDelete: "cascade" }),
    scopeType: text("scope_type", { enum: ["user", "agent"] }).notNull(),
    content: text("content").notNull(),
    writePolicy: text("write_policy", { enum: ["manual", "confirmed"] })
      .notNull()
      .default("manual"),
    sourceSessionId: integer("source_session_id").references(() => sysAiChatSession.id, {
      onDelete: "set null",
    }),
    sourceMessageId: integer("source_message_id").references(() => sysAiChatMessage.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    importance: integer("importance").notNull().default(50),
    normalizedKey: text("normalized_key"),
    embeddingJson: text("embedding_json"),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    accessCount: integer("access_count").notNull().default(0),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    index("sys_ai_memory_user_agent_status_idx").on(
      table.userId,
      table.agentId,
      table.status,
      table.updatedAt,
    ),
    index("sys_ai_memory_expires_idx").on(table.expiresAt),
  ],
);

export const sysAiMemoryCandidate = pgTable(
  "sys_ai_memory_candidate",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    agentId: integer("agent_id").references(() => sysAiAgent.id, { onDelete: "cascade" }),
    sourceSessionId: integer("source_session_id").references(() => sysAiChatSession.id, {
      onDelete: "set null",
    }),
    sourceMessageId: integer("source_message_id").references(() => sysAiChatMessage.id, {
      onDelete: "set null",
    }),
    content: text("content").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    confidence: integer("confidence").notNull().default(80),
    status: text("status", { enum: ["proposed", "accepted", "rejected", "merged", "expired"] })
      .notNull()
      .default("proposed"),
    conflictGroup: text("conflict_group"),
    embeddingJson: text("embedding_json"),
    mergedMemoryId: integer("merged_memory_id").references(() => sysAiMemory.id, {
      onDelete: "set null",
    }),
    rejectionReason: text("rejection_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("sys_ai_memory_candidate_user_status_idx").on(table.userId, table.status, table.updatedAt),
    index("sys_ai_memory_candidate_key_idx").on(table.userId, table.normalizedKey),
  ],
);

export const sysAiRuntimeSkillVersion = pgTable(
  "sys_ai_runtime_skill_version",
  {
    id: serial("id").primaryKey(),
    skillId: integer("skill_id")
      .notNull()
      .references(() => sysAiRuntimeSkill.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    instructions: text("instructions").notNull(),
    toolIdsJson: text("tool_ids_json").notNull().default("[]"),
    agentIdsJson: text("agent_ids_json").notNull().default("[]"),
    compatibilityJson: text("compatibility_json").notNull().default("{}"),
    contentHash: text("content_hash").notNull(),
    status: text("status", { enum: ["draft", "published", "retired"] })
      .notNull()
      .default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: integer("created_by").references(() => sysUser.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sys_ai_runtime_skill_version_unique").on(table.skillId, table.version),
    index("sys_ai_runtime_skill_version_status_idx").on(table.skillId, table.status),
  ],
);

export const sysAiRuntimeSkill = pgTable(
  "sys_ai_runtime_skill",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    description: text("description"),
    instructions: text("instructions").notNull(),
    status: integer("status").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_ai_runtime_skill_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_ai_runtime_skill_status_sort_idx").on(table.status, table.sort, table.id),
  ],
);

export const sysAiRuntimeSkillTool = pgTable(
  "sys_ai_runtime_skill_tool",
  {
    skillId: integer("skill_id")
      .notNull()
      .references(() => sysAiRuntimeSkill.id, { onDelete: "cascade" }),
    toolId: integer("tool_id")
      .notNull()
      .references(() => sysAiTool.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.skillId, table.toolId] })],
);

export const sysAiAgentSkill = pgTable(
  "sys_ai_agent_skill",
  {
    agentId: integer("agent_id")
      .notNull()
      .references(() => sysAiAgent.id, { onDelete: "cascade" }),
    skillId: integer("skill_id")
      .notNull()
      .references(() => sysAiRuntimeSkill.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.agentId, table.skillId] })],
);

export const sysAiMcpServer = pgTable(
  "sys_ai_mcp_server",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    endpointUrl: text("endpoint_url").notNull(),
    transport: text("transport", { enum: ["streamable_http", "sse"] })
      .notNull()
      .default("streamable_http"),
    oauthMode: text("oauth_mode", {
      enum: ["none", "client_credentials", "authorization_code"],
    })
      .notNull()
      .default("none"),
    clientId: text("client_id"),
    clientSecretEncrypted: text("client_secret_encrypted"),
    authorizationUrl: text("authorization_url"),
    tokenUrl: text("token_url"),
    scopes: text("scopes"),
    status: text("status", { enum: ["draft", "active", "disabled", "error"] })
      .notNull()
      .default("draft"),
    lastError: text("last_error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
    ...auditUsers,
  },
  (table) => [
    uniqueIndex("sys_ai_mcp_server_code_active_unique")
      .on(table.code)
      .where(sql`${table.deletedAt} IS NULL`),
    index("sys_ai_mcp_server_status_idx").on(table.status, table.id),
  ],
);

export const sysAiMcpConnection = pgTable(
  "sys_ai_mcp_connection",
  {
    id: serial("id").primaryKey(),
    serverId: integer("server_id")
      .notNull()
      .references(() => sysAiMcpServer.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => sysUser.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["pending", "connected", "expired", "revoked", "error"],
    })
      .notNull()
      .default("pending"),
    stateHash: text("state_hash"),
    codeVerifierEncrypted: text("code_verifier_encrypted"),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenType: text("token_type"),
    scopes: text("scopes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeUrl: text("revoke_url"),
    remoteSessionId: text("remote_session_id"),
    capabilitiesJson: text("capabilities_json"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    index("sys_ai_mcp_connection_server_user_idx").on(table.serverId, table.userId, table.status),
  ],
);

export const sysAiMcpTool = pgTable(
  "sys_ai_mcp_tool",
  {
    id: serial("id").primaryKey(),
    serverId: integer("server_id")
      .notNull()
      .references(() => sysAiMcpServer.id, { onDelete: "cascade" }),
    remoteName: text("remote_name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    inputSchemaJson: text("input_schema_json"),
    riskLevel: text("risk_level", { enum: ["low", "medium", "high", "critical"] })
      .notNull()
      .default("medium"),
    approvalRequired: boolean("approval_required").notNull().default(true),
    allowlisted: boolean("allowlisted").notNull().default(false),
    status: integer("status").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    schemaHash: text("schema_hash"),
    lifecycle: text("lifecycle", { enum: ["discovered", "approved", "active", "stale", "revoked"] })
      .notNull()
      .default("discovered"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sys_ai_mcp_tool_server_remote_unique").on(table.serverId, table.remoteName),
    index("sys_ai_mcp_tool_server_status_idx").on(table.serverId, table.status, table.allowlisted),
  ],
);

export const sysAiMcpToolVersion = pgTable(
  "sys_ai_mcp_tool_version",
  {
    id: serial("id").primaryKey(),
    toolId: integer("tool_id")
      .notNull()
      .references(() => sysAiMcpTool.id, { onDelete: "cascade" }),
    schemaHash: text("schema_hash").notNull(),
    inputSchemaJson: text("input_schema_json"),
    description: text("description"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sys_ai_mcp_tool_version_hash_unique").on(table.toolId, table.schemaHash),
    index("sys_ai_mcp_tool_version_tool_idx").on(table.toolId, table.discoveredAt),
  ],
);

export const sysAiMcpSession = pgTable(
  "sys_ai_mcp_session",
  {
    id: serial("id").primaryKey(),
    serverId: integer("server_id")
      .notNull()
      .references(() => sysAiMcpServer.id, { onDelete: "cascade" }),
    connectionId: integer("connection_id").references(() => sysAiMcpConnection.id, {
      onDelete: "cascade",
    }),
    userId: integer("user_id").references(() => sysUser.id, { onDelete: "cascade" }),
    remoteSessionId: text("remote_session_id").notNull(),
    capabilitiesJson: text("capabilities_json").notNull().default("{}"),
    status: text("status", { enum: ["active", "stale", "closed"] }).notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sys_ai_mcp_session_scope_unique").on(table.serverId, table.userId),
    index("sys_ai_mcp_session_status_idx").on(table.status, table.updatedAt),
  ],
);

export const sysAiProgressEvent = pgTable(
  "sys_ai_progress_event",
  {
    id: serial("id").primaryKey(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    runId: integer("run_id"),
    eventType: text("event_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sys_ai_progress_event_resource_idx").on(table.resourceType, table.resourceId, table.id),
    index("sys_ai_progress_event_run_idx").on(table.runId, table.id),
  ],
);

export const sysAiProviderCircuit = pgTable(
  "sys_ai_provider_circuit",
  {
    providerId: integer("provider_id")
      .notNull()
      .references(() => sysAiProvider.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    state: text("state", { enum: ["closed", "open", "half_open"] })
      .notNull()
      .default("closed"),
    failureThreshold: integer("failure_threshold").notNull().default(3),
    cooldownMs: integer("cooldown_ms").notNull().default(60000),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    nextProbeAt: timestamp("next_probe_at", { withTimezone: true }),
    probeLeaseUntil: timestamp("probe_lease_until", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    lastErrorType: text("last_error_type"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.providerId, table.purpose] }),
    index("sys_ai_provider_circuit_state_probe_idx").on(table.state, table.nextProbeAt),
  ],
);

export const sysAiJob = pgTable(
  "sys_ai_job",
  {
    id: serial("id").primaryKey(),
    jobType: text("job_type").notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status", { enum: ["queued", "running", "completed", "failed", "cancelled"] })
      .notNull()
      .default("queued"),
    priority: integer("priority").notNull().default(100),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    idempotencyKey: text("idempotency_key"),
    userId: integer("user_id").references(() => sysUser.id, { onDelete: "set null" }),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    requestId: text("request_id"),
    resultJson: text("result_json"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sys_ai_job_idempotency_unique")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    index("sys_ai_job_claim_idx").on(table.status, table.availableAt, table.priority, table.id),
    index("sys_ai_job_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const sysAiQuotaPolicy = pgTable(
  "sys_ai_quota_policy",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    subjectType: text("subject_type", { enum: ["system", "department", "user"] }).notNull(),
    subjectId: integer("subject_id"),
    period: text("period", { enum: ["daily", "monthly"] })
      .notNull()
      .default("monthly"),
    maxInputTokens: integer("max_input_tokens"),
    maxOutputTokens: integer("max_output_tokens"),
    maxCost: text("max_cost"),
    currency: text("currency").notNull().default("USD"),
    status: integer("status").notNull().default(1),
    ...timestamps,
    createdBy: integer("created_by"),
    updatedBy: integer("updated_by"),
  },
  (table) => [
    uniqueIndex("sys_ai_quota_policy_subject_period_unique").on(
      table.subjectType,
      table.subjectId,
      table.period,
    ),
  ],
);

export const sysAiBillingLedger = pgTable(
  "sys_ai_billing_ledger",
  {
    id: serial("id").primaryKey(),
    invocationId: integer("invocation_id").references(() => sysAiInvocation.id, {
      onDelete: "set null",
    }),
    userId: integer("user_id").references(() => sysUser.id, { onDelete: "set null" }),
    providerId: integer("provider_id").references(() => sysAiProvider.id, { onDelete: "set null" }),
    modelId: integer("model_id").references(() => sysAiModel.id, { onDelete: "set null" }),
    purpose: text("purpose").notNull(),
    entryType: text("entry_type", { enum: ["usage", "adjustment"] })
      .notNull()
      .default("usage"),
    amount: text("amount").notNull(),
    currency: text("currency").notNull(),
    status: text("status", { enum: ["estimated", "confirmed", "void"] })
      .notNull()
      .default("estimated"),
    source: text("source").notNull().default("runtime_estimate"),
    description: text("description"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by"),
  },
  (table) => [
    uniqueIndex("sys_ai_billing_ledger_invocation_usage_unique")
      .on(table.invocationId)
      .where(sql`${table.entryType} = 'usage' AND ${table.invocationId} IS NOT NULL`),
    index("sys_ai_billing_ledger_user_occurred_idx").on(table.userId, table.occurredAt),
  ],
);

export const sysAiNotebookMember = pgTable(
  "sys_ai_notebook_member",
  {
    notebookId: integer("notebook_id")
      .notNull()
      .references(() => sysAiNotebook.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => sysUser.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["viewer", "editor"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: integer("created_by"),
  },
  (table) => [
    primaryKey({ columns: [table.notebookId, table.userId] }),
    index("sys_ai_notebook_member_user_idx").on(table.userId, table.notebookId),
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
