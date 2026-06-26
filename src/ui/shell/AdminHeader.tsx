"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CheckOutlined,
  EnterOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  GithubOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  NotificationOutlined,
  SearchOutlined,
  SettingOutlined,
  SunOutlined,
  TranslationOutlined,
  UserOutlined,
  VerticalLeftOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Badge,
  Button,
  Col,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Popover,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useState } from "react";
import { request } from "@/lib/request";
import { useNavigationAdapter } from "@/platform/navigation";
import { useAuthStore } from "@/stores/auth";
import { useAdminPreferences, type AdminLayoutMode } from "@/ui/preferences";
import { BreadcrumbBar } from "./BreadcrumbBar";

type AdminHeaderProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

type MyNotice = {
  id: number;
  title: string;
  content: string;
  type: string;
  readAt?: string | null;
  publishedAt?: string | null;
};

const layoutCards = [
  { key: "side", title: "侧边菜单" },
  { key: "top", title: "顶部菜单" },
  { key: "mix", title: "混合菜单" },
  { key: "columns", title: "分栏菜单" },
] satisfies Array<{ key: AdminLayoutMode; title: string }>;

function LayoutPreview({ type }: { type: string }) {
  if (type === "top") {
    return (
      <>
        <div style={{ height: 24, borderRadius: 4, background: "var(--admin-primary)" }} />
        <div style={{ height: 64, marginTop: 6, borderRadius: 4, background: "var(--admin-primary-bg)" }} />
      </>
    );
  }

  if (type === "columns") {
    return (
      <div style={{ display: "flex", height: 96, gap: 6 }}>
        <div style={{ width: 12, borderRadius: 4, background: "var(--admin-primary)" }} />
        <div style={{ width: 24, borderRadius: 4, background: "#69b1ff" }} />
        <div style={{ flex: 1, borderRadius: 4, background: "var(--admin-primary-bg)" }} />
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          height: 24,
          borderRadius: 4,
          background: type === "mix" ? "var(--admin-primary)" : "#91caff",
        }}
      />
      <div style={{ display: "flex", height: 64, gap: 6, marginTop: 6 }}>
        <div style={{ width: 24, borderRadius: 4, background: "var(--admin-primary)" }} />
        <div style={{ flex: 1, borderRadius: 4, background: "var(--admin-primary-bg)" }} />
      </div>
    </>
  );
}

export function AdminHeader({ collapsed, onToggleCollapsed }: AdminHeaderProps) {
  const navigation = useNavigationAdapter();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const {
    layoutMode,
    locale,
    resetPreferences,
    setLayoutMode,
    setLocale,
    setThemeMode,
    t,
    themeMode,
  } = useAdminPreferences();
  const queryClient = useQueryClient();
  const [fullscreen, setFullscreen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState<MyNotice | null>(null);
  const unreadQuery = useQuery({
    queryKey: ["notice", "unread-count"],
    queryFn: () => request<{ total: number }>("/api/system/notice/my/unread-count", { silent: true }),
    enabled: Boolean(user),
    refetchInterval: 60_000,
  });
  const noticeQuery = useQuery({
    queryKey: ["notice", "my"],
    queryFn: () => request<MyNotice[]>("/api/system/notice/my", { silent: true }),
    enabled: Boolean(user),
  });
  const readAllMutation = useMutation({
    mutationFn: () => request("/api/system/notice/my/read-all", { method: "POST", body: {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notice"] });
    },
  });
  const readMutation = useMutation({
    mutationFn: (id: number) =>
      request(`/api/system/notice/my/${id}/read`, { method: "POST", body: {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notice"] });
    },
  });

  const items: MenuProps["items"] = [
    {
      key: "profile",
      icon: <UserOutlined />,
      label: t("profile"),
      onClick: () => navigation.push("/profile"),
    },
    {
      key: "logout",
      icon: <VerticalLeftOutlined />,
      label: t("logout"),
      onClick: () => void logout(),
    },
  ];
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

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      setFullscreen(true);
      return;
    }
    await document.exitFullscreen();
    setFullscreen(false);
  }

  function openNoticeDetail(item: MyNotice) {
    setSelectedNotice(item.readAt ? item : { ...item, readAt: new Date().toISOString() });
    setNoticeOpen(false);
    if (!item.readAt) readMutation.mutate(item.id);
  }

  return (
    <>
      <div className="xin-header">
        <div className={collapsed ? "xin-brand xin-brand-collapsed" : "xin-brand"}>
          <span className="xin-brand-logo" aria-label="Admin Base" />
          {!collapsed ? <span className="xin-brand-title">Admin Base</span> : null}
        </div>
        <div className="xin-header-main">
          <div className="xin-header-left">
            <Button
              className="xin-header-icon"
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={onToggleCollapsed}
              aria-label="切换菜单"
            />
            <BreadcrumbBar />
          </div>
          <div className="xin-header-right">
            <Tooltip title={t("home")}>
              <Button
                className="xin-header-icon"
                type="text"
                icon={<HomeOutlined />}
                aria-label={t("home")}
                onClick={() => navigation.push("/dashboard")}
              />
            </Tooltip>
            <Tooltip title={t("github")}>
              <Button
                className="xin-header-icon"
                type="text"
                icon={<GithubOutlined />}
                aria-label={t("github")}
                onClick={() =>
                  window.open("https://github.com/xin-admin/xin-admin-laravel", "_blank")
                }
              />
            </Tooltip>
            <Tooltip title={t("search")}>
              <Button
                className="xin-header-icon"
                type="text"
                icon={<SearchOutlined />}
                aria-label={t("search")}
                onClick={() => setSearchOpen(true)}
              />
            </Tooltip>
            <Tooltip title={fullscreen ? t("exitFullscreen") : t("fullscreen")}>
              <Button
                className="xin-header-icon"
                type="text"
                icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                aria-label={fullscreen ? t("exitFullscreen") : t("fullscreen")}
                onClick={() => void toggleFullscreen()}
              />
            </Tooltip>
            <Dropdown menu={{ items: localeItems }} trigger={["click"]}>
              <Button
                className="xin-header-icon"
                type="text"
                icon={<TranslationOutlined />}
                aria-label={t("language")}
              />
            </Dropdown>
            <Popover
              trigger="click"
              placement="bottomRight"
              open={noticeOpen}
              onOpenChange={(open) => {
                setNoticeOpen(open);
                if (open) {
                  void noticeQuery.refetch();
                  void unreadQuery.refetch();
                }
              }}
              title={
                <Space style={{ width: 300, justifyContent: "space-between" }}>
                  <span>{t("noticeCenter")}</span>
                  <Button
                    type="link"
                    size="small"
                    loading={readAllMutation.isPending}
                    onClick={() => readAllMutation.mutate()}
                  >
                    {t("markAllRead")}
                  </Button>
                </Space>
              }
              content={
                <List<MyNotice>
                  style={{ width: 320 }}
                  size="small"
                  loading={noticeQuery.isFetching}
                  dataSource={(noticeQuery.data ?? []).slice(0, 6)}
                  locale={{ emptyText: t("noNotice") }}
                  renderItem={(item) => (
                    <List.Item
                      style={{ cursor: "pointer", paddingInline: 4 }}
                      onClick={() => openNoticeDetail(item)}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={6}>
                            {!item.readAt ? <Badge status="processing" /> : null}
                            <Typography.Text style={{ maxWidth: 220 }} ellipsis>
                              {item.title}
                            </Typography.Text>
                          </Space>
                        }
                        description={
                          <Typography.Paragraph
                            type="secondary"
                            ellipsis={{ rows: 2 }}
                            style={{ marginBottom: 0 }}
                          >
                            {item.content}
                          </Typography.Paragraph>
                        }
                      />
                    </List.Item>
                  )}
                />
              }
            >
              <Badge count={unreadQuery.data?.total ?? 0} size="small">
                <Button
                  className="xin-header-icon"
                  type="text"
                  icon={<NotificationOutlined />}
                  aria-label={t("noticeCenter")}
                />
              </Badge>
            </Popover>
            <Tooltip title={t("settings")}>
              <Button
                className="xin-header-icon"
                type="text"
                icon={<SettingOutlined />}
                aria-label={t("settings")}
                onClick={() => setSettingsOpen(true)}
              />
            </Tooltip>
            <Dropdown menu={{ items }} trigger={["click"]}>
              <Button className="xin-user-button" type="text">
                <Space size={8}>
                  <span className="xin-user-name">{user?.nickname || user?.username || "超级管理员"}</span>
                  <Avatar size={24} src="/favicons.svg" icon={<UserOutlined />} />
                </Space>
              </Button>
            </Dropdown>
          </div>
        </div>
      </div>

      <Modal
        open={searchOpen}
        footer={null}
        closable={false}
        width={600}
        style={{ top: 40 }}
        onCancel={() => setSearchOpen(false)}
      >
        <div style={{ padding: 20 }}>
          <Input size="large" placeholder="请输入菜单名称" prefix={<SearchOutlined />} />
          <div style={{ marginTop: 20 }}>
            <Empty />
          </div>
        </div>
        <Space
          style={{
            width: "100%",
            borderTop: "1px solid var(--admin-border)",
            padding: "10px 20px",
          }}
        >
          <EnterOutlined />
          <span style={{ marginRight: 16 }}>确认</span>
          <ArrowUpOutlined />
          <ArrowDownOutlined />
          <span style={{ marginRight: 16 }}>切换</span>
          <span>Esc</span>
          <span>关闭</span>
        </Space>
      </Modal>

      <Modal
        open={Boolean(selectedNotice)}
        footer={
          <Button type="primary" onClick={() => setSelectedNotice(null)}>
            关闭
          </Button>
        }
        width={640}
        onCancel={() => setSelectedNotice(null)}
        destroyOnHidden
      >
        {selectedNotice ? (
          <div style={{ paddingTop: 8 }}>
            <Space size={8} wrap>
              <Tag color={selectedNotice.type === "announcement" ? "orange" : "blue"}>
                {selectedNotice.type === "announcement" ? "公告" : "通知"}
              </Tag>
              <Tag color={selectedNotice.readAt ? "default" : "processing"}>
                {selectedNotice.readAt ? "已读" : "未读"}
              </Tag>
              {selectedNotice.publishedAt ? (
                <Typography.Text type="secondary">
                  {dayjs(selectedNotice.publishedAt).format("YYYY-MM-DD HH:mm:ss")}
                </Typography.Text>
              ) : null}
            </Space>
            <Typography.Title level={4} style={{ marginTop: 16, marginBottom: 12 }}>
              {selectedNotice.title}
            </Typography.Title>
            <Divider style={{ margin: "12px 0" }} />
            <Typography.Paragraph
              style={{
                marginBottom: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {selectedNotice.content}
            </Typography.Paragraph>
          </div>
        ) : null}
      </Modal>

      <Drawer
        open={settingsOpen}
        placement="right"
        closable={false}
        onClose={() => setSettingsOpen(false)}
        footer={
          <Button onClick={resetPreferences}>{t("resetSettings")}</Button>
        }
        styles={{ body: { paddingTop: 10 } }}
      >
        <Divider>{t("layoutStyle")}</Divider>
        <div className="xin-settings-layouts">
          {layoutCards.map((item) => (
            <Tooltip
              title={t(
                item.key === "side"
                  ? "sideMenu"
                  : item.key === "top"
                    ? "topMenu"
                    : item.key === "mix"
                      ? "mixMenu"
                      : "columnsMenu",
              )}
              key={item.key}
            >
              <div
                className={
                  layoutMode === item.key
                    ? "xin-settings-layout-card xin-settings-layout-card-active"
                    : "xin-settings-layout-card"
                }
                onClick={() => setLayoutMode(item.key)}
              >
                <LayoutPreview type={item.key} />
              </div>
            </Tooltip>
          ))}
        </div>
        <Divider>{t("presetTheme")}</Divider>
        <Row gutter={20}>
          <Col span={8}>
            <Button
              aria-label={t("light")}
              className={
                themeMode === "light"
                  ? "xin-theme-card xin-theme-card-active"
                  : "xin-theme-card"
              }
              icon={<SunOutlined />}
              onClick={() => setThemeMode("light")}
            />
            <div style={{ marginTop: 6, textAlign: "center" }}>{t("light")}</div>
          </Col>
          <Col span={8}>
            <Button
              aria-label={t("dark")}
              className={
                themeMode === "dark"
                  ? "xin-theme-card xin-theme-card-dark xin-theme-card-active"
                  : "xin-theme-card xin-theme-card-dark"
              }
              icon={<MoonOutlined />}
              onClick={() => setThemeMode("dark")}
            />
            <div style={{ marginTop: 6, textAlign: "center" }}>{t("dark")}</div>
          </Col>
        </Row>
      </Drawer>
    </>
  );
}
