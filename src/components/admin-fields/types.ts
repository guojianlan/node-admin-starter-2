import type { FormInstance, FormItemProps } from "antd";
import type { ColumnType } from "antd/es/table";
import type { ReactNode } from "react";

export type FieldValueType =
  | "text"
  | "password"
  | "textarea"
  | "richText"
  | "digit"
  | "select"
  | "treeSelect"
  | "radio"
  | "radioButton"
  | "switch"
  | "date"
  | "datetime"
  | "dateRange"
  | "image";

export type FieldOption = {
  label: string;
  value: string | number | boolean;
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
  formHelp?: ReactNode;
  formSection?: "basic" | "advanced";
  formItemProps?: FormItemProps;
  fieldProps?: Record<string, unknown>;
  options?: FieldOption[];
  searchOperator?: "=" | "like" | "betweenDate";
  fullWidth?: boolean;
  renderFormField?: (context: {
    form: FormInstance<T>;
    initialValues?: Partial<T> | null;
    mode: "create" | "update";
  }) => ReactNode;
};
