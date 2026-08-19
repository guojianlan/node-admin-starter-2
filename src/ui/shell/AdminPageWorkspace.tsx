"use client";

import {
  CloseCircleOutlined,
  CloseOutlined,
  CloseSquareOutlined,
  DownOutlined,
  ReloadOutlined,
  VerticalRightOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Tooltip } from "antd";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  ADMIN_PAGE_CACHE_ENABLED,
  ADMIN_PAGE_HOME_PATH,
  ADMIN_PAGE_TAB_LIMIT,
  ADMIN_PAGE_TABS_ENABLED,
} from "@/config/admin-navigation";
import { NavigationScope, useNavigationAdapter } from "@/platform/navigation";
import { adminRoutes } from "@/router/route-manifest";
import { findMenuByPath } from "@/router/menu-utils";
import { useAuthStore } from "@/stores/auth";
import { readStoredPageTabs, writeStoredPageTabs, type PageTab } from "./admin-page-tabs";

function searchFromHref(href: string) {
  const queryStart = href.indexOf("?");
  if (queryStart < 0) return "";
  const hashStart = href.indexOf("#", queryStart);
  return href.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart);
}

function routeTitle(pathname: string, menuTitle?: string | null) {
  return (
    menuTitle ||
    adminRoutes.find((route) => route.path === pathname)?.title ||
    pathname.split("/").filter(Boolean).at(-1) ||
    "页面"
  );
}

export function AdminPageWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const navigation = useNavigationAdapter();
  const menus = useAuthStore((state) => state.menus);
  const menu = useMemo(() => findMenuByPath(menus, pathname), [menus, pathname]);
  const currentTab = useMemo<PageTab>(
    () => ({
      path: pathname,
      href: navigation.search ? `${pathname}?${navigation.search}` : pathname,
      title: pathname === ADMIN_PAGE_HOME_PATH ? "仪表盘" : routeTitle(pathname, menu?.name),
      closable: pathname !== ADMIN_PAGE_HOME_PATH,
    }),
    [menu?.name, navigation.search, pathname],
  );
  const [tabs, setTabs] = useState<PageTab[]>(() => {
    const stored = readStoredPageTabs()
      .filter((item) => adminRoutes.some((route) => route.path === item.path))
      .map((item) => ({
        ...item,
        title: item.title === "页面" ? routeTitle(item.path) : item.title,
        closable: item.path !== ADMIN_PAGE_HOME_PATH,
      }));
    const home = {
      path: ADMIN_PAGE_HOME_PATH,
      href: ADMIN_PAGE_HOME_PATH,
      title: "仪表盘",
      closable: false,
    };
    return [home, ...stored.filter((item) => item.path !== ADMIN_PAGE_HOME_PATH)].slice(
      0,
      ADMIN_PAGE_TAB_LIMIT,
    );
  });
  const [mountedPaths, setMountedPaths] = useState<string[]>(() => [pathname]);
  const [lastTrackedTab, setLastTrackedTab] = useState("");
  const trackedSignature = `${currentTab.href}:${currentTab.title}`;
  if (ADMIN_PAGE_TABS_ENABLED && lastTrackedTab !== trackedSignature) {
    setLastTrackedTab(trackedSignature);
    setTabs((current) => {
      const existing = current.find((item) => item.path === currentTab.path);
      const next = existing
        ? current.map((item) => (item.path === currentTab.path ? currentTab : item))
        : [...current, currentTab];
      if (next.length <= ADMIN_PAGE_TAB_LIMIT) return next;
      const removable = next.findIndex((item) => item.closable && item.path !== pathname);
      if (removable < 0) return next.slice(-ADMIN_PAGE_TAB_LIMIT);
      return next.filter((_, index) => index !== removable);
    });
  }
  if (ADMIN_PAGE_CACHE_ENABLED && !mountedPaths.includes(pathname)) {
    setMountedPaths((current) => [...current, pathname].slice(-ADMIN_PAGE_TAB_LIMIT));
  }

  useEffect(() => {
    if (!ADMIN_PAGE_TABS_ENABLED) return;
    writeStoredPageTabs(tabs);
  }, [tabs]);

  if (!ADMIN_PAGE_TABS_ENABLED) {
    return (
      <div className="xin-page-workspace xin-page-workspace-no-tabs">
        <div className="xin-page-cache">
          <div className="xin-page-cache-entry">{children}</div>
        </div>
      </div>
    );
  }

  function closeTab(path: string) {
    const index = tabs.findIndex((item) => item.path === path);
    const next = tabs.filter((item) => item.path !== path);
    setTabs(next);
    setMountedPaths((current) => current.filter((item) => item !== path));
    if (path === pathname) {
      const target = next[Math.min(index, next.length - 1)] || next.at(-1);
      navigation.replace(target?.href || ADMIN_PAGE_HOME_PATH);
    }
  }

  function closeTabsRight(path: string) {
    const index = tabs.findIndex((item) => item.path === path);
    if (index < 0) return;
    const next = tabs.filter((item, itemIndex) => itemIndex <= index || !item.closable);
    setTabs(next);
    setMountedPaths((current) =>
      current.filter((mountedPath) => next.some((item) => item.path === mountedPath)),
    );
    if (!next.some((item) => item.path === pathname)) {
      navigation.replace(tabs[index]?.href || ADMIN_PAGE_HOME_PATH);
    }
  }

  function closeOtherTabs(path: string) {
    const target = tabs.find((item) => item.path === path);
    const next = tabs.filter((item) => !item.closable || item.path === path);
    setTabs(next);
    setMountedPaths((current) =>
      current.filter((mountedPath) => next.some((item) => item.path === mountedPath)),
    );
    if (!next.some((item) => item.path === pathname)) {
      navigation.replace(target?.href || ADMIN_PAGE_HOME_PATH);
    }
  }

  function closeAllTabs() {
    const next = tabs.filter((item) => !item.closable);
    setTabs(next);
    setMountedPaths((current) =>
      current.filter((mountedPath) => next.some((item) => item.path === mountedPath)),
    );
    if (!next.some((item) => item.path === pathname)) {
      navigation.replace(next[0]?.href || ADMIN_PAGE_HOME_PATH);
    }
  }

  return (
    <div className="xin-page-workspace">
      <div className="xin-page-tabs" role="tablist" aria-label="已打开页面">
        <div className="xin-page-tabs-scroll">
          {tabs.map((tab) => {
            const active = tab.path === pathname;
            const tabIndex = tabs.findIndex((item) => item.path === tab.path);
            const hasClosableTabsRight = tabs.some(
              (item, itemIndex) => itemIndex > tabIndex && item.closable,
            );
            const hasClosableOtherTabs = tabs.some(
              (item) => item.closable && item.path !== tab.path,
            );
            return (
              <Dropdown
                key={tab.path}
                trigger={["contextMenu"]}
                menu={{
                  items: [
                    {
                      key: "right",
                      icon: <VerticalRightOutlined />,
                      label: "关闭右侧页签",
                      disabled: !hasClosableTabsRight,
                    },
                    {
                      key: "others",
                      icon: <CloseSquareOutlined />,
                      label: "关闭其他页签",
                      disabled: !hasClosableOtherTabs,
                    },
                    {
                      key: "all",
                      icon: <CloseCircleOutlined />,
                      label: "关闭全部页签",
                      disabled: tabs.every((item) => !item.closable),
                    },
                  ],
                  onClick: ({ key }) => {
                    if (key === "right") closeTabsRight(tab.path);
                    if (key === "others") closeOtherTabs(tab.path);
                    if (key === "all") closeAllTabs();
                  },
                }}
              >
                <div
                  role="tab"
                  tabIndex={0}
                  aria-selected={active}
                  className={active ? "xin-page-tab xin-page-tab-active" : "xin-page-tab"}
                  onClick={() => navigation.push(tab.href)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigation.push(tab.href);
                    }
                  }}
                >
                  <span className="xin-page-tab-dot" aria-hidden="true" />
                  <span className="xin-page-tab-title">{tab.title}</span>
                  {tab.closable ? (
                    <button
                      type="button"
                      className="xin-page-tab-close"
                      aria-label={`关闭 ${tab.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(tab.path);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          closeTab(tab.path);
                        }
                      }}
                    >
                      <CloseOutlined />
                    </button>
                  ) : null}
                </div>
              </Dropdown>
            );
          })}
        </div>
        <div className="xin-page-tabs-actions">
          <Tooltip title="刷新当前页面">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => window.location.reload()}
            />
          </Tooltip>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "others",
                  label: "关闭其他页签",
                  disabled: !tabs.some((item) => item.closable && item.path !== pathname),
                },
                {
                  key: "all",
                  label: "关闭全部页签",
                  disabled: tabs.every((item) => !item.closable),
                },
              ],
              onClick: ({ key }) => {
                if (key === "others") closeOtherTabs(pathname);
                if (key === "all") closeAllTabs();
              },
            }}
          >
            <Button type="text" size="small" icon={<DownOutlined />} />
          </Dropdown>
        </div>
      </div>

      <div className="xin-page-cache">
        {ADMIN_PAGE_CACHE_ENABLED ? (
          tabs
            .filter((tab) => mountedPaths.includes(tab.path))
            .map((tab) => {
              const route = adminRoutes.find((item) => item.path === tab.path);
              const Component = route?.component;
              if (!Component && tab.path !== pathname) return null;
              return (
                <div
                  key={tab.path}
                  className="xin-page-cache-entry"
                  hidden={tab.path !== pathname}
                  aria-hidden={tab.path !== pathname}
                >
                  <NavigationScope pathname={tab.path} search={searchFromHref(tab.href)}>
                    {Component ? <Component /> : children}
                  </NavigationScope>
                </div>
              );
            })
        ) : (
          <div className="xin-page-cache-entry">{children}</div>
        )}
      </div>
    </div>
  );
}
