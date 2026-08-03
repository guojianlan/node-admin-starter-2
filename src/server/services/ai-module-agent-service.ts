import { z } from "zod";
import { sqlite, type DbClient } from "@/server/db";
import {
  assertModuleGeneratorAllowed,
  buildModulePublishPlan,
  generateModuleDraft,
  getModulePublishApprovalMetadata,
  getModuleRollbackApprovalMetadata,
  publishModuleDraft,
  rollbackModulePublish,
  toPublicModulePublishPlan,
  validateModuleDraft,
} from "@/server/services/module-generator-service";
import { recordBackgroundOperationLog } from "@/server/services/operation-log-service";
import { adminModuleConfigSchema } from "@/shared/module-generator-contract";

export const moduleAgentHandlerKeys = [
  "module_design",
  "module_generate_draft",
  "module_preview_diff",
  "module_validate",
  "module_publish",
  "module_rollback",
] as const;

export type ModuleAgentHandlerKey = (typeof moduleAgentHandlerKeys)[number];

export const moduleAgentRiskLevels: Record<
  ModuleAgentHandlerKey,
  "low" | "medium" | "high" | "critical"
> = {
  module_design: "low",
  module_generate_draft: "medium",
  module_preview_diff: "low",
  module_validate: "medium",
  module_publish: "high",
  module_rollback: "critical",
};

type ModuleAgentToolIdentity = {
  code: string;
  handlerKey: string;
  isSystem: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
};

const moduleNameSchema = z.string().regex(/^[a-z0-9-]+$/);
const planHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const publishIdSchema = z.string().regex(/^[a-z0-9-]+$/);

const moduleDesignInputSchema = z.object({ contract: adminModuleConfigSchema }).strict();
const moduleGenerateDraftInputSchema = z
  .object({ contract: adminModuleConfigSchema, force: z.boolean().default(false) })
  .strict();
const modulePreviewDiffInputSchema = z.object({ name: moduleNameSchema }).strict();
const moduleValidateInputSchema = z
  .object({ name: moduleNameSchema, planHash: planHashSchema })
  .strict();
const modulePublishInputSchema = moduleValidateInputSchema;
const moduleRollbackInputSchema = z
  .object({ name: moduleNameSchema, publishId: publishIdSchema.optional() })
  .strict();

const moduleAgentInputSchemas = {
  module_design: moduleDesignInputSchema,
  module_generate_draft: moduleGenerateDraftInputSchema,
  module_preview_diff: modulePreviewDiffInputSchema,
  module_validate: moduleValidateInputSchema,
  module_publish: modulePublishInputSchema,
  module_rollback: moduleRollbackInputSchema,
} satisfies Record<ModuleAgentHandlerKey, z.ZodType>;

const requiredAbilities: Record<ModuleAgentHandlerKey, string> = {
  module_design: "system.moduleGenerator.query",
  module_generate_draft: "system.moduleGenerator.generate",
  module_preview_diff: "system.moduleGenerator.query",
  module_validate: "system.moduleGenerator.generate",
  module_publish: "system.moduleGenerator.publish",
  module_rollback: "system.moduleGenerator.publish",
};

export function isModuleAgentHandlerKey(value: string): value is ModuleAgentHandlerKey {
  return (moduleAgentHandlerKeys as readonly string[]).includes(value);
}

export function getModuleAgentInputSchema(handlerKey: ModuleAgentHandlerKey) {
  return moduleAgentInputSchemas[handlerKey];
}

function assertSystemModuleTool(tool: ModuleAgentToolIdentity) {
  if (!isModuleAgentHandlerKey(tool.handlerKey)) throw new Error("不是受控模块工具");
  if (!tool.isSystem || tool.code !== tool.handlerKey) {
    throw new Error("受控模块工具只能由系统内置定义调用");
  }
  return tool.handlerKey;
}

async function hasAbility(userId: number | undefined, ability: string, dbClient: DbClient) {
  if (userId === 1) return true;
  if (!userId) return false;
  const row = await dbClient
    .prepare(
      `SELECT 1
       FROM sys_user_role ur
       INNER JOIN sys_role r ON r.id = ur.role_id
       INNER JOIN sys_role_rule rr ON rr.role_id = r.id
       INNER JOIN sys_rule rule ON rule.id = rr.rule_id
       WHERE ur.user_id = ?
         AND r.status = 1
         AND r.deleted_at IS NULL
         AND rule.key = ?
         AND rule.status = 1
         AND rule.deleted_at IS NULL
       LIMIT 1`,
    )
    .get(userId, ability);
  return Boolean(row);
}

export type ModuleAgentDependencies = {
  design: (contract: unknown) => unknown;
  generateDraft: typeof generateModuleDraft;
  previewDiff: typeof buildModulePublishPlan;
  validate: typeof validateModuleDraft;
  publish: typeof publishModuleDraft;
  rollback: typeof rollbackModulePublish;
  publishApproval: typeof getModulePublishApprovalMetadata;
  rollbackApproval: typeof getModuleRollbackApprovalMetadata;
};

const defaultDependencies: ModuleAgentDependencies = {
  design: (contract) => adminModuleConfigSchema.parse(contract),
  generateDraft: generateModuleDraft,
  previewDiff: buildModulePublishPlan,
  validate: validateModuleDraft,
  publish: publishModuleDraft,
  rollback: rollbackModulePublish,
  publishApproval: getModulePublishApprovalMetadata,
  rollbackApproval: getModuleRollbackApprovalMetadata,
};

type ModuleAgentOptions = {
  userId?: number;
  dbClient?: DbClient;
  approvedMutation?: boolean;
  dependencies?: ModuleAgentDependencies;
  abilityCheck?: (
    userId: number | undefined,
    ability: string,
    dbClient: DbClient,
  ) => Promise<boolean>;
  audit?: typeof recordBackgroundOperationLog;
};

async function assertModuleToolAbility(
  handlerKey: ModuleAgentHandlerKey,
  options: ModuleAgentOptions,
) {
  const dbClient = options.dbClient ?? sqlite;
  const allowed = await (options.abilityCheck ?? hasAbility)(
    options.userId,
    requiredAbilities[handlerKey],
    dbClient,
  );
  if (!allowed) throw new Error(`没有权限：${requiredAbilities[handlerKey]}`);
}

function moduleResourceId(handlerKey: ModuleAgentHandlerKey, input: Record<string, unknown>) {
  if (handlerKey === "module_design" || handlerKey === "module_generate_draft") {
    const contract = input.contract as { name?: unknown } | undefined;
    return typeof contract?.name === "string" ? contract.name : null;
  }
  return typeof input.name === "string" ? input.name : null;
}

export async function executeModuleAgentTool(
  tool: ModuleAgentToolIdentity,
  input: Record<string, unknown>,
  options: ModuleAgentOptions = {},
) {
  const handlerKey = assertSystemModuleTool(tool);
  assertModuleGeneratorAllowed();
  await assertModuleToolAbility(handlerKey, options);
  const parsed = moduleAgentInputSchemas[handlerKey].parse(input) as Record<string, unknown>;
  const dependencies = options.dependencies ?? defaultDependencies;
  const dbClient = options.dbClient ?? sqlite;
  const audit = options.audit ?? recordBackgroundOperationLog;
  const startedAt = performance.now();
  try {
    if (
      (handlerKey === "module_publish" || handlerKey === "module_rollback") &&
      !options.approvedMutation
    ) {
      throw new Error("模块发布或回滚必须通过人工审批后执行");
    }
    let result: unknown;
    if (handlerKey === "module_design") {
      result = dependencies.design(parsed.contract);
    } else if (handlerKey === "module_generate_draft") {
      const generated = await dependencies.generateDraft({
        config: parsed.contract as Record<string, unknown>,
        force: Boolean(parsed.force),
      });
      result = {
        ...generated,
        files: generated.files.map(({ path, size }) => ({ path, size })),
      };
    } else if (handlerKey === "module_preview_diff") {
      result = toPublicModulePublishPlan(await dependencies.previewDiff(String(parsed.name)));
    } else if (handlerKey === "module_validate") {
      result = await dependencies.validate(String(parsed.name), String(parsed.planHash));
    } else if (handlerKey === "module_publish") {
      result = await dependencies.publish(String(parsed.name), String(parsed.planHash));
    } else {
      result = await dependencies.rollback(
        String(parsed.name),
        parsed.publishId ? String(parsed.publishId) : undefined,
      );
    }
    await audit(
      {
        userId: options.userId,
        module: "system.moduleGenerator.agent",
        action: handlerKey,
        resource: "/ai/agent/module-tool",
        resourceId: moduleResourceId(handlerKey, parsed),
        riskLevel: moduleAgentRiskLevels[handlerKey],
        success: true,
        status: 200,
        durationMs: performance.now() - startedAt,
        details: {
          toolCode: tool.code,
          planHash: parsed.planHash ?? null,
          publishId: parsed.publishId ?? null,
        },
      },
      dbClient,
    );
    return result;
  } catch (error) {
    await audit(
      {
        userId: options.userId,
        module: "system.moduleGenerator.agent",
        action: handlerKey,
        resource: "/ai/agent/module-tool",
        resourceId: moduleResourceId(handlerKey, parsed),
        riskLevel: moduleAgentRiskLevels[handlerKey],
        success: false,
        status: 500,
        message: error instanceof Error ? error.message : String(error),
        durationMs: performance.now() - startedAt,
        details: {
          toolCode: tool.code,
          planHash: parsed.planHash ?? null,
          publishId: parsed.publishId ?? null,
        },
      },
      dbClient,
    );
    throw error;
  }
}

export async function prepareModuleAgentApproval(
  tool: ModuleAgentToolIdentity,
  input: Record<string, unknown>,
  options: ModuleAgentOptions = {},
) {
  const handlerKey = assertSystemModuleTool(tool);
  if (handlerKey !== "module_publish" && handlerKey !== "module_rollback") {
    throw new Error("当前模块工具不需要人工审批");
  }
  assertModuleGeneratorAllowed();
  await assertModuleToolAbility(handlerKey, options);
  const parsed = moduleAgentInputSchemas[handlerKey].parse(input) as Record<string, unknown>;
  const dependencies = options.dependencies ?? defaultDependencies;
  const metadata =
    handlerKey === "module_publish"
      ? await dependencies.publishApproval(String(parsed.name), String(parsed.planHash))
      : await dependencies.rollbackApproval(
          String(parsed.name),
          parsed.publishId ? String(parsed.publishId) : undefined,
        );
  return {
    ...metadata,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}
