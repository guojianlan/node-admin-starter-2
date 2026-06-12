import type { ComponentType } from "react";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { ConfigPage } from "@/features/system/config/ConfigPage";
import { DeptPage } from "@/features/system/dept/DeptPage";
import { DictPage } from "@/features/system/dict/DictPage";
import { FilePage } from "@/features/system/file/FilePage";
import { RolePage } from "@/features/system/role/RolePage";
import { RulePage } from "@/features/system/rule/RulePage";
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
    path: "/system/config",
    key: "system.config",
    title: "系统配置",
    auth: "system.config.query",
    component: ConfigPage,
  },
  {
    path: "/system/file",
    key: "system.file",
    title: "文件管理",
    auth: "system.file.query",
    component: FilePage,
  },
];

export const routePathSet = new Set(adminRoutes.map((item) => item.path));
