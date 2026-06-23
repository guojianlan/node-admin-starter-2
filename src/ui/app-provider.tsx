"use client";

import { App as AntApp, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/zh-cn";
import { AntdFeedbackBridge } from "@/ui/feedback/AntdFeedbackBridge";
import { PreferencesProvider, useAdminPreferences } from "@/ui/preferences";
import { QueryProvider } from "@/ui/query/QueryProvider";
import { createAntdTheme } from "@/ui/theme/antd-theme";

function AppProviderInner({ children }: { children: React.ReactNode }) {
  const { locale, themeMode } = useAdminPreferences();
  dayjs.locale(locale === "zh-CN" ? "zh-cn" : "en");
  return (
    <ConfigProvider locale={locale === "zh-CN" ? zhCN : enUS} theme={createAntdTheme(themeMode)}>
      <QueryProvider>
        <AntApp>
          <AntdFeedbackBridge />
          {children}
        </AntApp>
      </QueryProvider>
    </ConfigProvider>
  );
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <PreferencesProvider>
      <AppProviderInner>{children}</AppProviderInner>
    </PreferencesProvider>
  );
}
