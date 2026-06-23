"use client";

import { ClearOutlined, CopyOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Space, Tag, Tooltip, Typography } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type LoginLogRecord = {
  id: number;
  username: string;
  ip?: string | null;
  userAgent?: string | null;
  status: number;
  message?: string | null;
  createdAt: string;
};

async function copyText(value?: string | null) {
  if (!value) return;
  await navigator.clipboard.writeText(value);
  feedback.success("已复制");
}

export function LoginLogPage() {
  const queryClient = useQueryClient();
  const cleanMutation = useMutation({
    mutationFn: () => request("/api/system/login/log/clean", { method: "DELETE", body: {} }),
    onSuccess: () => {
      feedback.success("清理成功");
      void queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/login/log"] });
    },
  });

  const columns: AdminDataTableColumn<LoginLogRecord>[] = [
    { title: "ID", dataIndex: "id", width: 80, sorter: true, hideInForm: true, hideInSearch: true },
    {
      title: "结果",
      dataIndex: "status",
      valueType: "select",
      options: [
        { label: "成功", value: 1 },
        { label: "失败", value: 0 },
      ],
      width: 96,
      render: (value) =>
        Number(value) === 1 ? (
          <Badge status="success" text="成功" />
        ) : (
          <Badge status="error" text="失败" />
        ),
    },
    {
      title: "用户名",
      dataIndex: "username",
      width: 140,
      render: (value) => <Typography.Text strong>{String(value)}</Typography.Text>,
    },
    {
      title: "IP",
      dataIndex: "ip",
      width: 160,
      render: (value) =>
        value ? (
          <Space size={4}>
            <Typography.Text code>{String(value)}</Typography.Text>
            <Tooltip title="复制 IP">
              <Button
                aria-label="复制 IP"
                size="small"
                icon={<CopyOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  void copyText(String(value));
                }}
              />
            </Tooltip>
          </Space>
        ) : (
          "-"
        ),
    },
    {
      title: "登录消息",
      dataIndex: "message",
      width: 160,
      render: (value, record) => (
        <Tag color={record.status === 1 ? "success" : "error"}>{String(value || "-")}</Tag>
      ),
    },
    {
      title: "User-Agent",
      dataIndex: "userAgent",
      width: 420,
      ellipsis: true,
      render: (value) => (
        <Typography.Text type="secondary" ellipsis style={{ maxWidth: 400 }}>
          {String(value || "-")}
        </Typography.Text>
      ),
    },
    {
      title: "登录时间",
      dataIndex: "createdAt",
      valueType: "dateRange",
      width: 180,
      sorter: true,
    },
  ];

  return (
    <PageScaffold title="登录日志" description="查看后台账号登录成功、失败和来源信息">
      <AdminDataTable
        api="/api/system/login/log"
        accessName="system.loginLog"
        rowKey="id"
        columns={columns}
        enableCreate={false}
        enableUpdate={false}
        enableDelete
        defaultPageSize={20}
        toolbarTitle="登录记录"
        actionBarRender={() => (
          <AuthButton auth="system.loginLog.clean">
            <Button
              danger
              icon={<ClearOutlined />}
              loading={cleanMutation.isPending}
              onClick={() => {
                if (!window.confirm("确认清理全部登录日志？")) return;
                cleanMutation.mutate();
              }}
            >
              清理日志
            </Button>
          </AuthButton>
        )}
        tableProps={{ size: "small", scroll: { x: 1180 } }}
      />
    </PageScaffold>
  );
}
