import type { FormItemProps } from "antd";
import type { ColumnType } from "antd/es/table";

export type FieldValueType =
  | "text"
  | "password"
  | "textarea"
  | "digit"
  | "select"
  | "treeSelect"
  | "radio"
  | "radioButton"
  | "switch"
  | "date"
  | "dateRange"
  | "image";

export type FieldOption = {
  label: string;
  value: string | number | boolean;
  color?: string | null;
  children?: FieldOption[];
};

export type AdminDataTableColumn<T extends object> = Omit<ColumnType<T>, "dataIndex"> & {
  dataIndex: keyof T & string;
  title: string;
  valueType?: FieldValueType;
  hideInSearch?: boolean;
  hideInForm?: boolean;
  hideInTable?: boolean;
  hideInCreate?: boolean;
  hideInUpdate?: boolean;
  required?: boolean;
  formItemProps?: FormItemProps;
  fieldProps?: Record<string, unknown>;
  options?: FieldOption[];
  searchOperator?: "=" | "like" | "betweenDate";
  fullWidth?: boolean;
};
