export type RuleSelectionNode = {
  id: number;
  children?: RuleSelectionNode[];
};

export type RuleSelectionRelations = {
  ancestorsById: Map<number, number[]>;
  descendantsById: Map<number, number[]>;
};

export function buildRuleSelectionRelations(
  nodes: RuleSelectionNode[],
): RuleSelectionRelations {
  const ancestorsById = new Map<number, number[]>();
  const descendantsById = new Map<number, number[]>();

  const visit = (node: RuleSelectionNode, ancestors: number[]): number[] => {
    ancestorsById.set(node.id, ancestors);
    const descendants = (node.children ?? []).flatMap((child) => [
      child.id,
      ...visit(child, [...ancestors, node.id]),
    ]);
    descendantsById.set(node.id, descendants);
    return descendants;
  };

  nodes.forEach((node) => visit(node, []));
  return { ancestorsById, descendantsById };
}

export function applyRuleSelection(input: {
  selectedKeys: number[];
  nodeId: number;
  checked: boolean;
  cascade: boolean;
  relations: RuleSelectionRelations;
}) {
  const selected = new Set(input.selectedKeys);
  const descendants = input.relations.descendantsById.get(input.nodeId) ?? [];

  if (!input.cascade) {
    if (input.checked) selected.add(input.nodeId);
    else selected.delete(input.nodeId);
    return [...selected];
  }

  if (input.checked) {
    selected.add(input.nodeId);
    descendants.forEach((id) => selected.add(id));
    (input.relations.ancestorsById.get(input.nodeId) ?? []).forEach((id) => selected.add(id));
  } else {
    selected.delete(input.nodeId);
    descendants.forEach((id) => selected.delete(id));
  }

  return [...selected];
}

export function getHalfCheckedRuleKeys(
  selectedKeys: number[],
  relations: RuleSelectionRelations,
) {
  const selected = new Set(selectedKeys);
  return selectedKeys.filter((nodeId) => {
    const descendants = relations.descendantsById.get(nodeId) ?? [];
    if (!descendants.length) return false;
    const selectedDescendantCount = descendants.filter((id) => selected.has(id)).length;
    return selectedDescendantCount > 0 && selectedDescendantCount < descendants.length;
  });
}

export function expandRuleSelection(
  selectedKeys: number[],
  relations: RuleSelectionRelations,
) {
  return selectedKeys.reduce(
    (current, nodeId) =>
      applyRuleSelection({
        selectedKeys: current,
        nodeId,
        checked: true,
        cascade: true,
        relations,
      }),
    [] as number[],
  );
}
