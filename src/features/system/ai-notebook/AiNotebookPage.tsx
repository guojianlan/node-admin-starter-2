"use client";

import {
  BookOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  FileAddOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LinkOutlined,
  LeftOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  RightOutlined,
  SendOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Popover,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { AiCitationDrawer } from "@/components/ai/AiCitationDrawer";
import { StreamingMarkdown } from "@/components/ai/StreamingMarkdown";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type ScopeType = "global" | "department" | "user";
type SourceType = "knowledge_base" | "document";
type SourceMode = SourceType | "website" | "search";
type ArtifactType = "summary" | "outline" | "faq" | "brief";
type ComposerMode = "ask" | "research";

type Notebook = {
  id: number;
  name: string;
  description?: string | null;
  scopeType: ScopeType;
  deptId?: number | null;
  deptName?: string | null;
  ownerName?: string | null;
  defaultModelId?: number | null;
  defaultModelName?: string | null;
  systemPrompt?: string | null;
  status: number;
  sort: number;
  sourceCount: number;
  artifactCount: number;
};

type NotebookSource = {
  id: number;
  sourceType: SourceType;
  knowledgeBaseId: number;
  knowledgeBaseName: string;
  documentId?: number | null;
  documentName?: string | null;
  documentVersion?: number | null;
  documentStatus?: string | null;
  contentSourceType?: "file" | "web_url";
  sourceUrl?: string | null;
  canonicalUrl?: string | null;
  sourceDomain?: string | null;
  sourceTitle?: string | null;
  publishedAt?: string | null;
  fetchedAt?: string | null;
};

type Citation = {
  chunkId: number;
  knowledgeBaseId: number;
  knowledgeBaseName: string;
  documentId: number;
  documentName: string;
  fileId: number;
  chunkNo: number;
  content: string;
  pageNumber?: number | null;
  paragraphStart?: number | null;
  paragraphEnd?: number | null;
  score: number;
};

type AskResult = {
  runId: number;
  invocationId?: number | null;
  answer: string;
  citations: Citation[];
  insufficientEvidence: boolean;
};

type ArtifactCitation = Omit<Citation, "content"> & { quote: string };
type Artifact = {
  id: number;
  artifactType: ArtifactType;
  title: string;
  content?: string | null;
  status: "generating" | "completed" | "failed";
  version: number;
  citations: ArtifactCitation[];
  errorMessage?: string | null;
  generatedAt?: string | null;
};

type NotebookOptions = {
  models: Array<{
    id: number;
    name: string;
    modelId: string;
    providerName: string;
    providerCode: string;
  }>;
  departments: Array<{ id: number; name: string }>;
  users: Array<{ id: number; username: string; nickname?: string | null }>;
};

type NotebookMember = {
  userId: number;
  username: string;
  nickname?: string | null;
  role: "viewer" | "editor";
  createdAt: string;
};

type KnowledgeBaseOption = {
  id: number;
  name: string;
  code: string;
  readyDocumentCount: number;
};

type DocumentOption = {
  id: number;
  name: string;
  version: number;
  knowledgeBaseId: number;
  knowledgeBaseName: string;
};

type PageResult<T> = { data: T[]; page: number; pageSize: number; total: number };

type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: string;
};
type WebSearchResponse = {
  provider: { name: string; providerType: string } | null;
  results: WebSearchResult[];
  attempts: Array<{
    providerName: string;
    status: "completed" | "empty" | "failed";
    durationMs: number;
    resultCount: number;
    error?: string;
  }>;
};
type ResearchRun = {
  id: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  input?: { topic?: string; queryCount?: number; maxSources?: number } | null;
  output?: {
    artifactId?: number;
    selectedCount?: number;
    imported?: number;
    reused?: number;
    citationCount?: number;
  } | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  createdAt: string;
  finishedAt?: string | null;
};
type ResearchStep = {
  id: number;
  stepNo: number;
  stepCode: string;
  status: "running" | "completed" | "failed" | "skipped";
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  errorMessage?: string | null;
  durationMs?: number | null;
};
type ResearchRunDetail = ResearchRun & { steps: ResearchStep[] };

const scopeLabels: Record<ScopeType, string> = {
  global: "全局",
  department: "部门",
  user: "个人",
};
const artifactLabels: Record<ArtifactType, string> = {
  summary: "综合摘要",
  outline: "来源提纲",
  faq: "常见问题",
  brief: "结构化简报",
};
const researchStatusMeta: Record<ResearchRun["status"], { color: string; label: string }> = {
  queued: { color: "default", label: "等待执行" },
  running: { color: "processing", label: "研究中" },
  completed: { color: "success", label: "已完成" },
  failed: { color: "error", label: "失败" },
  cancelled: { color: "warning", label: "已取消" },
};
const researchStepLabels: Record<string, string> = {
  plan: "制定检索计划",
  search: "联网搜索",
  import_source: "抓取并索引来源",
  synthesize_report: "生成引用报告",
};

function sourceDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

export function AiNotebookPage() {
  const queryClient = useQueryClient();
  const [notebookForm] = Form.useForm();
  const scopeType = Form.useWatch("scopeType", notebookForm) as ScopeType | undefined;
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(null);
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null);
  const [notebookDrawerOpen, setNotebookDrawerOpen] = useState(false);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>("knowledge_base");
  const [sourceKnowledgeBaseId, setSourceKnowledgeBaseId] = useState<number | null>(null);
  const [sourceTargetId, setSourceTargetId] = useState<number | null>(null);
  const [sourceKeyword, setSourceKeyword] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [webSearchQuery, setWebSearchQuery] = useState("");
  const [webSearchResult, setWebSearchResult] = useState<WebSearchResponse | null>(null);
  const [selectedSearchUrls, setSelectedSearchUrls] = useState<string[]>([]);
  const [debouncedSourceKeyword, setDebouncedSourceKeyword] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<Citation | ArtifactCitation | null>(
    null,
  );
  const [artifactModalOpen, setArtifactModalOpen] = useState(false);
  const [artifactType, setArtifactType] = useState<ArtifactType>("summary");
  const [artifactTitle, setArtifactTitle] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberUserId, setMemberUserId] = useState<number | null>(null);
  const [memberRole, setMemberRole] = useState<"viewer" | "editor">("viewer");
  const [asyncArtifact, setAsyncArtifact] = useState(true);
  const [composerMode, setComposerMode] = useState<ComposerMode>("ask");
  const [researchQueryCount, setResearchQueryCount] = useState(3);
  const [researchMaxSources, setResearchMaxSources] = useState(6);
  const [selectedResearchRunId, setSelectedResearchRunId] = useState<number | null>(null);
  const [inspectorTab, setInspectorTab] = useState("citations");
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"sources" | "answer" | "inspector">("answer");

  const notebooksQuery = useQuery({
    queryKey: ["system-ai-notebooks"],
    queryFn: () => request<Notebook[]>("/api/system/ai/notebook"),
  });
  const activeNotebookId =
    selectedNotebookId && notebooksQuery.data?.some((item) => item.id === selectedNotebookId)
      ? selectedNotebookId
      : (notebooksQuery.data?.[0]?.id ?? null);
  const activeNotebook = notebooksQuery.data?.find((item) => item.id === activeNotebookId) ?? null;
  const optionsQuery = useQuery({
    queryKey: ["system-ai-notebook-options"],
    queryFn: () => request<NotebookOptions>("/api/system/ai/notebook/options", { silent: true }),
  });
  const sourcesQuery = useQuery({
    queryKey: ["system-ai-notebook-sources", activeNotebookId],
    queryFn: () => request<NotebookSource[]>(`/api/system/ai/notebook/${activeNotebookId}/sources`),
    enabled: Boolean(activeNotebookId),
  });
  const artifactsQuery = useQuery({
    queryKey: ["system-ai-notebook-artifacts", activeNotebookId],
    queryFn: () =>
      request<PageResult<Artifact>>(
        `/api/system/ai/notebook/${activeNotebookId}/artifacts?page=1&pageSize=50`,
      ),
    enabled: Boolean(activeNotebookId),
  });
  const membersQuery = useQuery({
    queryKey: ["system-ai-notebook-members", activeNotebookId],
    queryFn: () => request<NotebookMember[]>(`/api/system/ai/notebook/${activeNotebookId}/members`),
    enabled: Boolean(activeNotebookId && memberModalOpen),
  });
  const researchRunsQuery = useQuery({
    queryKey: ["system-ai-notebook-research", activeNotebookId],
    queryFn: () =>
      request<PageResult<ResearchRun>>(
        `/api/system/ai/notebook/${activeNotebookId}/research?page=1&pageSize=20`,
        { silent: true },
      ),
    enabled: Boolean(activeNotebookId),
    refetchInterval: (query) =>
      query.state.data?.data.some((item) => item.status === "queued" || item.status === "running")
        ? 3000
        : false,
  });
  const researchRunQuery = useQuery({
    queryKey: ["system-ai-notebook-research-detail", activeNotebookId, selectedResearchRunId],
    queryFn: () =>
      request<ResearchRunDetail>(
        `/api/system/ai/notebook/${activeNotebookId}/research/${selectedResearchRunId}`,
        { silent: true },
      ),
    enabled: Boolean(activeNotebookId && selectedResearchRunId),
    refetchInterval: (query) =>
      query.state.data?.status === "queued" || query.state.data?.status === "running"
        ? 2000
        : false,
  });

  useEffect(() => {
    if (!researchRunsQuery.data?.data.some((item) => item.status === "completed")) return;
    void queryClient.invalidateQueries({ queryKey: ["system-ai-notebook-sources"] });
    void queryClient.invalidateQueries({ queryKey: ["system-ai-notebook-artifacts"] });
  }, [queryClient, researchRunsQuery.dataUpdatedAt, researchRunsQuery.data?.data]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSourceKeyword(sourceKeyword.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [sourceKeyword]);

  const knowledgeOptionsQuery = useInfiniteQuery({
    queryKey: ["system-ai-notebook-source-options", "knowledge_base", debouncedSourceKeyword],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        sourceType: "knowledge_base",
        page: String(pageParam),
        pageSize: "50",
      });
      if (debouncedSourceKeyword) params.set("keyword", debouncedSourceKeyword);
      return request<PageResult<KnowledgeBaseOption>>(
        `/api/system/ai/notebook/source-options?${params.toString()}`,
        { silent: true, signal },
      );
    },
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: sourceModalOpen,
  });
  const documentOptionsQuery = useInfiniteQuery({
    queryKey: [
      "system-ai-notebook-source-options",
      "document",
      sourceKnowledgeBaseId,
      debouncedSourceKeyword,
    ],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        sourceType: "document",
        knowledgeBaseId: String(sourceKnowledgeBaseId),
        page: String(pageParam),
        pageSize: "50",
      });
      if (debouncedSourceKeyword) params.set("keyword", debouncedSourceKeyword);
      return request<PageResult<DocumentOption>>(
        `/api/system/ai/notebook/source-options?${params.toString()}`,
        { silent: true, signal },
      );
    },
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total ? lastPage.page + 1 : undefined,
    enabled: sourceModalOpen && sourceMode === "document" && Boolean(sourceKnowledgeBaseId),
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["system-ai-notebooks"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-notebook-sources"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-notebook-artifacts"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-notebook-members"] }),
      queryClient.invalidateQueries({ queryKey: ["system-ai-notebook-research"] }),
    ]);
  };

  const saveNotebook = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      request(
        editingNotebook
          ? `/api/system/ai/notebook/${editingNotebook.id}`
          : "/api/system/ai/notebook",
        {
          method: editingNotebook ? "PUT" : "POST",
          body: JSON.stringify(values),
        },
      ),
    onSuccess: async () => {
      feedback.success(editingNotebook ? "Notebook 已更新" : "Notebook 已创建");
      setNotebookDrawerOpen(false);
      setEditingNotebook(null);
      notebookForm.resetFields();
      await refresh();
    },
  });
  const deleteNotebook = useMutation({
    mutationFn: (id: number) => request(`/api/system/ai/notebook/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      feedback.success("Notebook 已删除");
      setSelectedNotebookId(null);
      setAnswer(null);
      await refresh();
    },
  });
  const addSource = useMutation({
    mutationFn: () =>
      request(`/api/system/ai/notebook/${activeNotebookId}/sources`, {
        method: "POST",
        body: JSON.stringify({ sourceType: sourceMode, targetId: sourceTargetId }),
      }),
    onSuccess: async () => {
      feedback.success("来源已添加");
      setSourceModalOpen(false);
      setSourceTargetId(null);
      setSourceKeyword("");
      await refresh();
    },
  });
  const importWebsite = useMutation({
    mutationFn: () =>
      request<{ title: string; reused: boolean }>(
        `/api/system/ai/notebook/${activeNotebookId}/sources/website`,
        {
          method: "POST",
          body: JSON.stringify({ url: websiteUrl.trim() }),
        },
      ),
    onSuccess: async (result) => {
      feedback.success(result.reused ? "网站来源已存在，抓取信息已更新" : "网站已导入并完成索引");
      setSourceModalOpen(false);
      setWebsiteUrl("");
      await refresh();
    },
  });
  const searchWeb = useMutation({
    mutationFn: () =>
      request<WebSearchResponse>(`/api/system/ai/notebook/${activeNotebookId}/sources/search`, {
        method: "POST",
        body: { query: webSearchQuery.trim(), limit: 10 },
      }),
    onSuccess: (result) => {
      setWebSearchResult(result);
      setSelectedSearchUrls([]);
    },
  });
  const importSearchResults = useMutation({
    mutationFn: () => {
      const selected = (webSearchResult?.results ?? []).filter((item) =>
        selectedSearchUrls.includes(item.url),
      );
      return request<{
        imported: unknown[];
        reused: unknown[];
        failed: Array<{ url: string; error: string }>;
      }>(`/api/system/ai/notebook/${activeNotebookId}/sources/search/import`, {
        method: "POST",
        body: { items: selected.map(({ url, title }) => ({ url, title })) },
      });
    },
    onSuccess: async (result) => {
      const successCount = result.imported.length + result.reused.length;
      if (result.failed.length) {
        feedback.warning(`已导入 ${successCount} 项，${result.failed.length} 项失败`);
      } else {
        feedback.success(`已导入 ${successCount} 项网站来源`);
      }
      setSourceModalOpen(false);
      setWebSearchQuery("");
      setWebSearchResult(null);
      setSelectedSearchUrls([]);
      await refresh();
    },
  });
  const removeSource = useMutation({
    mutationFn: (sourceId: number) =>
      request(`/api/system/ai/notebook/${activeNotebookId}/sources/${sourceId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      feedback.success("来源已移除，后续问答将不再使用该来源");
      await refresh();
    },
  });
  const askMutation = useMutation({
    mutationFn: (query: string) =>
      request<AskResult>(`/api/system/ai/notebook/${activeNotebookId}/ask`, {
        method: "POST",
        body: JSON.stringify({ query }),
      }),
    onMutate: () => setAnswer(null),
    onSuccess: (result) => setAnswer(result),
    onError: (_error, query) => setQuestion((value) => value || query),
  });
  const generateArtifact = useMutation({
    mutationFn: () =>
      request<{ id?: number; jobId?: number }>(
        `/api/system/ai/notebook/${activeNotebookId}/artifacts${asyncArtifact ? "/async" : ""}`,
        {
          method: "POST",
          body: JSON.stringify({
            artifactType,
            title: artifactTitle || null,
            customPrompt: artifactType === "brief" ? customPrompt : null,
          }),
        },
      ),
    onSuccess: async (result) => {
      feedback.success(result.jobId ? `Artifact 已进入队列 #${result.jobId}` : "Artifact 已生成");
      setArtifactModalOpen(false);
      setArtifactTitle("");
      setCustomPrompt("");
      await refresh();
    },
  });
  const regenerateArtifact = useMutation({
    mutationFn: (artifactId: number) =>
      request(`/api/system/ai/notebook/artifacts/${artifactId}/regenerate`, { method: "POST" }),
    onSuccess: async () => {
      feedback.success("已生成新版本");
      setSelectedArtifact(null);
      await refresh();
    },
  });
  const deleteArtifact = useMutation({
    mutationFn: (artifactId: number) =>
      request(`/api/system/ai/notebook/artifacts/${artifactId}`, { method: "DELETE" }),
    onSuccess: async () => {
      feedback.success("Artifact 已删除");
      setSelectedArtifact(null);
      await refresh();
    },
  });
  const saveMember = useMutation({
    mutationFn: (input?: { userId: number; role: "viewer" | "editor" }) =>
      request(`/api/system/ai/notebook/${activeNotebookId}/members`, {
        method: "PUT",
        body: input ?? { userId: memberUserId, role: memberRole },
      }),
    onSuccess: async (_, input) => {
      feedback.success("协作者已更新");
      if (!input) setMemberUserId(null);
      await queryClient.invalidateQueries({ queryKey: ["system-ai-notebook-members"] });
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId: number) =>
      request(`/api/system/ai/notebook/${activeNotebookId}/members/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      feedback.success("协作者已移除");
      await queryClient.invalidateQueries({ queryKey: ["system-ai-notebook-members"] });
    },
  });
  const enqueueResearch = useMutation({
    mutationFn: (topic: string) =>
      request<{ runId: number; jobId: number }>(
        `/api/system/ai/notebook/${activeNotebookId}/research`,
        {
          method: "POST",
          body: {
            topic,
            queryCount: researchQueryCount,
            maxSources: researchMaxSources,
          },
        },
      ),
    onSuccess: async (result) => {
      feedback.success(`Deep Research 已进入队列，Run #${result.runId}`);
      setSelectedResearchRunId(result.runId);
      setInspectorTab("research");
      setInspectorCollapsed(false);
      await refresh();
    },
    onError: (_error, topic) => setQuestion((value) => value || topic),
  });
  const cancelResearch = useMutation({
    mutationFn: (runId: number) =>
      request(`/api/system/ai/notebook/${activeNotebookId}/research/${runId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      feedback.success("Deep Research 已取消");
      await refresh();
      await researchRunQuery.refetch();
    },
  });

  const knowledgeOptions = useMemo(
    () => knowledgeOptionsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [knowledgeOptionsQuery.data?.pages],
  );
  const documentOptions = useMemo(
    () => documentOptionsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [documentOptionsQuery.data?.pages],
  );
  const visibleCitations: Array<Citation | ArtifactCitation> = selectedArtifact
    ? selectedArtifact.citations
    : (answer?.citations ?? []);
  const selectedCitationIndex = selectedCitation
    ? visibleCitations.findIndex(
        (citation) =>
          citation.chunkId === selectedCitation.chunkId &&
          citation.documentId === selectedCitation.documentId,
      )
    : -1;
  const sourceCount = sourcesQuery.data?.length ?? 0;
  const activeResearchRun = researchRunsQuery.data?.data.find(
    (item) => item.status === "queued" || item.status === "running",
  );
  const composerPending = askMutation.isPending || enqueueResearch.isPending;
  const canSubmitComposer =
    question.trim().length >= (composerMode === "research" ? 2 : 1) &&
    (composerMode === "research" || sourceCount > 0) &&
    !composerPending;

  const submitComposer = () => {
    const value = question.trim();
    if (!canSubmitComposer) return;
    setQuestion("");
    if (composerMode === "research") {
      enqueueResearch.mutate(value);
      return;
    }
    askMutation.mutate(value);
  };

  const activateResearchComposer = () => {
    setComposerMode("research");
    setMobilePanel("answer");
  };

  const openCreateNotebook = () => {
    setEditingNotebook(null);
    notebookForm.setFieldsValue({ scopeType: "user", status: 1, sort: 0 });
    setNotebookDrawerOpen(true);
  };
  const openEditNotebook = () => {
    if (!activeNotebook) return;
    setEditingNotebook(activeNotebook);
    notebookForm.setFieldsValue(activeNotebook);
    setNotebookDrawerOpen(true);
  };
  const openSourceModal = () => {
    setSourceMode("knowledge_base");
    setSourceKnowledgeBaseId(null);
    setSourceTargetId(null);
    setSourceKeyword("");
    setDebouncedSourceKeyword("");
    setWebsiteUrl("");
    setWebSearchQuery("");
    setWebSearchResult(null);
    setSelectedSearchUrls([]);
    setSourceModalOpen(true);
  };

  return (
    <PageScaffold
      title="AI Notebook"
      description="组织可信来源、基于来源问答并沉淀可复用产物"
      hideHeader
      className="ai-notebook-page"
    >
      <div className="ai-notebook-shell admin-fill-workspace">
        <header className="ai-notebook-header">
          <div className="ai-notebook-selector">
            <span className="ai-notebook-brand-icon" aria-hidden="true">
              <BookOutlined />
            </span>
            <div className="ai-notebook-identity">
              <Typography.Text type="secondary">AI Notebook</Typography.Text>
              <Select
                className="ai-notebook-select"
                variant="borderless"
                loading={notebooksQuery.isLoading}
                placeholder="选择 Notebook"
                value={activeNotebookId}
                options={(notebooksQuery.data ?? []).map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                onChange={(value) => {
                  setSelectedNotebookId(value);
                  setAnswer(null);
                  setSelectedArtifact(null);
                }}
              />
            </div>
            {activeNotebook ? (
              <div className="ai-notebook-meta">
                <Tag color={activeNotebook.status === 1 ? "success" : "default"}>
                  {activeNotebook.status === 1 ? "已启用" : "已停用"}
                </Tag>
                <Tag>{scopeLabels[activeNotebook.scopeType]}</Tag>
                <Typography.Text type="secondary" ellipsis>
                  {activeNotebook.defaultModelName || "使用 RAG 默认模型"}
                </Typography.Text>
              </div>
            ) : null}
          </div>
          <Space className="ai-notebook-actions" wrap>
            <Tooltip title="刷新">
              <Button icon={<ReloadOutlined />} onClick={() => void refresh()} />
            </Tooltip>
            <AuthButton auth="system.aiNotebook.update">
              <Button icon={<EditOutlined />} disabled={!activeNotebook} onClick={openEditNotebook}>
                编辑
              </Button>
            </AuthButton>
            <AuthButton auth="system.aiNotebook.artifact">
              <Button
                icon={<ExperimentOutlined />}
                disabled={!activeNotebook}
                onClick={activateResearchComposer}
              >
                联网研究
              </Button>
            </AuthButton>
            <AuthButton auth="system.aiNotebook.update">
              <Button
                icon={<TeamOutlined />}
                disabled={!activeNotebook}
                onClick={() => setMemberModalOpen(true)}
              >
                协作
              </Button>
            </AuthButton>
            <AuthButton auth="system.aiNotebook.delete">
              <Tooltip title="删除 Notebook">
                <Popconfirm
                  title="删除当前 Notebook？"
                  description="来源和产物将不再显示，历史 RAG 引用仍保留。"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => activeNotebook && deleteNotebook.mutate(activeNotebook.id)}
                >
                  <Button
                    danger
                    aria-label="删除 Notebook"
                    icon={<DeleteOutlined />}
                    disabled={!activeNotebook}
                  />
                </Popconfirm>
              </Tooltip>
            </AuthButton>
            <AuthButton auth="system.aiNotebook.create">
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateNotebook}>
                创建
              </Button>
            </AuthButton>
          </Space>
        </header>

        {notebooksQuery.isError ? (
          <Alert
            type="error"
            showIcon
            title="Notebook 加载失败"
            description={notebooksQuery.error.message}
          />
        ) : null}

        {activeNotebook ? (
          <div className="ai-notebook-workspace">
            <Segmented
              block
              className="ai-notebook-mobile-nav"
              value={mobilePanel}
              options={[
                { label: `来源 ${sourcesQuery.data?.length ?? 0}`, value: "sources" },
                { label: "问答", value: "answer" },
                { label: `证据 ${answer?.citations.length ?? 0}`, value: "inspector" },
              ]}
              onChange={(value) => setMobilePanel(value as "sources" | "answer" | "inspector")}
            />
            <div
              className="ai-notebook-workbench"
              data-sources-collapsed={sourcesCollapsed}
              data-inspector-collapsed={inspectorCollapsed}
            >
              <section
                className={`ai-notebook-panel ai-notebook-sources${
                  sourcesCollapsed ? " is-collapsed" : ""
                }${mobilePanel === "sources" ? " is-mobile-active" : ""}`}
              >
                <div className="ai-notebook-panel-header">
                  <div className="ai-notebook-panel-title">
                    <Typography.Text strong>来源</Typography.Text>
                    <Typography.Text type="secondary">
                      {sourcesQuery.data?.length ?? 0} 项
                    </Typography.Text>
                  </div>
                  <div className="ai-notebook-panel-actions">
                    <AuthButton auth="system.aiNotebook.source">
                      <Button size="small" icon={<FileAddOutlined />} onClick={openSourceModal}>
                        添加
                      </Button>
                    </AuthButton>
                    <Tooltip title={sourcesCollapsed ? "展开来源" : "收起来源"}>
                      <Button
                        className="ai-notebook-collapse-button"
                        type="text"
                        size="small"
                        aria-label={sourcesCollapsed ? "展开来源" : "收起来源"}
                        icon={sourcesCollapsed ? <RightOutlined /> : <LeftOutlined />}
                        onClick={() => setSourcesCollapsed((value) => !value)}
                      />
                    </Tooltip>
                  </div>
                </div>
                <div className="ai-notebook-panel-scroll">
                  <Spin spinning={sourcesQuery.isFetching}>
                    <List
                      className="ai-notebook-source-list"
                      dataSource={sourcesQuery.data ?? []}
                      locale={{
                        emptyText: (
                          <Empty description="还没有来源" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                        ),
                      }}
                      renderItem={(source) => (
                        <List.Item
                          actions={[
                            ...(source.contentSourceType === "web_url" && source.canonicalUrl
                              ? [
                                  <Tooltip title="打开原网页" key="open-source">
                                    <Button
                                      type="text"
                                      size="small"
                                      aria-label="打开原网页"
                                      icon={<LinkOutlined />}
                                      href={source.canonicalUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    />
                                  </Tooltip>,
                                ]
                              : []),
                            <span className="ai-notebook-row-action" key="remove-source">
                              <AuthButton auth="system.aiNotebook.source">
                                <Popconfirm
                                  title="移除这个来源？"
                                  description="只影响后续问答，历史引用不会删除。"
                                  onConfirm={() => removeSource.mutate(source.id)}
                                >
                                  <Button
                                    type="text"
                                    danger
                                    size="small"
                                    aria-label="移除来源"
                                    icon={<DeleteOutlined />}
                                  />
                                </Popconfirm>
                              </AuthButton>
                            </span>,
                          ]}
                        >
                          <List.Item.Meta
                            avatar={
                              <span className="ai-notebook-source-icon">
                                {source.contentSourceType === "web_url" ? (
                                  <GlobalOutlined />
                                ) : (
                                  <FileTextOutlined />
                                )}
                              </span>
                            }
                            title={
                              source.sourceTitle || source.documentName || source.knowledgeBaseName
                            }
                            description={
                              <Space size={4} wrap>
                                <Tag>
                                  {source.contentSourceType === "web_url"
                                    ? "网站"
                                    : source.sourceType === "knowledge_base"
                                      ? "知识库"
                                      : "文档"}
                                </Tag>
                                {source.contentSourceType === "web_url" ? (
                                  <Typography.Text type="secondary" ellipsis>
                                    {source.sourceDomain} · {formatTime(source.fetchedAt)}
                                  </Typography.Text>
                                ) : source.documentName ? (
                                  <Typography.Text type="secondary" ellipsis>
                                    {source.knowledgeBaseName} · v{source.documentVersion}
                                  </Typography.Text>
                                ) : null}
                              </Space>
                            }
                          />
                        </List.Item>
                      )}
                    />
                  </Spin>
                </div>
              </section>

              <section
                className={`ai-notebook-panel ai-notebook-answer${
                  mobilePanel === "answer" ? " is-mobile-active" : ""
                }`}
              >
                <div className="ai-notebook-panel-header">
                  <div className="ai-notebook-panel-title">
                    <Typography.Text strong>
                      {composerMode === "research" ? "联网研究" : "基于来源问答"}
                    </Typography.Text>
                    {answer ? (
                      <Typography.Text type="secondary">
                        Run #{answer.runId}
                        {answer.invocationId ? ` · Trace #${answer.invocationId}` : ""}
                      </Typography.Text>
                    ) : null}
                  </div>
                  <Tag
                    color={
                      composerMode === "research"
                        ? "processing"
                        : (sourcesQuery.data?.length ?? 0) > 0
                          ? "processing"
                          : "warning"
                    }
                  >
                    {composerMode === "research"
                      ? "自动规划来源"
                      : (sourcesQuery.data?.length ?? 0) > 0
                        ? "来源已限定"
                        : "等待来源"}
                  </Tag>
                </div>
                <div className="ai-notebook-answer-scroll">
                  {askMutation.isError ? (
                    <Alert
                      type="error"
                      showIcon
                      title="问答失败"
                      description={askMutation.error.message}
                    />
                  ) : null}
                  {!answer && !askMutation.isPending ? (
                    <div className="ai-notebook-answer-empty">
                      <span aria-hidden="true">
                        {composerMode === "research" ? <GlobalOutlined /> : <BookOutlined />}
                      </span>
                      <Typography.Text strong>
                        {composerMode === "research" ? "从一个研究目标开始" : "开始研究当前来源"}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {composerMode === "research"
                          ? "AI 会制定检索计划、建立来源快照并生成引用报告"
                          : "提出问题后，回答会附带可追溯引用"}
                      </Typography.Text>
                    </div>
                  ) : (
                    <StreamingMarkdown
                      content={answer?.answer ?? ""}
                      placeholder="正在检索当前 Notebook 来源并组织回答..."
                      minHeight={240}
                      maxHeight={null}
                      mode="static"
                      citationCount={answer?.citations.length ?? 0}
                      onCitationClick={(citationNumber) => {
                        const citation = answer?.citations[citationNumber - 1];
                        if (citation) setSelectedCitation(citation);
                      }}
                    />
                  )}
                </div>
                <div className="ai-notebook-composer">
                  {activeResearchRun ? (
                    <button
                      type="button"
                      className="ai-notebook-research-progress"
                      onClick={() => {
                        setInspectorTab("research");
                        setSelectedResearchRunId(activeResearchRun.id);
                      }}
                    >
                      <Spin size="small" />
                      <span>
                        {activeResearchRun.status === "queued"
                          ? "研究任务等待执行"
                          : "正在规划检索、抓取来源并生成引用报告"}
                      </span>
                      <Typography.Text type="secondary">
                        Run #{activeResearchRun.id}
                      </Typography.Text>
                    </button>
                  ) : null}
                  <div className="ai-notebook-composer-box" data-mode={composerMode}>
                    <Input.TextArea
                      value={question}
                      variant="borderless"
                      maxLength={composerMode === "research" ? 1000 : 8000}
                      autoSize={{ minRows: 2, maxRows: 7 }}
                      placeholder={
                        composerMode === "research"
                          ? "描述研究目标，AI 会规划检索方向、导入可信来源并生成带引用报告"
                          : sourceCount > 0
                            ? "询问当前来源中的事实、差异或结论"
                            : "添加来源，或切换到联网研究自动寻找资料"
                      }
                      onChange={(event) => setQuestion(event.target.value)}
                      onPressEnter={(event) => {
                        if (!event.shiftKey && canSubmitComposer) {
                          event.preventDefault();
                          submitComposer();
                        }
                      }}
                    />
                    <div className="ai-notebook-composer-toolbar">
                      <div className="ai-notebook-composer-context">
                        <Segmented<ComposerMode>
                          size="small"
                          value={composerMode}
                          options={[
                            { label: "问来源", value: "ask", icon: <BookOutlined /> },
                            { label: "联网研究", value: "research", icon: <GlobalOutlined /> },
                          ]}
                          onChange={setComposerMode}
                        />
                        <span className="ai-notebook-source-count">{sourceCount} 个来源</span>
                        {composerMode === "research" ? (
                          <Popover
                            placement="topLeft"
                            trigger="click"
                            content={
                              <div className="ai-notebook-composer-research-settings">
                                <div>
                                  <Typography.Text strong>检索方向</Typography.Text>
                                  <Typography.Text type="secondary">
                                    AI 生成互补检索词
                                  </Typography.Text>
                                  <InputNumber
                                    min={1}
                                    max={5}
                                    value={researchQueryCount}
                                    onChange={(value) => setResearchQueryCount(value ?? 3)}
                                  />
                                </div>
                                <div>
                                  <Typography.Text strong>最多来源</Typography.Text>
                                  <Typography.Text type="secondary">
                                    安全抓取并独立索引
                                  </Typography.Text>
                                  <InputNumber
                                    min={1}
                                    max={10}
                                    value={researchMaxSources}
                                    onChange={(value) => setResearchMaxSources(value ?? 6)}
                                  />
                                </div>
                              </div>
                            }
                          >
                            <Tooltip title="研究设置">
                              <Button
                                type="text"
                                size="small"
                                aria-label="研究设置"
                                icon={<SettingOutlined />}
                              />
                            </Tooltip>
                          </Popover>
                        ) : null}
                      </div>
                      <AuthButton
                        auth={
                          composerMode === "research"
                            ? "system.aiNotebook.artifact"
                            : "system.aiNotebook.ask"
                        }
                      >
                        <Tooltip title={composerMode === "research" ? "开始联网研究" : "发送问题"}>
                          <Button
                            type="primary"
                            shape="circle"
                            aria-label={composerMode === "research" ? "开始联网研究" : "发送问题"}
                            icon={
                              composerMode === "research" ? (
                                <ExperimentOutlined />
                              ) : (
                                <SendOutlined />
                              )
                            }
                            loading={composerPending}
                            disabled={!canSubmitComposer}
                            onClick={submitComposer}
                          />
                        </Tooltip>
                      </AuthButton>
                    </div>
                    <div className="ai-notebook-composer-caption">
                      {composerMode === "research"
                        ? `自动规划 ${researchQueryCount} 个检索方向，最多导入 ${researchMaxSources} 个来源`
                        : sourceCount > 0
                          ? "回答仅使用当前选中的 Notebook 来源，并附带可追溯引用"
                          : "联网研究可以在没有现有来源时开始，并把找到的资料加入当前 Notebook"}
                    </div>
                  </div>
                </div>
              </section>

              <section
                className={`ai-notebook-panel ai-notebook-inspector${
                  inspectorCollapsed ? " is-collapsed" : ""
                }${mobilePanel === "inspector" ? " is-mobile-active" : ""}`}
              >
                <Tabs
                  activeKey={inspectorTab}
                  onChange={setInspectorTab}
                  tabBarExtraContent={
                    <Tooltip title={inspectorCollapsed ? "展开证据" : "收起证据"}>
                      <Button
                        className="ai-notebook-collapse-button"
                        type="text"
                        size="small"
                        aria-label={inspectorCollapsed ? "展开证据" : "收起证据"}
                        icon={inspectorCollapsed ? <LeftOutlined /> : <RightOutlined />}
                        onClick={() => setInspectorCollapsed((value) => !value)}
                      />
                    </Tooltip>
                  }
                  items={[
                    {
                      key: "citations",
                      label: `引用 ${answer?.citations.length ?? 0}`,
                      children: (
                        <div className="ai-notebook-panel-scroll">
                          <List
                            dataSource={answer?.citations ?? []}
                            locale={{
                              emptyText: (
                                <Empty
                                  description="回答后查看引用"
                                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                                />
                              ),
                            }}
                            renderItem={(citation, index) => (
                              <List.Item
                                className="ai-notebook-citation-row"
                                onClick={() => setSelectedCitation(citation)}
                              >
                                <List.Item.Meta
                                  avatar={
                                    <span className="ai-notebook-citation-index">{index + 1}</span>
                                  }
                                  title={citation.documentName}
                                  description={
                                    <div className="ai-notebook-citation-meta">
                                      <span>{citation.knowledgeBaseName}</span>
                                      <span>分块 {citation.chunkNo}</span>
                                      <span>{(citation.score * 100).toFixed(1)}% 匹配</span>
                                    </div>
                                  }
                                />
                              </List.Item>
                            )}
                          />
                        </div>
                      ),
                    },
                    {
                      key: "artifacts",
                      label: `产物 ${artifactsQuery.data?.total ?? 0}`,
                      children: (
                        <div className="ai-notebook-artifacts-tab">
                          <div className="ai-notebook-artifact-action">
                            <AuthButton auth="system.aiNotebook.artifact">
                              <Button
                                block
                                type="primary"
                                icon={<PlusOutlined />}
                                disabled={(sourcesQuery.data?.length ?? 0) === 0}
                                onClick={() => setArtifactModalOpen(true)}
                              >
                                生成产物
                              </Button>
                            </AuthButton>
                          </div>
                          <div className="ai-notebook-panel-scroll">
                            <List
                              loading={artifactsQuery.isFetching}
                              dataSource={artifactsQuery.data?.data ?? []}
                              locale={{
                                emptyText: (
                                  <Empty
                                    description="还没有产物"
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                  />
                                ),
                              }}
                              renderItem={(artifact) => (
                                <List.Item
                                  className="ai-notebook-artifact-row"
                                  onClick={() => setSelectedArtifact(artifact)}
                                >
                                  <List.Item.Meta
                                    title={artifact.title}
                                    description={
                                      <Space size={4} wrap>
                                        <Tag>{artifactLabels[artifact.artifactType]}</Tag>
                                        <Tag
                                          color={
                                            artifact.status === "completed"
                                              ? "success"
                                              : artifact.status === "failed"
                                                ? "error"
                                                : "processing"
                                          }
                                        >
                                          {artifact.status === "completed"
                                            ? "已完成"
                                            : artifact.status === "failed"
                                              ? "失败"
                                              : "生成中"}
                                        </Tag>
                                        <Typography.Text type="secondary">
                                          v{artifact.version}
                                        </Typography.Text>
                                      </Space>
                                    }
                                  />
                                </List.Item>
                              )}
                            />
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "research",
                      label: `研究 ${researchRunsQuery.data?.total ?? 0}`,
                      children: (
                        <div className="ai-notebook-artifacts-tab">
                          <div className="ai-notebook-artifact-action">
                            <AuthButton auth="system.aiNotebook.artifact">
                              <Button
                                block
                                type="primary"
                                icon={<ExperimentOutlined />}
                                onClick={activateResearchComposer}
                              >
                                在输入框开始研究
                              </Button>
                            </AuthButton>
                          </div>
                          <div className="ai-notebook-panel-scroll">
                            <List
                              loading={researchRunsQuery.isFetching}
                              dataSource={researchRunsQuery.data?.data ?? []}
                              locale={{
                                emptyText: (
                                  <Empty
                                    description="还没有研究任务"
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                  />
                                ),
                              }}
                              renderItem={(run) => {
                                const meta = researchStatusMeta[run.status];
                                return (
                                  <List.Item
                                    className="ai-notebook-artifact-row"
                                    actions={
                                      run.status === "queued" || run.status === "running"
                                        ? [
                                            <AuthButton
                                              key="cancel"
                                              auth="system.aiNotebook.artifact"
                                            >
                                              <Button
                                                type="text"
                                                danger
                                                size="small"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  cancelResearch.mutate(run.id);
                                                }}
                                              >
                                                取消
                                              </Button>
                                            </AuthButton>,
                                          ]
                                        : undefined
                                    }
                                    onClick={() => setSelectedResearchRunId(run.id)}
                                  >
                                    <List.Item.Meta
                                      title={run.input?.topic || `Research Run #${run.id}`}
                                      description={
                                        <Space size={4} wrap>
                                          <Tag color={meta.color}>{meta.label}</Tag>
                                          <Typography.Text type="secondary">
                                            Run #{run.id} · {formatTime(run.createdAt)}
                                          </Typography.Text>
                                        </Space>
                                      }
                                    />
                                  </List.Item>
                                );
                              }}
                            />
                          </div>
                        </div>
                      ),
                    },
                  ]}
                />
              </section>
            </div>
          </div>
        ) : (
          <div className="admin-card ai-notebook-empty">
            <Empty description="创建一个 Notebook 开始组织来源">
              <AuthButton auth="system.aiNotebook.create">
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreateNotebook}>
                  创建 Notebook
                </Button>
              </AuthButton>
            </Empty>
          </div>
        )}
      </div>

      <Drawer
        title={editingNotebook ? "编辑 Notebook" : "创建 Notebook"}
        open={notebookDrawerOpen}
        size={560}
        destroyOnHidden
        onClose={() => setNotebookDrawerOpen(false)}
        extra={
          <Button
            type="primary"
            loading={saveNotebook.isPending}
            onClick={() => notebookForm.submit()}
          >
            保存
          </Button>
        }
      >
        <Form
          form={notebookForm}
          layout="vertical"
          onFinish={(values) => saveNotebook.mutate(values)}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea maxLength={1200} autoSize={{ minRows: 3, maxRows: 6 }} />
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
                options={(optionsQuery.data?.departments ?? []).map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
            </Form.Item>
          ) : null}
          <Form.Item name="defaultModelId" label="默认回答模型">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="留空使用 RAG 用途模型路由"
              options={(optionsQuery.data?.models ?? []).map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.providerName}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="systemPrompt" label="补充指令">
            <Input.TextArea
              maxLength={8000}
              autoSize={{ minRows: 5, maxRows: 12 }}
              placeholder="用于输出风格和任务偏好，不能覆盖来源事实约束"
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
            <Input />
          </Form.Item>
        </Form>
      </Drawer>

      <Modal
        title="Notebook 协作者"
        open={memberModalOpen}
        footer={null}
        onCancel={() => setMemberModalOpen(false)}
      >
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Space.Compact block>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择用户"
              value={memberUserId}
              style={{ flex: 1 }}
              options={(optionsQuery.data?.users ?? []).map((user) => ({
                value: user.id,
                label: `${user.nickname || user.username} · ${user.username}`,
              }))}
              onChange={setMemberUserId}
            />
            <Select
              value={memberRole}
              style={{ width: 120 }}
              options={[
                { value: "viewer", label: "查看者" },
                { value: "editor", label: "编辑者" },
              ]}
              onChange={setMemberRole}
            />
            <Button
              type="primary"
              loading={saveMember.isPending}
              disabled={!memberUserId}
              onClick={() => saveMember.mutate(undefined)}
            >
              添加
            </Button>
          </Space.Compact>
          <List
            loading={membersQuery.isFetching}
            dataSource={membersQuery.data ?? []}
            locale={{
              emptyText: <Empty description="暂无协作者" image={Empty.PRESENTED_IMAGE_SIMPLE} />,
            }}
            renderItem={(member) => (
              <List.Item
                actions={[
                  <Select
                    key="role"
                    size="small"
                    value={member.role}
                    style={{ width: 100 }}
                    options={[
                      { value: "viewer", label: "查看者" },
                      { value: "editor", label: "编辑者" },
                    ]}
                    loading={saveMember.isPending && saveMember.variables?.userId === member.userId}
                    disabled={saveMember.isPending}
                    onChange={(role) => saveMember.mutate({ userId: member.userId, role })}
                  />,
                  <Popconfirm
                    key="remove"
                    title="移除协作者？"
                    onConfirm={() => removeMember.mutate(member.userId)}
                  >
                    <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={member.nickname || member.username}
                  description={`${member.username} · 加入于 ${formatTime(member.createdAt)}`}
                />
              </List.Item>
            )}
          />
        </Space>
      </Modal>

      <Modal
        title="添加 Notebook 来源"
        open={sourceModalOpen}
        width={sourceMode === "search" ? 760 : 620}
        okText={
          sourceMode === "website"
            ? "抓取并导入"
            : sourceMode === "search"
              ? `导入 ${selectedSearchUrls.length} 项`
              : "添加来源"
        }
        confirmLoading={
          addSource.isPending || importWebsite.isPending || importSearchResults.isPending
        }
        okButtonProps={{
          disabled:
            sourceMode === "website"
              ? !websiteUrl.trim()
              : sourceMode === "search"
                ? selectedSearchUrls.length === 0
                : !sourceTargetId,
        }}
        onOk={() =>
          sourceMode === "website"
            ? importWebsite.mutate()
            : sourceMode === "search"
              ? importSearchResults.mutate()
              : addSource.mutate()
        }
        onCancel={() => setSourceModalOpen(false)}
      >
        <Segmented<SourceMode>
          block
          value={sourceMode}
          options={[
            { label: "整个知识库", value: "knowledge_base" },
            { label: "指定文档", value: "document" },
            { label: "添加网站", value: "website" },
            { label: "联网搜索", value: "search" },
          ]}
          onChange={(value) => {
            setSourceMode(value);
            setSourceTargetId(null);
            setSourceKeyword("");
            setWebsiteUrl("");
            setWebSearchQuery("");
            setWebSearchResult(null);
            setSelectedSearchUrls([]);
          }}
        />
        <Space orientation="vertical" size={14} className="ai-notebook-source-form">
          {sourceMode === "website" ? (
            <>
              <Alert
                type="info"
                showIcon
                title="保存网页正文快照"
                description="系统只读取公开 HTML 正文，不执行网页脚本，也不会绕过登录、验证码或付费墙。快照会进入当前 Notebook 的受管知识库并自动建立索引。"
              />
              <Input
                autoFocus
                value={websiteUrl}
                prefix={<GlobalOutlined />}
                placeholder="https://example.com/article"
                maxLength={2048}
                onChange={(event) => setWebsiteUrl(event.target.value)}
                onPressEnter={() => {
                  if (websiteUrl.trim() && !importWebsite.isPending) importWebsite.mutate();
                }}
              />
              {importWebsite.isError ? (
                <Alert
                  type="error"
                  showIcon
                  title="网站导入失败"
                  description={importWebsite.error.message}
                />
              ) : null}
            </>
          ) : null}
          {sourceMode === "search" ? (
            <>
              <Alert
                type="info"
                showIcon
                title="先发现，再选择导入"
                description="搜索摘要只用于选择。系统会重新安全抓取选中网页，保存正文快照并建立索引；未选中的结果不会进入知识库。"
              />
              <Space.Compact block>
                <Input
                  autoFocus
                  value={webSearchQuery}
                  prefix={<SearchOutlined />}
                  placeholder="输入需要查找的主题或问题"
                  maxLength={500}
                  onChange={(event) => setWebSearchQuery(event.target.value)}
                  onPressEnter={() => {
                    if (webSearchQuery.trim() && !searchWeb.isPending) searchWeb.mutate();
                  }}
                />
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  loading={searchWeb.isPending}
                  disabled={!webSearchQuery.trim()}
                  onClick={() => searchWeb.mutate()}
                >
                  搜索
                </Button>
              </Space.Compact>
              {searchWeb.isError ? (
                <Alert
                  type="error"
                  showIcon
                  title="联网搜索失败"
                  description={searchWeb.error.message}
                />
              ) : null}
              {webSearchResult ? (
                <div className="ai-notebook-search-results">
                  <div className="ai-notebook-search-summary">
                    <Typography.Text type="secondary">
                      {webSearchResult.provider
                        ? `${webSearchResult.provider.name} 返回 ${webSearchResult.results.length} 项`
                        : "所有搜索服务均未返回结果"}
                    </Typography.Text>
                    {webSearchResult.results.length ? (
                      <Button
                        type="link"
                        size="small"
                        onClick={() =>
                          setSelectedSearchUrls(
                            selectedSearchUrls.length === webSearchResult.results.length
                              ? []
                              : webSearchResult.results.map((item) => item.url),
                          )
                        }
                      >
                        {selectedSearchUrls.length === webSearchResult.results.length
                          ? "取消全选"
                          : "全选"}
                      </Button>
                    ) : null}
                  </div>
                  <List
                    dataSource={webSearchResult.results}
                    locale={{
                      emptyText: (
                        <Empty
                          description="没有找到可用结果"
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                      ),
                    }}
                    renderItem={(item) => (
                      <List.Item className="ai-notebook-search-result">
                        <Checkbox
                          checked={selectedSearchUrls.includes(item.url)}
                          onChange={(event) =>
                            setSelectedSearchUrls((current) =>
                              event.target.checked
                                ? [...current, item.url]
                                : current.filter((url) => url !== item.url),
                            )
                          }
                        />
                        <div className="ai-notebook-search-result-content">
                          <Typography.Link
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {item.title}
                          </Typography.Link>
                          <Typography.Text type="secondary">
                            {sourceDomain(item.url)} · {item.source}
                          </Typography.Text>
                          <Typography.Paragraph ellipsis={{ rows: 2 }}>
                            {item.snippet || "该结果没有摘要"}
                          </Typography.Paragraph>
                        </div>
                      </List.Item>
                    )}
                  />
                  <Collapse
                    ghost
                    size="small"
                    items={[
                      {
                        key: "attempts",
                        label: `搜索服务调用 ${webSearchResult.attempts.length} 次`,
                        children: (
                          <Space orientation="vertical" size={6}>
                            {webSearchResult.attempts.map((attempt, index) => (
                              <Typography.Text
                                key={`${attempt.providerName}-${index}`}
                                type="secondary"
                              >
                                {attempt.providerName} · {attempt.status} · {attempt.durationMs} ms
                                · {attempt.resultCount} 项
                                {attempt.error ? ` · ${attempt.error}` : ""}
                              </Typography.Text>
                            ))}
                          </Space>
                        ),
                      },
                    ]}
                  />
                </div>
              ) : null}
            </>
          ) : null}
          {sourceMode === "document" ? (
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="先选择知识库"
              value={sourceKnowledgeBaseId}
              options={knowledgeOptions.map((item) => ({ value: item.id, label: item.name }))}
              onChange={(value) => {
                setSourceKnowledgeBaseId(value);
                setSourceTargetId(null);
                setSourceKeyword("");
              }}
            />
          ) : null}
          {sourceMode !== "website" && sourceMode !== "search" ? (
            <Select
              showSearch
              filterOption={false}
              searchValue={sourceKeyword}
              value={sourceTargetId}
              disabled={sourceMode === "document" && !sourceKnowledgeBaseId}
              loading={
                sourceMode === "knowledge_base"
                  ? knowledgeOptionsQuery.isFetching
                  : documentOptionsQuery.isFetching
              }
              placeholder={sourceMode === "knowledge_base" ? "搜索知识库" : "搜索已索引文档"}
              options={
                sourceMode === "knowledge_base"
                  ? knowledgeOptions.map((item) => ({
                      value: item.id,
                      label: `${item.name} · ${item.readyDocumentCount} 个可用文档`,
                    }))
                  : documentOptions.map((item) => ({
                      value: item.id,
                      label: `${item.name} · v${item.version}`,
                    }))
              }
              onSearch={setSourceKeyword}
              onChange={setSourceTargetId}
              onPopupScroll={(event) => {
                const target = event.currentTarget;
                if (target.scrollTop + target.clientHeight < target.scrollHeight - 32) return;
                if (sourceMode === "knowledge_base" && knowledgeOptionsQuery.hasNextPage) {
                  void knowledgeOptionsQuery.fetchNextPage();
                }
                if (sourceMode === "document" && documentOptionsQuery.hasNextPage) {
                  void documentOptionsQuery.fetchNextPage();
                }
              }}
            />
          ) : null}
        </Space>
      </Modal>

      <Modal
        title="生成 Notebook 产物"
        open={artifactModalOpen}
        confirmLoading={generateArtifact.isPending}
        okButtonProps={{ disabled: artifactType === "brief" && !customPrompt.trim() }}
        onOk={() => generateArtifact.mutate()}
        onCancel={() => setArtifactModalOpen(false)}
      >
        <Space orientation="vertical" size={14} className="ai-notebook-source-form">
          <div className="ai-notebook-inline-setting">
            <div>
              <Typography.Text strong>后台队列生成</Typography.Text>
              <Typography.Text type="secondary">
                长任务离开页面后仍会继续，由 AI Worker 处理
              </Typography.Text>
            </div>
            <Switch checked={asyncArtifact} onChange={setAsyncArtifact} />
          </div>
          <Segmented<ArtifactType>
            block
            value={artifactType}
            options={Object.entries(artifactLabels).map(([value, label]) => ({
              value: value as ArtifactType,
              label,
            }))}
            onChange={setArtifactType}
          />
          <Input
            value={artifactTitle}
            maxLength={200}
            placeholder={`标题，留空使用“${artifactLabels[artifactType]}”`}
            onChange={(event) => setArtifactTitle(event.target.value)}
          />
          {artifactType === "brief" ? (
            <Input.TextArea
              value={customPrompt}
              maxLength={4000}
              autoSize={{ minRows: 5, maxRows: 10 }}
              placeholder="说明简报结构、受众和需要回答的问题"
              onChange={(event) => setCustomPrompt(event.target.value)}
            />
          ) : null}
        </Space>
      </Modal>

      <Drawer
        title={
          researchRunQuery.data
            ? `Deep Research · Run #${researchRunQuery.data.id}`
            : "Deep Research"
        }
        open={Boolean(selectedResearchRunId)}
        size={720}
        onClose={() => setSelectedResearchRunId(null)}
        extra={
          researchRunQuery.data?.status === "queued" ||
          researchRunQuery.data?.status === "running" ? (
            <AuthButton auth="system.aiNotebook.artifact">
              <Button
                danger
                loading={cancelResearch.isPending}
                onClick={() => cancelResearch.mutate(researchRunQuery.data!.id)}
              >
                取消任务
              </Button>
            </AuthButton>
          ) : researchRunQuery.data?.output?.artifactId ? (
            <Button
              type="primary"
              onClick={() => {
                const artifact = artifactsQuery.data?.data.find(
                  (item) => item.id === researchRunQuery.data?.output?.artifactId,
                );
                if (artifact) setSelectedArtifact(artifact);
              }}
            >
              查看报告
            </Button>
          ) : null
        }
      >
        <Spin spinning={researchRunQuery.isFetching && !researchRunQuery.data}>
          {researchRunQuery.isError ? (
            <Alert
              type="error"
              showIcon
              title="研究详情加载失败"
              description={researchRunQuery.error.message}
            />
          ) : null}
          {researchRunQuery.data ? (
            <Space orientation="vertical" size={18} className="ai-notebook-research-detail">
              <div className="ai-notebook-research-overview">
                <div>
                  <Typography.Text type="secondary">研究主题</Typography.Text>
                  <Typography.Title level={5}>
                    {researchRunQuery.data.input?.topic}
                  </Typography.Title>
                </div>
                <Tag color={researchStatusMeta[researchRunQuery.data.status].color}>
                  {researchStatusMeta[researchRunQuery.data.status].label}
                </Tag>
              </div>
              {researchRunQuery.data.errorMessage ? (
                <Alert
                  type="error"
                  showIcon
                  title="研究失败"
                  description={researchRunQuery.data.errorMessage}
                />
              ) : null}
              {researchRunQuery.data.output ? (
                <div className="ai-notebook-research-metrics">
                  <span>候选来源 {researchRunQuery.data.output.selectedCount ?? 0}</span>
                  <span>新导入 {researchRunQuery.data.output.imported ?? 0}</span>
                  <span>复用 {researchRunQuery.data.output.reused ?? 0}</span>
                  <span>引用 {researchRunQuery.data.output.citationCount ?? 0}</span>
                  <span>
                    总耗时{" "}
                    {researchRunQuery.data.durationMs != null
                      ? `${researchRunQuery.data.durationMs} ms`
                      : "-"}
                  </span>
                </div>
              ) : null}
              <Timeline
                items={(researchRunQuery.data.steps ?? []).map((step) => ({
                  color:
                    step.status === "completed"
                      ? "green"
                      : step.status === "failed"
                        ? "red"
                        : "blue",
                  children: (
                    <div className="ai-notebook-research-step">
                      <div>
                        <Typography.Text strong>
                          {researchStepLabels[step.stepCode] ?? step.stepCode}
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          Step {step.stepNo} ·{" "}
                          {step.durationMs != null ? `${step.durationMs} ms` : "执行中"}
                        </Typography.Text>
                      </div>
                      {step.errorMessage ? (
                        <Typography.Text type="danger">{step.errorMessage}</Typography.Text>
                      ) : null}
                      {step.output ? (
                        <Collapse
                          ghost
                          size="small"
                          items={[
                            {
                              key: "evidence",
                              label: "查看执行证据",
                              children: (
                                <pre className="ai-notebook-research-json">
                                  {JSON.stringify(step.output, null, 2)}
                                </pre>
                              ),
                            },
                          ]}
                        />
                      ) : null}
                    </div>
                  ),
                }))}
              />
            </Space>
          ) : null}
        </Spin>
      </Drawer>

      {selectedCitation ? (
        <AiCitationDrawer
          open
          citationNumber={selectedCitationIndex + 1}
          citationCount={visibleCitations.length}
          documentName={selectedCitation.documentName}
          knowledgeBaseName={selectedCitation.knowledgeBaseName}
          chunkNo={selectedCitation.chunkNo}
          pageNumber={selectedCitation.pageNumber}
          score={selectedCitation.score}
          content={
            "content" in selectedCitation ? selectedCitation.content : selectedCitation.quote
          }
          onClose={() => setSelectedCitation(null)}
          onPrevious={
            selectedCitationIndex > 0
              ? () => setSelectedCitation(visibleCitations[selectedCitationIndex - 1])
              : undefined
          }
          onNext={
            selectedCitationIndex >= 0 && selectedCitationIndex < visibleCitations.length - 1
              ? () => setSelectedCitation(visibleCitations[selectedCitationIndex + 1])
              : undefined
          }
        />
      ) : null}

      <Drawer
        title={selectedArtifact?.title}
        open={Boolean(selectedArtifact)}
        size={720}
        onClose={() => setSelectedArtifact(null)}
        extra={
          selectedArtifact ? (
            <Space>
              <AuthButton auth="system.aiNotebook.artifact">
                <Button
                  loading={regenerateArtifact.isPending}
                  onClick={() => regenerateArtifact.mutate(selectedArtifact.id)}
                >
                  重新生成
                </Button>
              </AuthButton>
              <AuthButton auth="system.aiNotebook.artifact">
                <Popconfirm
                  title="删除这个 Artifact？"
                  onConfirm={() => deleteArtifact.mutate(selectedArtifact.id)}
                >
                  <Button danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </AuthButton>
            </Space>
          ) : null
        }
      >
        {selectedArtifact ? (
          <Space orientation="vertical" size={16} className="ai-notebook-detail">
            <Space wrap>
              <Tag>{artifactLabels[selectedArtifact.artifactType]}</Tag>
              <Tag>v{selectedArtifact.version}</Tag>
              <Typography.Text type="secondary">
                {formatTime(selectedArtifact.generatedAt)}
              </Typography.Text>
            </Space>
            {selectedArtifact.errorMessage ? (
              <Alert
                type="error"
                showIcon
                title="生成失败"
                description={selectedArtifact.errorMessage}
              />
            ) : null}
            <StreamingMarkdown
              content={selectedArtifact.content ?? ""}
              placeholder="该产物还没有可展示内容"
              minHeight={280}
              maxHeight={null}
              mode="static"
              citationCount={selectedArtifact.citations.length}
              onCitationClick={(citationNumber) => {
                const citation = selectedArtifact.citations[citationNumber - 1];
                if (citation) setSelectedCitation(citation);
              }}
            />
            {selectedArtifact.citations.length ? (
              <List
                header={<Typography.Text strong>引用快照</Typography.Text>}
                dataSource={selectedArtifact.citations}
                renderItem={(citation, index) => (
                  <List.Item onClick={() => setSelectedCitation(citation)}>
                    <List.Item.Meta
                      title={`[${index + 1}] ${citation.documentName}`}
                      description={`${citation.knowledgeBaseName} · 分块 ${citation.chunkNo}`}
                    />
                  </List.Item>
                )}
              />
            ) : null}
          </Space>
        ) : null}
      </Drawer>
    </PageScaffold>
  );
}
