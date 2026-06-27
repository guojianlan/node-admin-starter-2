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
import { Alert, Badge, Card, Col, Empty, List, Row, Space, Spin, Statistic, Tag, Typography } from "antd";
import { request } from "@/lib/request";
import { useNavigationAdapter } from "@/platform/navigation";

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
    riskLevel?: "high" | "critical";
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
  const navigation = useNavigationAdapter();
  const summaryQuery = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => request<DashboardSummary>("/api/system/dashboard/summary"),
    refetchInterval: 60_000,
  });
  const data = summaryQuery.data;

  return (
    <Spin spinning={summaryQuery.isLoading}>
      <div className="xin-dashboard">
        {summaryQuery.isError ? (
          <Alert type="error" showIcon message="系统状态加载失败" style={{ marginBottom: 16 }} />
        ) : null}
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
                      <Tag style={{ cursor: "pointer" }} onClick={() => navigation.push("/system/storage")}>
                        {data.defaultStorage.name}
                      </Tag>
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
                      <Tag style={{ cursor: "pointer" }} onClick={() => navigation.push("/system/mail/account")}>
                        {data.defaultMail.name}
                      </Tag>
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
                  <Tag style={{ cursor: "pointer" }} onClick={() => navigation.push("/system/file")}>
                    {data?.metrics.fileCount ?? 0} 个
                  </Tag>
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
            <Card className="admin-card" title="最近高风险操作" variant="borderless">
              <List
                size="small"
                dataSource={data?.recentOperations ?? []}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无高风险操作" /> }}
                renderItem={(item) => (
                  <List.Item
                    onClick={() =>
                      navigation.push(
                        `/system/operation/log?module=${encodeURIComponent(item.module)}&action=${encodeURIComponent(item.action)}`,
                      )
                    }
                    style={{ cursor: "pointer" }}
                  >
                    <List.Item.Meta
                      title={
                        <Space>
                          <Badge status={item.success ? "success" : "error"} />
                          <Typography.Text>{item.module}</Typography.Text>
                          <Tag color={item.riskLevel === "critical" ? "red" : "orange"}>{item.riskLevel}</Tag>
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
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无公告" /> }}
                renderItem={(item) => (
                  <List.Item onClick={() => navigation.push("/system/notice")} style={{ cursor: "pointer" }}>
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
