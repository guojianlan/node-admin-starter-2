"use client";

import { BankOutlined, DeleteOutlined, PlusOutlined, TeamOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tree,
  TreeSelect,
} from "antd";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TableProps, TreeDataNode, TreeProps } from "antd";
import { useEffect, useMemo, useState } from "react";
import { AdminEntityForm } from "@/components/admin-entity-form/AdminEntityForm";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions, toFieldOptions } from "../shared/options";

type DeptRecord = {
  id: number;
  parentId: number;
  name: string;
  code?: string | null;
  sort: number;
  leader?: string | null;
  phone?: string | null;
  status: number;
  createdAt?: string;
  children?: DeptRecord[];
};

type DeptUserRecord = {
  id: number;
  username: string;
  nickname: string;
  email?: string | null;
  mobile?: string | null;
  status: number;
  createdAt: string;
};

type DeptSelectNode = {
  title: string;
  value: number;
  children?: DeptSelectNode[];
};

const emptyDeptTree: DeptRecord[] = [];
const emptyDeptUsers: DeptUserRecord[] = [];

function flattenDept(nodes: DeptRecord[]): DeptRecord[] {
  return nodes.flatMap((node) => [node, ...flattenDept(node.children ?? [])]);
}

function buildDeptTree(nodes: DeptRecord[]): TreeDataNode[] {
  return nodes.map((dept) => ({
    key: String(dept.id),
    title: dept.name,
    icon: dept.parentId === 0 ? <BankOutlined /> : <TeamOutlined />,
    children: buildDeptTree(dept.children ?? []),
  }));
}

function buildDeptSelectTree(nodes: DeptRecord[]): DeptSelectNode[] {
  return nodes.map((dept) => ({
    title: dept.name,
    value: dept.id,
    children: buildDeptSelectTree(dept.children ?? []),
  }));
}

export function DeptPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<DeptRecord>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [checkedKeys, setCheckedKeys] = useState<React.Key[]>([]);
  const [tabKey, setTabKey] = useState("info");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitialValues, setModalInitialValues] = useState<Partial<DeptRecord>>({
    parentId: 0,
    sort: 0,
    status: 1,
  });
  const [deptUserPage, setDeptUserPage] = useState({ page: 1, pageSize: 10 });

  const deptTreeQuery = useQuery({
    queryKey: ["system-dept-tree"],
    queryFn: () => request<DeptRecord[]>("/api/system/dept/tree", { silent: true }),
  });

  const deptTree = deptTreeQuery.data ?? emptyDeptTree;
  const deptList = useMemo(() => flattenDept(deptTree), [deptTree]);
  const activeSelectedKey =
    selectedKey && deptList.some((dept) => String(dept.id) === selectedKey)
      ? selectedKey
      : deptList[0]
        ? String(deptList[0].id)
        : undefined;
  const selectedDept = useMemo(
    () => deptList.find((dept) => String(dept.id) === activeSelectedKey) ?? null,
    [activeSelectedKey, deptList],
  );
  const treeData = useMemo(() => buildDeptTree(deptTree), [deptTree]);
  const parentOptions = useMemo(
    () => [{ label: "顶级部门", value: 0 }, ...toFieldOptions(deptTree)],
    [deptTree],
  );
  const parentTreeData = useMemo(
    () => [{ title: "顶级部门", value: 0, children: buildDeptSelectTree(deptTree) }],
    [deptTree],
  );

  const deptUsersQuery = useQuery({
    queryKey: ["system-dept-users", selectedDept?.id, deptUserPage.page, deptUserPage.pageSize],
    enabled: Boolean(selectedDept && tabKey === "users"),
    placeholderData: keepPreviousData,
    queryFn: () =>
      request<PageResult<DeptUserRecord>>(
        `/api/system/dept/users/${selectedDept?.id}${buildQueryString(deptUserPage)}`,
        { silent: true },
      ),
  });

  const deptUsers = deptUsersQuery.data?.data ?? emptyDeptUsers;
  const deptUsersTotal = deptUsersQuery.data?.total ?? 0;

  const createDeptMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      request("/api/system/dept", { method: "POST", body: values }),
    onSuccess: () => {
      feedback.success("创建成功");
      setModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["system-dept-tree"] });
    },
  });

  const updateDeptMutation = useMutation({
    mutationFn: (values: DeptRecord) => {
      if (!selectedDept) throw new Error("请先选择部门");
      return request(`/api/system/dept/${selectedDept.id}`, {
        method: "PUT",
        body: values,
      });
    },
    onSuccess: () => {
      feedback.success("保存成功");
      void queryClient.invalidateQueries({ queryKey: ["system-dept-tree"] });
    },
  });

  const deleteDeptMutation = useMutation({
    mutationFn: (keys: React.Key[]) =>
      Promise.all(
        keys.map((key) => request(`/api/system/dept/${String(key)}`, { method: "DELETE" })),
      ),
    onSuccess: () => {
      setCheckedKeys([]);
      feedback.success("删除成功");
      void queryClient.invalidateQueries({ queryKey: ["system-dept-tree"] });
      void queryClient.invalidateQueries({ queryKey: ["system-dept-users"] });
    },
  });

  useEffect(() => {
    if (!selectedDept) return;
    form.setFieldsValue(selectedDept);
  }, [form, selectedDept]);

  const deptColumns: AdminDataTableColumn<DeptRecord>[] = [
    {
      title: "父级部门",
      dataIndex: "parentId",
      valueType: "treeSelect",
      options: parentOptions,
      required: true,
      fieldProps: { treeDefaultExpandAll: true },
    },
    { title: "部门名称", dataIndex: "name", required: true },
    { title: "部门编码", dataIndex: "code" },
    { title: "负责人", dataIndex: "leader" },
    { title: "联系电话", dataIndex: "phone" },
    { title: "排序", dataIndex: "sort", valueType: "digit" },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      required: true,
    },
  ];

  const userColumns: TableProps<DeptUserRecord>["columns"] = [
    { title: "用户ID", dataIndex: "id", align: "center" },
    { title: "用户名", dataIndex: "username", align: "center" },
    { title: "昵称", dataIndex: "nickname", align: "center" },
    { title: "邮箱", dataIndex: "email", align: "center", ellipsis: true },
    { title: "手机号", dataIndex: "mobile", align: "center" },
    {
      title: "状态",
      dataIndex: "status",
      align: "center",
      render: (value) => (
        <Tag color={Number(value) === 1 ? "success" : "error"}>
          {Number(value) === 1 ? "正常" : "禁用"}
        </Tag>
      ),
    },
  ];

  function openCreateModal(children = false) {
    setModalInitialValues({
      parentId: children && selectedDept ? selectedDept.id : 0,
      sort: 0,
      status: 1,
    });
    setModalOpen(true);
  }

  async function submitCreate(values: Record<string, unknown>) {
    await createDeptMutation.mutateAsync(values);
  }

  async function submitUpdate(values: DeptRecord) {
    if (!selectedDept) return;
    await updateDeptMutation.mutateAsync(values);
  }

  async function deleteChecked() {
    await deleteDeptMutation.mutateAsync(checkedKeys);
  }

  const onSelect: TreeProps["onSelect"] = (keys) => {
    const nextKey = keys[0]?.toString();
    if (!nextKey) return;
    setSelectedKey(nextKey);
    const dept = deptList.find((item) => String(item.id) === nextKey);
    if (dept) {
      form.setFieldsValue(dept);
      setDeptUserPage((value) => ({ page: 1, pageSize: value.pageSize }));
    }
  };

  return (
    <PageScaffold title="部门管理" description="维护组织部门树，并查看部门信息与部门用户">
      <Row className="system-workbench system-dept-workbench" gutter={[20, 20]}>
        <Col xxl={12} lg={12} xs={24}>
          <Card
            className="system-side-card system-workbench-panel"
            title={
              <Space wrap>
                <Button
                  loading={deptTreeQuery.isFetching}
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => openCreateModal()}
                >
                  新增部门
                </Button>
                <Button
                  loading={deptTreeQuery.isFetching}
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => openCreateModal(true)}
                  disabled={!selectedDept}
                >
                  新增子部门
                </Button>
              </Space>
            }
            loading={deptTreeQuery.isLoading}
            styles={{ body: { minHeight: "70vh" } }}
          >
            {checkedKeys.length > 0 ? (
              <Alert
                className="system-tree-alert"
                type="info"
                description={`已选择 ${checkedKeys.length} 个部门`}
                action={
                  <Space>
                    <Button size="small" type="primary" onClick={() => setCheckedKeys([])}>
                      取消选择
                    </Button>
                    <Popconfirm title="确认删除选中的部门？" onConfirm={() => void deleteChecked()}>
                      <Button
                        danger
                        size="small"
                        type="primary"
                        loading={deleteDeptMutation.isPending}
                        icon={<DeleteOutlined />}
                      />
                    </Popconfirm>
                  </Space>
                }
              />
            ) : null}
            {selectedDept ? (
              <div className="system-panel-summary">
                <span>当前部门</span>
                <strong>{selectedDept.name}</strong>
              </div>
            ) : null}
            <Tree
              checkable
              showIcon
              checkStrictly
              treeData={treeData}
              selectedKeys={activeSelectedKey ? [activeSelectedKey] : []}
              checkedKeys={checkedKeys}
              defaultExpandAll
              onSelect={onSelect}
              onCheck={(keys) => setCheckedKeys(Array.isArray(keys) ? keys : keys.checked)}
            />
          </Card>
        </Col>
        <Col xxl={12} lg={12} xs={24}>
          <Card
            className="system-side-card system-workbench-panel"
            title={
              <div className="system-panel-title">
                <span>{selectedDept ? selectedDept.name : "部门工作区"}</span>
                {selectedDept?.code ? <Tag color="blue">{selectedDept.code}</Tag> : null}
              </div>
            }
            tabList={[
              { key: "info", label: "部门信息" },
              { key: "users", label: "用户列表" },
            ]}
            activeTabKey={tabKey}
            onTabChange={(key) => {
              setTabKey(key);
              setDeptUserPage((value) => ({ page: 1, pageSize: value.pageSize }));
            }}
            styles={{ body: { minHeight: "70vh" } }}
          >
            {tabKey === "info" ? (
              <Form
                form={form}
                layout="horizontal"
                labelCol={{ xs: { span: 24 }, sm: { span: 5 } }}
                wrapperCol={{ xs: { span: 24 }, sm: { span: 16 } }}
                onFinish={submitUpdate}
              >
                <Form.Item name="parentId" label="父级部门" rules={[{ required: true }]}>
                  <TreeSelect treeData={parentTreeData} disabled treeDefaultExpandAll />
                </Form.Item>
                <Form.Item
                  name="name"
                  label="部门名称"
                  rules={[{ required: true, message: "请输入部门名称" }]}
                >
                  <Input />
                </Form.Item>
                <Form.Item name="code" label="部门编码">
                  <Input />
                </Form.Item>
                <Form.Item name="leader" label="负责人">
                  <Input />
                </Form.Item>
                <Form.Item name="phone" label="联系电话">
                  <Input />
                </Form.Item>
                <Form.Item name="sort" label="排序">
                  <InputNumber min={0} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item name="status" label="状态" rules={[{ required: true }]}>
                  <Select options={statusOptions} />
                </Form.Item>
                <Form.Item wrapperCol={{ xs: { offset: 0, span: 24 }, sm: { offset: 5, span: 16 } }}>
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={updateDeptMutation.isPending}
                    disabled={!selectedDept}
                  >
                    保存信息
                  </Button>
                </Form.Item>
              </Form>
            ) : (
              <Table<DeptUserRecord>
                className="admin-table-surface"
                rowKey="id"
                dataSource={deptUsers}
                bordered
                columns={userColumns}
                loading={deptUsersQuery.isLoading || deptUsersQuery.isFetching}
                size="small"
                pagination={{
                  current: deptUserPage.page,
                  pageSize: deptUserPage.pageSize,
                  total: deptUsersTotal,
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 条`,
                  onChange: (page, pageSize) => {
                    setDeptUserPage({ page, pageSize });
                  },
                }}
                scroll={{ x: 600, y: 420 }}
              />
            )}
          </Card>
        </Col>
      </Row>
      <AdminEntityForm
        open={modalOpen}
        mode="create"
        title="新增部门"
        columns={deptColumns}
        initialValues={modalInitialValues}
        loading={createDeptMutation.isPending}
        onCancel={() => setModalOpen(false)}
        onFinish={submitCreate}
      />
    </PageScaffold>
  );
}
