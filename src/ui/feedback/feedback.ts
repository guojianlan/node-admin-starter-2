"use client";

import { App } from "antd";

type AntdAppApi = ReturnType<typeof App.useApp>;

let appApi: AntdAppApi | null = null;

export const feedback = {
  set(api: AntdAppApi) {
    appApi = api;
  },
  success(content: string) {
    appApi?.message.success(content);
  },
  error(content: string) {
    appApi?.message.error(content);
  },
  warning(content: string) {
    appApi?.message.warning(content);
  },
  info(content: string) {
    appApi?.message.info(content);
  },
};
