"use client";

import { Tag } from "antd";
import { useEffect, useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions, toFieldOptions } from "../shared/options";

type DeptTreeNode = {
  id: number;
  name: string;
  children?: DeptTreeNode[];
};

type DeptRecord = {
  id: number;
  parentId: number;
  name: string;
  code?: string | null;
  sort: number;
  leader?: string | null;
  phone?: string | null;
  status: number;
  createdAt: string;
};

export function DeptPage() {
  const [parentOptions, setParentOptions] = useState<FieldOption[]>([]);

  useEffect(() => {
    void request<DeptTreeNode[]>("/api/system/dept/tree", { silent: true }).then((rows) => {
      setParentOptions([{ label: "顶级", value: 0 }, ...toFieldOptions(rows)]);
    });
  }, []);

  const columns: AdminDataTableColumn<DeptRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    {
      title: "父级",
      dataIndex: "parentId",
      valueType: "treeSelect",
      options: parentOptions,
      hideInTable: true,
      hideInSearch: true,
    },
    { title: "部门名称", dataIndex: "name", required: true },
    { title: "部门编码", dataIndex: "code" },
    { title: "负责人", dataIndex: "leader" },
    { title: "联系电话", dataIndex: "phone" },
    { title: "排序", dataIndex: "sort", valueType: "digit", hideInSearch: true },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      render: (value) => <Tag color={value === 1 ? "green" : "red"}>{value === 1 ? "启用" : "停用"}</Tag>,
    },
    { title: "创建时间", dataIndex: "createdAt", hideInForm: true, hideInSearch: true },
  ];

  return (
    <PageScaffold title="部门管理" description="维护组织部门树">
      <AdminDataTable
        api="/api/system/dept"
        accessName="system.dept"
        rowKey="id"
        columns={columns}
        createTitle="新增部门"
        updateTitle="编辑部门"
      />
    </PageScaffold>
  );
}
