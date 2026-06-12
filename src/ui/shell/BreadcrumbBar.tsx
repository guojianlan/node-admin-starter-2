"use client";

import { HomeOutlined } from "@ant-design/icons";
import { Breadcrumb } from "antd";
import { usePathname } from "next/navigation";
import { findMenuAncestors } from "@/router/menu-utils";
import { useAuthStore } from "@/stores/auth";

export function BreadcrumbBar() {
  const pathname = usePathname();
  const menus = useAuthStore((state) => state.menus);
  const ancestors = findMenuAncestors(menus, pathname);

  const items = [
    { title: <HomeOutlined /> },
    ...(ancestors.length === 0 ? [{ title: "仪表盘" }] : ancestors.map((item) => ({ title: item.name }))),
  ];

  return (
    <div className="xin-breadcrumb">
      <Breadcrumb separator="/" items={items} />
    </div>
  );
}
