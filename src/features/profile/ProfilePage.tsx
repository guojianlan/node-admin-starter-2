"use client";

import {
  ClockCircleOutlined,
  KeyOutlined,
  LockOutlined,
  MailOutlined,
  MobileOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import {
  Avatar,
  Badge,
  Button,
  Col,
  Form,
  Input,
  Radio,
  Row,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { useEffect, useRef } from "react";
import { request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { useAuthStore } from "@/stores/auth";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { useAdminPreferences } from "@/ui/preferences";

type ProfileRecord = {
  id: number;
  username: string;
  nickname: string;
  email?: string | null;
  mobile?: string | null;
  sex: number;
  bio?: string | null;
  deptName?: string | null;
  avatarUrl?: string | null;
  loginIp?: string | null;
  loginTime?: string | null;
  passwordUpdatedAt?: string | null;
};

type LoginRecord = {
  id: number;
  ip?: string | null;
  userAgent?: string | null;
  status: number;
  message?: string | null;
  createdAt: string;
};

type ProfileFormValues = {
  nickname: string;
  email?: string;
  mobile?: string;
  sex?: number;
  bio?: string;
};

type PasswordFormValues = {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export function ProfilePage() {
  const [profileForm] = Form.useForm<ProfileFormValues>();
  const [passwordForm] = Form.useForm<PasswordFormValues>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  const initSession = useAuthStore((state) => state.initSession);
  const { t } = useAdminPreferences();

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => request<ProfileRecord>("/api/system/profile"),
  });
  const loginRecordsQuery = useQuery({
    queryKey: ["profile", "login-records"],
    queryFn: () =>
      request<PageResult<LoginRecord>>("/api/system/profile/login-records?page=1&pageSize=10"),
  });

  useEffect(() => {
    if (profileQuery.data) {
      profileForm.setFieldsValue({
        nickname: profileQuery.data.nickname,
        email: profileQuery.data.email ?? "",
        mobile: profileQuery.data.mobile ?? "",
        sex: profileQuery.data.sex,
        bio: profileQuery.data.bio ?? "",
      });
    }
  }, [profileForm, profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (values: ProfileFormValues) =>
      request("/api/system/profile", { method: "PUT", body: values }),
    onSuccess: async () => {
      feedback.success("保存成功");
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      await initSession();
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (values: PasswordFormValues) =>
      request("/api/system/profile/password", {
        method: "PUT",
        body: { oldPassword: values.oldPassword, newPassword: values.newPassword },
      }),
    onSuccess: () => {
      passwordForm.resetFields();
      feedback.success("密码已更新");
    },
  });

  const avatarMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<{ id: number; url: string }>("/api/system/profile/avatar", {
        method: "POST",
        body: form,
      });
    },
    onSuccess: async () => {
      feedback.success("头像已更新");
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      await initSession();
    },
  });

  const profile = profileQuery.data;

  return (
    <PageScaffold title={t("profile")} description={t("profileSubtitle")}>
      <div className="profile-workspace">
        <section className="profile-hero">
          <div className="profile-identity">
            <Avatar
              className="profile-avatar"
              size={88}
              src={profile?.avatarUrl || "/favicons.svg"}
              icon={<UserOutlined />}
            />
            <div className="profile-identity-main">
              <Typography.Title level={3} className="profile-name">
                {profile?.nickname || profile?.username || "-"}
              </Typography.Title>
              <Space size={8} wrap>
                <Typography.Text type="secondary">
                  {profile?.username ? `@${profile.username}` : "-"}
                </Typography.Text>
                <Tag color="blue">{profile?.deptName || "未分配部门"}</Tag>
              </Space>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) avatarMutation.mutate(file);
                event.target.value = "";
              }}
            />
            <Button
              icon={<UploadOutlined />}
              loading={avatarMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {t("uploadAvatar")}
            </Button>
          </div>
          <div className="profile-facts">
            <div className="profile-fact">
              <MobileOutlined />
              <span>{profile?.mobile || "-"}</span>
            </div>
            <div className="profile-fact">
              <MailOutlined />
              <span>{profile?.email || "-"}</span>
            </div>
            <div className="profile-fact">
              <ClockCircleOutlined />
              <span>
                {profile?.loginTime
                  ? dayjs(profile.loginTime).format("YYYY-MM-DD HH:mm")
                  : t("lastLogin")}
              </span>
            </div>
            <div className="profile-fact">
              <KeyOutlined />
              <span>
                {profile?.passwordUpdatedAt
                  ? dayjs(profile.passwordUpdatedAt).format("YYYY-MM-DD HH:mm")
                  : t("passwordUpdatedAt")}
              </span>
            </div>
          </div>
        </section>

        <section className="profile-panel">
            <Tabs
              items={[
                {
                  key: "base",
                  label: t("baseInfo"),
                  children: (
                    <Form
                      className="profile-form"
                      form={profileForm}
                      layout="vertical"
                      onFinish={(values) => saveMutation.mutate(values)}
                    >
                      <Row gutter={16}>
                        <Col xs={24} md={12}>
                          <Form.Item name="nickname" label={t("nickname")} rules={[{ required: true, message: "请输入昵称" }]}>
                            <Input />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item name="mobile" label={t("mobile")}>
                            <Input />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item name="email" label={t("email")} rules={[{ type: "email", message: "邮箱格式不正确" }]}>
                            <Input />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item name="sex" label={t("sex")}>
                            <Radio.Group
                              options={[
                                { label: t("unknown"), value: 0 },
                                { label: t("male"), value: 1 },
                                { label: t("female"), value: 2 },
                              ]}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={24}>
                          <Form.Item name="bio" label={t("bio")}>
                            <Input.TextArea rows={4} maxLength={240} showCount />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saveMutation.isPending}>
                        {t("saveProfile")}
                      </Button>
                    </Form>
                  ),
                },
                {
                  key: "security",
                  label: t("securitySettings"),
                  children: (
                    <Form
                      form={passwordForm}
                      layout="vertical"
                      onFinish={(values) => passwordMutation.mutate(values)}
                    >
                      <Row gutter={16}>
                        <Col xs={24} md={12}>
                          <Form.Item
                            name="oldPassword"
                            label={t("oldPassword")}
                            rules={[{ required: true, message: "请输入旧密码" }]}
                          >
                            <Input.Password prefix={<LockOutlined />} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item
                            name="newPassword"
                            label={t("newPassword")}
                            rules={[{ required: true, message: "请输入新密码" }]}
                          >
                            <Input.Password prefix={<LockOutlined />} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                          <Form.Item
                            name="confirmPassword"
                            label={t("confirmNewPassword")}
                            dependencies={["newPassword"]}
                            rules={[
                              { required: true, message: "请再次输入新密码" },
                              ({ getFieldValue }) => ({
                                validator(_, value) {
                                  if (!value || getFieldValue("newPassword") === value) {
                                    return Promise.resolve();
                                  }
                                  return Promise.reject(new Error("两次输入的新密码不一致"));
                                },
                              }),
                            ]}
                          >
                            <Input.Password prefix={<LockOutlined />} />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Button
                        type="primary"
                        htmlType="submit"
                        icon={<SaveOutlined />}
                        loading={passwordMutation.isPending}
                      >
                        {t("changePassword")}
                      </Button>
                    </Form>
                  ),
                },
                {
                  key: "login",
                  label: t("loginRecords"),
                  children: (
                    <Space direction="vertical" style={{ width: "100%" }}>
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={() => void loginRecordsQuery.refetch()}
                      >
                        {t("refresh")}
                      </Button>
                      <Table<LoginRecord>
                        rowKey="id"
                        size="small"
                        loading={loginRecordsQuery.isFetching}
                        dataSource={loginRecordsQuery.data?.data ?? []}
                        pagination={false}
                        columns={[
                          {
                            title: t("result"),
                            dataIndex: "status",
                            width: 96,
                            render: (value) =>
                              Number(value) === 1 ? (
                                <Badge status="success" text={t("success")} />
                              ) : (
                                <Badge status="error" text={t("failed")} />
                              ),
                          },
                          { title: "IP", dataIndex: "ip", width: 140 },
                          {
                            title: t("message"),
                            dataIndex: "message",
                            width: 140,
                          },
                          {
                            title: "User-Agent",
                            dataIndex: "userAgent",
                            ellipsis: true,
                          },
                          {
                            title: t("time"),
                            dataIndex: "createdAt",
                            width: 180,
                            render: (value) => dayjs(String(value)).format("YYYY-MM-DD HH:mm:ss"),
                          },
                        ]}
                      />
                    </Space>
                  ),
                },
              ]}
            />
        </section>
      </div>
    </PageScaffold>
  );
}
