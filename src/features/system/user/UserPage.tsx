"use client";

import { Avatar, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";
import { useCallback } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { getFieldOptionLabel, sexOptions, statusOptions } from "../shared/options";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

type UserRecord = {
  id: number;
  username: string;
  password?: string;
  nickname: string;
  email?: string | null;
  mobile?: string | null;
  sex: number;
  deptId?: number | null;
  deptName?: string | null;
  avatarUrl?: string | null;
  status: number;
  isSystem?: boolean;
  roleIds?: number[];
  roleNames?: string[];
  createdAt: string;
  updatedAt: string;
};

export function UserPage() {
  const roleOptionsQuery = useQuery({
    queryKey: ["system-user", "role-options"],
    queryFn: () => request<FieldOption[]>("/api/system/user/role", { silent: true }),
    enabled: false,
    staleTime: 5 * 60_000,
  });
  const deptOptionsQuery = useQuery({
    queryKey: ["system-user", "dept-options"],
    queryFn: () =>
      request<Array<FieldOption & { parentId?: number }>>("/api/system/user/dept", {
        silent: true,
      }),
    enabled: false,
    staleTime: 5 * 60_000,
  });

  const roleOptions = roleOptionsQuery.data ?? [];
  const deptOptions = deptOptionsQuery.data ?? [];

  const ensureRoleOptions = useCallback(() => {
    if (!roleOptionsQuery.data && !roleOptionsQuery.isFetching) void roleOptionsQuery.refetch();
  }, [roleOptionsQuery]);

  const ensureDeptOptions = useCallback(() => {
    if (!deptOptionsQuery.data && !deptOptionsQuery.isFetching) void deptOptionsQuery.refetch();
  }, [deptOptionsQuery]);

  const ensureFormOptions = useCallback(() => {
    ensureRoleOptions();
    ensureDeptOptions();
  }, [ensureDeptOptions, ensureRoleOptions]);

  const roleFieldProps = {
    loading: roleOptionsQuery.isFetching,
    onOpenChange: (open: boolean) => {
      if (open) ensureRoleOptions();
    },
  };
  const deptFieldProps = {
    loading: deptOptionsQuery.isFetching,
    onOpenChange: (open: boolean) => {
      if (open) ensureDeptOptions();
    },
  };

  function getRoleLabel(record: UserRecord, roleId: number, index: number) {
    return (
      roleOptions.find((item) => item.value === roleId)?.label ??
      record.roleNames?.[index] ??
      roleId
    );
  }

  const columns: AdminDataTableColumn<UserRecord>[] = [
    {
      title: "用户ID",
      dataIndex: "id",
      hideInForm: true,
      hideInSearch: true,
      width: 104,
      align: "center",
      sorter: true,
      fixed: "left",
    },
    {
      title: "用户名",
      dataIndex: "username",
      required: true,
      align: "center",
      width: 112,
      fixed: "left",
    },
    {
      title: "密码",
      dataIndex: "password",
      valueType: "password",
      required: true,
      hideInTable: true,
      hideInSearch: true,
      hideInUpdate: true,
    },
    {
      title: "昵称",
      dataIndex: "nickname",
      required: true,
      align: "center",
      width: 120,
      fixed: "left",
    },
    {
      title: "性别",
      dataIndex: "sex",
      valueType: "select",
      options: sexOptions,
      align: "center",
      width: 80,
      render: (value) => getFieldOptionLabel(sexOptions, value, "未知"),
    },
    { title: "邮箱", dataIndex: "email", align: "center", width: 160 },
    {
      title: "用户角色",
      dataIndex: "roleIds",
      valueType: "select",
      options: roleOptions,
      align: "center",
      width: 112,
      hideInSearch: true,
      fieldProps: { mode: "multiple", ...roleFieldProps },
      render: (value, record) => {
        const ids = Array.isArray(value) ? value : [];
        if (!ids.length) return "-";
        return ids.map((roleId, index) => (
          <Tag color="magenta" key={roleId}>
            {getRoleLabel(record, Number(roleId), index)}
          </Tag>
        ));
      },
    },
    {
      title: "用户部门",
      dataIndex: "deptId",
      valueType: "select",
      options: deptOptions,
      fieldProps: deptFieldProps,
      align: "center",
      width: 100,
      render: (_, record) => <Tag color="volcano">{record.deptName ?? "-"}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      align: "center",
      width: 80,
      render: (value) => (
        <Tag color={Number(value) === 1 ? "success" : "error"}>
          {Number(value) === 1 ? "启用" : "停用"}
        </Tag>
      ),
    },
    { title: "手机号", dataIndex: "mobile", align: "center", width: 132 },
    {
      title: "头像",
      dataIndex: "avatarUrl",
      hideInSearch: true,
      hideInForm: true,
      align: "center",
      width: 80,
      render: (_, record) =>
        record.id === 1 ? <Avatar size="small" src="/favicons.svg" /> : <Avatar size="small" />,
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      valueType: "dateRange",
      hideInForm: true,
      hideInSearch: true,
      align: "center",
      width: 128,
      render: (value) => (value ? dayjs(String(value)).fromNow() : "-"),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      hideInForm: true,
      hideInSearch: true,
      align: "center",
      width: 128,
      render: (value) => (value ? dayjs(String(value)).fromNow() : "-"),
    },
  ];

  return (
    <PageScaffold
      title="用户列表"
      description="通过用户列表管理系统账号，并为用户分配部门与角色"
      hideHeader
    >
      <AdminDataTable
        api="/api/system/user"
        accessName="system.user"
        rowKey="id"
        columns={columns}
        toolbarTitle="用户列表"
        createTitle="新增用户"
        updateTitle="编辑用户"
        canDelete={(record) => !record.isSystem}
        onFormOpenChange={(open) => {
          if (open) ensureFormOptions();
        }}
      />
    </PageScaffold>
  );
}
