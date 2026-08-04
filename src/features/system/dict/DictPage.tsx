"use client";

import { ReloadOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Badge, Button, Tag, Tooltip } from "antd";
import { useMemo } from "react";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { useNavigationAdapter } from "@/platform/navigation";
import { useDictStore } from "@/stores/dict";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { statusOptions } from "../shared/options";
import { DictItemTable, type DictSummary } from "./DictItemTable";

type DictRecord = {
  id: number;
  name: string;
  code: string;
  remark?: string | null;
  status: number;
  sort: number;
  createdAt: string;
};

const dictNameHelp = (
  <div className="admin-json-help-content">
    <div>字典分类的中文名称，用来给管理员识别这一组枚举。</div>
    <div>例如：状态、性别、菜单类型。</div>
  </div>
);

const dictCodeHelp = (
  <div className="admin-json-help-content">
    <div>字典的唯一编码，前端和接口会通过它读取字典项。</div>
    <div>创建后不建议随意修改，否则已有页面的下拉框可能读不到数据。</div>
    <pre>{`status -> 状态
sex -> 性别
rule_type -> 菜单类型`}</pre>
  </div>
);

const dictStatusHelp = (
  <div className="admin-json-help-content">
    <div>只有启用的字典会进入字典缓存。</div>
    <div>停用后，该字典下的字典项不会再作为前端可选项返回。</div>
  </div>
);

const dictSortHelp = (
  <div className="admin-json-help-content">
    <div>控制字典列表展示顺序，数字越小越靠前。</div>
  </div>
);

const dictRemarkHelp = (
  <div className="admin-json-help-content">
    <div>给管理员看的维护说明，不参与业务判断。</div>
    <div>可以说明这个字典被哪些页面或字段使用。</div>
  </div>
);

export function DictPage() {
  const navigation = useNavigationAdapter();
  const reloadDicts = useDictStore((state) => state.reloadDicts);
  const selectedDict = useMemo<DictSummary | null>(() => {
    const params = new URLSearchParams(navigation.search);
    const id = Number(params.get("dictId") || 0);
    if (!id) return null;
    return {
      id,
      name: params.get("dictName") ? decodeURIComponent(params.get("dictName") || "") : "当前字典",
      code: params.get("dictCode") || "",
    };
  }, [navigation.search]);

  function selectDict(record: DictRecord) {
    const dict = { id: record.id, name: record.name, code: record.code };
    const params = new URLSearchParams(navigation.search);
    params.set("dictId", String(dict.id));
    params.set("dictName", dict.name);
    params.set("dictCode", dict.code);
    navigation.push(`${navigation.pathname}?${params.toString()}`);
  }

  const columns: AdminDataTableColumn<DictRecord>[] = [
    {
      title: "字典ID",
      dataIndex: "id",
      valueType: "digit",
      hideInForm: true,
      width: 90,
      sorter: true,
      align: "center",
      fixed: "left",
    },
    {
      title: "字典名称",
      dataIndex: "name",
      required: true,
      width: 160,
      fixed: "left",
      formHelp: dictNameHelp,
      fieldProps: { placeholder: "例如：状态" },
    },
    {
      title: "字典编码",
      dataIndex: "code",
      required: true,
      formHelp: dictCodeHelp,
      fieldProps: { placeholder: "例如：status" },
    },
    {
      title: "状态",
      dataIndex: "status",
      valueType: "select",
      options: statusOptions,
      hideInTable: true,
      align: "center",
      formHelp: dictStatusHelp,
      render: (value) =>
        Number(value) === 1 ? (
          <Badge status="success" text="启用" />
        ) : (
          <Badge status="error" text="停用" />
        ),
    },
    {
      title: "排序",
      dataIndex: "sort",
      valueType: "digit",
      hideInSearch: true,
      hideInTable: true,
      align: "center",
      formHelp: dictSortHelp,
      fieldProps: { min: 0, precision: 0, placeholder: "数字越小越靠前" },
      render: (value) => <Tag color="purple">{String(value)}</Tag>,
    },
    {
      title: "描述",
      dataIndex: "remark",
      valueType: "textarea",
      fullWidth: true,
      hideInSearch: true,
      ellipsis: true,
      formHelp: dictRemarkHelp,
      fieldProps: { placeholder: "例如：用于用户、角色等页面的启用状态选项" },
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      hideInForm: true,
      hideInSearch: true,
      hideInTable: true,
      width: 180,
    },
  ];

  async function refreshCache() {
    await reloadDicts();
    feedback.success("字典缓存已刷新");
  }

  return (
    <PageScaffold
      title="字典管理"
      description="维护通用字典类型，并进入字典项页面管理枚举数据"
      hideHeader
    >
      <div className="system-dict-workbench">
        <div className="system-dict-primary">
          <AdminDataTable
            api="/api/system/dict/list"
            accessName="system.dict"
            rowKey="id"
            columns={columns}
            searchPlacement="card"
            searchCardClassName="system-dict-search-card"
            showSearchButton
            defaultSearchOpen={false}
            cardClassName="system-dict-master-card"
            createTitle="新增字典"
            updateTitle="编辑字典"
            tableMode="bounded"
            actionBarRender={() => (
              <Button
                className="system-dict-cache-button"
                type="primary"
                icon={<ReloadOutlined />}
                onClick={() => void refreshCache()}
              >
                刷新字典缓存
              </Button>
            )}
            operateRender={(record) => (
              <Tooltip title="管理字典项">
                <Button
                  size="small"
                  aria-label="管理字典项"
                  icon={<UnorderedListOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectDict(record);
                  }}
                />
              </Tooltip>
            )}
            tableProps={{
              size: "small",
              bordered: true,
              rowSelection: {
                type: "radio",
                selectedRowKeys: selectedDict ? [selectedDict.id] : [],
                onChange: (_, rows) => {
                  if (rows[0]) selectDict(rows[0]);
                },
              },
              onRow: (record) => ({
                onClick: () => selectDict(record),
              }),
            }}
          />
        </div>
        <div className="system-dict-secondary">
          {selectedDict ? (
            <DictItemTable dict={selectedDict} urlStatePrefix="item" />
          ) : (
            <div className="admin-card system-empty-tip system-dict-empty-card">
              请选择左侧字典后管理字典项
            </div>
          )}
        </div>
      </div>
    </PageScaffold>
  );
}
