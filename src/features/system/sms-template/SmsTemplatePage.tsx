"use client";

import { MessageOutlined, SendOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal, Space, Switch, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";

type SmsProviderRecord = {
  id: number;
  name: string;
  code: string;
  status: number;
};

type SmsTemplateRecord = {
  id: number;
  name: string;
  code: string;
  providerId: number;
  providerName?: string | null;
  providerCode?: string | null;
  templateCode?: string | null;
  signature?: string | null;
  content: string;
  variablesJson?: string | null;
  status: number;
  sort: number;
  remark?: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt?: string;
};

function normalizePayload(values: Record<string, unknown>) {
  const payload = { ...values };
  delete payload.providerName;
  delete payload.providerCode;
  delete payload.isSystem;
  return payload;
}

function parseVariables(value: string) {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("测试变量必须是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

export function SmsTemplatePage() {
  const queryClient = useQueryClient();
  const [testTemplate, setTestTemplate] = useState<SmsTemplateRecord | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testVariables, setTestVariables] = useState("{}");

  const providerQuery = useQuery({
    queryKey: ["system-sms-provider-options"],
    queryFn: async () => {
      const page = await request<PageResult<SmsProviderRecord>>(
        `/api/system/sms/provider${buildQueryString({ page: 1, pageSize: 200 })}`,
      );
      return page.data;
    },
  });

  const providerOptions: FieldOption[] = (providerQuery.data ?? []).map((provider) => ({
    label: `${provider.name} (${provider.code})`,
    value: provider.id,
    disabled: provider.status !== 1,
  }));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/sms/template"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: number }) =>
      request(`/api/system/sms/template/status/${id}`, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: () => {
      feedback.success("状态更新成功");
      invalidate();
    },
  });

  const testMutation = useMutation({
    mutationFn: ({ id, to, variables }: { id: number; to: string; variables: Record<string, unknown> }) =>
      request("/api/system/sms/template/test", {
        method: "POST",
        body: { id, to, variables },
      }),
    onSuccess: () => {
      feedback.success("发送成功");
      setTestTemplate(null);
      setTestTo("");
      setTestVariables("{}");
    },
  });

  const columns: AdminDataTableColumn<SmsTemplateRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    {
      title: "模板名称",
      dataIndex: "name",
      required: true,
      width: 170,
      render: (value, record) => (
        <Space size={8}>
          <MessageOutlined />
          <Typography.Text strong>{String(value)}</Typography.Text>
          {record.isSystem ? <Tag color="blue">内置</Tag> : null}
        </Space>
      ),
    },
    {
      title: "模板编码",
      dataIndex: "code",
      required: true,
      width: 150,
      formHelp: "业务代码可按模板编码选择短信模板。系统内置模板不能修改编码。",
    },
    {
      title: "短信通道",
      dataIndex: "providerId",
      valueType: "select",
      options: providerOptions,
      required: true,
      width: 190,
      render: (_, record) => (
        <Space size={4} wrap>
          <Typography.Text>{record.providerName || record.providerId}</Typography.Text>
          {record.providerCode ? <Tag>{record.providerCode}</Tag> : null}
        </Space>
      ),
    },
    { title: "第三方模板 ID", dataIndex: "templateCode", hideInSearch: true, width: 150 },
    { title: "短信签名", dataIndex: "signature", hideInSearch: true, width: 130 },
    {
      title: "模板内容",
      dataIndex: "content",
      valueType: "textarea",
      required: true,
      hideInSearch: true,
      width: 260,
      formHelp: "支持 {{变量名}} 占位符，测试发送时会用测试变量替换。",
      render: (value) => (
        <Typography.Text ellipsis style={{ maxWidth: 240 }}>
          {String(value)}
        </Typography.Text>
      ),
    },
    {
      title: "变量 JSON",
      dataIndex: "variablesJson",
      valueType: "textarea",
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
      formHelp: '例如 {"code":"验证码","expireMinutes":"有效分钟数"}，只保存模板变量说明。',
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
          onChange={async (checked) => {
            await statusMutation.mutateAsync({ id: record.id, status: checked ? 1 : 0 });
          }}
        />
      ),
    },
    { title: "排序", dataIndex: "sort", valueType: "digit", hideInSearch: true, width: 88 },
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
    <PageScaffold title="短信模板" description="维护业务短信模板、变量说明和测试发送">
      <AdminDataTable
        api="/api/system/sms/template"
        accessName="system.smsTemplate"
        rowKey="id"
        columns={columns}
        createTitle="新增短信模板"
        updateTitle="编辑短信模板"
        canDelete={(record) => !record.isSystem}
        beforeSubmit={normalizePayload}
        onDataChanged={invalidate}
        operateRender={(record) => (
          <Tooltip title="测试发送">
            <Button
              size="small"
              icon={<SendOutlined />}
              loading={testMutation.isPending && testTemplate?.id === record.id}
              onClick={() => {
                setTestTemplate(record);
                setTestTo("");
                setTestVariables("{}");
              }}
            />
          </Tooltip>
        )}
      />
      <Modal
        title="测试短信模板"
        open={Boolean(testTemplate)}
        okText="发送"
        confirmLoading={testMutation.isPending}
        onOk={() => {
          if (!testTemplate || !testTo.trim()) {
            feedback.warning("请输入接收手机号");
            return;
          }
          try {
            void testMutation.mutateAsync({
              id: testTemplate.id,
              to: testTo.trim(),
              variables: parseVariables(testVariables),
            });
          } catch (error) {
            feedback.error(error instanceof Error ? error.message : "测试变量格式错误");
          }
        }}
        onCancel={() => {
          setTestTemplate(null);
          setTestTo("");
          setTestVariables("{}");
        }}
      >
        <Space direction="vertical" className="system-test-panel" size={12}>
          <div>
            <strong>{testTemplate?.name}</strong>
            <div>
              <Typography.Text type="secondary">
                使用绑定短信通道发送模板测试。模板内容中的 {"{{变量名}}"} 会用下方 JSON 替换。
              </Typography.Text>
            </div>
          </div>
          <Input value={testTo} onChange={(event) => setTestTo(event.target.value)} placeholder="接收手机号" />
          <Input.TextArea
            value={testVariables}
            rows={5}
            onChange={(event) => setTestVariables(event.target.value)}
            placeholder='{"code":"123456"}'
          />
        </Space>
      </Modal>
    </PageScaffold>
  );
}
