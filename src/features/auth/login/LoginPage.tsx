"use client";

import {
  AlipayOutlined,
  BulbOutlined,
  LockOutlined,
  QqOutlined,
  TaobaoOutlined,
  TranslationOutlined,
  UserOutlined,
  WechatOutlined,
  WeiboOutlined,
} from "@ant-design/icons";
import { Button, Checkbox, Divider, Form, Input, Space, Typography } from "antd";
import { useMemo } from "react";
import { useNavigationAdapter } from "@/platform/navigation";
import { useAuthStore } from "@/stores/auth";

type LoginFormValues = {
  username: string;
  password: string;
  remember?: boolean;
};

export function LoginPage() {
  const navigation = useNavigationAdapter();
  const login = useAuthStore((state) => state.login);
  const loading = useAuthStore((state) => state.loading);

  const redirect = useMemo(() => {
    const params = new URLSearchParams(navigation.search);
    return params.get("redirect") || "/dashboard";
  }, [navigation.search]);

  async function handleFinish(values: LoginFormValues) {
    try {
      await login(values);
      navigation.replace(redirect);
    } catch {
      // request() already displays the API error through the global feedback bridge.
    }
  }

  return (
    <main className="xin-login-page">
      <section className="xin-login-body">
        <div className="xin-login-card">
          <div className="xin-login-tools">
            <Button type="text" size="large" icon={<TranslationOutlined />} aria-label="切换语言" />
            <Button type="text" size="large" icon={<BulbOutlined />} aria-label="切换主题" />
          </div>

          <div className="xin-login-brand">
            <span className="xin-login-logo" aria-label="Xin Admin" />
            <h1 className="xin-login-title">Xin Admin</h1>
            <div className="xin-login-subtitle">基于 Ant Design 的后台管理框架</div>
          </div>

          <Form<LoginFormValues>
            layout="vertical"
            initialValues={{ username: "admin", password: "123456", remember: true }}
            onFinish={handleFinish}
            requiredMark
          >
            <Form.Item
              label="用户名"
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
              label="密码"
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
            <Form.Item>
              <div className="xin-login-extra">
                <Form.Item name="remember" valuePropName="checked" noStyle>
                  <Checkbox>保持登录</Checkbox>
                </Form.Item>
                <Typography.Link>忘记密码</Typography.Link>
              </div>
            </Form.Item>
            <Button type="primary" htmlType="submit" size="large" loading={loading} block>
              login.submit
            </Button>
          </Form>

          <Divider plain>其他登录方式</Divider>
          <Space align="center" className="xin-social-list">
            <span className="xin-social-button">
              <QqOutlined style={{ color: "rgb(123, 212, 239)", fontSize: 20 }} />
            </span>
            <span className="xin-social-button">
              <WechatOutlined style={{ color: "rgb(51, 204, 0)", fontSize: 20 }} />
            </span>
            <span className="xin-social-button">
              <AlipayOutlined style={{ color: "#1677ff", fontSize: 20 }} />
            </span>
            <span className="xin-social-button">
              <TaobaoOutlined style={{ color: "#ff6a10", fontSize: 20 }} />
            </span>
            <span className="xin-social-button">
              <WeiboOutlined style={{ color: "#e71f19", fontSize: 20 }} />
            </span>
          </Space>
        </div>
      </section>
      <section aria-hidden="true" />
    </main>
  );
}
