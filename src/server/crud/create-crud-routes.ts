import { eq, inArray } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { db } from "@/server/db";
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

function crudContext(c: Context<{ Variables: HonoVariables }>): CrudContext {
  return {
    c,
    userId: c.get("user")?.id ?? null,
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
  const meta = createCrudMeta({
    basePath: config.basePath,
    permissions: config.permissions,
    actions: defaultActions,
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
    const page = await buildCrudListQuery(c.req.url, config.table, config.list, {
      softDeleteColumn,
    });
    return c.json(success(page));
  });

  routes.post(basePath, ...withPermission(config, "create"), async (c) => {
    const ctx = crudContext(c);
    const rawValues = config.createSchema.parse(await c.req.json());
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
    const rows = await db
      .insert(config.table)
      .values(values as never)
      .returning({ id: config.idColumn });
    const id = Number(rows[0]?.id ?? 0);
    await config.hooks?.afterCreate?.(ctx, id, hookValues);
    return c.json(success(null, config.messages?.create ?? "创建成功"));
  });

  routes.put(idPath, ...withPermission(config, "update"), async (c) => {
    const id = readId(c.req.param("id") ?? "");
    const ctx = crudContext(c);
    const rawValues = config.updateSchema.parse(await c.req.json());
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
      await db
        .update(config.table)
        .set(values as never)
        .where(eq(config.idColumn, id));
    }
    await config.hooks?.afterUpdate?.(ctx, id, hookValues);
    return c.json(success(null, config.messages?.update ?? "更新成功"));
  });

  routes.delete(idPath, ...withPermission(config, "delete"), async (c) => {
    const id = readId(c.req.param("id") ?? "");
    const ctx = crudContext(c);
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
      await db
        .update(config.table)
        .set(values as never)
        .where(eq(config.idColumn, id));
    } else {
      await db.delete(config.table).where(eq(config.idColumn, id));
    }

    await config.hooks?.afterDelete?.(ctx, [id]);
    return c.json(success(null, config.messages?.delete ?? "删除成功"));
  });

  routes.post(
    routePath(`${config.basePath}/batch-delete`),
    ...withPermission(config, "batchDelete"),
    async (c) => {
      const ids = readIds((await c.req.json()).ids);
      const ctx = crudContext(c);
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
        await db
          .update(config.table)
          .set(values as never)
          .where(inArray(config.idColumn, ids));
      } else {
        await db.delete(config.table).where(inArray(config.idColumn, ids));
      }

      await config.hooks?.afterDelete?.(ctx, ids);
      return c.json(success(null, config.messages?.delete ?? "删除成功"));
    },
  );

  return { routes, meta };
}
