import type { ApiTestCase, PageTestCase } from "../../tests/coverage/types";

function escapeCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function listCell(values: string[]) {
  return values.map((value, index) => `${index + 1}. ${escapeCell(value)}`).join("<br>");
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = keyFor(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });
  return groups;
}

export function renderApiTestCases(cases: ApiTestCase[]) {
  const coverageCounts = new Map<string, number>();
  cases.forEach((item) => coverageCounts.set(item.coverage, (coverageCounts.get(item.coverage) ?? 0) + 1));
  const lines = [
    "# Admin Base API 测试用例矩阵",
    "",
    "> 该文件由 `pnpm test:docs` 根据 `tests/coverage/api-test-cases.ts` 生成。请修改机器可读清单，不要直接维护本文件。",
    "",
    "## 1. 范围与判定",
    "",
    `- 当前登记 API 操作：**${cases.length}** 个。`,
    `- 覆盖状态：${[...coverageCounts.entries()].map(([key, value]) => `\`${key}\` ${value}`).join("，")}。`,
    "- 成功不仅指 HTTP 2xx，还必须同时满足响应契约、数据事实、权限范围、副作用和审计要求。",
    "- 失败不仅指返回错误，还必须验证无越权、无敏感信息泄漏、无部分写入、可追踪且可以恢复或重试。",
    "- `automated` 表示已有自动化覆盖该模块主路径，不等于该操作的每个分支均已自动化；逐接口自动化仍按风险递增补齐。",
    "- `environment` 表示需要真实 SMTP、S3、OAuth、SMS 或 AI Provider；`manual` 表示当前主要依赖手工验收；`planned` 表示用例已登记但自动化尚未落地。",
    "",
  ];

  let sequence = 1;
  for (const [area, areaCases] of groupBy(cases, (item) => item.area)) {
    lines.push(`## ${area}`, "");
    lines.push("| ID | Operation | 成功标准 | 失败标准 | 数据断言 | 安全要求 | 副作用/审计 | 覆盖 |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
    areaCases.forEach((item) => {
      lines.push(
        `| API-${String(sequence).padStart(3, "0")} | \`${item.operation}\` | ${listCell(item.success)} | ${listCell(item.failures)} | ${listCell(item.dataAssertions)} | ${listCell(item.security)} | ${listCell(item.sideEffects)} | \`${item.coverage}\` |`,
      );
      sequence += 1;
    });
    lines.push("");
  }

  lines.push(
    "## 执行记录",
    "",
    "每次执行至少记录版本、环境、用例 ID、结果、requestId 或日志证据。结果只允许 `Pass`、`Fail`、`Blocked`、`Skipped`。P0 业务用例或安全接口存在 `Fail` 时禁止发布。",
    "",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderPageTestCases(cases: PageTestCase[]) {
  const lines = [
    "# Admin Base 页面验收测试矩阵",
    "",
    "> 该文件由 `pnpm test:docs` 根据 `tests/coverage/page-test-cases.ts` 生成。请修改机器可读清单，不要直接维护本文件。",
    "",
    "## 1. 范围与判定",
    "",
    `- 当前登记 App Router 页面：**${cases.length}** 个。`,
    "- 数据验收覆盖成功、加载、空数据和错误四种状态。",
    "- 交互验收覆盖成功、表单/网络/业务失败以及页面和动作权限。",
    "- 视觉验收覆盖桌面、窄屏、浅色和暗色；视觉成功要求无重叠、无意外溢出、可读层级清楚、固定区域稳定。",
    "- 视觉失败包括但不限于：表格底边框缺失、内容区未撑满、固定头尾遮挡、暗色硬编码白底、侧栏文字溢出、弹层截断、loading 引发布局跳动。",
    "- 视觉用例需要截图或录屏证据；数据用例需要 API 响应、数据库断言或 requestId 证据。",
    "",
    "## 2. 页面索引",
    "",
    "| ID | Route | 模块 | 覆盖 |",
    "| --- | --- | --- | --- |",
  ];

  cases.forEach((item, index) => {
    lines.push(`| PAGE-${String(index + 1).padStart(3, "0")} | \`${item.path}\` | ${escapeCell(item.area)} | \`${item.coverage}\` |`);
  });

  lines.push("", "## 3. 逐页面验收标准", "");
  cases.forEach((item, index) => {
    lines.push(
      `### PAGE-${String(index + 1).padStart(3, "0")} \`${item.path}\``,
      "",
      `- 模块：${item.area}`,
      `- 数据成功：${item.data.success}`,
      `- Loading：${item.data.loading}`,
      `- Empty：${item.data.empty}`,
      `- Error：${item.data.error}`,
      `- 交互成功：${item.interaction.success}`,
      `- 交互失败：${item.interaction.failure}`,
      `- 权限：${item.interaction.permission}`,
      `- Desktop：${item.visual.desktop}`,
      `- Narrow：${item.visual.narrow}`,
      `- Light：${item.visual.light}`,
      `- Dark：${item.visual.dark}`,
      `- 当前覆盖：\`${item.coverage}\``,
      "",
    );
  });

  lines.push(
    "## 4. 视觉执行视口",
    "",
    "- Desktop：1440 x 900，覆盖展开/收起侧栏以及侧边、混合、分栏、顶部菜单模式。",
    "- Narrow desktop：1024 x 768，重点检查表格横向滚动、搜索区换行和弹层可用性。",
    "- Mobile acceptance：390 x 844，只要求关键工作流可达、无页面级溢出和遮挡；高密度后台表格允许容器内滚动。",
    "- 每个视口至少执行浅色和暗色；主题切换后弹窗、抽屉、Dropdown、Tooltip 等 Portal 内容也必须正确。",
    "",
    "## 5. 视觉结果记录",
    "",
    "每个页面记录版本、路由、布局模式、主题、视口、结果和截图路径。数据正确但视觉失败仍记为 `Fail`，不能以接口成功替代页面验收。",
    "",
  );
  return `${lines.join("\n").trimEnd()}\n`;
}
