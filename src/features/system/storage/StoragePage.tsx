"use client";

import { ApiOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Modal, Switch, Tag, Tooltip } from "antd";
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
  const queryClient = useQueryClient();

  const invalidateStorage = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/storage"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: number }) =>
      request(`/api/system/storage/status/${id}`, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: () => {
      feedback.success("状态更新成功");
      invalidateStorage();
    },
  });

  const defaultMutation = useMutation({
    mutationFn: (id: number) => request(`/api/system/storage/default/${id}`, { method: "PUT" }),
    onSuccess: () => {
      feedback.success("设置成功");
      invalidateStorage();
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => request("/api/system/storage/test", { method: "POST", body: { id } }),
    onSuccess: () => {
      feedback.success("测试成功");
    },
  });

  const columns: AdminDataTableColumn<StorageRecord>[] = [
    {
      title: "ID",
      dataIndex: "id",
      hideInForm: true,
      hideInSearch: true,
      width: 72,
      fixed: "left",
    },
    { title: "名称", dataIndex: "name", required: true, width: 140, fixed: "left" },
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
          loading={statusMutation.isPending}
          checkedChildren="启用"
          unCheckedChildren="停用"
          disabled={record.isDefault}
          onChange={async (checked) => {
            await statusMutation.mutateAsync({ id: record.id, status: checked ? 1 : 0 });
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
        actionColumnWidth={176}
        canDelete={(record) => !record.isDefault && !record.isSystem}
        operateRender={(record, reload) => (
          <>
            <Tooltip title="测试连接">
              <Button
                size="small"
                icon={<ApiOutlined />}
                loading={testMutation.isPending}
                onClick={async () => {
                  await testMutation.mutateAsync(record.id);
                }}
              />
            </Tooltip>
            {!record.isDefault ? (
              <Tooltip title="设为默认">
                <Button
                  size="small"
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  loading={defaultMutation.isPending}
                  onClick={() => {
                    Modal.confirm({
                      title: "切换默认存储",
                      content: `确认将 ${record.name} 设为默认存储吗？后续上传会使用该存储。`,
                      okText: "设为默认",
                      cancelText: "取消",
                      onOk: async () => {
                        await defaultMutation.mutateAsync(record.id);
                        reload();
                      },
                    });
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
