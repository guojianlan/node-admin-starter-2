"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined, SettingOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Form,
  Input,
  InputNumber,
  Menu,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminEntityForm } from "@/components/admin-entity-form/AdminEntityForm";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { configTypeOptions, statusOptions } from "../shared/options";

type ConfigGroupRecord = {
  id: number;
  name: string;
  code: string;
  sort: number;
  status: number;
  createdAt?: string;
};

type ConfigItemRecord = {
  id: number;
  groupId: number;
  groupName?: string | null;
  key: string;
  title: string;
  describe?: string | null;
  values?: string | null;
  type: string;
  optionsJson?: string | null;
  propsJson?: string | null;
  sort: number;
  status: number;
  createdAt?: string;
};

function parseJsonArray(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeInitialValue(item: ConfigItemRecord) {
  if (item.type === "digit") return Number(item.values || 0);
  if (item.type === "switch") return item.values === "1" || item.values === "true";
  if (item.type === "checkbox") return parseJsonArray(item.values);
  return item.values ?? "";
}

function stringifyConfigValue(item: ConfigItemRecord, value: unknown) {
  if (item.type === "switch") return value ? "true" : "false";
  if (item.type === "checkbox") return JSON.stringify(value ?? []);
  return value == null ? "" : String(value);
}

export function ConfigPage() {
  const [form] = Form.useForm();
  const [groups, setGroups] = useState<ConfigGroupRecord[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number>();
  const [items, setItems] = useState<ConfigItemRecord[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<"create" | "update">("create");
  const [groupModalLoading, setGroupModalLoading] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ConfigGroupRecord | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemModalMode, setItemModalMode] = useState<"create" | "update">("create");
  const [itemModalLoading, setItemModalLoading] = useState(false);
  const [editingItem, setEditingItem] = useState<ConfigItemRecord | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId),
    [groups, selectedGroupId],
  );

  const loadGroups = useCallback(async (preferredGroupId?: number) => {
    setGroupsLoading(true);
    try {
      const result = await request<PageResult<ConfigGroupRecord>>("/api/system/config/group?pageSize=200", {
        silent: true,
      });
      setGroups(result.data);
      const activeGroupId = preferredGroupId && result.data.some((group) => group.id === preferredGroupId)
        ? preferredGroupId
        : result.data[0]?.id;
      setSelectedGroupId(activeGroupId);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  const loadItems = useCallback(
    async (groupId?: number) => {
      if (!groupId) {
        setItems([]);
        return;
      }
      setItemsLoading(true);
      try {
        const result = await request<PageResult<ConfigItemRecord>>(
          `/api/system/config/items?groupId=${groupId}&pageSize=200`,
          { silent: true },
        );
        setItems(result.data);
        const initialValues: Record<string, unknown> = {};
        result.data.forEach((item) => {
          initialValues[`item_${item.id}`] = normalizeInitialValue(item);
        });
        form.setFieldsValue(initialValues);
      } finally {
        setItemsLoading(false);
      }
    },
    [form],
  );

  useEffect(() => {
    void Promise.resolve().then(() => loadGroups());
  }, [loadGroups]);

  useEffect(() => {
    void Promise.resolve().then(() => loadItems(selectedGroupId));
  }, [loadItems, selectedGroupId]);

  const groupColumns: AdminDataTableColumn<ConfigGroupRecord>[] = [
    { title: "分组名称", dataIndex: "name", required: true },
    { title: "分组编码", dataIndex: "code", required: true },
    { title: "排序", dataIndex: "sort", valueType: "digit" },
    { title: "状态", dataIndex: "status", valueType: "select", options: statusOptions, required: true },
  ];

  const itemColumns: AdminDataTableColumn<ConfigItemRecord>[] = [
    { title: "配置 Key", dataIndex: "key", required: true },
    { title: "标题", dataIndex: "title", required: true },
    {
      title: "组件类型",
      dataIndex: "type",
      valueType: "select",
      options: configTypeOptions,
      required: true,
    },
    { title: "排序", dataIndex: "sort", valueType: "digit" },
    { title: "说明", dataIndex: "describe", valueType: "textarea", fullWidth: true },
    { title: "选项 JSON", dataIndex: "optionsJson", valueType: "textarea", fullWidth: true },
    { title: "属性 JSON", dataIndex: "propsJson", valueType: "textarea", fullWidth: true },
    { title: "默认值", dataIndex: "values", valueType: "textarea", fullWidth: true },
    { title: "状态", dataIndex: "status", valueType: "select", options: statusOptions, required: true },
  ];

  function openCreateGroup() {
    setEditingGroup(null);
    setGroupModalMode("create");
    setGroupModalOpen(true);
  }

  function openEditGroup(group: ConfigGroupRecord) {
    setEditingGroup(group);
    setGroupModalMode("update");
    setGroupModalOpen(true);
  }

  async function saveGroup(values: Record<string, unknown>) {
    setGroupModalLoading(true);
    try {
      if (groupModalMode === "create") {
        await request("/api/system/config/group", { method: "POST", body: values });
        feedback.success("创建成功");
      } else if (editingGroup) {
        await request(`/api/system/config/group/${editingGroup.id}`, { method: "PUT", body: values });
        feedback.success("更新成功");
      }
      setGroupModalOpen(false);
      await loadGroups(editingGroup?.id);
    } finally {
      setGroupModalLoading(false);
    }
  }

  async function deleteGroup(groupId: number) {
    await request(`/api/system/config/group/${groupId}`, { method: "DELETE" });
    feedback.success("删除成功");
    await loadGroups();
  }

  function openCreateItem() {
    if (!selectedGroupId) {
      feedback.warning("请先选择配置分组");
      return;
    }
    setEditingItem(null);
    setItemModalMode("create");
    setItemModalOpen(true);
  }

  function openEditItem(item: ConfigItemRecord) {
    setEditingItem(item);
    setItemModalMode("update");
    setItemModalOpen(true);
  }

  async function saveItem(values: Record<string, unknown>) {
    if (!selectedGroupId) return;
    setItemModalLoading(true);
    try {
      const payload = { ...values, groupId: selectedGroupId };
      if (itemModalMode === "create") {
        await request("/api/system/config/items", { method: "POST", body: payload });
        feedback.success("创建成功");
      } else if (editingItem) {
        await request(`/api/system/config/items/${editingItem.id}`, { method: "PUT", body: payload });
        feedback.success("更新成功");
      }
      setItemModalOpen(false);
      await loadItems(selectedGroupId);
    } finally {
      setItemModalLoading(false);
    }
  }

  async function deleteItem(itemId: number) {
    await request(`/api/system/config/items/${itemId}`, { method: "DELETE" });
    feedback.success("删除成功");
    await loadItems(selectedGroupId);
  }

  async function saveValues() {
    setSaving(true);
    try {
      const values = form.getFieldsValue();
      const payload = Object.fromEntries(
        items.map((item) => [item.key, stringifyConfigValue(item, values[`item_${item.id}`])]),
      );
      await request("/api/system/config/items/save", {
        method: "PUT",
        body: payload,
      });
      feedback.success("保存成功");
      await loadItems(selectedGroupId);
    } finally {
      setSaving(false);
    }
  }

  function renderConfigControl(item: ConfigItemRecord) {
    const options = parseJsonArray(item.optionsJson) as Array<{ label: string; value: string | number }>;
    if (item.type === "textarea") return <Input.TextArea rows={4} placeholder={item.describe || "请输入"} />;
    if (item.type === "digit") return <InputNumber style={{ width: "100%" }} placeholder={item.describe || "请输入"} />;
    if (item.type === "switch") return <Switch />;
    if (item.type === "checkbox") return <Checkbox.Group options={options} />;
    if (item.type === "select") return <Select options={options} placeholder={item.describe || "请选择"} />;
    return <Input placeholder={item.describe || "请输入"} />;
  }

  return (
    <PageScaffold title="系统配置" description="管理系统配置分组与配置项，保存后用于后台基础能力读取">
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={5} xl={4}>
          <Card
            className="system-side-card"
            title={
              <Space>
                <SettingOutlined />
                配置分组
              </Space>
            }
            extra={
              <Button type="link" size="small" icon={<PlusOutlined />} onClick={openCreateGroup}>
                新增
              </Button>
            }
            loading={groupsLoading}
          >
            <Menu
              mode="inline"
              selectedKeys={selectedGroupId ? [String(selectedGroupId)] : []}
              items={groups.map((group) => ({
                key: String(group.id),
                label: (
                  <div className="system-menu-row">
                    <span>{group.name}</span>
                    <Space size={2}>
                      <Button
                        type="text"
                        size="small"
                        icon={<EditOutlined />}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditGroup(group);
                        }}
                      />
                      <Popconfirm
                        title="确认删除配置分组？"
                        onConfirm={(event) => {
                          event?.stopPropagation();
                          void deleteGroup(group.id);
                        }}
                      >
                        <Button
                          danger
                          type="text"
                          size="small"
                          icon={<DeleteOutlined />}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </Popconfirm>
                    </Space>
                  </div>
                ),
                onClick: () => setSelectedGroupId(group.id),
              }))}
            />
          </Card>
        </Col>
        <Col xs={24} lg={19} xl={20}>
          <Card
            className="system-side-card"
            title={selectedGroup ? `${selectedGroup.name} - 配置项` : "配置项"}
            extra={
              selectedGroupId ? (
                <Space>
                  <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveValues()}>
                    保存配置
                  </Button>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreateItem}>
                    新增配置项
                  </Button>
                </Space>
              ) : null
            }
          >
            {!selectedGroupId ? (
              <div className="system-empty-tip">请选择左侧配置分组</div>
            ) : (
              <Spin spinning={itemsLoading}>
                <Form form={form} layout="vertical">
                  {items.length ? (
                    items.map((item, index) => (
                      <div className="system-config-item" key={item.id}>
                        <Form.Item
                          name={`item_${item.id}`}
                          label={
                            <div className="system-config-label">
                              <Space>
                                <Typography.Text strong>{item.title}</Typography.Text>
                                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEditItem(item)} />
                                <Popconfirm title="确认删除配置项？" onConfirm={() => void deleteItem(item.id)}>
                                  <Button danger type="text" size="small" icon={<DeleteOutlined />} />
                                </Popconfirm>
                              </Space>
                              <div>
                                <Typography.Text type="secondary" className="system-config-desc">
                                  {item.describe || "暂无说明"}{" "}
                                  <Typography.Text code copyable>
                                    {`${selectedGroup?.code}.${item.key}`}
                                  </Typography.Text>
                                </Typography.Text>
                              </div>
                            </div>
                          }
                        >
                          {renderConfigControl(item)}
                        </Form.Item>
                        {index < items.length - 1 ? <Divider /> : null}
                      </div>
                    ))
                  ) : (
                    <div className="system-empty-tip">当前分组暂无配置项</div>
                  )}
                </Form>
              </Spin>
            )}
          </Card>
        </Col>
      </Row>
      <AdminEntityForm
        open={groupModalOpen}
        mode={groupModalMode}
        title={groupModalMode === "create" ? "新增配置分组" : "编辑配置分组"}
        columns={groupColumns}
        initialValues={editingGroup}
        loading={groupModalLoading}
        onCancel={() => setGroupModalOpen(false)}
        onFinish={saveGroup}
      />
      <AdminEntityForm
        open={itemModalOpen}
        mode={itemModalMode}
        title={itemModalMode === "create" ? "新增配置项" : "编辑配置项"}
        columns={itemColumns}
        initialValues={editingItem ?? { groupId: selectedGroupId, type: "text", sort: 0, status: 1 }}
        loading={itemModalLoading}
        onCancel={() => setItemModalOpen(false)}
        onFinish={saveItem}
      />
    </PageScaffold>
  );
}
