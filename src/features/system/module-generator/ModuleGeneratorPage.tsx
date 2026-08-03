"use client";

import {
  CodeOutlined,
  DiffOutlined,
  FileTextOutlined,
  ReloadOutlined,
  RocketOutlined,
  RollbackOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
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
  publishId?: string | null;
  publishStatus?: "preflighting" | "failed" | "published" | "rolled_back" | null;
  publishedAt?: string | null;
  canRollback?: boolean;
};

type PublishChange = {
  path: string;
  source: "generated-file" | "integration";
  status: "create" | "modify" | "unchanged" | "conflict";
  additions: number;
  deletions: number;
  beforeHash: string | null;
  afterHash: string;
  beforeContent: string | null;
  afterContent: string;
};

type PublishPlan = {
  name: string;
  module: {
    title?: string;
    permission?: string;
    frontendPath?: string;
    apiPath?: string;
  };
  migrationId: string;
  planHash: string;
  ready: boolean;
  hasChanges: boolean;
  issues: string[];
  changes: PublishChange[];
};

type GeneratorCapabilities = {
  contractVersion: number;
  schemaPath: string;
  draft: {
    builtInPageActions: readonly string[];
    customUiRequiredActions: readonly string[];
  };
  publish: {
    supportedDomains: readonly string[];
    isolatedPreflight: boolean;
    rollbackMetadata: boolean;
  };
  ownership: {
    draft: string;
    published: string;
    regeneration: string;
  };
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
  const [diffOpen, setDiffOpen] = useState(false);
  const [publishPlan, setPublishPlan] = useState<PublishPlan | null>(null);
  const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);

  const exampleQuery = useQuery({
    queryKey: ["module-generator", "example"],
    queryFn: () => request<Record<string, unknown>>("/api/system/module/generator/example"),
  });
  const draftsQuery = useQuery({
    queryKey: ["module-generator", "drafts"],
    queryFn: () => request<ModuleDraft[]>("/api/system/module/generator/drafts"),
  });
  const capabilitiesQuery = useQuery({
    queryKey: ["module-generator", "capabilities"],
    queryFn: () => request<GeneratorCapabilities>("/api/system/module/generator/capabilities"),
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
  const previewPublishMutation = useMutation({
    mutationFn: (name: string) =>
      request<PublishPlan>(`/api/system/module/generator/drafts/${name}/diff`),
    onSuccess: (data) => {
      setPublishPlan(data);
      setSelectedDiffPath(data.changes[0]?.path ?? null);
      setDiffOpen(true);
    },
  });
  const publishMutation = useMutation({
    mutationFn: (input: { name: string; planHash: string }) =>
      request("/api/system/module/generator/publish", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      feedback.success("模块已通过隔离预检并发布");
      setDiffOpen(false);
      setPublishPlan(null);
      void queryClient.invalidateQueries({ queryKey: ["module-generator", "drafts"] });
    },
  });
  const rollbackMutation = useMutation({
    mutationFn: (input: { name: string; publishId?: string | null }) =>
      request("/api/system/module/generator/rollback", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => {
      feedback.success("模块源码已回滚；已执行的数据库 migration 需要单独处理");
      void queryClient.invalidateQueries({ queryKey: ["module-generator", "drafts"] });
    },
  });

  const selectedFile = useMemo(
    () => result?.files.find((file) => file.path === selectedPath) ?? result?.files[0] ?? null,
    [result, selectedPath],
  );
  const selectedDiff = useMemo(
    () =>
      publishPlan?.changes.find((change) => change.path === selectedDiffPath) ??
      publishPlan?.changes[0] ??
      null,
    [publishPlan, selectedDiffPath],
  );

  return (
    <PageScaffold title="模块生成器" description="从配置生成普通 CRUD 模块草稿">
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Alert
          showIcon
          type="warning"
          title="生成器先生成可审查草稿，发布后才会上线"
          description="生成阶段输出到 generated/module-drafts，不会注册页面或 API；发布前必须检查源码差异并通过隔离预检。生产环境会拒绝生成、差异预览、发布和回滚。"
        />
        <Alert
          showIcon
          type="info"
          title="CMS 配置 CRUD 的当前写法"
          description='现阶段自动发布只支持 domain="system"。例如 CMS 配置可使用 frontendPath="/system/cms/config"、backendBasePath="/cms/config"，上线后接口为 /api/system/cms/config。真正 /api/cms/* 需要先增加业务域后端挂载。'
        />
        <Alert
          showIcon
          type="success"
          icon={<SafetyCertificateOutlined />}
          title={`模块契约 v${capabilitiesQuery.data?.contractVersion ?? 1}`}
          description={`CLI、Web 和 Coding Agent 共用 ${capabilitiesQuery.data?.schemaPath ?? "schemas/admin-module.schema.json"}。生成页内置 ${capabilitiesQuery.data?.draft.builtInPageActions.join(" / ") ?? "query / create / update / delete"}；${capabilitiesQuery.data?.draft.customUiRequiredActions.join(" / ") ?? "batchDelete / restore / forceDelete / status"} 需要补业务 UI。发布后源码归项目维护，重新生成只能检查差异。`}
        />
        <Card className="admin-card" variant="borderless">
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Space wrap>
              <Button
                type="primary"
                icon={<CodeOutlined />}
                onClick={() => {
                  if (!configText && exampleQuery.data)
                    setConfigText(prettyJson(exampleQuery.data));
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
                  已生成 {result.files.length}{" "}
                  个草稿文件。发布前会显示所有新增和修改文件，并在隔离目录执行自动验证。
                </Typography.Text>
              </Space>
            ) : (
              <Typography.Text type="secondary">
                适合普通 CRUD
                模块；涉及密钥、默认实例、连接测试、文件物理操作、发布流程等模块仍应在生成草稿后手写显式
                route/service。
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
                width: 240,
                render: (_, record) =>
                  record.status === "published" ? (
                    <Space size={4}>
                      <Button
                        size="small"
                        icon={<DiffOutlined />}
                        loading={
                          previewPublishMutation.isPending &&
                          previewPublishMutation.variables === record.name
                        }
                        disabled={
                          previewPublishMutation.isPending &&
                          previewPublishMutation.variables !== record.name
                        }
                        onClick={() => previewPublishMutation.mutate(record.name)}
                      >
                        检查差异
                      </Button>
                      {record.canRollback ? (
                        <Button
                          size="small"
                          danger
                          icon={<RollbackOutlined />}
                          loading={
                            rollbackMutation.isPending &&
                            rollbackMutation.variables?.name === record.name
                          }
                          onClick={() => {
                            Modal.confirm({
                              title: `回滚 ${record.title || record.name}`,
                              content:
                                "只回滚该次发布写入的源码。若文件发布后被人工修改，系统会拒绝回滚；已经执行的数据库 migration 不会自动逆向删除。",
                              okText: "确认回滚源码",
                              cancelText: "取消",
                              okButtonProps: { danger: true },
                              onOk: () =>
                                rollbackMutation.mutateAsync({
                                  name: record.name,
                                  publishId: record.publishId,
                                }),
                            });
                          }}
                        >
                          回滚
                        </Button>
                      ) : null}
                    </Space>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      icon={<DiffOutlined />}
                      loading={
                        previewPublishMutation.isPending &&
                        previewPublishMutation.variables === record.name
                      }
                      disabled={
                        previewPublishMutation.isPending &&
                        previewPublishMutation.variables !== record.name
                      }
                      onClick={() => previewPublishMutation.mutate(record.name)}
                    >
                      检查并发布
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
            style={{
              fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          />
        </Space>
      </Modal>

      <Drawer title="生成结果" open={previewOpen} size={1040} onClose={() => setPreviewOpen(false)}>
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

      <Drawer
        title={
          publishPlan ? `发布差异 · ${publishPlan.module.title || publishPlan.name}` : "发布差异"
        }
        open={diffOpen}
        size={1180}
        destroyOnHidden
        onClose={() => {
          if (!publishMutation.isPending) setDiffOpen(false);
        }}
        extra={
          <Button
            type="primary"
            danger
            icon={<RocketOutlined />}
            loading={publishMutation.isPending}
            disabled={!publishPlan?.ready || !publishPlan.hasChanges}
            onClick={() => {
              if (!publishPlan) return;
              Modal.confirm({
                title: `发布 ${publishPlan.module.title || publishPlan.name}`,
                content:
                  "系统会先在隔离目录应用本次差异并执行自动验证。只有预检通过才会写入真实源码，同时保存可回滚快照。",
                okText: "预检并发布",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () =>
                  publishMutation.mutateAsync({
                    name: publishPlan.name,
                    planHash: publishPlan.planHash,
                  }),
              });
            }}
          >
            预检并发布
          </Button>
        }
      >
        {publishPlan ? (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              showIcon
              type={!publishPlan.ready ? "error" : publishPlan.hasChanges ? "success" : "info"}
              title={
                !publishPlan.ready
                  ? "差异计划存在冲突，不能发布"
                  : publishPlan.hasChanges
                    ? `差异计划可发布，共 ${publishPlan.changes.filter((item) => item.status !== "unchanged").length} 个文件发生变化`
                    : "草稿与当前源码一致，没有需要发布的变化"
              }
              description={
                publishPlan.issues.length
                  ? publishPlan.issues.join("；")
                  : `Migration: ${publishPlan.migrationId} · Plan: ${publishPlan.planHash.slice(0, 12)}`
              }
            />
            <Table<PublishChange>
              className="admin-table-surface"
              rowKey="path"
              size="small"
              pagination={false}
              dataSource={publishPlan.changes}
              rowClassName={(record) =>
                record.path === selectedDiff?.path ? "ant-table-row-selected" : ""
              }
              onRow={(record) => ({ onClick: () => setSelectedDiffPath(record.path) })}
              columns={[
                {
                  title: "文件",
                  dataIndex: "path",
                  ellipsis: true,
                  render: (value) => <Typography.Text code>{value}</Typography.Text>,
                },
                {
                  title: "来源",
                  dataIndex: "source",
                  width: 110,
                  render: (value) => <Tag>{value === "integration" ? "集成点" : "生成文件"}</Tag>,
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 100,
                  render: (value) => (
                    <Tag
                      color={
                        value === "create"
                          ? "success"
                          : value === "modify"
                            ? "processing"
                            : value === "conflict"
                              ? "error"
                              : "default"
                      }
                    >
                      {value === "create"
                        ? "新增"
                        : value === "modify"
                          ? "修改"
                          : value === "conflict"
                            ? "冲突"
                            : "无变化"}
                    </Tag>
                  ),
                },
                {
                  title: "变化",
                  width: 120,
                  render: (_, record) => (
                    <Space size={4}>
                      <Typography.Text type="success">+{record.additions}</Typography.Text>
                      <Typography.Text type="danger">-{record.deletions}</Typography.Text>
                    </Space>
                  ),
                },
              ]}
            />
            {selectedDiff ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                  gap: 12,
                }}
              >
                <Card size="small" title="发布前" variant="borderless">
                  <pre
                    style={{
                      margin: 0,
                      minHeight: 320,
                      maxHeight: 620,
                      overflow: "auto",
                      whiteSpace: "pre",
                      fontSize: 12,
                    }}
                  >
                    {selectedDiff.beforeContent ?? "（新文件）"}
                  </pre>
                </Card>
                <Card size="small" title="发布后" variant="borderless">
                  <pre
                    style={{
                      margin: 0,
                      minHeight: 320,
                      maxHeight: 620,
                      overflow: "auto",
                      whiteSpace: "pre",
                      fontSize: 12,
                    }}
                  >
                    {selectedDiff.afterContent}
                  </pre>
                </Card>
              </div>
            ) : null}
          </Space>
        ) : null}
      </Drawer>
    </PageScaffold>
  );
}
