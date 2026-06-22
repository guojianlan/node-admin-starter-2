import type { Context, Hono } from "hono";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { PageResult } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import type { DbClient, db } from "@/server/db";

export type CrudAction =
  | "query"
  | "get"
  | "create"
  | "update"
  | "delete"
  | "batchDelete"
  | "restore"
  | "forceDelete"
  | "status"
  | "export"
  | "import";

export type CrudPermissions = {
  prefix: string;
  actions?: Partial<Record<CrudAction, string | false>>;
};

export type CrudSearchOperator = "=" | "like" | "betweenDate";

export type CrudJoin = {
  type: "left" | "inner";
  table: PgTable;
  on: SQL;
};

export type CrudListConfig = {
  select: Record<string, AnyPgColumn | SQL.Aliased | SQL>;
  searchable?: Record<string, CrudSearchOperator>;
  quickSearchFields?: string[];
  sortableFields?: string[];
  defaultSort?: {
    field: string;
    order: "asc" | "desc";
  };
  joins?: CrudJoin[];
  baseWhere?: SQL[];
};

export type CrudContext = {
  c: Context<{ Variables: HonoVariables }>;
  userId: number | null;
  db: typeof db;
  sql: DbClient;
};

export type CrudHooks<
  TCreate extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
> = {
  beforeList?: (ctx: CrudContext) => Promise<SQL | SQL[] | undefined> | SQL | SQL[] | undefined;
  afterList?: (
    ctx: CrudContext,
    page: PageResult<Record<string, unknown>>,
  ) => Promise<PageResult<Record<string, unknown>>> | PageResult<Record<string, unknown>>;
  beforeCreate?: (ctx: CrudContext, values: TCreate) => Promise<TCreate> | TCreate;
  afterCreate?: (ctx: CrudContext, id: number, values: TCreate) => Promise<void> | void;
  beforeUpdate?: (ctx: CrudContext, id: number, values: TUpdate) => Promise<TUpdate> | TUpdate;
  afterUpdate?: (ctx: CrudContext, id: number, values: TUpdate) => Promise<void> | void;
  beforeDelete?: (ctx: CrudContext, ids: number[]) => Promise<void> | void;
  afterDelete?: (ctx: CrudContext, ids: number[]) => Promise<void> | void;
  beforeRestore?: (ctx: CrudContext, ids: number[]) => Promise<void> | void;
  afterRestore?: (ctx: CrudContext, ids: number[]) => Promise<void> | void;
  beforeForceDelete?: (ctx: CrudContext, ids: number[]) => Promise<void> | void;
  afterForceDelete?: (ctx: CrudContext, ids: number[]) => Promise<void> | void;
};

export type CrudConfig<
  TCreate extends Record<string, unknown> = Record<string, unknown>,
  TUpdate extends Record<string, unknown> = Record<string, unknown>,
> = {
  basePath: string;
  table: PgTable;
  idColumn: AnyPgColumn;
  createSchema: z.ZodType<TCreate>;
  updateSchema: z.ZodType<TUpdate>;
  permissions: CrudPermissions;
  list: CrudListConfig;
  actions?: CrudAction[];
  softDelete?: boolean;
  audit?: boolean;
  transaction?: boolean;
  hooks?: CrudHooks<TCreate, TUpdate>;
  messages?: {
    create?: string;
    update?: string;
    delete?: string;
  };
};

export type CrudMeta = {
  basePath: string;
  permissionPrefix: string;
  actions: Record<string, string | false>;
};

export type CrudRouteDefinition = {
  routes: Hono<{ Variables: HonoVariables }>;
  meta: CrudMeta;
};
