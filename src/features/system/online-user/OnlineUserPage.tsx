"use client";

import { ClearOutlined, DisconnectOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Badge, Button, Modal, Space, Tag, Tooltip, Typography } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type OnlineUserRecord = {
  id: number;
  userId: number;
  username: string;
  nickname: string;
  name: string;
  ip?: string | null;
  userAgent?: string | null;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
};

function isExpired(value?: string | null) {
  return Boolean(value && dayjs(value).isBefore(dayjs()));
}

export function OnlineUserPage() {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/online/user"] });

  const kickMutation = useMutation({
    mutationFn: (id: number) => request(`/api/system/online/user/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      feedback.success("已强制下线");
      void invalidate();
    },
  });
  const cleanMutation = useMutation({
    mutationFn: () => request("/api/system/online/user/expired", { method: "DELETE", body: {} }),
    onSuccess: () => {
      feedback.success("清理成功");
      void invalidate();
    },
  });

  const columns: AdminDataTableColumn<OnlineUserRecord>[] = [
    {
      title: "Token ID",
      dataIndex: "id",
      width: 96,
      sorter: true,
      hideInForm: true,
      hideInSearch: true,
      fixed: "left",
    },
    {
      title: "用户",
      dataIndex: "username",
      width: 180,
      fixed: "left",
      render: (_, record) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{record.nickname || record.username}</Typography.Text>
          <Typography.Text type="secondary">
            {record.username} #{record.userId}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "expiresAt",
      width: 100,
      hideInSearch: true,
      fixed: "left",
      render: (value) =>
        isExpired(value ? String(value) : null) ? (
          <Badge status="default" text="已过期" />
        ) : (
          <Badge status="processing" text="在线" />
        ),
    },
    {
      title: "IP",
      dataIndex: "ip",
      width: 150,
      render: (value) => (value ? <Typography.Text code>{String(value)}</Typography.Text> : "-"),
    },
    {
      title: "客户端",
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
      title: "最近活跃",
      dataIndex: "lastUsedAt",
      valueType: "dateRange",
      width: 180,
      sorter: true,
      render: (value) => (value ? dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss") : "-"),
    },
    {
      title: "过期时间",
      dataIndex: "expiresAt",
      width: 180,
      render: (value) =>
        value ? (
          <Tag color={isExpired(String(value)) ? "default" : "green"}>
            {dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss")}
          </Tag>
        ) : (
          <Tag color="blue">长期有效</Tag>
        ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      width: 180,
      sorter: true,
      hideInSearch: true,
      render: (value) => dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss"),
    },
  ];

  return (
    <PageScaffold title="在线用户" description="查看当前有效会话并执行强制下线">
      <AdminDataTable
        api="/api/system/online/user"
        accessName="system.onlineUser"
        rowKey="id"
        columns={columns}
        enableCreate={false}
        enableUpdate={false}
        enableDelete={false}
        defaultPageSize={20}
        tableMode="bounded"
        toolbarTitle="会话列表"
        actionBarRender={() => (
          <AuthButton auth="system.onlineUser.clean">
            <Button
              icon={<ClearOutlined />}
              loading={cleanMutation.isPending}
              onClick={() => {
                Modal.confirm({
                  title: "清理过期会话",
                  content: "确认清理所有已过期 token 会话吗？",
                  okText: "清理",
                  cancelText: "取消",
                  onOk: () => cleanMutation.mutateAsync(),
                });
              }}
            >
              清理过期会话
            </Button>
          </AuthButton>
        )}
        operateRender={(record) => (
          <AuthButton auth="system.onlineUser.kick">
            <Tooltip title="强制下线">
              <Button
                danger
                size="small"
                icon={<DisconnectOutlined />}
                loading={kickMutation.isPending}
                onClick={(event) => {
                  event.stopPropagation();
                  Modal.confirm({
                    title: "强制下线",
                    content: `确认强制下线 ${record.nickname || record.username} 的该会话吗？`,
                    okText: "强制下线",
                    okButtonProps: { danger: true },
                    cancelText: "取消",
                    onOk: () => kickMutation.mutateAsync(record.id),
                  });
                }}
              />
            </Tooltip>
          </AuthButton>
        )}
        tableProps={{ size: "small", scroll: { x: 1380 } }}
      />
    </PageScaffold>
  );
}
