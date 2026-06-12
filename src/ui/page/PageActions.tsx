import { Space } from "antd";

export function PageActions({ children }: { children: React.ReactNode }) {
  return <Space wrap>{children}</Space>;
}
