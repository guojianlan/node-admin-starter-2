"use client";

import { DatePicker, Input, InputNumber, Radio, Select, Switch, TreeSelect } from "antd";
import { AdminImageField } from "./AdminImageField";
import type { FieldOption, FieldValueType } from "./types";

type AdminFieldRendererProps = {
  valueType?: FieldValueType;
  options?: FieldOption[];
  fieldProps?: Record<string, unknown>;
} & Record<string, unknown>;

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
  ...controlProps
}: AdminFieldRendererProps) {
  const mergedFieldProps = { ...fieldProps, ...controlProps };

  switch (valueType) {
    case "password":
      return <Input.Password {...mergedFieldProps} />;
    case "textarea":
      return <Input.TextArea rows={4} {...mergedFieldProps} />;
    case "digit":
      return <InputNumber style={{ width: "100%" }} {...mergedFieldProps} />;
    case "select":
      return <Select allowClear options={options} {...mergedFieldProps} />;
    case "treeSelect":
      return (
        <TreeSelect
          allowClear
          treeDefaultExpandAll
          treeData={toTreeData(options)}
          {...mergedFieldProps}
        />
      );
    case "radio":
      return <Radio.Group options={options} {...mergedFieldProps} />;
    case "radioButton":
      return (
        <Radio.Group
          optionType="button"
          buttonStyle="solid"
          options={options}
          {...mergedFieldProps}
        />
      );
    case "switch":
      return <Switch checkedChildren="启用" unCheckedChildren="停用" {...mergedFieldProps} />;
    case "date":
      return <DatePicker style={{ width: "100%" }} {...mergedFieldProps} />;
    case "datetime":
      return <DatePicker showTime style={{ width: "100%" }} {...mergedFieldProps} />;
    case "dateRange":
      return <DatePicker.RangePicker style={{ width: "100%" }} {...mergedFieldProps} />;
    case "image":
      return <AdminImageField {...mergedFieldProps} />;
    case "text":
    default:
      return <Input allowClear {...mergedFieldProps} />;
  }
}
