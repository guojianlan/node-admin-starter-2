"use client";

import { LeftOutlined } from "@ant-design/icons";
import { Badge, Button, Space, Tag, Typography } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { useNavigationAdapter } from "@/platform/navigation";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";

type DictItemRecord = {
  id: number;
  dictId: number;
  label: string;
  value: string;
  color?: string | null;
  status: number;
  sort: number;
  createdAt: string;
};

const colorOptions = [
  "default",
  "blue",
  "green",
  "red",
  "orange",
  "purple",
  "magenta",
  "cyan",
  "gold",
  "lime",
].map((color) => ({ label: color, value: color }));

export function DictItemPage() {
  const navigation = useNavigationAdapter();
  const searchParams = new URLSearchParams(navigation.search);
  const dictId = Number(searchParams.get("dictId") || 0);
  const dictName = searchParams.get("dictName") ? decodeURIComponent(searchParams.get("dictName") || "") : "";
  const dictCode = searchParams.get("dictCode") || "";

  const columns: AdminDataTableColumn<DictItemRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 80, align: "center" },
    { title: "标签", dataIndex: "label", required: true },
    { title: "值", dataIndex: "value", required: true },
    {
      title: "颜色",
      dataIndex: "color",
      valueType: "select",
      options: colorOptions,
      hideInSearch: true,
      render: (value) => <Tag color={String(value || "default")}>{String(value || "default")}</Tag>,
    },
    {
      title: "排序",
      dataIndex: "sort",
      valueType: "digit",
      hideInSearch: true,
      align: "center",
      render: (value) => <Tag color="purple">{String(value)}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      align: "center",
      render: (value) =>
        value === 1 ? <Badge status="success" text="启用" /> : <Badge status="error" text="停用" />,
    },
    { title: "创建时间", dataIndex: "createdAt", hideInForm: true, hideInSearch: true, width: 180 },
  ];

  if (!dictId) {
    return (
      <PageScaffold title="字典项管理" description="请选择字典后再管理字典项">
        <div className="system-empty-tip">未选择字典</div>
      </PageScaffold>
    );
  }

  return (
    <PageScaffold
      title="字典项管理"
      description="维护当前字典下的枚举项"
      actions={
        <Button type="link" icon={<LeftOutlined />} onClick={() => navigation.push("/system/dict")}>
          返回字典列表
        </Button>
      }
    >
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <div className="system-dict-title">
          <Typography.Title level={3}>
            {dictName}
            <Typography.Text type="secondary"> {dictCode}</Typography.Text>
          </Typography.Title>
        </div>
        <AdminDataTable
          api="/api/system/dict/item"
          accessName="system.dict"
          rowKey="id"
          columns={columns}
          createTitle="新增字典项"
          updateTitle="编辑字典项"
          beforeSubmit={(values) => ({ ...values, dictId })}
          handleRequest={async (params) =>
            request<PageResult<DictItemRecord>>(
              `/api/system/dict/item${buildQueryString({ ...params, dictId })}`,
              { silent: true },
            )
          }
        />
      </Space>
    </PageScaffold>
  );
}
