import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { success } from "@/lib/response";
import type { HonoVariables } from "@/server/context";
import { createCrudRoutes } from "@/server/crud/create-crud-routes";
import { sqlite } from "@/server/db";
import { sysSmsProvider, sysSmsTemplate } from "@/server/db/schema";
import { ability } from "@/server/middleware/ability";
import { authRequired } from "@/server/middleware/auth";
import { runWithOperationLog } from "@/server/services/operation-log-service";
import { assertSystemCodeUnchanged } from "@/server/services/protected-records";
import { getSmsProvider, sendWebhookSms, type SmsProviderRow } from "./sms-provider";

const emptyToNull = (value: unknown) => (value === "" ? null : value);
const optionalText = z.preprocess(emptyToNull, z.string().optional().nullable());

const smsTemplateSchema = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  providerId: z.coerce.number().int().positive(),
  templateCode: optionalText,
  signature: optionalText,
  content: z.string().min(1),
  variablesJson: optionalText,
  status: z.coerce.number().default(1),
  sort: z.coerce.number().default(0),
  remark: optionalText,
});

type SmsTemplateRow = {
  id: number;
  name: string;
  code: string;
  providerId: number;
  templateCode: string | null;
  signature: string | null;
  content: string;
  variablesJson: string | null;
  status: number;
  isSystem: boolean;
};

function assertVariablesJson(value?: string | null) {
  if (!value) return;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error();
  } catch {
    throw new Error("变量配置必须是合法 JSON 对象或数组");
  }
}

async function assertProviderExists(providerId?: number | null) {
  if (!providerId) return;
  const provider = await getSmsProvider(providerId);
  if (!provider) throw new Error("短信通道不存在");
}

function normalizeSmsTemplate<T extends Record<string, unknown>>(values: T) {
  if (typeof values.variablesJson === "string") assertVariablesJson(values.variablesJson);
  return values;
}

async function getSmsTemplate(id: number) {
  return (await sqlite
    .prepare(
      `SELECT
        id,
        name,
        code,
        provider_id AS "providerId",
        template_code AS "templateCode",
        signature,
        content,
        variables_json AS "variablesJson",
        status,
        is_system AS "isSystem"
       FROM sys_sms_template
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(id)) as SmsTemplateRow | undefined;
}

async function assertSmsTemplateMutable(id: number) {
  const row = await getSmsTemplate(id);
  if (!row) throw new Error("短信模板不存在");
  if (row.isSystem) throw new Error("系统内置短信模板不能删除");
}

function renderTemplateContent(content: string, variables: Record<string, unknown>) {
  return content.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key: string) => {
    const value = variables[key];
    return value == null ? match : String(value);
  });
}

function maskPhone(value: string) {
  return value.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2");
}

function buildProviderForTemplate(provider: SmsProviderRow, template: SmsTemplateRow): SmsProviderRow {
  return {
    ...provider,
    signature: template.signature || provider.signature,
    templateCode: template.templateCode || provider.templateCode,
  };
}

const smsTemplateCrud = createCrudRoutes({
  basePath: "/sms/template",
  table: sysSmsTemplate,
  idColumn: sysSmsTemplate.id,
  createSchema: smsTemplateSchema,
  updateSchema: smsTemplateSchema.partial(),
  permissions: { prefix: "system.smsTemplate" },
  actions: ["query", "create", "update", "delete"],
  list: {
    select: {
      id: sysSmsTemplate.id,
      name: sysSmsTemplate.name,
      code: sysSmsTemplate.code,
      providerId: sysSmsTemplate.providerId,
      providerName: sysSmsProvider.name,
      providerCode: sysSmsProvider.code,
      templateCode: sysSmsTemplate.templateCode,
      signature: sysSmsTemplate.signature,
      content: sysSmsTemplate.content,
      variablesJson: sysSmsTemplate.variablesJson,
      status: sysSmsTemplate.status,
      sort: sysSmsTemplate.sort,
      remark: sysSmsTemplate.remark,
      isSystem: sysSmsTemplate.isSystem,
      createdAt: sysSmsTemplate.createdAt,
      updatedAt: sysSmsTemplate.updatedAt,
    },
    joins: [
      {
        type: "left",
        table: sysSmsProvider,
        on: eq(sysSmsTemplate.providerId, sysSmsProvider.id),
      },
    ],
    searchable: {
      name: "like",
      code: "like",
      templateCode: "like",
      status: "=",
    },
    quickSearchFields: ["name", "code", "templateCode"],
    sortableFields: ["id", "sort", "status", "createdAt", "updatedAt"],
    defaultSort: { field: "sort", order: "asc" },
  },
  hooks: {
    beforeCreate: async (_ctx, values) => {
      await assertProviderExists(values.providerId);
      return normalizeSmsTemplate(values);
    },
    beforeUpdate: async (ctx, id, values) => {
      await assertSystemCodeUnchanged({
        db: ctx.sql,
        table: "sys_sms_template",
        id,
        nextCode: values.code,
        message: "系统内置短信模板不能修改编码",
      });
      if (values.providerId !== undefined) await assertProviderExists(values.providerId);
      return normalizeSmsTemplate(values);
    },
    beforeDelete: async (_ctx, ids) => {
      for (const id of ids) await assertSmsTemplateMutable(id);
    },
  },
});

export const smsTemplateRoutes = new Hono<{ Variables: HonoVariables }>();

smsTemplateRoutes.put(
  "/sms/template/status/:id",
  authRequired(),
  ability("system.smsTemplate.status"),
  async (c) => {
    const id = Number(c.req.param("id"));
    const payload = z.object({ status: z.coerce.number() }).parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.smsTemplate",
        action: "status",
        resource: "/sms/template",
        resourceId: id,
        details: { status: payload.status },
      },
      async () => {
        const row = await getSmsTemplate(id);
        if (!row) throw new Error("短信模板不存在");
        await sqlite
          .prepare("UPDATE sys_sms_template SET status = ?, updated_at = now() WHERE id = ?")
          .run(payload.status, id);
      },
    );
    return c.json(success(null, "更新成功"));
  },
);

smsTemplateRoutes.post(
  "/sms/template/test",
  authRequired(),
  ability("system.smsTemplate.test"),
  async (c) => {
    const payload = z
      .object({
        id: z.coerce.number(),
        to: z.string().min(1),
        variables: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(await c.req.json());
    await runWithOperationLog(
      c,
      {
        module: "system.smsTemplate",
        action: "test",
        resource: "/sms/template",
        resourceId: payload.id,
        details: { to: maskPhone(payload.to) },
      },
      async () => {
        const template = await getSmsTemplate(payload.id);
        if (!template) throw new Error("短信模板不存在");
        if (template.status !== 1) throw new Error("停用的短信模板不能测试发送");
        const provider = await getSmsProvider(template.providerId);
        if (!provider) throw new Error("短信通道不存在");
        if (provider.status !== 1) throw new Error("停用的短信通道不能测试发送");
        await sendWebhookSms({
          provider: buildProviderForTemplate(provider, template),
          to: payload.to,
          content: renderTemplateContent(template.content, payload.variables ?? {}),
          templateCode: template.templateCode,
          variables: payload.variables,
        });
      },
    );
    return c.json(success(null, "发送成功"));
  },
);

smsTemplateRoutes.route("/", smsTemplateCrud.routes);
