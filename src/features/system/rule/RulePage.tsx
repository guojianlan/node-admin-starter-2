"use client";

import {
  BorderlessTableOutlined,
  BorderOutlined,
  ColumnHeightOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  MinusCircleOutlined,
  PlusCircleOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import {
  Button,
  ConfigProvider,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Popover,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Tree,
  TreeSelect,
} from "antd";
import type { TableProps, TreeSelectProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import relativeTime from "dayjs/plugin/relativeTime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { request } from "@/lib/request";
import { useNavigationAdapter } from "@/platform/navigation";
import { renderMenuIcon } from "@/ui/shell/icon-map";
import { feedback } from "@/ui/feedback/feedback";
import { EmptyState } from "@/ui/states/EmptyState";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

type RuleType = "menu" | "route" | "nested" | "action";

type RuleRecord = {
  id: number;
  parentId: number;
  type: RuleType;
  key: string;
  name: string;
  displayName?: string | null;
  path?: string | null;
  icon?: string | null;
  i18nKey?: string | null;
  component?: string | null;
  order: number;
  status: number;
  hidden: number;
  link: number;
  defaultAuth: number;
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
  children?: RuleRecord[];
};

type RuleFormValues = {
  parentId?: number;
  type: RuleType;
  key: string;
  name: string;
  path?: string | null;
  icon?: string | null;
  i18nKey?: string | null;
  component?: string | null;
  order: number;
  status: number;
  hidden: number;
  link: number;
  defaultAuth: number;
};

const ruleTypeOptions: Array<{ label: string; value: RuleType }> = [
  { label: "菜单项", value: "menu" },
  { label: "路由页面", value: "route" },
  { label: "嵌套路由", value: "nested" },
  { label: "权限项", value: "action" },
];

const ruleTypeMeta: Record<RuleType, { label: string; className: string }> = {
  menu: { label: "菜单项", className: "rule-tag-menu" },
  route: { label: "路由页面", className: "rule-tag-route" },
  nested: { label: "嵌套路由", className: "rule-tag-nested" },
  action: { label: "权限项", className: "rule-tag-action" },
};

const iconOptions = [
  "dashboard",
  "analysis",
  "example",
  "table",
  "form",
  "system",
  "user",
  "role",
  "rule",
  "dept",
  "dict",
  "config",
  "file",
  "storage",
  "mail",
].map((value) => ({
  value,
  label: (
    <Space size={8}>
      {renderMenuIcon(value)}
      <span>{value}</span>
    </Space>
  ),
}));

const columnMeta = [
  { key: "name", title: "规则名称" },
  { key: "displayName", title: "显示名称" },
  { key: "icon", title: "菜单图标" },
  { key: "type", title: "菜单类型" },
  { key: "order", title: "排序序号" },
  { key: "key", title: "权限标识" },
  { key: "hidden", title: "可见状态" },
  { key: "status", title: "启用状态" },
  { key: "createdAt", title: "创建时间" },
  { key: "updatedAt", title: "更新时间" },
];

function buildUrl(pathname: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function getAllKeys(nodes: RuleRecord[]): number[] {
  return nodes.flatMap((node) => [node.id, ...getAllKeys(node.children ?? [])]);
}

function hasKeyword(record: RuleRecord, keyword: string) {
  const text = [
    record.name,
    record.displayName,
    record.key,
    record.path,
    record.icon,
    record.i18nKey,
    record.component,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return text.includes(keyword.toLowerCase());
}

function filterTree(nodes: RuleRecord[], keyword: string): RuleRecord[] {
  const value = keyword.trim();
  if (!value) return nodes;

  return nodes.reduce<RuleRecord[]>((result, node) => {
    const children = filterTree(node.children ?? [], value);
    if (hasKeyword(node, value) || children.length) {
      result.push({ ...node, children });
    }
    return result;
  }, []);
}

function patchTree(nodes: RuleRecord[], id: number, patch: Partial<RuleRecord>): RuleRecord[] {
  return nodes.map((node) => {
    if (node.id === id) return { ...node, ...patch };
    return {
      ...node,
      children: node.children?.length ? patchTree(node.children, id, patch) : node.children,
    };
  });
}

function removeNode(nodes: RuleRecord[], id: number): RuleRecord[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => ({
      ...node,
      children: node.children?.length ? removeNode(node.children, id) : node.children,
    }));
}

function toParentTreeData(nodes: RuleRecord[], disabledId?: number): TreeSelectProps["treeData"] {
  return [
    {
      title: "根级菜单",
      value: 0,
      key: 0,
      children: nodes.map((node) => toParentNode(node, disabledId)),
    },
  ];
}

function toParentNode(node: RuleRecord, disabledId?: number): NonNullable<TreeSelectProps["treeData"]>[number] {
  const disabled = node.id === disabledId;
  return {
    title: node.name,
    value: node.id,
    key: node.id,
    disabled,
    children: node.children?.length ? node.children.map((child) => toParentNode(child, disabledId)) : undefined,
  };
}

function toFormValues(record: RuleRecord): RuleFormValues {
  return {
    parentId: record.parentId,
    type: record.type,
    key: record.key,
    name: record.name,
    path: record.path ?? undefined,
    icon: record.icon ?? undefined,
    i18nKey: record.i18nKey ?? undefined,
    component: record.component ?? undefined,
    order: record.order,
    status: record.status,
    hidden: record.hidden,
    link: record.link,
    defaultAuth: record.defaultAuth,
  };
}

function createInitialValues(parentId?: number): RuleFormValues {
  return {
    parentId,
    type: "menu",
    key: "",
    name: "",
    order: 0,
    status: 1,
    hidden: 1,
    link: 0,
    defaultAuth: 0,
  };
}

function normalizePayload(values: RuleFormValues) {
  const cleanText = (value?: string | null) => {
    const next = value?.trim();
    return next ? next : null;
  };

  return {
    ...values,
    parentId: values.parentId ?? 0,
    key: values.key.trim(),
    name: values.name.trim(),
    path: cleanText(values.path),
    icon: cleanText(values.icon),
    i18nKey: cleanText(values.i18nKey),
    component: cleanText(values.component),
    order: Number(values.order ?? 0),
    status: Number(values.status ?? 1),
    hidden: Number(values.hidden ?? 1),
    link: Number(values.link ?? 0),
    defaultAuth: Number(values.defaultAuth ?? 0),
  };
}

function relativeDate(value?: string | null) {
  return value ? dayjs(value).fromNow() : "-";
}

export function RulePage() {
  const navigation = useNavigationAdapter();
  const [form] = Form.useForm<RuleFormValues>();
  const [rows, setRows] = useState<RuleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"create" | "update">("create");
  const [drawerInitialValues, setDrawerInitialValues] = useState<RuleFormValues>(createInitialValues());
  const [editingRecord, setEditingRecord] = useState<RuleRecord | null>(null);
  const [manualExpandedRowKeys, setManualExpandedRowKeys] = useState<React.Key[] | null>(null);
  const [draftKeyword, setDraftKeyword] = useState<string | null>(null);
  const [density, setDensity] = useState<TableProps<RuleRecord>["size"]>("small");
  const [bordered, setBordered] = useState(true);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(columnMeta.map((item) => item.key));

  const keyword = useMemo(() => {
    const params = new URLSearchParams(navigation.search);
    return params.get("keyword") ?? "";
  }, [navigation.search]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<RuleRecord[]>("/api/system/rule/tree", { silent: true });
      setRows(data);
      setManualExpandedRowKeys(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadData);
  }, [loadData, reloadKey]);

  const filteredRows = useMemo(() => filterTree(rows, keyword), [rows, keyword]);
  const expandedRowKeys = manualExpandedRowKeys ?? getAllKeys(filteredRows);
  const keywordInput = draftKeyword ?? keyword;

  useEffect(() => {
    if (!drawerOpen) return;
    form.resetFields();
    const values = drawerInitialValues;
    const timer = window.setTimeout(() => form.setFieldsValue(values), 0);
    return () => window.clearTimeout(timer);
  }, [drawerInitialValues, drawerOpen, form]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  function applyKeyword(value: string) {
    const params = new URLSearchParams(navigation.search);
    const nextValue = value.trim();
    if (nextValue) params.set("keyword", nextValue);
    else params.delete("keyword");
    setDraftKeyword(null);
    setManualExpandedRowKeys(null);
    navigation.push(buildUrl(navigation.pathname, params));
  }

  function openCreate(parentId?: number) {
    const values = createInitialValues(parentId);
    setDrawerMode("create");
    setEditingRecord(null);
    setDrawerInitialValues(values);
    setDrawerOpen(true);
  }

  function openUpdate(record: RuleRecord) {
    const values = toFormValues(record);
    setDrawerMode("update");
    setEditingRecord(record);
    setDrawerInitialValues(values);
    setDrawerOpen(true);
  }

  async function toggleHidden(record: RuleRecord, checked: boolean) {
    const hidden = checked ? 1 : 0;
    setRows((current) => patchTree(current, record.id, { hidden }));
    await request(`/api/system/rule/hidden/${record.id}`, {
      method: "PUT",
      body: { hidden },
    });
    feedback.success("可见状态更新成功");
  }

  async function toggleStatus(record: RuleRecord, checked: boolean) {
    const status = checked ? 1 : 0;
    setRows((current) => patchTree(current, record.id, { status }));
    await request(`/api/system/rule/status/${record.id}`, {
      method: "PUT",
      body: { status },
    });
    feedback.success("启用状态更新成功");
  }

  async function deleteRecord(record: RuleRecord) {
    await request(`/api/system/rule/${record.id}`, { method: "DELETE" });
    setRows((current) => removeNode(current, record.id));
    feedback.success("删除成功");
  }

  async function handleSubmit() {
    const values = await form.validateFields();
    const payload = normalizePayload(values);
    setSaving(true);
    try {
      if (drawerMode === "create") {
        await request("/api/system/rule", { method: "POST", body: payload });
        feedback.success("创建成功");
      } else if (editingRecord) {
        await request(`/api/system/rule/${editingRecord.id}`, {
          method: "PUT",
          body: payload,
        });
        feedback.success("更新成功");
      }
      setDrawerOpen(false);
      setEditingRecord(null);
      reload();
    } finally {
      setSaving(false);
    }
  }

  const densityMenu = {
    items: [
      { key: "large", label: "默认", onClick: () => setDensity("large") },
      { key: "middle", label: "适中", onClick: () => setDensity("middle") },
      { key: "small", label: "紧凑", onClick: () => setDensity("small") },
    ],
    selectedKeys: [density ?? "small"],
  };

  const columnSettingContent = (
    <ConfigProvider theme={{ components: { Tree: { nodeHoverBg: "var(--admin-surface-muted)" } } }}>
      <Tree
        checkable
        selectable={false}
        checkedKeys={visibleColumnKeys}
        treeData={columnMeta.map((item) => ({ key: item.key, title: item.title }))}
        onCheck={(keys) => {
          const nextKeys = Array.isArray(keys) ? keys : keys.checked;
          setVisibleColumnKeys(nextKeys.map(String));
        }}
      />
    </ConfigProvider>
  );

  const baseColumns = useMemo<ColumnsType<RuleRecord>>(
    () => [
    {
      title: "规则名称",
      dataIndex: "name",
      key: "name",
      width: 165,
      ellipsis: true,
    },
    {
      title: "显示名称",
      dataIndex: "displayName",
      key: "displayName",
      width: 115,
      align: "center",
      ellipsis: true,
      render: (_, record) => record.displayName || (record.i18nKey ? record.name : "-"),
    },
    {
      title: "菜单图标",
      dataIndex: "icon",
      key: "icon",
      width: 78,
      align: "center",
      render: (value) => (
        <span className="rule-icon-cell">{value ? renderMenuIcon(String(value)) : "-"}</span>
      ),
    },
    {
      title: "菜单类型",
      dataIndex: "type",
      key: "type",
      width: 92,
      align: "center",
      render: (value: RuleType) => {
        const meta = ruleTypeMeta[value] ?? ruleTypeMeta.action;
        return <Tag className={`rule-type-tag ${meta.className}`}>{meta.label}</Tag>;
      },
    },
    {
      title: "排序序号",
      dataIndex: "order",
      key: "order",
      width: 80,
      align: "center",
      render: (value) => <Tag className="rule-pill rule-pill-order">{String(value)}</Tag>,
    },
    {
      title: "权限标识",
      dataIndex: "key",
      key: "key",
      width: 170,
      align: "center",
      ellipsis: true,
      render: (value) => <Tag className="rule-pill rule-pill-key">{String(value)}</Tag>,
    },
    {
      title: "可见状态",
      dataIndex: "hidden",
      key: "hidden",
      width: 90,
      align: "center",
      render: (_, record) =>
        record.type === "action" ? (
          "-"
        ) : (
          <Switch
            className="rule-switch"
            checked={record.hidden === 1}
            checkedChildren="显示"
            unCheckedChildren="隐藏"
            disabled={record.isSystem}
            onClick={(_, event) => event.stopPropagation()}
            onChange={(checked) => void toggleHidden(record, checked)}
          />
        ),
    },
    {
      title: "启用状态",
      dataIndex: "status",
      key: "status",
      width: 90,
      align: "center",
      render: (_, record) => (
        <Switch
          className="rule-switch"
          checked={record.status === 1}
          checkedChildren="启用"
          unCheckedChildren="禁用"
          disabled={record.isSystem}
          onClick={(_, event) => event.stopPropagation()}
          onChange={(checked) => void toggleStatus(record, checked)}
        />
      ),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 75,
      align: "center",
      render: (value) => relativeDate(String(value)),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 75,
      align: "center",
      render: (value) => relativeDate(String(value)),
    },
    ],
    [],
  );

  const columns = useMemo<ColumnsType<RuleRecord>>(() => {
    const visibleColumns = baseColumns.filter((column) => visibleColumnKeys.includes(String(column.key)));
    return [
      ...visibleColumns,
      {
        title: "操作栏",
        key: "operate",
        width: 104,
        align: "center",
        fixed: "right",
        render: (_, record) => (
          <Space size={4} onClick={(event) => event.stopPropagation()}>
            <AuthButton auth="system.rule.create">
              <Tooltip title="添加子项">
                <Button
                  aria-label="新增子权限"
                  className="rule-operate-add"
                  type="primary"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => openCreate(record.id)}
                />
              </Tooltip>
            </AuthButton>
            <AuthButton auth="system.rule.update">
              <Tooltip title="编辑">
                <Button
                  aria-label="编辑"
                  type="primary"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => openUpdate(record)}
                />
              </Tooltip>
            </AuthButton>
            {!record.isSystem ? (
              <AuthButton auth="system.rule.delete">
                <Popconfirm
                  title="确认删除当前权限？"
                  okText="确认"
                  cancelText="取消"
                  onConfirm={() => void deleteRecord(record)}
                >
                  <Tooltip title="删除">
                    <Button aria-label="删除" danger type="primary" size="small" icon={<DeleteOutlined />} />
                  </Tooltip>
                </Popconfirm>
              </AuthButton>
            ) : null}
          </Space>
        ),
      },
    ];
  }, [baseColumns, visibleColumnKeys]);

  return (
    <div className="admin-card rule-page-card">
      <div className="rule-page-header">
        <h1 className="rule-page-title">权限管理</h1>
        <div className="rule-page-tools">
          <Input
            allowClear
            className="rule-keyword"
            placeholder="请输入关键字"
            value={keywordInput}
            onChange={(event) => {
              const value = event.target.value;
              setDraftKeyword(value);
              if (!value && keyword) applyKeyword("");
            }}
            onPressEnter={() => applyKeyword(keywordInput)}
          />
          <Tooltip title="搜索">
            <Button icon={<SearchOutlined />} onClick={() => applyKeyword(keywordInput)} />
          </Tooltip>
          <AuthButton auth="system.rule.create">
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
              新增
            </Button>
          </AuthButton>
          <Tooltip title="刷新">
            <Button type="text" icon={<ReloadOutlined />} onClick={reload} />
          </Tooltip>
          <Dropdown menu={densityMenu} trigger={["click"]}>
            <Button type="text" icon={<ColumnHeightOutlined />} />
          </Dropdown>
          <Tooltip title={bordered ? "隐藏边框" : "显示边框"}>
            <Button
              type="text"
              icon={bordered ? <BorderOutlined /> : <BorderlessTableOutlined />}
              onClick={() => setBordered((value) => !value)}
            />
          </Tooltip>
          <Popover
            content={columnSettingContent}
            placement="bottomRight"
            title="列设置"
            trigger="click"
          >
            <Tooltip title="列设置">
              <Button type="text" icon={<SettingOutlined />} />
            </Tooltip>
          </Popover>
        </div>
      </div>

      <Table<RuleRecord>
        className="rule-tree-table admin-table-surface"
        rowKey="id"
        columns={columns}
        dataSource={filteredRows}
        loading={loading}
        bordered={bordered}
        size={density}
        pagination={false}
        locale={{ emptyText: <EmptyState /> }}
        scroll={{
          x: 1144,
          y: "var(--admin-rule-table-body-block-size)",
        }}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setManualExpandedRowKeys([...keys]),
          expandIcon: ({ expanded, onExpand, record }) => {
            const hasChildren = Boolean(record.children?.length);
            if (!hasChildren) return <span className="rule-expand-placeholder" />;
            return (
              <Button
                className="rule-expand-button"
                type="text"
                size="small"
                icon={expanded ? <MinusCircleOutlined /> : <PlusCircleOutlined />}
                onClick={(event) => onExpand(record, event)}
              />
            );
          },
        }}
      />

      <Drawer
        className="rule-form-drawer"
        title={
          <div className="rule-drawer-title">
            <span>{drawerMode === "create" ? "新增菜单权限" : "编辑菜单权限"}</span>
            <Button
              aria-label="关闭"
              type="text"
              icon={<CloseOutlined />}
              onClick={() => {
                setDrawerOpen(false);
                setEditingRecord(null);
              }}
            />
          </div>
        }
        open={drawerOpen}
        closable={false}
        destroyOnHidden
        size="min(620px, calc(100vw - 24px))"
        onClose={() => {
          setDrawerOpen(false);
          setEditingRecord(null);
        }}
        afterOpenChange={(open) => {
          if (open) form.setFieldsValue(drawerInitialValues);
        }}
        footer={
          <div className="rule-drawer-footer">
            <Button
              className="rule-drawer-reset"
              onClick={() => {
                form.resetFields();
                form.setFieldsValue(drawerInitialValues);
              }}
            >
              重置
            </Button>
            <Button
              onClick={() => {
                setDrawerOpen(false);
                setEditingRecord(null);
              }}
            >
              取消
            </Button>
            <Button type="primary" loading={saving} onClick={() => void handleSubmit()}>
              提交
            </Button>
          </div>
        }
      >
        <Form
          className="rule-drawer-form"
          form={form}
          requiredMark
          labelAlign="left"
          labelCol={{ flex: "104px" }}
          wrapperCol={{ flex: 1 }}
          colon
        >
          <Form.Item
            label="菜单类型"
            name="type"
            rules={[{ required: true, message: "请选择菜单类型" }]}
          >
            <Radio.Group
              className="rule-type-radio"
              optionType="button"
              buttonStyle="outline"
              options={ruleTypeOptions}
            />
          </Form.Item>
          <Form.Item
            label="上级菜单"
            name="parentId"
            rules={[{ required: true, message: "请选择上级菜单" }]}
          >
            <TreeSelect
              allowClear
              treeDefaultExpandAll
              placeholder="上级菜单"
              treeData={toParentTreeData(rows, editingRecord?.id)}
            />
          </Form.Item>
          <Form.Item
            label="排序序号"
            name="order"
            rules={[{ required: true, message: "请输入排序序号" }]}
          >
            <InputNumber controls={false} placeholder="排序序号" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="规则名称"
            name="name"
            rules={[{ required: true, message: "请输入规则名称" }]}
          >
            <Input allowClear placeholder="规则名称" />
          </Form.Item>
          <Form.Item
            label="权限标识"
            name="key"
            rules={[{ required: true, message: "请输入权限标识" }]}
          >
            <Input allowClear placeholder="权限标识" />
          </Form.Item>
          <Form.Item
            label="路由路径"
            name="path"
            tooltip={{
              title: "路由页面访问地址，如为外部链接请直接填写完整 URL",
              icon: <QuestionCircleOutlined />,
            }}
          >
            <Input allowClear placeholder="路由路径" />
          </Form.Item>
          <Form.Item label="菜单图标" name="icon">
            <Select
              allowClear
              showSearch
              optionFilterProp="value"
              placeholder="菜单图标"
              options={iconOptions}
            />
          </Form.Item>
          <Form.Item label="国际化键值" name="i18nKey">
            <Input allowClear placeholder="国际化键值" />
          </Form.Item>
          <Form.Item label="组件路径" name="component">
            <Input allowClear placeholder="组件路径" />
          </Form.Item>
          <Form.Item label="是否外链" name="link">
            <Select
              options={[
                { label: "否", value: 0 },
                { label: "是", value: 1 },
              ]}
            />
          </Form.Item>
          <Form.Item label="默认权限" name="defaultAuth">
            <Select
              options={[
                { label: "不启用", value: 0 },
                { label: "启用", value: 1 },
              ]}
            />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
