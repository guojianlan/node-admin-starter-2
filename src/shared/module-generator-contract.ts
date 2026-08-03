import { z } from "zod";

export const adminModuleCrudActions = [
  "query",
  "create",
  "update",
  "delete",
  "batchDelete",
  "restore",
  "forceDelete",
  "status",
] as const;

export const adminModuleFieldTypes = [
  "text",
  "textarea",
  "richText",
  "integer",
  "boolean",
  "select",
  "datetime",
  "date",
  "image",
  "json",
] as const;

export const adminModuleValueTypes = [
  "text",
  "password",
  "textarea",
  "richText",
  "digit",
  "select",
  "treeSelect",
  "radio",
  "radioButton",
  "switch",
  "date",
  "datetime",
  "dateRange",
  "image",
] as const;

export const adminModuleDbTypes = ["text", "integer", "boolean", "timestamp"] as const;

export const adminModulePrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const adminModuleOptionSchema = z
  .object({
    label: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })
  .strict();

export const adminModuleFieldSchema = z
  .object({
    name: z
      .string()
      .max(48)
      .regex(/^[a-z][A-Za-z0-9]*$/, "field name must be camelCase"),
    label: z.string().min(1),
    type: z.enum(adminModuleFieldTypes).default("text"),
    dbType: z.enum(adminModuleDbTypes).optional(),
    valueType: z.enum(adminModuleValueTypes).optional(),
    column: z
      .string()
      .max(48)
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    required: z.boolean().default(false),
    nullable: z.boolean().optional(),
    default: adminModulePrimitiveSchema.optional(),
    unique: z.boolean().default(false),
    search: z.boolean().optional(),
    searchOperator: z.enum(["=", "like", "betweenDate"]).optional(),
    quickSearch: z.boolean().default(false),
    sortable: z.boolean().default(false),
    table: z.boolean().optional(),
    select: z.boolean().optional(),
    form: z.boolean().optional(),
    create: z.boolean().optional(),
    update: z.boolean().optional(),
    width: z.number().int().positive().optional(),
    fullWidth: z.boolean().default(false),
    options: z.array(adminModuleOptionSchema).optional(),
  })
  .strict();

export const defaultAdminModuleFields = [
  {
    name: "name",
    label: "名称",
    type: "text",
    required: true,
    search: true,
    quickSearch: true,
  },
  {
    name: "code",
    label: "编码",
    type: "text",
    required: true,
    unique: true,
    search: true,
    quickSearch: true,
  },
  { name: "remark", label: "备注", type: "textarea", table: false },
  {
    name: "status",
    label: "状态",
    type: "integer",
    valueType: "select",
    required: true,
    default: 1,
    search: true,
    options: [
      { label: "启用", value: 1 },
      { label: "停用", value: 0 },
    ],
  },
  {
    name: "sort",
    label: "排序",
    type: "integer",
    required: true,
    default: 0,
    sortable: true,
  },
] satisfies z.input<typeof adminModuleFieldSchema>[];

const reservedAdminModuleFields = new Set([
  "id",
  "isSystem",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "createdBy",
  "updatedBy",
  "deletedBy",
]);

export const adminModuleConfigSchema = z
  .object({
    contractVersion: z.literal(1).default(1),
    name: z
      .string()
      .min(1)
      .max(48)
      .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, "module name must be kebab-case"),
    title: z.string().min(1),
    description: z.string().optional(),
    domain: z
      .string()
      .regex(/^[a-z][a-z0-9-]*$/)
      .default("system"),
    table: z
      .string()
      .max(63)
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional(),
    schemaName: z
      .string()
      .regex(/^[a-z][A-Za-z0-9]*$/)
      .optional(),
    permission: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/)
      .optional(),
    frontendPath: z
      .string()
      .regex(/^\/[a-z0-9-/]+$/)
      .optional(),
    backendBasePath: z
      .string()
      .regex(/^\/[a-z0-9-/]+$/)
      .optional(),
    apiPath: z
      .string()
      .regex(/^\/api\/[a-z0-9-/]+$/)
      .optional(),
    featureDir: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
    componentName: z
      .string()
      .regex(/^[A-Z][A-Za-z0-9]*Page$/)
      .optional(),
    routeExportName: z
      .string()
      .regex(/^[a-z][A-Za-z0-9]*Routes$/)
      .optional(),
    parentId: z.number().int().positive().default(180),
    parentKey: z.string().default("system.settingsGroup"),
    seedBaseId: z.number().int().positive().optional(),
    icon: z.string().default("appstore"),
    order: z.number().int().default(100),
    actions: z
      .array(z.enum(adminModuleCrudActions))
      .min(1)
      .refine((actions) => new Set(actions).size === actions.length, "actions must be unique")
      .default(["query", "create", "update", "delete", "batchDelete"]),
    fields: z.array(adminModuleFieldSchema).min(1).optional(),
    includeSystemField: z.boolean().default(true),
    softDelete: z.boolean().default(true),
    audit: z.boolean().default(true),
    defaultSort: z
      .object({
        field: z.string().min(1),
        order: z.enum(["asc", "desc"]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((config, context) => {
    if (!config.actions.includes("query")) {
      context.addIssue({
        code: "custom",
        path: ["actions"],
        message: "query action is required because every generated CRUD route exposes a list API",
      });
    }

    for (const action of ["batchDelete", "restore", "forceDelete"] as const) {
      if (config.actions.includes(action) && !config.actions.includes("delete")) {
        context.addIssue({
          code: "custom",
          path: ["actions"],
          message: `${action} requires delete because generated delete-family APIs share the delete ability`,
        });
      }
    }
    if (config.actions.includes("restore") && !config.softDelete) {
      context.addIssue({
        code: "custom",
        path: ["softDelete"],
        message: "restore requires softDelete=true",
      });
    }

    const fields =
      config.fields ?? defaultAdminModuleFields.map((field) => adminModuleFieldSchema.parse(field));
    const tableName = config.table ?? `sys_${config.name.replaceAll("-", "_")}`;
    const names = new Set<string>();
    const columns = new Set<string>();
    for (const [index, field] of fields.entries()) {
      const column =
        field.column ?? field.name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
      if (reservedAdminModuleFields.has(field.name)) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "name"],
          message: `${field.name} is reserved by the generated system fields`,
        });
      }
      if (names.has(field.name)) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "name"],
          message: `duplicate field name: ${field.name}`,
        });
      }
      if (columns.has(column)) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "column"],
          message: `duplicate database column: ${column}`,
        });
      }
      names.add(field.name);
      columns.add(column);
      if (field.unique || field.search || field.sortable) {
        const suffix = field.unique ? "_active_unique" : "_idx";
        const indexName = `${tableName}_${column}${suffix}`;
        if (indexName.length > 63) {
          context.addIssue({
            code: "custom",
            path: ["fields", index, "column"],
            message: `generated PostgreSQL index name exceeds 63 characters: ${indexName}`,
          });
        }
      }
    }

    if (config.actions.includes("status")) {
      const statusField = fields.find((field) => field.name === "status");
      const statusDbType =
        statusField?.dbType ?? (statusField?.type === "integer" ? "integer" : undefined);
      if (statusDbType !== "integer") {
        context.addIssue({
          code: "custom",
          path: ["actions"],
          message: "status action requires an integer status field",
        });
      }
    }

    if (
      config.defaultSort &&
      config.defaultSort.field !== "id" &&
      !names.has(config.defaultSort.field)
    ) {
      context.addIssue({
        code: "custom",
        path: ["defaultSort", "field"],
        message: `defaultSort field does not exist: ${config.defaultSort.field}`,
      });
    }
  });

export type AdminModulePrimitive = z.infer<typeof adminModulePrimitiveSchema>;
export type AdminModuleFieldInput = z.input<typeof adminModuleFieldSchema>;
export type AdminModuleField = z.infer<typeof adminModuleFieldSchema>;
export type AdminModuleConfig = z.infer<typeof adminModuleConfigSchema>;
export type AdminModuleFieldType = (typeof adminModuleFieldTypes)[number];
export type AdminModuleDbType = (typeof adminModuleDbTypes)[number];
export type AdminModuleValueType = (typeof adminModuleValueTypes)[number];

const zodJsonSchema = z.toJSONSchema(adminModuleConfigSchema, {
  target: "draft-2020-12",
});

export const adminModuleJsonSchema = {
  ...zodJsonSchema,
  $id: "https://admin-base.local/schemas/admin-module.schema.json",
  title: "Admin Base Module Contract",
  description:
    "Machine-readable contract shared by the Admin Base CLI, Web generator, and coding-agent workflow.",
};

export const adminModuleGeneratorCapabilities = {
  contractVersion: 1,
  schemaPath: "schemas/admin-module.schema.json",
  schemaId: adminModuleJsonSchema.$id,
  draft: {
    moduleTypes: ["crud"],
    domains: "any-kebab-case-domain",
    actions: adminModuleCrudActions,
    builtInPageActions: ["query", "create", "update", "delete"],
    customUiRequiredActions: ["batchDelete", "restore", "forceDelete", "status"],
    abilityAliases: {
      batchDelete: "delete",
      restore: "delete",
      forceDelete: "delete",
    },
    fieldTypes: adminModuleFieldTypes,
    valueTypes: adminModuleValueTypes,
    dbTypes: adminModuleDbTypes,
  },
  publish: {
    supportedDomains: ["system"],
    productionAllowed: false,
    diffRequired: true,
    isolatedPreflight: true,
    rollbackMetadata: true,
    rollbackProtectsManualChanges: true,
  },
  generated: {
    schema: true,
    migration: true,
    seedRules: true,
    routeManifest: true,
    backendRoute: true,
    featurePage: true,
    appRouterPage: true,
    apiTest: true,
  },
  extensions: {
    simpleDataScope: "manual-extension",
    relationships: "manual-extension",
    dictionaryFields: "manual-extension",
    fileRelations: "manual-extension",
    treeModules: "manual-extension",
    masterDetail: "manual-extension",
    workflow: "manual-extension",
    customActions: "manual-extension",
    providerSecrets: "explicit-route-service",
  },
  ownership: {
    draft: "generator-owned",
    published: "repository-owned",
    regeneration: "diff-only-no-overwrite",
  },
} as const;

export function parseAdminModuleConfig(input: unknown) {
  return adminModuleConfigSchema.parse(input);
}
