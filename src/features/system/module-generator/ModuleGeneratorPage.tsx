"use client";

import { CodeOutlined, FileTextOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Drawer, Input, List, Modal, Space, Switch, Tag, Typography } from "antd";
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
  files: GeneratedFile[];
};

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function ModuleGeneratorPage() {
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
      feedback.success("模块草稿已生成");
    },
  });

  const selectedFile = useMemo(
    () => result?.files.find((file) => file.path === selectedPath) ?? result?.files[0] ?? null,
    [result, selectedPath],
  );

  return (
    <PageScaffold title="模块生成器" description="从配置生成普通 CRUD 模块草稿">
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Alert
          showIcon
          type="warning"
          message="生成器只生成可审查草稿，不直接改共享源码"
          description="输出目录固定在 tmp/generated/modules。schema、migration、seed rule、route manifest 和路由注册仍需要人工审查后应用。生产环境会拒绝生成。"
        />
        <Card className="admin-card" variant="borderless">
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
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
              <Space direction="vertical" size={8}>
                <Space wrap>
                  <Tag color="blue">{result.module.title}</Tag>
                  <Tag>{result.module.permission}</Tag>
                  <Tag>{result.module.frontendPath}</Tag>
                  <Tag>{result.outputRoot}</Tag>
                </Space>
                <Typography.Text type="secondary">
                  已生成 {result.files.length} 个文件。复制生成目录中的业务文件前，请先按 README 顺序审查 snippets。
                </Typography.Text>
              </Space>
            ) : (
              <Typography.Text type="secondary">
                适合普通 CRUD 模块；涉及密钥、默认实例、连接测试、文件物理操作、发布流程等模块仍应手写显式 route/service。
              </Typography.Text>
            )}
          </Space>
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
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            showIcon
            type="info"
            message="这里生成的是 80% CRUD 初稿"
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
        width={1040}
        onClose={() => setPreviewOpen(false)}
      >
        {result ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              showIcon
              type="success"
              message={`已生成到 ${result.outputRoot}`}
              description="生成器没有修改真实业务源码。请从生成目录复制文件或 snippets，并重新执行 typecheck、lint、test、admin:check-routes。"
            />
            <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
              <List
                bordered
                size="small"
                dataSource={result.files}
                renderItem={(file) => (
                  <List.Item
                    onClick={() => setSelectedPath(file.path)}
                    style={{
                      cursor: "pointer",
                      background: file.path === selectedFile?.path ? "var(--ant-color-fill-tertiary)" : undefined,
                    }}
                  >
                    <List.Item.Meta
                      avatar={<FileTextOutlined />}
                      title={<Typography.Text ellipsis>{file.path}</Typography.Text>}
                      description={`${file.size} bytes`}
                    />
                  </List.Item>
                )}
              />
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
