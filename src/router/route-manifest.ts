import type { ComponentType } from "react";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { AiModelPage } from "@/features/system/ai-model/AiModelPage";
import { AiProviderPage } from "@/features/system/ai-provider/AiProviderPage";
import { ConfigPage } from "@/features/system/config/ConfigPage";
import { DictItemPage } from "@/features/system/dict/DictItemPage";
import { DeptPage } from "@/features/system/dept/DeptPage";
import { DictPage } from "@/features/system/dict/DictPage";
import { FilePage } from "@/features/system/file/FilePage";
import { LoginLogPage } from "@/features/system/login-log/LoginLogPage";
import { MailAccountPage } from "@/features/system/mail/MailAccountPage";
import { ModuleGeneratorPage } from "@/features/system/module-generator/ModuleGeneratorPage";
import { NoticePage } from "@/features/system/notice/NoticePage";
import { OnlineUserPage } from "@/features/system/online-user/OnlineUserPage";
import { OperationLogPage } from "@/features/system/operation-log/OperationLogPage";
import { OAuthProviderPage } from "@/features/system/oauth-provider/OAuthProviderPage";
import { ProfilePage } from "@/features/profile/ProfilePage";
import { RolePage } from "@/features/system/role/RolePage";
import { RulePage } from "@/features/system/rule/RulePage";
import { SettingsPage } from "@/features/system/settings/SettingsPage";
import { SmsProviderPage } from "@/features/system/sms-provider/SmsProviderPage";
import { StoragePage } from "@/features/system/storage/StoragePage";
import { UserPage } from "@/features/system/user/UserPage";

export type AdminRouteRecord = {
  path: string;
  key: string;
  component: ComponentType;
  title: string;
  auth?: string;
  adminHidden?: boolean;
};

export const adminRoutes: AdminRouteRecord[] = [
  {
    path: "/dashboard",
    key: "dashboard",
    title: "仪表盘",
    component: DashboardPage,
  },
  {
    path: "/system/user",
    key: "system.user",
    title: "用户管理",
    auth: "system.user.query",
    component: UserPage,
  },
  {
    path: "/system/role",
    key: "system.role",
    title: "角色管理",
    auth: "system.role.query",
    component: RolePage,
  },
  {
    path: "/system/rule",
    key: "system.rule",
    title: "菜单权限",
    auth: "system.rule.query",
    component: RulePage,
  },
  {
    path: "/system/dept",
    key: "system.dept",
    title: "部门管理",
    auth: "system.dept.query",
    component: DeptPage,
  },
  {
    path: "/system/dict",
    key: "system.dict",
    title: "字典管理",
    auth: "system.dict.query",
    component: DictPage,
  },
  {
    path: "/system/dict/item",
    key: "system.dict.item",
    title: "字典项管理",
    auth: "system.dict.query",
    adminHidden: true,
    component: DictItemPage,
  },
  {
    path: "/system/config",
    key: "system.config",
    title: "系统配置",
    auth: "system.config.query",
    component: ConfigPage,
  },
  {
    path: "/system/settings",
    key: "system.settings",
    title: "系统设置",
    auth: "system.settings.query",
    component: SettingsPage,
  },
  {
    path: "/system/file",
    key: "system.file",
    title: "文件管理",
    auth: "system.file.query",
    component: FilePage,
  },
  {
    path: "/system/storage",
    key: "system.storage",
    title: "存储配置",
    auth: "system.storage.query",
    component: StoragePage,
  },
  {
    path: "/system/mail/account",
    key: "system.mail",
    title: "邮件配置",
    auth: "system.mail.query",
    component: MailAccountPage,
  },
  {
    path: "/system/operation/log",
    key: "system.operationLog",
    title: "操作日志",
    auth: "system.operationLog.query",
    component: OperationLogPage,
  },
  {
    path: "/system/login/log",
    key: "system.loginLog",
    title: "登录日志",
    auth: "system.loginLog.query",
    component: LoginLogPage,
  },
  {
    path: "/system/online/user",
    key: "system.onlineUser",
    title: "在线用户",
    auth: "system.onlineUser.query",
    component: OnlineUserPage,
  },
  {
    path: "/system/oauth/provider",
    key: "system.oauthProvider",
    title: "第三方登录",
    auth: "system.oauthProvider.query",
    component: OAuthProviderPage,
  },
  {
    path: "/system/sms/provider",
    key: "system.smsProvider",
    title: "短信配置",
    auth: "system.smsProvider.query",
    component: SmsProviderPage,
  },
  {
    path: "/system/ai/provider",
    key: "system.aiProvider",
    title: "AI Provider",
    auth: "system.aiProvider.query",
    component: AiProviderPage,
  },
  {
    path: "/system/ai/model",
    key: "system.aiModel",
    title: "AI 模型",
    auth: "system.aiModel.query",
    component: AiModelPage,
  },
  {
    path: "/system/module/generator",
    key: "system.moduleGenerator",
    title: "模块生成器",
    auth: "system.moduleGenerator.query",
    component: ModuleGeneratorPage,
  },
  {
    path: "/system/notice",
    key: "system.notice",
    title: "通知公告",
    auth: "system.notice.query",
    component: NoticePage,
  },
  {
    path: "/profile",
    key: "profile",
    title: "个人中心",
    adminHidden: true,
    component: ProfilePage,
  },
];

export const routePathSet = new Set(adminRoutes.map((item) => item.path));
