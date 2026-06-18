"use client";

import {
  DeleteOutlined,
  FolderOpenOutlined,
  PictureOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { Button, Empty, Image, Input, Modal, Space, Spin, Typography, Upload } from "antd";
import type { UploadProps } from "antd";
import { useState } from "react";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { feedback } from "@/ui/feedback/feedback";

type ImageFileRecord = {
  id: number;
  originalName: string;
  url: string;
  ext?: string | null;
  mime?: string | null;
};

type UploadResult = {
  id: number;
  url: string;
};

type AdminImageFieldProps = {
  value?: string;
  onChange?: (value?: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "svg"]);

function isImageFile(file: ImageFileRecord) {
  const ext = (file.ext || file.originalName.split(".").pop() || "").toLowerCase();
  return file.mime?.startsWith("image/") || IMAGE_EXTENSIONS.has(ext);
}

export function AdminImageField({
  value,
  onChange,
  disabled,
  placeholder = "请输入图片 URL，或上传/选择图片",
}: AdminImageFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [images, setImages] = useState<ImageFileRecord[]>([]);

  async function loadImages(nextKeyword = keyword) {
    setPickerLoading(true);
    try {
      const result = await request<PageResult<ImageFileRecord>>(
        `/api/system/file/list${buildQueryString({
          page: 1,
          pageSize: 80,
          keyword: nextKeyword,
        })}`,
        { silent: true },
      );
      setImages(result.data.filter(isImageFile));
    } finally {
      setPickerLoading(false);
    }
  }

  function openPicker() {
    setPickerOpen(true);
    void loadImages(keyword);
  }

  const uploadProps: UploadProps = {
    accept: "image/*",
    disabled,
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      if (!file.type.startsWith("image/")) {
        feedback.warning("请选择图片文件");
        return Upload.LIST_IGNORE;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("groupId", "1");
        const result = await request<UploadResult>("/api/system/file/list/upload", {
          method: "POST",
          body: formData,
        });
        onChange?.(result.url);
        feedback.success("图片上传成功");
      } finally {
        setUploading(false);
      }

      return Upload.LIST_IGNORE;
    },
  };

  return (
    <div className="admin-image-field">
      {value ? (
        <div className="admin-image-preview">
          <Image
            src={value}
            alt="配置图片"
            width={88}
            height={88}
            preview
            className="admin-image-preview-img"
          />
          <div className="admin-image-preview-meta">
            <Typography.Text ellipsis>{value}</Typography.Text>
            <Button
              aria-label="清空图片"
              disabled={disabled}
              danger
              type="text"
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => onChange?.(undefined)}
            />
          </div>
        </div>
      ) : null}
      <Input
        allowClear
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange?.(event.target.value || undefined)}
      />
      <Space wrap className="admin-image-actions">
        <Upload {...uploadProps}>
          <Button disabled={disabled} loading={uploading} icon={<UploadOutlined />}>
            上传图片
          </Button>
        </Upload>
        <Button disabled={disabled} icon={<FolderOpenOutlined />} onClick={openPicker}>
          选择已有
        </Button>
      </Space>
      <Modal
        title="选择已有图片"
        open={pickerOpen}
        width={760}
        footer={null}
        destroyOnHidden
        onCancel={() => setPickerOpen(false)}
      >
        <Input.Search
          allowClear
          placeholder="搜索图片文件名"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={(nextKeyword) => void loadImages(nextKeyword)}
        />
        <Spin spinning={pickerLoading}>
          {images.length ? (
            <div className="admin-image-picker-grid">
              {images.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  className="admin-image-picker-item"
                  onClick={() => {
                    onChange?.(image.url);
                    setPickerOpen(false);
                  }}
                >
                  <Image
                    src={image.url}
                    alt={image.originalName}
                    width={96}
                    height={72}
                    preview={false}
                  />
                  <Typography.Text ellipsis>{image.originalName}</Typography.Text>
                </button>
              ))}
            </div>
          ) : (
            <Empty
              className="admin-image-picker-empty"
              image={<PictureOutlined />}
              description="暂无图片文件"
            />
          )}
        </Spin>
      </Modal>
    </div>
  );
}
