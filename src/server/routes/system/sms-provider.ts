import { sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { sqlite } from "@/server/db";
import { sysSmsProvider } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { assertSystemCodeUnchanged } from "@/server/services/protected-records";
import { decryptSecret, encryptSecret } from "@/server/services/secret";

const emptyToNull = (value: unknown) => (value === "" ? null : value);

const optionalUrl = z.preprocess(emptyToNull, z.string().url().optional().nullable());

const smsProviderSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  provider: z.string().min(1).default("webhook"),
  endpoint: optionalUrl,
  accessKey: z.preprocess(emptyToNull, z.string().optional().nullable()),
  secretKey: z.preprocess(emptyToNull, z.string().optional().nullable()),
  signature: z.preprocess(emptyToNull, z.string().optional().nullable()),
  templateCode: z.preprocess(emptyToNull, z.string().optional().nullable()),
  status: z.coerce.number().default(1),
  sort: z.coerce.number().default(0),
  optionsJson: z.preprocess(emptyToNull, z.string().optional().nullable()),
  remark: z.preprocess(emptyToNull, z.string().optional().nullable()),
});

type SmsProviderRow = {
  id: number;
  code: string;
  name: string;
  provider: string;
  endpoint: string | null;
  accessKey: string | null;
  secretKeyEncrypted: string | null;
  signature: string | null;
  templateCode: string | null;
  isDefault: boolean;
  status: number;
  isSystem: boolean;
};

function assertJson(value?: string | null) {
  if (!value) return;
  try {
    JSON.parse(value);
  } catch {
    throw new Error("扩展配置必须是合法 JSON");
  }
}

function normalizeSmsProvider<T extends Record<string, unknown>>(values: T) {
  const { secretKey, optionsJson, ...rest } = values;
  if (typeof optionsJson === "string") assertJson(optionsJson);
  return {
    ...rest,
    ...(optionsJson !== undefined ? { optionsJson } : {}),
    ...(secretKey !== undefined ? { secretKeyEncrypted: encryptSecret(String(secretKey || "")) } : {}),
  } as T;
}

async function getSmsProvider(id: number) {
  return (await sqlite
    .prepare(
      `SELECT
        id,
        code,
        name,
        provider,
        endpoint,
        access_key AS "accessKey",
        secret_key_encrypted AS "secretKeyEncrypted",
        signature,
        template_code AS "templateCode",
        is_default AS "isDefault",
        status,
        is_system AS "isSystem"
       FROM sys_sms_provider
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id)) as SmsProviderRow | undefined;
}

async function getDefaultSmsProvider() {
  return (await sqlite
    .prepare(
      `SELECT
        id,
        code,
        name,
        provider,
        endpoint,
        access_key AS "accessKey",
        secret_key_encrypted AS "secretKeyEncrypted",
        signature,
        template_code AS "templateCode",
        is_default AS "isDefault",
        status,
        is_system AS "isSystem"
       FROM sys_sms_provider
       WHERE is_default = true AND deleted_at IS NULL
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get()) as SmsProviderRow | undefined;
}

async function assertSmsProviderMutable(id: number) {
  const row = await getSmsProvider(id);
  if (!row) throw new Error("短信配置不存在");
  if (row.isDefault) throw new Error("默认短信配置不能删除，请先切换默认配置");
  if (row.isSystem) throw new Error("系统内置短信配置不能删除");
}

async function sendWebhookSms(input: {
  provider: SmsProviderRow;
  to: string;
  content: string;
  templateCode?: string | null;
  variables?: Record<string, unknown>;
}) {
  const { provider, to, content, templateCode, variables } = input;
  if (provider.provider !== "webhook") throw new Error("当前仅支持 Webhook 短信测试");
  if (!provider.endpoint) throw new Error("Webhook Endpoint 未配置");
  const response = await fetch(provider.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-base-sms-provider": provider.code,
      ...(provider.accessKey ? { "x-admin-base-sms-access-key": provider.accessKey } : {}),
      ...(provider.secretKeyEncrypted
        ? { authorization: `Bearer ${decryptSecret(provider.secretKeyEncrypted) ?? ""}` }
        : {}),
    },
    body: JSON.stringify({
      to,
      content,
      signature: provider.signature,
      templateCode: templateCode || provider.templateCode,
      variables: variables ?? {},
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Webhook 短信发送失败：${response.status}${text ? ` ${text}` : ""}`);
  }
}

const smsProviderCrud = createCrudRoutes({
  basePath: "/sms/provider",
  table: sysSmsProvider,
  idColumn: sysSmsProvider.id,
  createSchema: smsProviderSchema,
  updateSchema: smsProviderSchema.partial(),
  permissions: { prefix: "system.smsProvider" },
  list: {
    select: {
      id: sysSmsProvider.id,
      name: sysSmsProvider.name,
      code: sysSmsProvider.code,
      provider: sysSmsProvider.provider,
      endpoint: sysSmsProvider.endpoint,
      accessKey: sysSmsProvider.accessKey,
      hasSecretKey:
        drizzleSql<boolean>`(${sysSmsProvider.secretKeyEncrypted} IS NOT NULL AND ${sysSmsProvider.secretKeyEncrypted} <> '')`.as(
          "hasSecretKey",
        ),
      signature: sysSmsProvider.signature,
      templateCode: sysSmsProvider.templateCode,
      isDefault: sysSmsProvider.isDefault,
      status: sysSmsProvider.status,
      sort: sysSmsProvider.sort,
      optionsJson: sysSmsProvider.optionsJson,
      remark: sysSmsProvider.remark,
      isSystem: sysSmsProvider.isSystem,
      createdAt: sysSmsProvider.createdAt,
      updatedAt: sysSmsProvider.updatedAt,
    },
    searchable: {
      name: "like",
      code: "like",
      provider: "like",
      endpoint: "like",
      status: "=",
    },
    quickSearchFields: ["name", "code", "provider", "endpoint"],
    sortableFields: ["id", "sort", "status", "createdAt", "updatedAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    beforeCreate: (_ctx, values) => normalizeSmsProvider(values),
    beforeUpdate: async (ctx, id, values) => {
      await assertSystemCodeUnchanged({
        db: ctx.sql,
        table: "sys_sms_provider",
        id,
        nextCode: values.code,
        message: "系统内置短信配置不能修改编码",
      });
      return normalizeSmsProvider(values);
    },
    beforeDelete: async (_ctx, ids) => {
      for (const id of ids) await assertSmsProviderMutable(id);
    },
  },
});

export const smsProviderRoutes = new Hono<{ Variables: HonoVariables }>();

smsProviderRoutes.put(
  "/sms/provider/status/:id",
  authRequired(),
  ability("system.smsProvider.status"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.smsProvider",
        action: "status",
        resource: "/sms/provider",
        resourceId: id,
        details: { status: payload.status },
      },
      async () => {
        const row = await getSmsProvider(id);
        if (!row) throw new Error("短信配置不存在");
        if (row.isDefault && payload.status === 0) throw new Error("默认短信配置不能停用");
        await sqlite
          .prepare("UPDATE sys_sms_provider SET status = ?, updated_at = now() WHERE id = ?")
          .run(payload.status, id);
      },
    );
    return c.json(success(null, "更新成功"));
  },
);

smsProviderRoutes.put(
  "/sms/provider/default/:id",
  authRequired(),
  ability("system.smsProvider.setDefault"),
  async (c) => {
    const id = Number(c.req.param("id"));
    await runWithOperationLog(
      c,
      {
        module: "system.smsProvider",
        action: "setDefault",
        resource: "/sms/provider",
        resourceId: id,
      },
      async () => {
        const row = await getSmsProvider(id);
        if (!row) throw new Error("短信配置不存在");
        if (row.status !== 1) throw new Error("停用的短信配置不能设为默认");
        await sqlite.transaction(async (tx) => {
          await tx.prepare("UPDATE sys_sms_provider SET is_default = false, updated_at = now()").run();
          await tx
            .prepare("UPDATE sys_sms_provider SET is_default = true, updated_at = now() WHERE id = ?")
            .run(id);
        });
      },
    );
    return c.json(success(null, "设置成功"));
  },
);

smsProviderRoutes.post(
  "/sms/provider/test",
  authRequired(),
  ability("system.smsProvider.test"),
  async (c) => {
    const payload = z
      .object({
        id: z.coerce.number().optional(),
        to: z.string().min(1),
        content: z.string().min(1).default("Admin Base SMS test"),
        templateCode: z.string().optional().nullable(),
        variables: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.smsProvider",
        action: "test",
        resource: "/sms/provider",
        resourceId: payload.id ?? null,
        details: { to: payload.to, templateCode: payload.templateCode },
      },
      async () => {
        const provider = payload.id ? await getSmsProvider(payload.id) : await getDefaultSmsProvider();
        if (!provider) throw new Error("短信配置不存在");
        if (provider.status !== 1) throw new Error("停用的短信配置不能测试发送");
        await sendWebhookSms({
          provider,
          to: payload.to,
          content: payload.content,
          templateCode: payload.templateCode,
          variables: payload.variables,
        });
      },
    );
    return c.json(success(null, "发送成功"));
  },
);

smsProviderRoutes.route("/", smsProviderCrud.routes);
