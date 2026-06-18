"use client";

import { QuestionCircleOutlined } from "@ant-design/icons";
import { Form, Modal, Tooltip } from "antd";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { AdminFieldRenderer } from "@/components/admin-fields/AdminFieldRenderer";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import type { NamePath } from "antd/es/form/interface";

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

function renderFormLabel(title: string, help?: ReactNode) {
  if (!help) return title;
  return (
    <span className="admin-form-label-help">
      <span>{title}</span>
      <Tooltip
        title={help}
        placement="topLeft"
        rootClassName="admin-form-help-tooltip"
        trigger={["hover", "focus", "click"]}
        destroyOnHidden
      >
        <span
          aria-label={`${title}说明`}
          className="admin-form-help-trigger"
          role="button"
          tabIndex={0}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <QuestionCircleOutlined className="admin-form-help-icon" />
        </span>
      </Tooltip>
    </span>
  );
}

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
            <div
              className={column.fullWidth ? "admin-form-full" : undefined}
              key={column.dataIndex}
            >
              <Form.Item
                {...column.formItemProps}
                label={
                  column.formItemProps?.label ?? renderFormLabel(column.title, column.formHelp)
                }
                name={column.dataIndex as NamePath}
                rules={
                  column.required
                    ? [{ required: true, message: `请输入${column.title}` }]
                    : column.formItemProps?.rules
                }
              >
                {column.renderFormField ? (
                  column.renderFormField({ form, initialValues, mode })
                ) : (
                  <AdminFieldRenderer
                    valueType={column.valueType}
                    options={column.options}
                    fieldProps={column.fieldProps}
                  />
                )}
              </Form.Item>
            </div>
          ))}
        </div>
      </Form>
    </Modal>
  );
}
