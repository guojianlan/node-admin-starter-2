import type { Metadata } from "next";
import "antd/dist/reset.css";
import "./globals.css";
import { AppProvider } from "@/ui/app-provider";

export const metadata: Metadata = {
  title: "Admin Base",
  description: "Node.js admin base framework",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
