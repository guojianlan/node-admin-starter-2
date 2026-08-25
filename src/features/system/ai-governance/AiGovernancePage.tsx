"use client";

import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DollarOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type Option = { id: number; name?: string; nickname?: string; code?: string; username?: string };
type Options = {
  agents: Option[];
  tools: Option[];
  providers: Option[];
  users: Option[];
  departments: Option[];
};
type Memory = {
  id: number;
  scopeType: "user" | "agent";
  agentId?: number;
  agentName?: string;
  content: string;
  writePolicy: string;
  status: string;
  expiresAt?: string;
  updatedAt: string;
};
type Skill = {
  id: number;
  name: string;
  code: string;
  description?: string;
  instructions: string;
  status: number;
  toolIds: number[];
  agentIds: number[];
  isSystem: boolean;
};
type McpServer = {
  id: number;
  name: string;
  code: string;
  endpointUrl: string;
  oauthMode: string;
  status: string;
  hasClientSecret: boolean;
  toolCount: number;
  allowedToolCount: number;
  lastSyncedAt?: string;
  lastError?: string;
};
type McpTool = {
  id: number;
  serverId: number;
  serverName: string;
  remoteName: string;
  displayName: string;
  riskLevel: string;
  approvalRequired: boolean;
  allowlisted: boolean;
  status: number;
  lastSeenAt?: string;
};
type McpConnection = {
  id: number;
  serverName: string;
  userName?: string;
  status: string;
  tokenType?: string;
  scopes?: string;
  expiresAt?: string;
  lastError?: string;
  updatedAt: string;
};
type Circuit = {
  providerId: number;
  providerName: string;
  purpose: string;
  state: string;
  failureThreshold: number;
  cooldownMs: number;
  consecutiveFailures: number;
  nextProbeAt?: string;
  lastErrorType?: string;
};
type Quota = {
  id: number;
  name: string;
  subjectType: string;
  subjectId?: number;
  period: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxCost?: string;
  currency: string;
  status: number;
};
type Job = {
  id: number;
  jobType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  resourceType?: string;
  resourceId?: string;
  errorMessage?: string;
  createdAt: string;
};
type Ledger = {
  id: number;
  invocationId?: number;
  userName?: string;
  purpose: string;
  entryType: string;
  amount: string;
  currency: string;
  status: string;
  source: string;
  description?: string;
  occurredAt: string;
};
type Page<T> = { data: T[]; total: number; page: number; pageSize: number };

const statusColor: Record<string, string> = {
  active: "success",
  connected: "success",
  closed: "success",
  completed: "success",
  draft: "default",
  disabled: "default",
  cancelled: "default",
  archived: "default",
  open: "error",
  error: "error",
  failed: "error",
  half_open: "warning",
  running: "processing",
  queued: "processing",
  pending: "processing",
  expired: "warning",
  revoked: "default",
};

function date(value?: string) {
  return value ? new Date(value).toLocaleString() : "-";
}

function localDateTimeValue(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function AiGovernancePage() {
  const queryClient = useQueryClient();
  const [memoryForm] = Form.useForm();
  const [skillForm] = Form.useForm();
  const [mcpForm] = Form.useForm();
  const [circuitForm] = Form.useForm();
  const [quotaForm] = Form.useForm();
  const [adjustmentForm] = Form.useForm();
  const [settlementForm] = Form.useForm();
  const [memory, setMemory] = useState<Memory | null | undefined>();
  const [skill, setSkill] = useState<Skill | null | undefined>();
  const [mcp, setMcp] = useState<McpServer | null | undefined>();
  const [circuit, setCircuit] = useState<Circuit | undefined>();
  const [quota, setQuota] = useState<Quota | null | undefined>();
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [settlement, setSettlement] = useState<Ledger | undefined>();
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "memory";
    return new URL(window.location.href).searchParams.get("tab") === "mcp" ? "mcp" : "memory";
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("mcpConnected") === "1") feedback.success("MCP OAuth 已连接");
    const error = url.searchParams.get("mcpError");
    if (error) feedback.error(error);
    if (url.searchParams.has("mcpConnected") || error) {
      url.searchParams.delete("mcpConnected");
      url.searchParams.delete("mcpError");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  const options = useQuery({
    queryKey: ["ai-governance-options"],
    queryFn: () => request<Options>("/api/system/ai/governance/options"),
  });
  const memories = useQuery({
    queryKey: ["ai-governance-memories"],
    queryFn: () => request<Memory[]>("/api/system/ai/governance/memories?includeArchived=1"),
  });
  const skills = useQuery({
    queryKey: ["ai-governance-skills"],
    queryFn: () => request<Skill[]>("/api/system/ai/governance/skills"),
  });
  const servers = useQuery({
    queryKey: ["ai-governance-mcp-servers"],
    queryFn: () => request<McpServer[]>("/api/system/ai/governance/mcp/servers"),
  });
  const mcpTools = useQuery({
    queryKey: ["ai-governance-mcp-tools"],
    queryFn: () => request<McpTool[]>("/api/system/ai/governance/mcp/tools"),
  });
  const mcpConnections = useQuery({
    queryKey: ["ai-governance-mcp-connections"],
    queryFn: () => request<McpConnection[]>("/api/system/ai/governance/mcp/connections"),
  });
  const circuits = useQuery({
    queryKey: ["ai-governance-circuits"],
    queryFn: () => request<Circuit[]>("/api/system/ai/governance/circuits"),
  });
  const quotas = useQuery({
    queryKey: ["ai-governance-quotas"],
    queryFn: () => request<Quota[]>("/api/system/ai/governance/quotas"),
  });
  const jobs = useQuery({
    queryKey: ["ai-governance-jobs"],
    queryFn: () => request<Page<Job>>("/api/system/ai/governance/jobs?page=1&pageSize=100"),
  });
  const billing = useQuery({
    queryKey: ["ai-governance-billing"],
    queryFn: () => request<Page<Ledger>>("/api/system/ai/governance/billing?page=1&pageSize=100"),
  });

  const refresh = (...keys: string[]) =>
    Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
  const mutate = useMutation({
    mutationFn: async (input: {
      url: string;
      method?: "POST" | "PUT" | "DELETE";
      body?: BodyInit | Record<string, unknown> | null;
      refresh: string[];
    }) => {
      await request(input.url, { method: input.method ?? "POST", body: input.body });
      return input.refresh;
    },
    onSuccess: async (keys) => {
      await refresh(...keys);
      feedback.success("操作成功");
    },
  });
  const updateMcpToolPolicy = (
    row: McpTool,
    patch: Partial<Pick<McpTool, "allowlisted" | "riskLevel" | "approvalRequired" | "status">>,
  ) =>
    mutate.mutate({
      url: `/api/system/ai/governance/mcp/tools/${row.id}/policy`,
      method: "PUT",
      body: {
        allowlisted: row.allowlisted,
        riskLevel: row.riskLevel,
        approvalRequired: row.approvalRequired,
        status: row.status,
        ...patch,
      },
      refresh: ["ai-governance-mcp-tools", "ai-governance-mcp-servers"],
    });

  const saveMemory = async () => {
    const values = await memoryForm.validateFields();
    if (values.expiresAt) values.expiresAt = new Date(values.expiresAt).toISOString();
    await mutate.mutateAsync({
      url: memory?.id
        ? `/api/system/ai/governance/memories/${memory.id}`
        : "/api/system/ai/governance/memories",
      method: memory?.id ? "PUT" : "POST",
      body: values,
      refresh: ["ai-governance-memories"],
    });
    setMemory(undefined);
  };
  const saveSkill = async () => {
    const values = await skillForm.validateFields();
    await mutate.mutateAsync({
      url: skill?.id
        ? `/api/system/ai/governance/skills/${skill.id}`
        : "/api/system/ai/governance/skills",
      method: skill?.id ? "PUT" : "POST",
      body: values,
      refresh: ["ai-governance-skills"],
    });
    setSkill(undefined);
  };
  const saveMcp = async () => {
    const values = await mcpForm.validateFields();
    await mutate.mutateAsync({
      url: mcp?.id
        ? `/api/system/ai/governance/mcp/servers/${mcp.id}`
        : "/api/system/ai/governance/mcp/servers",
      method: mcp?.id ? "PUT" : "POST",
      body: values,
      refresh: ["ai-governance-mcp-servers"],
    });
    setMcp(undefined);
  };
  const saveQuota = async () => {
    const values = await quotaForm.validateFields();
    await mutate.mutateAsync({
      url: quota?.id
        ? `/api/system/ai/governance/quotas/${quota.id}`
        : "/api/system/ai/governance/quotas",
      method: quota?.id ? "PUT" : "POST",
      body: values,
      refresh: ["ai-governance-quotas"],
    });
    setQuota(undefined);
  };
  const saveCircuit = async () => {
    if (!circuit) return;
    const values = await circuitForm.validateFields();
    await mutate.mutateAsync({
      url: "/api/system/ai/governance/circuits",
      method: "PUT",
      body: { providerId: circuit.providerId, purpose: circuit.purpose, ...values },
      refresh: ["ai-governance-circuits"],
    });
    setCircuit(undefined);
  };
  const saveAdjustment = async () => {
    const values = await adjustmentForm.validateFields();
    await mutate.mutateAsync({
      url: "/api/system/ai/governance/billing/adjustments",
      body: values,
      refresh: ["ai-governance-billing"],
    });
    setAdjustmentOpen(false);
    adjustmentForm.resetFields();
  };
  const saveSettlement = async () => {
    if (!settlement) return;
    const values = await settlementForm.validateFields();
    await mutate.mutateAsync({
      url: `/api/system/ai/governance/billing/${settlement.id}/settlement`,
      method: "PUT",
      body: values,
      refresh: ["ai-governance-billing", "ai-governance-quotas"],
    });
    setSettlement(undefined);
  };

  const memoryTab = (
    <Table
      rowKey="id"
      size="small"
      loading={memories.isLoading}
      dataSource={memories.data ?? []}
      pagination={{ pageSize: 20 }}
      columns={[
        {
          title: "范围",
          width: 130,
          render: (_, row: Memory) => (row.scopeType === "agent" ? row.agentName : "当前用户"),
        },
        { title: "内容", dataIndex: "content", ellipsis: true },
        {
          title: "写入",
          dataIndex: "writePolicy",
          width: 90,
          render: (value) => <Tag>{value}</Tag>,
        },
        {
          title: "状态",
          dataIndex: "status",
          width: 90,
          render: (value) => <Tag color={statusColor[value]}>{value}</Tag>,
        },
        { title: "更新时间", dataIndex: "updatedAt", width: 170, render: date },
        {
          title: (
            <AuthButton auth="system.aiGovernance.update">
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setMemory(null);
                  memoryForm.resetFields();
                  memoryForm.setFieldsValue({
                    scopeType: "user",
                    writePolicy: "manual",
                    status: "active",
                  });
                }}
              >
                新建
              </Button>
            </AuthButton>
          ),
          width: 130,
          fixed: "right",
          render: (_, row: Memory) => (
            <Space size={4}>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setMemory(row);
                  memoryForm.setFieldsValue({
                    ...row,
                    expiresAt: localDateTimeValue(row.expiresAt),
                  });
                }}
              />
              <Popconfirm
                title="删除 Memory？"
                onConfirm={() =>
                  mutate.mutate({
                    url: `/api/system/ai/governance/memories/${row.id}`,
                    method: "DELETE",
                    refresh: ["ai-governance-memories"],
                  })
                }
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          ),
        },
      ]}
    />
  );

  const skillTab = (
    <Table
      rowKey="id"
      size="small"
      loading={skills.isLoading}
      dataSource={skills.data ?? []}
      pagination={{ pageSize: 20 }}
      columns={[
        {
          title: "Skill",
          render: (_, row: Skill) => (
            <Space orientation="vertical" size={0}>
              <Typography.Text strong>{row.name}</Typography.Text>
              <Typography.Text type="secondary">{row.code}</Typography.Text>
            </Space>
          ),
        },
        { title: "指令", dataIndex: "instructions", ellipsis: true },
        {
          title: "工具",
          dataIndex: "toolIds",
          width: 80,
          render: (value: number[]) => value.length,
        },
        {
          title: "Agent",
          dataIndex: "agentIds",
          width: 80,
          render: (value: number[]) => value.length,
        },
        {
          title: "状态",
          dataIndex: "status",
          width: 80,
          render: (value) => (
            <Tag color={value ? "success" : "default"}>{value ? "启用" : "停用"}</Tag>
          ),
        },
        {
          title: (
            <AuthButton auth="system.aiGovernance.update">
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setSkill(null);
                  skillForm.resetFields();
                  skillForm.setFieldsValue({ status: 1, sort: 0, toolIds: [], agentIds: [] });
                }}
              >
                新建
              </Button>
            </AuthButton>
          ),
          width: 130,
          fixed: "right",
          render: (_, row: Skill) => (
            <Space size={4}>
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setSkill(row);
                  skillForm.setFieldsValue(row);
                }}
                disabled={row.isSystem}
              />
              <Popconfirm
                title="删除 Skill？"
                onConfirm={() =>
                  mutate.mutate({
                    url: `/api/system/ai/governance/skills/${row.id}`,
                    method: "DELETE",
                    refresh: ["ai-governance-skills"],
                  })
                }
              >
                <Button size="small" danger icon={<DeleteOutlined />} disabled={row.isSystem} />
              </Popconfirm>
            </Space>
          ),
        },
      ]}
    />
  );

  const mcpTab = (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        showIcon
        type="warning"
        title="MCP 默认不可信"
        description="仅支持受控 HTTPS 远程 Server。同步 Tool 后仍需逐项进入 allowlist；高风险 Tool 保持人工审批。"
      />
      <Table
        title={() => <Typography.Text strong>MCP Server</Typography.Text>}
        rowKey="id"
        size="small"
        loading={servers.isLoading}
        dataSource={servers.data ?? []}
        pagination={false}
        columns={[
          {
            title: "Server",
            render: (_, row: McpServer) => (
              <Space orientation="vertical" size={0}>
                <Typography.Text strong>{row.name}</Typography.Text>
                <Typography.Text type="secondary">{row.code}</Typography.Text>
              </Space>
            ),
          },
          { title: "Endpoint", dataIndex: "endpointUrl", ellipsis: true },
          { title: "OAuth", dataIndex: "oauthMode", width: 150 },
          {
            title: "Tool",
            width: 100,
            render: (_, row: McpServer) => `${row.allowedToolCount}/${row.toolCount}`,
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 90,
            render: (value) => <Tag color={statusColor[value]}>{value}</Tag>,
          },
          {
            title: (
              <AuthButton auth="system.aiGovernance.update">
                <Button
                  size="small"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setMcp(null);
                    mcpForm.resetFields();
                    mcpForm.setFieldsValue({
                      transport: "streamable_http",
                      oauthMode: "none",
                      status: "draft",
                    });
                  }}
                >
                  新建
                </Button>
              </AuthButton>
            ),
            width: 250,
            fixed: "right",
            render: (_, row: McpServer) => (
              <Space size={4}>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setMcp(row);
                    mcpForm.setFieldsValue(row);
                  }}
                />
                <AuthButton auth="system.aiGovernance.execute">
                  <Button
                    size="small"
                    icon={<LinkOutlined />}
                    onClick={async () => {
                      const result = await request<{ authorizationUrl?: string }>(
                        `/api/system/ai/governance/mcp/servers/${row.id}/connect`,
                        { method: "POST" },
                      );
                      if (result.authorizationUrl) window.location.href = result.authorizationUrl;
                      else feedback.success("连接成功");
                    }}
                  />
                </AuthButton>
                <AuthButton auth="system.aiGovernance.execute">
                  <Button
                    size="small"
                    icon={<SyncOutlined />}
                    onClick={() =>
                      mutate.mutate({
                        url: `/api/system/ai/governance/mcp/servers/${row.id}/sync`,
                        refresh: ["ai-governance-mcp-servers", "ai-governance-mcp-tools"],
                      })
                    }
                  />
                </AuthButton>
                <AuthButton auth="system.aiGovernance.update">
                  <Popconfirm
                    title="删除 MCP Server？"
                    description="关联连接会失效，已同步的 Tool 会停用。"
                    onConfirm={() =>
                      mutate.mutate({
                        url: `/api/system/ai/governance/mcp/servers/${row.id}`,
                        method: "DELETE",
                        refresh: [
                          "ai-governance-mcp-servers",
                          "ai-governance-mcp-tools",
                          "ai-governance-mcp-connections",
                        ],
                      })
                    }
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </AuthButton>
              </Space>
            ),
          },
        ]}
      />
      <Table
        title={() => <Typography.Text strong>OAuth 连接</Typography.Text>}
        rowKey="id"
        size="small"
        loading={mcpConnections.isLoading}
        dataSource={mcpConnections.data ?? []}
        pagination={{ pageSize: 10 }}
        columns={[
          { title: "连接", dataIndex: "id", width: 80, render: (value) => `#${value}` },
          { title: "Server", dataIndex: "serverName" },
          { title: "用户", dataIndex: "userName", render: (value) => value || "系统连接" },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (value) => <Tag color={statusColor[value]}>{value}</Tag>,
          },
          { title: "过期时间", dataIndex: "expiresAt", width: 170, render: date },
          { title: "错误", dataIndex: "lastError", ellipsis: true },
          {
            title: "操作",
            width: 90,
            render: (_, row: McpConnection) => (
              <AuthButton auth="system.aiGovernance.execute">
                <Popconfirm
                  title="断开 MCP 连接？"
                  onConfirm={() =>
                    mutate.mutate({
                      url: `/api/system/ai/governance/mcp/connections/${row.id}`,
                      method: "DELETE",
                      refresh: ["ai-governance-mcp-connections"],
                    })
                  }
                >
                  <Button
                    size="small"
                    danger
                    disabled={row.status === "revoked"}
                    icon={<DeleteOutlined />}
                  />
                </Popconfirm>
              </AuthButton>
            ),
          },
        ]}
      />
      <Table
        title={() => <Typography.Text strong>Tool 策略</Typography.Text>}
        rowKey="id"
        size="small"
        loading={mcpTools.isLoading}
        dataSource={mcpTools.data ?? []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "Server", dataIndex: "serverName", width: 150 },
          {
            title: "Tool",
            render: (_, row: McpTool) => (
              <Space orientation="vertical" size={0}>
                <Typography.Text>{row.displayName}</Typography.Text>
                <Typography.Text type="secondary">{row.remoteName}</Typography.Text>
              </Space>
            ),
          },
          {
            title: "风险",
            dataIndex: "riskLevel",
            width: 100,
            render: (value, row: McpTool) => (
              <AuthButton auth="system.aiGovernance.approve" fallback={<Tag>{value}</Tag>}>
                <Select
                  size="small"
                  value={value}
                  style={{ width: 92 }}
                  options={["low", "medium", "high", "critical"].map((item) => ({
                    value: item,
                    label: item,
                  }))}
                  onChange={(riskLevel) => updateMcpToolPolicy(row, { riskLevel })}
                />
              </AuthButton>
            ),
          },
          {
            title: "审批",
            dataIndex: "approvalRequired",
            width: 80,
            render: (value, row: McpTool) => (
              <AuthButton auth="system.aiGovernance.approve" fallback={value ? "需要" : "无需"}>
                <Switch
                  size="small"
                  checked={value}
                  onChange={(approvalRequired) => updateMcpToolPolicy(row, { approvalRequired })}
                />
              </AuthButton>
            ),
          },
          {
            title: "Allowlist",
            dataIndex: "allowlisted",
            width: 110,
            render: (value, row: McpTool) => (
              <AuthButton auth="system.aiGovernance.approve">
                <Switch
                  checked={value}
                  onChange={(allowlisted) => updateMcpToolPolicy(row, { allowlisted })}
                />
              </AuthButton>
            ),
          },
          {
            title: "启用",
            dataIndex: "status",
            width: 80,
            render: (value, row: McpTool) => (
              <AuthButton
                auth="system.aiGovernance.approve"
                fallback={value === 1 ? "启用" : "停用"}
              >
                <Switch
                  size="small"
                  checked={value === 1}
                  onChange={(checked) => updateMcpToolPolicy(row, { status: checked ? 1 : 0 })}
                />
              </AuthButton>
            ),
          },
        ]}
      />
    </Space>
  );

  const reliabilityTab = (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Table
        rowKey={(row: Circuit) => `${row.providerId}-${row.purpose}`}
        size="small"
        loading={circuits.isLoading}
        dataSource={circuits.data ?? []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "Provider", dataIndex: "providerName" },
          { title: "用途", dataIndex: "purpose", width: 120 },
          {
            title: "状态",
            dataIndex: "state",
            width: 100,
            render: (value) => <Tag color={statusColor[value]}>{value}</Tag>,
          },
          { title: "连续失败", dataIndex: "consecutiveFailures", width: 100 },
          { title: "阈值", dataIndex: "failureThreshold", width: 80 },
          { title: "冷却", dataIndex: "cooldownMs", width: 100, render: (value) => `${value} ms` },
          { title: "下次探测", dataIndex: "nextProbeAt", width: 170, render: date },
          {
            title: "操作",
            width: 130,
            render: (_, row: Circuit) => (
              <Space size={4}>
                <AuthButton auth="system.aiGovernance.update">
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    title="编辑熔断策略"
                    onClick={() => {
                      setCircuit(row);
                      circuitForm.setFieldsValue({
                        failureThreshold: row.failureThreshold,
                        cooldownMs: row.cooldownMs,
                      });
                    }}
                  />
                </AuthButton>
                <AuthButton auth="system.aiGovernance.execute">
                  <Popconfirm
                    title="重置熔断状态？"
                    description="状态将恢复为 closed，并清除连续失败与探测租约。"
                    onConfirm={() =>
                      mutate.mutate({
                        url: "/api/system/ai/governance/circuits/reset",
                        body: { providerId: row.providerId, purpose: row.purpose },
                        refresh: ["ai-governance-circuits"],
                      })
                    }
                  >
                    <Button size="small" icon={<ReloadOutlined />} title="重置熔断状态" />
                  </Popconfirm>
                </AuthButton>
              </Space>
            ),
          },
        ]}
      />
      <Table
        rowKey="id"
        size="small"
        loading={quotas.isLoading}
        dataSource={quotas.data ?? []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "策略", dataIndex: "name" },
          {
            title: "主体",
            render: (_, row: Quota) =>
              `${row.subjectType}${row.subjectId ? ` #${row.subjectId}` : ""}`,
          },
          { title: "周期", dataIndex: "period", width: 90 },
          { title: "输入上限", dataIndex: "maxInputTokens" },
          { title: "输出上限", dataIndex: "maxOutputTokens" },
          {
            title: "费用上限",
            render: (_, row: Quota) => (row.maxCost ? `${row.currency} ${row.maxCost}` : "-"),
          },
          {
            title: (
              <AuthButton auth="system.aiGovernance.update">
                <Button
                  size="small"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setQuota(null);
                    quotaForm.resetFields();
                    quotaForm.setFieldsValue({
                      subjectType: "system",
                      period: "monthly",
                      currency: "USD",
                      status: 1,
                    });
                  }}
                >
                  新建
                </Button>
              </AuthButton>
            ),
            width: 100,
            render: (_, row: Quota) => (
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setQuota(row);
                  quotaForm.setFieldsValue(row);
                }}
              />
            ),
          },
        ]}
      />
    </Space>
  );

  const operationsTab = (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        showIcon
        type="info"
        title="Worker 是独立进程"
        description="使用 pnpm ai:worker 持续处理，或 pnpm ai:worker:once 处理一项。任务通过 PostgreSQL SKIP LOCKED 领取。"
      />
      <Table
        rowKey="id"
        size="small"
        loading={jobs.isLoading}
        dataSource={jobs.data?.data ?? []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "ID", dataIndex: "id", width: 70 },
          { title: "任务", dataIndex: "jobType" },
          {
            title: "资源",
            render: (_, row: Job) =>
              `${row.resourceType ?? "-"}${row.resourceId ? ` #${row.resourceId}` : ""}`,
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 100,
            render: (value) => <Tag color={statusColor[value]}>{value}</Tag>,
          },
          {
            title: "尝试",
            render: (_, row: Job) => `${row.attempts}/${row.maxAttempts}`,
            width: 80,
          },
          { title: "错误", dataIndex: "errorMessage", ellipsis: true },
          { title: "创建时间", dataIndex: "createdAt", width: 170, render: date },
          {
            title: "操作",
            width: 120,
            fixed: "right",
            render: (_, row: Job) => (
              <Space size={4}>
                <AuthButton auth="system.aiGovernance.execute">
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    title="重试任务"
                    disabled={row.status !== "failed" || row.attempts >= row.maxAttempts}
                    onClick={() =>
                      mutate.mutate({
                        url: `/api/system/ai/governance/jobs/${row.id}/retry`,
                        refresh: ["ai-governance-jobs"],
                      })
                    }
                  />
                </AuthButton>
                <AuthButton auth="system.aiGovernance.execute">
                  <Popconfirm
                    title="取消后台任务？"
                    description="已开始的外部调用可能无法立即中断，但结果不会再写回任务。"
                    onConfirm={() =>
                      mutate.mutate({
                        url: `/api/system/ai/governance/jobs/${row.id}/cancel`,
                        refresh: ["ai-governance-jobs"],
                      })
                    }
                  >
                    <Button
                      size="small"
                      danger
                      icon={<CloseCircleOutlined />}
                      title="取消任务"
                      disabled={!["queued", "running"].includes(row.status)}
                    />
                  </Popconfirm>
                </AuthButton>
              </Space>
            ),
          },
        ]}
      />
      <Table
        title={() => (
          <div className="ai-governance-table-title">
            <Typography.Text strong>计费账本</Typography.Text>
            <AuthButton auth="system.aiGovernance.update">
              <Button
                size="small"
                type="primary"
                icon={<DollarOutlined />}
                onClick={() => {
                  adjustmentForm.resetFields();
                  adjustmentForm.setFieldsValue({ currency: "USD" });
                  setAdjustmentOpen(true);
                }}
              >
                人工调整
              </Button>
            </AuthButton>
          </div>
        )}
        rowKey="id"
        size="small"
        loading={billing.isLoading}
        dataSource={billing.data?.data ?? []}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "ID", dataIndex: "id", width: 70 },
          { title: "用户", dataIndex: "userName" },
          { title: "用途", dataIndex: "purpose" },
          { title: "类型", dataIndex: "entryType", width: 100 },
          {
            title: "金额",
            render: (_, row: Ledger) => `${row.currency} ${Number(row.amount).toFixed(6)}`,
          },
          { title: "状态", dataIndex: "status", width: 100, render: (value) => <Tag>{value}</Tag> },
          { title: "来源", dataIndex: "source" },
          { title: "发生时间", dataIndex: "occurredAt", width: 170, render: date },
          {
            title: "操作",
            width: 90,
            fixed: "right",
            render: (_, row: Ledger) => (
              <AuthButton auth="system.aiGovernance.update">
                <Button
                  size="small"
                  icon={<CheckCircleOutlined />}
                  title="确认或作废费用"
                  disabled={row.entryType !== "usage" || row.status === "void"}
                  onClick={() => {
                    setSettlement(row);
                    settlementForm.setFieldsValue({
                      status: "confirmed",
                      amount: row.amount,
                      currency: row.currency,
                      source: row.source,
                      description: row.description,
                    });
                  }}
                />
              </AuthButton>
            ),
          },
        ]}
      />
    </Space>
  );

  return (
    <PageScaffold title="AI 治理" hideHeader className="admin-fill-workspace">
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Alert
          showIcon
          icon={<SafetyCertificateOutlined />}
          type="info"
          title="AI 治理与长期运行"
          description="Memory 只接受显式写入；Skill 只组合指令和受控 Tool；目录估算费用不等于 Provider 最终发票。"
        />
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            { key: "memory", label: "Memory", children: memoryTab },
            { key: "skills", label: "Runtime Skills", children: skillTab },
            { key: "mcp", label: "MCP", children: mcpTab },
            { key: "reliability", label: "熔断与配额", children: reliabilityTab },
            { key: "operations", label: "任务与账本", children: operationsTab },
          ]}
        />
      </Space>
      <Modal
        open={memory !== undefined}
        title={memory?.id ? "编辑 Memory" : "新建 Memory"}
        onCancel={() => setMemory(undefined)}
        onOk={() => void saveMemory()}
        confirmLoading={mutate.isPending}
      >
        <Form form={memoryForm} layout="vertical">
          <Form.Item name="scopeType" label="范围" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "user", label: "用户 Memory" },
                { value: "agent", label: "Agent Memory" },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.scopeType !== b.scopeType}>
            {({ getFieldValue }) =>
              getFieldValue("scopeType") === "agent" ? (
                <Form.Item name="agentId" label="Agent" rules={[{ required: true }]}>
                  <Select
                    options={(options.data?.agents ?? []).map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                  />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item name="content" label="内容" rules={[{ required: true }]}>
            <Input.TextArea rows={6} />
          </Form.Item>
          <Space>
            <Form.Item name="writePolicy" label="写入策略">
              <Select
                style={{ width: 140 }}
                options={[
                  { value: "manual", label: "手工" },
                  { value: "confirmed", label: "用户确认" },
                ]}
              />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                style={{ width: 140 }}
                options={[
                  { value: "active", label: "启用" },
                  { value: "archived", label: "归档" },
                ]}
              />
            </Form.Item>
            <Form.Item name="expiresAt" label="过期时间">
              <Input type="datetime-local" style={{ width: 210 }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
      <Modal
        open={skill !== undefined}
        title={skill?.id ? "编辑 Runtime Skill" : "新建 Runtime Skill"}
        width={720}
        onCancel={() => setSkill(undefined)}
        onOk={() => void saveSkill()}
        confirmLoading={mutate.isPending}
      >
        <Form form={skillForm} layout="vertical">
          <Space.Compact block>
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true }]}
              style={{ width: "50%" }}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="code"
              label="编码"
              rules={[{ required: true }]}
              style={{ width: "50%" }}
            >
              <Input />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} maxLength={1000} />
          </Form.Item>
          <Form.Item name="instructions" label="指令" rules={[{ required: true }]}>
            <Input.TextArea rows={7} />
          </Form.Item>
          <Form.Item name="toolIds" label="允许 Tool">
            <Select
              mode="multiple"
              options={(options.data?.tools ?? []).map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="agentIds" label="应用 Agent">
            <Select
              mode="multiple"
              options={(options.data?.agents ?? []).map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="status"
            label="启用"
            valuePropName="checked"
            getValueFromEvent={(checked) => (checked ? 1 : 0)}
            getValueProps={(value) => ({ checked: value === 1 })}
          >
            <Switch />
          </Form.Item>
          <Form.Item name="sort" hidden>
            <InputNumber />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={mcp !== undefined}
        title={mcp?.id ? "编辑 MCP Server" : "新建 MCP Server"}
        width={720}
        onCancel={() => setMcp(undefined)}
        onOk={() => void saveMcp()}
        confirmLoading={mutate.isPending}
      >
        <Form form={mcpForm} layout="vertical">
          <Space.Compact block>
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true }]}
              style={{ width: "50%" }}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="code"
              label="编码"
              rules={[{ required: true }]}
              style={{ width: "50%" }}
            >
              <Input />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="endpointUrl" label="HTTPS Endpoint" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="transport" label="传输" style={{ width: "50%" }}>
              <Select
                options={[
                  { value: "streamable_http", label: "Streamable HTTP" },
                  { value: "sse", label: "SSE" },
                ]}
              />
            </Form.Item>
            <Form.Item name="oauthMode" label="OAuth" style={{ width: "50%" }}>
              <Select
                options={[
                  { value: "none", label: "无" },
                  { value: "client_credentials", label: "Client Credentials" },
                  { value: "authorization_code", label: "Authorization Code + PKCE" },
                ]}
              />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="clientId" label="Client ID">
            <Input />
          </Form.Item>
          <Form.Item name="clientSecret" label="Client Secret">
            <Input.Password placeholder={mcp?.hasClientSecret ? "留空保留现有密钥" : "可选"} />
          </Form.Item>
          <Form.Item name="authorizationUrl" label="Authorization URL">
            <Input />
          </Form.Item>
          <Form.Item name="tokenUrl" label="Token URL">
            <Input />
          </Form.Item>
          <Form.Item name="scopes" label="Scopes">
            <Input />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: "draft", label: "草稿" },
                { value: "active", label: "启用" },
                { value: "disabled", label: "停用" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={circuit !== undefined}
        title={circuit ? `熔断策略 · ${circuit.providerName} / ${circuit.purpose}` : "熔断策略"}
        onCancel={() => setCircuit(undefined)}
        onOk={() => void saveCircuit()}
        confirmLoading={mutate.isPending}
      >
        <Form form={circuitForm} layout="vertical">
          <Form.Item name="failureThreshold" label="连续失败阈值" rules={[{ required: true }]}>
            <InputNumber min={1} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="cooldownMs" label="冷却时间（毫秒）" rules={[{ required: true }]}>
            <InputNumber min={1000} max={86400000} step={1000} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={quota !== undefined}
        title={quota?.id ? "编辑配额" : "新建配额"}
        onCancel={() => setQuota(undefined)}
        onOk={() => void saveQuota()}
        confirmLoading={mutate.isPending}
      >
        <Form form={quotaForm} layout="vertical">
          <Form.Item name="name" label="策略名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="subjectType" label="主体" style={{ width: "50%" }}>
              <Select
                options={[
                  { value: "system", label: "系统" },
                  { value: "department", label: "部门" },
                  { value: "user", label: "用户" },
                ]}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(a, b) => a.subjectType !== b.subjectType}>
              {({ getFieldValue }) =>
                getFieldValue("subjectType") === "department" ? (
                  <Form.Item name="subjectId" label="部门" style={{ width: "50%" }}>
                    <Select
                      options={(options.data?.departments ?? []).map((item) => ({
                        value: item.id,
                        label: item.name,
                      }))}
                    />
                  </Form.Item>
                ) : getFieldValue("subjectType") === "user" ? (
                  <Form.Item name="subjectId" label="用户" style={{ width: "50%" }}>
                    <Select
                      options={(options.data?.users ?? []).map((item) => ({
                        value: item.id,
                        label: item.nickname || item.username,
                      }))}
                    />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          </Space.Compact>
          <Form.Item name="period" label="周期">
            <Select
              options={[
                { value: "daily", label: "每日" },
                { value: "monthly", label: "每月" },
              ]}
            />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="maxInputTokens" label="输入 Token">
              <InputNumber min={1} />
            </Form.Item>
            <Form.Item name="maxOutputTokens" label="输出 Token">
              <InputNumber min={1} />
            </Form.Item>
            <Form.Item name="maxCost" label="费用">
              <Input />
            </Form.Item>
          </Space.Compact>
          <Space.Compact block>
            <Form.Item
              name="currency"
              label="币种"
              rules={[{ required: true }]}
              style={{ width: "50%" }}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="status"
              label="启用"
              valuePropName="checked"
              getValueFromEvent={(checked) => (checked ? 1 : 0)}
              getValueProps={(value) => ({ checked: value === 1 })}
              style={{ width: "50%" }}
            >
              <Switch />
            </Form.Item>
          </Space.Compact>
        </Form>
      </Modal>
      <Modal
        open={adjustmentOpen}
        title="人工计费调整"
        onCancel={() => setAdjustmentOpen(false)}
        onOk={() => void saveAdjustment()}
        confirmLoading={mutate.isPending}
      >
        <Alert
          showIcon
          type="warning"
          title="人工调整会进入正式账本并写入高风险操作日志"
          style={{ marginBottom: 16 }}
        />
        <Form form={adjustmentForm} layout="vertical">
          <Form.Item name="userId" label="用户" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={(options.data?.users ?? []).map((item) => ({
                value: item.id,
                label: item.nickname || item.username,
              }))}
            />
          </Form.Item>
          <Space.Compact block>
            <Form.Item
              name="amount"
              label="金额"
              rules={[{ required: true }]}
              style={{ width: "65%" }}
            >
              <Input placeholder="可输入负数冲减" />
            </Form.Item>
            <Form.Item
              name="currency"
              label="币种"
              rules={[{ required: true }]}
              style={{ width: "35%" }}
            >
              <Input />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="description" label="调整说明" rules={[{ required: true }]}>
            <Input.TextArea rows={4} maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={settlement !== undefined}
        title={settlement ? `结算账本 #${settlement.id}` : "结算账本"}
        onCancel={() => setSettlement(undefined)}
        onOk={() => void saveSettlement()}
        confirmLoading={mutate.isPending}
      >
        <Form form={settlementForm} layout="vertical">
          <Form.Item name="status" label="结算状态" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "confirmed", label: "确认费用" },
                { value: "void", label: "作废记录" },
              ]}
            />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="amount" label="确认金额" style={{ width: "65%" }}>
              <Input />
            </Form.Item>
            <Form.Item name="currency" label="币种" style={{ width: "35%" }}>
              <Input />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="source" label="结算来源">
            <Input placeholder="例如 provider_statement" />
          </Form.Item>
          <Form.Item name="description" label="结算说明">
            <Input.TextArea rows={4} maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>
    </PageScaffold>
  );
}
