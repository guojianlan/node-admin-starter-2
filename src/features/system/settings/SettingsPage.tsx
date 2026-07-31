"use client";

import {
  ApiOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  LockOutlined,
  LoginOutlined,
  MailOutlined,
  MessageOutlined,
  SaveOutlined,
  SettingOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { useNavigationAdapter } from "@/platform/navigation";
import { useAuthStore } from "@/stores/auth";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

type ConfigItem = {
  id: number;
  key: string;
  title: string;
  describe?: string | null;
  values?: string | null;
  type: string;
};

type StorageRecord = {
  id: number;
  name: string;
  code: string;
  type: string;
  isDefault: boolean;
  status: number;
};

type MailRecord = {
  id: number;
  name: string;
  code: string;
  host: string;
  isDefault: boolean;
  status: number;
  fromEmail: string;
};

type SmsProviderRecord = {
  id: number;
  name: string;
  code: string;
  provider: string;
  isDefault: boolean;
  status: number;
};

type AiProviderRecord = {
  id: number;
  name: string;
  code: string;
  providerType: string;
  isDefault: boolean;
  status: number;
  hasApiKey?: boolean;
};

type AiModelRecord = {
  id: number;
  providerId: number;
  providerName?: string;
  name: string;
  modelId: string;
  modelType: string;
  isDefaultChat: boolean;
  isDefaultStructured: boolean;
  isDefaultEmbedding: boolean;
  status: number;
};

type OAuthProviderConfig = {
  key?: string;
  name?: string;
  enabled?: boolean;
  authUrl?: string;
};

type OAuthProviderRecord = {
  id: number;
  key: string;
  name: string;
  enabled: boolean;
  status: number;
  hasClientSecret?: boolean;
};

type ConfigSection = {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  keys: string[];
};

const sections: ConfigSection[] = [
  {
    key: "basic",
    title: "基础设置",
    description: "站点名称、Logo 和后台说明。",
    icon: <SettingOutlined />,
    keys: ["site_name", "site_logo", "site_description"],
  },
  {
    key: "security",
    title: "安全策略",
    description: "控制新密码、重置密码和密码过期策略。",
    icon: <LockOutlined />,
    keys: [
      "security.password_min_length",
      "security.password_require_uppercase",
      "security.password_require_lowercase",
      "security.password_require_number",
      "security.password_require_symbol",
      "security.password_history_count",
      "security.password_expire_days",
      "security.force_change_on_first_login",
    ],
  },
  {
    key: "login",
    title: "登录策略",
    description: "控制验证码、失败锁定和多端登录策略。",
    icon: <LoginOutlined />,
    keys: [
      "login.captcha_enabled",
      "login.max_failed_attempts",
      "login.lock_minutes",
      "login.allow_multi_session",
      "login.max_online_tokens",
      "login.captcha_after_failures",
      "login.rate_limit_attempts",
      "login.rate_limit_window_minutes",
    ],
  },
  {
    key: "token",
    title: "Token 策略",
    description: "控制会话有效期、记住登录和过期清理窗口。",
    icon: <DatabaseOutlined />,
    keys: [
      "token.access_token_ttl_days",
      "token.remember_ttl_days",
      "token.refresh_last_used",
      "token.cleanup_expired_days",
    ],
  },
  {
    key: "file",
    title: "文件上传策略",
    description: "控制文件大小、扩展名、MIME、文件头和危险文件策略。",
    icon: <UploadOutlined />,
    keys: [
      "file.max_upload_size_mb",
      "file.allowed_extensions",
      "file.denied_extensions",
      "file.mime_check_enabled",
      "file.magic_check_enabled",
      "file.dangerous_file_strategy",
      "file.enable_sha256_dedupe",
    ],
  },
];

function isNumberType(type: string) {
  return type === "digit" || type === "number";
}

function parseConfigValue(item: ConfigItem) {
  if (item.type === "switch") return item.values === "1" || item.values === "true";
  if (isNumberType(item.type)) return Number(item.values || 0);
  return item.values ?? "";
}

function stringifyConfigValue(item: ConfigItem, value: unknown) {
  if (item.type === "switch") return value ? "true" : "false";
  if (isNumberType(item.type)) return String(Number(value ?? 0));
  return value == null ? "" : String(value);
}

function parseOAuthProviders(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => item as OAuthProviderConfig);
  } catch {
    return [];
  }
}

function ConfigControl({ item }: { item: ConfigItem }) {
  if (item.key === "file.dangerous_file_strategy") {
    return (
      <Select
        options={[
          { label: "拒绝上传", value: "reject" },
          { label: "隔离下载", value: "isolated-download" },
          { label: "强制下载", value: "force-download" },
        ]}
      />
    );
  }
  if (item.type === "switch") return <Switch checkedChildren="开" unCheckedChildren="关" />;
  if (isNumberType(item.type)) return <InputNumber min={0} style={{ width: "100%" }} />;
  if (item.type === "textarea") return <Input.TextArea rows={5} />;
  return <Input allowClear />;
}

function ConfigSectionForm({
  itemsByKey,
  section,
}: {
  itemsByKey: Map<string, ConfigItem>;
  section: ConfigSection;
}) {
  const [form] = Form.useForm<Record<string, unknown>>();
  const queryClient = useQueryClient();
  const items = section.keys.map((key) => itemsByKey.get(key)).filter(Boolean) as ConfigItem[];
  const missingKeys = section.keys.filter((key) => !itemsByKey.has(key));

  useEffect(() => {
    const values: Record<string, unknown> = {};
    for (const item of items) values[item.key] = parseConfigValue(item);
    form.setFieldsValue(values);
  }, [form, items]);

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload: Record<string, string> = {};
      for (const item of items) payload[item.key] = stringifyConfigValue(item, values[item.key]);
      await request("/api/system/settings/config/save", { method: "PUT", body: payload });
    },
    onSuccess: () => {
      feedback.success(`${section.title}已保存`);
      void queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["login", "options"] });
    },
  });

  return (
    <Card
      title={
        <Space>
          {section.icon}
          {section.title}
        </Space>
      }
      extra={
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saveMutation.isPending}
          onClick={() => form.submit()}
        >
          保存本组
        </Button>
      }
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Typography.Text type="secondary">{section.description}</Typography.Text>
        {missingKeys.length ? (
          <Alert
            showIcon
            type="warning"
            title="配置项未初始化"
            description={missingKeys.join(", ")}
          />
        ) : null}
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Row gutter={16}>
            {items.map((item) => (
              <Col
                xs={24}
                md={item.type === "textarea" ? 24 : 12}
                xl={item.type === "textarea" ? 24 : 8}
                key={item.key}
              >
                <Form.Item
                  label={item.title}
                  name={item.key}
                  extra={item.describe}
                  valuePropName={item.type === "switch" ? "checked" : "value"}
                >
                  <ConfigControl item={item} />
                </Form.Item>
              </Col>
            ))}
          </Row>
        </Form>
      </Space>
    </Card>
  );
}

function ResourceSettings({
  aiModels,
  aiProviders,
  mailItems,
  smsItems,
  storageItems,
  canQueryAiModel,
  canQueryAiProvider,
  canQueryMail,
  canQuerySms,
  canQueryStorage,
}: {
  aiModels: AiModelRecord[];
  aiProviders: AiProviderRecord[];
  mailItems: MailRecord[];
  smsItems: SmsProviderRecord[];
  storageItems: StorageRecord[];
  canQueryAiModel: boolean;
  canQueryAiProvider: boolean;
  canQueryMail: boolean;
  canQuerySms: boolean;
  canQueryStorage: boolean;
}) {
  const navigation = useNavigationAdapter();
  const [testMailTo, setTestMailTo] = useState("");
  const [testSmsTo, setTestSmsTo] = useState("");
  const defaultStorage = storageItems.find((item) => item.isDefault);
  const defaultMail = mailItems.find((item) => item.isDefault);
  const defaultSms = smsItems.find((item) => item.isDefault);
  const defaultAiProvider = aiProviders.find((item) => item.isDefault);
  const defaultChatModel = aiModels.find((item) => item.isDefaultChat);
  const defaultStructuredModel = aiModels.find((item) => item.isDefaultStructured);
  const defaultEmbeddingModel = aiModels.find((item) => item.isDefaultEmbedding);
  const testStorageMutation = useMutation({
    mutationFn: () =>
      request("/api/system/storage/test", {
        method: "POST",
        body: { id: defaultStorage?.id },
      }),
    onSuccess: () => feedback.success("默认存储连接正常"),
  });
  const testMailMutation = useMutation({
    mutationFn: () =>
      request("/api/system/mail/account/test", {
        method: "POST",
        body: {
          id: defaultMail?.id,
          to: testMailTo,
          subject: "Admin Base 测试邮件",
          text: "这是一封来自系统设置页的测试邮件。",
        },
      }),
    onSuccess: () => feedback.success("测试邮件已发送"),
  });
  const testSmsMutation = useMutation({
    mutationFn: () =>
      request("/api/system/sms/provider/test", {
        method: "POST",
        body: {
          id: defaultSms?.id,
          to: testSmsTo,
          content: "这是一条来自系统设置页的测试短信。",
        },
      }),
    onSuccess: () => feedback.success("测试短信已发送"),
  });
  const testAiMutation = useMutation({
    mutationFn: () =>
      request("/api/system/ai/provider/test", {
        method: "POST",
        body: { id: defaultAiProvider?.id },
      }),
    onSuccess: () => feedback.success("默认 AI Provider 连接正常"),
  });

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={8}>
        <Card
          title={
            <Space>
              <CloudServerOutlined />
              存储配置
            </Space>
          }
          extra={
            <AuthButton auth="system.storage.query">
              <Button onClick={() => navigation.push("/system/storage")}>管理</Button>
            </AuthButton>
          }
        >
          {!canQueryStorage ? (
            <Alert type="warning" showIcon title="当前角色没有存储配置查看权限" />
          ) : defaultStorage ? (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Text strong>{defaultStorage.name}</Typography.Text>
              <Space wrap>
                <Tag color="blue">{defaultStorage.code}</Tag>
                <Tag>{defaultStorage.type}</Tag>
                <Tag color={defaultStorage.status === 1 ? "success" : "error"}>
                  {defaultStorage.status === 1 ? "启用" : "停用"}
                </Tag>
              </Space>
              <AuthButton auth="system.storage.test">
                <Button
                  icon={<ApiOutlined />}
                  loading={testStorageMutation.isPending}
                  onClick={() => testStorageMutation.mutate()}
                >
                  测试默认存储
                </Button>
              </AuthButton>
            </Space>
          ) : (
            <Alert type="warning" showIcon title="尚未配置默认存储" />
          )}
        </Card>
      </Col>
      <Col xs={24} lg={8}>
        <Card
          title={
            <Space>
              <MailOutlined />
              邮件配置
            </Space>
          }
          extra={
            <AuthButton auth="system.mail.query">
              <Button onClick={() => navigation.push("/system/mail/account")}>管理</Button>
            </AuthButton>
          }
        >
          {!canQueryMail ? (
            <Alert type="warning" showIcon title="当前角色没有邮件配置查看权限" />
          ) : defaultMail ? (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Text strong>{defaultMail.name}</Typography.Text>
              <Space wrap>
                <Tag color="blue">{defaultMail.code}</Tag>
                <Tag>{defaultMail.host}</Tag>
                <Tag color={defaultMail.status === 1 ? "success" : "error"}>
                  {defaultMail.status === 1 ? "启用" : "停用"}
                </Tag>
              </Space>
              <AuthButton auth="system.mail.test">
                <Input.Search
                  enterButton="发送测试"
                  placeholder="输入测试收件邮箱"
                  value={testMailTo}
                  loading={testMailMutation.isPending}
                  onChange={(event) => setTestMailTo(event.target.value)}
                  onSearch={() => testMailMutation.mutate()}
                />
              </AuthButton>
            </Space>
          ) : (
            <Alert type="warning" showIcon title="尚未配置默认邮件账号" />
          )}
        </Card>
      </Col>
      <Col xs={24} lg={8}>
        <Card
          title={
            <Space>
              <MessageOutlined />
              短信配置
            </Space>
          }
          extra={
            <AuthButton auth="system.smsProvider.query">
              <Button onClick={() => navigation.push("/system/sms/provider")}>管理</Button>
            </AuthButton>
          }
        >
          {!canQuerySms ? (
            <Alert type="warning" showIcon title="当前角色没有短信配置查看权限" />
          ) : defaultSms ? (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Text strong>{defaultSms.name}</Typography.Text>
              <Space wrap>
                <Tag color="blue">{defaultSms.code}</Tag>
                <Tag>{defaultSms.provider}</Tag>
                <Tag color={defaultSms.status === 1 ? "success" : "error"}>
                  {defaultSms.status === 1 ? "启用" : "停用"}
                </Tag>
              </Space>
              <AuthButton auth="system.smsProvider.test">
                <Input.Search
                  enterButton="发送测试"
                  placeholder="输入测试手机号"
                  value={testSmsTo}
                  loading={testSmsMutation.isPending}
                  onChange={(event) => setTestSmsTo(event.target.value)}
                  onSearch={() => testSmsMutation.mutate()}
                />
              </AuthButton>
            </Space>
          ) : (
            <Alert type="warning" showIcon title="尚未配置默认短信配置" />
          )}
        </Card>
      </Col>
      <Col xs={24} lg={8}>
        <Card
          title={
            <Space>
              <ApiOutlined />
              AI 配置
            </Space>
          }
          extra={
            <Space>
              <AuthButton auth="system.aiProvider.query">
                <Button onClick={() => navigation.push("/system/ai/provider")}>Provider</Button>
              </AuthButton>
              <AuthButton auth="system.aiModel.query">
                <Button onClick={() => navigation.push("/system/ai/model")}>模型</Button>
              </AuthButton>
            </Space>
          }
        >
          {!canQueryAiProvider ? (
            <Alert type="warning" showIcon title="当前角色没有 AI Provider 查看权限" />
          ) : defaultAiProvider ? (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Typography.Text strong>{defaultAiProvider.name}</Typography.Text>
              <Space wrap>
                <Tag color="blue">{defaultAiProvider.code}</Tag>
                <Tag>{defaultAiProvider.providerType}</Tag>
                <Tag color={defaultAiProvider.status === 1 ? "success" : "error"}>
                  {defaultAiProvider.status === 1 ? "启用" : "停用"}
                </Tag>
                <Tag color={defaultAiProvider.hasApiKey ? "success" : "default"}>
                  {defaultAiProvider.hasApiKey ? "Key 已配置" : "Key 未配置"}
                </Tag>
              </Space>
              {canQueryAiModel ? (
                <Space wrap size={6}>
                  <Tag color={defaultChatModel ? "gold" : "default"}>
                    Chat: {defaultChatModel?.modelId ?? "未设置"}
                  </Tag>
                  <Tag color={defaultStructuredModel ? "purple" : "default"}>
                    结构化: {defaultStructuredModel?.modelId ?? "未设置"}
                  </Tag>
                  <Tag color={defaultEmbeddingModel ? "cyan" : "default"}>
                    Embedding: {defaultEmbeddingModel?.modelId ?? "未设置"}
                  </Tag>
                </Space>
              ) : null}
              <AuthButton auth="system.aiProvider.test">
                <Button
                  icon={<ApiOutlined />}
                  loading={testAiMutation.isPending}
                  onClick={() => testAiMutation.mutate()}
                >
                  测试默认 Provider
                </Button>
              </AuthButton>
            </Space>
          ) : (
            <Alert type="warning" showIcon title="尚未配置默认 AI Provider" />
          )}
        </Card>
      </Col>
    </Row>
  );
}

function LoginMethods({
  canQueryOAuth,
  oauthConfig,
  oauthProviders,
}: {
  canQueryOAuth: boolean;
  oauthConfig?: ConfigItem;
  oauthProviders: OAuthProviderRecord[];
}) {
  const navigation = useNavigationAdapter();
  const legacyProviders = parseOAuthProviders(oauthConfig?.values);
  const providers = (oauthProviders.length ? oauthProviders : legacyProviders).map((provider) => ({
    key: provider.key,
    name: provider.name,
    enabled: Boolean(provider.enabled),
    status: "status" in provider ? provider.status : 1,
  }));
  return (
    <Card
      title={
        <Space>
          <LoginOutlined />
          登录方式
        </Space>
      }
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Alert
          showIcon
          type="info"
          title="账号密码登录为系统基础能力，始终启用。验证码由登录策略分区控制。"
        />
        <div>
          <Typography.Text strong>第三方登录 Provider</Typography.Text>
          <div style={{ marginTop: 8 }}>
            {!canQueryOAuth ? (
              <Alert type="warning" showIcon title="当前角色没有第三方登录配置查看权限" />
            ) : providers.length ? (
              <Space wrap>
                {providers.map((provider) => (
                  <Tag
                    color={provider.enabled && Number(provider.status ?? 1) === 1 ? "success" : "default"}
                    key={provider.key}
                  >
                    {provider.name || provider.key}
                    {provider.enabled && Number(provider.status ?? 1) === 1 ? " / 启用" : " / 停用"}
                  </Tag>
                ))}
              </Space>
            ) : (
              <Typography.Text type="secondary">尚未配置 OAuth Provider</Typography.Text>
            )}
          </div>
        </div>
        <Alert
          showIcon
          type="success"
          title="OAuth Provider 已按资源型配置独立维护；系统设置只聚合入口，不直接暴露复杂 JSON。"
          action={
            <AuthButton auth="system.oauthProvider.query">
              <Button onClick={() => navigation.push("/system/oauth/provider")}>管理 Provider</Button>
            </AuthButton>
          }
        />
      </Space>
    </Card>
  );
}

export function SettingsPage() {
  const hasAccess = useAuthStore((state) => state.hasAccess);
  const canQueryStorage = hasAccess("system.storage.query");
  const canQueryMail = hasAccess("system.mail.query");
  const canQuerySms = hasAccess("system.smsProvider.query");
  const canQueryAiProvider = hasAccess("system.aiProvider.query");
  const canQueryAiModel = hasAccess("system.aiModel.query");
  const canQueryOAuth = hasAccess("system.oauthProvider.query");
  const configQuery = useQuery({
    queryKey: ["system-settings", "config"],
    queryFn: async () => {
      const page = await request<PageResult<ConfigItem>>(
        `/api/system/settings/config/items${buildQueryString({ page: 1, pageSize: 300 })}`,
      );
      return page.data;
    },
  });
  const storageQuery = useQuery({
    queryKey: ["system-settings", "storage"],
    queryFn: async () => {
      const page = await request<PageResult<StorageRecord>>(
        `/api/system/storage${buildQueryString({ page: 1, pageSize: 100 })}`,
      );
      return page.data;
    },
    enabled: canQueryStorage,
  });
  const mailQuery = useQuery({
    queryKey: ["system-settings", "mail"],
    queryFn: async () => {
      const page = await request<PageResult<MailRecord>>(
        `/api/system/mail/account${buildQueryString({ page: 1, pageSize: 100 })}`,
      );
      return page.data;
    },
    enabled: canQueryMail,
  });
  const oauthProviderQuery = useQuery({
    queryKey: ["system-settings", "oauth-provider"],
    queryFn: async () => {
      const page = await request<PageResult<OAuthProviderRecord>>(
        `/api/system/oauth/provider${buildQueryString({ page: 1, pageSize: 100 })}`,
      );
      return page.data;
    },
    enabled: canQueryOAuth,
  });
  const smsProviderQuery = useQuery({
    queryKey: ["system-settings", "sms-provider"],
    queryFn: async () => {
      const page = await request<PageResult<SmsProviderRecord>>(
        `/api/system/sms/provider${buildQueryString({ page: 1, pageSize: 100 })}`,
      );
      return page.data;
    },
    enabled: canQuerySms,
  });
  const aiProviderQuery = useQuery({
    queryKey: ["system-settings", "ai-provider"],
    queryFn: async () => {
      const page = await request<PageResult<AiProviderRecord>>(
        `/api/system/ai/provider${buildQueryString({ page: 1, pageSize: 100 })}`,
      );
      return page.data;
    },
    enabled: canQueryAiProvider,
  });
  const aiModelQuery = useQuery({
    queryKey: ["system-settings", "ai-model"],
    queryFn: async () => {
      const page = await request<PageResult<AiModelRecord>>(
        `/api/system/ai/model${buildQueryString({ page: 1, pageSize: 100 })}`,
      );
      return page.data;
    },
    enabled: canQueryAiModel,
  });

  const itemsByKey = useMemo(() => {
    return new Map((configQuery.data ?? []).map((item) => [item.key, item]));
  }, [configQuery.data]);
  const loading =
    configQuery.isLoading ||
    (canQueryStorage && storageQuery.isLoading) ||
    (canQueryMail && mailQuery.isLoading) ||
    (canQuerySms && smsProviderQuery.isLoading) ||
    (canQueryAiProvider && aiProviderQuery.isLoading) ||
    (canQueryAiModel && aiModelQuery.isLoading) ||
    (canQueryOAuth && oauthProviderQuery.isLoading);

  return (
    <PageScaffold title="系统设置" description="聚合基础参数、安全策略、登录策略、上传策略和资源配置">
      <Spin spinning={loading}>
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            showIcon
            type="info"
            title="系统设置是业务化入口；配置项管理、存储、邮件仍保持独立模型和独立权限。"
          />
          <Tabs
            items={[
              ...sections.map((section) => ({
                key: section.key,
                label: (
                  <Space>
                    {section.icon}
                    {section.title}
                  </Space>
                ),
                children: <ConfigSectionForm itemsByKey={itemsByKey} section={section} />,
              })),
              {
                key: "resources",
                label: (
                  <Space>
                    <CloudServerOutlined />
                    资源配置
                  </Space>
                ),
                children: (
                  <ResourceSettings
                    aiModels={aiModelQuery.data ?? []}
                    aiProviders={aiProviderQuery.data ?? []}
                    canQueryAiModel={canQueryAiModel}
                    canQueryAiProvider={canQueryAiProvider}
                    canQueryMail={canQueryMail}
                    canQuerySms={canQuerySms}
                    canQueryStorage={canQueryStorage}
                    storageItems={storageQuery.data ?? []}
                    mailItems={mailQuery.data ?? []}
                    smsItems={smsProviderQuery.data ?? []}
                  />
                ),
              },
              {
                key: "login-methods",
                label: (
                  <Space>
                    <LoginOutlined />
                    登录方式
                  </Space>
                ),
                children: (
                  <LoginMethods
                    canQueryOAuth={canQueryOAuth}
                    oauthConfig={itemsByKey.get("login.oauth_providers_json")}
                    oauthProviders={oauthProviderQuery.data ?? []}
                  />
                ),
              },
            ]}
          />
        </Space>
      </Spin>
    </PageScaffold>
  );
}
