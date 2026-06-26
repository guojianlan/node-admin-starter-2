"use client";

import {
  AuditOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudServerOutlined,
  FileOutlined,
  LoginOutlined,
  MailOutlined,
  NotificationOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { Badge, Card, Col, List, Row, Space, Spin, Statistic, Tag, Typography } from "antd";
import { request } from "@/lib/request";

type DashboardSummary = {
  metrics: {
    loginSuccessToday: number;
    loginFailedToday: number;
    onlineUsers: number;
    operationLogsToday: number;
    fileCount: number;
    fileBytes: number;
  };
  defaultStorage?: { name: string; type: string; status: number } | null;
  defaultMail?: { name: string; host: string; status: number } | null;
  recentOperations: Array<{
    id: number;
    module: string;
    action: string;
    username?: string | null;
    success: boolean;
    createdAt: string;
  }>;
  recentNotices: Array<{
    id: number;
    title: string;
    type: string;
    publishedAt?: string | null;
  }>;
  readiness: {
    status: "ready" | "degraded" | "failed";
    failed: number;
    warnings: number;
  };
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function DashboardPage() {
  const summaryQuery = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => request<DashboardSummary>("/api/system/dashboard/summary"),
    refetchInterval: 60_000,
  });
  const data = summaryQuery.data;

  return (
    <Spin spinning={summaryQuery.isLoading}>
      <div className="xin-dashboard">
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12} xl={6}>
            <Card className="admin-card" variant="borderless">
              <Statistic title="今日登录成功" value={data?.metrics.loginSuccessToday ?? 0} prefix={<LoginOutlined />} />
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card className="admin-card" variant="borderless">
              <Statistic title="今日登录失败" value={data?.metrics.loginFailedToday ?? 0} prefix={<CloseCircleOutlined />} />
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card className="admin-card" variant="borderless">
              <Statistic title="在线用户" value={data?.metrics.onlineUsers ?? 0} prefix={<TeamOutlined />} />
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card className="admin-card" variant="borderless">
              <Statistic title="今日操作日志" value={data?.metrics.operationLogsToday ?? 0} prefix={<AuditOutlined />} />
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card className="admin-card" title="资源状态" variant="borderless">
              <Space direction="vertical" size={12}>
                <Space>
                  <CloudServerOutlined />
                  <span>默认存储</span>
                  {data?.defaultStorage ? (
                    <>
                      <Tag>{data.defaultStorage.name}</Tag>
                      <Tag color={data.defaultStorage.status === 1 ? "success" : "error"}>
                        {data.defaultStorage.type}
                      </Tag>
                    </>
                  ) : (
                    <Tag color="warning">未配置</Tag>
                  )}
                </Space>
                <Space>
                  <MailOutlined />
                  <span>默认邮件</span>
                  {data?.defaultMail ? (
                    <>
                      <Tag>{data.defaultMail.name}</Tag>
                      <Tag color={data.defaultMail.status === 1 ? "success" : "error"}>
                        {data.defaultMail.host}
                      </Tag>
                    </>
                  ) : (
                    <Tag color="warning">未配置</Tag>
                  )}
                </Space>
                <Space>
                  <FileOutlined />
                  <span>文件</span>
                  <Tag>{data?.metrics.fileCount ?? 0} 个</Tag>
                  <Tag>{formatBytes(data?.metrics.fileBytes ?? 0)}</Tag>
                </Space>
                <Space>
                  {data?.readiness.status === "ready" ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                  <span>Doctor</span>
                  <Tag color={data?.readiness.status === "ready" ? "success" : data?.readiness.status === "degraded" ? "warning" : "error"}>
                    {data?.readiness.status ?? "-"}
                  </Tag>
                </Space>
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card className="admin-card" title="最近高风险/操作" variant="borderless">
              <List
                size="small"
                dataSource={data?.recentOperations ?? []}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      title={
                        <Space>
                          <Badge status={item.success ? "success" : "error"} />
                          <Typography.Text>{item.module}</Typography.Text>
                          <Tag>{item.action}</Tag>
                        </Space>
                      }
                      description={`${item.username || "system"} · ${dayjs(item.createdAt).format("MM-DD HH:mm")}`}
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card className="admin-card" title="最近公告" variant="borderless">
              <List
                size="small"
                dataSource={data?.recentNotices ?? []}
                renderItem={(item) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={<NotificationOutlined />}
                      title={
                        <Space>
                          <Typography.Text>{item.title}</Typography.Text>
                          <Tag color={item.type === "announcement" ? "orange" : "blue"}>
                            {item.type === "announcement" ? "公告" : "通知"}
                          </Tag>
                        </Space>
                      }
                      description={item.publishedAt ? dayjs(item.publishedAt).format("YYYY-MM-DD HH:mm") : "未设置发布时间"}
                    />
                  </List.Item>
                )}
              />
            </Card>
          </Col>
        </Row>
      </div>
    </Spin>
  );
}
