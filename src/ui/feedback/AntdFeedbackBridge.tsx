"use client";

import { App } from "antd";
import { useEffect } from "react";
import { feedback } from "./feedback";

export function AntdFeedbackBridge() {
  const api = App.useApp();

  useEffect(() => {
    feedback.set(api);
  }, [api]);

  return null;
}
