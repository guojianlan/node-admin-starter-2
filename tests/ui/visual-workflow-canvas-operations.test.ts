import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
  copyWorkflowSelection,
  deleteWorkflowSelection,
  isWorkflowConnectionValid,
  normalizeWorkflowEdges,
  pasteWorkflowSelection,
  serializeWorkflowGraph,
} from "@/features/system/ai-agent/visual-workflow-canvas-operations";

type TestNode = Node<{ label: string; type: string }>;

function node(id: string, type: string, selected = false, x = 0): TestNode {
  return {
    id,
    type,
    selected,
    position: { x, y: 20 },
    data: { label: id, type },
  };
}

describe("visual workflow canvas operations", () => {
  it("assigns stable unique ids to hydrated edges", () => {
    const edges = normalizeWorkflowEdges([
      { source: "input", target: "step" },
      { source: "input", target: "step" },
      { id: "step-output", source: "step", target: "output" },
    ]);

    expect(edges.map((edge) => edge.id)).toEqual([
      "input-step",
      "input-step-2",
      "step-output",
    ]);
  });

  it("serializes the governed workflow node type instead of React Flow presentation state", () => {
    const graph = serializeWorkflowGraph(
      [{ ...node("agent-1", "agent", true), type: "default", dragging: true }],
      [{ id: "edge-1", source: "input", target: "agent-1", selected: true, animated: true }],
    );

    expect(graph).toEqual({
      nodes: [{ id: "agent-1", type: "agent", position: { x: 0, y: 20 }, data: { label: "agent-1", type: "agent" } }],
      edges: [{ id: "edge-1", source: "input", target: "agent-1" }],
    });
  });

  it("copies only selected editable nodes and their internal connections", () => {
    const nodes = [
      node("input", "input", true),
      node("agent-1", "agent", true, 100),
      node("tool-1", "tool", true, 200),
      node("output", "output", false, 300),
    ];
    const edges: Edge[] = [
      { id: "input-agent", source: "input", target: "agent-1" },
      { id: "agent-tool", source: "agent-1", target: "tool-1" },
      { id: "tool-output", source: "tool-1", target: "output" },
    ];

    const clipboard = copyWorkflowSelection(nodes, edges);

    expect(clipboard.nodes.map((item) => item.id)).toEqual(["agent-1", "tool-1"]);
    expect(clipboard.nodes.every((item) => item.selected === false)).toBe(true);
    expect(clipboard.edges.map((item) => item.id)).toEqual(["agent-tool"]);
  });

  it("pastes a copied subgraph with new ids, remapped edges and an offset", () => {
    const clipboard = copyWorkflowSelection(
      [node("agent-1", "agent", true, 100), node("tool-1", "tool", true, 200)],
      [{ id: "agent-tool", source: "agent-1", target: "tool-1" }],
    );
    let sequence = 0;
    const pasted = pasteWorkflowSelection(
      clipboard,
      (item) => `${item.data.type}-copy-${++sequence}`,
      (edge) => `${edge.source}-${edge.target}`,
    );

    expect(pasted.nodes.map((item) => ({ id: item.id, x: item.position.x, selected: item.selected }))).toEqual([
      { id: "agent-copy-1", x: 136, selected: true },
      { id: "tool-copy-2", x: 236, selected: true },
    ]);
    expect(pasted.edges).toEqual([
      expect.objectContaining({ id: "agent-copy-1-tool-copy-2", source: "agent-copy-1", target: "tool-copy-2", selected: false }),
    ]);
  });

  it("deletes selected editable nodes and selected edges while preserving input and output", () => {
    const result = deleteWorkflowSelection(
      [node("input", "input", true), node("agent-1", "agent", true), node("output", "output", true)],
      [
        { id: "input-agent", source: "input", target: "agent-1" },
        { id: "agent-output", source: "agent-1", target: "output" },
        { id: "selected-edge", source: "input", target: "output", selected: true },
      ],
    );

    expect(result.changed).toBe(true);
    expect(result.nodes.map((item) => item.id)).toEqual(["input", "output"]);
    expect(result.edges).toEqual([]);
  });

  it("rejects duplicate, self and cyclic connections before saving", () => {
    const edges: Edge[] = [
      { id: "a-b", source: "a", target: "b" },
      { id: "b-c", source: "b", target: "c" },
    ];

    expect(isWorkflowConnectionValid({ source: "a", target: "b" }, edges)).toBe(false);
    expect(isWorkflowConnectionValid({ source: "a", target: "a" }, edges)).toBe(false);
    expect(isWorkflowConnectionValid({ source: "c", target: "a" }, edges)).toBe(false);
    expect(isWorkflowConnectionValid({ source: "a", target: "d" }, edges)).toBe(true);
  });
});
