"use client";

import { QuestionCircleOutlined } from "@ant-design/icons";
import { Button, Form, Modal, Tooltip } from "antd";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
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
  basicColumnCount?: 1 | 2;
  notice?: ReactNode;
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
  basicColumnCount = 2,
  notice,
  onCancel,
  onFinish,
}: AdminEntityFormProps<T>) {
  const [form] = Form.useForm();
  const [advancedOpen, setAdvancedOpen] = useState(false);
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

  const basicColumns = formColumns.filter((column) => column.formSection !== "advanced");
  const advancedColumns = formColumns.filter((column) => column.formSection === "advanced");

  const renderColumn = (column: AdminDataTableColumn<T>) => (
    <div className={column.fullWidth ? "admin-form-full" : undefined} key={column.dataIndex}>
      <Form.Item
        {...column.formItemProps}
        label={column.formItemProps?.label ?? renderFormLabel(column.title, column.formHelp)}
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
  );

  const handleCancel = () => {
    setAdvancedOpen(false);
    onCancel();
  };

  const handleFinish = async (values: Record<string, unknown>) => {
    await onFinish(values);
    setAdvancedOpen(false);
  };

  return (
    <Modal
      open={open}
      title={title}
      width={760}
      confirmLoading={loading}
      onCancel={handleCancel}
      onOk={() => form.submit()}
      destroyOnHidden
      mask={{ closable: false }}
    >
      <Form form={form} layout="vertical" onFinish={handleFinish} requiredMark={false}>
        {notice ? <div className="admin-entity-form-notice">{notice}</div> : null}
        <div
          className={`admin-entity-form-grid admin-entity-form-grid--basic-${basicColumnCount}`}
          data-testid="admin-entity-form"
        >
          {basicColumns.map(renderColumn)}
          {advancedColumns.length ? (
            <div className="admin-form-full admin-form-advanced-toggle">
              <Button
                type="link"
                icon={advancedOpen ? <UpOutlined /> : <DownOutlined />}
                onClick={() => setAdvancedOpen((value) => !value)}
              >
                {advancedOpen ? "收起高级配置" : "展开高级配置"}
              </Button>
            </div>
          ) : null}
          {advancedOpen ? advancedColumns.map(renderColumn) : null}
        </div>
      </Form>
    </Modal>
  );
}
