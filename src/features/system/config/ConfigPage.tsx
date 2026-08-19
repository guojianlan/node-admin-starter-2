"use client";

import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SaveOutlined,
  SettingOutlined,
} from "@ant-design/icons";
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
  Tag,
  Typography,
  type FormInstance,
} from "antd";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AdminEntityForm } from "@/components/admin-entity-form/AdminEntityForm";
import { AdminFieldRenderer } from "@/components/admin-fields/AdminFieldRenderer";
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
  values?: string | number | boolean | Array<string | number | boolean> | null;
  type: string;
  optionsJson?: string | null;
  propsJson?: string | null;
  sort: number;
  status: number;
  createdAt?: string;
};

type ConfigOptionValue = string | number | boolean;

type ConfigOption = {
  label: string;
  value: ConfigOptionValue;
  disabled?: boolean;
};

const emptyConfigGroups: ConfigGroupRecord[] = [];
const emptyConfigItems: ConfigItemRecord[] = [];

const OPTION_JSON_EXAMPLE = `[
  { "label": "启用", "value": "1" },
  { "label": "停用", "value": "0" }
]`;

const PROPS_JSON_EXAMPLES: Record<string, string> = {
  text: `{ "placeholder": "请输入站点名称", "maxLength": 50 }`,
  textarea: `{ "rows": 6, "placeholder": "请输入说明" }`,
  digit: `{ "min": 0, "max": 999, "step": 1 }`,
  switch: `{ "checkedChildren": "开", "unCheckedChildren": "关" }`,
  select: `{ "placeholder": "请选择状态" }`,
  checkbox: `{ "disabled": false }`,
  image: `{ "placeholder": "上传 Logo 或选择已有图片" }`,
};

const RESERVED_CONFIG_FIELD_PROPS = new Set([
  "value",
  "defaultValue",
  "checked",
  "defaultChecked",
  "onChange",
  "options",
  "children",
  "mode",
  "treeData",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonArray(value?: unknown) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value?: unknown) {
  if (isPlainObject(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isConfigOption(value: unknown): value is ConfigOption {
  if (!isPlainObject(value)) return false;
  const label = value.label;
  const optionValue = value.value;
  return (
    (typeof label === "string" || typeof label === "number") &&
    (typeof optionValue === "string" ||
      typeof optionValue === "number" ||
      typeof optionValue === "boolean")
  );
}

function parseConfigOptions(value?: unknown): ConfigOption[] {
  return parseJsonArray(value)
    .filter(isConfigOption)
    .map((option) => ({
      label: String(option.label),
      value: option.value,
      disabled: option.disabled,
    }));
}

function getSafeFieldProps(value?: unknown) {
  const props = parseJsonObject(value);
  return Object.fromEntries(
    Object.entries(props).filter(([key]) => !RESERVED_CONFIG_FIELD_PROPS.has(key)),
  );
}

function getPropsJsonPlaceholder(type?: string) {
  return PROPS_JSON_EXAMPLES[type || "text"] || PROPS_JSON_EXAMPLES.text;
}

function getValuePlaceholder(type?: string) {
  if (type === "switch") return "true 或 false";
  if (type === "digit") return "例如：0";
  if (type === "checkbox") return `例如：["email", "sms"]`;
  if (type === "select") return "填写某个选项 value，例如：1";
  if (type === "image") return "/uploads/example.png";
  return "请输入默认值";
}

function normalizeInitialValue(item: ConfigItemRecord) {
  if (item.type === "digit") return Number(item.values || 0);
  if (item.type === "switch") return item.values === "1" || item.values === "true";
  if (item.type === "checkbox") return parseJsonArray(item.values);
  return item.values ?? "";
}

function stringifyConfigValue(typeOrItem: ConfigItemRecord | string, value: unknown) {
  const type = typeof typeOrItem === "string" ? typeOrItem : typeOrItem.type;
  if (type === "switch") return value ? "true" : "false";
  if (type === "checkbox")
    return JSON.stringify(Array.isArray(value) ? value : parseJsonArray(value));
  return value == null ? "" : String(value);
}

function normalizeConfigItemFormValues(item?: Partial<ConfigItemRecord> | null) {
  if (!item) return item;
  return {
    ...item,
    values: normalizeInitialValue({
      type: item.type || "text",
      values: item.values ?? null,
    } as ConfigItemRecord),
  };
}

const configTypeHelp = (
  <div className="admin-json-help-content">
    <div>决定配置项最终渲染成哪种输入控件。</div>
    <div>切换类型后，“默认值”的输入方式会同步变化。</div>
  </div>
);

const optionJsonHelp = (
  <div className="admin-json-help-content">
    <div>只在“下拉选择”和“多选框”类型中使用。</div>
    <div>每一项必须包含 label 和 value，value 是最终保存的值。</div>
    <pre>{OPTION_JSON_EXAMPLE}</pre>
  </div>
);

const propsJsonHelp = (
  <div className="admin-json-help-content">
    <div>可选，用来给实际控件补充 Ant Design 组件属性。</div>
    <div>常用字段包括 placeholder、maxLength、rows、min、max、step。</div>
    <pre>{`{ "placeholder": "请输入站点名称", "maxLength": 50 }`}</pre>
    <pre>{`{ "min": 0, "max": 999, "step": 1 }`}</pre>
  </div>
);

const defaultValueHelp = (
  <div className="admin-json-help-content">
    <div>配置项第一次创建或重置时使用的值。</div>
    <div>文本/图片/下拉保存字符串，数字保存数字，开关保存 true 或 false。</div>
    <div>多选框保存数组，例如：</div>
    <pre>{`["email", "sms"]`}</pre>
  </div>
);

function ConfigDefaultValueField({
  form,
  ...controlProps
}: {
  form: FormInstance<ConfigItemRecord>;
} & Record<string, unknown>) {
  const type = Form.useWatch("type", form) || "text";
  const optionsJson = Form.useWatch("optionsJson", form);
  const propsJson = Form.useWatch("propsJson", form);
  const options = parseConfigOptions(optionsJson);
  const fieldProps = getSafeFieldProps(propsJson);

  if (type === "image") {
    return (
      <AdminFieldRenderer
        valueType="image"
        fieldProps={{ placeholder: "上传图片，或从文件管理中选择图片", ...fieldProps }}
        {...controlProps}
      />
    );
  }

  if (type === "digit") {
    return (
      <AdminFieldRenderer
        valueType="digit"
        fieldProps={{ placeholder: "请输入数字默认值", ...fieldProps }}
        {...controlProps}
      />
    );
  }

  if (type === "switch") {
    return <Switch {...fieldProps} {...controlProps} />;
  }

  if (type === "select") {
    return (
      <AdminFieldRenderer
        valueType="select"
        options={options}
        fieldProps={{
          placeholder: options.length ? "请选择默认项" : "先填写选项 JSON",
          ...fieldProps,
        }}
        {...controlProps}
      />
    );
  }

  if (type === "checkbox") {
    return <Checkbox.Group {...fieldProps} {...controlProps} options={options} />;
  }

  if (type === "textarea") {
    return (
      <AdminFieldRenderer
        valueType="textarea"
        fieldProps={{ placeholder: getValuePlaceholder(type), ...fieldProps }}
        {...controlProps}
      />
    );
  }

  return (
    <AdminFieldRenderer
      fieldProps={{ placeholder: getValuePlaceholder(type), ...fieldProps }}
      {...controlProps}
    />
  );
}

function ConfigOptionsJsonField({
  form,
  ...controlProps
}: {
  form: FormInstance<ConfigItemRecord>;
} & Record<string, unknown>) {
  const type = Form.useWatch("type", form);
  const usesOptions = type === "select" || type === "checkbox";

  return (
    <Input.TextArea
      autoSize={{ minRows: 4, maxRows: 8 }}
      placeholder={
        usesOptions ? OPTION_JSON_EXAMPLE : "当前组件类型不会读取选项 JSON；选择下拉或多选时再填写"
      }
      {...controlProps}
    />
  );
}

function ConfigPropsJsonField({
  form,
  ...controlProps
}: {
  form: FormInstance<ConfigItemRecord>;
} & Record<string, unknown>) {
  const type = Form.useWatch("type", form);

  return (
    <Input.TextArea
      autoSize={{ minRows: 3, maxRows: 8 }}
      placeholder={getPropsJsonPlaceholder(type)}
      {...controlProps}
    />
  );
}

export function ConfigPage() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [selectedGroupId, setSelectedGroupId] = useState<number>();
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<"create" | "update">("create");
  const [editingGroup, setEditingGroup] = useState<ConfigGroupRecord | null>(null);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemModalMode, setItemModalMode] = useState<"create" | "update">("create");
  const [editingItem, setEditingItem] = useState<ConfigItemRecord | null>(null);

  const groupsQuery = useQuery({
    queryKey: ["system-config-groups"],
    queryFn: () =>
      request<PageResult<ConfigGroupRecord>>("/api/system/config/group?pageSize=200", {
        silent: true,
      }),
  });
  const groups = groupsQuery.data?.data ?? emptyConfigGroups;
  const activeGroupId =
    selectedGroupId && groups.some((group) => group.id === selectedGroupId)
      ? selectedGroupId
      : groups[0]?.id;

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId),
    [activeGroupId, groups],
  );

  const itemsQuery = useQuery({
    queryKey: ["system-config-items", activeGroupId],
    enabled: Boolean(activeGroupId),
    placeholderData: keepPreviousData,
    queryFn: () =>
      request<PageResult<ConfigItemRecord>>(
        `/api/system/config/items?groupId=${activeGroupId}&pageSize=200`,
        { silent: true },
      ),
  });
  const items = itemsQuery.data?.data ?? emptyConfigItems;

  useEffect(() => {
    if (!activeGroupId) return;
    const initialValues: Record<string, unknown> = {};
    items.forEach((item) => {
      initialValues[`item_${item.id}`] = normalizeInitialValue(item);
    });
    form.setFieldsValue(initialValues);
  }, [activeGroupId, form, items]);

  const saveGroupMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      if (groupModalMode === "create") {
        return request("/api/system/config/group", { method: "POST", body: values });
      }
      if (!editingGroup) throw new Error("配置分组不存在");
      return request(`/api/system/config/group/${editingGroup.id}`, {
        method: "PUT",
        body: values,
      });
    },
    onSuccess: () => {
      feedback.success(groupModalMode === "create" ? "创建成功" : "更新成功");
      setGroupModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["system-config-groups"] });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (groupId: number) =>
      request(`/api/system/config/group/${groupId}`, { method: "DELETE" }),
    onSuccess: (_, groupId) => {
      feedback.success("删除成功");
      if (activeGroupId === groupId) setSelectedGroupId(undefined);
      void queryClient.invalidateQueries({ queryKey: ["system-config-groups"] });
      void queryClient.invalidateQueries({ queryKey: ["system-config-items"] });
    },
  });

  const saveItemMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      if (!activeGroupId) throw new Error("请先选择配置分组");
      const type = String(values.type || "text");
      const payload = {
        ...values,
        groupId: activeGroupId,
        values: stringifyConfigValue(type, values.values),
        optionsJson: typeof values.optionsJson === "string" ? values.optionsJson.trim() : null,
        propsJson: typeof values.propsJson === "string" ? values.propsJson.trim() : null,
      };
      if (itemModalMode === "create") {
        return request("/api/system/config/items", { method: "POST", body: payload });
      }
      if (!editingItem) throw new Error("配置项不存在");
      return request(`/api/system/config/items/${editingItem.id}`, {
        method: "PUT",
        body: payload,
      });
    },
    onSuccess: () => {
      feedback.success(itemModalMode === "create" ? "创建成功" : "更新成功");
      setItemModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["system-config-items", activeGroupId] });
      void queryClient.invalidateQueries({ queryKey: ["system-settings", "config"] });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) =>
      request(`/api/system/config/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => {
      feedback.success("删除成功");
      void queryClient.invalidateQueries({ queryKey: ["system-config-items", activeGroupId] });
      void queryClient.invalidateQueries({ queryKey: ["system-settings", "config"] });
    },
  });

  const saveValuesMutation = useMutation({
    mutationFn: () => {
      const values = form.getFieldsValue();
      const payload = Object.fromEntries(
        items.map((item) => [item.key, stringifyConfigValue(item, values[`item_${item.id}`])]),
      );
      return request("/api/system/config/items/save", {
        method: "PUT",
        body: payload,
      });
    },
    onSuccess: () => {
      feedback.success("保存成功");
      void queryClient.invalidateQueries({ queryKey: ["system-config-items", activeGroupId] });
      void queryClient.invalidateQueries({ queryKey: ["system-settings", "config"] });
    },
  });

  const groupColumns: AdminDataTableColumn<ConfigGroupRecord>[] = [
    { title: "分组名称", dataIndex: "name", required: true },
    { title: "分组编码", dataIndex: "code", required: true },
    { title: "排序", dataIndex: "sort", valueType: "digit" },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      required: true,
    },
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
      formHelp: configTypeHelp,
    },
    { title: "排序", dataIndex: "sort", valueType: "digit" },
    { title: "说明", dataIndex: "describe", valueType: "textarea", fullWidth: true },
    {
      title: "选项 JSON",
      dataIndex: "optionsJson",
      fullWidth: true,
      formHelp: optionJsonHelp,
      renderFormField: ({ form }) => <ConfigOptionsJsonField form={form} />,
    },
    {
      title: "属性 JSON",
      dataIndex: "propsJson",
      fullWidth: true,
      formHelp: propsJsonHelp,
      renderFormField: ({ form }) => <ConfigPropsJsonField form={form} />,
    },
    {
      title: "默认值",
      dataIndex: "values",
      fullWidth: true,
      formHelp: defaultValueHelp,
      renderFormField: ({ form }) => <ConfigDefaultValueField form={form} />,
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      required: true,
    },
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
    await saveGroupMutation.mutateAsync(values);
  }

  async function deleteGroup(groupId: number) {
    await deleteGroupMutation.mutateAsync(groupId);
  }

  function openCreateItem() {
    if (!activeGroupId) {
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

  function validateItemFormValues(values: Record<string, unknown>) {
    const type = String(values.type || "text");
    const optionsJson = typeof values.optionsJson === "string" ? values.optionsJson.trim() : "";
    const propsJson = typeof values.propsJson === "string" ? values.propsJson.trim() : "";

    if (optionsJson) {
      try {
        const parsed = JSON.parse(optionsJson) as unknown;
        if (!Array.isArray(parsed)) {
          feedback.error("选项 JSON 必须是数组");
          return false;
        }
        if (!parsed.every(isConfigOption)) {
          feedback.error("选项 JSON 每一项都需要包含 label 和 value");
          return false;
        }
      } catch {
        feedback.error("选项 JSON 不是合法 JSON");
        return false;
      }
    }

    if ((type === "select" || type === "checkbox") && !parseConfigOptions(optionsJson).length) {
      feedback.error("下拉选择或多选框需要先填写选项 JSON");
      return false;
    }

    if (propsJson) {
      try {
        const parsed = JSON.parse(propsJson) as unknown;
        if (!isPlainObject(parsed)) {
          feedback.error("属性 JSON 必须是对象");
          return false;
        }
      } catch {
        feedback.error("属性 JSON 不是合法 JSON");
        return false;
      }
    }

    if (type === "checkbox" && values.values != null && !Array.isArray(values.values)) {
      const defaultValue = typeof values.values === "string" ? values.values.trim() : "";
      if (defaultValue) {
        try {
          const parsed = JSON.parse(defaultValue) as unknown;
          if (!Array.isArray(parsed)) {
            feedback.error("多选框默认值必须是数组");
            return false;
          }
        } catch {
          feedback.error("多选框默认值不是合法 JSON 数组");
          return false;
        }
      }
    }

    return true;
  }

  async function saveItem(values: Record<string, unknown>) {
    if (!activeGroupId) return;
    if (!validateItemFormValues(values)) return;
    await saveItemMutation.mutateAsync(values);
  }

  async function deleteItem(itemId: number) {
    await deleteItemMutation.mutateAsync(itemId);
  }

  async function saveValues() {
    await saveValuesMutation.mutateAsync();
  }

  function renderConfigControl(item: ConfigItemRecord) {
    const options = parseConfigOptions(item.optionsJson);
    const fieldProps = getSafeFieldProps(item.propsJson);
    const inputPlaceholder = item.describe || "请输入";
    const selectPlaceholder = item.describe || "请选择";
    if (item.type === "textarea")
      return <Input.TextArea rows={4} placeholder={inputPlaceholder} {...fieldProps} />;
    if (item.type === "digit") {
      return (
        <InputNumber style={{ width: "100%" }} placeholder={inputPlaceholder} {...fieldProps} />
      );
    }
    if (item.type === "switch") return <Switch {...fieldProps} />;
    if (item.type === "checkbox") return <Checkbox.Group {...fieldProps} options={options} />;
    if (item.type === "select") {
      return (
        <Select allowClear placeholder={selectPlaceholder} {...fieldProps} options={options} />
      );
    }
    if (item.type === "image") {
      return (
        <AdminFieldRenderer
          valueType="image"
          fieldProps={{ placeholder: item.describe || "请选择或上传图片", ...fieldProps }}
        />
      );
    }
    return <Input allowClear placeholder={inputPlaceholder} {...fieldProps} />;
  }

  return (
    <PageScaffold
      title="系统配置"
      description="管理系统配置分组与配置项，保存后用于后台基础能力读取"
    >
      <Row className="system-workbench system-config-workbench" gutter={[16, 16]}>
        <Col xs={24} lg={5} xl={4}>
          <Card
            className="system-side-card system-workbench-panel"
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
            loading={groupsQuery.isLoading}
          >
            <div className="system-panel-summary">
              <span>配置分组</span>
              <strong>{groups.length}</strong>
            </div>
            <Menu
              mode="inline"
              selectedKeys={activeGroupId ? [String(activeGroupId)] : []}
              items={groups.map((group) => ({
                key: String(group.id),
                label: (
                  <div className="system-menu-row">
                    <span>{group.name}</span>
                    <Space size={2}>
                      <Button
                        aria-label="编辑"
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
                          aria-label="删除"
                          danger
                          type="text"
                          size="small"
                          loading={deleteGroupMutation.isPending}
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
            className="system-side-card system-workbench-panel"
            title={
              <div className="system-panel-title">
                <span>{selectedGroup ? selectedGroup.name : "配置项"}</span>
                {selectedGroup ? <Tag color="blue">{selectedGroup.code}</Tag> : null}
              </div>
            }
            extra={
              activeGroupId ? (
                <Space wrap>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={saveValuesMutation.isPending}
                    disabled={!items.length}
                    onClick={() => void saveValues()}
                  >
                    保存配置
                  </Button>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreateItem}>
                    新增配置项
                  </Button>
                </Space>
              ) : null
            }
          >
            {!activeGroupId ? (
              <div className="system-empty-tip">请选择左侧配置分组</div>
            ) : (
              <Spin spinning={itemsQuery.isLoading || itemsQuery.isFetching}>
                {selectedGroup ? (
                  <div className="system-config-context">
                    <div>
                      <strong>{selectedGroup.name}</strong>
                      <span>配置项用于运行时读取，分组编码为 {selectedGroup.code}</span>
                    </div>
                    {selectedGroup.code === "file" ? (
                      <Tag color="gold">文件策略，不是存储通道</Tag>
                    ) : null}
                  </div>
                ) : null}
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
                                <Button
                                  aria-label="编辑"
                                  type="text"
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => openEditItem(item)}
                                />
                                <Popconfirm
                                  title="确认删除配置项？"
                                  onConfirm={() => void deleteItem(item.id)}
                                >
                                  <Button
                                    aria-label="删除"
                                    danger
                                    type="text"
                                    size="small"
                                    loading={deleteItemMutation.isPending}
                                    icon={<DeleteOutlined />}
                                  />
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
        loading={saveGroupMutation.isPending}
        onCancel={() => setGroupModalOpen(false)}
        onFinish={saveGroup}
      />
      <AdminEntityForm
        open={itemModalOpen}
        mode={itemModalMode}
        title={itemModalMode === "create" ? "新增配置项" : "编辑配置项"}
        columns={itemColumns}
        initialValues={normalizeConfigItemFormValues(
          editingItem ?? { groupId: activeGroupId, type: "text", sort: 0, status: 1 },
        )}
        loading={saveItemMutation.isPending}
        onCancel={() => setItemModalOpen(false)}
        onFinish={saveItem}
      />
    </PageScaffold>
  );
}
