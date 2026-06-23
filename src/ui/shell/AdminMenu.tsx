"use client";

import type { MenuProps } from "antd";
import { Menu } from "antd";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useNavigationAdapter } from "@/platform/navigation";
import { findMenuAncestors } from "@/router/menu-utils";
import type { MenuNode } from "@/stores/auth";
import { useAuthStore } from "@/stores/auth";
import { renderMenuIcon } from "./icon-map";

function getMenuKey(node: MenuNode) {
  return node.path || node.key;
}

function findMenuByKey(nodes: MenuNode[], key: string): MenuNode | null {
  for (const node of nodes) {
    if (getMenuKey(node) === key) return node;
    if (node.children?.length) {
      const matched = findMenuByKey(node.children, key);
      if (matched) return matched;
    }
  }
  return null;
}

function normalizeExternalUrl(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function toMenuItems(nodes: MenuNode[], onNavigate?: () => void): MenuProps["items"] {
  return nodes
    .filter((node) => node.status === 1 && node.hidden === 1)
    .map((node) => {
      const children = node.children?.length ? toMenuItems(node.children, onNavigate) : undefined;
      const isExternalLink = node.link === 1 && Boolean(node.path);
      return {
        key: getMenuKey(node),
        icon: renderMenuIcon(node.icon),
        label: isExternalLink ? (
          <a
            className="xin-menu-external-link"
            href={normalizeExternalUrl(node.path || "")}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.stopPropagation();
              onNavigate?.();
            }}
          >
            {node.name}
          </a>
        ) : (
          node.name
        ),
        children,
      };
    });
}

type AdminMenuProps = {
  onNavigate?: () => void;
  mode?: "inline" | "horizontal";
};

export function AdminMenu({ onNavigate, mode = "inline" }: AdminMenuProps) {
  const pathname = usePathname();
  const navigation = useNavigationAdapter();
  const menus = useAuthStore((state) => state.menus);
  const [manualOpenKeys, setManualOpenKeys] = useState<string[]>([]);

  const items = useMemo(() => toMenuItems(menus, onNavigate), [menus, onNavigate]);
  const ancestors = useMemo(() => findMenuAncestors(menus, pathname), [menus, pathname]);
  const selectedKeys = pathname ? [pathname] : [];
  const parentSelectedKeys = useMemo(
    () => ancestors.filter((item) => item.children?.length).map((item) => getMenuKey(item)),
    [ancestors],
  );
  const rootKeys = useMemo(
    () => menus.filter((item) => item.children?.length).map((item) => getMenuKey(item)),
    [menus],
  );
  const openKeys = useMemo(
    () => Array.from(new Set([...parentSelectedKeys, ...manualOpenKeys])),
    [manualOpenKeys, parentSelectedKeys],
  );

  function handleOpenChange(keys: string[]) {
    const latestKey = keys.find((key) => !openKeys.includes(key));
    if (!latestKey || !rootKeys.includes(latestKey)) {
      setManualOpenKeys(keys);
      return;
    }
    setManualOpenKeys([latestKey]);
  }

  return (
    <Menu
      className="xin-menu"
      mode={mode}
      items={items}
      selectedKeys={[...selectedKeys, ...parentSelectedKeys]}
      openKeys={mode === "inline" ? openKeys : undefined}
      onOpenChange={mode === "inline" ? handleOpenChange : undefined}
      onClick={(info) => {
        const key = String(info.key);
        const menu = findMenuByKey(menus, key);
        const path = menu?.path || key;
        if (menu?.link === 1 && menu.path) {
          window.open(normalizeExternalUrl(menu.path), "_blank", "noopener,noreferrer");
          onNavigate?.();
          return;
        }
        if (path.startsWith("/")) {
          navigation.push(path);
          onNavigate?.();
        }
      }}
    />
  );
}
