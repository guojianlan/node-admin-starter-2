import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  adminModuleGeneratorCapabilities,
  adminModuleJsonSchema,
  parseAdminModuleConfig,
} from "@/shared/module-generator-contract";

describe("module generator contract", () => {
  it("keeps the published JSON Schema synchronized with the shared Zod contract", () => {
    const schemaPath = path.join(process.cwd(), "schemas/admin-module.schema.json");
    const publishedSchema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as unknown;

    expect(publishedSchema).toEqual(adminModuleJsonSchema);
  });

  it("normalizes the same defaults for CLI and Web generator callers", () => {
    const config = parseAdminModuleConfig({
      name: "cms-category",
      title: "CMS 分类",
      fields: [{ name: "name", label: "名称", required: true }],
    });

    expect(config).toMatchObject({
      contractVersion: 1,
      domain: "system",
      parentId: 180,
      parentKey: "system.settingsGroup",
      includeSystemField: true,
      softDelete: true,
      audit: true,
      actions: ["query", "create", "update", "delete", "batchDelete"],
    });
    expect(config.fields?.[0]).toMatchObject({
      name: "name",
      type: "text",
      required: true,
      unique: false,
      quickSearch: false,
      sortable: false,
      fullWidth: false,
    });
  });

  it("rejects unknown properties and CRUD actions the generator cannot render", () => {
    expect(() =>
      parseAdminModuleConfig({
        name: "unsafe-module",
        title: "不安全模块",
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      parseAdminModuleConfig({
        name: "unsupported-export",
        title: "不支持导出",
        actions: ["query", "export"],
      }),
    ).toThrow();
  });

  it("rejects unsafe module identities and internally inconsistent CRUD contracts", () => {
    expect(() => parseAdminModuleConfig({ name: "CmsConfig", title: "CMS 配置" })).toThrow(
      /kebab-case/,
    );
    expect(() =>
      parseAdminModuleConfig({
        name: "missing-query",
        title: "缺少查询",
        actions: ["create"],
      }),
    ).toThrow(/query action is required/);
    expect(() =>
      parseAdminModuleConfig({
        name: "duplicate-fields",
        title: "重复字段",
        fields: [
          { name: "displayName", label: "显示名称" },
          { name: "displayNameCopy", column: "display_name", label: "重复列" },
        ],
      }),
    ).toThrow(/duplicate database column/);
    expect(() =>
      parseAdminModuleConfig({
        name: "reserved-field",
        title: "保留字段",
        fields: [{ name: "createdAt", label: "创建时间" }],
      }),
    ).toThrow(/reserved/);
    expect(() =>
      parseAdminModuleConfig({
        name: "invalid-status",
        title: "无效状态",
        actions: ["query", "status"],
        fields: [{ name: "name", label: "名称" }],
      }),
    ).toThrow(/integer status field/);
    expect(() =>
      parseAdminModuleConfig({
        name: "invalid-restore",
        title: "无效恢复",
        actions: ["query", "delete", "restore"],
        softDelete: false,
      }),
    ).toThrow(/softDelete=true/);
    expect(() =>
      parseAdminModuleConfig({
        name: "long-index",
        title: "超长索引",
        table: `sys_${"a".repeat(50)}`,
        fields: [{ name: "uniqueCode", label: "唯一编码", unique: true }],
      }),
    ).toThrow(/index name exceeds 63/);
  });

  it("declares generator limits and published-code ownership", () => {
    expect(adminModuleGeneratorCapabilities.publish).toMatchObject({
      supportedDomains: ["system"],
      productionAllowed: false,
      diffRequired: true,
      isolatedPreflight: true,
      rollbackMetadata: true,
      rollbackProtectsManualChanges: true,
    });
    expect(adminModuleGeneratorCapabilities.ownership).toEqual({
      draft: "generator-owned",
      published: "repository-owned",
      regeneration: "diff-only-no-overwrite",
    });
    expect(adminModuleGeneratorCapabilities.draft).toMatchObject({
      builtInPageActions: ["query", "create", "update", "delete"],
      customUiRequiredActions: ["batchDelete", "restore", "forceDelete", "status"],
      abilityAliases: {
        batchDelete: "delete",
        restore: "delete",
        forceDelete: "delete",
      },
    });
  });
});
