"use client";

import {
  BookOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  FileAddOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  SendOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Segmented,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  TreeSelect,
  Typography,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import { useEffect, useMemo, useState } from "react";
import { AiCitationDrawer } from "@/components/ai/AiCitationDrawer";
import { StreamingMarkdown } from "@/components/ai/StreamingMarkdown";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { useAuthStore } from "@/stores/auth";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type ScopeType = "global" | "department" | "user";
type ChunkPreset = "auto" | "documentation" | "paragraph" | "sentence" | "recursive" | "fixed";
type KnowledgeBase = {
  id: number;
  name: string;
  code: string;
  description?: string | null;
  scopeType: ScopeType;
  deptId?: number | null;
  deptName?: string | null;
  ownerId?: number | null;
  ownerName?: string | null;
  chunkPreset: ChunkPreset;
  chunkSize: number;
  chunkOverlap: number;
  status: number;
  sort: number;
  documentCount: number;
  readyDocumentCount: number;
  chunkCount: number;
  chunkerVersion?: string | null;
  chunkConfigJson?: string | null;
  updatedAt: string;
};

type KnowledgeDocument = {
  id: number;
  fileId: number;
  name: string;
  version: number;
  status: "pending" | "processing" | "ready" | "failed" | "disabled";
  characterCount: number;
  chunkCount: number;
  errorMessage?: string | null;
  indexedAt?: string | null;
  size: number;
  ext?: string | null;
};

type FileOption = {
  id: number;
  originalName: string;
  ext?: string | null;
  size: number;
  sha256?: string | null;
};
type FileGroup = {
  id: number;
  parentId: number;
  name: string;
  children?: FileGroup[];
};
type KnowledgeUploadResult = { documentId: number; fileId: number; deduped: boolean };
type SourceMode = "upload" | "existing";
type SelectedFileOption = { label: string; value: number };

type PageResult<T> = { data: T[]; total: number; page: number; pageSize: number };
type DeptNode = { id: number; name: string; children?: DeptNode[] };
type Citation = {
  chunkId: number;
  knowledgeBaseName: string;
  documentName: string;
  fileId: number;
  chunkNo: number;
  content: string;
  pageNumber?: number | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
  score: number;
  keywordScore: number;
  vectorScore?: number | null;
  hybridScore: number;
  rerankScore?: number | null;
  retrievalMode: "hybrid" | "hybrid_rerank";
  rerankInvocationId?: number | null;
  rerankDegraded?: boolean;
  rerankErrorType?: string | null;
};
type AskResult = {
  runId: number;
  invocationId?: number | null;
  answer: string;
  citations: Citation[];
  insufficientEvidence: boolean;
};

const scopeLabels: Record<ScopeType, string> = {
  global: "全局",
  department: "部门",
  user: "个人",
};
const statusMeta: Record<KnowledgeDocument["status"], { color: string; text: string }> = {
  pending: { color: "default", text: "待索引" },
  processing: { color: "processing", text: "索引中" },
  ready: { color: "success", text: "可检索" },
  failed: { color: "error", text: "失败" },
  disabled: { color: "warning", text: "已停用" },
};
const chunkPresets: Record<
  ChunkPreset,
  { label: string; description: string; size: number; overlap: number }
> = {
  auto: {
    label: "自动识别（推荐）",
    description: "Markdown 保留标题与代码块，其他文档按段落、句子递归切分。",
    size: 1600,
    overlap: 160,
  },
  documentation: {
    label: "技术文档",
    description: "优先保留标题、列表、代码块和完整段落，适合项目文档与手册。",
    size: 1600,
    overlap: 160,
  },
  paragraph: {
    label: "段落聚合",
    description: "以完整段落为基本单位组合，适合报告、方案和普通文章。",
    size: 1400,
    overlap: 140,
  },
  sentence: {
    label: "句子边界",
    description: "优先在中英文句号等语义边界切分，适合制度、FAQ 和短文本。",
    size: 900,
    overlap: 90,
  },
  recursive: {
    label: "递归语义边界",
    description: "依次尝试段落、换行、句子和标点边界，适合 PDF、DOCX 和混合文本。",
    size: 1400,
    overlap: 140,
  },
  fixed: {
    label: "固定长度（兼容）",
    description: "只按字符窗口切分；仅用于兼容旧数据，不建议作为默认策略。",
    size: 1200,
    overlap: 120,
  },
};

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function flattenDepts(nodes: DeptNode[], depth = 0): Array<{ label: string; value: number }> {
  return nodes.flatMap((node) => [
    { label: `${"  ".repeat(depth)}${node.name}`, value: node.id },
    ...flattenDepts(node.children ?? [], depth + 1),
  ]);
}

function flattenFileGroups(nodes: FileGroup[], depth = 0): Array<{ title: string; value: number }> {
  return nodes.flatMap((node) => [
    ...(node.id > 0 ? [{ title: `${"  ".repeat(depth)}${node.name}`, value: node.id }] : []),
    ...flattenFileGroups(node.children ?? [], node.id > 0 ? depth + 1 : depth),
  ]);
}

const knowledgeFileExtensions = new Set(["txt", "md", "markdown", "pdf", "docx"]);

export function AiKnowledgePage() {
  const queryClient = useQueryClient();
  const hasAccess = useAuthStore((state) => state.hasAccess);
  const [baseForm] = Form.useForm();
  const scopeType = Form.useWatch("scopeType", baseForm);
  const chunkPreset = Form.useWatch("chunkPreset", baseForm) as ChunkPreset | undefined;
  const [baseDrawerOpen, setBaseDrawerOpen] = useState(false);
  const [editingBase, setEditingBase] = useState<KnowledgeBase | null>(null);
  const [selectedBaseId, setSelectedBaseId] = useState<number | null>(null);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>("upload");
  const [sourceGroupId, setSourceGroupId] = useState(1);
  const [fileKeyword, setFileKeyword] = useState("");
  const [debouncedFileKeyword, setDebouncedFileKeyword] = useState("");
  const [selectedExistingFiles, setSelectedExistingFiles] = useState<SelectedFileOption[]>([]);
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [documentPagination, setDocumentPagination] = useState({ current: 1, pageSize: 10 });
  const [question, setQuestion] = useState("");
  const [askBaseIds, setAskBaseIds] = useState<number[]>([]);
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);

  const basesQuery = useQuery({
    queryKey: ["system-ai-knowledge-bases"],
    queryFn: () => request<KnowledgeBase[]>("/api/system/ai/knowledge"),
  });
  const activeBaseId =
    selectedBaseId && basesQuery.data?.some((item) => item.id === selectedBaseId)
      ? selectedBaseId
      : (basesQuery.data?.[0]?.id ?? null);
  const documentsQuery = useQuery({
    queryKey: [
      "system-ai-knowledge-documents",
      activeBaseId,
      documentPagination.current,
      documentPagination.pageSize,
    ],
    queryFn: () =>
      request<PageResult<KnowledgeDocument>>(
        `/api/system/ai/knowledge/${activeBaseId}/documents?page=${documentPagination.current}&pageSize=${documentPagination.pageSize}`,
      ),
    enabled: Boolean(activeBaseId),
    placeholderData: keepPreviousData,
  });
  const fileGroupsQuery = useQuery({
    queryKey: ["system-file-groups", "knowledge-source"],
    queryFn: () => request<FileGroup[]>("/api/system/file/group/tree", { silent: true }),
    enabled: fileModalOpen,
  });
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedFileKeyword(fileKeyword.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [fileKeyword]);
  const filesQuery = useInfiniteQuery({
    queryKey: [
      "system-ai-knowledge-file-options",
      activeBaseId,
      sourceGroupId,
      debouncedFileKeyword,
    ],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        groupId: String(sourceGroupId),
        page: String(pageParam),
        pageSize: "50",
      });
      if (debouncedFileKeyword) params.set("keyword", debouncedFileKeyword);
      return request<PageResult<FileOption>>(
        `/api/system/ai/knowledge/${activeBaseId}/source-files?${params.toString()}`,
        { silent: true, signal },
      );
    },
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined,
    enabled:
      fileModalOpen && sourceMode === "existing" && Boolean(activeBaseId) && sourceGroupId > 0,
  });
  const deptsQuery = useQuery({
    queryKey: ["system-dept-tree", "knowledge"],
    queryFn: () => request<DeptNode[]>("/api/system/dept/tree"),
    enabled: baseDrawerOpen && scopeType === "department",
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["system-ai-knowledge-bases"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-knowledge-documents"] }),
    ]);
  };

  const saveBase = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      request(
        editingBase ? `/api/system/ai/knowledge/${editingBase.id}` : "/api/system/ai/knowledge",
        {
          method: editingBase ? "PUT" : "POST",
          body: JSON.stringify(values),
        },
      ),
    onSuccess: async () => {
      feedback.success(editingBase ? "知识库已更新" : "知识库已创建");
      setBaseDrawerOpen(false);
      setEditingBase(null);
      baseForm.resetFields();
      await refresh();
    },
  });
  const deleteBase = useMutation({
    mutationFn: (id: number) => request(`/api/system/ai/knowledge/${id}`, { method: "DELETE" }),
    onSuccess: async (_data, id) => {
      feedback.success("知识库已删除");
      if (selectedBaseId === id) setSelectedBaseId(null);
      await refresh();
    },
  });
  const addSources = useMutation({
    mutationFn: async () => {
      const fileIds = selectedExistingFiles.map((item) => item.value);
      if (sourceMode === "upload") {
        for (const item of uploadFiles) {
          if (!item.originFileObj) continue;
          const formData = new FormData();
          formData.append("file", item.originFileObj);
          await request<KnowledgeUploadResult>(
            `/api/system/ai/knowledge/${activeBaseId}/documents/upload`,
            { method: "POST", body: formData },
          );
        }
      }
      for (const fileId of sourceMode === "existing" ? fileIds : []) {
        await request(`/api/system/ai/knowledge/${activeBaseId}/documents`, {
          method: "POST",
          body: { fileId },
        });
      }
      return sourceMode === "upload" ? uploadFiles.length : fileIds.length;
    },
    onSuccess: async (count) => {
      feedback.success(
        sourceMode === "existing"
          ? `${count} 个文件已导入为独立知识副本，请开始索引`
          : `${count} 个来源已上传，请开始索引`,
      );
      setFileModalOpen(false);
      setFileKeyword("");
      setSelectedExistingFiles([]);
      setUploadFiles([]);
      setDocumentPagination((value) => ({ ...value, current: 1 }));
      await refresh();
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["system-file-groups"] });
      await queryClient.invalidateQueries({
        queryKey: ["admin-data-table", "/api/system/file/list"],
      });
    },
  });
  const indexDocument = useMutation({
    mutationFn: (id: number) =>
      request(`/api/system/ai/knowledge/documents/${id}/index`, { method: "POST" }),
    onSuccess: async () => {
      feedback.success("文档索引已完成");
      await refresh();
    },
  });
  const statusDocument = useMutation({
    mutationFn: ({ id, status }: { id: number; status: "ready" | "disabled" }) =>
      request(`/api/system/ai/knowledge/documents/${id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status }),
      }),
    onSuccess: async () => {
      feedback.success("文档状态已更新");
      await refresh();
    },
  });
  const deleteDocument = useMutation({
    mutationFn: (id: number) =>
      request(`/api/system/ai/knowledge/documents/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      feedback.success("知识文档已删除");
      if ((documentsQuery.data?.data.length ?? 0) <= 1 && documentPagination.current > 1) {
        setDocumentPagination((value) => ({ ...value, current: value.current - 1 }));
      }
      await refresh();
    },
  });
  const askMutation = useMutation({
    mutationFn: () =>
      request<AskResult>("/api/system/ai/knowledge/ask", {
        method: "POST",
        body: JSON.stringify({ query: question, knowledgeBaseIds: askBaseIds }),
      }),
    onSuccess: (data) => setAnswer(data),
  });

  const baseOptions = (basesQuery.data ?? [])
    .filter((item) => item.status === 1)
    .map((item) => ({ label: item.name, value: item.id }));
  const selectedBase = (basesQuery.data ?? []).find((item) => item.id === activeBaseId) ?? null;
  const fileOptions = useMemo(
    () =>
      (filesQuery.data?.pages.flatMap((page) => page.data) ?? []).map((file) => ({
        label: `${file.originalName} · ${formatBytes(file.size)}`,
        value: file.id,
      })),
    [filesQuery.data?.pages],
  );
  const loadedFileCount =
    filesQuery.data?.pages.reduce((sum, page) => sum + page.data.length, 0) ?? 0;
  const availableFileTotal = filesQuery.data?.pages[0]?.total ?? 0;
  const fileGroupOptions = useMemo(
    () => flattenFileGroups(fileGroupsQuery.data ?? []),
    [fileGroupsQuery.data],
  );
  const selectedCitationIndex = selectedCitation
    ? (answer?.citations ?? []).findIndex(
        (citation) => citation.chunkId === selectedCitation.chunkId,
      )
    : -1;

  const openSourceModal = () => {
    setSourceMode("upload");
    setSourceGroupId(1);
    setFileKeyword("");
    setDebouncedFileKeyword("");
    setSelectedExistingFiles([]);
    setUploadFiles([]);
    setFileModalOpen(true);
  };

  const canSubmitSources =
    sourceMode === "upload"
      ? uploadFiles.some((item) => item.originFileObj)
      : sourceGroupId > 0 && selectedExistingFiles.length > 0;

  const openCreate = () => {
    setEditingBase(null);
    baseForm.setFieldsValue({
      scopeType: "global",
      chunkPreset: "auto",
      chunkSize: chunkPresets.auto.size,
      chunkOverlap: chunkPresets.auto.overlap,
      status: 1,
      sort: 0,
    });
    setBaseDrawerOpen(true);
  };
  const openEdit = (record: KnowledgeBase) => {
    setEditingBase(record);
    baseForm.setFieldsValue(record);
    setBaseDrawerOpen(true);
  };

  const baseColumns = [
    {
      title: "知识库",
      dataIndex: "name",
      width: 260,
      render: (_: unknown, record: KnowledgeBase) => (
        <div className="knowledge-base-link">
          <strong>{record.name}</strong>
          <span>{record.code}</span>
        </div>
      ),
    },
    {
      title: "范围",
      dataIndex: "scopeType",
      width: 150,
      render: (value: ScopeType, record: KnowledgeBase) => (
        <Space size={6}>
          <Tag color={value === "global" ? "blue" : value === "department" ? "cyan" : "default"}>
            {scopeLabels[value]}
          </Tag>
          <Typography.Text type="secondary">
            {value === "department" ? record.deptName : value === "user" ? record.ownerName : null}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "文档",
      dataIndex: "documentCount",
      width: 150,
      render: (_: unknown, record: KnowledgeBase) => (
        <span>
          {record.readyDocumentCount} / {record.documentCount} 可检索
        </span>
      ),
    },
    {
      title: "分块",
      dataIndex: "chunkCount",
      width: 150,
      render: (value: number, record: KnowledgeBase) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text>{value}</Typography.Text>
          <Typography.Text type="secondary">
            {chunkPresets[record.chunkPreset]?.label ?? record.chunkPreset}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (value: number) => (
        <Tag color={value === 1 ? "success" : "default"}>{value === 1 ? "启用" : "停用"}</Tag>
      ),
    },
    { title: "更新时间", dataIndex: "updatedAt", width: 180, render: formatDate },
    {
      title: "操作",
      key: "actions",
      width: 112,
      fixed: "right" as const,
      render: (_: unknown, record: KnowledgeBase) => (
        <Space size={4}>
          <AuthButton auth="system.aiKnowledge.update">
            <Tooltip title="编辑">
              <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
            </Tooltip>
          </AuthButton>
          <AuthButton auth="system.aiKnowledge.delete">
            <Popconfirm title="删除知识库及其索引？" onConfirm={() => deleteBase.mutate(record.id)}>
              <Tooltip title="删除">
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          </AuthButton>
        </Space>
      ),
    },
  ];

  const documentColumns = [
    {
      title: "来源文档",
      dataIndex: "name",
      width: 300,
      render: (value: string, record: KnowledgeDocument) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text type="secondary">
            v{record.version} · {record.ext?.toUpperCase()} · {formatBytes(record.size)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "索引状态",
      dataIndex: "status",
      width: 150,
      render: (value: KnowledgeDocument["status"], record: KnowledgeDocument) => (
        <Tooltip title={record.errorMessage || undefined}>
          <Tag color={statusMeta[value].color}>{statusMeta[value].text}</Tag>
        </Tooltip>
      ),
    },
    { title: "字符", dataIndex: "characterCount", width: 100 },
    { title: "分块", dataIndex: "chunkCount", width: 90 },
    { title: "索引时间", dataIndex: "indexedAt", width: 180, render: formatDate },
    {
      title: "操作",
      key: "actions",
      width: 170,
      fixed: "right" as const,
      render: (_: unknown, record: KnowledgeDocument) => (
        <Space size={4}>
          <AuthButton auth="system.aiKnowledge.index">
            <Tooltip title={record.status === "ready" ? "重新索引" : "建立索引"}>
              <Button
                size="small"
                icon={<SyncOutlined />}
                loading={indexDocument.isPending && indexDocument.variables === record.id}
                disabled={record.status === "processing" || record.status === "disabled"}
                onClick={() => indexDocument.mutate(record.id)}
              />
            </Tooltip>
          </AuthButton>
          <AuthButton auth="system.aiKnowledge.update">
            <Tooltip title={record.status === "disabled" ? "启用" : "停用"}>
              <Switch
                size="small"
                checked={record.status === "ready"}
                disabled={!(["ready", "disabled"] as string[]).includes(record.status)}
                loading={statusDocument.isPending}
                onChange={(checked) =>
                  statusDocument.mutate({ id: record.id, status: checked ? "ready" : "disabled" })
                }
              />
            </Tooltip>
          </AuthButton>
          <AuthButton auth="system.aiKnowledge.delete">
            <Popconfirm
              title="删除该知识文档？源文件不会被删除。"
              onConfirm={() => deleteDocument.mutate(record.id)}
            >
              <Tooltip title="移除">
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          </AuthButton>
        </Space>
      ),
    },
  ];

  return (
    <PageScaffold
      title="知识库"
      description="管理可信来源、建立混合索引并生成带引用的回答"
      hideHeader
    >
      <Tabs
        className="admin-fill-tabs knowledge-tabs"
        items={[
          {
            key: "sources",
            label: "知识与来源",
            children: (
              <div className="knowledge-source-workspace admin-fill-workspace">
                <section className="admin-card knowledge-base-panel">
                  <div className="knowledge-toolbar">
                    <Space>
                      <BookOutlined />
                      <Typography.Text strong>知识库</Typography.Text>
                      <Typography.Text type="secondary">
                        {basesQuery.data?.length ?? 0} 个
                      </Typography.Text>
                    </Space>
                    <Space>
                      <Button icon={<ReloadOutlined />} onClick={() => void refresh()} />
                      <AuthButton auth="system.aiKnowledge.create">
                        <Button type="primary" onClick={openCreate}>
                          创建
                        </Button>
                      </AuthButton>
                    </Space>
                  </div>
                  <div className="knowledge-table-viewport">
                    <Table<KnowledgeBase>
                      rowKey="id"
                      className="admin-fill-table knowledge-source-table"
                      columns={baseColumns}
                      dataSource={basesQuery.data ?? []}
                      loading={basesQuery.isLoading}
                      pagination={false}
                      scroll={{ x: 1050, y: "100%" }}
                      rowClassName={(record) =>
                        record.id === activeBaseId ? "ant-table-row-selected" : ""
                      }
                      onRow={(record) => ({
                        onClick: () => {
                          setSelectedBaseId(record.id);
                          setDocumentPagination((value) => ({ ...value, current: 1 }));
                        },
                        style: { cursor: "pointer" },
                      })}
                      locale={{ emptyText: <Empty description="还没有知识库" /> }}
                    />
                  </div>
                </section>

                <section className="admin-card knowledge-document-panel">
                  <div className="knowledge-toolbar">
                    <Space>
                      <FileSearchOutlined />
                      <Typography.Text strong>
                        {selectedBase ? selectedBase.name : "来源文档"}
                      </Typography.Text>
                      {selectedBase ? <Tag>{selectedBase.code}</Tag> : null}
                    </Space>
                    <AuthButton auth="system.aiKnowledge.create">
                      <AuthButton auth="system.file.query">
                        <Button
                          icon={<FileAddOutlined />}
                          disabled={!activeBaseId}
                          onClick={openSourceModal}
                        >
                          添加来源
                        </Button>
                      </AuthButton>
                    </AuthButton>
                  </div>
                  {activeBaseId ? (
                    <div className="knowledge-table-viewport">
                      <Table<KnowledgeDocument>
                        rowKey="id"
                        className="admin-fill-table knowledge-source-table"
                        columns={documentColumns}
                        dataSource={documentsQuery.data?.data ?? []}
                        loading={documentsQuery.isFetching}
                        pagination={{
                          current: documentPagination.current,
                          pageSize: documentPagination.pageSize,
                          total: documentsQuery.data?.total ?? 0,
                          showSizeChanger: true,
                          pageSizeOptions: [10, 20, 50],
                          showTotal: (total) => `共 ${total} 个来源`,
                          onChange: (current, pageSize) =>
                            setDocumentPagination({ current, pageSize }),
                        }}
                        scroll={{ x: 1050, y: "100%" }}
                        locale={{ emptyText: <Empty description="还没有来源文档" /> }}
                      />
                    </div>
                  ) : (
                    <Empty description="选择一个知识库查看来源文档" />
                  )}
                </section>
              </div>
            ),
          },
          {
            key: "ask",
            label: "检索与问答",
            children: (
              <div className="knowledge-ask-workspace admin-fill-workspace">
                <section className="admin-card knowledge-question-panel">
                  <Typography.Title level={5}>知识库问答</Typography.Title>
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="选择知识库；留空表示搜索全部可访问知识库"
                    options={baseOptions}
                    value={askBaseIds}
                    onChange={setAskBaseIds}
                  />
                  <Input.TextArea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    autoSize={{ minRows: 5, maxRows: 10 }}
                    maxLength={8000}
                    placeholder="输入需要依据内部资料回答的问题"
                  />
                  <AuthButton auth="system.aiKnowledge.search">
                    <Button
                      type="primary"
                      icon={<SendOutlined />}
                      loading={askMutation.isPending}
                      disabled={!question.trim()}
                      onClick={() => {
                        setAnswer(null);
                        askMutation.mutate();
                      }}
                    >
                      生成回答
                    </Button>
                  </AuthButton>
                  <Typography.Text type="secondary">
                    使用 RAG 回答用途的主模型与有序候选模型；资料不足时不会补写事实。
                  </Typography.Text>
                </section>
                <section className="admin-card knowledge-answer-panel">
                  <div className="knowledge-answer-heading">
                    <Typography.Title level={5}>回答</Typography.Title>
                    {answer ? (
                      <Space>
                        <Tag>Run #{answer.runId}</Tag>
                        {answer.invocationId ? (
                          <Tag color="blue">Trace #{answer.invocationId}</Tag>
                        ) : null}
                      </Space>
                    ) : null}
                  </div>
                  {askMutation.isError ? (
                    <Alert
                      type="error"
                      showIcon
                      title="问答失败"
                      description={askMutation.error.message}
                    />
                  ) : null}
                  <StreamingMarkdown
                    content={answer?.answer ?? ""}
                    placeholder={
                      askMutation.isPending
                        ? "正在检索并组织有依据的回答..."
                        : "提交问题后在这里查看回答"
                    }
                    minHeight={180}
                    maxHeight={null}
                    mode="static"
                    citationCount={answer?.citations.length ?? 0}
                    onCitationClick={(citationNumber) => {
                      const citation = answer?.citations[citationNumber - 1];
                      if (citation) setSelectedCitation(citation);
                    }}
                  />
                  {answer?.citations.length ? (
                    <div className="knowledge-citations">
                      <Typography.Text strong>引用依据</Typography.Text>
                      {answer.citations.map((citation, index) => (
                        <button
                          type="button"
                          className="knowledge-citation-item"
                          key={citation.chunkId}
                          onClick={() => setSelectedCitation(citation)}
                        >
                          <span className="knowledge-citation-rank">{index + 1}</span>
                          <span>
                            <strong>{citation.documentName}</strong>
                            <small>
                              {citation.knowledgeBaseName} · 分块 {citation.chunkNo} ·
                              {citation.retrievalMode === "hybrid_rerank"
                                ? " Rerank "
                                : " 混合检索 "}
                              {(citation.score * 100).toFixed(1)}%
                            </small>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              </div>
            ),
          },
        ]}
      />

      <Drawer
        title={editingBase ? "编辑知识库" : "创建知识库"}
        open={baseDrawerOpen}
        size={600}
        destroyOnHidden
        onClose={() => setBaseDrawerOpen(false)}
        extra={
          <Button type="primary" loading={saveBase.isPending} onClick={() => baseForm.submit()}>
            保存
          </Button>
        }
      >
        <Form form={baseForm} layout="vertical" onFinish={(values) => saveBase.mutate(values)}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item name="code" label="编码" rules={[{ required: true }]}>
            <Input maxLength={100} placeholder="例如 product-docs" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea maxLength={1000} autoSize={{ minRows: 3, maxRows: 6 }} />
          </Form.Item>
          <Form.Item name="scopeType" label="可见范围" rules={[{ required: true }]}>
            <Select
              options={Object.entries(scopeLabels).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          {scopeType === "department" ? (
            <Form.Item name="deptId" label="归属部门" rules={[{ required: true }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={flattenDepts(deptsQuery.data ?? [])}
              />
            </Form.Item>
          ) : null}
          <Typography.Title level={5}>分块策略</Typography.Title>
          <Form.Item
            name="chunkPreset"
            label="分块模板"
            rules={[{ required: true }]}
            extra={
              chunkPreset
                ? chunkPresets[chunkPreset].description
                : "选择适合文档结构的模板，索引时会记录实际配置和版本。"
            }
          >
            <Select
              options={Object.entries(chunkPresets).map(([value, item]) => ({
                value,
                label: item.label,
              }))}
              onChange={(value: ChunkPreset) => {
                const preset = chunkPresets[value];
                baseForm.setFieldsValue({
                  chunkSize: preset.size,
                  chunkOverlap: preset.overlap,
                });
              }}
            />
          </Form.Item>
          <Space align="start" size={16} className="knowledge-chunk-fields">
            <Form.Item
              name="chunkSize"
              label="目标长度（字符）"
              rules={[{ required: true }]}
              extra="这是目标上限，不会强行切断完整段落或句子。"
            >
              <InputNumber min={200} max={12000} step={100} />
            </Form.Item>
            <Form.Item
              name="chunkOverlap"
              label="上下文重叠（字符）"
              dependencies={["chunkSize"]}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator: async (_, value) => {
                    const size = Number(getFieldValue("chunkSize"));
                    if (Number(value) < size && Number(value) <= Math.floor(size * 0.35)) return;
                    throw new Error("必须小于目标长度的 35%");
                  },
                }),
              ]}
              extra="给后一个分块补充上文，减少跨块语义丢失。"
            >
              <InputNumber min={0} max={2000} step={10} />
            </Form.Item>
          </Space>
          <Alert
            type="info"
            showIcon
            title="配置变更后，请对已有文档执行重新索引"
            description="旧索引保留原分块配置快照，不会在保存知识库时自动调用 Embedding。"
          />
          <Form.Item
            name="status"
            label="启用状态"
            valuePropName="checked"
            getValueFromEvent={(checked) => (checked ? 1 : 0)}
            getValueProps={(value) => ({ checked: Number(value) === 1 })}
          >
            <Switch checkedChildren="启用" unCheckedChildren="停用" />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <InputNumber min={0} max={999999} />
          </Form.Item>
        </Form>
      </Drawer>

      <Modal
        title="添加来源文件"
        open={fileModalOpen}
        width={620}
        okText={sourceMode === "upload" ? "上传并添加" : "导入副本"}
        confirmLoading={addSources.isPending}
        okButtonProps={{ disabled: !canSubmitSources }}
        onOk={() => addSources.mutate()}
        onCancel={() => {
          setFileModalOpen(false);
          setFileKeyword("");
          setSelectedExistingFiles([]);
          setUploadFiles([]);
        }}
      >
        <Segmented<SourceMode>
          block
          className="knowledge-source-mode"
          options={[
            { label: "上传知识文档", value: "upload", icon: <CloudUploadOutlined /> },
            ...(hasAccess("system.file.query")
              ? [
                  {
                    label: "从文件库导入",
                    value: "existing" as const,
                    icon: <FileSearchOutlined />,
                  },
                ]
              : []),
          ]}
          value={sourceMode}
          onChange={(value) => {
            setSourceMode(value);
            setFileKeyword("");
            setDebouncedFileKeyword("");
            setSelectedExistingFiles([]);
            setUploadFiles([]);
          }}
        />
        <Form layout="vertical" className="knowledge-source-form">
          {sourceMode === "existing" ? (
            <Form.Item label="普通文件分组" required>
              <TreeSelect
                treeDefaultExpandAll
                loading={fileGroupsQuery.isLoading}
                placeholder="选择文件分组"
                treeData={fileGroupOptions}
                value={sourceGroupId}
                onChange={(value) => {
                  setSourceGroupId(value);
                  setFileKeyword("");
                  setDebouncedFileKeyword("");
                  setSelectedExistingFiles([]);
                }}
              />
            </Form.Item>
          ) : null}
          {sourceMode === "upload" ? (
            <Form.Item label="来源文件" required>
              <Upload.Dragger
                multiple
                maxCount={20}
                accept=".txt,.md,.markdown,.pdf,.docx"
                beforeUpload={(file) => {
                  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
                  if (!knowledgeFileExtensions.has(ext)) {
                    feedback.warning("仅支持 TXT、Markdown、PDF 和 DOCX 文件");
                    return Upload.LIST_IGNORE;
                  }
                  return false;
                }}
                fileList={uploadFiles}
                onChange={({ fileList }) => setUploadFiles(fileList)}
              >
                <p className="ant-upload-drag-icon">
                  <CloudUploadOutlined />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此区域</p>
                <p className="ant-upload-hint">文件只在知识库中管理，不会出现在普通文件管理列表</p>
              </Upload.Dragger>
            </Form.Item>
          ) : (
            <Form.Item label="选择普通文件" required>
              <Select
                mode="multiple"
                labelInValue
                showSearch
                filterOption={false}
                searchValue={fileKeyword}
                onSearch={setFileKeyword}
                loading={filesQuery.isLoading || filesQuery.isFetchingNextPage}
                placeholder="输入文件名搜索，滚动加载更多"
                options={fileOptions}
                value={selectedExistingFiles}
                onChange={(items) =>
                  setSelectedExistingFiles(
                    items.map((item) => ({
                      value: Number(item.value),
                      label: String(item.label ?? item.value),
                    })),
                  )
                }
                onPopupScroll={(event) => {
                  const target = event.currentTarget;
                  const nearBottom =
                    target.scrollTop + target.clientHeight >= target.scrollHeight - 32;
                  if (nearBottom && filesQuery.hasNextPage && !filesQuery.isFetchingNextPage) {
                    void filesQuery.fetchNextPage();
                  }
                }}
                popupRender={(menu) => (
                  <>
                    {menu}
                    <div className="knowledge-source-select-status">
                      {filesQuery.isFetchingNextPage ? <Spin size="small" /> : null}
                      <Typography.Text type="secondary">
                        已加载 {loadedFileCount} / {availableFileTotal}
                      </Typography.Text>
                    </div>
                  </>
                )}
              />
            </Form.Item>
          )}
        </Form>
        <Alert
          type="info"
          showIcon
          title={sourceMode === "upload" ? "上传后需要建立索引" : "导入后创建独立知识副本"}
          description={
            sourceMode === "upload"
              ? "文件只在知识库中管理，不会进入普通文件列表。"
              : "原文件之后被移动、修改或删除，不会影响知识库中的内容和历史引用。"
          }
        />
      </Modal>

      {selectedCitation ? (
        <AiCitationDrawer
          open
          citationNumber={selectedCitationIndex + 1}
          citationCount={answer?.citations.length ?? 0}
          documentName={selectedCitation.documentName}
          knowledgeBaseName={selectedCitation.knowledgeBaseName}
          chunkNo={selectedCitation.chunkNo}
          pageNumber={selectedCitation.pageNumber}
          score={selectedCitation.score}
          content={selectedCitation.content}
          onClose={() => setSelectedCitation(null)}
          onPrevious={
            selectedCitationIndex > 0
              ? () => setSelectedCitation(answer?.citations[selectedCitationIndex - 1] ?? null)
              : undefined
          }
          onNext={
            selectedCitationIndex >= 0 &&
            selectedCitationIndex < (answer?.citations.length ?? 0) - 1
              ? () => setSelectedCitation(answer?.citations[selectedCitationIndex + 1] ?? null)
              : undefined
          }
          details={
            <dl className="ai-citation-retrieval-details">
              <div>
                <dt>段落</dt>
                <dd>
                  {selectedCitation.paragraphStart ?? "-"}-{selectedCitation.paragraphEnd ?? "-"}
                </dd>
              </div>
              <div>
                <dt>检索方式</dt>
                <dd>
                  {selectedCitation.retrievalMode === "hybrid_rerank"
                    ? "混合召回 + Rerank"
                    : selectedCitation.rerankDegraded
                      ? "混合检索（Rerank 已降级）"
                      : "混合检索"}
                </dd>
              </div>
              <div>
                <dt>混合召回分</dt>
                <dd>{(selectedCitation.hybridScore * 100).toFixed(2)}%</dd>
              </div>
              <div>
                <dt>Rerank 分数</dt>
                <dd>
                  {selectedCitation.rerankScore == null
                    ? "不可用"
                    : `${(selectedCitation.rerankScore * 100).toFixed(2)}%`}
                </dd>
              </div>
              <div>
                <dt>向量相似度</dt>
                <dd>
                  {selectedCitation.vectorScore == null
                    ? "不可用"
                    : `${(selectedCitation.vectorScore * 100).toFixed(2)}%`}
                </dd>
              </div>
              {selectedCitation.rerankInvocationId ? (
                <div>
                  <dt>Rerank Trace</dt>
                  <dd>#{selectedCitation.rerankInvocationId}</dd>
                </div>
              ) : null}
              {selectedCitation.rerankErrorType ? (
                <div>
                  <dt>降级原因</dt>
                  <dd>{selectedCitation.rerankErrorType}</dd>
                </div>
              ) : null}
            </dl>
          }
        />
      ) : null}
    </PageScaffold>
  );
}
