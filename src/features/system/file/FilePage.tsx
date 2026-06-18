"use client";

import {
  AudioOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  ScissorOutlined,
  UndoOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Dropdown,
  Image,
  Input,
  Modal,
  Progress,
  Row,
  Space,
  Table,
  Tag,
  Tooltip,
  Tree,
  TreeSelect,
  Upload,
} from "antd";
import type { TableProps, TreeDataNode, TreeProps, UploadFile } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import { AdminEntityForm } from "@/components/admin-entity-form/AdminEntityForm";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { getAuthToken } from "@/lib/auth-token";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { useNavigationAdapter } from "@/platform/navigation";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";
import { toFieldOptions } from "../shared/options";
import { FileAudioPlayer } from "./FileAudioPlayer";
import { FilePreviewModal, getFilePreviewKind, getFilePreviewLabel } from "./FilePreviewModal";

type FileGroup = {
  id: number;
  parentId: number;
  name: string;
  sort: number;
  describe?: string | null;
  children?: FileGroup[];
};

type FileRecord = {
  id: number;
  groupId?: number | null;
  originalName: string;
  filename: string;
  path: string;
  url: string;
  size: number;
  ext?: string | null;
  mime?: string | null;
  uploaderId?: number | null;
  deletedAt?: string | null;
  createdAt: string;
};

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getFileTypeColor(record: FileRecord) {
  const kind = getFilePreviewKind(record);
  if (kind === "image") return "purple";
  if (kind === "video") return "magenta";
  if (kind === "audio") return "cyan";
  if (kind === "pdf") return "red";
  if (kind === "word") return "blue";
  if (kind === "sheet") return "green";
  if (kind === "office") return "orange";
  if (kind === "text") return "geekblue";
  return "default";
}

function buildGroupTree(nodes: FileGroup[]): TreeDataNode[] {
  return nodes.map((node) => ({
    key: node.id,
    value: node.id,
    title: node.name,
    children: buildGroupTree(node.children ?? []),
  }));
}

function flattenGroups(nodes: FileGroup[]): FileGroup[] {
  return nodes.flatMap((node) => [node, ...flattenGroups(node.children ?? [])]);
}

function buildUrl(pathname: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function readGroupId(search: string) {
  const value = Number(new URLSearchParams(search).get("groupId") || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getAncestorGroupKeys(groups: FileGroup[], groupId: number): React.Key[] {
  const parentMap = new Map(flattenGroups(groups).map((group) => [group.id, group.parentId]));
  const keys: React.Key[] = [];
  let parentId = parentMap.get(groupId);

  while (parentId !== undefined) {
    keys.unshift(parentId);
    if (parentId === 0) break;
    parentId = parentMap.get(parentId);
  }

  return keys;
}

async function downloadFile(record: Pick<FileRecord, "id" | "originalName">) {
  const response = await fetch(`/api/system/file/list/download/${record.id}`, {
    headers: {
      Authorization: `Bearer ${getAuthToken() ?? ""}`,
    },
  });
  if (!response.ok) {
    feedback.error("下载失败");
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = record.originalName;
  link.click();
  URL.revokeObjectURL(url);
}

export function FilePage() {
  const navigation = useNavigationAdapter();
  const [groups, setGroups] = useState<FileGroup[]>([]);
  const [groupKeyword, setGroupKeyword] = useState("");
  const [groupsLoading, setGroupsLoading] = useState(false);
  const selectedGroupId = useMemo(() => readGroupId(navigation.search), [navigation.search]);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<React.Key[]>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupModalMode, setGroupModalMode] = useState<"create" | "update">("create");
  const [groupModalLoading, setGroupModalLoading] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FileGroup | null>(null);
  const [groupInitialValues, setGroupInitialValues] = useState<Partial<FileGroup>>({
    parentId: 0,
    sort: 0,
  });
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renamingFile, setRenamingFile] = useState<FileRecord | null>(null);
  const [newFileName, setNewFileName] = useState("");
  const [targetOpen, setTargetOpen] = useState(false);
  const [targetType, setTargetType] = useState<"copy" | "move">("move");
  const [targetIds, setTargetIds] = useState<number[]>([]);
  const [targetGroupId, setTargetGroupId] = useState<number>(1);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashFiles, setTrashFiles] = useState<FileRecord[]>([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashPagination, setTrashPagination] = useState({ current: 1, pageSize: 10, total: 0 });
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailFile, setDetailFile] = useState<FileRecord | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const [audioFile, setAudioFile] = useState<FileRecord | null>(null);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const rows = await request<FileGroup[]>("/api/system/file/group/tree", { silent: true });
      setGroups(rows);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => loadGroups());
  }, [loadGroups]);

  const groupTreeData = useMemo(() => {
    const filterTree = (nodes: FileGroup[]): FileGroup[] => {
      if (!groupKeyword) return nodes;
      return nodes
        .map((node) => {
          const children = filterTree(node.children ?? []);
          const matched = node.name.includes(groupKeyword);
          return matched || children.length ? { ...node, children } : null;
        })
        .filter(Boolean) as FileGroup[];
    };
    return buildGroupTree(filterTree(groups));
  }, [groupKeyword, groups]);

  const groupOptions = useMemo(() => buildGroupTree(groups), [groups]);
  const groupFieldOptions = useMemo(() => toFieldOptions(groups), [groups]);
  const groupMap = useMemo(
    () => new Map(flattenGroups(groups).map((group) => [group.id, group])),
    [groups],
  );
  const allGroupKeys = useMemo(() => flattenGroups(groups).map((group) => group.id), [groups]);
  const effectiveExpandedGroupKeys = useMemo(() => {
    const ancestorKeys = getAncestorGroupKeys(groups, selectedGroupId);
    if (!expandedGroupKeys.length) return allGroupKeys;
    return Array.from(new Set([...expandedGroupKeys, ...ancestorKeys]));
  }, [allGroupKeys, expandedGroupKeys, groups, selectedGroupId]);
  const loadFileList = useCallback(
    async (params: Record<string, unknown>) => {
      const query = Number(selectedGroupId) > 0 ? { ...params, groupId: selectedGroupId } : params;
      return request<PageResult<FileRecord>>(`/api/system/file/list${buildQueryString(query)}`, {
        silent: true,
      });
    },
    [selectedGroupId],
  );

  function selectGroup(groupId: React.Key) {
    const nextGroupId = Number(groupId || 0);
    const params = new URLSearchParams(navigation.search);
    params.delete("page");
    if (nextGroupId > 0) params.set("groupId", String(nextGroupId));
    else params.delete("groupId");
    setSelectedRowKeys([]);
    navigation.push(buildUrl(navigation.pathname, params));
  }

  const groupColumns: AdminDataTableColumn<FileGroup>[] = [
    {
      title: "父级文件夹",
      dataIndex: "parentId",
      valueType: "treeSelect",
      options: groupFieldOptions,
      required: true,
      fieldProps: { treeDefaultExpandAll: true, disabled: true },
    },
    { title: "文件夹名称", dataIndex: "name", required: true },
    { title: "排序", dataIndex: "sort", valueType: "digit", required: true },
    { title: "描述", dataIndex: "describe", valueType: "textarea", fullWidth: true },
  ];

  const columns: AdminDataTableColumn<FileRecord>[] = [
    {
      title: "文件名",
      dataIndex: "originalName",
      hideInForm: true,
      width: 260,
      ellipsis: true,
      render: (value, record) => (
        <Tooltip title={getFilePreviewKind(record) === "audio" ? "点击播放" : "点击预览"}>
          <a onClick={() => openPreview(record)}>{String(value)}</a>
        </Tooltip>
      ),
    },
    {
      title: "文件大小",
      dataIndex: "size",
      hideInForm: true,
      hideInSearch: true,
      align: "center",
      width: 96,
      sorter: true,
      render: (value) => formatSize(Number(value)),
    },
    {
      title: "文件类型",
      dataIndex: "ext",
      hideInForm: true,
      align: "center",
      width: 96,
      render: (value, record) => {
        return <Tag color={getFileTypeColor(record)}>{String(value || "file")}</Tag>;
      },
    },
    {
      title: "文件分组",
      dataIndex: "groupId",
      hideInForm: true,
      hideInSearch: true,
      align: "center",
      width: 120,
      render: (value) => <Tag>{groupMap.get(Number(value))?.name || "未分组"}</Tag>,
    },
    {
      title: "预览",
      dataIndex: "url",
      hideInForm: true,
      hideInSearch: true,
      align: "center",
      width: 92,
      render: (url, record) =>
        record.mime?.startsWith("image/") ? (
          <button
            type="button"
            className="system-file-thumb-button"
            aria-label={`预览 ${record.originalName}`}
            onClick={() => openPreview(record)}
          >
            <Image
              src={String(url)}
              alt={record.originalName}
              width={36}
              height={36}
              preview={false}
              className="system-file-thumb"
            />
          </button>
        ) : (
          <Tooltip title={getFilePreviewLabel(record)}>
            <Button
              size="small"
              icon={getFilePreviewKind(record) === "audio" ? <AudioOutlined /> : <EyeOutlined />}
              onClick={() => openPreview(record)}
            />
          </Tooltip>
        ),
    },
    {
      title: "上传时间",
      dataIndex: "createdAt",
      valueType: "dateRange",
      hideInForm: true,
      align: "center",
      width: 180,
    },
  ];

  const trashColumns: TableProps<FileRecord>["columns"] = [
    { title: "文件名", dataIndex: "originalName", ellipsis: true, width: 180 },
    {
      title: "文件大小",
      dataIndex: "size",
      width: 90,
      align: "center",
      render: (value) => formatSize(Number(value)),
    },
    {
      title: "类型",
      dataIndex: "ext",
      width: 80,
      align: "center",
      render: (value) => <Tag>{String(value || "file")}</Tag>,
    },
    { title: "删除时间", dataIndex: "deletedAt", width: 170, align: "center" },
    {
      title: "操作",
      key: "operate",
      width: 110,
      align: "center",
      render: (_, record) => (
        <Space>
          <Tooltip title="恢复">
            <Button
              size="small"
              icon={<UndoOutlined />}
              onClick={() => void restoreFile(record.id)}
            />
          </Tooltip>
          <Tooltip title="彻底删除">
            <Button
              danger
              type="primary"
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => void forceDeleteFile(record.id)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  function openDetail(file: FileRecord) {
    setDetailFile(file);
    setDetailOpen(true);
  }

  function openPreview(file: FileRecord) {
    if (getFilePreviewKind(file) === "audio") {
      setAudioFile(file);
      setPreviewOpen(false);
      setPreviewFile(null);
      return;
    }
    setPreviewFile(file);
    setPreviewOpen(true);
  }

  function openRename(file: FileRecord) {
    setRenamingFile(file);
    setNewFileName(file.originalName);
    setRenameOpen(true);
  }

  function openTarget(ids: number[], type: "copy" | "move") {
    setTargetIds(ids);
    setTargetType(type);
    setTargetGroupId(Number(selectedGroupId) || 1);
    setTargetOpen(true);
  }

  function openCreateGroup(parentId = 0) {
    setEditingGroup(null);
    setGroupModalMode("create");
    setGroupInitialValues({ parentId, sort: 0 });
    setGroupModalOpen(true);
  }

  function openEditGroup(group: FileGroup) {
    if (group.id === 0) return;
    setEditingGroup(group);
    setGroupModalMode("update");
    setGroupInitialValues(group);
    setGroupModalOpen(true);
  }

  function touchReload() {
    setSelectedRowKeys([]);
    setReloadKey((value) => value + 1);
  }

  async function uploadSelectedFiles() {
    if (!uploadFiles.length) {
      feedback.warning("请选择文件");
      return;
    }
    setUploading(true);
    try {
      for (const [index, item] of uploadFiles.entries()) {
        if (!item.originFileObj) continue;
        const formData = new FormData();
        formData.append("file", item.originFileObj);
        formData.append("groupId", String(Number(selectedGroupId) || 1));
        await request("/api/system/file/list/upload", { method: "POST", body: formData });
        setUploadProgress(Math.round(((index + 1) / uploadFiles.length) * 100));
      }
      feedback.success("上传成功");
      setUploadOpen(false);
      setUploadFiles([]);
      setUploadProgress(0);
      touchReload();
    } finally {
      setUploading(false);
    }
  }

  async function saveGroup(values: Record<string, unknown>) {
    setGroupModalLoading(true);
    try {
      if (groupModalMode === "create") {
        await request("/api/system/file/group", { method: "POST", body: values });
        feedback.success("创建成功");
      } else if (editingGroup) {
        await request(`/api/system/file/group/${editingGroup.id}`, { method: "PUT", body: values });
        feedback.success("更新成功");
      }
      setGroupModalOpen(false);
      await loadGroups();
    } finally {
      setGroupModalLoading(false);
    }
  }

  async function deleteGroup(groupId: number) {
    if (groupId === 0 || !window.confirm("确认删除当前文件夹？请先删除文件夹下的文件和子文件夹。"))
      return;
    await request(`/api/system/file/group/${groupId}`, { method: "DELETE" });
    feedback.success("删除成功");
    if (selectedGroupId === groupId) selectGroup(0);
    await loadGroups();
    touchReload();
  }

  async function deleteFile(id: number) {
    if (!window.confirm("确认删除当前文件？")) return;
    await request(`/api/system/file/list/${id}`, { method: "DELETE" });
    feedback.success("删除成功");
    touchReload();
  }

  async function batchDelete() {
    if (!selectedRowKeys.length) {
      feedback.warning("请选择文件");
      return;
    }
    await request("/api/system/file/list/batch-delete", {
      method: "POST",
      body: { ids: selectedRowKeys.map(Number) },
    });
    feedback.success("删除成功");
    touchReload();
  }

  async function renameFile() {
    if (!renamingFile || !newFileName.trim()) return;
    await request(`/api/system/file/list/rename/${renamingFile.id}`, {
      method: "PUT",
      body: { originalName: newFileName.trim() },
    });
    feedback.success("重命名成功");
    setRenameOpen(false);
    touchReload();
  }

  async function submitTarget() {
    if (!targetIds.length) return;
    await request(
      targetType === "copy" ? "/api/system/file/list/copy" : "/api/system/file/list/move",
      {
        method: targetType === "copy" ? "POST" : "PUT",
        body: { ids: targetIds, groupId: targetGroupId },
      },
    );
    feedback.success(targetType === "copy" ? "复制成功" : "移动成功");
    setTargetOpen(false);
    touchReload();
  }

  async function loadTrash(page = trashPagination.current, pageSize = trashPagination.pageSize) {
    setTrashLoading(true);
    try {
      const result = await request<PageResult<FileRecord>>(
        `/api/system/file/list/trash${buildQueryString({ page, pageSize })}`,
        { silent: true },
      );
      setTrashFiles(result.data);
      setTrashPagination({ current: page, pageSize, total: result.total });
    } finally {
      setTrashLoading(false);
    }
  }

  async function restoreFile(id: number) {
    await request(`/api/system/file/list/restore/${id}`, { method: "PUT" });
    feedback.success("恢复成功");
    await loadTrash();
    touchReload();
  }

  async function forceDeleteFile(id: number) {
    await request(`/api/system/file/list/force/${id}`, { method: "DELETE" });
    feedback.success("彻底删除成功");
    await loadTrash();
  }

  async function cleanTrash() {
    const result = await request<{ count: number }>("/api/system/file/list/clean-trash", {
      method: "DELETE",
    });
    feedback.success(`已清空 ${result.count} 个文件`);
    await loadTrash();
  }

  const treeTitleRender: TreeProps["titleRender"] = (node) => (
    <div className="system-file-tree-title">
      <Space>
        <FolderOpenOutlined className="system-file-folder-icon" />
        {String(node.title)}
      </Space>
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            {
              key: "add",
              icon: <PlusOutlined />,
              label: "新增子文件夹",
              onClick: () => openCreateGroup(Number(node.key)),
            },
            {
              key: "edit",
              icon: <EditOutlined />,
              label: "编辑文件夹",
              disabled: Number(node.key) === 0,
              onClick: () => {
                const group = groupMap.get(Number(node.key));
                if (group) openEditGroup(group);
              },
            },
            { type: "divider" },
            {
              key: "delete",
              danger: true,
              icon: <DeleteOutlined />,
              label: "删除文件夹",
              disabled: Number(node.key) === 0,
              onClick: () => void deleteGroup(Number(node.key)),
            },
          ],
        }}
      >
        <Button
          aria-label="文件夹操作"
          type="text"
          size="small"
          icon={<MoreOutlined />}
          onClick={(event) => event.stopPropagation()}
        />
      </Dropdown>
    </div>
  );

  return (
    <PageScaffold
      title="文件管理"
      description="管理本地上传文件，按文件分组查看、上传、移动与回收站处理"
    >
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={4}>
          <Card
            className="system-side-card"
            title={
              <Space>
                <FolderOpenOutlined className="system-file-folder-icon" />
                文件夹
              </Space>
            }
            loading={groupsLoading}
          >
            <Input.Search
              allowClear
              placeholder="搜索文件夹"
              className="system-folder-search"
              onSearch={setGroupKeyword}
              onChange={(event) => {
                if (!event.target.value) setGroupKeyword("");
              }}
            />
            <Tree
              showLine
              selectedKeys={[selectedGroupId]}
              expandedKeys={effectiveExpandedGroupKeys}
              autoExpandParent={false}
              treeData={groupTreeData}
              titleRender={treeTitleRender}
              onExpand={(keys) => setExpandedGroupKeys([...keys])}
              onSelect={(keys) => {
                selectGroup(keys[0] ?? 0);
              }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={20}>
          <AdminDataTable
            key={reloadKey}
            api="/api/system/file/list"
            accessName="system.file"
            rowKey="id"
            columns={columns}
            cardClassName="system-file-table-card"
            enableCreate={false}
            enableUpdate={false}
            enableDelete={false}
            showSearchForm={false}
            showKeywordSearch={false}
            showToolbarSettings={false}
            createTitle="上传文件"
            updateTitle="编辑文件"
            tableProps={{
              size: "small",
              bordered: true,
              rowSelection: {
                selectedRowKeys,
                onChange: setSelectedRowKeys,
              },
            }}
            actionBarRender={(reload) => (
              <>
                <AuthButton auth="system.file.upload">
                  <Button
                    type="primary"
                    icon={<UploadOutlined />}
                    onClick={() => setUploadOpen(true)}
                  >
                    上传文件
                  </Button>
                </AuthButton>
                {selectedRowKeys.length > 0 ? (
                  <>
                    <Button danger icon={<DeleteOutlined />} onClick={() => void batchDelete()}>
                      批量删除
                    </Button>
                    <Button
                      icon={<ScissorOutlined />}
                      onClick={() => openTarget(selectedRowKeys.map(Number), "move")}
                    >
                      批量移动
                    </Button>
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => openTarget(selectedRowKeys.map(Number), "copy")}
                    >
                      批量复制
                    </Button>
                  </>
                ) : null}
                <Button
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    setTrashOpen(true);
                    void loadTrash(1, trashPagination.pageSize);
                  }}
                >
                  回收站
                </Button>
                <Tooltip title="刷新">
                  <Button icon={<ReloadOutlined />} onClick={reload} />
                </Tooltip>
              </>
            )}
            operateRender={(record) => (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "preview",
                      icon:
                        getFilePreviewKind(record) === "audio" ? (
                          <AudioOutlined />
                        ) : (
                          <EyeOutlined />
                        ),
                      label: getFilePreviewKind(record) === "audio" ? "播放" : "预览",
                      onClick: () => openPreview(record),
                    },
                    {
                      key: "detail",
                      icon: <InfoCircleOutlined />,
                      label: "详情",
                      onClick: () => openDetail(record),
                    },
                    { type: "divider" },
                    {
                      key: "download",
                      icon: <DownloadOutlined />,
                      label: "下载",
                      onClick: () => void downloadFile(record),
                    },
                    {
                      key: "rename",
                      icon: <EditOutlined />,
                      label: "重命名",
                      onClick: () => openRename(record),
                    },
                    {
                      key: "move",
                      icon: <ScissorOutlined />,
                      label: "移动",
                      onClick: () => openTarget([record.id], "move"),
                    },
                    {
                      key: "copy",
                      icon: <CopyOutlined />,
                      label: "复制",
                      onClick: () => openTarget([record.id], "copy"),
                    },
                    { type: "divider" },
                    {
                      key: "delete",
                      danger: true,
                      icon: <DeleteOutlined />,
                      label: "删除",
                      onClick: () => void deleteFile(record.id),
                    },
                  ],
                }}
              >
                <Button size="small" icon={<MoreOutlined />} />
              </Dropdown>
            )}
            handleRequest={loadFileList}
          />
        </Col>
      </Row>
      <Modal
        title="上传文件"
        open={uploadOpen}
        onOk={() => void uploadSelectedFiles()}
        onCancel={() => {
          setUploadOpen(false);
          setUploadFiles([]);
          setUploadProgress(0);
        }}
        confirmLoading={uploading}
      >
        <Upload.Dragger
          multiple
          beforeUpload={() => false}
          fileList={uploadFiles}
          onChange={({ fileList }) => setUploadFiles(fileList)}
        >
          <p className="ant-upload-drag-icon">
            <CloudUploadOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
          <p className="ant-upload-hint">文件会上传到当前选中的文件分组</p>
        </Upload.Dragger>
        {uploading ? (
          <Progress className="system-upload-progress" percent={uploadProgress} status="active" />
        ) : null}
      </Modal>
      <Modal
        title="重命名文件"
        open={renameOpen}
        onOk={() => void renameFile()}
        onCancel={() => setRenameOpen(false)}
      >
        <div className="system-modal-copy">请输入新的文件名称。</div>
        <Input
          value={newFileName}
          onChange={(event) => setNewFileName(event.target.value)}
          placeholder="文件名称"
        />
      </Modal>
      <Modal
        title={targetType === "copy" ? "复制文件" : "移动文件"}
        open={targetOpen}
        onOk={() => void submitTarget()}
        onCancel={() => setTargetOpen(false)}
      >
        <div className="system-modal-copy">请选择目标文件夹。</div>
        <TreeSelect
          value={targetGroupId}
          treeData={groupOptions}
          treeDefaultExpandAll
          style={{ width: "100%" }}
          onChange={(value) => setTargetGroupId(Number(value))}
        />
      </Modal>
      <Drawer
        title="回收站"
        open={trashOpen}
        size="large"
        onClose={() => {
          setTrashOpen(false);
          setSelectedRowKeys([]);
          touchReload();
        }}
      >
        <Space className="system-trash-toolbar">
          <Button danger type="primary" icon={<DeleteOutlined />} onClick={() => void cleanTrash()}>
            清空回收站
          </Button>
        </Space>
        <Table<FileRecord>
          rowKey="id"
          size="small"
          bordered
          loading={trashLoading}
          columns={trashColumns}
          dataSource={trashFiles}
          pagination={{
            ...trashPagination,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) => void loadTrash(page, pageSize),
          }}
          scroll={{ x: 760 }}
        />
      </Drawer>
      <Drawer title="文件详情" open={detailOpen} onClose={() => setDetailOpen(false)}>
        {detailFile ? (
          <>
            <Space className="system-file-detail-actions">
              <Button type="primary" icon={<EyeOutlined />} onClick={() => openPreview(detailFile)}>
                预览文件
              </Button>
              <Button icon={<DownloadOutlined />} onClick={() => void downloadFile(detailFile)}>
                下载文件
              </Button>
            </Space>
            {detailFile.mime?.startsWith("image/") ? (
              <div className="system-file-preview">
                <Image src={detailFile.url} alt={detailFile.originalName} preview={false} />
              </div>
            ) : null}
            <Descriptions
              column={1}
              title="基本信息"
              items={[
                { key: "name", label: "文件名", children: detailFile.originalName },
                { key: "size", label: "文件大小", children: formatSize(detailFile.size) },
                { key: "ext", label: "扩展名", children: detailFile.ext || "-" },
                { key: "mime", label: "MIME", children: detailFile.mime || "-" },
                {
                  key: "group",
                  label: "文件分组",
                  children: groupMap.get(Number(detailFile.groupId))?.name || "未分组",
                },
                { key: "path", label: "文件路径", children: detailFile.path },
                {
                  key: "url",
                  label: "访问地址",
                  children: <TypographyLink value={detailFile.url} />,
                },
                { key: "createdAt", label: "上传时间", children: detailFile.createdAt },
              ]}
            />
          </>
        ) : null}
      </Drawer>
      <FilePreviewModal
        file={previewFile}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onDownload={(file) => void downloadFile(file)}
      />
      <FileAudioPlayer
        file={audioFile}
        onClose={() => setAudioFile(null)}
        onDownload={(file) => void downloadFile(file)}
      />
      <AdminEntityForm
        open={groupModalOpen}
        mode={groupModalMode}
        title={groupModalMode === "create" ? "新增文件夹" : "编辑文件夹"}
        columns={groupColumns}
        initialValues={groupInitialValues}
        loading={groupModalLoading}
        onCancel={() => setGroupModalOpen(false)}
        onFinish={saveGroup}
      />
    </PageScaffold>
  );
}

function TypographyLink({ value }: { value: string }) {
  return (
    <a href={value} target="_blank" rel="noreferrer">
      {value}
    </a>
  );
}
