"use client";

import { ApiOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { Button, Switch, Tag, Tooltip } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";

type StorageRecord = {
  id: number;
  name: string;
  code: string;
  type: "local" | "s3";
  endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  accessKey?: string | null;
  secretKey?: string;
  hasSecretKey?: boolean;
  baseUrl?: string | null;
  rootPath?: string | null;
  isDefault: boolean;
  status: number;
  sort: number;
  optionsJson?: string | null;
  isSystem: boolean;
  createdAt: string;
};

const storageTypeOptions = [
  { label: "本地存储", value: "local" },
  { label: "S3-compatible", value: "s3" },
];

export function StoragePage() {
  const columns: AdminDataTableColumn<StorageRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    { title: "名称", dataIndex: "name", required: true, width: 140 },
    { title: "编码", dataIndex: "code", required: true, width: 120 },
    {
      title: "类型",
      dataIndex: "type",
      valueType: "select",
      options: storageTypeOptions,
      required: true,
      width: 128,
      render: (value) => <Tag color={value === "s3" ? "blue" : "green"}>{String(value)}</Tag>,
    },
    { title: "Endpoint", dataIndex: "endpoint", width: 180 },
    { title: "Region", dataIndex: "region", hideInSearch: true, width: 110 },
    { title: "Bucket", dataIndex: "bucket", width: 140 },
    { title: "Access Key", dataIndex: "accessKey", hideInSearch: true, width: 150 },
    {
      title: "Secret Key",
      dataIndex: "secretKey",
      valueType: "password",
      hideInTable: true,
      hideInSearch: true,
    },
    {
      title: "密钥",
      dataIndex: "hasSecretKey",
      hideInForm: true,
      hideInSearch: true,
      width: 80,
      render: (value) => <Tag color={value ? "success" : "default"}>{value ? "已配置" : "未配置"}</Tag>,
    },
    { title: "Base URL", dataIndex: "baseUrl", hideInSearch: true, width: 180 },
    { title: "Root Path", dataIndex: "rootPath", hideInSearch: true, width: 160 },
    {
      title: "默认",
      dataIndex: "isDefault",
      hideInForm: true,
      hideInSearch: true,
      width: 80,
      render: (value) => <Tag color={value ? "gold" : "default"}>{value ? "默认" : "-"}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      width: 104,
      render: (value, record) => (
        <Switch
          checked={Number(value) === 1}
          checkedChildren="启用"
          unCheckedChildren="停用"
          disabled={record.isDefault}
          onChange={async (checked) => {
            await request(`/api/system/storage/status/${record.id}`, {
              method: "PUT",
              body: { status: checked ? 1 : 0 },
            });
            feedback.success("状态更新成功");
          }}
        />
      ),
    },
    { title: "排序", dataIndex: "sort", valueType: "digit", hideInSearch: true, width: 88 },
    {
      title: "Options JSON",
      dataIndex: "optionsJson",
      valueType: "textarea",
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
    },
  ];

  return (
    <PageScaffold title="存储配置" description="维护本地和 S3-compatible 文件存储">
      <AdminDataTable
        api="/api/system/storage"
        accessName="system.storage"
        rowKey="id"
        columns={columns}
        createTitle="新增存储"
        updateTitle="编辑存储"
        canDelete={(record) => !record.isDefault && !record.isSystem}
        operateRender={(record, reload) => (
          <>
            <Tooltip title="测试连接">
              <Button
                size="small"
                icon={<ApiOutlined />}
                onClick={async () => {
                  await request("/api/system/storage/test", { method: "POST", body: { id: record.id } });
                  feedback.success("测试成功");
                }}
              />
            </Tooltip>
            {!record.isDefault ? (
              <Tooltip title="设为默认">
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  onClick={async () => {
                    await request(`/api/system/storage/default/${record.id}`, { method: "PUT" });
                    feedback.success("设置成功");
                    reload();
                  }}
                />
              </Tooltip>
            ) : null}
          </>
        )}
      />
    </PageScaffold>
  );
}
