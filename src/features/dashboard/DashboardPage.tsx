"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  LikeOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Card, Col, Row, theme } from "antd";
import type { EChartsOption } from "echarts";
import dynamic from "next/dynamic";
import { useMemo, type ReactNode } from "react";

const { useToken } = theme;

const EChart = dynamic(() => import("@/ui/charts/EChart").then((module) => module.EChart), {
  ssr: false,
  loading: () => <div className="xin-chart-loading" />,
});

type DashboardStat = {
  title: string;
  value: string;
  change: string;
  trend: "up" | "down";
  visual?: "bar" | "line";
  icon?: ReactNode;
};

const stats: DashboardStat[] = [
  {
    title: "总收入",
    value: "￥3,415.00",
    change: "11.28%",
    trend: "up",
    visual: "bar",
  },
  {
    title: "总支出",
    value: "￥8,425.00",
    change: "15.33%",
    trend: "down",
    visual: "line",
  },
  {
    title: "访客量",
    value: "1,128",
    change: "32.60%",
    trend: "up",
    icon: <TeamOutlined />,
  },
  {
    title: "点赞量",
    value: "668",
    change: "9.60%",
    trend: "down",
    icon: <LikeOutlined />,
  },
] as const;

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function DashboardPage() {
  const { token } = useToken();

  const miniBarOption = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { top: 8, right: 0, bottom: 6, left: 0 },
      xAxis: {
        type: "category",
        show: false,
        data: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      },
      yAxis: {
        show: false,
        type: "value",
      },
      series: [
        {
          data: [120, 88, 116, 60, 70],
          type: "bar",
          itemStyle: {
            color: token.colorPrimary,
          },
          barWidth: 10,
        },
      ],
    }),
    [token.colorPrimary],
  );

  const miniLineOption = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { top: 8, right: 2, bottom: 8, left: 2 },
      xAxis: {
        show: false,
        type: "category",
        boundaryGap: false,
        data: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      },
      yAxis: {
        show: false,
        type: "value",
      },
      series: [
        {
          data: [1, 2, 3, 2, 3, 2, 1],
          type: "line",
          symbolSize: 7,
          itemStyle: {
            color: token.colorPrimary,
          },
          lineStyle: {
            width: 3,
          },
        },
      ],
    }),
    [token.colorPrimary],
  );

  const annualSalesOption = useMemo<EChartsOption>(
    () => ({
      animation: false,
      title: {
        text: "年度销售额",
        left: "center",
        top: 8,
        textStyle: {
          color: token.colorText,
          fontSize: token.fontSizeLG,
          fontWeight: token.fontWeightStrong,
        },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "cross",
          label: {
            backgroundColor: token.colorPrimaryBg,
            color: token.colorPrimary,
          },
        },
        borderWidth: 0,
        backgroundColor: token.colorPrimaryBg,
        textStyle: {
          color: token.colorText,
        },
      },
      legend: {
        show: false,
      },
      grid: {
        top: 66,
        left: "3%",
        right: "4%",
        bottom: "3%",
        containLabel: true,
      },
      xAxis: [
        {
          type: "category",
          boundaryGap: false,
          data: months,
          axisLabel: { show: false },
          axisTick: { show: false },
          axisLine: { show: false },
        },
      ],
      yAxis: [
        {
          type: "value",
          min: 0,
          max: 120,
          interval: 20,
          splitLine: {
            lineStyle: {
              color: token.colorBorder,
            },
          },
        },
      ],
      series: [
        {
          name: "毛利润",
          type: "line",
          stack: "Total",
          areaStyle: {
            color: token.colorPrimaryBorder,
          },
          emphasis: {
            focus: "series",
          },
          itemStyle: {
            color: token.colorPrimary,
          },
          data: [30, 36, 42, 33, 21, 26, 29, 35, 42, 32, 28, 26],
        },
        {
          name: "净利润",
          type: "line",
          stack: "Total",
          areaStyle: {
            color: token.colorSuccessBorder,
          },
          emphasis: {
            focus: "series",
          },
          itemStyle: {
            color: token.colorSuccess,
          },
          data: [32, 16, 18, 30, 15, 19, 22, 17, 24, 19, 30, 31],
        },
        {
          name: "总支出",
          type: "line",
          stack: "Total",
          areaStyle: {
            color: token.colorWarningBorder,
          },
          emphasis: {
            focus: "series",
          },
          itemStyle: {
            color: token.colorWarning,
          },
          data: [36, 24, 36, 36, 39, 56, 24, 23, 21, 12, 16, 19],
        },
      ],
    }),
    [
      token.colorBorder,
      token.colorPrimary,
      token.colorPrimaryBg,
      token.colorPrimaryBorder,
      token.colorSuccess,
      token.colorSuccessBorder,
      token.colorText,
      token.colorWarning,
      token.colorWarningBorder,
      token.fontSizeLG,
      token.fontWeightStrong,
    ],
  );

  const accessFromOption = useMemo<EChartsOption>(
    () => ({
      animation: false,
      title: {
        text: "Access From",
        left: "center",
        top: 8,
        textStyle: {
          color: token.colorText,
          fontSize: token.fontSizeLG,
          fontWeight: token.fontWeightStrong,
        },
      },
      tooltip: {
        trigger: "item",
      },
      legend: {
        bottom: 0,
        left: "center",
        textStyle: {
          color: token.colorText,
        },
      },
      series: [
        {
          name: "Access From",
          type: "pie",
          radius: ["40%", "70%"],
          center: ["50%", "48%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: token.borderRadius,
            borderColor: token.colorBorder,
            borderWidth: 2,
          },
          label: {
            show: false,
            position: "center",
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 40,
              fontWeight: "bold",
            },
          },
          labelLine: {
            show: false,
          },
          data: [
            { value: 1048, name: "Search Engine" },
            { value: 735, name: "Direct" },
            { value: 580, name: "Email" },
            { value: 484, name: "Union Ads" },
            { value: 300, name: "Video Ads" },
          ],
        },
      ],
    }),
    [
      token.borderRadius,
      token.colorBorder,
      token.colorText,
      token.fontSizeLG,
      token.fontWeightStrong,
    ],
  );

  return (
    <div className="xin-dashboard">
      <Row gutter={[20, 20]}>
        {stats.map((item) => (
          <Col xs={24} lg={12} xxl={6} key={item.title}>
            <Card className="admin-card xin-stat-card" variant="borderless">
              <div>{item.title}</div>
              <div className="xin-stat-top">
                <div className="xin-stat-value">{item.value}</div>
                {item.visual === "bar" ? (
                  <EChart option={miniBarOption} className="xin-mini-chart" />
                ) : null}
                {item.visual === "line" ? (
                  <EChart option={miniLineOption} className="xin-mini-chart" />
                ) : null}
                {item.icon ? <span className="xin-stat-icon-bubble">{item.icon}</span> : null}
              </div>
              <div>
                自上周以来{" "}
                <span className={item.trend === "up" ? "xin-stat-change-up" : "xin-stat-change-down"}>
                  {item.trend === "up" ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                  {item.change}
                </span>
              </div>
            </Card>
          </Col>
        ))}
        <Col xs={24} xl={18}>
          <Card className="admin-card xin-chart-card" variant="borderless">
            <EChart option={annualSalesOption} className="xin-dashboard-chart" />
          </Card>
        </Col>
        <Col xs={24} xl={6}>
          <Card className="admin-card xin-chart-card" variant="borderless">
            <EChart option={accessFromOption} className="xin-dashboard-chart" />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
