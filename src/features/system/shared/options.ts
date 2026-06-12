import type { FieldOption } from "@/components/admin-fields/types";

export const statusOptions: FieldOption[] = [
  { label: "启用", value: 1 },
  { label: "停用", value: 0 },
];

export const sexOptions: FieldOption[] = [
  { label: "未知", value: 0 },
  { label: "男", value: 1 },
  { label: "女", value: 2 },
];

export const ruleTypeOptions: FieldOption[] = [
  { label: "菜单项", value: "menu" },
  { label: "路由页面", value: "route" },
  { label: "嵌套路由", value: "nested" },
  { label: "权限项", value: "action" },
];

export const configTypeOptions: FieldOption[] = [
  { label: "文本", value: "text" },
  { label: "多行文本", value: "textarea" },
  { label: "数字", value: "digit" },
  { label: "开关", value: "switch" },
  { label: "下拉选择", value: "select" },
  { label: "多选框", value: "checkbox" },
  { label: "图片", value: "image" },
];

type TreeNode = {
  id?: number;
  value?: number | string;
  name?: string;
  label?: string;
  children?: TreeNode[];
};

export function toFieldOptions(nodes: TreeNode[]): FieldOption[] {
  return nodes.map((node) => ({
    label: node.label ?? node.name ?? String(node.value ?? node.id),
    value: node.value ?? node.id ?? "",
    children: node.children?.length ? toFieldOptions(node.children) : undefined,
  }));
}
