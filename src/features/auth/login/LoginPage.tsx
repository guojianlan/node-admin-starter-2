"use client";

import {
  AlipayOutlined,
  BulbOutlined,
  CheckOutlined,
  GithubOutlined,
  LockOutlined,
  QqOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  TaobaoOutlined,
  TranslationOutlined,
  UserOutlined,
  WechatOutlined,
  WeiboOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Divider, Dropdown, Form, Input, Modal, Space, Typography } from "antd";
import type { MenuProps } from "antd";
import { useMemo, useState } from "react";
import { request } from "@/lib/request";
import { useNavigationAdapter } from "@/platform/navigation";
import { useAuthStore } from "@/stores/auth";
import { feedback } from "@/ui/feedback/feedback";
import { useAdminPreferences } from "@/ui/preferences";

type LoginFormValues = {
  username: string;
  password: string;
  remember?: boolean;
  captchaCode?: string;
};

type LoginOptions = {
  captchaEnabled: boolean;
  oauthProviders: Array<{
    key: string;
    name: string;
    authUrl: string;
  }>;
};

type CaptchaResult = {
  captchaId: string;
  image: string;
  expiresIn: number;
};

type ForgotPasswordValues = {
  account: string;
};

type ResetPasswordValues = {
  password: string;
  confirmPassword: string;
};

export function LoginPage() {
  const navigation = useNavigationAdapter();
  const login = useAuthStore((state) => state.login);
  const loading = useAuthStore((state) => state.loading);
  const { locale, setLocale, setThemeMode, t, themeMode } = useAdminPreferences();
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotForm] = Form.useForm<ForgotPasswordValues>();
  const [resetForm] = Form.useForm<ResetPasswordValues>();

  const redirect = useMemo(() => {
    const params = new URLSearchParams(navigation.search);
    return params.get("redirect") || "/dashboard";
  }, [navigation.search]);
  const resetToken = useMemo(() => {
    const params = new URLSearchParams(navigation.search);
    return params.get("resetToken") || "";
  }, [navigation.search]);
  const resetOpen = Boolean(resetToken);

  const loginOptionsQuery = useQuery({
    queryKey: ["login", "options"],
    queryFn: () => request<LoginOptions>("/api/system/login/options", { silent: true }),
  });
  const captchaEnabled = Boolean(loginOptionsQuery.data?.captchaEnabled);
  const oauthProviders = loginOptionsQuery.data?.oauthProviders ?? [];
  const providerIcons: Record<string, React.ReactNode> = {
    github: <GithubOutlined style={{ fontSize: 20 }} />,
    qq: <QqOutlined style={{ color: "rgb(123, 212, 239)", fontSize: 20 }} />,
    wechat: <WechatOutlined style={{ color: "rgb(51, 204, 0)", fontSize: 20 }} />,
    alipay: <AlipayOutlined style={{ color: "#1677ff", fontSize: 20 }} />,
    taobao: <TaobaoOutlined style={{ color: "#ff6a10", fontSize: 20 }} />,
    weibo: <WeiboOutlined style={{ color: "#e71f19", fontSize: 20 }} />,
  };
  const localeItems: MenuProps["items"] = [
    {
      key: "zh-CN",
      label: "简体中文",
      icon: locale === "zh-CN" ? <CheckOutlined /> : null,
      onClick: () => setLocale("zh-CN"),
    },
    {
      key: "en-US",
      label: "English",
      icon: locale === "en-US" ? <CheckOutlined /> : null,
      onClick: () => setLocale("en-US"),
    },
  ];
  const captchaQuery = useQuery({
    queryKey: ["login", "captcha"],
    queryFn: () => request<CaptchaResult>("/api/system/login/captcha", { silent: true }),
    enabled: captchaEnabled,
    staleTime: 0,
  });
  const forgotMutation = useMutation({
    mutationFn: (values: ForgotPasswordValues) =>
      request("/api/system/password-reset/request", {
        method: "POST",
        body: values,
      }),
    onSuccess: () => {
      feedback.success("如果账号存在且已绑定邮箱，系统会发送密码重置邮件");
      forgotForm.resetFields();
      setForgotOpen(false);
    },
  });
  const resetMutation = useMutation({
    mutationFn: (values: ResetPasswordValues) =>
      request("/api/system/password-reset/confirm", {
        method: "POST",
        body: { token: resetToken, password: values.password },
      }),
    onSuccess: () => {
      feedback.success("密码已重置，请重新登录");
      resetForm.resetFields();
      navigation.replace("/login");
    },
  });

  async function handleFinish(values: LoginFormValues) {
    try {
      await login({
        ...values,
        captchaId: captchaQuery.data?.captchaId,
      });
      navigation.replace(redirect);
    } catch {
      // request() already displays the API error through the global feedback bridge.
      if (captchaEnabled) void captchaQuery.refetch();
    }
  }

  return (
    <main className="xin-login-page">
      <section className="xin-login-body">
        <div className="xin-login-card">
          <div className="xin-login-tools">
            <Dropdown menu={{ items: localeItems }} trigger={["click"]}>
              <Button type="text" size="large" icon={<TranslationOutlined />} aria-label={t("language")} />
            </Dropdown>
            <Button
              type="text"
              size="large"
              icon={<BulbOutlined />}
              aria-label={t("presetTheme")}
              onClick={() => setThemeMode(themeMode === "dark" ? "light" : "dark")}
            />
          </div>

          <div className="xin-login-brand">
            <span className="xin-login-logo" aria-label="Admin Base" />
            <h1 className="xin-login-title">Admin Base</h1>
            <div className="xin-login-subtitle">{t("adminSubtitle")}</div>
          </div>

          <Form<LoginFormValues>
            layout="vertical"
            initialValues={{ username: "admin", password: "123456", remember: true }}
            onFinish={handleFinish}
            requiredMark
          >
            <Form.Item
              label={t("username")}
              name="username"
              rules={[{ required: true, message: "请输入用户名" }]}
            >
              <Input
                size="large"
                variant="filled"
                prefix={<UserOutlined />}
                placeholder="admin"
                autoComplete="username"
              />
            </Form.Item>
            <Form.Item
              label={t("password")}
              name="password"
              rules={[{ required: true, message: "请输入密码" }]}
            >
              <Input.Password
                size="large"
                variant="filled"
                prefix={<LockOutlined />}
                placeholder="123456"
                autoComplete="current-password"
              />
            </Form.Item>
            {captchaEnabled ? (
              <Form.Item
                label={t("captcha")}
                name="captchaCode"
                rules={[{ required: true, message: "请输入验证码" }]}
              >
                <Space.Compact block>
                  <Input
                    size="large"
                    variant="filled"
                    prefix={<SafetyCertificateOutlined />}
                    placeholder={t("inputCaptcha")}
                    autoComplete="off"
                  />
                  <Button
                    size="large"
                    className="xin-login-captcha"
                    loading={captchaQuery.isFetching}
                    onClick={() => void captchaQuery.refetch()}
                    aria-label="刷新验证码"
                  >
                    {captchaQuery.data?.image ? (
                      <span
                        className="xin-login-captcha-preview"
                        style={{ backgroundImage: `url("${captchaQuery.data.image}")` }}
                      />
                    ) : (
                      <ReloadOutlined />
                    )}
                  </Button>
                </Space.Compact>
              </Form.Item>
            ) : null}
            <Form.Item>
              <div className="xin-login-extra">
                <Form.Item name="remember" valuePropName="checked" noStyle>
                  <Checkbox>{t("remember")}</Checkbox>
                </Form.Item>
                <Typography.Link onClick={() => setForgotOpen(true)}>{t("forgotPassword")}</Typography.Link>
              </div>
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" loading={loading} block>
              {t("login")}
            </Button>
          </Form>

          {oauthProviders.length ? (
            <>
              <Divider plain>{t("otherLoginMethods")}</Divider>
              <Space align="center" className="xin-social-list">
                {oauthProviders.map((provider) => (
                  <Button
                    key={provider.key}
                    className="xin-social-button"
                    aria-label={provider.name}
                    title={provider.name}
                    onClick={() => {
                      window.location.href = provider.authUrl;
                    }}
                  >
                    {providerIcons[provider.key] ?? provider.name.slice(0, 1).toUpperCase()}
                  </Button>
                ))}
              </Space>
            </>
          ) : null}
        </div>
      </section>
      <section aria-hidden="true" />
      <Modal
        title={t("forgotPasswordTitle")}
        open={forgotOpen}
        confirmLoading={forgotMutation.isPending}
        okText={t("sendResetMail")}
        cancelText={t("cancel")}
        onCancel={() => setForgotOpen(false)}
        onOk={() => forgotForm.submit()}
      >
        <Form<ForgotPasswordValues>
          form={forgotForm}
          layout="vertical"
          onFinish={(values) => forgotMutation.mutate(values)}
        >
          <Form.Item
            label={t("accountEmailMobile")}
            name="account"
            rules={[{ required: true, message: "请输入账号、邮箱或手机号" }]}
          >
            <Input size="large" autoComplete="username" placeholder="admin" />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            {locale === "zh-CN"
              ? "如果账号存在且已绑定邮箱，系统会发送一封 30 分钟内有效的密码重置邮件。"
              : "If the account exists and has an email address, a reset email valid for 30 minutes will be sent."}
          </Typography.Paragraph>
        </Form>
      </Modal>
      <Modal
        title={t("resetPassword")}
        open={resetOpen}
        confirmLoading={resetMutation.isPending}
        okText={t("resetPassword")}
        cancelText={t("cancel")}
        onCancel={() => {
          navigation.replace("/login");
        }}
        onOk={() => resetForm.submit()}
      >
        <Form<ResetPasswordValues>
          form={resetForm}
          layout="vertical"
          onFinish={(values) => resetMutation.mutate(values)}
        >
          <Form.Item
            label={t("newPassword")}
            name="password"
            rules={[{ required: true, message: "请输入新密码" }]}
          >
            <Input.Password size="large" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label={t("confirmNewPassword")}
            name="confirmPassword"
            dependencies={["password"]}
            rules={[
              { required: true, message: "请再次输入新密码" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("password") === value) return Promise.resolve();
                  return Promise.reject(new Error("两次输入的密码不一致"));
                },
              }),
            ]}
          >
            <Input.Password size="large" autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </main>
  );
}
