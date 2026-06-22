"use client";

import { Drawer, Grid, Layout } from "antd";
import { useState } from "react";
import { AdminHeader } from "./AdminHeader";
import { AdminMenu } from "./AdminMenu";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  return (
    <Layout className="xin-shell">
      <AdminHeader
        collapsed={isMobile ? false : collapsed}
        onToggleCollapsed={() => {
          if (isMobile) {
            setMobileMenuOpen(true);
            return;
          }
          setCollapsed((value) => !value);
        }}
      />
      {!isMobile ? (
        <Layout className="xin-shell-body">
          <Layout.Sider
            className="xin-sider"
            width="var(--admin-sider-width)"
            collapsedWidth="var(--admin-sider-collapsed-width)"
            collapsed={collapsed}
            trigger={null}
          >
            <AdminMenu />
          </Layout.Sider>
          <Layout className="xin-main-layout">
            <Layout.Content className="xin-content">{children}</Layout.Content>
            <Layout.Footer className="xin-footer">Admin Base ©2026</Layout.Footer>
          </Layout>
        </Layout>
      ) : null}
      <Drawer
        title="Admin Base"
        placement="left"
        size={280}
        open={isMobile && mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        <AdminMenu onNavigate={() => setMobileMenuOpen(false)} />
      </Drawer>
      {isMobile ? (
        <Layout className="xin-main-layout">
          <Layout.Content className="xin-content">{children}</Layout.Content>
          <Layout.Footer className="xin-footer">Admin Base ©2026</Layout.Footer>
        </Layout>
      ) : null}
    </Layout>
  );
}
