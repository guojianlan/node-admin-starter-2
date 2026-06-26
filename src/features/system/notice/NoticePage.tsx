"use client";

import {
  ClockCircleOutlined,
  NotificationOutlined,
  PauseCircleOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Button, Space, Tag, Tooltip, Typography } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type NoticeRecord = {
  id: number;
  title: string;
  content: string;
  type: "notice" | "announcement";
  scope: "all" | "users";
  targetUserIds?: number[];
  status: number;
  publishedAt?: string | null;
  createdAt: string;
};

type UserOptionRecord = {
  id: number;
  username: string;
  nickname: string;
};

const typeOptions = [
  { label: "通知", value: "notice" },
  { label: "公告", value: "announcement" },
];

const scopeOptions = [
  { label: "全部用户", value: "all" },
  { label: "指定用户", value: "users" },
];

const statusOptions = [
  { label: "草稿", value: 0 },
  { label: "发布/定时发布", value: 1 },
];

function normalizeDateTime(value: unknown) {
  if (!value) return null;
  if (dayjs.isDayjs(value)) return value.toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function getNoticeStatus(record: Pick<NoticeRecord, "publishedAt" | "status">) {
  if (record.status !== 1) return "draft";
  if (record.publishedAt && dayjs(record.publishedAt).isAfter(dayjs())) return "scheduled";
  return "published";
}

export function NoticePage() {
  const queryClient = useQueryClient();
  const userOptionsQuery = useQuery({
    queryKey: ["notice", "user-options"],
    queryFn: async () => {
      const page = await request<PageResult<UserOptionRecord>>(
        `/api/system/user${buildQueryString({ page: 1, pageSize: 200 })}`,
        { silent: true },
      );
      return page.data.map<FieldOption>((item) => ({
        label: `${item.nickname || item.username} (${item.username})`,
        value: item.id,
      }));
    },
    staleTime: 5 * 60_000,
  });

  const invalidateNoticeData = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/notice"] });
    void queryClient.invalidateQueries({ queryKey: ["notice"] });
  };

  const publishMutation = useMutation({
    mutationFn: (id: number) =>
      request(`/api/system/notice/publish/${id}`, { method: "PUT", body: {} }),
    onSuccess: () => {
      feedback.success("发布成功");
      invalidateNoticeData();
    },
  });
  const revokeMutation = useMutation({
    mutationFn: (id: number) =>
      request(`/api/system/notice/revoke/${id}`, { method: "PUT", body: {} }),
    onSuccess: () => {
      feedback.success("撤回成功");
      invalidateNoticeData();
    },
  });

  const columns: AdminDataTableColumn<NoticeRecord>[] = [
    { title: "ID", dataIndex: "id", width: 80, sorter: true, hideInForm: true, hideInSearch: true },
    {
      title: "标题",
      dataIndex: "title",
      required: true,
      width: 220,
      render: (value) => <Typography.Text strong>{String(value)}</Typography.Text>,
    },
    {
      title: "内容",
      dataIndex: "content",
      valueType: "textarea",
      required: true,
      width: 320,
      ellipsis: true,
      fullWidth: true,
      render: (value) => (
        <Typography.Text type="secondary" ellipsis style={{ maxWidth: 300 }}>
          {String(value)}
        </Typography.Text>
      ),
    },
    {
      title: "类型",
      dataIndex: "type",
      valueType: "select",
      options: typeOptions,
      width: 96,
      render: (value) => (
        <Tag color={value === "announcement" ? "orange" : "blue"}>
          {value === "announcement" ? "公告" : "通知"}
        </Tag>
      ),
    },
    {
      title: "范围",
      dataIndex: "scope",
      valueType: "select",
      options: scopeOptions,
      width: 112,
      render: (value, record) => (
        <Tag color={value === "all" ? "green" : "purple"}>
          {value === "all" ? "全部用户" : `指定用户 ${record.targetUserIds?.length ?? 0}`}
        </Tag>
      ),
    },
    {
      title: "指定用户",
      dataIndex: "targetUserIds",
      valueType: "select",
      options: userOptionsQuery.data ?? [],
      hideInTable: true,
      hideInSearch: true,
      fieldProps: {
        mode: "multiple",
        loading: userOptionsQuery.isFetching,
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      width: 108,
      render: (_value, record) => {
        const status = getNoticeStatus(record);
        if (status === "scheduled") {
          return (
            <Tag color="processing" icon={<ClockCircleOutlined />}>
              待发布
            </Tag>
          );
        }
        if (status === "published") return <Tag color="success">已发布</Tag>;
        return <Tag>草稿</Tag>;
      },
    },
    {
      title: "发布时间",
      dataIndex: "publishedAt",
      valueType: "datetime",
      width: 180,
      hideInSearch: true,
      formHelp: "为空时发布会立即生效；选择未来时间并设置为发布后，到点自动在消息中心可见。",
      fieldProps: {
        allowClear: true,
        format: "YYYY-MM-DD HH:mm:ss",
        showTime: { format: "HH:mm:ss" },
        placeholder: "立即发布或选择未来时间",
      },
      formItemProps: {
        getValueProps: (value: unknown) => ({
          value: value ? dayjs(String(value)) : null,
        }),
        normalize: normalizeDateTime,
      },
      render: (value) => (value ? dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss") : "-"),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      valueType: "dateRange",
      width: 180,
      sorter: true,
      hideInForm: true,
      render: (value) => dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss"),
    },
  ];

  return (
    <PageScaffold title="通知公告" description="发布后台公告并维护用户已读状态">
      <AdminDataTable
        api="/api/system/notice"
        accessName="system.notice"
        rowKey="id"
        columns={columns}
        createTitle="新增公告"
        updateTitle="编辑公告"
        toolbarTitle={
          <Space>
            <NotificationOutlined />
            公告列表
          </Space>
        }
        beforeSubmit={(values) => ({
          ...values,
          publishedAt: normalizeDateTime(values.publishedAt),
          targetUserIds: Array.isArray(values.targetUserIds)
            ? values.targetUserIds.map(Number)
            : [],
        })}
        onDataChanged={invalidateNoticeData}
        operateRender={(record) => (
          <>
            {record.status === 1 ? (
              <AuthButton auth="system.notice.revoke">
                <Tooltip title="撤回">
                  <Button
                    size="small"
                    icon={<PauseCircleOutlined />}
                    loading={revokeMutation.isPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      revokeMutation.mutate(record.id);
                    }}
                  />
                </Tooltip>
              </AuthButton>
            ) : (
              <AuthButton auth="system.notice.publish">
                <Tooltip title="发布">
                  <Button
                    type="primary"
                    size="small"
                    icon={<SendOutlined />}
                    loading={publishMutation.isPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      publishMutation.mutate(record.id);
                    }}
                  />
                </Tooltip>
              </AuthButton>
            )}
          </>
        )}
        tableProps={{ size: "small", scroll: { x: 1380 } }}
      />
    </PageScaffold>
  );
}
