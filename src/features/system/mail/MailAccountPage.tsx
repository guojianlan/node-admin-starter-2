"use client";

import { CheckCircleOutlined, MailOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Switch, Tag, Tooltip } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";

type MailAccountRecord = {
  id: number;
  name: string;
  code: string;
  host: string;
  port: number;
  secure: boolean;
  username?: string | null;
  password?: string;
  hasPassword?: boolean;
  fromName?: string | null;
  fromEmail: string;
  replyTo?: string | null;
  isDefault: boolean;
  status: number;
  sort: number;
  isSystem: boolean;
};

const secureOptions = [
  { label: "STARTTLS/普通", value: false },
  { label: "SSL/TLS", value: true },
];

export function MailAccountPage() {
  const columns: AdminDataTableColumn<MailAccountRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    { title: "名称", dataIndex: "name", required: true, width: 140 },
    { title: "编码", dataIndex: "code", required: true, width: 120 },
    { title: "SMTP Host", dataIndex: "host", required: true, width: 180 },
    { title: "端口", dataIndex: "port", valueType: "digit", required: true, width: 86 },
    {
      title: "安全连接",
      dataIndex: "secure",
      valueType: "select",
      options: secureOptions,
      width: 110,
      render: (value) => <Tag color={value ? "blue" : "default"}>{value ? "SSL/TLS" : "普通"}</Tag>,
    },
    { title: "用户名", dataIndex: "username", hideInSearch: true, width: 150 },
    {
      title: "密码",
      dataIndex: "password",
      valueType: "password",
      hideInTable: true,
      hideInSearch: true,
    },
    {
      title: "密码状态",
      dataIndex: "hasPassword",
      hideInForm: true,
      hideInSearch: true,
      width: 92,
      render: (value) => <Tag color={value ? "success" : "default"}>{value ? "已配置" : "未配置"}</Tag>,
    },
    { title: "发件名称", dataIndex: "fromName", hideInSearch: true, width: 120 },
    { title: "发件邮箱", dataIndex: "fromEmail", required: true, width: 180 },
    { title: "回复邮箱", dataIndex: "replyTo", hideInSearch: true, width: 180 },
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
            await request(`/api/system/mail/account/status/${record.id}`, {
              method: "PUT",
              body: { status: checked ? 1 : 0 },
            });
            feedback.success("状态更新成功");
          }}
        />
      ),
    },
    { title: "排序", dataIndex: "sort", valueType: "digit", hideInSearch: true, width: 88 },
  ];

  return (
    <PageScaffold title="邮件配置" description="维护 SMTP 账号并执行测试发送">
      <AdminDataTable
        api="/api/system/mail/account"
        accessName="system.mail"
        rowKey="id"
        columns={columns}
        createTitle="新增邮件账号"
        updateTitle="编辑邮件账号"
        canDelete={(record) => !record.isDefault && !record.isSystem}
        operateRender={(record, reload) => (
          <>
            <Tooltip title="测试发送">
              <Button
                size="small"
                icon={<SendOutlined />}
                onClick={async () => {
                  const to = window.prompt("收件邮箱", record.fromEmail);
                  if (!to) return;
                  await request("/api/system/mail/account/test", {
                    method: "POST",
                    body: { id: record.id, to },
                  });
                  feedback.success("发送成功");
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
                    await request(`/api/system/mail/account/default/${record.id}`, {
                      method: "PUT",
                    });
                    feedback.success("设置成功");
                    reload();
                  }}
                />
              </Tooltip>
            ) : (
              <Tooltip title="默认账号">
                <Button size="small" disabled icon={<MailOutlined />} />
              </Tooltip>
            )}
          </>
        )}
      />
    </PageScaffold>
  );
}
