"use client";

import { CheckCircleOutlined, MessageOutlined, SendOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal, Space, Switch, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";

type SmsProviderRecord = {
  id: number;
  name: string;
  code: string;
  provider: string;
  endpoint?: string | null;
  accessKey?: string | null;
  secretKey?: string | null;
  hasSecretKey?: boolean;
  signature?: string | null;
  templateCode?: string | null;
  isDefault: boolean;
  status: number;
  sort: number;
  optionsJson?: string | null;
  remark?: string | null;
  isSystem: boolean;
};

const providerOptions = [
  { label: "Webhook", value: "webhook" },
];

function normalizePayload(values: Record<string, unknown>) {
  const payload = { ...values };
  delete payload.hasSecretKey;
  if (!payload.secretKey) delete payload.secretKey;
  return payload;
}

export function SmsProviderPage() {
  const queryClient = useQueryClient();
  const [testProvider, setTestProvider] = useState<SmsProviderRecord | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testContent, setTestContent] = useState("Admin Base SMS test");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/sms/provider"] });
    void queryClient.invalidateQueries({ queryKey: ["system-settings", "sms-provider"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: number }) =>
      request(`/api/system/sms/provider/status/${id}`, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: () => {
      feedback.success("状态更新成功");
      invalidate();
    },
  });

  const defaultMutation = useMutation({
    mutationFn: (id: number) => request(`/api/system/sms/provider/default/${id}`, { method: "PUT" }),
    onSuccess: () => {
      feedback.success("设置成功");
      invalidate();
    },
  });

  const testMutation = useMutation({
    mutationFn: ({ id, to, content }: { id: number; to: string; content: string }) =>
      request("/api/system/sms/provider/test", {
        method: "POST",
        body: { id, to, content },
      }),
    onSuccess: () => {
      feedback.success("发送成功");
      setTestProvider(null);
      setTestTo("");
      setTestContent("Admin Base SMS test");
    },
  });

  const columns: AdminDataTableColumn<SmsProviderRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    {
      title: "名称",
      dataIndex: "name",
      required: true,
      width: 140,
      render: (value, record) => (
        <Space size={8}>
          <MessageOutlined />
          <Typography.Text strong>{String(value)}</Typography.Text>
          {record.isSystem ? <Tag color="blue">内置</Tag> : null}
        </Space>
      ),
    },
    {
      title: "编码",
      dataIndex: "code",
      required: true,
      width: 120,
      formHelp: "系统内置短信配置不能修改编码。业务模块可按编码选择短信通道。",
    },
    {
      title: "服务商",
      dataIndex: "provider",
      valueType: "select",
      options: providerOptions,
      required: true,
      width: 110,
      render: (value) => <Tag>{String(value || "webhook")}</Tag>,
    },
    { title: "Webhook Endpoint", dataIndex: "endpoint", width: 260, formHelp: "v1 支持通用 Webhook POST 发送。" },
    { title: "Access Key", dataIndex: "accessKey", hideInSearch: true, width: 150 },
    {
      title: "Secret Key",
      dataIndex: "secretKey",
      valueType: "password",
      hideInTable: true,
      hideInSearch: true,
      formHelp: "留空时保留原密钥；响应只返回密钥状态。",
    },
    {
      title: "密钥",
      dataIndex: "hasSecretKey",
      hideInForm: true,
      hideInSearch: true,
      width: 88,
      render: (value) => <Tag color={value ? "success" : "default"}>{value ? "已配置" : "未配置"}</Tag>,
    },
    { title: "短信签名", dataIndex: "signature", hideInSearch: true, width: 140 },
    { title: "模板编码", dataIndex: "templateCode", hideInSearch: true, width: 140 },
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
      title: "扩展配置 JSON",
      dataIndex: "optionsJson",
      valueType: "textarea",
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
      formHelp: "可保存 provider 私有配置；必须是合法 JSON。",
    },
    {
      title: "备注",
      dataIndex: "remark",
      valueType: "textarea",
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
    },
  ];

  return (
    <PageScaffold title="短信配置" description="维护短信服务商、签名、密钥和测试发送">
      <AdminDataTable
        api="/api/system/sms/provider"
        accessName="system.smsProvider"
        rowKey="id"
        columns={columns}
        createTitle="新增短信配置"
        updateTitle="编辑短信配置"
        canDelete={(record) => !record.isDefault && !record.isSystem}
        beforeSubmit={normalizePayload}
        onDataChanged={invalidate}
        operateRender={(record, reload) => (
          <>
            <Tooltip title="测试发送">
              <Button
                size="small"
                icon={<SendOutlined />}
                loading={testMutation.isPending && testProvider?.id === record.id}
                onClick={() => {
                  setTestProvider(record);
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
                      title: "切换默认短信配置",
                      content: `确认将 ${record.name} 设为默认短信配置吗？后续系统短信会优先使用该配置。`,
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
            ) : (
              <Tooltip title="默认配置">
                <Button size="small" disabled icon={<MessageOutlined />} />
              </Tooltip>
            )}
          </>
        )}
      />
      <Modal
        title="测试短信发送"
        open={Boolean(testProvider)}
        okText="发送"
        confirmLoading={testMutation.isPending}
        onOk={() => {
          if (!testProvider || !testTo.trim()) {
            feedback.warning("请输入接收手机号");
            return;
          }
          void testMutation.mutateAsync({
            id: testProvider.id,
            to: testTo.trim(),
            content: testContent.trim() || "Admin Base SMS test",
          });
        }}
        onCancel={() => {
          setTestProvider(null);
          setTestTo("");
          setTestContent("Admin Base SMS test");
        }}
      >
        <Space direction="vertical" className="system-test-panel" size={12}>
          <div>
            <strong>{testProvider?.name}</strong>
            <span>使用当前 Webhook 短信配置发送一条测试消息。</span>
          </div>
          <Input value={testTo} onChange={(event) => setTestTo(event.target.value)} placeholder="接收手机号" />
          <Input.TextArea
            value={testContent}
            rows={4}
            onChange={(event) => setTestContent(event.target.value)}
            placeholder="短信内容"
          />
        </Space>
      </Modal>
    </PageScaffold>
  );
}
