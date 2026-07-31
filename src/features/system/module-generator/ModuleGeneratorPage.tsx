"use client";

import { CodeOutlined, FileTextOutlined, RocketOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Drawer, Input, Modal, Space, Switch, Table, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type GeneratedFile = {
  path: string;
  size: number;
  content: string;
};

type GenerateResult = {
  module: {
    name: string;
    title: string;
    kebabName: string;
    schemaName: string;
    permission: string;
    frontendPath: string;
    apiPath: string;
  };
  outputRoot: string;
  drafts?: ModuleDraft[];
  files: GeneratedFile[];
};

type ModuleDraft = {
  name: string;
  title?: string;
  domain?: string;
  permission?: string;
  frontendPath?: string;
  apiPath?: string;
  outputRoot: string;
  status: "draft" | "published";
};

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function ModuleGeneratorPage() {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [force, setForce] = useState(true);
  const [configText, setConfigText] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const exampleQuery = useQuery({
    queryKey: ["module-generator", "example"],
    queryFn: () => request<Record<string, unknown>>("/api/system/module/generator/example"),
  });
  const draftsQuery = useQuery({
    queryKey: ["module-generator", "drafts"],
    queryFn: () => request<ModuleDraft[]>("/api/system/module/generator/drafts"),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      request<GenerateResult>("/api/system/module/generator/generate", {
        method: "POST",
        body: { config: configText, force },
      }),
    onSuccess: (data) => {
      setResult(data);
      setSelectedPath(data.files[0]?.path ?? null);
      setPreviewOpen(true);
      void queryClient.invalidateQueries({ queryKey: ["module-generator", "drafts"] });
      feedback.success("模块草稿已生成");
    },
  });
  const publishMutation = useMutation({
    mutationFn: (name: string) =>
      request("/api/system/module/generator/publish", {
        method: "POST",
        body: { name },
      }),
    onSuccess: () => {
      feedback.success("模块已发布，请重新执行验证并重启开发服务确认路由");
      void queryClient.invalidateQueries({ queryKey: ["module-generator", "drafts"] });
    },
  });

  const selectedFile = useMemo(
    () => result?.files.find((file) => file.path === selectedPath) ?? result?.files[0] ?? null,
    [result, selectedPath],
  );

  return (
    <PageScaffold title="模块生成器" description="从配置生成普通 CRUD 模块草稿">
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Alert
          showIcon
          type="warning"
          title="生成器先生成可审查草稿，发布后才会上线"
          description="生成阶段输出到 generated/module-drafts，不会注册页面或 API；点击发布后才会写入 schema、migration、seed rule、route manifest 和路由注册。生产环境会拒绝生成和发布。"
        />
        <Alert
          showIcon
          type="info"
          title="CMS 配置 CRUD 的当前写法"
          description='现阶段自动发布只支持 domain="system"。例如 CMS 配置可使用 frontendPath="/system/cms/config"、backendBasePath="/cms/config"，上线后接口为 /api/system/cms/config。真正 /api/cms/* 需要先增加业务域后端挂载。'
        />
        <Card className="admin-card" variant="borderless">
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Space wrap>
              <Button
                type="primary"
                icon={<CodeOutlined />}
                onClick={() => {
                  if (!configText && exampleQuery.data) setConfigText(prettyJson(exampleQuery.data));
                  setModalOpen(true);
                }}
              >
                打开生成窗口
              </Button>
              <Button
                icon={<ReloadOutlined />}
                loading={exampleQuery.isFetching}
                onClick={() => {
                  if (exampleQuery.data) setConfigText(prettyJson(exampleQuery.data));
                }}
              >
                载入示例配置
              </Button>
              {result ? (
                <Button icon={<FileTextOutlined />} onClick={() => setPreviewOpen(true)}>
                  查看上次生成结果
                </Button>
              ) : null}
            </Space>
            {result ? (
              <Space orientation="vertical" size={8}>
                <Space wrap>
                  <Tag color="blue">{result.module.title}</Tag>
                  <Tag>{result.module.permission}</Tag>
                  <Tag>{result.module.frontendPath}</Tag>
                  <Tag>{result.outputRoot}</Tag>
                </Space>
                <Typography.Text type="secondary">
                  已生成 {result.files.length} 个草稿文件。确认后可在模块状态表点击发布。
                </Typography.Text>
              </Space>
            ) : (
              <Typography.Text type="secondary">
                适合普通 CRUD 模块；涉及密钥、默认实例、连接测试、文件物理操作、发布流程等模块仍应在生成草稿后手写显式 route/service。
              </Typography.Text>
            )}
          </Space>
        </Card>
        <Card className="admin-card" title="模块状态" variant="borderless">
          <Table<ModuleDraft>
            className="admin-table-surface"
            rowKey="name"
            size="small"
            loading={draftsQuery.isLoading}
            dataSource={draftsQuery.data ?? []}
            pagination={false}
            columns={[
              {
                title: "模块",
                dataIndex: "title",
                render: (value, record) => (
                  <Space>
                    <Typography.Text strong>{value || record.name}</Typography.Text>
                    <Tag>{record.name}</Tag>
                  </Space>
                ),
              },
              { title: "域", dataIndex: "domain", width: 100 },
              { title: "草稿目录", dataIndex: "outputRoot", ellipsis: true },
              { title: "权限", dataIndex: "permission" },
              { title: "前端路由", dataIndex: "frontendPath" },
              {
                title: "状态",
                dataIndex: "status",
                width: 100,
                render: (value) => (
                  <Tag color={value === "published" ? "success" : "warning"}>
                    {value === "published" ? "已上线" : "草稿"}
                  </Tag>
                ),
              },
              {
                title: "操作",
                width: 120,
                render: (_, record) =>
                  record.status === "published" ? (
                    <Typography.Text type="secondary">已发布</Typography.Text>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      icon={<RocketOutlined />}
                      loading={publishMutation.isPending && publishMutation.variables === record.name}
                      disabled={publishMutation.isPending && publishMutation.variables !== record.name}
                      onClick={() => {
                        Modal.confirm({
                          title: `发布 ${record.title || record.name}`,
                          content:
                            "发布会把该草稿写入真实项目源码，包括 schema、migration、seed rule、route manifest、路由注册、页面、后端 route 和测试文件。发布前请确认草稿内容已经审查。",
                          okText: "发布",
                          cancelText: "取消",
                          okButtonProps: { danger: true },
                          onOk: () => publishMutation.mutateAsync(record.name),
                        });
                      }}
                    >
                      发布
                    </Button>
                  ),
              },
            ]}
          />
        </Card>
      </Space>

      <Modal
        title="生成模块草稿"
        open={modalOpen}
        width={920}
        okText="生成草稿"
        cancelText="取消"
        confirmLoading={generateMutation.isPending}
        onCancel={() => setModalOpen(false)}
        onOk={() => generateMutation.mutate()}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            showIcon
            type="info"
            title="这里生成的是 80% CRUD 初稿"
            description="复杂资源配置仍需要在生成后补密钥加密、默认实例保护、测试接口和操作日志细节。"
          />
          <Space>
            <Typography.Text>覆盖已有草稿</Typography.Text>
            <Switch checked={force} onChange={setForce} />
          </Space>
          <Input.TextArea
            value={configText}
            rows={22}
            spellCheck={false}
            onChange={(event) => setConfigText(event.target.value)}
            style={{ fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace" }}
          />
        </Space>
      </Modal>

      <Drawer
        title="生成结果"
        open={previewOpen}
        size={1040}
        onClose={() => setPreviewOpen(false)}
      >
        {result ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              showIcon
              type="success"
              title={`已生成到 ${result.outputRoot}`}
              description="当前仍是草稿状态；点击发布后会写入真实项目集成点。发布后请重新执行 typecheck、lint、test、admin:check-routes。"
            />
            <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
              <div className="module-generator-file-list" role="list">
                {result.files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    className={
                      file.path === selectedFile?.path
                        ? "module-generator-file module-generator-file-active"
                        : "module-generator-file"
                    }
                    onClick={() => setSelectedPath(file.path)}
                  >
                    <FileTextOutlined />
                    <span>
                      <Typography.Text ellipsis>{file.path}</Typography.Text>
                      <Typography.Text type="secondary">{file.size} bytes</Typography.Text>
                    </span>
                  </button>
                ))}
              </div>
              <Card size="small" title={selectedFile?.path ?? "选择文件"} variant="borderless">
                <pre
                  style={{
                    margin: 0,
                    maxHeight: 640,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: 12,
                  }}
                >
                  {selectedFile?.content ?? ""}
                </pre>
              </Card>
            </div>
          </Space>
        ) : null}
      </Drawer>
    </PageScaffold>
  );
}
