"use client";

import { ApartmentOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Popover, Select, Space, Tag, Typography } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth";
import { useSaasContextStore } from "@/stores/saas-context";

export function SaasContextSwitcher() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const initMenus = useAuthStore((state) => state.initMenus);
  const context = useSaasContextStore((state) => state.context);
  const error = useSaasContextStore((state) => state.error);
  const initialized = useSaasContextStore((state) => state.initialized);
  const loading = useSaasContextStore((state) => state.loading);
  const initialize = useSaasContextStore((state) => state.initialize);
  const selectTenant = useSaasContextStore((state) => state.selectTenant);
  const selectWorkspace = useSaasContextStore((state) => state.selectWorkspace);

  useEffect(() => {
    if (user && !initialized) void initialize(user.id).catch(() => null);
  }, [initialize, initialized, user]);

  async function refreshScopedSurfaces() {
    await initMenus();
    await queryClient.invalidateQueries();
  }

  async function handleTenantChange(tenantId: number) {
    await selectTenant(tenantId);
    await refreshScopedSurfaces();
  }

  async function handleWorkspaceChange(workspaceId: number) {
    await selectWorkspace(workspaceId);
    await refreshScopedSurfaces();
  }

  const tenantOptions = (context?.tenants ?? [])
    .filter((item) => item.status === "active")
    .map((item) => ({ label: item.name, value: item.id }));
  const workspaceOptions = (context?.workspaces ?? [])
    .filter((item) => item.tenantId === context?.currentTenantId && item.status === "active")
    .map((item) => ({ label: item.name, value: item.id }));
  const label =
    context?.currentTenant && context.currentWorkspace
      ? `${context.currentTenant.name} / ${context.currentWorkspace.name}`
      : "选择工作上下文";

  return (
    <Popover
      placement="bottomRight"
      trigger="click"
      title="当前 Tenant / Workspace"
      content={
        <div className="saas-context-panel">
          {error ? (
            <Alert
              type="error"
              showIcon
              message={error}
              action={
                user ? (
                  <Button
                    size="small"
                    onClick={() => void initialize(user.id, true).catch(() => null)}
                  >
                    重试
                  </Button>
                ) : null
              }
              style={{ marginBottom: 12 }}
            />
          ) : null}
          {tenantOptions.length ? (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <div>
                <Typography.Text type="secondary">Tenant</Typography.Text>
                <Select
                  aria-label="当前 Tenant"
                  style={{ width: "100%", marginTop: 4 }}
                  loading={loading}
                  value={context?.currentTenantId ?? undefined}
                  options={tenantOptions}
                  onChange={(value) => void handleTenantChange(value).catch(() => null)}
                />
              </div>
              <div>
                <Typography.Text type="secondary">Workspace</Typography.Text>
                <Select
                  aria-label="当前 Workspace"
                  style={{ width: "100%", marginTop: 4 }}
                  loading={loading}
                  value={context?.currentWorkspaceId ?? undefined}
                  options={workspaceOptions}
                  onChange={(value) => void handleWorkspaceChange(value).catch(() => null)}
                />
              </div>
              <Space size={[4, 4]} wrap>
                <Typography.Text type="secondary">已开通应用</Typography.Text>
                {context?.effectiveModules.length ? (
                  context.effectiveModules.map((item) => <Tag key={item.code}>{item.name}</Tag>)
                ) : (
                  <Tag>0</Tag>
                )}
              </Space>
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前账号没有可用 Tenant" />
          )}
        </div>
      }
    >
      <Button
        className="saas-context-trigger"
        type="text"
        icon={<ApartmentOutlined />}
        loading={loading}
        aria-label={label}
        title={label}
      >
        <span className="saas-context-trigger-copy">{label}</span>
      </Button>
    </Popover>
  );
}
