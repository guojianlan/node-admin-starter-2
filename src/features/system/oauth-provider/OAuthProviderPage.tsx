"use client";

import { ApiOutlined, LoginOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Space, Tag, Tooltip, Typography } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";

type OAuthProviderRecord = {
  id: number;
  key: string;
  name: string;
  enabled: boolean;
  authUrl: string;
  tokenUrl?: string | null;
  userInfoUrl?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  hasClientSecret?: boolean;
  scopes?: string[];
  scopesJson?: string | null;
  userMappingJson?: string | null;
  autoCreateUser: boolean;
  status: number;
  sort: number;
  isSystem: boolean;
};

const booleanOptions = [
  { label: "启用", value: true },
  { label: "停用", value: false },
];

function normalizeProviderPayload(values: Record<string, unknown>) {
  const payload = { ...values };
  payload.scopes = values.scopesJson;
  payload.userMapping = values.userMappingJson;
  delete payload.scopesJson;
  delete payload.userMappingJson;
  delete payload.hasClientSecret;
  if (!payload.clientSecret) delete payload.clientSecret;
  return payload;
}

export function OAuthProviderPage() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["admin-data-table", "/api/system/oauth/provider"],
    });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      request(`/api/system/oauth/provider/status/${id}`, {
        method: "PUT",
        body: { status: 1, enabled },
      }),
    onSuccess: () => {
      feedback.success("状态更新成功");
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ["login-options"] });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) =>
      request("/api/system/oauth/provider/test", { method: "POST", body: { id } }),
    onSuccess: () => {
      feedback.success("配置完整");
    },
  });

  const columns: AdminDataTableColumn<OAuthProviderRecord>[] = [
    {
      title: "ID",
      dataIndex: "id",
      hideInForm: true,
      hideInSearch: true,
      width: 72,
      fixed: "left",
    },
    {
      title: "名称",
      dataIndex: "name",
      required: true,
      width: 180,
      fixed: "left",
      render: (value, record) => (
        <Space size={6} wrap>
          <LoginOutlined />
          <Typography.Text strong>{String(value)}</Typography.Text>
          {record.isSystem ? <Tag color="blue">内置模板</Tag> : null}
        </Space>
      ),
    },
    {
      title: "编码",
      dataIndex: "key",
      required: true,
      width: 120,
      formHelp: "系统内置模板不能修改编码。编码会出现在 /api/system/oauth/:provider/redirect 中。",
    },
    {
      title: "启用",
      dataIndex: "enabled",
      valueType: "radioButton",
      options: booleanOptions,
      width: 96,
      render: (value, record) => (
        <Button
          size="small"
          type={value ? "primary" : "default"}
          loading={statusMutation.isPending}
          onClick={async () => {
            await statusMutation.mutateAsync({ id: record.id, enabled: !value });
          }}
        >
          {value ? "启用" : "停用"}
        </Button>
      ),
    },
    { title: "授权地址", dataIndex: "authUrl", required: true, width: 260 },
    { title: "Token 地址", dataIndex: "tokenUrl", hideInSearch: true, width: 240 },
    { title: "用户信息地址", dataIndex: "userInfoUrl", hideInSearch: true, width: 240 },
    { title: "Client ID", dataIndex: "clientId", hideInSearch: true, width: 180 },
    {
      title: "Client Secret",
      dataIndex: "clientSecret",
      valueType: "password",
      hideInTable: true,
      hideInSearch: true,
      formHelp: "留空时保留原密钥；响应中只返回 hasClientSecret，不返回密文或明文。",
    },
    {
      title: "密钥",
      dataIndex: "hasClientSecret",
      hideInForm: true,
      hideInSearch: true,
      width: 88,
      render: (value) => <Tag color={value ? "success" : "default"}>{value ? "已配置" : "未配置"}</Tag>,
    },
    {
      title: "Scopes",
      dataIndex: "scopesJson",
      valueType: "textarea",
      hideInSearch: true,
      width: 180,
      formHelp: '支持 JSON 数组或空格/逗号分隔，例如 ["user:email"]。',
      render: (_, record) =>
        record.scopes?.length ? (
          <Space wrap size={4}>
            {record.scopes.map((scope) => (
              <Tag key={scope}>{scope}</Tag>
            ))}
          </Space>
        ) : (
          <Typography.Text type="secondary">未配置</Typography.Text>
        ),
    },
    {
      title: "用户映射 JSON",
      dataIndex: "userMappingJson",
      valueType: "textarea",
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
      formHelp: '例如 {"id":"id","username":"login","email":"email","nickname":"name"}。',
    },
    {
      title: "自动创建用户",
      dataIndex: "autoCreateUser",
      valueType: "radioButton",
      options: booleanOptions,
      width: 120,
      render: (value) => <Tag color={value ? "orange" : "default"}>{value ? "允许" : "关闭"}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      width: 104,
      render: (value) => (
        <Tag color={Number(value) === 1 ? "success" : "error"}>
          {Number(value) === 1 ? "正常" : "停用"}
        </Tag>
      ),
    },
    { title: "排序", dataIndex: "sort", valueType: "digit", hideInSearch: true, width: 88 },
  ];

  return (
    <PageScaffold title="第三方登录" description="维护 OAuth Provider、授权地址和账号绑定策略">
      <AdminDataTable
        api="/api/system/oauth/provider"
        accessName="system.oauthProvider"
        rowKey="id"
        columns={columns}
        createTitle="新增 Provider"
        updateTitle="编辑 Provider"
        actionColumnWidth={164}
        canDelete={(record) => !record.isSystem}
        beforeSubmit={normalizeProviderPayload}
        onDataChanged={() => {
          void queryClient.invalidateQueries({ queryKey: ["login-options"] });
        }}
        operateRender={(record) => (
          <Tooltip title="检查配置完整性">
            <Button
              size="small"
              icon={<ApiOutlined />}
              loading={testMutation.isPending}
              onClick={async () => {
                await testMutation.mutateAsync(record.id);
              }}
            />
          </Tooltip>
        )}
      />
    </PageScaffold>
  );
}
