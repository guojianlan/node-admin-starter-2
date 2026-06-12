import type { MenuNode } from "@/stores/auth";

export function findMenuByPath(menus: MenuNode[], pathname: string): MenuNode | null {
  for (const menu of menus) {
    if (menu.path === pathname) return menu;
    if (menu.children?.length) {
      const matched = findMenuByPath(menu.children, pathname);
      if (matched) return matched;
    }
  }
  return null;
}

export function findMenuAncestors(menus: MenuNode[], pathname: string): MenuNode[] {
  const walk = (nodes: MenuNode[], parents: MenuNode[]): MenuNode[] => {
    for (const node of nodes) {
      const nextParents = [...parents, node];
      if (node.path === pathname) return nextParents;
      if (node.children?.length) {
        const matched = walk(node.children, nextParents);
        if (matched.length) return matched;
      }
    }
    return [];
  };

  return walk(menus, []);
}
