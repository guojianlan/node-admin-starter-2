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

function toMenuItems(nodes: MenuNode[]): MenuProps["items"] {
  return nodes
    .filter((node) => node.status === 1 && node.hidden === 1)
    .map((node) => {
      const children = node.children?.length ? toMenuItems(node.children) : undefined;
      return {
        key: node.path || node.key,
        icon: renderMenuIcon(node.icon),
        label: node.name,
        children,
      };
    });
}

type AdminMenuProps = {
  onNavigate?: () => void;
};

export function AdminMenu({ onNavigate }: AdminMenuProps) {
  const pathname = usePathname();
  const navigation = useNavigationAdapter();
  const menus = useAuthStore((state) => state.menus);
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  const items = useMemo(() => toMenuItems(menus), [menus]);
  const ancestors = useMemo(() => findMenuAncestors(menus, pathname), [menus, pathname]);
  const selectedKeys = pathname ? [pathname] : [];
  const parentSelectedKeys = ancestors
    .filter((item) => item.children?.length)
    .map((item) => item.path || item.key);
  const rootKeys = useMemo(
    () =>
      menus
        .filter((item) => item.children?.length)
        .map((item) => item.path || item.key),
    [menus],
  );

  function handleOpenChange(keys: string[]) {
    const latestKey = keys.find((key) => !openKeys.includes(key));
    if (!latestKey || !rootKeys.includes(latestKey)) {
      setOpenKeys(keys);
      return;
    }
    setOpenKeys([latestKey]);
  }

  return (
    <Menu
      className="xin-menu"
      mode="inline"
      items={items}
      selectedKeys={[...selectedKeys, ...parentSelectedKeys]}
      openKeys={openKeys}
      onOpenChange={handleOpenChange}
      onClick={(info) => {
        const key = String(info.key);
        if (key.startsWith("/")) {
          navigation.push(key);
          onNavigate?.();
        }
      }}
    />
  );
}
