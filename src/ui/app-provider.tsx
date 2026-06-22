"use client";

import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import { AntdFeedbackBridge } from "@/ui/feedback/AntdFeedbackBridge";
import { QueryProvider } from "@/ui/query/QueryProvider";
import { antdTheme } from "@/ui/theme/antd-theme";

dayjs.locale("zh-cn");

export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <QueryProvider>
        <AntApp>
          <AntdFeedbackBridge />
          {children}
        </AntApp>
      </QueryProvider>
    </ConfigProvider>
  );
}
