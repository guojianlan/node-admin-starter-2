"use client";

import {
  AudioOutlined,
  DownloadOutlined,
  ExportOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileUnknownOutlined,
  FileWordOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Image,
  Modal,
  Spin,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableProps } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

export type PreviewFileRecord = {
  id: number;
  originalName: string;
  url: string;
  size: number;
  ext?: string | null;
  mime?: string | null;
  createdAt?: string;
};

export type FilePreviewKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "word"
  | "sheet"
  | "text"
  | "office"
  | "unknown";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "svg"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "ogg", "ogv", "mov", "m4v"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac"]);
const WORD_EXTENSIONS = new Set(["docx"]);
const SHEET_EXTENSIONS = new Set(["xls", "xlsx", "csv"]);
const OFFICE_FALLBACK_EXTENSIONS = new Set(["doc", "ppt", "pptx"]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "log",
  "json",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "sql",
  "yml",
  "yaml",
  "ini",
  "conf",
]);

const MAX_TEXT_PREVIEW_LENGTH = 250000;

type SheetRow = {
  key: string;
} & Record<string, string | number | boolean | null>;

type SheetPreviewState = {
  sheetName: string;
  columns: TableProps<SheetRow>["columns"];
  rows: SheetRow[];
  truncated: boolean;
};

function normalizeExt(file: PreviewFileRecord) {
  const raw = file.ext || file.originalName.split(".").pop() || "";
  return raw.replace(/^\./, "").toLowerCase();
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getFileUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}

function buildOfficeViewerUrl(url: string) {
  if (typeof window === "undefined") return null;

  try {
    const absoluteUrl = new URL(getFileUrl(url));
    const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
    if (localHosts.has(absoluteUrl.hostname) || absoluteUrl.hostname.endsWith(".local"))
      return null;
    if (!["http:", "https:"].includes(absoluteUrl.protocol)) return null;
    return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteUrl.toString())}`;
  } catch {
    return null;
  }
}

function columnName(index: number) {
  let value = "";
  let next = index + 1;
  while (next > 0) {
    const mod = (next - 1) % 26;
    value = String.fromCharCode(65 + mod) + value;
    next = Math.floor((next - mod) / 26);
  }
  return value;
}

export function getFilePreviewKind(file: PreviewFileRecord): FilePreviewKind {
  const ext = normalizeExt(file);
  const mime = file.mime || "";

  if (mime.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) return "image";
  if (mime.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) return "video";
  if (mime.startsWith("audio/") || AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (WORD_EXTENSIONS.has(ext)) return "word";
  if (SHEET_EXTENSIONS.has(ext)) return "sheet";
  if (OFFICE_FALLBACK_EXTENSIONS.has(ext)) return "office";
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.has(ext)) return "text";

  return "unknown";
}

export function getFilePreviewLabel(file: PreviewFileRecord) {
  const kind = getFilePreviewKind(file);
  const labels: Record<FilePreviewKind, string> = {
    image: "图片预览",
    video: "视频预览",
    audio: "音频播放",
    pdf: "PDF 预览",
    word: "Word 预览",
    sheet: "表格预览",
    text: "文本预览",
    office: "Office 预览",
    unknown: "文件预览",
  };
  return labels[kind];
}

function PreviewIcon({ kind }: { kind: FilePreviewKind }) {
  const className = `system-preview-kind-icon system-preview-kind-${kind}`;
  if (kind === "image") return <FileImageOutlined className={className} />;
  if (kind === "video") return <VideoCameraOutlined className={className} />;
  if (kind === "audio") return <AudioOutlined className={className} />;
  if (kind === "pdf") return <FilePdfOutlined className={className} />;
  if (kind === "word") return <FileWordOutlined className={className} />;
  if (kind === "sheet") return <FileExcelOutlined className={className} />;
  if (kind === "office") return <FilePptOutlined className={className} />;
  if (kind === "text") return <FileTextOutlined className={className} />;
  return <FileUnknownOutlined className={className} />;
}

function LoadingPreview() {
  return (
    <div className="system-file-preview-loading">
      <Spin />
    </div>
  );
}

function TextPreview({ url }: { url: string }) {
  const [result, setResult] = useState<{ text: string; truncated: boolean } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadText() {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("文件加载失败");
        const text = await response.text();
        if (cancelled) return;
        setResult({
          text:
            text.length > MAX_TEXT_PREVIEW_LENGTH ? text.slice(0, MAX_TEXT_PREVIEW_LENGTH) : text,
          truncated: text.length > MAX_TEXT_PREVIEW_LENGTH,
        });
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "文件加载失败");
      }
    }

    void loadText();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <Alert type="error" showIcon message={error} />;
  if (!result) return <LoadingPreview />;

  return (
    <div className="system-text-preview">
      {result.truncated ? (
        <Alert type="warning" showIcon message="文件较大，仅展示前 250000 个字符。" />
      ) : null}
      <pre>{result.text || "空文件"}</pre>
    </div>
  );
}

function DocxPreview({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;

    async function renderDocx() {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("文件加载失败");
        const blob = await response.blob();
        const { renderAsync } = await import("docx-preview");
        if (cancelled || !container) return;
        container.innerHTML = "";
        await renderAsync(blob, container, undefined, {
          breakPages: true,
          className: "system-docx-render",
          ignoreFonts: false,
          ignoreHeight: false,
          ignoreWidth: false,
          inWrapper: true,
          renderComments: false,
          renderFooters: true,
          renderHeaders: true,
        });
        if (!cancelled) setStatus("ready");
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Word 文件加载失败");
        setStatus("error");
      }
    }

    void renderDocx();
    return () => {
      cancelled = true;
      if (container) container.innerHTML = "";
    };
  }, [url]);

  return (
    <div className="system-docx-preview">
      {status === "loading" ? <LoadingPreview /> : null}
      {status === "error" ? <Alert type="error" showIcon message={error} /> : null}
      <div ref={containerRef} className={status === "ready" ? "" : "system-preview-hidden"} />
    </div>
  );
}

function SheetPreview({ url }: { url: string }) {
  const [result, setResult] = useState<SheetPreviewState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function renderSheet() {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error("文件加载失败");
        const buffer = await response.arrayBuffer();
        const XLSX = await import("xlsx");
        if (cancelled) return;

        const workbook = XLSX.read(buffer, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const sheet = sheetName ? workbook.Sheets[sheetName] : null;
        if (!sheetName || !sheet) {
          setResult({ sheetName: "Sheet1", columns: [], rows: [], truncated: false });
          return;
        }

        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          blankrows: false,
          defval: "",
          header: 1,
        });
        const maxColumns = Math.min(
          40,
          Math.max(0, ...matrix.map((row) => (Array.isArray(row) ? row.length : 0))),
        );
        const headerRow = matrix[0] ?? [];
        const hasHeader = headerRow.some((cell) => String(cell ?? "").trim());
        const dataRows = (hasHeader ? matrix.slice(1) : matrix).slice(0, 200);
        const columns: TableProps<SheetRow>["columns"] = Array.from(
          { length: maxColumns },
          (_, index) => ({
            title: String(hasHeader ? headerRow[index] || columnName(index) : columnName(index)),
            dataIndex: `c${index}`,
            key: `c${index}`,
            ellipsis: true,
            width: 160,
          }),
        );
        const rows = dataRows.map((row, rowIndex) => {
          const values = Array.isArray(row) ? row : [];
          const item: SheetRow = { key: String(rowIndex) };
          Array.from({ length: maxColumns }).forEach((_, columnIndex) => {
            const value = values[columnIndex];
            item[`c${columnIndex}`] =
              value === undefined || value === null ? "" : (value as string | number | boolean);
          });
          return item;
        });

        setResult({
          sheetName,
          columns,
          rows,
          truncated: matrix.length > dataRows.length + (hasHeader ? 1 : 0) || maxColumns >= 40,
        });
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "表格文件加载失败");
      }
    }

    void renderSheet();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) return <Alert type="error" showIcon message={error} />;
  if (!result) return <LoadingPreview />;
  if (!result.rows.length) return <Empty description="表格为空" />;

  return (
    <div className="system-sheet-preview">
      <div className="system-sheet-preview-header">
        <Typography.Text strong>{result.sheetName}</Typography.Text>
        {result.truncated ? <Tag color="warning">已截取前 200 行/40 列</Tag> : null}
      </div>
      <Table<SheetRow>
        size="small"
        bordered
        columns={result.columns}
        dataSource={result.rows}
        pagination={false}
        scroll={{ x: "max-content", y: 560 }}
      />
    </div>
  );
}

function OfficeFallbackPreview({ file }: { file: PreviewFileRecord }) {
  const officeViewerUrl = useMemo(() => buildOfficeViewerUrl(file.url), [file.url]);
  const ext = normalizeExt(file).toUpperCase();

  if (officeViewerUrl) {
    return (
      <iframe
        className="system-file-preview-frame"
        src={officeViewerUrl}
        title={file.originalName}
      />
    );
  }

  return (
    <div className="system-file-preview-fallback">
      <FilePptOutlined />
      <Typography.Title level={5}>{ext || "Office"} 文件需要文档预览服务</Typography.Title>
      <Typography.Paragraph>
        浏览器不能直接解析该格式。本地开发环境可以先下载或新标签打开；生产环境建议接入
        OnlyOffice、LibreOffice 转换服务或 kkFileView 后再内嵌预览。
      </Typography.Paragraph>
    </div>
  );
}

function UnknownPreview({ file }: { file: PreviewFileRecord }) {
  return (
    <div className="system-file-preview-fallback">
      <FileUnknownOutlined />
      <Typography.Title level={5}>暂不支持该文件类型预览</Typography.Title>
      <Typography.Paragraph>
        当前文件可以下载或在新标签打开。若需要支持该类型，可以继续补充对应的渲染器。
      </Typography.Paragraph>
      <Typography.Text type="secondary">
        {file.mime || normalizeExt(file) || "unknown"}
      </Typography.Text>
    </div>
  );
}

function PreviewBody({ file, kind }: { file: PreviewFileRecord; kind: FilePreviewKind }) {
  const url = getFileUrl(file.url);

  if (kind === "image") {
    return (
      <Image
        className="system-file-preview-image"
        src={url}
        alt={file.originalName}
        preview={false}
      />
    );
  }
  if (kind === "video") {
    return (
      <video
        key={file.id}
        className="system-file-preview-video"
        src={url}
        controls
        autoPlay
        preload="metadata"
      />
    );
  }
  if (kind === "audio") {
    return (
      <div className="system-file-audio-player">
        <AudioOutlined />
        <Typography.Text strong ellipsis>
          {file.originalName}
        </Typography.Text>
        <audio key={file.id} src={url} controls autoPlay />
      </div>
    );
  }
  if (kind === "pdf") {
    return (
      <iframe
        className="system-file-preview-frame"
        src={`${url}#toolbar=1`}
        title={file.originalName}
      />
    );
  }
  if (kind === "word") {
    return <DocxPreview key={file.id} url={url} />;
  }
  if (kind === "sheet") {
    return <SheetPreview key={file.id} url={url} />;
  }
  if (kind === "text") {
    return <TextPreview key={file.id} url={url} />;
  }
  if (kind === "office") {
    return <OfficeFallbackPreview file={file} />;
  }
  return <UnknownPreview file={file} />;
}

export function FilePreviewModal({
  file,
  open,
  onClose,
  onDownload,
}: {
  file: PreviewFileRecord | null;
  open: boolean;
  onClose: () => void;
  onDownload?: (file: PreviewFileRecord) => void;
}) {
  const kind = file ? getFilePreviewKind(file) : "unknown";
  const ext = file ? normalizeExt(file) : "";

  return (
    <Modal
      className="system-file-preview-modal"
      title={file ? <SpaceTitle file={file} kind={kind} ext={ext} /> : "文件预览"}
      open={open}
      width="min(1120px, calc(100vw - 32px))"
      footer={
        file ? (
          <div className="system-file-preview-footer">
            <Button
              icon={<ExportOutlined />}
              onClick={() => window.open(getFileUrl(file.url), "_blank", "noopener,noreferrer")}
            >
              新标签打开
            </Button>
            <Button type="primary" icon={<DownloadOutlined />} onClick={() => onDownload?.(file)}>
              下载
            </Button>
          </div>
        ) : null
      }
      destroyOnHidden
      onCancel={onClose}
    >
      {file ? (
        <div className="system-file-preview-layout">
          <Descriptions
            size="small"
            column={{ xs: 1, sm: 2, md: 4 }}
            className="system-file-preview-meta"
            items={[
              { key: "kind", label: "预览类型", children: getFilePreviewLabel(file) },
              { key: "size", label: "大小", children: formatSize(file.size) },
              { key: "ext", label: "扩展名", children: ext || "-" },
              { key: "mime", label: "MIME", children: file.mime || "-" },
            ]}
          />
          <div className={`system-file-preview-stage system-file-preview-stage-${kind}`}>
            <PreviewBody file={file} kind={kind} />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function SpaceTitle({
  file,
  kind,
  ext,
}: {
  file: PreviewFileRecord;
  kind: FilePreviewKind;
  ext: string;
}) {
  return (
    <div className="system-file-preview-title">
      <PreviewIcon kind={kind} />
      <Typography.Text ellipsis>{file.originalName}</Typography.Text>
      {ext ? <Tag>{ext}</Tag> : null}
    </div>
  );
}
