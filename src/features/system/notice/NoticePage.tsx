"use client";

import {
  ClockCircleOutlined,
  BarChartOutlined,
  NotificationOutlined,
  PauseCircleOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Button, Drawer, Input, Select, Space, Statistic, Table, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { richTextToPlainText } from "@/lib/rich-text";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type NoticeRecord = {
  id: number;
  title: string;
  content: string;
  type: "notice" | "announcement";
  scope: "all" | "users" | "roles" | "depts";
  targetUserIds?: number[];
  targetRoleIds?: number[];
  targetDeptIds?: number[];
  priority: number;
  pinned: boolean;
  status: number;
  publishedAt?: string | null;
  expiredAt?: string | null;
  createdAt: string;
};

type UserOptionRecord = {
  id: number;
  username: string;
  nickname: string;
};

type RoleOptionRecord = {
  id: number;
  name: string;
  code: string;
};

type DeptOptionRecord = {
  id: number;
  name: string;
  code?: string | null;
};

type NoticeReadStats = {
  targetTotal: number;
  readTotal: number;
  unreadTotal: number;
};

type NoticeReadUser = {
  userId: number;
  username: string;
  nickname: string;
  deptName?: string | null;
  readAt?: string | null;
  readStatus: "read" | "unread";
};

const typeOptions = [
  { label: "通知", value: "notice" },
  { label: "公告", value: "announcement" },
];

const scopeOptions = [
  { label: "全部用户", value: "all" },
  { label: "指定用户", value: "users" },
  { label: "指定角色", value: "roles" },
  { label: "指定部门", value: "depts" },
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
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsNotice, setStatsNotice] = useState<NoticeRecord | null>(null);
  const [readUserPage, setReadUserPage] = useState(1);
  const [readUserFilters, setReadUserFilters] = useState({
    readStatus: "",
    username: "",
    dept: "",
  });
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
  const roleOptionsQuery = useQuery({
    queryKey: ["notice", "role-options"],
    queryFn: async () => {
      const page = await request<PageResult<RoleOptionRecord>>(
        `/api/system/role${buildQueryString({ page: 1, pageSize: 200 })}`,
        { silent: true },
      );
      return page.data.map<FieldOption>((item) => ({
        label: `${item.name} (${item.code})`,
        value: item.id,
      }));
    },
    staleTime: 5 * 60_000,
  });
  const deptOptionsQuery = useQuery({
    queryKey: ["notice", "dept-options"],
    queryFn: async () => {
      const page = await request<PageResult<DeptOptionRecord>>(
        `/api/system/dept${buildQueryString({ page: 1, pageSize: 200 })}`,
        { silent: true },
      );
      return page.data.map<FieldOption>((item) => ({
        label: `${item.name}${item.code ? ` (${item.code})` : ""}`,
        value: item.id,
      }));
    },
    staleTime: 5 * 60_000,
  });
  const statsQuery = useQuery({
    queryKey: ["notice", "read-stats", statsNotice?.id],
    queryFn: () => request<NoticeReadStats>(`/api/system/notice/${statsNotice?.id}/read-stats`),
    enabled: Boolean(statsNotice?.id && statsOpen),
  });
  const readUsersQuery = useQuery({
    queryKey: ["notice", "read-users", statsNotice?.id, readUserPage, readUserFilters],
    queryFn: () =>
      request<PageResult<NoticeReadUser>>(
        `/api/system/notice/${statsNotice?.id}/read-users${buildQueryString({
          page: readUserPage,
          pageSize: 10,
          ...readUserFilters,
        })}`,
      ),
    enabled: Boolean(statsNotice?.id && statsOpen),
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
      valueType: "richText",
      required: true,
      width: 320,
      ellipsis: true,
      fullWidth: true,
      fieldProps: {
        minHeight: 240,
        placeholder: "请输入公告正文",
      },
      render: (value) => (
        <Typography.Text type="secondary" ellipsis style={{ maxWidth: 300 }}>
          {richTextToPlainText(value) || "图片内容"}
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
          {value === "all"
            ? "全部用户"
            : value === "users"
              ? `指定用户 ${record.targetUserIds?.length ?? 0}`
              : value === "roles"
                ? `指定角色 ${record.targetRoleIds?.length ?? 0}`
                : `指定部门 ${record.targetDeptIds?.length ?? 0}`}
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
      title: "指定角色",
      dataIndex: "targetRoleIds",
      valueType: "select",
      options: roleOptionsQuery.data ?? [],
      hideInTable: true,
      hideInSearch: true,
      fieldProps: {
        mode: "multiple",
        loading: roleOptionsQuery.isFetching,
      },
    },
    {
      title: "指定部门",
      dataIndex: "targetDeptIds",
      valueType: "select",
      options: deptOptionsQuery.data ?? [],
      hideInTable: true,
      hideInSearch: true,
      fieldProps: {
        mode: "multiple",
        loading: deptOptionsQuery.isFetching,
      },
    },
    {
      title: "置顶",
      dataIndex: "pinned",
      valueType: "switch",
      width: 80,
      render: (value) => (value ? <Tag color="gold">置顶</Tag> : "-"),
    },
    {
      title: "优先级",
      dataIndex: "priority",
      valueType: "digit",
      width: 90,
      render: (value) => <Tag>{Number(value ?? 0)}</Tag>,
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
      title: "过期时间",
      dataIndex: "expiredAt",
      valueType: "datetime",
      width: 180,
      hideInSearch: true,
      formHelp: "为空时长期有效；过期后消息中心不再展示。",
      fieldProps: {
        allowClear: true,
        format: "YYYY-MM-DD HH:mm:ss",
        showTime: { format: "HH:mm:ss" },
        placeholder: "长期有效或选择过期时间",
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
          expiredAt: normalizeDateTime(values.expiredAt),
          targetUserIds: Array.isArray(values.targetUserIds)
            ? values.targetUserIds.map(Number)
            : [],
          targetRoleIds: Array.isArray(values.targetRoleIds)
            ? values.targetRoleIds.map(Number)
            : [],
          targetDeptIds: Array.isArray(values.targetDeptIds)
            ? values.targetDeptIds.map(Number)
            : [],
        })}
        onDataChanged={invalidateNoticeData}
        operateRender={(record) => (
          <>
            <Tooltip title="阅读统计">
              <Button
                size="small"
                icon={<BarChartOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  setStatsNotice(record);
                  setReadUserPage(1);
                  setReadUserFilters({ readStatus: "", username: "", dept: "" });
                  setStatsOpen(true);
                }}
              />
            </Tooltip>
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
      <Drawer
        title={statsNotice ? `阅读统计：${statsNotice.title}` : "阅读统计"}
        open={statsOpen}
        width={760}
        onClose={() => setStatsOpen(false)}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space size={24}>
            <Statistic title="目标人数" value={statsQuery.data?.targetTotal ?? 0} loading={statsQuery.isFetching} />
            <Statistic title="已读人数" value={statsQuery.data?.readTotal ?? 0} loading={statsQuery.isFetching} />
            <Statistic title="未读人数" value={statsQuery.data?.unreadTotal ?? 0} loading={statsQuery.isFetching} />
          </Space>
          <Space wrap>
            <Select
              allowClear
              placeholder="阅读状态"
              style={{ width: 140 }}
              value={readUserFilters.readStatus || undefined}
              options={[
                { label: "已读", value: "read" },
                { label: "未读", value: "unread" },
              ]}
              onChange={(value) => {
                setReadUserPage(1);
                setReadUserFilters((current) => ({ ...current, readStatus: value ?? "" }));
              }}
            />
            <Input.Search
              allowClear
              placeholder="用户名/昵称"
              style={{ width: 180 }}
              value={readUserFilters.username}
              onChange={(event) =>
                setReadUserFilters((current) => ({ ...current, username: event.target.value }))
              }
              onSearch={(value) => {
                setReadUserPage(1);
                setReadUserFilters((current) => ({ ...current, username: value }));
              }}
            />
            <Input.Search
              allowClear
              placeholder="部门"
              style={{ width: 180 }}
              value={readUserFilters.dept}
              onChange={(event) =>
                setReadUserFilters((current) => ({ ...current, dept: event.target.value }))
              }
              onSearch={(value) => {
                setReadUserPage(1);
                setReadUserFilters((current) => ({ ...current, dept: value }));
              }}
            />
          </Space>
          <Table<NoticeReadUser>
            rowKey="userId"
            size="small"
            loading={readUsersQuery.isFetching}
            dataSource={readUsersQuery.data?.data ?? []}
            pagination={{
              current: readUsersQuery.data?.page ?? readUserPage,
              pageSize: readUsersQuery.data?.pageSize ?? 10,
              total: readUsersQuery.data?.total ?? 0,
              onChange: (page) => setReadUserPage(page),
            }}
            columns={[
              {
                title: "用户",
                dataIndex: "username",
                render: (_, record) => (
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{record.nickname || record.username}</Typography.Text>
                    <Typography.Text type="secondary">{record.username}</Typography.Text>
                  </Space>
                ),
              },
              { title: "部门", dataIndex: "deptName", width: 160, render: (value) => value || "-" },
              {
                title: "状态",
                dataIndex: "readStatus",
                width: 96,
                render: (value) =>
                  value === "read" ? <Tag color="success">已读</Tag> : <Tag>未读</Tag>,
              },
              {
                title: "读取时间",
                dataIndex: "readAt",
                width: 180,
                render: (value) => (value ? dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss") : "-"),
              },
            ]}
          />
        </Space>
      </Drawer>
    </PageScaffold>
  );
}
