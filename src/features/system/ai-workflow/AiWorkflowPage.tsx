"use client";

import {
  ArrowLeftOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  ApartmentOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Button, Empty, Space, Table, Tag, Typography } from "antd";
import { useMemo } from "react";
import { request } from "@/lib/request";
import { useNavigationAdapter } from "@/platform/navigation";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { VisualWorkflowCanvas } from "../ai-agent/VisualWorkflowCanvas";

type WorkflowDefinition = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  status: "draft" | "published" | string;
  currentVersion?: number | null;
  versionCount?: number;
  updatedAt?: string | null;
};

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

export function WorkflowListPanel({ embedded = false }: { embedded?: boolean }) {
  const navigation = useNavigationAdapter();
  const definitions = useQuery({
    queryKey: ["system-ai-visual-workflows"],
    queryFn: () => request<WorkflowDefinition[]>("/api/system/ai/workflow/visual/definitions"),
  });

  const openEditor = (id?: number) => {
    navigation.push(id ? `/system/ai/workflow?id=${id}` : "/system/ai/workflow?new=1");
  };

  return (
    <div className={embedded ? "ai-workflow-list-panel ai-workflow-list-panel-embedded" : "ai-workflow-list-panel"}>
      <div className="ai-workflow-list-toolbar">
        <div>
          <Typography.Title level={4} className="ai-workflow-list-heading">
            Workflow
          </Typography.Title>
          <Typography.Text type="secondary">
            用可视化草稿定义确定性流程，发布后由受控运行时执行。
          </Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void definitions.refetch()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            新建 Workflow
          </Button>
          {embedded ? (
            <Button icon={<ApartmentOutlined />} onClick={() => navigation.push("/system/ai/workflow")}>
              打开 Workflow 中心
            </Button>
          ) : null}
        </Space>
      </div>
      <Table<WorkflowDefinition>
        className="admin-table-surface ai-workflow-list-table"
        rowKey="id"
        loading={definitions.isLoading}
        dataSource={definitions.data ?? []}
        locale={{
          emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有 Workflow，先创建一个草稿" />,
        }}
        onRow={(row) => ({
          onClick: () => openEditor(row.id),
          style: { cursor: "pointer" },
        })}
        pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 个 Workflow` }}
        columns={[
          {
            title: "Workflow",
            dataIndex: "name",
            render: (value: string, row) => (
              <Space orientation="vertical" size={0}>
                <Typography.Text strong>{value}</Typography.Text>
                <Typography.Text type="secondary" code>{row.code}</Typography.Text>
              </Space>
            ),
          },
          {
            title: "发布状态",
            dataIndex: "status",
            width: 120,
            render: (value: string) => <Tag color={value === "published" ? "success" : "warning"}>{value === "published" ? "已发布" : "草稿"}</Tag>,
          },
          {
            title: "当前版本",
            dataIndex: "currentVersion",
            width: 120,
            render: (value: number | null | undefined, row) => value ? `v${value}` : `未发布 · ${row.versionCount ?? 0} 个草稿`,
          },
          {
            title: "最近更新",
            dataIndex: "updatedAt",
            width: 190,
            render: formatDate,
          },
          {
            title: "操作",
            key: "action",
            width: 110,
            render: (_, row) => <Button type="link" icon={<EditOutlined />} onClick={(event) => { event.stopPropagation(); openEditor(row.id); }}>编辑</Button>,
          },
        ]}
      />
    </div>
  );
}

export function AiWorkflowPage() {
  const navigation = useNavigationAdapter();
  const query = useMemo(() => new URLSearchParams(navigation.search), [navigation.search]);
  const definitionId = Number(query.get("id") || 0) || null;
  const createNew = query.get("new") === "1";

  if (definitionId || createNew) {
    return (
      <PageScaffold title="Workflow 编辑器" hideHeader className="ai-workflow-page">
        <VisualWorkflowCanvas
          initialDefinitionId={definitionId}
          createNew={createNew}
          onBack={() => navigation.push("/system/ai/workflow")}
        />
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      title="Workflow"
      description="创建、编辑、预检并发布由 Mastra Builder 契约验证的业务流程"
      actions={<Button icon={<ArrowLeftOutlined />} onClick={() => navigation.push("/system/ai/agent")}>返回 AI Agent</Button>}
      className="ai-workflow-page"
    >
      <WorkflowListPanel />
    </PageScaffold>
  );
}
