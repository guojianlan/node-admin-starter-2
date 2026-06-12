"use client";

import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Tag, Upload } from "antd";
import type { UploadProps } from "antd";
import { AuthButton } from "@/components/auth-button/AuthButton";
import { AdminDataTable } from "@/components/admin-data-table/AdminDataTable";
import type { AdminDataTableColumn } from "@/components/admin-fields/types";
import { getAuthToken } from "@/lib/auth-token";
import { request } from "@/lib/request";
import { feedback } from "@/ui/feedback/feedback";
import { PageScaffold } from "@/ui/page/PageScaffold";

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
  createdAt: string;
};

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function downloadFile(record: FileRecord) {
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
  const columns: AdminDataTableColumn<FileRecord>[] = [
    { title: "ID", dataIndex: "id", hideInForm: true, hideInSearch: true, width: 72 },
    { title: "文件名", dataIndex: "originalName", hideInForm: true },
    { title: "扩展名", dataIndex: "ext", hideInForm: true, render: (value) => <Tag>{String(value || "-")}</Tag> },
    { title: "MIME", dataIndex: "mime", hideInForm: true, hideInSearch: true },
    {
      title: "大小",
      dataIndex: "size",
      hideInForm: true,
      hideInSearch: true,
      render: (value) => formatSize(Number(value)),
    },
    { title: "路径", dataIndex: "url", hideInForm: true, hideInSearch: true },
    { title: "上传时间", dataIndex: "createdAt", valueType: "dateRange", hideInForm: true },
  ];

  const uploadProps = (reload: () => void): UploadProps => ({
    showUploadList: false,
    customRequest: async (options) => {
      try {
        if (typeof options.file === "string") throw new Error("文件格式不正确");
        const formData = new FormData();
        formData.append("file", options.file);
        await request("/api/system/file/list/upload", {
          method: "POST",
          body: formData,
        });
        feedback.success("上传成功");
        options.onSuccess?.({});
        reload();
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error("上传失败"));
      }
    },
  });

  return (
    <PageScaffold title="文件管理" description="管理本地上传文件">
      <AdminDataTable
        api="/api/system/file/list"
        accessName="system.file"
        rowKey="id"
        columns={columns}
        enableCreate={false}
        enableUpdate={false}
        createTitle="上传文件"
        updateTitle="编辑文件"
        actionBarRender={(reload) => (
          <AuthButton auth="system.file.upload">
            <Upload {...uploadProps(reload)}>
              <Button icon={<UploadOutlined />} type="primary">
                上传文件
              </Button>
            </Upload>
          </AuthButton>
        )}
        operateRender={(record) => (
          <AuthButton auth="system.file.download">
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => void downloadFile(record)}
            />
          </AuthButton>
        )}
      />
    </PageScaffold>
  );
}
