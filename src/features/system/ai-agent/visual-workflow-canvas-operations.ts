import type { Edge, Node } from "@xyflow/react";

type WorkflowNodeData = {
  type?: unknown;
};

export type WorkflowGraphSnapshot<NodeType extends Node = Node> = {
  nodes: NodeType[];
  edges: Edge[];
};

export type WorkflowClipboard<NodeType extends Node = Node> = WorkflowGraphSnapshot<NodeType>;

function cloneValue<Value>(value: Value): Value {
  return structuredClone(value);
}

export function workflowNodeType(node: Node) {
  const value = (node.data as WorkflowNodeData | undefined)?.type;
  return typeof value === "string" && value ? value : node.type || "default";
}

export function cloneWorkflowGraph<NodeType extends Node>(
  nodes: NodeType[],
  edges: Edge[],
): WorkflowGraphSnapshot<NodeType> {
  return {
    nodes: cloneValue(nodes),
    edges: cloneValue(edges),
  };
}

export function normalizeWorkflowEdges(
  edges: Array<Omit<Edge, "id"> & { id?: string }>,
): Edge[] {
  const usedIds = new Set<string>();

  return edges.map((edge, index) => {
    const baseId = edge.id?.trim() || `${edge.source}-${edge.target}` || `workflow-edge-${index + 1}`;
    let id = baseId;
    let suffix = 1;

    while (usedIds.has(id)) {
      id = `${baseId}-${++suffix}`;
    }

    usedIds.add(id);
    return { ...edge, id };
  });
}

export function serializeWorkflowGraph<NodeType extends Node>(nodes: NodeType[], edges: Edge[]) {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: workflowNodeType(node),
      position: { x: node.position.x, y: node.position.y },
      data: cloneValue(node.data),
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(edge.label == null ? {} : { label: String(edge.label) }),
    })),
  };
}

export function copyWorkflowSelection<NodeType extends Node>(
  nodes: NodeType[],
  edges: Edge[],
): WorkflowClipboard<NodeType> {
  const selectedNodes = nodes.filter((node) => {
    const type = workflowNodeType(node);
    return node.selected && type !== "input" && type !== "output";
  });
  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  return cloneWorkflowGraph(
    selectedNodes.map((node) => ({ ...node, selected: false })),
    edges
      .filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))
      .map((edge) => ({ ...edge, selected: false })),
  );
}

export function pasteWorkflowSelection<NodeType extends Node>(
  clipboard: WorkflowClipboard<NodeType>,
  createNodeId: (node: NodeType) => string,
  createEdgeId: (edge: Edge) => string,
  offset = { x: 36, y: 36 },
): WorkflowGraphSnapshot<NodeType> {
  const idMap = new Map<string, string>();
  const nodes = clipboard.nodes.map((node) => {
    const id = createNodeId(node);
    idMap.set(node.id, id);
    return {
      ...cloneValue(node),
      id,
      type: workflowNodeType(node),
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      selected: true,
    };
  });
  const edges = clipboard.edges.flatMap((edge) => {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) return [];
    const next = {
      ...cloneValue(edge),
      source,
      target,
      selected: false,
    };
    return [{ ...next, id: createEdgeId(next) }];
  });
  return { nodes, edges };
}

export function deleteWorkflowSelection<NodeType extends Node>(
  nodes: NodeType[],
  edges: Edge[],
): WorkflowGraphSnapshot<NodeType> & { changed: boolean } {
  const removedNodeIds = new Set(
    nodes
      .filter((node) => node.selected && !["input", "output"].includes(workflowNodeType(node)))
      .map((node) => node.id),
  );
  const removedEdgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id));
  const nextNodes = nodes.filter((node) => !removedNodeIds.has(node.id));
  const nextEdges = edges.filter(
    (edge) => !removedEdgeIds.has(edge.id) && !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
  );
  return {
    nodes: nextNodes,
    edges: nextEdges,
    changed: nextNodes.length !== nodes.length || nextEdges.length !== edges.length,
  };
}

export function isWorkflowConnectionValid(
  connection: { source?: string | null; target?: string | null },
  edges: Edge[],
) {
  const source = connection.source;
  const target = connection.target;
  if (!source || !target || source === target) return false;
  if (edges.some((edge) => edge.source === source && edge.target === target)) return false;

  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]));
  const queue = [target];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    if (current === source) return false;
    visited.add(current);
    queue.push(...(outgoing.get(current) ?? []));
  }
  return true;
}
