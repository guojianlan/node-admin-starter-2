import { and, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createDbClient, db, schema, sql, sqlite, type DbClient } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildDataScopeCondition, resolveDataScope } from "@/server/services/data-scope";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { buildCrudListQuery } from "./list-query";
import { createCrudMeta, resolveCrudPermission, validateCrudMeta } from "./permissions";
import { registerCrudMeta } from "./registry";
import type { CrudAction, CrudConfig, CrudContext, CrudDataScopeConfig } from "./types";

const defaultActions: CrudAction[] = ["query", "create", "update", "delete", "batchDelete"];

function routePath(path: string) {
  return path as never;
}

function crudContext(
  c: Context<{ Variables: HonoVariables }>,
  activeDb: typeof db = db,
  activeSql: DbClient = sqlite,
): CrudContext {
  return {
    c,
    userId: c.get("user")?.id ?? null,
    db: activeDb,
    sql: activeSql,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getColumn(table: unknown, field: string) {
  return asRecord(table)[field];
}

function getColumnField(table: unknown, column: unknown) {
  return Object.entries(asRecord(table)).find(([, value]) => value === column)?.[0];
}

function mapValuesToColumns(table: unknown, values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([key, value]) => value !== undefined && getColumn(table, key)),
  );
}

function addAuditValues(input: {
  table: unknown;
  values: Record<string, unknown>;
  userId: number | null;
  mode: "create" | "update" | "delete";
  enabled: boolean;
}) {
  const { table, values, userId, mode, enabled } = input;
  const nextValues = { ...values };
  if (!enabled || userId == null) return nextValues;

  if (mode === "create" && getColumn(table, "createdBy")) nextValues.createdBy = userId;
  if ((mode === "create" || mode === "update") && getColumn(table, "updatedBy"))
    nextValues.updatedBy = userId;
  if (mode === "delete" && getColumn(table, "deletedBy")) nextValues.deletedBy = userId;
  return nextValues;
}

function readId(value: string) {
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) throw new Error("记录不存在");
  return id;
}

function readIds(value: unknown) {
  const ids = (Array.isArray(value) ? value : [value])
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0);
  if (!ids.length) throw new Error("请选择记录");
  return [...new Set(ids)];
}

function normalizeWhere(value: SQL | SQL[] | undefined) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function resolveCrudDataScopeWhere(
  ctx: CrudContext,
  dataScope: CrudDataScopeConfig | false | undefined,
) {
  if (!dataScope) return [];
  const scope = await resolveDataScope(ctx.c);
  return normalizeWhere(buildDataScopeCondition(scope, dataScope));
}

class CrudRecordAccessError extends Error {
  status = 404;

  constructor() {
    super("记录不存在或无数据权限");
  }
}

class CrudAssignmentAccessError extends Error {
  status = 403;

  constructor(message: string) {
    super(message);
  }
}

type CrudRecordState = "active" | "deleted" | "any";

async function assertScopedAssignments<
  TCreate extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
>(input: {
  config: CrudConfig<TCreate, TUpdate>;
  ctx: CrudContext;
  values: Record<string, unknown>;
}) {
  const { config, ctx, values } = input;
  if (!config.dataScope) return;
  const scope = await resolveDataScope(ctx.c);
  if (scope.kind === "all") return;

  const deptField = config.dataScope.deptId
    ? getColumnField(config.table, config.dataScope.deptId)
    : undefined;
  if (deptField && Object.hasOwn(values, deptField)) {
    const deptId = Number(values[deptField]);
    if (!Number.isFinite(deptId) || !scope.deptIds.includes(deptId)) {
      throw new CrudAssignmentAccessError("目标部门不在当前数据范围内");
    }
  }

  const ownerColumn = config.dataScope.ownerId ?? config.dataScope.userId;
  const ownerField = ownerColumn ? getColumnField(config.table, ownerColumn) : undefined;
  if (!ownerField || !Object.hasOwn(values, ownerField)) return;

  const ownerId = Number(values[ownerField]);
  if (!Number.isFinite(ownerId)) {
    throw new CrudAssignmentAccessError("目标负责人不在当前数据范围内");
  }
  if (scope.selfOnly && ownerId === scope.userId) return;
  if (!scope.deptIds.length) {
    throw new CrudAssignmentAccessError("目标负责人不在当前数据范围内");
  }
  const placeholders = scope.deptIds.map(() => "?").join(", ");
  const owner = await ctx.sql
    .prepare(
      `SELECT id
       FROM sys_user
       WHERE id = ?
         AND dept_id IN (${placeholders})
         AND deleted_at IS NULL
       LIMIT 1`,
    )
    .get(ownerId, ...scope.deptIds);
  if (!owner) throw new CrudAssignmentAccessError("目标负责人不在当前数据范围内");
}

async function resolveScopedRecords<
  TCreate extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
>(input: {
  config: CrudConfig<TCreate, TUpdate>;
  ctx: CrudContext;
  ids: number[];
  softDeleteColumn: AnyPgColumn | null;
  state?: CrudRecordState;
}) {
  const { config, ctx, ids, softDeleteColumn, state = "active" } = input;
  const scopeWhere = await resolveCrudDataScopeWhere(ctx, config.dataScope);
  const stateWhere =
    !softDeleteColumn || state === "any"
      ? []
      : [state === "deleted" ? isNotNull(softDeleteColumn) : isNull(softDeleteColumn)];
  const where = and(inArray(config.idColumn, ids), ...scopeWhere, ...stateWhere) as SQL;
  const rows = (await ctx.db.select().from(config.table).where(where)) as Array<
    Record<string, unknown>
  >;
  const idField = getColumnField(config.table, config.idColumn);
  if (!idField) throw new Error(`CRUD ${config.basePath}: id column is not part of the table`);
  const rowIds = new Set(rows.map((row) => Number(row[idField])));
  if (rowIds.size !== ids.length || ids.some((id) => !rowIds.has(id))) {
    throw new CrudRecordAccessError();
  }
  return { rows, where };
}

function operationModule<
  TCreate extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
>(config: CrudConfig<TCreate, TUpdate>) {
  return config.permissions.prefix;
}

function mutationFields(values: Record<string, unknown>) {
  return Object.keys(values).filter((field) => !field.toLowerCase().includes("password"));
}

type ChangedField = {
  field: string;
  before: unknown;
  after: unknown;
};

function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ChangedField[] {
  return Object.entries(after)
    .filter(([, value]) => value !== undefined)
    .filter(([field, value]) => JSON.stringify(before[field]) !== JSON.stringify(value))
    .map(([field, value]) => ({ field, before: before[field] ?? null, after: value ?? null }));
}

async function runMutation<
  TCreate extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
  T,
>(
  config: CrudConfig<TCreate, TUpdate>,
  callback: (activeDb: typeof db, activeSql: DbClient) => Promise<T>,
) {
  if (config.transaction !== true) return callback(db, sqlite);
  return sql.begin(async (transaction) => {
    const txDb = drizzle(transaction as never, { schema }) as typeof db;
    const txSql = createDbClient(transaction);
    return callback(txDb, txSql);
  });
}

function withPermission<
  TCreate extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
>(
  config: CrudConfig<TCreate, TUpdate>,
  action: CrudAction,
):
  | [MiddlewareHandler<{ Variables: HonoVariables }>]
  | [
      MiddlewareHandler<{ Variables: HonoVariables }>,
      MiddlewareHandler<{ Variables: HonoVariables }>,
    ] {
  const permission = resolveCrudPermission(config.permissions, action);
  if (permission === undefined) {
    throw new Error(`CRUD action ${config.basePath}:${action} is missing permission`);
  }
  return permission === false ? [authRequired()] : [authRequired(), ability(permission)];
}

export function createCrudRoutes<
  TCreate extends Record<string, unknown>,
  TUpdate extends Record<string, unknown>,
>(config: CrudConfig<TCreate, TUpdate>) {
  const actions = config.actions ?? defaultActions;
  const meta = createCrudMeta({
    basePath: config.basePath,
    permissions: config.permissions,
    actions,
  });
  validateCrudMeta(meta);
  registerCrudMeta(meta);

  const routes = new Hono<{ Variables: HonoVariables }>();
  const softDeleteColumn =
    config.softDelete === false
      ? null
      : ((getColumn(config.table, "deletedAt") as AnyPgColumn) ?? null);
  const basePath = routePath(config.basePath);
  const idPath = routePath(`${config.basePath}/:id`);

  routes.get(basePath, ...withPermission(config, "query"), async (c) => {
    const ctx = crudContext(c);
    const extraWhere = [
      ...(await resolveCrudDataScopeWhere(ctx, config.dataScope)),
      ...normalizeWhere(await config.hooks?.beforeList?.(ctx)),
    ];
    const page = await buildCrudListQuery(c.req.url, config.table, config.list, {
      softDeleteColumn,
      extraWhere,
    });
    const nextPage = config.hooks?.afterList
      ? await config.hooks.afterList(ctx, page as never)
      : page;
    return c.json(success(nextPage));
  });

  if (actions.includes("create")) {
    routes.post(basePath, ...withPermission(config, "create"), async (c) => {
      const rawValues = config.createSchema.parse(await c.req.json());
      await runWithOperationLog(
        c,
        {
          module: operationModule(config),
          action: "create",
          resource: config.basePath,
          details: { fields: mutationFields(rawValues) },
        },
        async () => {
          let createdId = 0;
          await runMutation(config, async (activeDb, activeSql) => {
            const ctx = crudContext(c, activeDb, activeSql);
            const hookValues = config.hooks?.beforeCreate
              ? await config.hooks.beforeCreate(ctx, rawValues)
              : rawValues;
            await assertScopedAssignments({ config, ctx, values: hookValues });
            const values = mapValuesToColumns(
              config.table,
              addAuditValues({
                table: config.table,
                values: hookValues,
                userId: ctx.userId,
                mode: "create",
                enabled: config.audit !== false,
              }),
            );
            const rows = await activeDb
              .insert(config.table)
              .values(values as never)
              .returning({ id: config.idColumn });
            createdId = Number(rows[0]?.id ?? 0);
            await config.hooks?.afterCreate?.(ctx, createdId, hookValues);
          });
          return createdId;
        },
      );
      return c.json(success(null, config.messages?.create ?? "创建成功"));
    });
  }

  if (actions.includes("update")) {
    routes.put(idPath, ...withPermission(config, "update"), async (c) => {
      const id = readId(c.req.param("id") ?? "");
      const rawValues = config.updateSchema.parse(await c.req.json());
      const operationDetails: {
        fields: string[];
        changedFields: ChangedField[];
      } = {
        fields: mutationFields(rawValues),
        changedFields: [],
      };
      await runWithOperationLog(
        c,
        {
          module: operationModule(config),
          action: "update",
          resource: config.basePath,
          resourceId: id,
          details: operationDetails,
        },
        async () => {
          await runMutation(config, async (activeDb, activeSql) => {
            const ctx = crudContext(c, activeDb, activeSql);
            const { rows: current, where } = await resolveScopedRecords({
              config,
              ctx,
              ids: [id],
              softDeleteColumn,
            });
            const hookValues = config.hooks?.beforeUpdate
              ? await config.hooks.beforeUpdate(ctx, id, rawValues)
              : rawValues;
            await assertScopedAssignments({ config, ctx, values: hookValues });
            operationDetails.changedFields = changedFields(current[0] ?? {}, hookValues);
            const values = mapValuesToColumns(
              config.table,
              addAuditValues({
                table: config.table,
                values: hookValues,
                userId: ctx.userId,
                mode: "update",
                enabled: config.audit !== false,
              }),
            );
            if (Object.keys(values).length) {
              await activeDb
                .update(config.table)
                .set(values as never)
                .where(where);
            }
            await config.hooks?.afterUpdate?.(ctx, id, hookValues);
          });
        },
      );
      return c.json(success(null, config.messages?.update ?? "更新成功"));
    });
  }

  if (actions.includes("delete")) {
    routes.delete(idPath, ...withPermission(config, "delete"), async (c) => {
      const id = readId(c.req.param("id") ?? "");
      await runWithOperationLog(
        c,
        {
          module: operationModule(config),
          action: "delete",
          resource: config.basePath,
          resourceId: id,
        },
        async () => {
          await runMutation(config, async (activeDb, activeSql) => {
            const ctx = crudContext(c, activeDb, activeSql);
            const { where } = await resolveScopedRecords({
              config,
              ctx,
              ids: [id],
              softDeleteColumn,
            });
            await config.hooks?.beforeDelete?.(ctx, [id]);

            if (softDeleteColumn) {
              const values = mapValuesToColumns(
                config.table,
                addAuditValues({
                  table: config.table,
                  values: { deletedAt: new Date() },
                  userId: ctx.userId,
                  mode: "delete",
                  enabled: config.audit !== false,
                }),
              );
              await activeDb
                .update(config.table)
                .set(values as never)
                .where(where);
            } else {
              await activeDb.delete(config.table).where(where);
            }

            await config.hooks?.afterDelete?.(ctx, [id]);
          });
        },
      );
      return c.json(success(null, config.messages?.delete ?? "删除成功"));
    });
  }

  if (actions.includes("batchDelete")) {
    routes.post(
      routePath(`${config.basePath}/batch-delete`),
      ...withPermission(config, "batchDelete"),
      async (c) => {
        const ids = readIds((await c.req.json()).ids);
        await runWithOperationLog(
          c,
          {
            module: operationModule(config),
            action: "batchDelete",
            resource: config.basePath,
            details: { ids },
          },
          async () => {
            await runMutation(config, async (activeDb, activeSql) => {
              const ctx = crudContext(c, activeDb, activeSql);
              const { where } = await resolveScopedRecords({
                config,
                ctx,
                ids,
                softDeleteColumn,
              });
              await config.hooks?.beforeDelete?.(ctx, ids);

              if (softDeleteColumn) {
                const values = mapValuesToColumns(
                  config.table,
                  addAuditValues({
                    table: config.table,
                    values: { deletedAt: new Date() },
                    userId: ctx.userId,
                    mode: "delete",
                    enabled: config.audit !== false,
                  }),
                );
                await activeDb
                  .update(config.table)
                  .set(values as never)
                  .where(where);
              } else {
                await activeDb.delete(config.table).where(where);
              }

              await config.hooks?.afterDelete?.(ctx, ids);
            });
          },
        );
        return c.json(success(null, config.messages?.delete ?? "删除成功"));
      },
    );
  }

  if (actions.includes("restore")) {
    if (!softDeleteColumn) {
      throw new Error(`CRUD ${config.basePath}: restore requires soft delete column`);
    }
    routes.put(
      routePath(`${config.basePath}/restore/:id`),
      ...withPermission(config, "restore"),
      async (c) => {
        const id = readId(c.req.param("id") ?? "");
        await runWithOperationLog(
          c,
          {
            module: operationModule(config),
            action: "restore",
            resource: config.basePath,
            resourceId: id,
          },
          async () => {
            await runMutation(config, async (activeDb, activeSql) => {
              const ctx = crudContext(c, activeDb, activeSql);
              const { where } = await resolveScopedRecords({
                config,
                ctx,
                ids: [id],
                softDeleteColumn,
                state: "deleted",
              });
              await config.hooks?.beforeRestore?.(ctx, [id]);
              const values = mapValuesToColumns(
                config.table,
                addAuditValues({
                  table: config.table,
                  values: { deletedAt: null, deletedBy: null },
                  userId: ctx.userId,
                  mode: "update",
                  enabled: config.audit !== false,
                }),
              );
              await activeDb
                .update(config.table)
                .set(values as never)
                .where(where);
              await config.hooks?.afterRestore?.(ctx, [id]);
            });
          },
        );
        return c.json(success(null, "恢复成功"));
      },
    );

    routes.post(
      routePath(`${config.basePath}/batch-restore`),
      ...withPermission(config, "restore"),
      async (c) => {
        const ids = readIds((await c.req.json()).ids);
        await runWithOperationLog(
          c,
          {
            module: operationModule(config),
            action: "batchRestore",
            resource: config.basePath,
            details: { ids },
          },
          async () => {
            await runMutation(config, async (activeDb, activeSql) => {
              const ctx = crudContext(c, activeDb, activeSql);
              const { where } = await resolveScopedRecords({
                config,
                ctx,
                ids,
                softDeleteColumn,
                state: "deleted",
              });
              await config.hooks?.beforeRestore?.(ctx, ids);
              const values = mapValuesToColumns(
                config.table,
                addAuditValues({
                  table: config.table,
                  values: { deletedAt: null, deletedBy: null },
                  userId: ctx.userId,
                  mode: "update",
                  enabled: config.audit !== false,
                }),
              );
              await activeDb
                .update(config.table)
                .set(values as never)
                .where(where);
              await config.hooks?.afterRestore?.(ctx, ids);
            });
          },
        );
        return c.json(success(null, "恢复成功"));
      },
    );
  }

  if (actions.includes("forceDelete")) {
    routes.delete(
      routePath(`${config.basePath}/force/:id`),
      ...withPermission(config, "forceDelete"),
      async (c) => {
        const id = readId(c.req.param("id") ?? "");
        await runWithOperationLog(
          c,
          {
            module: operationModule(config),
            action: "forceDelete",
            resource: config.basePath,
            resourceId: id,
          },
          async () => {
            await runMutation(config, async (activeDb, activeSql) => {
              const ctx = crudContext(c, activeDb, activeSql);
              const { where } = await resolveScopedRecords({
                config,
                ctx,
                ids: [id],
                softDeleteColumn,
                state: "any",
              });
              await config.hooks?.beforeForceDelete?.(ctx, [id]);
              await activeDb.delete(config.table).where(where);
              await config.hooks?.afterForceDelete?.(ctx, [id]);
            });
          },
        );
        return c.json(success(null, "彻底删除成功"));
      },
    );

    routes.post(
      routePath(`${config.basePath}/batch-force`),
      ...withPermission(config, "forceDelete"),
      async (c) => {
        const ids = readIds((await c.req.json()).ids);
        await runWithOperationLog(
          c,
          {
            module: operationModule(config),
            action: "batchForceDelete",
            resource: config.basePath,
            details: { ids },
          },
          async () => {
            await runMutation(config, async (activeDb, activeSql) => {
              const ctx = crudContext(c, activeDb, activeSql);
              const { where } = await resolveScopedRecords({
                config,
                ctx,
                ids,
                softDeleteColumn,
                state: "any",
              });
              await config.hooks?.beforeForceDelete?.(ctx, ids);
              await activeDb.delete(config.table).where(where);
              await config.hooks?.afterForceDelete?.(ctx, ids);
            });
          },
        );
        return c.json(success(null, "彻底删除成功"));
      },
    );
  }

  if (actions.includes("status")) {
    routes.put(
      routePath(`${config.basePath}/status/:id`),
      ...withPermission(config, "status"),
      async (c) => {
        const id = readId(c.req.param("id") ?? "");
        const payload = asRecord(await c.req.json());
        const status = Number(payload.status);
        if (!Number.isFinite(status)) throw new Error("状态值不正确");
        await runWithOperationLog(
          c,
          {
            module: operationModule(config),
            action: "status",
            resource: config.basePath,
            resourceId: id,
            details: { status },
          },
          async () => {
            await runMutation(config, async (activeDb, activeSql) => {
              const ctx = crudContext(c, activeDb, activeSql);
              const { where } = await resolveScopedRecords({
                config,
                ctx,
                ids: [id],
                softDeleteColumn,
              });
              const values = mapValuesToColumns(
                config.table,
                addAuditValues({
                  table: config.table,
                  values: { status },
                  userId: ctx.userId,
                  mode: "update",
                  enabled: config.audit !== false,
                }),
              );
              await activeDb
                .update(config.table)
                .set(values as never)
                .where(where);
            });
          },
        );
        return c.json(success(null, "更新成功"));
      },
    );
  }

  return { routes, meta };
}
