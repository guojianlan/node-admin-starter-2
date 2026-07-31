"use client";

import { CopyOutlined, KeyOutlined, SaveOutlined, SmileOutlined, TeamOutlined } from "@ant-design/icons";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Checkbox, Col, Input, Modal, Row, Space, Spin, Switch, Table, Tag, Tooltip, Tree } from "antd";
import type { TableProps, TreeProps } from "antd";
import { useMemo, useState } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn, FieldOption } from "@/components/admin-fields/types";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions, toFieldOptions } from "../shared/options";

type RoleRecord = {
  id: number;
  name: string;
  code: string;
  remark?: string | null;
  sort: number;
  status: number;
  dataScope: "all" | "custom_dept" | "current_dept" | "current_dept_tree" | "self";
  userCount: number;
  ruleIds?: number[];
  deptIds?: number[];
  isSystem?: boolean;
  createdAt: string;
};

type RoleUserRecord = {
  id: number;
  username: string;
  nickname: string;
  email?: string | null;
  mobile?: string | null;
  status: number;
  createdAt: string;
};

type RuleNode = {
  id: number;
  parentId: number;
  type: "menu" | "route" | "nested" | "action";
  key: string;
  name: string;
  path?: string | null;
  icon?: string | null;
  order: number;
  status: number;
  hidden: number;
  link: number;
  children?: RuleNode[];
};

type DeptNode = {
  id: number;
  parentId: number;
  name: string;
  children?: DeptNode[];
};

const emptyRuleTree: RuleNode[] = [];
const emptyRoleUsers: RoleUserRecord[] = [];
const emptyFieldOptions: FieldOption[] = [];

function getAllNodeKeys(nodes: RuleNode[]): number[] {
  return nodes.flatMap((node) => [node.id, ...getAllNodeKeys(node.children ?? [])]);
}

function toTreeData(nodes: RuleNode[]): TreeProps["treeData"] {
  return nodes.map((node) => ({
    key: node.id,
    title: (
      <span>
        {node.name}
        <span className="system-tree-node-meta"> - {node.key}</span>
      </span>
    ),
    children: toTreeData(node.children ?? []),
  }));
}

export function RolePage() {
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<RoleRecord | null>(null);
  const [activeTab, setActiveTab] = useState("users");
  const [checkedRuleKeys, setCheckedRuleKeys] = useState<React.Key[]>([]);
  const [expandedRuleKeys, setExpandedRuleKeys] = useState<React.Key[]>([]);
  const [roleUserPage, setRoleUserPage] = useState({ page: 1, pageSize: 10 });
  const [copyRole, setCopyRole] = useState<RoleRecord | null>(null);
  const [copyForm, setCopyForm] = useState({
    name: "",
    code: "",
    copyRules: true,
    copyDataScope: true,
  });

  const roleMetaQuery = useQuery({
    queryKey: ["system-role-meta"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [ruleRows, deptRows] = await Promise.all([
        request<RuleNode[]>("/api/system/role/ruleList", { silent: true }),
        request<DeptNode[]>("/api/system/role/deptTree", { silent: true }),
      ]);
      return {
        ruleTree: ruleRows,
        deptTree: deptRows,
        ruleOptions: toFieldOptions(ruleRows),
        deptOptions: toFieldOptions(deptRows),
      };
    },
  });

  const roleUsersQuery = useQuery({
    queryKey: ["system-role-users", selectedRole?.id, roleUserPage.page, roleUserPage.pageSize],
    enabled: Boolean(selectedRole && activeTab === "users"),
    placeholderData: keepPreviousData,
    queryFn: () =>
      request<PageResult<RoleUserRecord>>(
        `/api/system/role/users/${selectedRole?.id}${buildQueryString(roleUserPage)}`,
        { silent: true },
      ),
  });

  const roleStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: number }) =>
      request(`/api/system/role/status/${id}`, {
        method: "PUT",
        body: { status },
      }),
    onSuccess: () => {
      feedback.success("状态更新成功");
      void queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/role"] });
    },
  });

  const saveRulesMutation = useMutation({
    mutationFn: () => {
      if (!selectedRole) throw new Error("请先选择角色");
      return request("/api/system/role/setRule", {
        method: "POST",
        body: {
          id: selectedRole.id,
          ruleIds: checkedRuleKeys.map(Number),
        },
      });
    },
    onSuccess: () => {
      feedback.success("权限保存成功");
      setSelectedRole((role) => (role ? { ...role, ruleIds: checkedRuleKeys.map(Number) } : role));
      void queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/role"] });
    },
  });

  const copyRoleMutation = useMutation({
    mutationFn: () => {
      if (!copyRole) throw new Error("请先选择角色");
      return request(`/api/system/role/copy/${copyRole.id}`, {
        method: "POST",
        body: copyForm,
      });
    },
    onSuccess: async () => {
      feedback.success("复制成功");
      setCopyRole(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-data-table", "/api/system/role"] });
    },
  });

  const ruleTree = roleMetaQuery.data?.ruleTree ?? emptyRuleTree;
  const ruleOptions = roleMetaQuery.data?.ruleOptions ?? emptyFieldOptions;
  const deptOptions = roleMetaQuery.data?.deptOptions ?? emptyFieldOptions;
  const roleUsers = roleUsersQuery.data?.data ?? emptyRoleUsers;
  const roleUsersTotal = roleUsersQuery.data?.total ?? 0;

  function handleRoleSelect(record?: RoleRecord) {
    if (!record) return;
    setSelectedRole(record);
    setCheckedRuleKeys(record.ruleIds ?? []);
    setRoleUserPage((value) => ({ page: 1, pageSize: value.pageSize }));
  }

  const roleColumns: AdminDataTableColumn<RoleRecord>[] = [
    {
      title: "ID",
      dataIndex: "id",
      hideInForm: true,
      hideInSearch: true,
      width: 72,
      align: "center",
      fixed: "left",
    },
    {
      title: "角色名称",
      dataIndex: "name",
      required: true,
      align: "center",
      width: 140,
      fixed: "left",
      render: (value, record) => (
        <Tooltip title={record.remark || "暂无描述"}>
          <Tag color="blue">{String(value)}</Tag>
        </Tooltip>
      ),
    },
    { title: "角色编码", dataIndex: "code", required: true, hideInTable: true },
    {
      title: "备注",
      dataIndex: "remark",
      valueType: "textarea",
      fullWidth: true,
      hideInTable: true,
      hideInSearch: true,
    },
    {
      title: "排序",
      dataIndex: "sort",
      valueType: "digit",
      hideInSearch: true,
      align: "center",
      width: 88,
      render: (value) => <Tag color="purple">{String(value)}</Tag>,
    },
    {
      title: "用户数",
      dataIndex: "userCount",
      hideInForm: true,
      hideInSearch: true,
      align: "center",
      width: 96,
      render: (value) => <a>{Number(value || 0)} 人</a>,
    },
    {
      title: "权限",
      dataIndex: "ruleIds",
      valueType: "treeSelect",
      options: ruleOptions,
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
      fieldProps: {
        treeCheckable: true,
        showCheckedStrategy: "SHOW_PARENT",
      },
    },
    {
      title: "数据范围",
      dataIndex: "dataScope",
      valueType: "select",
      options: [
        { label: "全部数据", value: "all" },
        { label: "指定部门", value: "custom_dept" },
        { label: "本部门", value: "current_dept" },
        { label: "本部门及子部门", value: "current_dept_tree" },
        { label: "仅本人", value: "self" },
      ],
      align: "center",
      width: 140,
      render: (value) => {
        const option = [
          { label: "全部数据", value: "all" },
          { label: "指定部门", value: "custom_dept" },
          { label: "本部门", value: "current_dept" },
          { label: "本部门及子部门", value: "current_dept_tree" },
          { label: "仅本人", value: "self" },
        ].find((item) => item.value === value);
        return <Tag color={value === "all" ? "green" : "blue"}>{option?.label ?? String(value)}</Tag>;
      },
    },
    {
      title: "指定部门",
      dataIndex: "deptIds",
      valueType: "treeSelect",
      options: deptOptions,
      hideInTable: true,
      hideInSearch: true,
      fullWidth: true,
      fieldProps: {
        treeCheckable: true,
        showCheckedStrategy: "SHOW_PARENT",
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      align: "center",
      width: 104,
      render: (value, record) => (
        <Switch
          disabled={record.isSystem}
          checked={Number(value) === 1}
          loading={roleStatusMutation.isPending}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={async (checked, event) => {
            event.stopPropagation();
            await roleStatusMutation.mutateAsync({ id: record.id, status: checked ? 1 : 0 });
          }}
        />
      ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      hideInForm: true,
      hideInSearch: true,
      align: "center",
    },
  ];

  const userColumns: TableProps<RoleUserRecord>["columns"] = [
    { title: "用户ID", dataIndex: "id", align: "center", width: 80 },
    { title: "用户名", dataIndex: "username", align: "center" },
    { title: "昵称", dataIndex: "nickname", align: "center" },
    { title: "邮箱", dataIndex: "email", align: "center", ellipsis: true },
    { title: "手机号", dataIndex: "mobile", align: "center" },
    {
      title: "状态",
      dataIndex: "status",
      align: "center",
      width: 86,
      render: (value) => (
        <Tag color={Number(value) === 1 ? "success" : "error"}>
          {Number(value) === 1 ? "正常" : "禁用"}
        </Tag>
      ),
    },
  ];

  const ruleTreeData = useMemo(() => toTreeData(ruleTree), [ruleTree]);
  const allRuleKeys = useMemo(() => getAllNodeKeys(ruleTree), [ruleTree]);
  const availableRuleKeys = useMemo(() => new Set(allRuleKeys.map(String)), [allRuleKeys]);
  const visibleCheckedRuleKeys = useMemo(
    () =>
      checkedRuleKeys
        .filter((key) => availableRuleKeys.has(String(key)))
        .map((key) => Number(key)),
    [availableRuleKeys, checkedRuleKeys],
  );
  const visibleExpandedRuleKeys = useMemo(
    () =>
      expandedRuleKeys
        .filter((key) => availableRuleKeys.has(String(key)))
        .map((key) => Number(key)),
    [availableRuleKeys, expandedRuleKeys],
  );
  const ruleNameMap = useMemo(() => {
    const map = new Map<number, RuleNode>();
    const visit = (nodes: RuleNode[]) => {
      nodes.forEach((node) => {
        map.set(node.id, node);
        visit(node.children ?? []);
      });
    };
    visit(ruleTree);
    return map;
  }, [ruleTree]);

  async function saveRules() {
    if (!selectedRole) {
      feedback.warning("请先选择角色");
      return;
    }
    const before = new Set((selectedRole.ruleIds ?? []).map(Number));
    const after = new Set(checkedRuleKeys.map(Number));
    const added = [...after].filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !after.has(id));
    const unchanged = [...after].filter((id) => before.has(id)).length;
    Modal.confirm({
      title: "确认保存角色权限",
      width: 560,
      content: (
        <Space orientation="vertical" size={10}>
          <span>
            新增 {added.length} 项，移除 {removed.length} 项，保持 {unchanged} 项。保存后该角色用户的旧 token 会失效。
          </span>
          {added.length ? (
            <div>
              <strong>新增：</strong>
              <Space wrap size={4}>
                {added.slice(0, 12).map((id) => (
                  <Tag color="green" key={id}>{ruleNameMap.get(id)?.name ?? id}</Tag>
                ))}
              </Space>
            </div>
          ) : null}
          {removed.length ? (
            <div>
              <strong>移除：</strong>
              <Space wrap size={4}>
                {removed.slice(0, 12).map((id) => (
                  <Tag color="red" key={id}>{ruleNameMap.get(id)?.name ?? id}</Tag>
                ))}
              </Space>
            </div>
          ) : null}
        </Space>
      ),
      okText: "保存权限",
      cancelText: "取消",
      onOk: () => saveRulesMutation.mutateAsync(),
    });
  }

  return (
    <PageScaffold
      title="角色管理"
      description="通过角色配置管理员权限，可查看角色用户并维护菜单权限"
    >
      <Row className="system-workbench system-role-workbench" gutter={[20, 20]}>
        <Col xxl={14} lg={12} xs={24}>
          <AdminDataTable
            api="/api/system/role"
            accessName="system.role"
            rowKey="id"
            columns={roleColumns}
            createTitle="新增角色"
            updateTitle="编辑角色"
            tableMode="embedded"
            actionColumnWidth={164}
            canUpdate={(record) => !record.isSystem}
            canDelete={(record) => !record.isSystem}
            operateRender={(record) => (
              <Tooltip title="复制角色">
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    setCopyRole(record);
                    setCopyForm({
                      name: `${record.name} 副本`,
                      code: `${record.code}_copy`,
                      copyRules: true,
                      copyDataScope: true,
                    });
                  }}
                />
              </Tooltip>
            )}
            tableProps={{
              size: "small",
              bordered: true,
              rowSelection: {
                type: "radio",
                selectedRowKeys: selectedRole ? [selectedRole.id] : [],
                onChange: (_, rows) => {
                  handleRoleSelect(rows[0]);
                },
              },
              onRow: (record) => ({
                onClick: () => {
                  handleRoleSelect(record);
                },
              }),
            }}
          />
        </Col>
        <Col xxl={10} lg={12} xs={24}>
          <Card
            className="system-side-card system-workbench-panel"
            title={
              <div className="system-panel-title">
                <span>{selectedRole ? selectedRole.name : "角色工作区"}</span>
                {selectedRole ? (
                  <Tag color={selectedRole.isSystem ? "gold" : "blue"}>{selectedRole.code}</Tag>
                ) : null}
              </div>
            }
            tabList={[
              { key: "users", icon: <TeamOutlined />, label: "用户列表" },
              { key: "rules", icon: <KeyOutlined />, label: "权限管理" },
            ]}
            activeTabKey={activeTab}
            onTabChange={setActiveTab}
            styles={{ body: { minHeight: "70vh" } }}
          >
            {selectedRole ? (
              activeTab === "users" ? (
                <>
                  <div className="system-panel-summary">
                    <span>已分配用户</span>
                    <strong>{roleUsersTotal}</strong>
                  </div>
                  <Table<RoleUserRecord>
                    className="admin-table-surface"
                    rowKey="id"
                    loading={roleUsersQuery.isLoading || roleUsersQuery.isFetching}
                    dataSource={roleUsers}
                    columns={userColumns}
                    bordered
                    size="small"
                    pagination={{
                      current: roleUserPage.page,
                      pageSize: roleUserPage.pageSize,
                      total: roleUsersTotal,
                      showSizeChanger: true,
                      showTotal: (total) => `共 ${total} 条`,
                      onChange: (page, pageSize) => setRoleUserPage({ page, pageSize }),
                    }}
                    scroll={{ x: 600, y: 420 }}
                  />
                </>
              ) : (
                <>
                  <Spin spinning={roleMetaQuery.isLoading || roleMetaQuery.isFetching}>
                    <div className="system-tree-scroll">
                    <Tree
                      checkable
                      checkStrictly
                      treeData={ruleTreeData}
                      checkedKeys={visibleCheckedRuleKeys}
                      expandedKeys={visibleExpandedRuleKeys}
                      onCheck={(keys) => {
                        setCheckedRuleKeys(Array.isArray(keys) ? keys : keys.checked);
                      }}
                      onExpand={setExpandedRuleKeys}
                    />
                    </div>
                  </Spin>
                  <div className="system-tree-actions">
                    <span className="system-tree-count">已选 {checkedRuleKeys.length} 项</span>
                    <Button size="small" onClick={() => setExpandedRuleKeys(allRuleKeys)}>
                      展开全部
                    </Button>
                    <Button size="small" onClick={() => setExpandedRuleKeys([])}>
                      折叠全部
                    </Button>
                    <Button size="small" onClick={() => setCheckedRuleKeys(allRuleKeys)}>
                      全选
                    </Button>
                    <Button size="small" onClick={() => setCheckedRuleKeys([])}>
                      清空
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        const checked = new Set(checkedRuleKeys.map(String));
                        setCheckedRuleKeys(allRuleKeys.filter((key) => !checked.has(String(key))));
                      }}
                    >
                      反选
                    </Button>
                    <Button
                      type="primary"
                      size="small"
                      icon={<SaveOutlined />}
                      loading={saveRulesMutation.isPending}
                      disabled={selectedRole.isSystem || roleMetaQuery.isLoading}
                      onClick={() => void saveRules()}
                    >
                      保存权限
                    </Button>
                  </div>
                </>
              )
            ) : (
              <div className="system-empty-tip">
                <SmileOutlined />
                <p>请先选择左侧角色</p>
              </div>
            )}
          </Card>
        </Col>
      </Row>
      <Modal
        title={copyRole ? `复制角色：${copyRole.name}` : "复制角色"}
        open={Boolean(copyRole)}
        okText="复制"
        confirmLoading={copyRoleMutation.isPending}
        onOk={() => copyRoleMutation.mutateAsync()}
        onCancel={() => setCopyRole(null)}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Input
            addonBefore="名称"
            value={copyForm.name}
            onChange={(event) => setCopyForm((current) => ({ ...current, name: event.target.value }))}
          />
          <Input
            addonBefore="编码"
            value={copyForm.code}
            onChange={(event) => setCopyForm((current) => ({ ...current, code: event.target.value }))}
          />
          <Checkbox
            checked={copyForm.copyRules}
            onChange={(event) =>
              setCopyForm((current) => ({ ...current, copyRules: event.target.checked }))
            }
          >
            复制菜单/API 权限
          </Checkbox>
          <Checkbox
            checked={copyForm.copyDataScope}
            onChange={(event) =>
              setCopyForm((current) => ({ ...current, copyDataScope: event.target.checked }))
            }
          >
            复制数据权限
          </Checkbox>
        </Space>
      </Modal>
    </PageScaffold>
  );
}
