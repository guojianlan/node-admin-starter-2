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
  UndoOutlined,
  UserOutlined,
  VerticalLeftOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Badge,
  Button,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Popover,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import type { ReactNode } from "react";
import { useState } from "react";
import { RichTextContent } from "@/components/rich-text/RichTextContent";
import { request } from "@/lib/request";
import { richTextToPlainText } from "@/lib/rich-text";
import { useNavigationAdapter } from "@/platform/navigation";
import { useAuthStore } from "@/stores/auth";
import { useAdminPreferences, type AdminLayoutMode } from "@/ui/preferences";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { SaasContextSwitcher } from "./SaasContextSwitcher";

type AdminHeaderProps = {
  collapsed: boolean;
  isMobile?: boolean;
  navigation?: ReactNode;
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

type HeaderProfile = {
  avatarUrl?: string | null;
};

const layoutCards = [
  { key: "side" },
  { key: "top" },
  { key: "mix" },
  { key: "columns" },
] satisfies Array<{ key: AdminLayoutMode }>;

function LayoutPreview({
  type,
  variant = "compact",
}: {
  type: AdminLayoutMode;
  variant?: "compact" | "live";
}) {
  return (
    <div
      className={`xin-layout-preview xin-layout-preview-${type} xin-layout-preview-${variant}`}
      aria-hidden="true"
    >
      <span className="xin-layout-preview-header" />
      <span className="xin-layout-preview-primary" />
      <span className="xin-layout-preview-secondary" />
      <span className="xin-layout-preview-content">
        <span className="xin-layout-preview-summary">
          <span className="xin-layout-preview-summary-copy" />
          <span className="xin-layout-preview-summary-action" />
        </span>
        <span className="xin-layout-preview-table">
          <span className="xin-layout-preview-table-head" />
          <span className="xin-layout-preview-table-row" />
          <span className="xin-layout-preview-table-row" />
          <span className="xin-layout-preview-table-row" />
        </span>
      </span>
    </div>
  );
}

export function AdminHeader({
  collapsed,
  isMobile = false,
  navigation: headerNavigation,
  onToggleCollapsed,
}: AdminHeaderProps) {
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
  const canCollapse = isMobile || layoutMode !== "top";
  const compactBrand =
    !isMobile && (layoutMode === "columns" || (layoutMode !== "top" && collapsed));
  const queryClient = useQueryClient();
  const userDisplayName = user?.nickname || user?.username || "超级管理员";
  const userAvatarFallback = userDisplayName.trim().slice(0, 1).toUpperCase();
  const [fullscreen, setFullscreen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeListOpen, setNoticeListOpen] = useState(false);
  const [noticeFilter, setNoticeFilter] = useState<"all" | "unread" | "read">("all");
  const [selectedNotice, setSelectedNotice] = useState<MyNotice | null>(null);
  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => request<HeaderProfile>("/api/system/profile", { silent: true }),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  });
  const unreadQuery = useQuery({
    queryKey: ["notice", "unread-count"],
    queryFn: () =>
      request<{ total: number }>("/api/system/notice/my/unread-count", { silent: true }),
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

  const filteredNotices = (noticeQuery.data ?? []).filter((item) => {
    if (noticeFilter === "unread") return !item.readAt;
    if (noticeFilter === "read") return Boolean(item.readAt);
    return true;
  });

  const renderNoticeList = (limit?: number) => (
    <div
      className="admin-notice-list"
      aria-busy={noticeQuery.isFetching}
      style={{ width: limit ? 320 : "100%" }}
      role="list"
    >
      {(limit ? filteredNotices.slice(0, limit) : filteredNotices).map((item) => (
        <button
          className="admin-notice-list-item"
          key={item.id}
          type="button"
          onClick={() => openNoticeDetail(item)}
        >
          <Space size={6}>
            {!item.readAt ? <Badge status="processing" /> : null}
            <Typography.Text style={{ maxWidth: limit ? 220 : 420 }} ellipsis>
              {item.title}
            </Typography.Text>
          </Space>
          <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
            {richTextToPlainText(item.content) || "图片内容"}
          </Typography.Paragraph>
        </button>
      ))}
      {!filteredNotices.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("noNotice")} />
      ) : null}
    </div>
  );

  return (
    <>
      <div className="xin-header">
        <div className={compactBrand ? "xin-brand xin-brand-collapsed" : "xin-brand"}>
          <span className="xin-brand-logo" aria-label="Admin Base" />
          {!compactBrand ? <span className="xin-brand-title">Admin Base</span> : null}
        </div>
        <div className="xin-header-main">
          <div className="xin-header-left">
            {canCollapse ? (
              <Button
                className="xin-header-icon"
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={onToggleCollapsed}
                aria-label="切换菜单"
              />
            ) : null}
            {headerNavigation ? (
              <div className="xin-header-navigation">{headerNavigation}</div>
            ) : (
              <BreadcrumbBar />
            )}
          </div>
          <div className="xin-header-right">
            <SaasContextSwitcher />
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
                <Space orientation="vertical" size={10} style={{ width: 320 }}>
                  <Segmented
                    block
                    size="small"
                    value={noticeFilter}
                    options={[
                      { label: "全部", value: "all" },
                      { label: "未读", value: "unread" },
                      { label: "已读", value: "read" },
                    ]}
                    onChange={(value) => setNoticeFilter(value as "all" | "unread" | "read")}
                  />
                  {renderNoticeList(6)}
                  <Button
                    block
                    type="link"
                    onClick={() => {
                      setNoticeOpen(false);
                      setNoticeListOpen(true);
                    }}
                  >
                    查看更多
                  </Button>
                </Space>
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
                  <span className="xin-user-name">{userDisplayName}</span>
                  <Avatar
                    size={24}
                    src={profileQuery.data?.avatarUrl || undefined}
                    icon={userAvatarFallback ? undefined : <UserOutlined />}
                  >
                    {profileQuery.data?.avatarUrl ? null : userAvatarFallback}
                  </Avatar>
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
            <RichTextContent html={selectedNotice.content} />
          </div>
        ) : null}
      </Modal>

      <Drawer
        title={t("noticeCenter")}
        open={noticeListOpen}
        size={520}
        onClose={() => setNoticeListOpen(false)}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Segmented
            block
            value={noticeFilter}
            options={[
              { label: "全部", value: "all" },
              { label: "未读", value: "unread" },
              { label: "已读", value: "read" },
            ]}
            onChange={(value) => setNoticeFilter(value as "all" | "unread" | "read")}
          />
          {renderNoticeList()}
        </Space>
      </Drawer>

      <Drawer
        title={t("interfaceSettings")}
        open={settingsOpen}
        placement="right"
        size="min(420px, calc(100vw - 12px))"
        className="xin-settings-drawer"
        onClose={() => setSettingsOpen(false)}
        extra={
          <Tooltip title={t("resetSettings")}>
            <Button
              type="text"
              icon={<UndoOutlined />}
              aria-label={t("resetSettings")}
              onClick={resetPreferences}
            />
          </Tooltip>
        }
        footer={
          <Button block icon={<UndoOutlined />} onClick={resetPreferences}>
            {t("resetSettings")}
          </Button>
        }
      >
        <div className="xin-settings-live-preview">
          <LayoutPreview type={layoutMode} variant="live" />
        </div>

        <section className="xin-settings-section">
          <div className="xin-settings-section-title">{t("layoutStyle")}</div>
          <div className="xin-settings-layouts">
            {layoutCards.map((item) => {
              const active = layoutMode === item.key;
              const label = t(
                item.key === "side"
                  ? "sideMenu"
                  : item.key === "top"
                    ? "topMenu"
                    : item.key === "mix"
                      ? "mixMenu"
                      : "columnsMenu",
              );
              const shortLabel =
                locale === "zh-CN"
                  ? item.key === "side"
                    ? "侧边"
                    : item.key === "top"
                      ? "顶部"
                      : item.key === "mix"
                        ? "混合"
                        : "分栏"
                  : item.key === "side"
                    ? "Side"
                    : item.key === "top"
                      ? "Top"
                      : item.key === "mix"
                        ? "Mixed"
                        : "Columns";
              return (
                <button
                  type="button"
                  key={item.key}
                  className={
                    active
                      ? "xin-settings-layout-card xin-settings-layout-card-active"
                      : "xin-settings-layout-card"
                  }
                  aria-label={label}
                  aria-pressed={active}
                  onClick={() => setLayoutMode(item.key)}
                >
                  <LayoutPreview type={item.key} variant="compact" />
                  <span className="xin-settings-card-label">{shortLabel}</span>
                  <span className="xin-settings-card-description">{label}</span>
                  {active ? (
                    <span className="xin-settings-card-check" aria-hidden="true">
                      <CheckOutlined />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        <section className="xin-settings-section">
          <div className="xin-settings-section-title">{t("presetTheme")}</div>
          <div className="xin-settings-themes">
            <button
              type="button"
              aria-label={t("light")}
              aria-pressed={themeMode === "light"}
              className={
                themeMode === "light" ? "xin-theme-card xin-theme-card-active" : "xin-theme-card"
              }
              onClick={() => setThemeMode("light")}
            >
              <SunOutlined className="xin-theme-card-icon" />
              <span className="xin-settings-card-label">{t("light")}</span>
              {themeMode === "light" ? <CheckOutlined className="xin-theme-card-check" /> : null}
            </button>
            <button
              type="button"
              aria-label={t("dark")}
              aria-pressed={themeMode === "dark"}
              className={
                themeMode === "dark" ? "xin-theme-card xin-theme-card-active" : "xin-theme-card"
              }
              onClick={() => setThemeMode("dark")}
            >
              <MoonOutlined className="xin-theme-card-icon" />
              <span className="xin-settings-card-label">{t("dark")}</span>
              {themeMode === "dark" ? <CheckOutlined className="xin-theme-card-check" /> : null}
            </button>
          </div>
        </section>
      </Drawer>
    </>
  );
}
