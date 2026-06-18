"use client";

import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Form, Input, Space } from "antd";
import { useEffect } from "react";
import { AdminFieldRenderer } from "@/components/admin-fields/AdminFieldRenderer";
import type { AdminDataTableColumn, FieldValueType } from "@/components/admin-fields/types";

type AdminSearchFormProps<T extends object> = {
  columns: AdminDataTableColumn<T>[];
  values: Record<string, unknown>;
  keyword?: string;
  includeKeyword?: boolean;
  loading?: boolean;
  onSearch: (values: Record<string, unknown>) => void;
  onReset: () => void;
};

function getSearchValueType(valueType?: FieldValueType) {
  return valueType === "textarea" ? "text" : valueType;
}

function getSearchFieldProps(
  title: string,
  valueType?: FieldValueType,
  fieldProps?: Record<string, unknown>,
) {
  const searchFieldProps = { ...fieldProps };

  if (valueType === "textarea") {
    delete searchFieldProps.rows;
    delete searchFieldProps.autoSize;
  }

  return {
    placeholder: valueType === "textarea" ? `请输入${title}关键词` : title,
    ...searchFieldProps,
  };
}

export function AdminSearchForm<T extends object>({
  columns,
  values,
  keyword,
  includeKeyword = true,
  loading,
  onSearch,
  onReset,
}: AdminSearchFormProps<T>) {
  const [form] = Form.useForm();
  const searchColumns = columns.filter((column) => !column.hideInSearch);

  useEffect(() => {
    form.setFieldsValue({
      ...values,
      keyword,
    });
  }, [form, keyword, values]);

  return (
    <div className="admin-search-form">
      <Form form={form} layout="vertical" onFinish={onSearch}>
        <div className="admin-search-row">
          {includeKeyword ? (
            <div className="admin-search-item">
              <Form.Item label="关键词" name="keyword">
                <Input allowClear placeholder="请输入关键字" />
              </Form.Item>
            </div>
          ) : null}
          {searchColumns.map((column) => (
            <div className="admin-search-item" key={column.dataIndex}>
              <Form.Item label={column.title} name={String(column.dataIndex)}>
                <AdminFieldRenderer
                  valueType={getSearchValueType(column.valueType)}
                  options={column.options}
                  fieldProps={getSearchFieldProps(
                    column.title,
                    column.valueType,
                    column.fieldProps,
                  )}
                />
              </Form.Item>
            </div>
          ))}
          <div className="admin-search-actions">
            <Form.Item label=" " colon={false}>
              <Space size={16}>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => {
                    form.resetFields();
                    onReset();
                  }}
                >
                  重置
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<SearchOutlined />}
                  loading={loading}
                >
                  搜索
                </Button>
              </Space>
            </Form.Item>
          </div>
        </div>
      </Form>
    </div>
  );
}
