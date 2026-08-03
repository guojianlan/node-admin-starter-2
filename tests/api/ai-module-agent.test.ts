import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeModuleAgentTool,
  getModuleAgentInputSchema,
  moduleAgentHandlerKeys,
  prepareModuleAgentApproval,
  type ModuleAgentDependencies,
  type ModuleAgentHandlerKey,
} from "@/server/services/ai-module-agent-service";
import {
  buildModulePublishPlan,
  generateModuleDraft,
  getModulePublishApprovalMetadata,
  validateModuleDraft,
  type ModulePublishPlan,
} from "@/server/services/module-generator-service";
import { parseAdminModuleConfig } from "@/shared/module-generator-contract";

const planHash = "a".repeat(64);
const moduleContract = {
  name: "cms-config",
  title: "CMS 配置",
  fields: [
    { name: "name", label: "名称", required: true, search: true },
    { name: "value", label: "配置值", required: true },
  ],
};

function tool(handlerKey: ModuleAgentHandlerKey) {
  return {
    code: handlerKey,
    handlerKey,
    isSystem: true,
    riskLevel:
      handlerKey === "module_rollback"
        ? ("critical" as const)
        : handlerKey === "module_publish"
          ? ("high" as const)
          : ("medium" as const),
  };
}

function createDependencies(calls: string[]) {
  const moduleConfig = parseAdminModuleConfig(moduleContract);
  const plan: ModulePublishPlan = {
    name: moduleConfig.name,
    module: moduleConfig,
    migrationId: "generated_cms_config_test",
    planHash,
    ready: true,
    issues: [],
    changes: [],
  };
  return {
    design: (contract) => {
      calls.push("design");
      return parseAdminModuleConfig(contract);
    },
    generateDraft: async () => {
      calls.push("generate");
      return {
        module: {
          name: "cms-config",
          title: "CMS 配置",
          kebabName: "cms-config",
          schemaName: "sysCmsConfig",
          permission: "system.cms.config",
          frontendPath: "/system/cms-config",
          apiPath: "/api/system/cms-config",
        },
        outputRoot: "generated/module-drafts/cms-config",
        drafts: [],
        files: [
          {
            path: "generated/module-drafts/cms-config/module.config.json",
            size: 128,
            content: "{}",
          },
        ],
      };
    },
    previewDiff: async () => {
      calls.push("preview");
      return plan;
    },
    validate: async (name, expectedPlanHash) => {
      calls.push("validate");
      return {
        version: 1 as const,
        moduleName: name,
        planHash: expectedPlanHash,
        validatedAt: "2026-08-03T00:00:00.000Z",
        affectedFiles: ["src/server/routes/system/cms-config.ts"],
        validation: { command: "pnpm admin:verify", passed: true, output: "22/22" },
      };
    },
    publish: async (name, expectedPlanHash) => {
      calls.push("publish");
      return {
        module: moduleConfig,
        publishId: "publish-1",
        planHash: expectedPlanHash ?? planHash,
        migrationId: plan.migrationId,
        applied: ["src/server/routes/system/cms-config.ts"],
        validation: { command: "pnpm admin:verify", passed: true, output: "22/22" },
      };
    },
    rollback: async (name, publishId) => {
      calls.push("rollback");
      return {
        moduleName: name,
        publishId: publishId ?? "publish-1",
        rolledBack: ["src/server/routes/system/cms-config.ts"],
        databaseNotice: "源码已回滚；已经执行过的数据库 migration 不会自动逆向删除",
      };
    },
    publishApproval: async (_name, expectedPlanHash) => {
      calls.push("publishApproval");
      return {
        planHash: expectedPlanHash,
        affectedFiles: ["src/server/routes/system/cms-config.ts"],
        validation: { command: "pnpm admin:verify", passed: true, output: "22/22" },
        validatedAt: "2026-08-03T00:00:00.000Z",
      };
    },
    rollbackApproval: async (_name, publishId) => {
      calls.push("rollbackApproval");
      return {
        planHash,
        publishId: publishId ?? "publish-1",
        affectedFiles: ["src/server/routes/system/cms-config.ts"],
        validation: { command: "pnpm admin:verify", passed: true, output: "22/22" },
        publishedAt: "2026-08-03T00:00:00.000Z",
      };
    },
  } satisfies ModuleAgentDependencies;
}

function options(
  dependencies: ModuleAgentDependencies,
  auditEntries: Array<Record<string, unknown>>,
) {
  return {
    userId: 2,
    dependencies,
    abilityCheck: async () => true,
    audit: async (entry: Record<string, unknown>) => {
      auditEntries.push(entry);
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("constrained module development agent", () => {
  it("registers exactly the six constrained schemas and validates the shared module contract", () => {
    expect(moduleAgentHandlerKeys).toEqual([
      "module_design",
      "module_generate_draft",
      "module_preview_diff",
      "module_validate",
      "module_publish",
      "module_rollback",
    ]);
    expect(() =>
      getModuleAgentInputSchema("module_design").parse({ contract: moduleContract }),
    ).not.toThrow();
    expect(() =>
      getModuleAgentInputSchema("module_design").parse({
        contract: { ...moduleContract, unexpected: true },
      }),
    ).toThrow();
    expect(() =>
      getModuleAgentInputSchema("module_preview_diff").parse({ name: "../../unsafe" }),
    ).toThrow();
  });

  it("executes design, draft, diff and validation through the shared generator services", async () => {
    const calls: string[] = [];
    const auditEntries: Array<Record<string, unknown>> = [];
    const dependencies = createDependencies(calls);
    const runtimeOptions = options(dependencies, auditEntries);

    const designed = await executeModuleAgentTool(
      tool("module_design"),
      { contract: moduleContract },
      runtimeOptions,
    );
    expect(designed).toMatchObject({ name: "cms-config", title: "CMS 配置" });

    const draft = await executeModuleAgentTool(
      tool("module_generate_draft"),
      { contract: moduleContract },
      runtimeOptions,
    );
    expect(draft).toMatchObject({
      outputRoot: "generated/module-drafts/cms-config",
      files: [{ path: "generated/module-drafts/cms-config/module.config.json", size: 128 }],
    });
    expect(JSON.stringify(draft)).not.toContain("content");

    const diff = await executeModuleAgentTool(
      tool("module_preview_diff"),
      { name: "cms-config" },
      runtimeOptions,
    );
    expect(diff).toMatchObject({ name: "cms-config", planHash, ready: true });

    const validation = await executeModuleAgentTool(
      tool("module_validate"),
      { name: "cms-config", planHash },
      runtimeOptions,
    );
    expect(validation).toMatchObject({
      planHash,
      validation: { passed: true, output: "22/22" },
    });
    expect(calls).toEqual(["design", "generate", "preview", "validate"]);
    expect(auditEntries).toHaveLength(4);
    expect(auditEntries.every((entry) => entry.success === true)).toBe(true);
  });

  it("requires an explicit approval context before publish or rollback can mutate source", async () => {
    const calls: string[] = [];
    const auditEntries: Array<Record<string, unknown>> = [];
    const dependencies = createDependencies(calls);
    const runtimeOptions = options(dependencies, auditEntries);

    await expect(
      executeModuleAgentTool(
        tool("module_publish"),
        { name: "cms-config", planHash },
        runtimeOptions,
      ),
    ).rejects.toThrow(/人工审批/);
    await expect(
      executeModuleAgentTool(
        tool("module_rollback"),
        { name: "cms-config", publishId: "publish-1" },
        runtimeOptions,
      ),
    ).rejects.toThrow(/人工审批/);
    expect(calls).toEqual([]);

    await executeModuleAgentTool(
      tool("module_publish"),
      { name: "cms-config", planHash },
      { ...runtimeOptions, approvedMutation: true },
    );
    await executeModuleAgentTool(
      tool("module_rollback"),
      { name: "cms-config", publishId: "publish-1" },
      { ...runtimeOptions, approvedMutation: true },
    );
    expect(calls).toEqual(["publish", "rollback"]);
    expect(auditEntries.filter((entry) => entry.success === false)).toHaveLength(2);
    expect(auditEntries.filter((entry) => entry.success === true)).toHaveLength(2);
  });

  it("prepares approval evidence with plan hash, affected files, validation and expiry", async () => {
    const calls: string[] = [];
    const dependencies = createDependencies(calls);
    const publish = await prepareModuleAgentApproval(
      tool("module_publish"),
      { name: "cms-config", planHash },
      { userId: 2, dependencies, abilityCheck: async () => true },
    );
    expect(publish).toMatchObject({
      planHash,
      affectedFiles: ["src/server/routes/system/cms-config.ts"],
      validation: { passed: true },
    });
    expect(new Date(publish.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const rollback = await prepareModuleAgentApproval(
      tool("module_rollback"),
      { name: "cms-config", publishId: "publish-1" },
      { userId: 2, dependencies, abilityCheck: async () => true },
    );
    expect(rollback).toMatchObject({ planHash, publishId: "publish-1" });
    expect(calls).toEqual(["publishApproval", "rollbackApproval"]);
  });

  it("persists isolated validation evidence and refuses missing or stale approval plans", async () => {
    const name = "qa-agent-module";
    const draftRoot = path.join(process.cwd(), "generated/module-drafts", name);
    await fs.rm(draftRoot, { recursive: true, force: true });
    try {
      await generateModuleDraft({
        config: {
          name,
          title: "Agent 验证模块",
          fields: [{ name: "name", label: "名称", required: true, search: true }],
        },
      });
      const plan = await buildModulePublishPlan(name);
      expect(plan).toMatchObject({ ready: true });
      await expect(getModulePublishApprovalMetadata(name, plan.planHash)).rejects.toThrow(
        /module_validate/,
      );
      await expect(validateModuleDraft(name, "d".repeat(64))).rejects.toThrow(/重新检查发布差异/);

      const record = await validateModuleDraft(name, plan.planHash);
      expect(record).toMatchObject({
        moduleName: name,
        planHash: plan.planHash,
        validation: { passed: true },
      });
      const approval = await getModulePublishApprovalMetadata(name, plan.planHash);
      expect(approval).toMatchObject({
        planHash: plan.planHash,
        affectedFiles: record.affectedFiles,
        validation: { passed: true },
      });
    } finally {
      await fs.rm(draftRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("propagates stale-plan and conflict failures without invoking a mutation", async () => {
    const calls: string[] = [];
    const dependencies = createDependencies(calls);
    dependencies.publishApproval = async () => {
      throw new Error("草稿或项目源码已变化，请重新检查发布差异");
    };
    await expect(
      prepareModuleAgentApproval(
        tool("module_publish"),
        { name: "cms-config", planHash },
        { userId: 2, dependencies, abilityCheck: async () => true },
      ),
    ).rejects.toThrow(/重新检查发布差异/);
    expect(calls).not.toContain("publish");

    dependencies.publishApproval = async () => {
      throw new Error("发布计划存在冲突：权限标识已存在");
    };
    await expect(
      prepareModuleAgentApproval(
        tool("module_publish"),
        { name: "cms-config", planHash },
        { userId: 2, dependencies, abilityCheck: async () => true },
      ),
    ).rejects.toThrow(/存在冲突/);
    expect(calls).not.toContain("publish");
  });

  it("rejects custom aliases, missing abilities and production execution", async () => {
    const calls: string[] = [];
    const dependencies = createDependencies(calls);
    await expect(
      executeModuleAgentTool(
        { ...tool("module_design"), code: "custom-design" },
        { contract: moduleContract },
        { userId: 2, dependencies, abilityCheck: async () => true },
      ),
    ).rejects.toThrow(/系统内置定义/);
    await expect(
      executeModuleAgentTool(
        tool("module_generate_draft"),
        { contract: moduleContract },
        { userId: 2, dependencies, abilityCheck: async () => false },
      ),
    ).rejects.toThrow(/没有权限/);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://admin:secret@db.internal:5432/admin_base_prod");
    vi.stubEnv("ADMIN_BASE_SECRET_KEY", "production-secret-that-is-not-default");
    vi.stubEnv("ADMIN_BASE_ADMIN_PASSWORD", "ProductionPassword123!");
    await expect(
      executeModuleAgentTool(
        tool("module_design"),
        { contract: moduleContract },
        { userId: 1, dependencies, abilityCheck: async () => true },
      ),
    ).rejects.toThrow(/仅允许在非生产环境/);
    expect(calls).toEqual([]);
  });
});
