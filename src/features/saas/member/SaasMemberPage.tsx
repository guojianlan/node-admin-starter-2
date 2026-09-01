"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type Page<T> = { data: T[]; page: number; pageSize: number; total: number };
type Tenant = { id: number; name: string; code: string };
type Workspace = { id: number; tenantId: number; name: string; code: string };
type Member = {
  userId: number;
  username: string;
  nickname: string;
  email: string | null;
  role: string;
  status: "active" | "suspended";
  joinedAt: string;
};
type Invitation = {
  id: number;
  email: string;
  tenantRole: string;
  workspaceId: number | null;
  workspaceName: string | null;
  workspaceRole: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
};
type InvitationForm = {
  email: string;
  tenantRole: "admin" | "member" | "viewer";
  workspaceId?: number;
  workspaceRole?: "editor" | "reviewer" | "viewer";
  expiresInDays: number;
};

const tenantRoleOptions = [
  { label: "管理员", value: "admin" },
  { label: "成员", value: "member" },
  { label: "查看者", value: "viewer" },
];
const workspaceRoleOptions = [
  { label: "编辑者", value: "editor" },
  { label: "审核者", value: "reviewer" },
  { label: "查看者", value: "viewer" },
];

function roleTag(value: string) {
  const color =
    value === "owner" ? "gold" : value === "admin" || value === "editor" ? "blue" : "default";
  return <Tag color={color}>{value}</Tag>;
}

function statusTag(value: string) {
  const color =
    value === "active" || value === "accepted"
      ? "success"
      : value === "pending"
        ? "processing"
        : "default";
  return <Tag color={color}>{value}</Tag>;
}

export function SaasMemberPage() {
  const queryClient = useQueryClient();
  const [tenantId, setTenantId] = useState<number>();
  const [workspaceId, setWorkspaceId] = useState<number>();
  const [memberEditor, setMemberEditor] = useState<{
    scope: "tenant" | "workspace";
    member: Member;
  }>();
  const [invitationOpen, setInvitationOpen] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string>();
  const [memberForm] = Form.useForm<{ role: string; status: "active" | "suspended" }>();
  const [invitationForm] = Form.useForm<InvitationForm>();

  const tenantsQuery = useQuery({
    queryKey: ["saas-member-tenants"],
    queryFn: () => request<Page<Tenant>>("/api/saas/tenants?page=1&pageSize=100"),
  });
  const tenants = tenantsQuery.data?.data ?? [];
  const currentTenantId = tenantId ?? tenants[0]?.id;

  const workspacesQuery = useQuery({
    queryKey: ["saas-member-workspaces", currentTenantId],
    enabled: Boolean(currentTenantId),
    queryFn: () =>
      request<Page<Workspace>>(
        `/api/saas/workspaces?page=1&pageSize=100&tenantId=${currentTenantId}`,
      ),
  });
  const workspaces = workspacesQuery.data?.data ?? [];
  const currentWorkspaceId = workspaces.some((item) => item.id === workspaceId)
    ? workspaceId
    : workspaces[0]?.id;

  const tenantMembersQuery = useQuery({
    queryKey: ["saas-tenant-members", currentTenantId],
    enabled: Boolean(currentTenantId),
    queryFn: () =>
      request<Page<Member>>(
        `/api/saas/tenant-members?tenantId=${currentTenantId}&page=1&pageSize=100`,
      ),
  });
  const workspaceMembersQuery = useQuery({
    queryKey: ["saas-workspace-members", currentWorkspaceId],
    enabled: Boolean(currentWorkspaceId),
    queryFn: () =>
      request<Page<Member>>(
        `/api/saas/workspace-members?workspaceId=${currentWorkspaceId}&page=1&pageSize=100`,
      ),
  });
  const invitationsQuery = useQuery({
    queryKey: ["saas-invitations", currentTenantId],
    enabled: Boolean(currentTenantId),
    queryFn: () =>
      request<Page<Invitation>>(
        `/api/saas/invitations?tenantId=${currentTenantId}&page=1&pageSize=100`,
      ),
  });

  const saveMemberMutation = useMutation({
    mutationFn: async (values: { role: string; status: "active" | "suspended" }) => {
      if (!memberEditor) return;
      const scopeId = memberEditor.scope === "tenant" ? currentTenantId : currentWorkspaceId;
      if (!scopeId) throw new Error("请先选择管理范围");
      await request(
        `/api/saas/${memberEditor.scope}-members/${scopeId}/${memberEditor.member.userId}`,
        { method: "PUT", body: values },
      );
    },
    onSuccess: async () => {
      feedback.success("成员角色已更新");
      setMemberEditor(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["saas-tenant-members"] }),
        queryClient.invalidateQueries({ queryKey: ["saas-workspace-members"] }),
      ]);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (input: { scope: "tenant" | "workspace"; member: Member }) => {
      const scopeId = input.scope === "tenant" ? currentTenantId : currentWorkspaceId;
      if (!scopeId) throw new Error("请先选择管理范围");
      await request(`/api/saas/${input.scope}-members/${scopeId}/${input.member.userId}`, {
        method: "DELETE",
      });
    },
    onSuccess: async () => {
      feedback.success("成员已移除");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["saas-tenant-members"] }),
        queryClient.invalidateQueries({ queryKey: ["saas-workspace-members"] }),
      ]);
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (values: InvitationForm) => {
      if (!currentTenantId) throw new Error("请先选择 Tenant");
      return request<{ id: number; token: string; expiresAt: string }>("/api/saas/invitations", {
        method: "POST",
        body: { ...values, tenantId: currentTenantId },
      });
    },
    onSuccess: async (result) => {
      setInvitationOpen(false);
      invitationForm.resetFields();
      setIssuedToken(result.token);
      await queryClient.invalidateQueries({ queryKey: ["saas-invitations", currentTenantId] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) =>
      request(`/api/saas/invitations/${id}/revoke`, { method: "POST", body: {} }),
    onSuccess: async () => {
      feedback.success("邀请已撤销");
      await queryClient.invalidateQueries({ queryKey: ["saas-invitations", currentTenantId] });
    },
  });

  const openMemberEditor = (scope: "tenant" | "workspace", member: Member) => {
    setMemberEditor({ scope, member });
    memberForm.setFieldsValue({ role: member.role, status: member.status });
  };

  const memberColumns: ColumnsType<Member> = [
    { title: "用户", dataIndex: "username", width: 150, fixed: "left" },
    { title: "昵称", dataIndex: "nickname", width: 150 },
    { title: "邮箱", dataIndex: "email", width: 220, render: (value) => value || "未绑定" },
    { title: "角色", dataIndex: "role", width: 110, render: roleTag },
    { title: "状态", dataIndex: "status", width: 110, render: statusTag },
    { title: "加入时间", dataIndex: "joinedAt", width: 190 },
    {
      title: "操作",
      key: "actions",
      width: 150,
      fixed: "right",
      render: (_value, record) => (
        <Space size="small">
          <AuthButton auth="saas.member.update">
            <Button
              size="small"
              disabled={record.role === "owner"}
              onClick={() => openMemberEditor("tenant", record)}
            >
              编辑
            </Button>
          </AuthButton>
          <AuthButton auth="saas.member.remove">
            <Popconfirm
              title="确认移除该 Tenant 成员？"
              description="其在该 Tenant 下的 Workspace 成员关系也会移除。"
              onConfirm={() => removeMemberMutation.mutate({ scope: "tenant", member: record })}
            >
              <Button size="small" danger disabled={record.role === "owner"}>
                移除
              </Button>
            </Popconfirm>
          </AuthButton>
        </Space>
      ),
    },
  ];

  const workspaceMemberColumns: ColumnsType<Member> = memberColumns.map((column) =>
    column.key === "actions"
      ? {
          ...column,
          render: (_value: unknown, record: Member) => (
            <Space size="small">
              <AuthButton auth="saas.member.update">
                <Button
                  size="small"
                  disabled={record.role === "owner"}
                  onClick={() => openMemberEditor("workspace", record)}
                >
                  编辑
                </Button>
              </AuthButton>
              <AuthButton auth="saas.member.remove">
                <Popconfirm
                  title="确认移除该 Workspace 成员？"
                  onConfirm={() =>
                    removeMemberMutation.mutate({ scope: "workspace", member: record })
                  }
                >
                  <Button size="small" danger disabled={record.role === "owner"}>
                    移除
                  </Button>
                </Popconfirm>
              </AuthButton>
            </Space>
          ),
        }
      : column,
  );

  const invitationColumns: ColumnsType<Invitation> = [
    { title: "邮箱", dataIndex: "email", width: 230, fixed: "left" },
    { title: "Tenant 角色", dataIndex: "tenantRole", width: 120, render: roleTag },
    {
      title: "Workspace",
      dataIndex: "workspaceName",
      width: 170,
      render: (value) => value || "仅 Tenant",
    },
    {
      title: "Workspace 角色",
      dataIndex: "workspaceRole",
      width: 140,
      render: (value) => (value ? roleTag(String(value)) : "-"),
    },
    { title: "状态", dataIndex: "status", width: 110, render: statusTag },
    { title: "过期时间", dataIndex: "expiresAt", width: 190 },
    {
      title: "操作",
      key: "actions",
      width: 100,
      fixed: "right",
      render: (_value, record) => (
        <AuthButton auth="saas.member.revokeInvite">
          <Popconfirm title="确认撤销该邀请？" onConfirm={() => revokeMutation.mutate(record.id)}>
            <Button size="small" danger disabled={record.status !== "pending"}>
              撤销
            </Button>
          </Popconfirm>
        </AuthButton>
      ),
    },
  ];

  const tenantSelector = (
    <Select
      aria-label="选择 Tenant"
      loading={tenantsQuery.isLoading}
      value={currentTenantId}
      onChange={(value) => {
        setTenantId(value);
        setWorkspaceId(undefined);
      }}
      style={{ minWidth: 240 }}
      options={tenants.map((tenant) => ({
        label: `${tenant.name} (${tenant.code})`,
        value: tenant.id,
      }))}
      placeholder="选择 Tenant"
    />
  );

  return (
    <PageScaffold
      title="成员与邀请"
      description="管理 Tenant、Workspace 成员关系和一次性邀请"
      hideHeader
    >
      <Tabs
        items={[
          {
            key: "tenant-members",
            label: "Tenant 成员",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                {tenantSelector}
                <Table<Member>
                  rowKey="userId"
                  loading={tenantMembersQuery.isLoading}
                  dataSource={tenantMembersQuery.data?.data ?? []}
                  columns={memberColumns}
                  pagination={false}
                  scroll={{ x: 1100, y: 480 }}
                />
              </Space>
            ),
          },
          {
            key: "workspace-members",
            label: "Workspace 成员",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Space wrap>
                  {tenantSelector}
                  <Select
                    aria-label="选择 Workspace"
                    loading={workspacesQuery.isLoading}
                    value={currentWorkspaceId}
                    onChange={setWorkspaceId}
                    style={{ minWidth: 240 }}
                    options={workspaces.map((workspace) => ({
                      label: `${workspace.name} (${workspace.code})`,
                      value: workspace.id,
                    }))}
                    placeholder="选择 Workspace"
                  />
                </Space>
                <Table<Member>
                  rowKey="userId"
                  loading={workspaceMembersQuery.isLoading}
                  dataSource={workspaceMembersQuery.data?.data ?? []}
                  columns={workspaceMemberColumns}
                  pagination={false}
                  scroll={{ x: 1100, y: 480 }}
                />
              </Space>
            ),
          },
          {
            key: "invitations",
            label: "邀请",
            children: (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Space wrap>
                  {tenantSelector}
                  <AuthButton auth="saas.member.invite">
                    <Button
                      type="primary"
                      onClick={() => setInvitationOpen(true)}
                      disabled={!currentTenantId}
                    >
                      创建邀请
                    </Button>
                  </AuthButton>
                </Space>
                <Table<Invitation>
                  rowKey="id"
                  loading={invitationsQuery.isLoading}
                  dataSource={invitationsQuery.data?.data ?? []}
                  columns={invitationColumns}
                  pagination={false}
                  scroll={{ x: 1100, y: 480 }}
                />
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={`编辑${memberEditor?.scope === "workspace" ? " Workspace" : " Tenant"}成员`}
        open={Boolean(memberEditor)}
        onCancel={() => setMemberEditor(undefined)}
        onOk={() => memberForm.submit()}
        confirmLoading={saveMemberMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={memberForm}
          layout="vertical"
          onFinish={(values) => saveMemberMutation.mutate(values)}
        >
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select
              options={
                memberEditor?.scope === "workspace" ? workspaceRoleOptions : tenantRoleOptions
              }
            />
          </Form.Item>
          <Form.Item label="状态" name="status" rules={[{ required: true }]}>
            <Select
              options={[
                { label: "启用", value: "active" },
                { label: "停用", value: "suspended" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="创建邀请"
        open={invitationOpen}
        onCancel={() => setInvitationOpen(false)}
        onOk={() => invitationForm.submit()}
        confirmLoading={inviteMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={invitationForm}
          layout="vertical"
          initialValues={{ tenantRole: "member", expiresInDays: 7 }}
          onFinish={(values) => inviteMutation.mutate(values)}
        >
          <Form.Item label="邀请邮箱" name="email" rules={[{ required: true, type: "email" }]}>
            <Input autoComplete="email" />
          </Form.Item>
          <Form.Item label="Tenant 角色" name="tenantRole" rules={[{ required: true }]}>
            <Select options={tenantRoleOptions} />
          </Form.Item>
          <Form.Item label="Workspace" name="workspaceId">
            <Select
              allowClear
              options={workspaces.map((workspace) => ({
                label: workspace.name,
                value: workspace.id,
              }))}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(previous, current) => previous.workspaceId !== current.workspaceId}
          >
            {({ getFieldValue }) =>
              getFieldValue("workspaceId") ? (
                <Form.Item
                  label="Workspace 角色"
                  name="workspaceRole"
                  preserve={false}
                  rules={[{ required: true }]}
                >
                  <Select options={workspaceRoleOptions} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item label="有效天数" name="expiresInDays" rules={[{ required: true }]}>
            <InputNumber min={1} max={30} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="邀请 Token 仅显示一次"
        open={Boolean(issuedToken)}
        footer={null}
        onCancel={() => setIssuedToken(undefined)}
      >
        <Typography.Paragraph type="secondary">
          当前切片未把邮件投递与邀请事实绑定。请通过安全渠道发送下面的接受地址；数据库只保存 Token
          Hash。
        </Typography.Paragraph>
        <Input.TextArea
          readOnly
          autoSize={{ minRows: 3, maxRows: 6 }}
          value={
            issuedToken ? `/saas/invitations/accept?token=${encodeURIComponent(issuedToken)}` : ""
          }
        />
        <Button
          style={{ marginTop: 12 }}
          onClick={() => {
            const value = `/saas/invitations/accept?token=${encodeURIComponent(issuedToken ?? "")}`;
            void navigator.clipboard
              .writeText(value)
              .then(() => feedback.success("接受地址已复制"));
          }}
        >
          复制接受地址
        </Button>
      </Modal>
    </PageScaffold>
  );
}
