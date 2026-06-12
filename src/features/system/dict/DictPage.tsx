"use client";

import { ReloadOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Badge, Button, Tag, Tooltip } from "antd";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { useNavigationAdapter } from "@/platform/navigation";
import { useDictStore } from "@/stores/dict";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";

type DictRecord = {
  id: number;
  name: string;
  code: string;
  remark?: string | null;
  status: number;
  sort: number;
  createdAt: string;
};

export function DictPage() {
  const navigation = useNavigationAdapter();
  const reloadDicts = useDictStore((state) => state.reloadDicts);

  const columns: AdminDataTableColumn<DictRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 80, sorter: true, align: "center" },
    { title: "字典名称", dataIndex: "name", required: true },
    { title: "字典编码", dataIndex: "code", required: true },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      align: "center",
      render: (value) =>
        value === 1 ? <Badge status="success" text="启用" /> : <Badge status="error" text="停用" />,
    },
    {
      title: "排序",
      dataIndex: "sort",
      valueType: "digit",
      hideInSearch: true,
      align: "center",
      render: (value) => <Tag color="purple">{String(value)}</Tag>,
    },
    { title: "描述", dataIndex: "remark", valueType: "textarea", fullWidth: true, hideInSearch: true, ellipsis: true },
    { title: "创建时间", dataIndex: "createdAt", hideInForm: true, hideInSearch: true, width: 180 },
  ];

  async function refreshCache() {
    await reloadDicts();
    feedback.success("字典缓存已刷新");
  }

  return (
    <PageScaffold title="字典管理" description="维护通用字典类型，并进入字典项页面管理枚举数据">
      <AdminDataTable
        api="/api/system/dict/list"
        accessName="system.dict"
        rowKey="id"
        columns={columns}
        createTitle="新增字典"
        updateTitle="编辑字典"
        actionBarRender={() => (
          <Button type="primary" icon={<ReloadOutlined />} onClick={() => void refreshCache()}>
            刷新缓存
          </Button>
        )}
        operateRender={(record) => (
          <Tooltip title="管理字典项">
            <Button
              size="small"
              aria-label="管理字典项"
              icon={<UnorderedListOutlined />}
              onClick={() => {
                navigation.push(
                  `/system/dict/item?dictId=${record.id}&dictName=${encodeURIComponent(record.name)}&dictCode=${encodeURIComponent(record.code)}`,
                );
              }}
            />
          </Tooltip>
        )}
      />
    </PageScaffold>
  );
}
