import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { Eta } from "eta";
import prettier from "prettier";
import { z } from "zod";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const templateDir = join(repoRoot, "templates/module-crud");
const defaultOutputRoot = join(repoRoot, "tmp/generated/modules");

const crudActions = [
  "query",
  "get",
  "create",
  "update",
  "delete",
  "batchDelete",
  "restore",
  "forceDelete",
  "status",
  "export",
  "import",
] as const;

const fieldTypes = [
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

const valueTypes = [
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

const dbTypes = ["text", "integer", "boolean", "timestamp"] as const;

const defaultFields = [
  { name: "name", label: "名称", type: "text", required: true, search: true, quickSearch: true },
  { name: "code", label: "编码", type: "text", required: true, unique: true, search: true, quickSearch: true },
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
  { name: "sort", label: "排序", type: "integer", required: true, default: 0, sortable: true },
] satisfies InputField[];

const primitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const optionSchema = z
  .object({
    label: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
  })
  .strict();

const fieldSchema = z
  .object({
    name: z.string().regex(/^[a-z][A-Za-z0-9]*$/, "field name must be camelCase"),
    label: z.string().min(1),
    type: z.enum(fieldTypes).default("text"),
    dbType: z.enum(dbTypes).optional(),
    valueType: z.enum(valueTypes).optional(),
    column: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
    required: z.boolean().default(false),
    nullable: z.boolean().optional(),
    default: primitiveSchema.optional(),
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
    options: z.array(optionSchema).optional(),
  })
  .strict();

const configSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    domain: z.string().regex(/^[a-z][a-z0-9-]*$/).default("system"),
    table: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
    schemaName: z.string().regex(/^[a-z][A-Za-z0-9]*$/).optional(),
    permission: z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/).optional(),
    frontendPath: z.string().regex(/^\/[a-z0-9-/]+$/).optional(),
    backendBasePath: z.string().regex(/^\/[a-z0-9-/]+$/).optional(),
    apiPath: z.string().regex(/^\/api\/[a-z0-9-/]+$/).optional(),
    featureDir: z.string().regex(/^[a-z0-9-]+$/).optional(),
    componentName: z.string().regex(/^[A-Z][A-Za-z0-9]*Page$/).optional(),
    routeExportName: z.string().regex(/^[a-z][A-Za-z0-9]*Routes$/).optional(),
    parentId: z.number().int().positive().default(180),
    parentKey: z.string().default("system.settingsGroup"),
    seedBaseId: z.number().int().positive().optional(),
    icon: z.string().default("appstore"),
    order: z.number().int().default(100),
    actions: z.array(z.enum(crudActions)).default(["query", "create", "update", "delete", "batchDelete"]),
    fields: z.array(fieldSchema).optional(),
    includeSystemField: z.boolean().default(true),
    softDelete: z.boolean().default(true),
    audit: z.boolean().default(true),
    defaultSort: z
      .object({
        field: z.string().min(1),
        order: z.enum(["asc", "desc"]),
      })
      .optional(),
  })
  .strict();

type Primitive = z.infer<typeof primitiveSchema>;
type InputField = z.input<typeof fieldSchema>;
type ModuleConfig = z.infer<typeof configSchema>;
type FieldType = (typeof fieldTypes)[number];
type DbType = (typeof dbTypes)[number];
type ValueType = (typeof valueTypes)[number];

type NormalizedField = {
  name: string;
  column: string;
  label: string;
  type: FieldType;
  dbType: DbType;
  valueType: ValueType;
  required: boolean;
  nullable: boolean;
  defaultValue?: Primitive;
  unique: boolean;
  search: boolean;
  searchOperator: "=" | "like" | "betweenDate";
  quickSearch: boolean;
  sortable: boolean;
  table: boolean;
  select: boolean;
  form: boolean;
  create: boolean;
  update: boolean;
  width?: number;
  fullWidth: boolean;
  options?: Array<{ label: string; value: string | number | boolean }>;
  tsType: string;
  schemaLine: string;
  sqlColumnLine: string;
  zodLine: string;
  recordLine: string;
  columnLine: string;
};

type NormalizedModule = ModuleConfig & {
  words: string[];
  pascalName: string;
  camelName: string;
  kebabName: string;
  snakeName: string;
  table: string;
  schemaName: string;
  permission: string;
  frontendPath: string;
  backendBasePath: string;
  apiPath: string;
  featureDir: string;
  componentName: string;
  routeExportName: string;
  crudName: string;
  pageRouteName: string;
  appPageImportPath: string;
  routeFileName: string;
  defaultSort: { field: string; order: "asc" | "desc" };
  seedBaseId: number;
  fields: NormalizedField[];
  imports: {
    pgCore: string[];
    schemaHelpers: string[];
  };
  uniqueIndexes: string[];
  regularIndexes: string[];
  migrationIndexes: string[];
  listSelectLines: string[];
  searchableEntries: string[];
  quickSearchFields: string[];
  sortableFields: string[];
  optionConstants: string[];
  actionRuleEntries: Array<{ action: string; title: string; order: number }>;
  targetPaths: Record<string, string>;
  generatedConfig: Record<string, unknown>;
  blocks: {
    actionRules: string;
    listSelect: string;
    migrationColumns: string;
    migrationIndexes: string;
    optionConstants: string;
    recordFields: string;
    schemaFields: string;
    schemaIndexes: string;
    schemaSpreads: string;
    searchableEntries: string;
    tableColumns: string;
    zodFields: string;
  };
};

type TemplateTarget = {
  template: string;
  output: string;
};

const eta = new Eta({ autoEscape: false, autoTrim: false, useWith: true });

const exampleConfig = {
  name: "sms-config",
  title: "短信配置",
  description: "维护短信服务商、签名和模板参数",
  frontendPath: "/system/sms/config",
  parentId: 180,
  parentKey: "system.settingsGroup",
  icon: "message",
  order: 70,
  fields: [
    { name: "name", label: "配置名称", type: "text", required: true, search: true, quickSearch: true },
    { name: "provider", label: "服务商", type: "select", required: true, search: true, options: [{ label: "Webhook", value: "webhook" }] },
    { name: "endpoint", label: "Endpoint", type: "text", search: true },
    { name: "accessKey", label: "Access Key", type: "text", table: false },
    { name: "secretKey", label: "Secret Key", type: "text", valueType: "password", table: false, select: false },
    { name: "signature", label: "短信签名", type: "text" },
    { name: "status", label: "状态", type: "integer", valueType: "select", required: true, default: 1, search: true, options: [{ label: "启用", value: 1 }, { label: "停用", value: 0 }] },
    { name: "sort", label: "排序", type: "integer", required: true, default: 0, sortable: true },
    { name: "remark", label: "备注", type: "textarea", table: false },
  ],
};

function printHelp() {
  console.log(`Admin Base CRUD module generator

Usage:
  corepack pnpm generate:module -- --config ./module.config.json
  corepack pnpm generate:module -- --example

Options:
  -c, --config <path>   JSON module config.
      --out-dir <path> Output root. Default: tmp/generated/modules.
      --force          Remove the existing generated module directory first.
      --example        Print an example JSON config.
  -h, --help           Show this help.
`);
}

function splitWords(value: string) {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  if (!normalized) throw new Error("module name must include at least one word");
  return normalized.split(/\s+/).map((item) => item.toLowerCase());
}

function pascalCase(words: string[]) {
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}

function camelCase(words: string[]) {
  const pascal = pascalCase(words);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function kebabCase(words: string[]) {
  return words.join("-");
}

function snakeCase(words: string[]) {
  return words.join("_");
}

function camelToSnake(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function normalizePath(path: string) {
  return `/${path.split("/").filter(Boolean).join("/")}`;
}

function pathSegments(path: string) {
  return normalizePath(path).split("/").filter(Boolean);
}

function inferDbType(field: z.infer<typeof fieldSchema>): DbType {
  if (field.dbType) return field.dbType;
  if (field.type === "integer") return "integer";
  if (field.type === "boolean") return "boolean";
  if (field.type === "datetime" || field.type === "date") return "timestamp";
  return "text";
}

function inferValueType(field: z.infer<typeof fieldSchema>): ValueType {
  if (field.valueType) return field.valueType;
  if (field.type === "integer") return "digit";
  if (field.type === "boolean") return "switch";
  if (field.type === "json") return "textarea";
  if (field.type === "datetime") return "datetime";
  if (field.type === "date") return "date";
  return field.type;
}

function inferSearchOperator(field: z.infer<typeof fieldSchema>, dbType: DbType) {
  if (field.searchOperator) return field.searchOperator;
  if (dbType === "timestamp") return "betweenDate";
  if (dbType === "text") return "like";
  return "=";
}

function stringifyTs(value: Primitive | undefined) {
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function sqlLiteral(value: Primitive | undefined) {
  if (value === undefined) return "";
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function drizzleColumnFactory(dbType: DbType, column: string) {
  if (dbType === "integer") return `integer("${column}")`;
  if (dbType === "boolean") return `boolean("${column}")`;
  if (dbType === "timestamp") return `timestamp("${column}", { withTimezone: true })`;
  return `text("${column}")`;
}

function sqlColumnType(dbType: DbType) {
  if (dbType === "integer") return "INTEGER";
  if (dbType === "boolean") return "BOOLEAN";
  if (dbType === "timestamp") return "TIMESTAMPTZ";
  return "TEXT";
}

function zodExpression(field: z.infer<typeof fieldSchema>, dbType: DbType) {
  let expression: string;
  if (dbType === "integer") {
    expression = "z.coerce.number()";
  } else if (dbType === "boolean") {
    expression = "z.coerce.boolean()";
  } else if (dbType === "timestamp") {
    expression =
      'z.preprocess((value) => (value === "" || value === undefined ? undefined : value), z.coerce.date())';
  } else {
    expression = field.required ? "z.string().min(1)" : "z.string()";
  }

  if (!field.required && field.default === undefined) expression += ".optional().nullable()";
  if (field.default !== undefined) expression += `.default(${stringifyTs(field.default)})`;
  return expression;
}

function tsTypeFor(dbType: DbType, nullable: boolean) {
  const base = dbType === "integer" ? "number" : dbType === "boolean" ? "boolean" : "string";
  return nullable ? `${base} | null` : base;
}

function buildSchemaLine(field: z.infer<typeof fieldSchema>, dbType: DbType, nullable: boolean) {
  const pieces = [drizzleColumnFactory(dbType, field.column ?? camelToSnake(field.name))];
  if (!nullable) pieces.push(".notNull()");
  if (field.default !== undefined) {
    if (dbType === "timestamp" && field.default === "now") {
      pieces.push(".defaultNow()");
    } else {
      pieces.push(`.default(${stringifyTs(field.default)})`);
    }
  }
  return `    ${field.name}: ${pieces.join("")},`;
}

function buildSqlColumnLine(field: z.infer<typeof fieldSchema>, dbType: DbType, nullable: boolean) {
  const parts = [`  ${field.column ?? camelToSnake(field.name)} ${sqlColumnType(dbType)}`];
  if (!nullable) parts.push("NOT NULL");
  if (field.default !== undefined) {
    if (dbType === "timestamp" && field.default === "now") {
      parts.push("DEFAULT now()");
    } else {
      parts.push(`DEFAULT ${sqlLiteral(field.default)}`);
    }
  }
  return `${parts.join(" ")},`;
}

function withoutTrailingComma(value: string) {
  return value.replace(/,$/, "");
}

function withSqlColumnCommas(lines: string[]) {
  return lines
    .map((line, index) => `${withoutTrailingComma(line)}${index === lines.length - 1 ? "" : ","}`)
    .join("\n");
}

function buildColumnLine(field: NormalizedField) {
  const properties = [
    `title: ${JSON.stringify(field.label)}`,
    `dataIndex: ${JSON.stringify(field.name)}`,
  ];
  if (field.valueType !== "text") properties.push(`valueType: ${JSON.stringify(field.valueType)}`);
  if (field.required) properties.push("required: true");
  if (field.width) properties.push(`width: ${field.width}`);
  if (!field.search) properties.push("hideInSearch: true");
  if (!field.table) properties.push("hideInTable: true");
  if (!field.form) properties.push("hideInForm: true");
  if (!field.create) properties.push("hideInCreate: true");
  if (!field.update) properties.push("hideInUpdate: true");
  if (field.fullWidth) properties.push("fullWidth: true");
  if (field.options?.length) properties.push(`options: ${field.name}Options`);
  return `  { ${properties.join(", ")} },`;
}

function buildActionTitle(action: string, title: string) {
  const titles: Record<string, string> = {
    query: `查询${title}`,
    get: `查看${title}`,
    create: `新增${title}`,
    update: `编辑${title}`,
    delete: `删除${title}`,
    batchDelete: `批量删除${title}`,
    restore: `恢复${title}`,
    forceDelete: `彻底删除${title}`,
    status: "切换状态",
    export: `导出${title}`,
    import: `导入${title}`,
  };
  return titles[action] ?? `${action}${title}`;
}

async function resolveSeedBaseId(configured?: number) {
  if (configured) return configured;
  const seedPath = join(repoRoot, "src/server/db/seed/default-data.ts");
  try {
    const seed = await readFile(seedPath, "utf8");
    const ids = Array.from(seed.matchAll(/\bid:\s*(\d+)/g), (match) => Number(match[1]));
    const maxId = ids.length ? Math.max(...ids) : 190;
    return Math.ceil((maxId + 1) / 10) * 10;
  } catch {
    return 200;
  }
}

function normalizeField(input: z.infer<typeof fieldSchema>): NormalizedField {
  const dbType = inferDbType(input);
  const nullable = input.nullable ?? (!input.required && input.default === undefined);
  const normalized: NormalizedField = {
    name: input.name,
    column: input.column ?? camelToSnake(input.name),
    label: input.label,
    type: input.type,
    dbType,
    valueType: inferValueType(input),
    required: input.required,
    nullable,
    defaultValue: input.default,
    unique: input.unique,
    search: input.search ?? input.quickSearch,
    searchOperator: inferSearchOperator(input, dbType),
    quickSearch: input.quickSearch,
    sortable: input.sortable,
    table: input.table ?? true,
    select: input.select ?? true,
    form: input.form ?? true,
    create: input.create ?? true,
    update: input.update ?? true,
    width: input.width,
    fullWidth: input.fullWidth,
    options: input.options,
    tsType: tsTypeFor(dbType, nullable),
    schemaLine: buildSchemaLine(input, dbType, nullable),
    sqlColumnLine: buildSqlColumnLine(input, dbType, nullable),
    zodLine: `  ${input.name}: ${zodExpression(input, dbType)},`,
    recordLine: `  ${input.name}${nullable ? "?" : ""}: ${tsTypeFor(dbType, nullable)};`,
    columnLine: "",
  };
  normalized.columnLine = buildColumnLine(normalized);
  return normalized;
}

async function normalizeModule(rawConfig: unknown): Promise<NormalizedModule> {
  const parsed = configSchema.parse(rawConfig);
  const words = splitWords(parsed.name);
  const pascalName = pascalCase(words);
  const camelName = camelCase(words);
  const kebabName = kebabCase(words);
  const snakeName = snakeCase(words);
  const frontendPath = normalizePath(parsed.frontendPath ?? `/${parsed.domain}/${kebabName}`);
  const frontendSegments = pathSegments(frontendPath);
  const backendBasePath =
    parsed.backendBasePath ??
    normalizePath(frontendSegments[0] === parsed.domain ? frontendSegments.slice(1).join("/") : kebabName);
  const fields = (parsed.fields ?? defaultFields).map((field) => normalizeField(fieldSchema.parse(field)));
  const schemaName = parsed.schemaName ?? `sys${pascalName}`;
  const permission = parsed.permission ?? `${parsed.domain}.${words.join(".")}`;
  const featureDir = parsed.featureDir ?? kebabName;
  const componentName = parsed.componentName ?? `${pascalName}Page`;
  const routeExportName = parsed.routeExportName ?? `${camelName}Routes`;
  const seedBaseId = await resolveSeedBaseId(parsed.seedBaseId);
  const table = parsed.table ?? `sys_${snakeName}`;
  const apiPath = parsed.apiPath ?? `/api/${parsed.domain}${backendBasePath}`;
  const defaultSort =
    parsed.defaultSort ??
    (fields.find((field) => field.name === "sort")
      ? { field: "sort", order: "asc" as const }
      : { field: "id", order: "desc" as const });

  const pgCore = new Set(["pgTable", "serial"]);
  for (const field of fields) {
    if (field.dbType === "integer") pgCore.add("integer");
    if (field.dbType === "boolean") pgCore.add("boolean");
    if (field.dbType === "timestamp") pgCore.add("timestamp");
    if (field.dbType === "text") pgCore.add("text");
  }
  if (parsed.includeSystemField) pgCore.add("boolean");
  if (fields.some((field) => field.unique)) pgCore.add("uniqueIndex");
  if (fields.some((field) => field.search || field.sortable)) pgCore.add("index");

  const uniqueIndexes = fields
    .filter((field) => field.unique)
    .map((field) => {
      const name = `${table}_${field.column}_active_unique`;
      if (parsed.softDelete) {
        return `    uniqueIndex("${name}").on(table.${field.name}).where(sql\`\${table.deletedAt} IS NULL\`),`;
      }
      return `    uniqueIndex("${name}").on(table.${field.name}),`;
    });

  const regularIndexes = fields
    .filter((field) => !field.unique && (field.search || field.sortable))
    .map((field) => `    index("${table}_${field.column}_idx").on(table.${field.name}),`);

  const migrationIndexes = [
    ...fields
      .filter((field) => field.unique)
      .map((field) => {
        const where = parsed.softDelete ? "\n  WHERE deleted_at IS NULL" : "";
        return `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_${field.column}_active_unique\n  ON ${table}(${field.column})${where};`;
      }),
    ...fields
      .filter((field) => !field.unique && (field.search || field.sortable))
      .map((field) => {
        const where = parsed.softDelete ? "\n  WHERE deleted_at IS NULL" : "";
        return `CREATE INDEX IF NOT EXISTS ${table}_${field.column}_idx\n  ON ${table}(${field.column})${where};`;
      }),
  ];

  const optionConstants = fields
    .filter((field) => field.options?.length)
    .map(
      (field) =>
        `const ${field.name}Options = ${JSON.stringify(field.options, null, 2)};`,
    );

  const listSelectLines = [
    `      id: ${schemaName}.id,`,
    ...fields
      .filter((field) => field.select)
      .map((field) => `      ${field.name}: ${schemaName}.${field.name},`),
    parsed.includeSystemField ? `      isSystem: ${schemaName}.isSystem,` : "",
    `      createdAt: ${schemaName}.createdAt,`,
    parsed.audit ? `      updatedAt: ${schemaName}.updatedAt,` : "",
  ].filter(Boolean);

  const searchableEntries = fields
    .filter((field) => field.search)
    .map((field) => `      ${field.name}: ${JSON.stringify(field.searchOperator)},`);

  const quickSearchFields = fields.filter((field) => field.quickSearch).map((field) => field.name);
  const sortableFields = [
    "id",
    ...fields.filter((field) => field.sortable).map((field) => field.name),
    "createdAt",
  ];

  const appPath = join("src/app/(admin)", ...frontendSegments, "page.tsx");
  const featurePath = join("src/features", parsed.domain, featureDir, `${componentName}.tsx`);
  const routePath = join("src/server/routes", parsed.domain, `${kebabName}.ts`);
  const migrationColumnLines = [
    "  id SERIAL PRIMARY KEY",
    ...fields.map((field) => withoutTrailingComma(field.sqlColumnLine)),
    parsed.includeSystemField ? "  is_system BOOLEAN NOT NULL DEFAULT false" : "",
    "  created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    "  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    parsed.softDelete ? "  deleted_at TIMESTAMPTZ" : "",
    ...(parsed.audit
      ? [
          "  created_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL",
          "  updated_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL",
          "  deleted_by INTEGER REFERENCES sys_user(id) ON DELETE SET NULL",
        ]
      : []),
  ].filter(Boolean);
  const schemaSpreadLines = [
    parsed.includeSystemField ? '    isSystem: boolean("is_system").notNull().default(false),' : "",
    "    ...timestamps,",
    parsed.softDelete ? "    ...softDelete," : "",
    parsed.audit ? "    ...auditUsers," : "",
  ].filter(Boolean);
  const generatedConfigFields = fields.map((field) => {
    const output: Record<string, unknown> = {
      name: field.name,
      label: field.label,
      type: field.type,
    };
    if (field.dbType !== inferDbType(fieldSchema.parse(output))) output.dbType = field.dbType;
    if (field.valueType !== inferValueType(fieldSchema.parse(output))) output.valueType = field.valueType;
    if (field.column !== camelToSnake(field.name)) output.column = field.column;
    if (field.required) output.required = true;
    if (field.nullable !== (!field.required && field.defaultValue === undefined)) {
      output.nullable = field.nullable;
    }
    if (field.defaultValue !== undefined) output.default = field.defaultValue;
    if (field.unique) output.unique = true;
    if (field.search) output.search = true;
    if (field.searchOperator !== inferSearchOperator(fieldSchema.parse(output), field.dbType)) {
      output.searchOperator = field.searchOperator;
    }
    if (field.quickSearch) output.quickSearch = true;
    if (field.sortable) output.sortable = true;
    if (!field.table) output.table = false;
    if (!field.select) output.select = false;
    if (!field.form) output.form = false;
    if (!field.create) output.create = false;
    if (!field.update) output.update = false;
    if (field.width) output.width = field.width;
    if (field.fullWidth) output.fullWidth = true;
    if (field.options?.length) output.options = field.options;
    return output;
  });
  const generatedConfig = {
    name: parsed.name,
    title: parsed.title,
    description: parsed.description,
    domain: parsed.domain,
    table,
    schemaName,
    permission,
    frontendPath,
    backendBasePath,
    apiPath,
    featureDir,
    componentName,
    routeExportName,
    parentId: parsed.parentId,
    parentKey: parsed.parentKey,
    seedBaseId,
    icon: parsed.icon,
    order: parsed.order,
    actions: parsed.actions,
    includeSystemField: parsed.includeSystemField,
    softDelete: parsed.softDelete,
    audit: parsed.audit,
    defaultSort,
    fields: generatedConfigFields,
  };

  return {
    ...parsed,
    words,
    pascalName,
    camelName,
    kebabName,
    snakeName,
    table,
    schemaName,
    permission,
    frontendPath,
    backendBasePath,
    apiPath,
    featureDir,
    componentName,
    routeExportName,
    crudName: `${camelName}Crud`,
    pageRouteName: `${parsed.domain}${pascalName}Route`,
    appPageImportPath: `@/features/${parsed.domain}/${featureDir}/${componentName}`,
    routeFileName: kebabName,
    defaultSort,
    seedBaseId,
    fields,
    imports: {
      pgCore: Array.from(pgCore).sort(),
      schemaHelpers: ["timestamps", parsed.softDelete ? "softDelete" : "", parsed.audit ? "auditUsers" : ""].filter(Boolean),
    },
    uniqueIndexes,
    regularIndexes,
    migrationIndexes,
    listSelectLines,
    searchableEntries,
    quickSearchFields,
    sortableFields,
    optionConstants,
    actionRuleEntries: parsed.actions.map((action, index) => ({
      action,
      title: buildActionTitle(action, parsed.title),
      order: index + 1,
    })),
    targetPaths: {
      schema: "src/server/db/schema/index.ts",
      migration: "src/server/db/migrations.ts",
      route: routePath,
      systemRoute: `src/server/routes/${parsed.domain}/index.ts`,
      feature: featurePath,
      appPage: appPath,
      routeManifest: "src/router/route-manifest.ts",
      seedRule: "src/server/db/seed/default-data.ts",
      test: `tests/api/${kebabName}.test.ts`,
    },
    generatedConfig,
    blocks: {
      actionRules: parsed.actions
        .map((action) => `    ["${action}", "${buildActionTitle(action, parsed.title)}"],`)
        .join("\n"),
      listSelect: listSelectLines.join("\n"),
      migrationColumns: withSqlColumnCommas(migrationColumnLines),
      migrationIndexes: migrationIndexes.join("\n\n"),
      optionConstants: optionConstants.join("\n\n"),
      recordFields: fields.map((field) => field.recordLine).join("\n"),
      schemaFields: fields.map((field) => field.schemaLine).join("\n"),
      schemaIndexes: [...uniqueIndexes, ...regularIndexes].join("\n"),
      schemaSpreads: schemaSpreadLines.join("\n"),
      searchableEntries: searchableEntries.join("\n"),
      tableColumns: fields.map((field) => field.columnLine).join("\n"),
      zodFields: fields.map((field) => field.zodLine).join("\n"),
    },
  };
}

function toTemplateTargets(moduleDraft: NormalizedModule): TemplateTarget[] {
  return [
    { template: "README.md.eta", output: "README.md" },
    { template: "module.config.json.eta", output: "module.config.json" },
    { template: "schema.ts.eta", output: "snippets/schema.entry.ts" },
    { template: "migration.sql.eta", output: "snippets/migration.sql" },
    { template: "seed-rule.ts.eta", output: "snippets/seed-rule.entry.ts" },
    { template: "route-manifest.ts.eta", output: "snippets/route-manifest.entry.ts" },
    { template: "system-route.ts.eta", output: "snippets/system-route.entry.ts" },
    { template: "route.ts.eta", output: moduleDraft.targetPaths.route },
    { template: "page.tsx.eta", output: moduleDraft.targetPaths.feature },
    { template: "app-page.tsx.eta", output: moduleDraft.targetPaths.appPage },
    { template: "test.ts.eta", output: moduleDraft.targetPaths.test },
  ];
}

async function readJson(path: string) {
  const content = await readFile(path, "utf8");
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function formatOutput(content: string, outputPath: string) {
  const config = (await prettier.resolveConfig(repoRoot)) ?? {};
  try {
    return await prettier.format(content, { ...config, filepath: outputPath });
  } catch {
    return content.endsWith("\n") ? content : `${content}\n`;
  }
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function renderTarget(
  moduleDraft: NormalizedModule,
  target: TemplateTarget,
  moduleOutputRoot: string,
) {
  const template = await readFile(join(templateDir, target.template), "utf8");
  const raw = eta.renderString(template, { module: moduleDraft });
  const outputPath = join(moduleOutputRoot, target.output);
  const formatted = await formatOutput(raw, outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, formatted);
  return outputPath;
}

async function generateModule(input: {
  configPath: string;
  outDir: string;
  force: boolean;
}) {
  const rawConfig = await readJson(input.configPath);
  const moduleDraft = await normalizeModule(rawConfig);
  const moduleOutputRoot = join(resolve(input.outDir), moduleDraft.kebabName);
  if (await pathExists(moduleOutputRoot)) {
    if (!input.force) {
      throw new Error(`output already exists: ${moduleOutputRoot}. Re-run with --force to replace it.`);
    }
    await rm(moduleOutputRoot, { recursive: true, force: true });
  }

  const targets = toTemplateTargets(moduleDraft);
  const written = [];
  for (const target of targets) {
    written.push(await renderTarget(moduleDraft, target, moduleOutputRoot));
  }

  console.log(
    `Generated ${moduleDraft.title} module draft at ${relative(repoRoot, moduleOutputRoot)}`,
  );
  for (const file of written) {
    console.log(`- ${relative(repoRoot, file)}`);
  }
}

async function main() {
  const cliArgs = process.argv.slice(2);
  const normalizedArgs = cliArgs[0] === "--" ? cliArgs.slice(1) : cliArgs;
  const { values } = parseArgs({
    args: normalizedArgs,
    options: {
      config: { type: "string", short: "c" },
      "out-dir": { type: "string" },
      force: { type: "boolean", default: false },
      example: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  if (values.example) {
    console.log(JSON.stringify(exampleConfig, null, 2));
    return;
  }

  if (!values.config) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  try {
    await generateModule({
      configPath: resolve(String(values.config)),
      outDir: resolve(String(values["out-dir"] ?? defaultOutputRoot)),
      force: Boolean(values.force),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

await main();
