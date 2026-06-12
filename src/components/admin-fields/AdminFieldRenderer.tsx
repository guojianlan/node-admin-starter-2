"use client";

import { DatePicker, Input, InputNumber, Radio, Select, Switch, TreeSelect } from "antd";
import type { FieldOption, FieldValueType } from "./types";

type AdminFieldRendererProps = {
  valueType?: FieldValueType;
  options?: FieldOption[];
  fieldProps?: Record<string, unknown>;
};

function toTreeData(options: FieldOption[]): Array<Record<string, unknown>> {
  return options.map((option) => ({
    title: option.label,
    value: option.value,
    children: option.children ? toTreeData(option.children) : undefined,
  }));
}

export function AdminFieldRenderer({
  valueType = "text",
  options = [],
  fieldProps = {},
}: AdminFieldRendererProps) {
  switch (valueType) {
    case "password":
      return <Input.Password {...fieldProps} />;
    case "textarea":
      return <Input.TextArea rows={4} {...fieldProps} />;
    case "digit":
      return <InputNumber style={{ width: "100%" }} {...fieldProps} />;
    case "select":
      return <Select allowClear options={options} {...fieldProps} />;
    case "treeSelect":
      return <TreeSelect allowClear treeDefaultExpandAll treeData={toTreeData(options)} {...fieldProps} />;
    case "radio":
      return <Radio.Group options={options} {...fieldProps} />;
    case "radioButton":
      return <Radio.Group optionType="button" buttonStyle="solid" options={options} {...fieldProps} />;
    case "switch":
      return <Switch checkedChildren="启用" unCheckedChildren="停用" {...fieldProps} />;
    case "date":
      return <DatePicker style={{ width: "100%" }} {...fieldProps} />;
    case "dateRange":
      return <DatePicker.RangePicker style={{ width: "100%" }} {...fieldProps} />;
    case "image":
      return <Input placeholder="请输入图片 URL" {...fieldProps} />;
    case "text":
    default:
      return <Input allowClear {...fieldProps} />;
  }
}
