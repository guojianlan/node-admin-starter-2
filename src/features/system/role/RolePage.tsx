"use client";

import { KeyOutlined, SaveOutlined, SmileOutlined, TeamOutlined } from "@ant-design/icons";
import { Button, Card, Col, Row, Switch, Table, Tag, Tooltip, Tree } from "antd";
import type { TableProps, TreeProps } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  userCount: number;
  ruleIds?: number[];
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
  const [ruleOptions, setRuleOptions] = useState<FieldOption[]>([]);
  const [ruleTree, setRuleTree] = useState<RuleNode[]>([]);
  const [selectedRole, setSelectedRole] = useState<RoleRecord | null>(null);
  const [activeTab, setActiveTab] = useState("users");
  const [checkedRuleKeys, setCheckedRuleKeys] = useState<React.Key[]>([]);
  const [expandedRuleKeys, setExpandedRuleKeys] = useState<React.Key[]>([]);
  const [roleUsers, setRoleUsers] = useState<RoleUserRecord[]>([]);
  const [roleUsersTotal, setRoleUsersTotal] = useState(0);
  const [roleUsersLoading, setRoleUsersLoading] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [roleUserPage, setRoleUserPage] = useState({ page: 1, pageSize: 10 });

  useEffect(() => {
    void request<RuleNode[]>("/api/system/role/ruleList", { silent: true }).then((rows) => {
      setRuleTree(rows);
      setRuleOptions(toFieldOptions(rows));
    });
  }, []);

  const fetchRoleUsers = useCallback(
    async (roleId: number, page = roleUserPage.page, pageSize = roleUserPage.pageSize) => {
      setRoleUsersLoading(true);
      try {
        const result = await request<PageResult<RoleUserRecord>>(
          `/api/system/role/users/${roleId}${buildQueryString({ page, pageSize })}`,
          { silent: true },
        );
        setRoleUsers(result.data);
        setRoleUsersTotal(result.total);
        setRoleUserPage({ page, pageSize });
      } finally {
        setRoleUsersLoading(false);
      }
    },
    [roleUserPage.page, roleUserPage.pageSize],
  );

  function handleRoleSelect(record?: RoleRecord) {
    if (!record) return;
    setSelectedRole(record);
    setCheckedRuleKeys(record.ruleIds ?? []);
    void fetchRoleUsers(record.id, 1, roleUserPage.pageSize);
  }

  const roleColumns: AdminDataTableColumn<RoleRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72, align: "center" },
    {
      title: "角色名称",
      dataIndex: "name",
      required: true,
      align: "center",
      render: (value, record) => (
        <Tooltip title={record.remark || "暂无描述"}>
          <Tag color="blue">{String(value)}</Tag>
        </Tooltip>
      ),
    },
    { title: "角色编码", dataIndex: "code", required: true, hideInTable: true },
    { title: "备注", dataIndex: "remark", valueType: "textarea", fullWidth: true, hideInTable: true },
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
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      align: "center",
      width: 104,
      render: (value, record) => (
        <Switch
          disabled={record.id === 1}
          defaultChecked={Number(value) === 1}
          checkedChildren="启用"
          unCheckedChildren="停用"
          onChange={async (checked, event) => {
            event.stopPropagation();
            await request(`/api/system/role/status/${record.id}`, {
              method: "PUT",
              body: { status: checked ? 1 : 0 },
            });
            feedback.success("状态更新成功");
          }}
        />
      ),
    },
    { title: "创建时间", dataIndex: "createdAt", hideInForm: true, hideInSearch: true, align: "center" },
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
      render: (value) => <Tag color={value === 1 ? "success" : "error"}>{value === 1 ? "正常" : "禁用"}</Tag>,
    },
  ];

  const ruleTreeData = useMemo(() => toTreeData(ruleTree), [ruleTree]);
  const allRuleKeys = useMemo(() => getAllNodeKeys(ruleTree), [ruleTree]);

  async function saveRules() {
    if (!selectedRole) {
      feedback.warning("请先选择角色");
      return;
    }
    setSavingRules(true);
    try {
      await request("/api/system/role/setRule", {
        method: "POST",
        body: {
          id: selectedRole.id,
          ruleIds: checkedRuleKeys.map(Number),
        },
      });
      feedback.success("权限保存成功");
    } finally {
      setSavingRules(false);
    }
  }

  return (
    <PageScaffold title="角色管理" description="通过角色配置管理员权限，可查看角色用户并维护菜单权限">
      <Row gutter={[20, 20]}>
        <Col xxl={14} lg={12} xs={24}>
          <AdminDataTable
            api="/api/system/role"
            accessName="system.role"
            rowKey="id"
            columns={roleColumns}
            createTitle="新增角色"
            updateTitle="编辑角色"
            canUpdate={(record) => record.id !== 1}
            canDelete={(record) => record.id !== 1}
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
            className="system-side-card"
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
                <Table<RoleUserRecord>
                  rowKey="id"
                  loading={roleUsersLoading}
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
                    onChange: (page, pageSize) => selectedRole && void fetchRoleUsers(selectedRole.id, page, pageSize),
                  }}
                  scroll={{ x: 600 }}
                />
              ) : (
                <>
                  <div className="system-tree-scroll">
                    <Tree
                      checkable
                      checkStrictly
                      treeData={ruleTreeData}
                      checkedKeys={checkedRuleKeys}
                      expandedKeys={expandedRuleKeys}
                      onCheck={(keys) => {
                        setCheckedRuleKeys(Array.isArray(keys) ? keys : keys.checked);
                      }}
                      onExpand={setExpandedRuleKeys}
                    />
                  </div>
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
                      loading={savingRules}
                      disabled={selectedRole.id === 1}
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
    </PageScaffold>
  );
}
