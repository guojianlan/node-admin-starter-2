"use client";

import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  GlobalOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";

type ProviderType = "tavily" | "brave" | "searxng";
type WebSearchProviderRecord = {
  id: number;
  name: string;
  code: string;
  providerType: ProviderType;
  endpoint: string;
  apiKey?: string;
  hasApiKey: boolean;
  timeoutMs: number;
  maxResults: number;
  status: number;
  isPrimary: boolean;
  sort: number;
  remark?: string | null;
  isSystem: boolean;
};

type SearchAttempt = {
  providerCode: string;
  providerName: string;
  providerType: ProviderType;
  status: "completed" | "empty" | "failed";
  durationMs: number;
  resultCount: number;
  error?: string;
};

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: string;
};

type SearchResponse = {
  query: string;
  provider: { name: string; code: string; providerType: ProviderType } | null;
  results: SearchResult[];
  attempts: SearchAttempt[];
};

const providerOptions = [
  { label: "Tavily", value: "tavily" },
  { label: "Brave Search", value: "brave" },
  { label: "SearXNG", value: "searxng" },
];

const providerEndpoints: Record<ProviderType, string> = {
  tavily: "https://api.tavily.com/search",
  brave: "https://api.search.brave.com/res/v1/web/search",
  searxng: "http://127.0.0.1:18082/search",
};

function normalizePayload(values: Record<string, unknown>) {
  const payload = { ...values };
  delete payload.hasApiKey;
  delete payload.isSystem;
  if (!payload.apiKey) delete payload.apiKey;
  return payload;
}

function attemptColor(status: SearchAttempt["status"]) {
  if (status === "completed") return "success";
  if (status === "failed") return "error";
  return "warning";
}

export function AiWebSearchPage() {
  const queryClient = useQueryClient();
  const [testProvider, setTestProvider] = useState<WebSearchProviderRecord | null>(null);
  const [testQuery, setTestQuery] = useState("深圳今天的天气");
  const [testLimit, setTestLimit] = useState(5);
  const [testResult, setTestResult] = useState<SearchResponse | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: ["admin-data-table", "/api/system/ai/web-search/provider"],
    });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: number }) =>
      request(`/api/system/ai/web-search/provider/status/${id}`, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: () => {
      feedback.success("状态更新成功");
      invalidate();
    },
  });

  const testMutation = useMutation({
    mutationFn: (input: { id: number; query: string; limit: number }) =>
      request<SearchResponse>("/api/system/ai/web-search/provider/test", {
        method: "POST",
        body: input,
      }),
    onSuccess: (result) => {
      setTestResult(result);
      if (result.results.length) feedback.success("搜索测试成功");
      else feedback.warning("搜索完成，但当前 Provider 没有返回结果");
    },
  });

  const columns: AdminDataTableColumn<WebSearchProviderRecord>[] = [
    {
      title: "ID",
      dataIndex: "id",
      width: 70,
      fixed: "left",
      hideInForm: true,
      hideInSearch: true,
    },
    {
      title: "连接名称",
      dataIndex: "name",
      width: 190,
      fixed: "left",
      required: true,
      render: (value, record) => (
        <Space size={6} wrap>
          <GlobalOutlined />
          <Typography.Text strong>{String(value)}</Typography.Text>
          {record.isPrimary ? <Tag color="success">首选连接</Tag> : null}
          {record.isSystem ? <Tag color="blue">内置模板</Tag> : null}
        </Space>
      ),
    },
    {
      title: "内部编码",
      dataIndex: "code",
      width: 150,
      required: true,
      formHelp: "用于日志和调用记录识别。系统内置模板不能修改编码。",
      renderFormField: ({ initialValues }) => (
        <Input disabled={Boolean(initialValues?.isSystem)} placeholder="例如 tavily-primary" />
      ),
    },
    {
      title: "搜索服务",
      dataIndex: "providerType",
      valueType: "select",
      options: providerOptions,
      width: 130,
      required: true,
      render: (value) => <Tag color="geekblue">{String(value)}</Tag>,
      renderFormField: ({ form, initialValues }) => (
        <Select
          disabled={Boolean(initialValues?.isSystem)}
          options={providerOptions}
          placeholder="选择搜索服务"
          onChange={(value: ProviderType) => {
            if (!form.getFieldValue("endpoint"))
              form.setFieldValue("endpoint", providerEndpoints[value]);
          }}
        />
      ),
    },
    {
      title: "Endpoint",
      dataIndex: "endpoint",
      width: 300,
      required: true,
      formHelp: "只允许服务端调用此固定搜索端点；聊天请求不能覆盖。",
      render: (value) => (
        <Typography.Text ellipsis={{ tooltip: String(value) }}>{String(value)}</Typography.Text>
      ),
    },
    {
      title: "API Key",
      dataIndex: "apiKey",
      valueType: "password",
      hideInTable: true,
      hideInSearch: true,
      formSection: "advanced",
      formHelp: "留空会保留已保存密钥。SearXNG 可不配置；密钥不会从 API 返回。",
    },
    {
      title: "密钥",
      dataIndex: "hasApiKey",
      width: 86,
      hideInForm: true,
      hideInSearch: true,
      render: (value, record) => (
        <Tag color={value ? "success" : record.providerType === "searxng" ? "default" : "warning"}>
          {value ? "已配置" : record.providerType === "searxng" ? "可选" : "未配置"}
        </Tag>
      ),
    },
    {
      title: "超时",
      dataIndex: "timeoutMs",
      valueType: "digit",
      width: 96,
      hideInSearch: true,
      formSection: "advanced",
      fieldProps: { min: 1000, max: 60000, step: 1000 },
      render: (value) => `${Number(value).toLocaleString()} ms`,
    },
    {
      title: "结果上限",
      dataIndex: "maxResults",
      valueType: "digit",
      width: 96,
      hideInSearch: true,
      formSection: "advanced",
      fieldProps: { min: 1, max: 10 },
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      width: 110,
      render: (value, record) => (
        <AuthButton
          auth="system.aiWebSearch.status"
          fallback={<Tag>{Number(value) === 1 ? "启用" : "停用"}</Tag>}
        >
          <Switch
            checked={Number(value) === 1}
            checkedChildren="启用"
            unCheckedChildren="停用"
            loading={statusMutation.isPending}
            onChange={(checked) => {
              void statusMutation.mutateAsync({ id: record.id, status: checked ? 1 : 0 });
            }}
          />
        </AuthButton>
      ),
    },
    {
      title: "优先级",
      dataIndex: "sort",
      valueType: "digit",
      width: 104,
      hideInSearch: true,
      fieldProps: { min: 0, max: 9999, step: 10 },
      formHelp:
        "数字越小优先级越高。优先级最高的启用连接自动成为首选；失败、超时或无结果时才尝试下一个。",
    },
    {
      title: "备注",
      dataIndex: "remark",
      valueType: "textarea",
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
      formSection: "advanced",
    },
  ];

  return (
    <PageScaffold
      title="联网搜索"
      description="首选连接优先搜索；失败、超时或无结果时，按优先级自动尝试下一个启用连接"
      hideHeader
    >
      <AdminDataTable
        api="/api/system/ai/web-search/provider"
        accessName="system.aiWebSearch"
        rowKey="id"
        columns={columns}
        toolbarTitle="搜索服务商"
        defaultSort={{ field: "sort", order: "asc" }}
        createTitle="新增 Web Search Provider"
        updateTitle="编辑 Web Search Provider"
        actionColumnWidth={150}
        createInitialValues={{
          providerType: "searxng",
          endpoint: providerEndpoints.searxng,
          timeoutMs: 10000,
          maxResults: 8,
          status: 0,
          sort: 100,
        }}
        canDelete={(record) => !record.isSystem}
        beforeSubmit={normalizePayload}
        onDataChanged={invalidate}
        operateRender={(record) => (
          <AuthButton auth="system.aiWebSearch.test">
            <Tooltip title="搜索测试">
              <Button
                size="small"
                icon={<SearchOutlined />}
                onClick={() => {
                  setTestProvider(record);
                  setTestResult(null);
                }}
              />
            </Tooltip>
          </AuthButton>
        )}
      />

      <Modal
        width={760}
        title={`搜索测试${testProvider ? ` · ${testProvider.name}` : ""}`}
        open={Boolean(testProvider)}
        okText="开始搜索"
        cancelText="关闭"
        confirmLoading={testMutation.isPending}
        onOk={() => {
          if (!testProvider || !testQuery.trim()) {
            feedback.warning("请输入搜索问题");
            return;
          }
          void testMutation.mutateAsync({
            id: testProvider.id,
            query: testQuery.trim(),
            limit: testLimit,
          });
        }}
        onCancel={() => {
          setTestProvider(null);
          setTestResult(null);
        }}
      >
        <div className="ai-web-search-test">
          <div className="ai-web-search-test-inputs">
            <Input
              value={testQuery}
              onChange={(event) => setTestQuery(event.target.value)}
              prefix={<SearchOutlined />}
              placeholder="输入需要联网查询的问题"
              onPressEnter={() => {
                if (testProvider && testQuery.trim()) {
                  void testMutation.mutateAsync({
                    id: testProvider.id,
                    query: testQuery.trim(),
                    limit: testLimit,
                  });
                }
              }}
            />
            <InputNumber
              min={1}
              max={10}
              value={testLimit}
              onChange={(value) => setTestLimit(value ?? 5)}
              addonAfter="条"
            />
          </div>

          {testResult ? (
            <>
              <div className="ai-web-search-attempts">
                {testResult.attempts.map((attempt) => (
                  <div key={`${attempt.providerCode}-${attempt.durationMs}`}>
                    {attempt.status === "completed" ? (
                      <CheckCircleOutlined />
                    ) : (
                      <CloseCircleOutlined />
                    )}
                    <strong>{attempt.providerName}</strong>
                    <Tag color={attemptColor(attempt.status)}>{attempt.status}</Tag>
                    <span>
                      {attempt.durationMs} ms · {attempt.resultCount} 条
                    </span>
                    {attempt.error ? (
                      <Typography.Text type="danger">{attempt.error}</Typography.Text>
                    ) : null}
                  </div>
                ))}
              </div>
              {testResult.results.length ? (
                <div className="ai-web-search-result-list">
                  {testResult.results.map((result, index) => (
                    <a key={result.url} href={result.url} target="_blank" rel="noreferrer noopener">
                      <span>{index + 1}</span>
                      <div>
                        <strong>{result.title}</strong>
                        <p>{result.snippet || result.url}</p>
                        <small>
                          {result.source}
                          {result.publishedAt ? ` · ${result.publishedAt}` : ""}
                        </small>
                      </div>
                    </a>
                  ))}
                </div>
              ) : (
                <Alert type="warning" showIcon title="Provider 可访问，但没有返回搜索结果" />
              )}
            </>
          ) : (
            <Alert
              type="info"
              showIcon
              title="测试只调用当前连接"
              description="Agent 正式运行时先调用优先级最高的启用连接；失败、超时或无结果时才继续下一个。测试结果不会进入聊天记录。"
            />
          )}
        </div>
      </Modal>
    </PageScaffold>
  );
}
