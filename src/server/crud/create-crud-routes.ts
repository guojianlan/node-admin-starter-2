import { eq, inArray, type SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createDbClient, db, schema, sql, sqlite, type DbClient } from "@/server/db";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { buildCrudListQuery } from "./list-query";
import { createCrudMeta, resolveCrudPermission, validateCrudMeta } from "./permissions";
import { registerCrudMeta } from "./registry";
import type { CrudAction, CrudConfig, CrudContext } from "./types";

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
    const extraWhere = normalizeWhere(await config.hooks?.beforeList?.(ctx));
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
      await runMutation(config, async (activeDb, activeSql) => {
        const ctx = crudContext(c, activeDb, activeSql);
        const hookValues = config.hooks?.beforeCreate
          ? await config.hooks.beforeCreate(ctx, rawValues)
          : rawValues;
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
        const id = Number(rows[0]?.id ?? 0);
        await config.hooks?.afterCreate?.(ctx, id, hookValues);
      });
      return c.json(success(null, config.messages?.create ?? "创建成功"));
    });
  }

  if (actions.includes("update")) {
    routes.put(idPath, ...withPermission(config, "update"), async (c) => {
      const id = readId(c.req.param("id") ?? "");
      const rawValues = config.updateSchema.parse(await c.req.json());
      await runMutation(config, async (activeDb, activeSql) => {
        const ctx = crudContext(c, activeDb, activeSql);
        const hookValues = config.hooks?.beforeUpdate
          ? await config.hooks.beforeUpdate(ctx, id, rawValues)
          : rawValues;
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
            .where(eq(config.idColumn, id));
        }
        await config.hooks?.afterUpdate?.(ctx, id, hookValues);
      });
      return c.json(success(null, config.messages?.update ?? "更新成功"));
    });
  }

  if (actions.includes("delete")) {
    routes.delete(idPath, ...withPermission(config, "delete"), async (c) => {
      const id = readId(c.req.param("id") ?? "");
      await runMutation(config, async (activeDb, activeSql) => {
        const ctx = crudContext(c, activeDb, activeSql);
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
            .where(eq(config.idColumn, id));
        } else {
          await activeDb.delete(config.table).where(eq(config.idColumn, id));
        }

        await config.hooks?.afterDelete?.(ctx, [id]);
      });
      return c.json(success(null, config.messages?.delete ?? "删除成功"));
    });
  }

  if (actions.includes("batchDelete")) {
    routes.post(
      routePath(`${config.basePath}/batch-delete`),
      ...withPermission(config, "batchDelete"),
      async (c) => {
        const ids = readIds((await c.req.json()).ids);
        await runMutation(config, async (activeDb, activeSql) => {
          const ctx = crudContext(c, activeDb, activeSql);
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
              .where(inArray(config.idColumn, ids));
          } else {
            await activeDb.delete(config.table).where(inArray(config.idColumn, ids));
          }

          await config.hooks?.afterDelete?.(ctx, ids);
        });
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
        await runMutation(config, async (activeDb, activeSql) => {
          const ctx = crudContext(c, activeDb, activeSql);
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
            .where(eq(config.idColumn, id));
          await config.hooks?.afterRestore?.(ctx, [id]);
        });
        return c.json(success(null, "恢复成功"));
      },
    );

    routes.post(
      routePath(`${config.basePath}/batch-restore`),
      ...withPermission(config, "restore"),
      async (c) => {
        const ids = readIds((await c.req.json()).ids);
        await runMutation(config, async (activeDb, activeSql) => {
          const ctx = crudContext(c, activeDb, activeSql);
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
            .where(inArray(config.idColumn, ids));
          await config.hooks?.afterRestore?.(ctx, ids);
        });
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
        await runMutation(config, async (activeDb, activeSql) => {
          const ctx = crudContext(c, activeDb, activeSql);
          await config.hooks?.beforeForceDelete?.(ctx, [id]);
          await activeDb.delete(config.table).where(eq(config.idColumn, id));
          await config.hooks?.afterForceDelete?.(ctx, [id]);
        });
        return c.json(success(null, "彻底删除成功"));
      },
    );

    routes.post(
      routePath(`${config.basePath}/batch-force`),
      ...withPermission(config, "forceDelete"),
      async (c) => {
        const ids = readIds((await c.req.json()).ids);
        await runMutation(config, async (activeDb, activeSql) => {
          const ctx = crudContext(c, activeDb, activeSql);
          await config.hooks?.beforeForceDelete?.(ctx, ids);
          await activeDb.delete(config.table).where(inArray(config.idColumn, ids));
          await config.hooks?.afterForceDelete?.(ctx, ids);
        });
        return c.json(success(null, "彻底删除成功"));
      },
    );
  }

  if (actions.includes("status")) {
    routes.put(routePath(`${config.basePath}/status/:id`), ...withPermission(config, "status"), async (c) => {
      const id = readId(c.req.param("id") ?? "");
      const payload = asRecord(await c.req.json());
      const status = Number(payload.status);
      if (!Number.isFinite(status)) throw new Error("状态值不正确");
      await runMutation(config, async (activeDb, activeSql) => {
        const ctx = crudContext(c, activeDb, activeSql);
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
          .where(eq(config.idColumn, id));
      });
      return c.json(success(null, "更新成功"));
    });
  }

  return { routes, meta };
}
