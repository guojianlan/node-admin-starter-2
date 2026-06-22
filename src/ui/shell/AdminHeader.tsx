"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  EnterOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  GithubOutlined,
  HomeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SearchOutlined,
  SettingOutlined,
  TranslationOutlined,
  UserOutlined,
  VerticalLeftOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Button,
  Col,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Input,
  Modal,
  Row,
  Space,
  Tooltip,
} from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import { useNavigationAdapter } from "@/platform/navigation";
import { useAuthStore } from "@/stores/auth";
import { BreadcrumbBar } from "./BreadcrumbBar";

type AdminHeaderProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

const layoutCards = [
  { key: "side", title: "侧边菜单" },
  { key: "top", title: "顶部菜单" },
  { key: "mix", title: "混合菜单" },
  { key: "columns", title: "分栏菜单" },
];

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
  const [fullscreen, setFullscreen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layout, setLayout] = useState("side");

  const items: MenuProps["items"] = [
    {
      key: "profile",
      icon: <UserOutlined />,
      label: "个人中心",
      onClick: () => navigation.push("/dashboard"),
    },
    {
      key: "logout",
      icon: <VerticalLeftOutlined />,
      label: "退出登录",
      onClick: () => void logout(),
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
            <Tooltip title="首页">
              <Button
                className="xin-header-icon"
                type="text"
                icon={<HomeOutlined />}
                onClick={() => navigation.push("/dashboard")}
              />
            </Tooltip>
            <Tooltip title="GitHub">
              <Button
                className="xin-header-icon"
                type="text"
                icon={<GithubOutlined />}
                onClick={() => window.open("https://github.com/xin-admin/xin-admin-laravel", "_blank")}
              />
            </Tooltip>
            <Tooltip title="搜索">
              <Button
                className="xin-header-icon"
                type="text"
                icon={<SearchOutlined />}
                onClick={() => setSearchOpen(true)}
              />
            </Tooltip>
            <Tooltip title={fullscreen ? "退出全屏" : "全屏"}>
              <Button
                className="xin-header-icon"
                type="text"
                icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={() => void toggleFullscreen()}
              />
            </Tooltip>
            <Tooltip title="语言">
              <Button className="xin-header-icon" type="text" icon={<TranslationOutlined />} />
            </Tooltip>
            <Tooltip title="设置">
              <Button
                className="xin-header-icon"
                type="text"
                icon={<SettingOutlined />}
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

      <Drawer
        open={settingsOpen}
        placement="right"
        closable={false}
        onClose={() => setSettingsOpen(false)}
        footer={
          <Button onClick={() => setLayout("side")}>
            重置设置
          </Button>
        }
        styles={{ body: { paddingTop: 10 } }}
      >
        <Divider>布局样式</Divider>
        <div className="xin-settings-layouts">
          {layoutCards.map((item) => (
            <Tooltip title={item.title} key={item.key}>
              <div
                className={
                  layout === item.key
                    ? "xin-settings-layout-card xin-settings-layout-card-active"
                    : "xin-settings-layout-card"
                }
                onClick={() => setLayout(item.key)}
              >
                <LayoutPreview type={item.key} />
              </div>
            </Tooltip>
          ))}
        </div>
        <Divider>预设主题</Divider>
        <Row gutter={20}>
          <Col span={8}>
            <div
              aria-label="light"
              style={{
                width: "100%",
                aspectRatio: "1.3",
                borderRadius: 8,
                background: 'url("/static/theme/default.svg") center / cover no-repeat',
              }}
            />
            <div style={{ marginTop: 6, textAlign: "center" }}>亮色</div>
          </Col>
          <Col span={8}>
            <div
              aria-label="dark"
              style={{
                width: "100%",
                aspectRatio: "1.3",
                borderRadius: 8,
                background: 'url("/static/theme/dark.svg") center / cover no-repeat',
              }}
            />
            <div style={{ marginTop: 6, textAlign: "center" }}>暗色</div>
          </Col>
        </Row>
      </Drawer>
    </>
  );
}
