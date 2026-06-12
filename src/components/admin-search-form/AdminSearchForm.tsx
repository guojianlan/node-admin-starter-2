"use client";

import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Col, Form, Input, Row, Space } from "antd";
import { useEffect } from "react";
import { AdminFieldRenderer } from "@/components/admin-fields/AdminFieldRenderer";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";

type AdminSearchFormProps<T extends object> = {
  columns: AdminDataTableColumn<T>[];
  values: Record<string, unknown>;
  keyword?: string;
  includeKeyword?: boolean;
  loading?: boolean;
  onSearch: (values: Record<string, unknown>) => void;
  onReset: () => void;
};

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
        <Row gutter={[20, 20]}>
          {includeKeyword ? (
            <Col xs={24} sm={12} md={12} lg={8} xl={6} xxl={4}>
              <Form.Item label="关键词" name="keyword">
                <Input allowClear placeholder="请输入关键字" />
              </Form.Item>
            </Col>
          ) : null}
          {searchColumns.map((column) => (
            <Col xs={24} sm={12} md={12} lg={8} xl={6} xxl={4} key={column.dataIndex}>
              <Form.Item label={column.title} name={String(column.dataIndex)}>
                <AdminFieldRenderer
                  valueType={column.valueType}
                  options={column.options}
                  fieldProps={{ placeholder: column.title, ...column.fieldProps }}
                />
              </Form.Item>
            </Col>
          ))}
          <Col xs={24} sm={12} md={12} lg={8} xl={6} xxl={4}>
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
                <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}>
                  搜索
                </Button>
              </Space>
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </div>
  );
}
