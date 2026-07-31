"use client";

import {
  CodeOutlined,
  CopyOutlined,
  ClearOutlined,
  DownloadOutlined,
  EyeOutlined,
  LinkOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, DatePicker, Descriptions, Drawer, Modal, Select, Space, Tag, Tooltip, Typography } from "antd";
import { useMemo, useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { getAuthToken } from "@/lib/auth-token";
import { request } from "@/lib/request";
import { useNavigationAdapter } from "@/platform/navigation";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type OperationLogRecord = {
  id: number;
  userId?: number | null;
  username?: string | null;
  module: string;
  action: string;
  resource?: string | null;
  resourceId?: string | null;
  method: string;
  path: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  status: number;
  success: boolean;
  riskLevel: "low" | "medium" | "high" | "critical";
  message?: string | null;
  durationMs?: number | null;
  detailsJson?: string | null;
  createdAt: string;
};

const moduleOptions = [
  { label: "用户管理", value: "system.user" },
  { label: "角色管理", value: "system.role" },
  { label: "菜单权限", value: "system.rule" },
  { label: "部门管理", value: "system.dept" },
  { label: "字典管理", value: "system.dict" },
  { label: "系统配置", value: "system.config" },
  { label: "文件管理", value: "system.file" },
  { label: "存储配置", value: "system.storage" },
  { label: "邮件配置", value: "system.mail" },
  { label: "认证会话", value: "system.auth" },
  { label: "登录日志", value: "system.loginLog" },
  { label: "在线用户", value: "system.onlineUser" },
  { label: "个人中心", value: "profile" },
  { label: "通知公告", value: "system.notice" },
];

const actionOptions = [
  { label: "新增", value: "create" },
  { label: "编辑", value: "update" },
  { label: "删除", value: "delete" },
  { label: "批量删除", value: "batchDelete" },
  { label: "恢复", value: "restore" },
  { label: "彻底删除", value: "forceDelete" },
  { label: "状态切换", value: "status" },
  { label: "设为默认", value: "setDefault" },
  { label: "测试", value: "test" },
  { label: "分配权限", value: "setRule" },
  { label: "保存配置", value: "save" },
  { label: "显隐切换", value: "hidden" },
  { label: "登录", value: "login" },
  { label: "退出", value: "logout" },
  { label: "忘记密码", value: "forgotPassword" },
  { label: "重置密码", value: "resetPassword" },
  { label: "清理", value: "clean" },
  { label: "强制下线", value: "kick" },
  { label: "发布", value: "publish" },
  { label: "撤回", value: "revoke" },
  { label: "修改密码", value: "changePassword" },
  { label: "上传头像", value: "uploadAvatar" },
];

const riskOptions = [
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
  { label: "严重", value: "critical" },
];

const riskColors: Record<OperationLogRecord["riskLevel"], string> = {
  low: "default",
  medium: "blue",
  high: "orange",
  critical: "red",
};

const methodColors: Record<string, string> = {
  GET: "blue",
  POST: "green",
  PUT: "gold",
  DELETE: "red",
};

function formatJson(value?: string | null) {
  if (!value) return "";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export function OperationLogPage() {
  const navigation = useNavigationAdapter();
  const queryClient = useQueryClient();
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeLog, setActiveLog] = useState<OperationLogRecord | null>(null);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [cleanForm, setCleanForm] = useState<{
    before?: string;
    module?: string;
    riskLevel?: OperationLogRecord["riskLevel"];
    success?: boolean;
  }>({});
  const activeJson = useMemo(() => formatJson(activeLog?.detailsJson), [activeLog]);

  const cleanMutation = useMutation({
    mutationFn: () =>
      request("/api/system/operation/log/clean", {
        method: "DELETE",
        body: cleanForm,
      }),
    onSuccess: async () => {
      feedback.success("清理成功");
      setCleanOpen(false);
      setCleanForm({});
      await queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/operation/log"] });
    },
  });

  async function copyText(value: string, label: string) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    feedback.success(`${label}已复制`);
  }

  function traceRequestId(requestId?: string | null) {
    if (!requestId) return;
    const params = new URLSearchParams(navigation.search);
    params.set("page", "1");
    params.set("requestId", requestId);
    navigation.replace(`${navigation.pathname}?${params.toString()}`);
  }

  async function exportLogs() {
    const token = getAuthToken();
    const response = await fetch(`/api/system/operation/log/export${navigation.search || ""}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      feedback.error("导出失败");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `operation-log-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const columns: AdminDataTableColumn<OperationLogRecord>[] = [
    {
      title: "ID",
      dataIndex: "id",
      hideInForm: true,
      hideInSearch: true,
      width: 80,
      sorter: true,
      fixed: "left",
    },
    {
      title: "结果",
      dataIndex: "success",
      valueType: "select",
      options: [
        { label: "成功", value: true },
        { label: "失败", value: false },
      ],
      width: 92,
      fixed: "left",
      render: (value) =>
        value ? <Badge status="success" text="成功" /> : <Badge status="error" text="失败" />,
    },
    {
      title: "模块",
      dataIndex: "module",
      valueType: "select",
      options: moduleOptions,
      width: 128,
      fixed: "left",
      render: (value) => <Tag color="blue">{String(value)}</Tag>,
    },
    {
      title: "风险",
      dataIndex: "riskLevel",
      valueType: "select",
      options: riskOptions,
      width: 88,
      render: (value) => (
        <Tag color={riskColors[String(value) as OperationLogRecord["riskLevel"]] ?? "default"}>
          {riskOptions.find((item) => item.value === value)?.label ?? String(value)}
        </Tag>
      ),
    },
    {
      title: "动作",
      dataIndex: "action",
      valueType: "select",
      options: actionOptions,
      width: 112,
      render: (value) => <Tag color="purple">{String(value)}</Tag>,
    },
    {
      title: "操作人",
      dataIndex: "username",
      width: 120,
      render: (value, record) => (
        <Typography.Text>
          {value ? `${value}${record.userId ? ` #${record.userId}` : ""}` : "-"}
        </Typography.Text>
      ),
    },
    {
      title: "请求",
      dataIndex: "path",
      width: 260,
      ellipsis: true,
      render: (value, record) => (
        <Typography.Text code>
          <Tag color={methodColors[record.method] ?? "default"}>{record.method}</Tag>
          {String(value)}
        </Typography.Text>
      ),
    },
    {
      title: "状态码",
      dataIndex: "status",
      valueType: "digit",
      width: 96,
      render: (value) => <Tag color={Number(value) >= 400 ? "red" : "green"}>{String(value)}</Tag>,
    },
    {
      title: "资源",
      dataIndex: "resource",
      width: 160,
      ellipsis: true,
      render: (value, record) => (
        <Typography.Text type="secondary">
          {value ? `${value}${record.resourceId ? ` #${record.resourceId}` : ""}` : "-"}
        </Typography.Text>
      ),
    },
    { title: "IP", dataIndex: "ip", width: 132 },
    {
      title: "耗时",
      dataIndex: "durationMs",
      hideInSearch: true,
      width: 96,
      sorter: true,
      render: (value) => (value == null ? "-" : `${value}ms`),
    },
    {
      title: "Request ID",
      dataIndex: "requestId",
      width: 224,
      ellipsis: true,
      render: (value) => {
        const requestId = String(value || "");
        if (!requestId) return "-";
        return (
          <Space size={4}>
            <Typography.Text code ellipsis style={{ maxWidth: 116 }}>
              {requestId}
            </Typography.Text>
            <Tooltip title="复制 Request ID">
              <Button
                aria-label="复制 Request ID"
                size="small"
                icon={<CopyOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  void copyText(requestId, "Request ID");
                }}
              />
            </Tooltip>
            <Tooltip title="按 Request ID 追踪">
              <Button
                aria-label="按 Request ID 追踪"
                size="small"
                icon={<SearchOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  traceRequestId(requestId);
                }}
              />
            </Tooltip>
          </Space>
        );
      },
    },
    {
      title: "错误信息",
      dataIndex: "message",
      hideInSearch: true,
      width: 220,
      ellipsis: true,
      render: (value) =>
        value ? <Typography.Text type="danger">{String(value)}</Typography.Text> : "-",
    },
    {
      title: "详情",
      dataIndex: "detailsJson",
      hideInSearch: true,
      width: 160,
      render: (value, record) =>
        value ? (
          <Button
            size="small"
            icon={<CodeOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              setActiveLog(record);
              setDetailOpen(true);
            }}
          >
            查看 JSON
          </Button>
        ) : (
          "-"
        ),
    },
    {
      title: "User-Agent",
      dataIndex: "userAgent",
      hideInSearch: true,
      hideInTable: true,
      valueType: "textarea",
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      valueType: "dateRange",
      width: 180,
      sorter: true,
    },
  ];

  return (
    <PageScaffold title="操作日志" description="追踪后台管理动作、失败结果和请求上下文">
      <AdminDataTable
        api="/api/system/operation/log"
        accessName="system.operationLog"
        rowKey="id"
        columns={columns}
        enableCreate={false}
        enableUpdate={false}
        enableDelete={false}
        defaultPageSize={20}
        tableMode="bounded"
        actionColumnWidth={124}
        toolbarTitle="审计事件"
        actionBarRender={() => (
          <Space>
            <AuthButton auth="system.operationLog.export">
              <Button icon={<DownloadOutlined />} onClick={() => void exportLogs()}>
                导出
              </Button>
            </AuthButton>
            <AuthButton auth="system.operationLog.clean">
              <Button danger icon={<ClearOutlined />} onClick={() => setCleanOpen(true)}>
                清理
              </Button>
            </AuthButton>
          </Space>
        )}
        operateRender={(record) => (
          <>
            <Tooltip title="查看详情">
              <Button
                aria-label="查看详情"
                size="small"
                icon={<EyeOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveLog(record);
                  setDetailOpen(true);
                }}
              />
            </Tooltip>
            {record.requestId ? (
              <Tooltip title="复制追踪链接">
                <Button
                  aria-label="复制追踪链接"
                  size="small"
                  icon={<LinkOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    const params = new URLSearchParams(navigation.search);
                    params.set("page", "1");
                    params.set("requestId", String(record.requestId));
                    void copyText(
                      `${window.location.origin}${navigation.pathname}?${params.toString()}`,
                      "追踪链接",
                    );
                  }}
                />
              </Tooltip>
            ) : null}
          </>
        )}
        tableProps={{
          size: "small",
          scroll: { x: 1600 },
        }}
      />
      <Drawer
        title="操作日志详情"
        size={720}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        extra={
          <Space>
            {activeLog?.requestId ? (
              <>
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => void copyText(activeLog.requestId || "", "Request ID")}
                >
                  复制 Request ID
                </Button>
                <Button
                  icon={<SearchOutlined />}
                  onClick={() => traceRequestId(activeLog.requestId)}
                >
                  追踪同请求
                </Button>
              </>
            ) : null}
          </Space>
        }
      >
        {activeLog ? (
          <Space orientation="vertical" size={20} style={{ width: "100%" }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="结果">
                {activeLog.success ? (
                  <Badge status="success" text="成功" />
                ) : (
                  <Badge status="error" text="失败" />
                )}
              </Descriptions.Item>
              <Descriptions.Item label="状态码">{activeLog.status}</Descriptions.Item>
              <Descriptions.Item label="模块">
                <Tag color="blue">{activeLog.module}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="动作">
                <Tag color="purple">{activeLog.action}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="风险等级">
                <Tag color={riskColors[activeLog.riskLevel]}>{activeLog.riskLevel}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="操作人">
                {activeLog.username ? `${activeLog.username} #${activeLog.userId ?? "-"}` : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="耗时">
                {activeLog.durationMs == null ? "-" : `${activeLog.durationMs}ms`}
              </Descriptions.Item>
              <Descriptions.Item label="请求" span={2}>
                <Typography.Text code>
                  {activeLog.method} {activeLog.path}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Request ID" span={2}>
                {activeLog.requestId ? (
                  <Typography.Text code>{activeLog.requestId}</Typography.Text>
                ) : (
                  "-"
                )}
              </Descriptions.Item>
              <Descriptions.Item label="IP">{activeLog.ip || "-"}</Descriptions.Item>
              <Descriptions.Item label="资源">
                {activeLog.resource
                  ? `${activeLog.resource}${activeLog.resourceId ? ` #${activeLog.resourceId}` : ""}`
                  : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="User-Agent" span={2}>
                {activeLog.userAgent || "-"}
              </Descriptions.Item>
              <Descriptions.Item label="错误信息" span={2}>
                {activeLog.message ? (
                  <Typography.Text type="danger">{activeLog.message}</Typography.Text>
                ) : (
                  "-"
                )}
              </Descriptions.Item>
            </Descriptions>

            <div>
              <Space style={{ marginBottom: 8 }}>
                <Typography.Text strong>详情 JSON</Typography.Text>
                {activeJson ? (
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => void copyText(activeJson, "详情 JSON")}
                  >
                    复制 JSON
                  </Button>
                ) : null}
              </Space>
              <pre
                style={{
                  margin: 0,
                  padding: 16,
                  borderRadius: 8,
                  background: "#111827",
                  color: "#e5e7eb",
                  maxHeight: 360,
                  overflow: "auto",
                  fontSize: 12,
                  lineHeight: 1.7,
                }}
              >
                {activeJson || "无详情"}
              </pre>
            </div>
          </Space>
        ) : null}
      </Drawer>
      <Modal
        title="清理操作日志"
        open={cleanOpen}
        okText="确认清理"
        okButtonProps={{ danger: true }}
        confirmLoading={cleanMutation.isPending}
        onOk={() => {
          if (!cleanForm.before && !cleanForm.module && !cleanForm.riskLevel && cleanForm.success === undefined) {
            feedback.warning("请选择至少一个清理条件");
            return;
          }
          void cleanMutation.mutateAsync();
        }}
        onCancel={() => setCleanOpen(false)}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text type="secondary">
            清理动作会记录为 critical 操作日志。建议至少选择时间或模块条件。
          </Typography.Text>
          <DatePicker
            showTime
            style={{ width: "100%" }}
            placeholder="清理该时间之前的日志"
            onChange={(value) =>
              setCleanForm((current) => ({ ...current, before: value?.toISOString() }))
            }
          />
          <Select
            allowClear
            placeholder="模块"
            options={moduleOptions}
            style={{ width: "100%" }}
            value={cleanForm.module}
            onChange={(value) => setCleanForm((current) => ({ ...current, module: value }))}
          />
          <Select
            allowClear
            placeholder="风险等级"
            options={riskOptions}
            style={{ width: "100%" }}
            value={cleanForm.riskLevel}
            onChange={(value) => setCleanForm((current) => ({ ...current, riskLevel: value }))}
          />
          <Select
            allowClear
            placeholder="执行结果"
            options={[
              { label: "成功", value: true },
              { label: "失败", value: false },
            ]}
            style={{ width: "100%" }}
            value={cleanForm.success}
            onChange={(value) => setCleanForm((current) => ({ ...current, success: value }))}
          />
        </Space>
      </Modal>
    </PageScaffold>
  );
}
