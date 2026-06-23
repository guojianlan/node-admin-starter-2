import { sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { sqlite } from "@/server/db";
import { sysMailAccount } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { sendTestMail } from "@/server/services/mail-service";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { assertSystemCodeUnchanged } from "@/server/services/protected-records";
import { encryptSecret } from "@/server/services/secret";

const mailAccountSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().positive(),
  secure: z.coerce.boolean().default(false),
  username: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  fromName: z.string().optional().nullable(),
  fromEmail: z.string().email(),
  replyTo: z.string().email().or(z.literal("")).optional().nullable(),
  status: z.coerce.number().default(1),
  sort: z.coerce.number().default(0),
});

function withEncryptedPassword<T extends Record<string, unknown>>(values: T) {
  const { password, ...rest } = values;
  if (password === undefined) return rest;
  return {
    ...rest,
    passwordEncrypted: encryptSecret(String(password || "")),
  };
}

async function assertMailAccountMutable(id: number) {
  const row = (await sqlite
    .prepare(
      "SELECT is_default AS isDefault, is_system AS isSystem FROM sys_mail_account WHERE id = ?",
    )
    .get(id)) as { isDefault?: boolean; isSystem?: boolean } | undefined;
  if (!row) throw new Error("邮件账号不存在");
  if (row.isDefault) throw new Error("默认邮件账号不能删除，请先切换默认账号");
  if (row.isSystem) throw new Error("系统内置邮件账号不能删除");
}

const mailAccountCrud = createCrudRoutes({
  basePath: "/mail/account",
  table: sysMailAccount,
  idColumn: sysMailAccount.id,
  createSchema: mailAccountSchema,
  updateSchema: mailAccountSchema.partial(),
  permissions: { prefix: "system.mail" },
  list: {
    select: {
      id: sysMailAccount.id,
      name: sysMailAccount.name,
      code: sysMailAccount.code,
      host: sysMailAccount.host,
      port: sysMailAccount.port,
      secure: sysMailAccount.secure,
      username: sysMailAccount.username,
      hasPassword:
        drizzleSql<boolean>`(${sysMailAccount.passwordEncrypted} IS NOT NULL AND ${sysMailAccount.passwordEncrypted} <> '')`.as(
          "hasPassword",
        ),
      fromName: sysMailAccount.fromName,
      fromEmail: sysMailAccount.fromEmail,
      replyTo: sysMailAccount.replyTo,
      isDefault: sysMailAccount.isDefault,
      status: sysMailAccount.status,
      sort: sysMailAccount.sort,
      isSystem: sysMailAccount.isSystem,
      createdAt: sysMailAccount.createdAt,
      updatedAt: sysMailAccount.updatedAt,
    },
    searchable: {
      name: "like",
      code: "like",
      host: "like",
      status: "=",
    },
    quickSearchFields: ["name", "code", "host", "fromEmail"],
    sortableFields: ["id", "sort", "status", "createdAt", "updatedAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    beforeCreate: (_ctx, values) => withEncryptedPassword(values),
    beforeUpdate: async (ctx, id, values) => {
      await assertSystemCodeUnchanged({
        db: ctx.sql,
        table: "sys_mail_account",
        id,
        nextCode: values.code,
        message: "系统内置邮件账号不能修改编码",
      });
      return withEncryptedPassword(values);
    },
    beforeDelete: async (_ctx, ids) => {
      for (const id of ids) await assertMailAccountMutable(id);
    },
  },
});

export const mailRoutes = new Hono<{ Variables: HonoVariables }>();

mailRoutes.put(
  "/mail/account/status/:id",
  authRequired(),
  ability("system.mail.status"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.mail",
        action: "status",
        resource: "/mail/account",
        resourceId: id,
        details: { status: payload.status },
      },
      async () => {
        const row = (await sqlite
          .prepare(
            "SELECT is_default AS isDefault FROM sys_mail_account WHERE id = ? AND deleted_at IS NULL",
          )
          .get(id)) as { isDefault?: boolean } | undefined;
        if (!row) throw new Error("邮件账号不存在");
        if (row.isDefault && payload.status === 0) throw new Error("默认邮件账号不能停用");
        await sqlite
          .prepare("UPDATE sys_mail_account SET status = ?, updated_at = now() WHERE id = ?")
          .run(payload.status, id);
      },
    );
    return c.json(success(null, "更新成功"));
  },
);

mailRoutes.put(
  "/mail/account/default/:id",
  authRequired(),
  ability("system.mail.setDefault"),
  async (c) => {
    const id = Number(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.mail",
        action: "setDefault",
        resource: "/mail/account",
        resourceId: id,
      },
      async () => {
        const row = (await sqlite
          .prepare("SELECT id, status FROM sys_mail_account WHERE id = ? AND deleted_at IS NULL")
          .get(id)) as { id: number; status: number } | undefined;
        if (!row) throw new Error("邮件账号不存在");
        if (row.status !== 1) throw new Error("停用的邮件账号不能设为默认");
        await sqlite.transaction(async (tx) => {
          await tx
            .prepare("UPDATE sys_mail_account SET is_default = false, updated_at = now()")
            .run();
          await tx
            .prepare(
              "UPDATE sys_mail_account SET is_default = true, updated_at = now() WHERE id = ?",
            )
            .run(id);
        });
      },
    );
    return c.json(success(null, "设置成功"));
  },
);

mailRoutes.post("/mail/account/test", authRequired(), ability("system.mail.test"), async (c) => {
  const payload = z
    .object({
      id: z.coerce.number().optional(),
      to: z.string().email(),
      subject: z.string().optional(),
      text: z.string().optional(),
    })
    .parse(await c.req.json());
  await runWithOperationLog(
    c,
    {
      module: "system.mail",
      action: "test",
      resource: "/mail/account",
      resourceId: payload.id ?? null,
      details: { to: payload.to },
    },
    async () => {
      await sendTestMail({
        accountId: payload.id,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
      });
    },
  );
  return c.json(success(null, "发送成功"));
});

mailRoutes.route("/", mailAccountCrud.routes);
