"use client";

import { Form, Modal } from "antd";
import { useEffect } from "react";
import { AdminFieldRenderer } from "@/components/admin-fields/AdminFieldRenderer";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";

type AdminEntityFormProps<T extends object> = {
  open: boolean;
  mode: "create" | "update";
  title: string;
  columns: AdminDataTableColumn<T>[];
  initialValues?: Partial<T> | null;
  loading?: boolean;
  onCancel: () => void;
  onFinish: (values: Record<string, unknown>) => Promise<void> | void;
};

export function AdminEntityForm<T extends object>({
  open,
  mode,
  title,
  columns,
  initialValues,
  loading,
  onCancel,
  onFinish,
}: AdminEntityFormProps<T>) {
  const [form] = Form.useForm();
  const formColumns = columns.filter((column) => {
    if (column.hideInForm) return false;
    if (mode === "create" && column.hideInCreate) return false;
    if (mode === "update" && column.hideInUpdate) return false;
    return true;
  });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const applyValues = () => form.setFieldsValue(initialValues ?? {});
    if (typeof queueMicrotask === "function") {
      queueMicrotask(applyValues);
      return;
    }
    const timer = window.setTimeout(applyValues, 0);
    return () => window.clearTimeout(timer);
  }, [form, initialValues, open]);

  return (
    <Modal
      open={open}
      title={title}
      width={760}
      confirmLoading={loading}
      onCancel={onCancel}
      onOk={() => form.submit()}
      destroyOnHidden
      mask={{ closable: false }}
    >
      <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
        <div className="admin-entity-form-grid" data-testid="admin-entity-form">
          {formColumns.map((column) => (
            <div className={column.fullWidth ? "admin-form-full" : undefined} key={column.dataIndex}>
              <Form.Item
                label={column.title}
                name={column.dataIndex}
                rules={
                  column.required
                    ? [{ required: true, message: `请输入${column.title}` }]
                    : column.formItemProps?.rules
                }
                {...column.formItemProps}
              >
                <AdminFieldRenderer
                  valueType={column.valueType}
                  options={column.options}
                  fieldProps={column.fieldProps}
                />
              </Form.Item>
            </div>
          ))}
        </div>
      </Form>
    </Modal>
  );
}
