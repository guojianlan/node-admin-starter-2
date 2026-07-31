"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type AdminThemeMode = "light" | "dark";
export type AdminLocale = "zh-CN" | "en-US";
export type AdminLayoutMode = "side" | "top" | "mix" | "columns";

type AdminPreferences = {
  themeMode: AdminThemeMode;
  locale: AdminLocale;
  layoutMode: AdminLayoutMode;
  setThemeMode: (value: AdminThemeMode) => void;
  setLocale: (value: AdminLocale) => void;
  setLayoutMode: (value: AdminLayoutMode) => void;
  resetPreferences: () => void;
  t: (key: string) => string;
};

const storageKey = "admin-base-preferences";

type PreferenceState = {
  themeMode: AdminThemeMode;
  locale: AdminLocale;
  layoutMode: AdminLayoutMode;
};

const defaultPreferences: PreferenceState = {
  themeMode: "light",
  locale: "zh-CN",
  layoutMode: "side",
};

const messages: Record<AdminLocale, Record<string, string>> = {
  "zh-CN": {
    home: "首页",
    github: "GitHub",
    search: "搜索",
    fullscreen: "全屏",
    exitFullscreen: "退出全屏",
    language: "语言",
    settings: "设置",
    interfaceSettings: "界面设置",
    profile: "个人中心",
    logout: "退出登录",
    noticeCenter: "消息中心",
    markAllRead: "全部已读",
    noNotice: "暂无消息",
    layoutStyle: "布局样式",
    presetTheme: "预设主题",
    light: "亮色",
    dark: "暗色",
    resetSettings: "重置设置",
    sideMenu: "侧边菜单",
    topMenu: "顶部菜单",
    mixMenu: "混合菜单",
    columnsMenu: "分栏菜单",
    username: "用户名",
    password: "密码",
    remember: "保持登录",
    forgotPassword: "忘记密码",
    login: "登录",
    captcha: "验证码",
    inputCaptcha: "请输入验证码",
    otherLoginMethods: "其他登录方式",
    noOauthProviders: "未启用第三方登录",
    forgotPasswordTitle: "忘记密码",
    accountEmailMobile: "账号 / 邮箱 / 手机号",
    sendResetMail: "发送重置邮件",
    cancel: "取消",
    resetPassword: "重置密码",
    newPassword: "新密码",
    confirmNewPassword: "确认新密码",
    adminSubtitle: "起手式后台管理框架",
    profileSubtitle: "维护个人资料、头像、密码和登录记录",
    baseInfo: "基本资料",
    securitySettings: "安全设置",
    loginRecords: "登录记录",
    saveProfile: "保存资料",
    changePassword: "修改密码",
    uploadAvatar: "上传头像",
    refresh: "刷新",
    lastLogin: "最近登录",
    passwordUpdatedAt: "密码更新时间",
    nickname: "昵称",
    mobile: "手机号",
    email: "邮箱",
    sex: "性别",
    unknown: "未知",
    male: "男",
    female: "女",
    bio: "个人简介",
    oldPassword: "旧密码",
    result: "结果",
    success: "成功",
    failed: "失败",
    message: "消息",
    time: "时间",
  },
  "en-US": {
    home: "Home",
    github: "GitHub",
    search: "Search",
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    language: "Language",
    settings: "Settings",
    interfaceSettings: "Interface settings",
    profile: "Profile",
    logout: "Sign out",
    noticeCenter: "Notifications",
    markAllRead: "Mark all read",
    noNotice: "No notifications",
    layoutStyle: "Layout",
    presetTheme: "Theme",
    light: "Light",
    dark: "Dark",
    resetSettings: "Reset",
    sideMenu: "Side nav",
    topMenu: "Top nav",
    mixMenu: "Mixed nav",
    columnsMenu: "Column nav",
    username: "Username",
    password: "Password",
    remember: "Remember me",
    forgotPassword: "Forgot password",
    login: "Log in",
    captcha: "Captcha",
    inputCaptcha: "Enter captcha",
    otherLoginMethods: "Other sign-in methods",
    noOauthProviders: "No third-party sign-in enabled",
    forgotPasswordTitle: "Forgot password",
    accountEmailMobile: "Account / email / mobile",
    sendResetMail: "Send reset email",
    cancel: "Cancel",
    resetPassword: "Reset password",
    newPassword: "New password",
    confirmNewPassword: "Confirm password",
    adminSubtitle: "Starter admin management framework",
    profileSubtitle: "Manage your profile, avatar, password, and login records",
    baseInfo: "Profile",
    securitySettings: "Security",
    loginRecords: "Login records",
    saveProfile: "Save profile",
    changePassword: "Change password",
    uploadAvatar: "Upload avatar",
    refresh: "Refresh",
    lastLogin: "Last login",
    passwordUpdatedAt: "Password updated",
    nickname: "Nickname",
    mobile: "Mobile",
    email: "Email",
    sex: "Gender",
    unknown: "Unknown",
    male: "Male",
    female: "Female",
    bio: "Bio",
    oldPassword: "Current password",
    result: "Result",
    success: "Success",
    failed: "Failed",
    message: "Message",
    time: "Time",
  },
};

function readInitialPreferences(): PreferenceState {
  if (typeof window === "undefined") return defaultPreferences;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "{}") as Partial<PreferenceState>;
    return {
      themeMode: parsed.themeMode === "dark" ? "dark" : "light",
      locale: parsed.locale === "en-US" ? "en-US" : "zh-CN",
      layoutMode: ["side", "top", "mix", "columns"].includes(String(parsed.layoutMode))
        ? (parsed.layoutMode as AdminLayoutMode)
        : "side",
    };
  } catch {
    return defaultPreferences;
  }
}

function applyPreferences(input: PreferenceState) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.adminTheme = input.themeMode;
  document.documentElement.dataset.adminLocale = input.locale;
  document.documentElement.dataset.adminLayout = input.layoutMode;
  document.documentElement.lang = input.locale;
}

const PreferencesContext = createContext<AdminPreferences | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<PreferenceState>(readInitialPreferences);

  useEffect(() => {
    applyPreferences(preferences);
    window.localStorage.setItem(storageKey, JSON.stringify(preferences));
  }, [preferences]);

  const value = useMemo<AdminPreferences>(
    () => ({
      ...preferences,
      setThemeMode: (themeMode) => setPreferences((current) => ({ ...current, themeMode })),
      setLocale: (locale) => setPreferences((current) => ({ ...current, locale })),
      setLayoutMode: (layoutMode) => setPreferences((current) => ({ ...current, layoutMode })),
      resetPreferences: () => setPreferences(defaultPreferences),
      t: (key) => messages[preferences.locale][key] ?? messages["zh-CN"][key] ?? key,
    }),
    [preferences],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function useAdminPreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("useAdminPreferences must be used within PreferencesProvider");
  return context;
}
