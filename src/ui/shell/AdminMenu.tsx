"use client";

import type { MenuProps } from "antd";
import { Menu, Popover, Tooltip } from "antd";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useNavigationAdapter } from "@/platform/navigation";
import { findMenuAncestors } from "@/router/menu-utils";
import type { MenuNode } from "@/stores/auth";
import { useAuthStore } from "@/stores/auth";
import { getRememberedPageHref } from "./admin-page-tabs";
import { renderMenuIcon } from "./icon-map";

function getMenuKey(node: MenuNode) {
  return node.path || node.key;
}

export function getVisibleMenuNodes(nodes: MenuNode[]) {
  return nodes.filter((node) => node.status === 1 && node.hidden === 1);
}

export function findFirstMenuPath(node: MenuNode): string | null {
  if (node.path?.startsWith("/")) return node.path;
  for (const child of getVisibleMenuNodes(node.children ?? [])) {
    const path = findFirstMenuPath(child);
    if (path) return path;
  }
  return null;
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

function toMenuItems(
  nodes: MenuNode[],
  options: { collapsed: boolean; showIcons: boolean; onNavigate?: () => void },
): MenuProps["items"] {
  return getVisibleMenuNodes(nodes).map((node) => {
    const children =
      !options.collapsed && node.children?.length ? toMenuItems(node.children, options) : undefined;
    const isExternalLink = node.link === 1 && Boolean(node.path);
    return {
      key: getMenuKey(node),
      icon: options.showIcons ? renderMenuIcon(node.icon) : undefined,
      title: options.collapsed ? "" : node.name,
      label: isExternalLink ? (
        <a
          className="xin-menu-external-link"
          href={normalizeExternalUrl(node.path || "")}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            event.stopPropagation();
            options.onNavigate?.();
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
  nodes?: MenuNode[];
  onNavigate?: () => void;
  mode?: "inline" | "horizontal";
  collapsed?: boolean;
  showIcons?: boolean;
};

type MegaMenuSection = {
  key: string;
  title: string;
  items: MenuNode[];
};

function getNavigableDescendants(nodes: MenuNode[]): MenuNode[] {
  const result: MenuNode[] = [];
  for (const node of getVisibleMenuNodes(nodes)) {
    if (node.path || !node.children?.length) result.push(node);
    if (node.children?.length) result.push(...getNavigableDescendants(node.children));
  }
  return result;
}

function getMegaMenuSections(node: MenuNode): MegaMenuSection[] {
  const sections: MegaMenuSection[] = [];
  const directItems: MenuNode[] = [];

  for (const child of getVisibleMenuNodes(node.children ?? [])) {
    if (!child.children?.length) {
      directItems.push(child);
      continue;
    }

    const descendants = getNavigableDescendants(child.children);
    if (!descendants.length) {
      directItems.push(child);
      continue;
    }

    if (child.key === "system.settingsGroup") {
      const aiItems = descendants.filter((item) => item.key.startsWith("system.ai"));
      const settingsItems = descendants.filter((item) => !item.key.startsWith("system.ai"));
      if (settingsItems.length) {
        sections.push({ key: child.key, title: child.name, items: settingsItems });
      }
      if (aiItems.length) {
        sections.push({ key: `${child.key}.ai`, title: "AI 能力", items: aiItems });
      }
      continue;
    }

    sections.push({ key: child.key, title: child.name, items: descendants });
  }

  if (directItems.length) {
    sections.push({
      key: `${node.key}.direct`,
      title: node.key === "system" ? "内容与文件" : "常用功能",
      items: directItems,
    });
  }

  return sections;
}

function distributeMegaMenuSections(sections: MegaMenuSection[]) {
  const columns: MegaMenuSection[][] = [[], []];
  const weights = [0, 0];
  for (const section of sections) {
    const columnIndex = weights[0] <= weights[1] ? 0 : 1;
    columns[columnIndex].push(section);
    weights[columnIndex] += section.items.length + 1;
  }
  return columns.filter((column) => column.length);
}

function useMenuNavigation(onNavigate?: () => void) {
  const navigation = useNavigationAdapter();

  return (node: MenuNode) => {
    if (node.link === 1 && node.path) {
      window.open(normalizeExternalUrl(node.path), "_blank", "noopener,noreferrer");
      onNavigate?.();
      return;
    }
    if (node.path?.startsWith("/")) {
      navigation.push(getRememberedPageHref(node.path));
      onNavigate?.();
    }
  };
}

function MegaMenuPanel({ node, onNavigate }: { node: MenuNode; onNavigate?: () => void }) {
  const pathname = usePathname();
  const navigate = useMenuNavigation(onNavigate);
  const columns = useMemo(() => distributeMegaMenuSections(getMegaMenuSections(node)), [node]);

  return (
    <nav
      className={`xin-mega-menu xin-mega-menu-${columns.length}-column`}
      aria-label={`${node.name}导航`}
    >
      <div className="xin-mega-menu-header">
        <span className="xin-mega-menu-header-icon">{renderMenuIcon(node.icon)}</span>
        <span>{node.name}</span>
      </div>
      <div className="xin-mega-menu-columns">
        {columns.map((sections, columnIndex) => (
          <div className="xin-mega-menu-column" key={`${node.key}.column.${columnIndex}`}>
            {sections.map((section) => (
              <section className="xin-mega-menu-section" key={section.key}>
                <h3>{section.title}</h3>
                <div className="xin-mega-menu-items">
                  {section.items.map((item) => {
                    const active = item.path === pathname;
                    return (
                      <button
                        type="button"
                        key={item.key}
                        className={
                          active
                            ? "xin-mega-menu-item xin-mega-menu-item-active"
                            : "xin-mega-menu-item"
                        }
                        disabled={!item.path}
                        aria-current={active ? "page" : undefined}
                        onClick={() => navigate(item)}
                      >
                        <span className="xin-mega-menu-item-icon">{renderMenuIcon(item.icon)}</span>
                        <span className="xin-mega-menu-item-label">{item.name}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

function CollapsedMenuEntry({
  node,
  active,
  onNavigate,
  className = "xin-collapsed-menu-item",
}: {
  node: MenuNode;
  active: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useMenuNavigation(() => {
    setOpen(false);
    onNavigate?.();
  });
  const sections = useMemo(() => getMegaMenuSections(node), [node]);
  const columnCount = useMemo(() => distributeMegaMenuSections(sections).length, [sections]);
  const firstPath = findFirstMenuPath(node);
  const hasMegaMenu = sections.some((section) => section.items.length > 1) || sections.length > 1;
  const button = (
    <button
      type="button"
      className={`${className}${active ? ` ${className}-active` : ""}`}
      aria-label={node.name}
      aria-current={active ? "page" : undefined}
      aria-haspopup={hasMegaMenu ? "menu" : undefined}
      aria-expanded={hasMegaMenu ? open : undefined}
      onClick={() => {
        if (hasMegaMenu) return;
        if (node.path) navigate(node);
        else if (firstPath) navigate({ ...node, path: firstPath });
      }}
    >
      <span className={`${className}-icon`}>{renderMenuIcon(node.icon)}</span>
    </button>
  );

  if (!hasMegaMenu) {
    return (
      <Tooltip title={node.name} placement="right" mouseEnterDelay={0.35}>
        {button}
      </Tooltip>
    );
  }

  return (
    <Popover
      open={open}
      trigger={["hover", "click"]}
      placement="rightTop"
      arrow={false}
      mouseEnterDelay={0.08}
      mouseLeaveDelay={0.18}
      onOpenChange={setOpen}
      classNames={{
        root: `xin-mega-menu-popover xin-mega-menu-popover-${columnCount}-column`,
      }}
      content={<MegaMenuPanel node={node} onNavigate={() => setOpen(false)} />}
    >
      {button}
    </Popover>
  );
}

function AdminCollapsedMenu({ menus, onNavigate }: { menus: MenuNode[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const ancestors = useMemo(() => findMenuAncestors(menus, pathname), [menus, pathname]);
  const visibleMenus = useMemo(() => getVisibleMenuNodes(menus), [menus]);

  return (
    <nav className="xin-collapsed-menu" aria-label="折叠菜单">
      {visibleMenus.map((node) => {
        const active = node.path === pathname || ancestors.some((item) => item.id === node.id);
        return (
          <CollapsedMenuEntry key={node.id} node={node} active={active} onNavigate={onNavigate} />
        );
      })}
    </nav>
  );
}

export function AdminMenu({
  nodes,
  onNavigate,
  mode = "inline",
  collapsed = false,
  showIcons = true,
}: AdminMenuProps) {
  const pathname = usePathname();
  const navigation = useNavigationAdapter();
  const allMenus = useAuthStore((state) => state.menus);
  const menus = nodes ?? allMenus;

  const items = useMemo(
    () => toMenuItems(menus, { collapsed, showIcons, onNavigate }),
    [collapsed, menus, onNavigate, showIcons],
  );
  const ancestors = useMemo(() => findMenuAncestors(menus, pathname), [menus, pathname]);
  const selectedKeys = pathname ? [pathname] : [];
  const parentSelectedKeys = useMemo(
    () => ancestors.filter((item) => item.children?.length).map((item) => getMenuKey(item)),
    [ancestors],
  );
  const [manualOpenKeys, setManualOpenKeys] = useState<string[]>(parentSelectedKeys);
  const rootKeys = useMemo(
    () => menus.filter((item) => item.children?.length).map((item) => getMenuKey(item)),
    [menus],
  );
  const openKeys = collapsed ? [] : manualOpenKeys;

  function handleOpenChange(keys: string[]) {
    const latestKey = keys.find((key) => !openKeys.includes(key));
    if (!latestKey || !rootKeys.includes(latestKey)) {
      setManualOpenKeys(keys);
      return;
    }
    setManualOpenKeys([latestKey]);
  }

  if (mode === "inline" && collapsed) {
    return <AdminCollapsedMenu menus={menus} onNavigate={onNavigate} />;
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
        if (!menu) return;
        const path = menu.path || key;
        if (menu.link === 1 && menu.path) {
          window.open(normalizeExternalUrl(menu.path), "_blank", "noopener,noreferrer");
          onNavigate?.();
          return;
        }
        if (path.startsWith("/")) {
          navigation.push(getRememberedPageHref(path));
          onNavigate?.();
        }
      }}
    />
  );
}

type AdminRootMenuProps = {
  activeKey: string;
  onSelect: (node: MenuNode) => void;
};

export function AdminRootMenu({ activeKey, onSelect }: AdminRootMenuProps) {
  const menus = useAuthStore((state) => state.menus);
  const visibleMenus = useMemo(() => getVisibleMenuNodes(menus), [menus]);
  const items = useMemo<MenuProps["items"]>(
    () =>
      visibleMenus.map((node) => ({
        key: node.key,
        icon: renderMenuIcon(node.icon),
        label: node.name,
      })),
    [visibleMenus],
  );

  return (
    <Menu
      className="xin-root-menu"
      mode="horizontal"
      items={items}
      selectedKeys={activeKey ? [activeKey] : []}
      onClick={({ key }) => {
        const node = visibleMenus.find((item) => item.key === String(key));
        if (node) onSelect(node);
      }}
    />
  );
}

type AdminColumnsMenuProps = AdminRootMenuProps & {
  activeRoot?: MenuNode;
  collapsed: boolean;
  onNavigate?: () => void;
};

export function AdminColumnsMenu({
  activeKey,
  activeRoot,
  collapsed,
  onSelect,
  onNavigate,
}: AdminColumnsMenuProps) {
  const menus = useAuthStore((state) => state.menus);
  const visibleMenus = useMemo(() => getVisibleMenuNodes(menus), [menus]);

  return (
    <aside
      className={
        collapsed
          ? "xin-columns-navigation xin-columns-navigation-collapsed"
          : "xin-columns-navigation"
      }
      aria-label="主导航"
    >
      <nav className="xin-columns-primary" aria-label="一级菜单">
        {visibleMenus.map((node) => {
          const active = node.key === activeKey;
          if (collapsed) {
            return (
              <CollapsedMenuEntry
                key={node.key}
                node={node}
                active={active}
                onNavigate={onNavigate}
                className="xin-columns-collapsed-item"
              />
            );
          }
          return (
            <button
              key={node.key}
              type="button"
              className={
                active
                  ? "xin-columns-root-item xin-columns-root-item-active"
                  : "xin-columns-root-item"
              }
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect(node)}
            >
              <span className="xin-columns-root-icon">{renderMenuIcon(node.icon)}</span>
              <span className="xin-columns-root-label">{node.name}</span>
            </button>
          );
        })}
      </nav>
      {!collapsed ? (
        <div className="xin-columns-secondary">
          <div className="xin-columns-secondary-title">{activeRoot?.name || "导航菜单"}</div>
          <AdminMenu nodes={activeRoot?.children ?? []} onNavigate={onNavigate} />
        </div>
      ) : null}
    </aside>
  );
}
