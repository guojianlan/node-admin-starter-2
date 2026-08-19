import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const adminAppRoot = path.join(projectRoot, "src/app/(admin)");

function collectPageFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectPageFiles(target);
    return entry.name === "page.tsx" ? [target] : [];
  });
}

function resolveFeatureFile(importPath: string) {
  const relativePath = importPath.replace(/^@\//, "");
  const candidates = [
    path.join(projectRoot, "src", `${relativePath}.tsx`),
    path.join(projectRoot, "src", relativePath, "index.tsx"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

describe("admin workspace layout contract", () => {
  it("routes every admin page through a PageScaffold feature surface", () => {
    const failures = collectPageFiles(adminAppRoot).flatMap((pageFile) => {
      const pageSource = fs.readFileSync(pageFile, "utf8");
      const featureImport = pageSource.match(/from\s+["'](@\/features\/[^"']+)["']/)?.[1];
      if (!featureImport)
        return [`${path.relative(projectRoot, pageFile)}: missing feature import`];

      const featureFile = resolveFeatureFile(featureImport);
      if (!featureFile)
        return [`${path.relative(projectRoot, pageFile)}: unresolved ${featureImport}`];

      const featureSource = fs.readFileSync(featureFile, "utf8");
      return featureSource.includes("<PageScaffold")
        ? []
        : [`${path.relative(projectRoot, featureFile)}: missing PageScaffold`];
    });

    expect(failures).toEqual([]);
  });

  it("keeps the shared shell and page workspace on one bounded height chain", () => {
    const css = fs.readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");

    expect(css).toContain(".xin-page-cache-entry > *");
    expect(css).toContain(".admin-page-content > .admin-fill-workspace");
    expect(css).toContain(".admin-fill-tabs");
    expect(css).toContain(".admin-fill-table.ant-table-wrapper");
    expect(css).toContain("overflow: hidden;");
    expect(css).toContain("min-height: 0;");
  });

  it("keeps list pages focused through the shared table workspace header", () => {
    const table = fs.readFileSync(
      path.join(projectRoot, "src/components/admin-data-table/AdminDataTable.tsx"),
      "utf8",
    );
    const css = fs.readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");
    const featureRoot = path.join(projectRoot, "src/features");

    const collectFeatureFiles = (directory: string): string[] =>
      fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectFeatureFiles(target);
        return entry.name.endsWith(".tsx") ? [target] : [];
      });

    const listPageFailures = collectFeatureFiles(featureRoot).flatMap((featureFile) => {
      const source = fs.readFileSync(featureFile, "utf8");
      if (!source.includes("<PageScaffold") || !source.includes("<AdminDataTable")) return [];
      return source.includes("hideHeader")
        ? []
        : [`${path.relative(projectRoot, featureFile)}: list page must hide the duplicate header`];
    });

    expect(listPageFailures).toEqual([]);
    expect(table).toContain('className="admin-toolbar-total"');
    expect(table).not.toContain('aria-label="每页条数"');
    expect(table).toContain("defaultSearchOpen = false");
    expect(table).toContain("activeFilterCount");
    expect(table).toContain('className="admin-search-toggle-count"');
    expect(table).toContain("onChange={(event) => setDraftKeyword(event.target.value)}");
    expect(table).not.toContain("if (!value && state.keyword)");
    expect(table).toContain("const previousAppliedKeyword = useRef(appliedKeyword)");
    expect(table).toContain("previousAppliedKeyword.current = appliedKeyword");
    expect(table).toContain('setDraftKeyword("")');
    expect(table).toContain("showSizeChanger: true");
    expect(table).toContain("pageSizeOptions:");
    expect(table).toContain('aria-label="行间距"');
    expect(table).toContain('aria-label={bordered ? "隐藏边框" : "显示边框"}');
    expect(table).toContain('aria-label="列设置"');
    expect(table).toContain('className="admin-table-commandbar"');
    expect(table).toContain("quickFilters?.map");
    expect(css).toContain(".admin-table-commandbar");
    expect(css).toContain(".admin-table-quick-filter.is-active");
    expect(css).toContain(".admin-search-toggle-count");
  });

  it("reopens menu destinations with their latest tab query state", () => {
    const pageTabs = fs.readFileSync(
      path.join(projectRoot, "src/ui/shell/admin-page-tabs.ts"),
      "utf8",
    );
    const workspace = fs.readFileSync(
      path.join(projectRoot, "src/ui/shell/AdminPageWorkspace.tsx"),
      "utf8",
    );
    const menu = fs.readFileSync(path.join(projectRoot, "src/ui/shell/AdminMenu.tsx"), "utf8");
    const shell = fs.readFileSync(path.join(projectRoot, "src/ui/shell/AdminShell.tsx"), "utf8");

    expect(pageTabs).toContain("export function getRememberedPageHref");
    expect(pageTabs).toContain("tab.path === path)?.href ?? path");
    expect(pageTabs).toContain("writeStoredPageTabs");
    expect(workspace).toContain("item.path === currentTab.path ? currentTab : item");
    expect(workspace).toContain("navigation.push(tab.href)");
    expect(menu).toContain("navigation.push(getRememberedPageHref(node.path))");
    expect(menu).toContain("navigation.push(getRememberedPageHref(path))");
    expect(shell).toContain("navigation.push(getRememberedPageHref(path))");
  });

  it("keeps settings headers fixed while long forms scroll inside the card body", () => {
    const page = fs.readFileSync(
      path.join(projectRoot, "src/features/system/settings/SettingsPage.tsx"),
      "utf8",
    );
    const css = fs.readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");

    expect(page).toContain('tabPlacement={screens.sm ? "start" : "top"}');
    expect(page).toContain('className="settings-resource-grid settings-resource-scroll"');
    expect(css).toContain(".settings-section-card > .ant-card-body");
    expect(css).toContain(".settings-resource-scroll");
  });

  it("keeps settings center and advanced configuration values synchronized", () => {
    const settingsPage = fs.readFileSync(
      path.join(projectRoot, "src/features/system/settings/SettingsPage.tsx"),
      "utf8",
    );
    const configPage = fs.readFileSync(
      path.join(projectRoot, "src/features/system/config/ConfigPage.tsx"),
      "utf8",
    );

    expect(settingsPage).toContain(
      'invalidateQueries({ queryKey: ["system-config-items"] })',
    );
    expect(configPage).toContain(
      'invalidateQueries({ queryKey: ["system-settings", "config"] })',
    );
    expect(settingsPage).toContain("function renderConfigControl(item: ConfigItem)");
    expect(settingsPage).toContain("{renderConfigControl(item)}");
    expect(settingsPage).not.toContain("<ConfigControl item={item}");
  });

  it("synchronizes role form permission updates with the selected role workspace", () => {
    const table = fs.readFileSync(
      path.join(projectRoot, "src/components/admin-data-table/AdminDataTable.tsx"),
      "utf8",
    );
    const rolePage = fs.readFileSync(
      path.join(projectRoot, "src/features/system/role/RolePage.tsx"),
      "utf8",
    );

    expect(table).toContain('action: "create" | "update" | "delete"');
    expect(table).toContain("values: payload");
    expect(rolePage).toContain("expandRuleSelection(submittedRuleIds, ruleSelectionRelations)");
    expect(rolePage).toContain("setCheckedRuleKeys(updatedRuleIds)");
    expect(rolePage).toContain('if (change.action === "delete")');
  });

  it("derives operation-log module filters from recorded modules and permission names", () => {
    const page = fs.readFileSync(
      path.join(projectRoot, "src/features/system/operation-log/OperationLogPage.tsx"),
      "utf8",
    );
    const route = fs.readFileSync(
      path.join(projectRoot, "src/server/routes/system/operation-log.ts"),
      "utf8",
    );

    expect(page).toContain('request<OperationLogStats>("/api/system/operation/log/stats")');
    expect(page).toContain("statsQuery.data?.modules");
    expect(page).toContain("optionLabel(moduleOptions, value)");
    expect(page).toContain("optionLabel(actionOptions, value)");
    expect(page).toContain("options={moduleOptions}");
    expect(route).toContain("COALESCE(${sysRule.displayName}, ${sysRule.name}");
    expect(route).toContain("eq(sysRule.key, sysOperationLog.module)");
  });

  it("keeps AI resource setup understandable and selectable before activation", () => {
    const setupPage = fs.readFileSync(
      path.join(projectRoot, "src/features/system/ai-setup/AiSetupPage.tsx"),
      "utf8",
    );
    const modelPage = fs.readFileSync(
      path.join(projectRoot, "src/features/system/ai-model/AiModelPage.tsx"),
      "utf8",
    );
    const providerPage = fs.readFileSync(
      path.join(projectRoot, "src/features/system/ai-provider/AiProviderPage.tsx"),
      "utf8",
    );
    const playgroundPage = fs.readFileSync(
      path.join(projectRoot, "src/features/system/ai-playground/AiPlaygroundPage.tsx"),
      "utf8",
    );

    expect(modelPage).not.toContain("disabled: provider.status !== 1");
    expect(modelPage).toContain("未启用");
    expect(modelPage).toContain("formBasicColumns={1}");
    expect(modelPage).toContain("管理服务商连接");
    expect(modelPage).toContain("同步模型");
    expect(modelPage).toContain("open={open && synchronizedModels.length > 0}");
    expect(modelPage).toContain("provider.providerType");
    expect(modelPage).toContain("provider.code");
    expect(modelPage).toContain("1M 上下文模型填写 1000000");
    expect(modelPage).toContain("该值不是单次回答长度");
    expect(modelPage).toContain("留空时使用 16384");
    expect(modelPage).toContain("常用规格");
    expect(modelPage).toContain("contextWindowPresets");
    expect(modelPage).toContain("上下文 ${formatTokenLimit(model.contextWindow)}");
    expect(modelPage).toContain("providersForForm");
    expect(modelPage).toContain('refetchOnMount: "always"');
    expect(modelPage).toContain('"服务商不可用"');
    expect(modelPage).toContain("deleteDisabledReason");
    expect(providerPage).toContain("formBasicColumns={1}");
    expect(providerPage).toContain('title: "连接名称"');
    expect(providerPage).toContain("同一服务商可以创建多套连接");
    expect(providerPage).toContain("一条记录代表一个独立连接");
    expect(providerPage).toContain('dataIndex: "timeoutMs"');
    expect(providerPage).toContain("正式 Chat、Agent、结构化输出和向量调用默认使用此超时");
    expect(providerPage).toContain("常用时间");
    expect(providerPage).toContain("test-models");
    expect(providerPage).toContain("同步后选择模型");
    expect(providerPage).toContain("deleteDisabledReason");
    expect(playgroundPage).toContain("运行模型");
    expect(playgroundPage).toContain("/api/system/ai/playground/options");
    expect(playgroundPage).toContain("modelId: effectiveModelId");
    expect(playgroundPage).toContain("pickFallbackModel");
    expect(playgroundPage).toContain("没有已启用且支持结构化输出的模型");
    expect(modelPage).toContain('["system-ai-playground-options"]');
    expect(providerPage).toContain('["system-ai-playground-runtime"]');
    expect(setupPage).toContain("/api/system/ai/setup/discover");
    expect(setupPage).toContain("/api/system/ai/setup/complete");
    expect(setupPage).toContain("测试并同步模型");
    expect(setupPage).toContain("preserveSelectedRowKeys: true");
    expect(setupPage).toContain("手工配置模型");
    expect(setupPage).toContain("高级连接设置");
    expect(setupPage).toContain('["system-ai-provider-options"]');
    expect(setupPage).toContain('auth="system.aiSetup.configure"');
  });

  it("keeps AI configuration, debugging, conversation, and Agent scopes distinct", () => {
    const readFeature = (name: string) =>
      fs.readFileSync(path.join(projectRoot, `src/features/system/${name}`), "utf8");

    expect(readFeature("ai-playground/AiPlaygroundPage.tsx")).toContain("结果不保存为正式会话");
    expect(readFeature("ai-chat/AiChatPage.tsx")).toContain("面向使用者的连续对话入口");
    expect(readFeature("ai-agent/AiAgentPage.tsx")).toContain("可复用执行单元");
  });

  it("exposes trusted Workflow execution and persisted evidence from the Agent workspace", () => {
    const page = fs.readFileSync(
      path.join(projectRoot, "src/features/system/ai-agent/AiAgentPage.tsx"),
      "utf8",
    );
    const css = fs.readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");

    expect(page).toContain('key: "workflows"');
    expect(page).toContain("/api/system/ai/workflow/definitions");
    expect(page).toContain("/api/system/ai/workflow/ai-runtime-preflight/runs");
    expect(page).toContain('auth="system.aiAgent.executeWorkflow"');
    expect(page).toContain("执行步骤");
    expect(page).toContain('className="ai-agent-tab-panel"');
    expect(page).toContain('className="ai-agent-tab-panel ai-agent-workflow-panel"');
    expect(css).toContain(".ai-agent-tab-panel > .admin-fill-table");
    expect(css).toContain(".ai-agent-workflow-panel");
  });

  it("keeps Web Search configuration governed and renders server-derived Chat sources", () => {
    const providerPage = fs.readFileSync(
      path.join(projectRoot, "src/features/system/ai-web-search/AiWebSearchPage.tsx"),
      "utf8",
    );
    const chatPage = fs.readFileSync(
      path.join(projectRoot, "src/features/system/ai-chat/AiChatPage.tsx"),
      "utf8",
    );
    const css = fs.readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");

    expect(providerPage).toContain("/api/system/ai/web-search/provider");
    expect(providerPage).toContain('auth="system.aiWebSearch.test"');
    expect(providerPage).toContain("Tavily");
    expect(providerPage).toContain("Brave Search");
    expect(providerPage).toContain("SearXNG");
    expect(providerPage).toContain("优先级");
    expect(providerPage).toContain("首选连接");
    expect(providerPage).toContain('defaultSort={{ field: "sort", order: "asc" }}');
    expect(chatPage).toContain('message.event === "sources"');
    expect(chatPage).toContain('aria-label="联网搜索来源"');
    expect(chatPage).toContain("parseMessageSources");
    expect(css).toContain(".ai-chat-source-list");
    expect(css).toContain(".ai-web-search-result-list");
  });

  it("keeps AI Chat timing readable and exposes Agent run details only when relevant", () => {
    const chatPage = fs.readFileSync(
      path.join(projectRoot, "src/features/system/ai-chat/AiChatPage.tsx"),
      "utf8",
    );
    const css = fs.readFileSync(path.join(projectRoot, "src/app/globals.css"), "utf8");

    expect(chatPage).toContain("const [inspectorOpen, setInspectorOpen] = useState(false)");
    expect(chatPage).toContain("const canInspectRun = Boolean(");
    expect(chatPage).toContain("const showInspector = inspectorOpen && canInspectRun");
    expect(chatPage).toContain('message.event === "approval"');
    expect(chatPage).toContain('handlerKey === "browser_location"');
    expect(chatPage).toContain("navigator.geolocation.getCurrentPosition");
    expect(chatPage).toContain("ai-chat-client-permission");
    expect(chatPage).toContain("error.code === error.TIMEOUT");
    expect(chatPage).toContain("parseBrowserLocationNotice");
    expect(chatPage).toContain("BrowserLocationHelpIcons");
    expect(chatPage).toContain("setInspectorOpen(true)");
    expect(chatPage).toContain('aria-label="回答时序"');
    expect(chatPage).toContain("首次响应");
    expect(chatPage).toContain("首字");
    expect(chatPage).toContain("总耗时");
    expect(chatPage).toContain("step.outputJson");
    expect(chatPage).toContain("step.usageJson");
    expect(chatPage).toContain("step.durationMs");
    expect(css).toContain(".ai-chat-response-footer");
    expect(css).toContain(".ai-chat-run-step-data-grid");
    expect(css).toContain("max-height: min(420px, 52vh)");
    expect(chatPage).toContain('className="ai-chat-composer-shell"');
    expect(chatPage).toContain('aria-label="发送消息"');
    expect(chatPage).toContain("function AssistantThinkingState");
    expect(chatPage).toContain('role="status"');
    expect(chatPage).toContain('aria-live="polite"');
    expect(chatPage).toContain('assistantStatus === "streaming" && !message.content.trim()');
    expect(chatPage).toContain('assistantStatus !== "streaming" ? (');
    expect(css).toContain(".ai-chat-thinking");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(chatPage).not.toContain("输出 tokens");
    expect(chatPage).not.toContain("超时 ms");
    expect(chatPage).not.toContain('name="maxOutputTokens"');
    expect(css).toContain("--admin-info:");
    expect(css).toContain('.ai-chat-timing-item[data-tone="info"]');
    expect(chatPage).toContain('aria-label="对话模式"');
    expect(chatPage).toContain("直接对话 · 仅模型");
    expect(chatPage).toContain("联网搜索可用");
    expect(chatPage).toContain('agent.code === "general-assistant"');
    expect(css).toContain(".ai-chat-mode-control");
    expect(css).toContain(".ai-chat-mode-select");
  });
});
