export type TreeLike<T> = T & {
  id: number;
  parentId: number;
  children?: TreeLike<T>[];
};

export function buildTree<T extends { id: number; parentId: number }>(items: T[], parentId = 0) {
  const childrenMap = new Map<number, T[]>();

  items.forEach((item) => {
    const children = childrenMap.get(item.parentId) ?? [];
    children.push(item);
    childrenMap.set(item.parentId, children);
  });

  const walk = (currentParentId: number): TreeLike<T>[] => {
    return (childrenMap.get(currentParentId) ?? []).map((item) => ({
      ...item,
      children: walk(item.id),
    }));
  };

  return walk(parentId);
}

export function flattenTree<T extends { children?: T[] }>(items: T[]) {
  const result: T[] = [];
  const walk = (nodes: T[]) => {
    nodes.forEach((node) => {
      result.push(node);
      if (node.children?.length) walk(node.children);
    });
  };
  walk(items);
  return result;
}
