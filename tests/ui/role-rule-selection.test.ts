import { describe, expect, it } from "vitest";
import {
  applyRuleSelection,
  buildRuleSelectionRelations,
  expandRuleSelection,
  getHalfCheckedRuleKeys,
} from "@/features/system/role/rule-selection";

const relations = buildRuleSelectionRelations([
  {
    id: 1,
    children: [
      {
        id: 2,
        children: [{ id: 3 }, { id: 4 }],
      },
      { id: 5 },
    ],
  },
]);

describe("role rule selection", () => {
  it("selects descendants when a parent is checked in cascade mode", () => {
    const selected = applyRuleSelection({
      selectedKeys: [],
      nodeId: 2,
      checked: true,
      cascade: true,
      relations,
    });

    expect(new Set(selected)).toEqual(new Set([1, 2, 3, 4]));
  });

  it("adds ancestors when a child is checked in cascade mode", () => {
    const selected = applyRuleSelection({
      selectedKeys: [],
      nodeId: 3,
      checked: true,
      cascade: true,
      relations,
    });

    expect(new Set(selected)).toEqual(new Set([1, 2, 3]));
  });

  it("removes descendants when a parent is unchecked in cascade mode", () => {
    const selected = applyRuleSelection({
      selectedKeys: [1, 2, 3, 4, 5],
      nodeId: 2,
      checked: false,
      cascade: true,
      relations,
    });

    expect(new Set(selected)).toEqual(new Set([1, 5]));
  });

  it("changes only the requested node in independent mode", () => {
    const selected = applyRuleSelection({
      selectedKeys: [1],
      nodeId: 2,
      checked: true,
      cascade: false,
      relations,
    });

    expect(new Set(selected)).toEqual(new Set([1, 2]));
  });

  it("marks selected ancestors as partial when only some descendants are selected", () => {
    expect(getHalfCheckedRuleKeys([1, 2, 3], relations)).toEqual([1, 2]);
    expect(getHalfCheckedRuleKeys([1, 2, 3, 4, 5], relations)).toEqual([]);
  });

  it("expands compact form values into complete persisted permissions", () => {
    expect(new Set(expandRuleSelection([2], relations))).toEqual(new Set([1, 2, 3, 4]));
    expect(new Set(expandRuleSelection([3, 5], relations))).toEqual(new Set([1, 2, 3, 5]));
  });
});
