"use client";

import {
  CloudServerOutlined,
  DatabaseOutlined,
  LockOutlined,
  LoginOutlined,
  MailOutlined,
  SaveOutlined,
  SettingOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Space, Spin, Switch, Tag, Typography } from "antd";
import { useEffect, useMemo } from "react";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { useNavigationAdapter } from "@/platform/navigation";
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

type ConfigSection = {
  key: string;
  title: string;
  icon: React.ReactNode;
  keys: string[];
};

const sections: ConfigSection[] = [
  {
    key: "basic",
    title: "基础设置",
    icon: <SettingOutlined />,
    keys: ["site_name", "site_logo", "site_description"],
  },
  {
    key: "security",
    title: "安全策略",
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
    icon: <LoginOutlined />,
    keys: [
      "login.captcha_enabled",
      "login.max_failed_attempts",
      "login.lock_minutes",
      "login.allow_multi_session",
      "login.max_online_tokens",
      "login.oauth_providers_json",
    ],
  },
  {
    key: "token",
    title: "Token 策略",
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
    icon: <UploadOutlined />,
    keys: [
      "file.max_upload_size_mb",
      "file.allowed_extensions",
      "file.denied_extensions",
      "file.enable_sha256_dedupe",
    ],
  },
];

function parseConfigValue(item: ConfigItem) {
  if (item.type === "switch") return item.values === "1" || item.values === "true";
  if (item.type === "digit") return Number(item.values || 0);
  return item.values ?? "";
}

function stringifyConfigValue(item: ConfigItem, value: unknown) {
  if (item.type === "switch") return value ? "true" : "false";
  if (item.type === "digit") return String(Number(value ?? 0));
  return value == null ? "" : String(value);
}

function ConfigControl({ item }: { item: ConfigItem }) {
  if (item.type === "switch") return <Switch checkedChildren="开" unCheckedChildren="关" />;
  if (item.type === "digit") return <InputNumber min={0} style={{ width: "100%" }} />;
  if (item.type === "textarea") return <Input.TextArea rows={5} />;
  return <Input allowClear />;
}

function ResourceCard({
  icon,
  items,
  path,
  title,
}: {
  icon: React.ReactNode;
  items: Array<StorageRecord | MailRecord>;
  path: string;
  title: string;
}) {
  const navigation = useNavigationAdapter();
  const defaultItem = items.find((item) => item.isDefault);
  return (
    <Card
      title={
        <Space>
          {icon}
          {title}
        </Space>
      }
      extra={<Button onClick={() => navigation.push(path)}>管理</Button>}
    >
      {defaultItem ? (
        <Space direction="vertical" size={8}>
          <Typography.Text strong>{defaultItem.name}</Typography.Text>
          <Space wrap>
            <Tag color="blue">{defaultItem.code}</Tag>
            <Tag color={defaultItem.status === 1 ? "success" : "error"}>
              {defaultItem.status === 1 ? "启用" : "停用"}
            </Tag>
            {"type" in defaultItem ? <Tag>{defaultItem.type}</Tag> : null}
            {"host" in defaultItem ? <Tag>{defaultItem.host}</Tag> : null}
          </Space>
        </Space>
      ) : (
        <Alert type="warning" showIcon message={`尚未配置默认${title}`} />
      )}
    </Card>
  );
}

export function SettingsPage() {
  const [form] = Form.useForm<Record<string, unknown>>();
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["system-settings", "config"],
    queryFn: async () => {
      const page = await request<PageResult<ConfigItem>>(
        `/api/system/config/items${buildQueryString({ page: 1, pageSize: 300 })}`,
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
  });
  const mailQuery = useQuery({
    queryKey: ["system-settings", "mail"],
    queryFn: async () => {
      const page = await request<PageResult<MailRecord>>(
        `/api/system/mail/account${buildQueryString({ page: 1, pageSize: 100 })}`,
      );
      return page.data;
    },
  });

  const itemsByKey = useMemo(() => {
    return new Map((configQuery.data ?? []).map((item) => [item.key, item]));
  }, [configQuery.data]);

  useEffect(() => {
    const values: Record<string, unknown> = {};
    for (const item of configQuery.data ?? []) values[item.key] = parseConfigValue(item);
    form.setFieldsValue(values);
  }, [configQuery.data, form]);

  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const payload: Record<string, string> = {};
      for (const section of sections) {
        for (const key of section.keys) {
          const item = itemsByKey.get(key);
          if (item) payload[key] = stringifyConfigValue(item, values[key]);
        }
      }
      await request("/api/system/config/items/save", { method: "PUT", body: payload });
    },
    onSuccess: () => {
      feedback.success("系统设置已保存");
      void queryClient.invalidateQueries({ queryKey: ["system-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["login", "options"] });
    },
  });

  const loading = configQuery.isLoading || storageQuery.isLoading || mailQuery.isLoading;

  return (
    <PageScaffold title="系统设置" description="聚合基础参数、安全策略、登录策略、上传策略和资源配置">
      <Spin spinning={loading}>
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Alert
              showIcon
              type="info"
              message="系统设置只聚合配置入口；存储和邮件仍保持独立资源模型。"
            />
            {sections.map((section) => (
              <Card
                key={section.key}
                title={
                  <Space>
                    {section.icon}
                    {section.title}
                  </Space>
                }
              >
                <Row gutter={16}>
                  {section.keys.map((key) => {
                    const item = itemsByKey.get(key);
                    if (!item) return null;
                    return (
                      <Col xs={24} md={item.type === "textarea" ? 24 : 12} xl={item.type === "textarea" ? 24 : 8} key={key}>
                        <Form.Item
                          label={item.title}
                          name={item.key}
                          extra={item.describe}
                          valuePropName={item.type === "switch" ? "checked" : "value"}
                        >
                          <ConfigControl item={item} />
                        </Form.Item>
                      </Col>
                    );
                  })}
                </Row>
              </Card>
            ))}
            <Row gutter={16}>
              <Col xs={24} lg={12}>
                <ResourceCard
                  icon={<CloudServerOutlined />}
                  title="存储配置"
                  path="/system/storage"
                  items={storageQuery.data ?? []}
                />
              </Col>
              <Col xs={24} lg={12}>
                <ResourceCard
                  icon={<MailOutlined />}
                  title="邮件配置"
                  path="/system/mail/account"
                  items={mailQuery.data ?? []}
                />
              </Col>
            </Row>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={saveMutation.isPending}
              >
                保存设置
              </Button>
            </div>
          </Space>
        </Form>
      </Spin>
    </PageScaffold>
  );
}
