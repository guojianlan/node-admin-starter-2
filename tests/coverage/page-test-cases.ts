import type { PageTestCase } from "./types";
import { generatedModulePageTestCases } from "./generated-module-test-cases";

type PageDefinition = {
  path: string;
  area: string;
  content: string;
  primaryAction: string;
  desktop: string;
  empty?: string;
  permission?: string;
  coverage?: PageTestCase["coverage"];
};

function pageCase(definition: PageDefinition): PageTestCase {
  return {
    path: definition.path,
    area: definition.area,
    data: {
      success: `${definition.content}使用真实接口数据，字段、总数、排序、筛选和刷新结果一致`,
      loading: "首次加载和刷新期间显示稳定 loading，不闪现旧数据、不改变主布局尺寸",
      empty: definition.empty ?? "无记录时显示明确空状态，保留可用的新增、刷新或返回动作",
      error: "接口失败时显示可读错误和重试入口；旧数据不伪装成最新成功结果",
    },
    interaction: {
      success: `${definition.primaryAction}完成后给出明确反馈，列表、详情、URL 和缓存状态同步`,
      failure: "表单校验、业务约束或网络失败时保留用户输入，关闭重复提交并显示准确原因",
      permission:
        definition.permission ??
        "无页面权限时菜单不可见且直接访问被拒绝；无动作权限时对应按钮不可见或禁用",
    },
    visual: {
      desktop: `${definition.desktop}；主工作区填满 Shell 分配的可用高度，页面头部保持稳定，表格、Tabs、树或专用画布在内容区内部滚动，底部不出现因自然高度收缩造成的无意义空白`,
      narrow: "窄屏下无控件重叠和横向页面溢出；复杂表格允许容器内横向滚动，关键操作仍可触达",
      light: "浅色主题下背景、边框、正文、次要文字、选中态和危险操作达到清晰层级与可读对比",
      dark: "暗色主题不出现硬编码白底/黑字；表格、弹窗、抽屉、编辑器、图表和 hover 状态均可辨识",
    },
    coverage: definition.coverage ?? "mixed",
  };
}

export const pageTestCases: PageTestCase[] = [
  pageCase({
    path: "/",
    area: "入口路由",
    content: "根路由不承载业务数据并按登录状态进入正确目标页",
    primaryAction: "访问根地址",
    desktop: "跳转过程不展示破碎 Shell、不产生明显布局闪烁或重复导航",
    empty: "该路由无空数据态；未登录进入登录页，已登录进入 Dashboard",
    permission: "跳转不能绕过登录和强制改密守卫",
    coverage: "automated",
  }),
  pageCase({
    path: "/login",
    area: "认证",
    content: "登录策略、验证码开关和 OAuth Provider 入口",
    primaryAction: "密码登录、验证码刷新、忘记密码和 OAuth 跳转",
    desktop: "登录表单在首屏视觉居中，Logo、标题、输入框、主按钮和辅助入口层级清楚且无装饰性干扰",
    empty: "没有可用 OAuth Provider 时仅隐藏第三方入口，账号密码登录保持完整",
    permission: "登录页允许匿名访问；已登录用户访问时按产品策略跳转后台",
    coverage: "mixed",
  }),
  pageCase({
    path: "/dashboard",
    area: "系统状态",
    content: "登录、在线用户、操作日志、存储、邮件、公告和 doctor 摘要指标",
    primaryAction: "查看指标并跳转对应管理页面或公告详情",
    desktop: "指标密度适合运维后台，卡片高度稳定，图表与状态列表对齐且不使用营销大屏构图",
    permission: "只展示当前用户有权访问模块的指标和跳转入口",
    coverage: "mixed",
  }),
  pageCase({
    path: "/profile",
    area: "个人中心",
    content: "个人资料、头像、密码、登录记录和 OAuth 绑定",
    primaryAction: "更新资料、上传头像、修改密码和绑定/解绑第三方账号",
    desktop: "资料导航与编辑区比例稳定，头像、表单、历史记录和安全动作形成清楚分组，不使用卡片嵌套",
    permission: "仅能读取和修改当前用户；强制改密期间该页和退出登录仍可使用",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/user",
    area: "用户管理",
    content: "用户分页、部门树、角色、状态和搜索条件",
    primaryAction: "新增、编辑、删除、重置密码、分配角色和切换部门筛选",
    desktop:
      "部门树与主表格撑满可用高度；用户名、昵称、部门、角色、状态和操作列宽合理，表头/分页固定且底边框完整",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/role",
    area: "角色权限",
    content: "角色列表、成员、菜单权限和数据范围",
    primaryAction: "新增、编辑、复制角色、预览授权差异并保存权限",
    desktop: "角色表格、权限树和差异确认抽屉使用完整容器高度；长权限名称可读，危险权限有视觉标识",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/rule",
    area: "菜单权限",
    content: "菜单、路由、目录和动作权限树",
    primaryAction: "新增、编辑、显隐、启停和删除权限节点",
    desktop:
      "树形表格撑满内容区，不设置无理由的较小 max-height；层级缩进、展开控件、固定操作列和底边框清晰",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/dept",
    area: "组织架构",
    content: "部门树、负责人、状态和部门用户",
    primaryAction: "新增子部门、编辑、删除和查看部门用户",
    desktop: "树表层级与操作列平衡，长部门名不挤压状态和操作，表格占满内容区并保留底部边界",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/dict",
    area: "字典管理",
    content: "字典类型、编码、状态和关联字典项",
    primaryAction: "新增、编辑、删除字典并进入字典项",
    desktop: "搜索、主操作、表格和分页形成单一工作流；编码列可复制，状态与操作列宽稳定",
  }),
  pageCase({
    path: "/system/dict/item",
    area: "字典管理",
    content: "当前字典的字典项、值、排序、颜色和状态",
    primaryAction: "返回字典列表并新增、编辑、删除字典项",
    desktop: "父字典上下文始终可见；值、标签、颜色预览和排序列对齐，返回入口位置稳定",
  }),
  pageCase({
    path: "/system/config",
    area: "配置项维护",
    content: "配置分组、键、值、类型、敏感标记和状态",
    primaryAction: "新增、编辑、批量保存、删除并刷新配置缓存",
    desktop: "分组导航和配置表格密度适中；长值安全截断并可查看，敏感值不在表格直接展示",
  }),
  pageCase({
    path: "/system/settings",
    area: "系统设置",
    content: "基础、安全、登录、Token、上传、存储、邮件和登录方式设置",
    primaryAction: "按分区独立保存策略并执行资源管理或连接测试",
    desktop:
      "分组导航、表单标题、说明、控件和保存区对齐；设置卡片边界完整，头部和保存动作固定，长表单在卡片正文内部滚动；开关使用 Switch 而非文字按钮",
    empty: "配置项未初始化时明确指出缺失键和初始化方式，不静默隐藏整个分区",
  }),
  pageCase({
    path: "/system/file",
    area: "文件管理",
    content: "文件夹、文件列表、上传进度、回收站和文件引用",
    primaryAction: "普通/分片上传、移动、复制、重命名、下载、恢复和清理",
    desktop:
      "目录树、文件表格和上传队列使用稳定高度；名称列优先，大小/类型/状态/操作固定，进度不会推动布局",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/storage",
    area: "存储配置",
    content: "本地/S3 存储、默认状态、启停和连接状态",
    primaryAction: "新增、编辑、测试连接、切换默认和启停存储",
    desktop:
      "资源类型、默认、状态和测试结果可扫描；密钥只显示已配置状态，危险操作与普通编辑有层级区分",
  }),
  pageCase({
    path: "/system/mail/account",
    area: "邮件配置",
    content: "SMTP 账号、默认状态、启停和连接参数",
    primaryAction: "新增、编辑、发送测试邮件、切换默认和启停账号",
    desktop: "账号、主机、端口、默认、状态和操作列清楚；密码不回显，测试弹窗聚焦收件人与结果",
  }),
  pageCase({
    path: "/system/oauth/provider",
    area: "第三方登录",
    content: "OAuth Provider、端点、Client ID、Scope、映射和自动创建策略",
    primaryAction: "新增、编辑、测试、启停和删除 Provider",
    desktop:
      "Provider 名称与 key 优先展示，端点等长文本放详情；密钥仅显示配置状态，模板选择与自定义字段分层",
  }),
  pageCase({
    path: "/system/sms/provider",
    area: "短信配置",
    content: "SMS Provider、默认状态、Webhook、签名和密钥状态",
    primaryAction: "新增、编辑、测试发送、切换默认和启停 Provider",
    desktop: "Provider、类型、默认、状态和操作列稳定；长 URL 不撑宽表格，密钥不回显",
  }),
  pageCase({
    path: "/system/sms/template",
    area: "短信模板",
    content: "模板编码、Provider、内容、变量、状态和测试结果",
    primaryAction: "新增、编辑、启停、删除和测试模板渲染",
    desktop: "模板内容使用受控截断和详情查看；变量标签可换行，状态和操作保持固定宽度",
  }),
  pageCase({
    path: "/system/notice",
    area: "通知公告",
    content: "公告内容、范围、发布时间、有效期、置顶、优先级和阅读统计",
    primaryAction: "编辑、定时发布、撤回、删除并查看阅读明细",
    desktop: "标题列优先，发布状态/范围/时间可快速扫描；富文本编辑区、统计抽屉和详情内容宽度可读",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/login/log",
    area: "登录审计",
    content: "登录用户、方式、IP、UA、成功状态、原因和时间",
    primaryAction: "筛选、查看详情、删除和按条件清理日志",
    desktop: "用户名、方式、结果、IP 和时间作为主列；长 UA 放详情，筛选区紧凑，分页与底边框完整",
  }),
  pageCase({
    path: "/system/online/user",
    area: "在线会话",
    content: "在线 token、用户、来源、IP、UA、最近活跃和过期时间",
    primaryAction: "筛选、强制单会话/用户下线并清理过期 token",
    desktop: "用户、来源、IP、活跃和到期时间可比较；UA 放详情，强制下线使用明确危险确认",
  }),
  pageCase({
    path: "/system/operation/log",
    area: "操作审计",
    content: "用户、模块、动作、风险、requestId、IP、状态、耗时和详情",
    primaryAction: "组合筛选、查看 JSON/变更摘要、复制追踪、导出和清理",
    desktop:
      "风险、动作、用户、状态和时间为主列；requestId 可复制，JSON 详情在抽屉内格式化，固定操作列不遮挡内容",
  }),
  pageCase({
    path: "/system/ai/provider",
    area: "AI Provider",
    content: "AI SDK Provider 类型、Base URL、API Key 状态、默认和启停状态",
    primaryAction: "新增、编辑、测试流式回答、切默认和启停 Provider",
    desktop:
      "Provider 类型、名称、默认和状态可扫描；测试使用独立弹窗，流式 Markdown 区域宽度和停止操作稳定",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/ai/model",
    area: "AI 模型",
    content: "模型 ID、Provider、用途、上下文、输出上限、默认和状态",
    primaryAction: "新增、编辑、测试模型、切默认和启停模型",
    desktop:
      "模型 ID 和用途为主信息，上下文/输出上限数字对齐；测试弹窗区分 Prompt、流输出、用量和结束原因",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/ai/playground",
    area: "AI Playground",
    content: "Provider、模型、Prompt、System Prompt、输出限制和流式结果",
    primaryAction: "发送、停止、调整参数并查看 Markdown、用量和结束原因",
    desktop:
      "参数区与结果区比例合理；输入、发送/停止、流式正文和用量不重叠，长内容在结果区内部滚动",
    empty: "未配置可用模型时显示前往 Provider/模型管理的明确入口",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/ai/chat",
    area: "AI Chat",
    content: "会话、消息、模型、Agent、System Prompt、Run/Step、审批和使用量",
    primaryAction: "创建/切换会话、发送/停止/重新生成、选择 Agent、审批工具和导出",
    desktop:
      "会话栏、消息滚动区、固定输入区和运行检查器高度闭合；用户/AI 消息左右语义明确，Streamdown 正文占满可读宽度",
    empty: "无会话时提供直接创建或发送入口；无模型时显示配置入口而不是空白聊天框",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/ai/agent",
    area: "AI Agent",
    content: "Agent、Tool、模型、System Prompt、模块开发工具、审批证据和调试 Run/Step/Approval",
    primaryAction: "创建/编辑 Agent 和 Tool、运行模块设计/草稿/差异/验证，并审批或拒绝发布与回滚",
    desktop:
      "Agent 列表、配置表单和调试轨迹职责清楚；审批展示计划哈希、影响文件、验证输出和有效期，运行时间线不与表单混杂",
    empty: "无 Agent 时提供创建入口和必要字段，不只展示不可操作的通用助手文案",
    coverage: "mixed",
  }),
  pageCase({
    path: "/system/module/generator",
    area: "模块生成器",
    content: "共享模块契约、字段、草稿、发布差异、隔离预检、发布记录和源码回滚状态",
    primaryAction: "生成草稿、检查逐文件差异、隔离预检、发布到真实项目并按快照回滚源码",
    desktop:
      "定义表单、文件预览、草稿/已发布状态和发布风险分区明确；发布前后源码并排可滚动且不撑破页面",
    empty: "没有草稿时展示创建入口；缺少开发环境能力时说明不可发布原因",
    permission: "仅开发/测试环境和有权限用户可用，生产环境发布动作必须拒绝",
  }),
  ...generatedModulePageTestCases,
];
