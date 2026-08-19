"use client";

import { Alert, Drawer, Grid, Layout } from "antd";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useNavigationAdapter } from "@/platform/navigation";
import { findMenuAncestors } from "@/router/menu-utils";
import { useAuthStore } from "@/stores/auth";
import { useAdminPreferences } from "@/ui/preferences";
import { AdminHeader } from "./AdminHeader";
import {
  AdminColumnsMenu,
  AdminMenu,
  AdminRootMenu,
  findFirstMenuPath,
  getVisibleMenuNodes,
} from "./AdminMenu";
import { getRememberedPageHref } from "./admin-page-tabs";
import { AdminPageWorkspace } from "./AdminPageWorkspace";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { layoutMode } = useAdminPreferences();
  const pathname = usePathname();
  const navigation = useNavigationAdapter();
  const menus = useAuthStore((state) => state.menus);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [rootSelection, setRootSelection] = useState({ pathname: "", key: "" });
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const useTopMenu = layoutMode === "top";
  const useColumnsMenu = layoutMode === "columns";
  const useMixMenu = layoutMode === "mix";
  const visibleRootMenus = useMemo(() => getVisibleMenuNodes(menus), [menus]);
  const pathnameRootKey = useMemo(
    () => findMenuAncestors(menus, pathname)[0]?.key || "",
    [menus, pathname],
  );
  const activeRootKey =
    (rootSelection.pathname === pathname &&
    visibleRootMenus.some((item) => item.key === rootSelection.key)
      ? rootSelection.key
      : "") ||
    pathnameRootKey ||
    visibleRootMenus[0]?.key ||
    "";
  const activeRoot = visibleRootMenus.find((item) => item.key === activeRootKey);
  const mustChangePassword = useAuthStore((state) => state.user?.mustChangePassword);

  function selectRootMenu(node: (typeof visibleRootMenus)[number]) {
    setRootSelection({ pathname, key: node.key });
    const path = findFirstMenuPath(node);
    if (path && path !== pathname) navigation.push(getRememberedPageHref(path));
  }

  const content = (
    <>
      {mustChangePassword ? (
        <Alert
          showIcon
          type="warning"
          title="必须修改密码后继续使用系统"
          className="xin-force-password-alert"
        />
      ) : null}
      <AdminPageWorkspace>{children}</AdminPageWorkspace>
    </>
  );

  return (
    <Layout className={`xin-shell xin-layout-${layoutMode}`}>
      <AdminHeader
        collapsed={isMobile ? false : collapsed}
        isMobile={isMobile}
        navigation={
          !isMobile && useTopMenu ? (
            <AdminMenu mode="horizontal" />
          ) : !isMobile && useMixMenu ? (
            <AdminRootMenu activeKey={activeRootKey} onSelect={selectRootMenu} />
          ) : undefined
        }
        onToggleCollapsed={() => {
          if (isMobile) {
            setMobileMenuOpen(true);
            return;
          }
          setCollapsed((value) => !value);
        }}
      />
      {!isMobile && useTopMenu ? (
        <Layout className="xin-main-layout">
          <Layout.Content className="xin-content">{content}</Layout.Content>
          <Layout.Footer className="xin-footer">Admin Base ©2026</Layout.Footer>
        </Layout>
      ) : null}
      {!isMobile && !useTopMenu ? (
        <Layout className="xin-shell-body">
          {useColumnsMenu ? (
            <AdminColumnsMenu
              activeKey={activeRootKey}
              activeRoot={activeRoot}
              collapsed={collapsed}
              onSelect={selectRootMenu}
            />
          ) : (
            <Layout.Sider
              className="xin-sider"
              width="var(--admin-sider-width)"
              collapsedWidth="var(--admin-sider-collapsed-width)"
              collapsed={collapsed}
              trigger={null}
            >
              <AdminMenu
                nodes={useMixMenu ? (activeRoot?.children ?? []) : menus}
                collapsed={collapsed}
              />
            </Layout.Sider>
          )}
          <Layout className="xin-main-layout">
            <Layout.Content className="xin-content">{content}</Layout.Content>
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
          <Layout.Content className="xin-content">{content}</Layout.Content>
          <Layout.Footer className="xin-footer">Admin Base ©2026</Layout.Footer>
        </Layout>
      ) : null}
    </Layout>
  );
}
