"use client";

import {
  BoldOutlined,
  CodeOutlined,
  FolderOpenOutlined,
  ItalicOutlined,
  LinkOutlined,
  MinusOutlined,
  OrderedListOutlined,
  PictureOutlined,
  RedoOutlined,
  StrikethroughOutlined,
  UndoOutlined,
  UnorderedListOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button, Empty, Image as AntImage, Input, Modal, Select, Space, Spin, Tooltip, Typography, Upload } from "antd";
import type { UploadProps } from "antd";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildQueryString, request } from "@/lib/request";
import type { PageResult } from "@/lib/response";
import { sanitizeRichTextHtml } from "@/lib/rich-text";
import { feedback } from "@/ui/feedback/feedback";

type UploadResult = {
  id: number;
  url: string;
};

type ImageFileRecord = {
  id: number;
  originalName: string;
  url: string;
  ext?: string | null;
  mime?: string | null;
};

type AdminRichTextFieldProps = {
  value?: string;
  onChange?: (value?: string) => void;
  disabled?: boolean;
  placeholder?: string;
  minHeight?: number;
};

type ToolbarButtonProps = {
  active?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  title: string;
  onClick: () => void;
};

type RichTextEditor = NonNullable<ReturnType<typeof useEditor>>;

type SlashRange = {
  from: number;
  to: number;
};

type SlashMenuState = SlashRange & {
  open: boolean;
  query: string;
  top: number;
  left: number;
  selectedIndex: number;
};

type SlashCommand = {
  key: string;
  label: string;
  description: string;
  icon: ReactNode;
  keywords: string[];
  run: (editor: RichTextEditor, range: SlashRange) => void;
};

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "svg"]);
const emptySlashMenu: SlashMenuState = {
  open: false,
  query: "",
  from: 0,
  to: 0,
  top: 0,
  left: 0,
  selectedIndex: 0,
};

const headingOptions = [
  { label: "正文", value: "paragraph" },
  { label: "标题 1", value: "heading-1" },
  { label: "标题 2", value: "heading-2" },
  { label: "标题 3", value: "heading-3" },
  { label: "标题 4", value: "heading-4" },
  { label: "标题 5", value: "heading-5" },
];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function toEditorContent(value?: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (looksLikeHtml(raw)) return sanitizeRichTextHtml(raw);
  return raw
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function isImageFile(file: ImageFileRecord) {
  const ext = (file.ext || file.originalName.split(".").pop() || "").toLowerCase();
  return file.mime?.startsWith("image/") || IMAGE_EXTENSIONS.has(ext);
}

function getHeadingValue(editor: RichTextEditor | null) {
  if (!editor) return "paragraph";
  for (const level of [1, 2, 3, 4, 5] as const) {
    if (editor.isActive("heading", { level })) return `heading-${level}`;
  }
  return "paragraph";
}

function ToolbarButton({ active, disabled, icon, title, onClick }: ToolbarButtonProps) {
  return (
    <Tooltip title={title}>
      <Button
        aria-label={title}
        disabled={disabled}
        icon={icon}
        size="small"
        type={active ? "primary" : "text"}
        onClick={onClick}
      />
    </Tooltip>
  );
}

function matchesSlashCommand(command: SlashCommand, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const searchable = [command.label, command.description, ...command.keywords]
    .join(" ")
    .toLowerCase();
  return searchable.includes(normalizedQuery);
}

export function AdminRichTextField({
  value,
  onChange,
  disabled,
  placeholder = "请输入内容",
  minHeight = 220,
}: AdminRichTextFieldProps) {
  const [uploading, setUploading] = useState(false);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [imagePickerLoading, setImagePickerLoading] = useState(false);
  const [imageKeyword, setImageKeyword] = useState("");
  const [images, setImages] = useState<ImageFileRecord[]>([]);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>(emptySlashMenu);
  const editorRef = useRef<RichTextEditor | null>(null);
  const slashMenuRef = useRef<SlashMenuState>(emptySlashMenu);
  const slashCommandsRef = useRef<SlashCommand[]>([]);

  const closeSlashMenu = useCallback(() => {
    setSlashMenu(emptySlashMenu);
  }, []);

  const uploadImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      feedback.warning("请选择图片文件");
      return null;
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
      feedback.success("图片上传成功");
      return result.url;
    } finally {
      setUploading(false);
    }
  }, []);

  const insertImage = useCallback((url: string) => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    currentEditor.chain().focus().setImage({ src: url }).run();
  }, []);

  const loadImages = useCallback(async (nextKeyword = imageKeyword) => {
    setImagePickerLoading(true);
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
      setImagePickerLoading(false);
    }
  }, [imageKeyword]);

  const openImagePicker = useCallback(() => {
    setImagePickerOpen(true);
    void loadImages(imageKeyword);
  }, [imageKeyword, loadImages]);

  function executeSlashCommand(command: SlashCommand) {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    const range = slashMenuRef.current;
    command.run(currentEditor, { from: range.from, to: range.to });
    closeSlashMenu();
  }

  const updateSlashMenu = useCallback((currentEditor: RichTextEditor) => {
    if (disabled) {
      closeSlashMenu();
      return;
    }

    const { state, view } = currentEditor;
    const { selection } = state;
    if (!selection.empty) {
      closeSlashMenu();
      return;
    }

    const $from = selection.$from;
    if (!$from.parent.isTextblock) {
      closeSlashMenu();
      return;
    }

    const textBefore = state.doc.textBetween($from.start(), $from.pos, "\n", "\0");
    const slashIndex = textBefore.lastIndexOf("/");
    if (slashIndex < 0) {
      closeSlashMenu();
      return;
    }

    const query = textBefore.slice(slashIndex + 1);
    if (query.includes(" ") || query.includes("\n")) {
      closeSlashMenu();
      return;
    }

    const from = $from.start() + slashIndex;
    const coords = view.coordsAtPos(from);
    setSlashMenu((current) => ({
      open: true,
      query,
      from,
      to: $from.pos,
      top: coords.bottom + 8,
      left: Math.min(coords.left, window.innerWidth - 280),
      selectedIndex: current.open && current.query === query ? current.selectedIndex : 0,
    }));
  }, [closeSlashMenu, disabled]);

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      {
        key: "paragraph",
        label: "正文",
        description: "普通段落",
        icon: <MinusOutlined />,
        keywords: ["p", "paragraph", "text", "正文", "段落"],
        run: (currentEditor, range) =>
          currentEditor.chain().focus().deleteRange(range).setParagraph().run(),
      },
      ...([1, 2, 3, 4, 5] as const).map<SlashCommand>((level) => ({
        key: `heading-${level}`,
        label: `标题 ${level}`,
        description: `H${level} 标题块`,
        icon: <Typography.Text strong>H{level}</Typography.Text>,
        keywords: [`h${level}`, `标题${level}`, `${level}级标题`],
        run: (currentEditor, range) =>
          currentEditor.chain().focus().deleteRange(range).toggleHeading({ level }).run(),
      })),
      {
        key: "bullet-list",
        label: "无序列表",
        description: "项目符号列表",
        icon: <UnorderedListOutlined />,
        keywords: ["ul", "list", "无序", "列表"],
        run: (currentEditor, range) =>
          currentEditor.chain().focus().deleteRange(range).toggleBulletList().run(),
      },
      {
        key: "ordered-list",
        label: "有序列表",
        description: "数字编号列表",
        icon: <OrderedListOutlined />,
        keywords: ["ol", "number", "有序", "编号"],
        run: (currentEditor, range) =>
          currentEditor.chain().focus().deleteRange(range).toggleOrderedList().run(),
      },
      {
        key: "image",
        label: "图片",
        description: "上传或选择系统图片",
        icon: <PictureOutlined />,
        keywords: ["img", "image", "upload", "file", "图片", "上传"],
        run: (currentEditor, range) => {
          currentEditor.chain().focus().deleteRange(range).run();
          openImagePicker();
        },
      },
      {
        key: "blockquote",
        label: "引用",
        description: "引用块",
        icon: <Typography.Text>“”</Typography.Text>,
        keywords: ["quote", "blockquote", "引用"],
        run: (currentEditor, range) =>
          currentEditor.chain().focus().deleteRange(range).toggleBlockquote().run(),
      },
      {
        key: "code-block",
        label: "代码块",
        description: "多行代码",
        icon: <CodeOutlined />,
        keywords: ["code", "pre", "代码"],
        run: (currentEditor, range) =>
          currentEditor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
      },
      {
        key: "horizontal-rule",
        label: "分割线",
        description: "插入水平线",
        icon: <MinusOutlined />,
        keywords: ["hr", "line", "分割线"],
        run: (currentEditor, range) =>
          currentEditor.chain().focus().deleteRange(range).setHorizontalRule().run(),
      },
      {
        key: "bold",
        label: "粗体",
        description: "开启或关闭加粗",
        icon: <BoldOutlined />,
        keywords: ["bold", "b", "加粗", "粗体"],
        run: (currentEditor, range) =>
          currentEditor.chain().focus().deleteRange(range).toggleBold().run(),
      },
      {
        key: "italic",
        label: "斜体",
        description: "开启或关闭斜体",
        icon: <ItalicOutlined />,
        keywords: ["italic", "i", "斜体"],
        run: (currentEditor, range) =>
          currentEditor.chain().focus().deleteRange(range).toggleItalic().run(),
      },
    ],
    [openImagePicker],
  );
  const filteredSlashCommands = useMemo(
    () => slashCommands.filter((command) => matchesSlashCommand(command, slashMenu.query)),
    [slashCommands, slashMenu.query],
  );

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5],
        },
        link: false,
      }),
      Link.configure({
        autolink: true,
        openOnClick: false,
        protocols: ["http", "https", "mailto", "tel"],
      }),
      Image.configure({
        allowBase64: false,
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    [placeholder],
  );
  const editor = useEditor({
    extensions,
    content: toEditorContent(value),
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "admin-rich-text-editor-content",
        style: `min-height: ${minHeight}px`,
      },
      handleKeyDown: (_view, event) => {
        const menu = slashMenuRef.current;
        if (!menu.open) return false;
        const commands = slashCommandsRef.current;
        if (!commands.length) {
          if (event.key === "Escape") {
            closeSlashMenu();
            return true;
          }
          return false;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashMenu((current) => ({
            ...current,
            selectedIndex: (current.selectedIndex + 1) % commands.length,
          }));
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashMenu((current) => ({
            ...current,
            selectedIndex: (current.selectedIndex - 1 + commands.length) % commands.length,
          }));
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          executeSlashCommand(commands[Math.min(menu.selectedIndex, commands.length - 1)]);
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeSlashMenu();
          return true;
        }
        return false;
      },
    },
    onSelectionUpdate: ({ editor: currentEditor }) => updateSlashMenu(currentEditor),
    onUpdate: ({ editor: currentEditor }) => {
      onChange?.(currentEditor.isEmpty ? "" : sanitizeRichTextHtml(currentEditor.getHTML()));
      updateSlashMenu(currentEditor);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    slashMenuRef.current = slashMenu;
    slashCommandsRef.current = filteredSlashCommands;
  }, [filteredSlashCommands, slashMenu]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor) return;
    const nextContent = toEditorContent(value);
    const currentContent = editor.isEmpty ? "" : sanitizeRichTextHtml(editor.getHTML());
    if (nextContent !== currentContent) {
      editor.commands.setContent(nextContent, { emitUpdate: false });
    }
  }, [editor, value]);

  const uploadProps: UploadProps = {
    accept: "image/*",
    disabled: disabled || !editor,
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      const url = await uploadImageFile(file);
      if (url) insertImage(url);
      return Upload.LIST_IGNORE;
    },
  };

  const pickerUploadProps: UploadProps = {
    ...uploadProps,
    beforeUpload: async (file) => {
      const url = await uploadImageFile(file);
      if (url) {
        insertImage(url);
        setImagePickerOpen(false);
      }
      return Upload.LIST_IGNORE;
    },
  };

  function setLink() {
    if (!editor) return;
    const currentHref = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("链接地址", currentHref ?? "https://");
    if (href === null) return;
    if (!href.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: href.trim(), rel: "noopener noreferrer", target: "_blank" })
      .run();
  }

  function applyBlock(value: string) {
    if (!editor) return;
    if (value === "paragraph") {
      editor.chain().focus().setParagraph().run();
      return;
    }
    const level = Number(value.replace("heading-", "")) as 1 | 2 | 3 | 4 | 5;
    editor.chain().focus().toggleHeading({ level }).run();
  }

  const toolbarDisabled = disabled || !editor;

  return (
    <div className={disabled ? "admin-rich-text-field admin-rich-text-field-disabled" : "admin-rich-text-field"}>
      <div className="admin-rich-text-toolbar">
        <Select
          disabled={toolbarDisabled}
          options={headingOptions}
          size="small"
          value={getHeadingValue(editor)}
          style={{ width: 108 }}
          onChange={applyBlock}
        />
        <Space.Compact>
          <ToolbarButton
            active={editor?.isActive("bold")}
            disabled={toolbarDisabled}
            icon={<BoldOutlined />}
            title="加粗"
            onClick={() => editor?.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            active={editor?.isActive("italic")}
            disabled={toolbarDisabled}
            icon={<ItalicOutlined />}
            title="斜体"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          />
          <ToolbarButton
            active={editor?.isActive("strike")}
            disabled={toolbarDisabled}
            icon={<StrikethroughOutlined />}
            title="删除线"
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          />
        </Space.Compact>
        <Space.Compact>
          <ToolbarButton
            active={editor?.isActive("bulletList")}
            disabled={toolbarDisabled}
            icon={<UnorderedListOutlined />}
            title="无序列表"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
          <ToolbarButton
            active={editor?.isActive("orderedList")}
            disabled={toolbarDisabled}
            icon={<OrderedListOutlined />}
            title="有序列表"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          />
        </Space.Compact>
        <Space.Compact>
          <ToolbarButton
            active={editor?.isActive("link")}
            disabled={toolbarDisabled}
            icon={<LinkOutlined />}
            title="链接"
            onClick={setLink}
          />
          <Upload {...uploadProps}>
            <Tooltip title="上传图片">
              <Button
                aria-label="上传图片"
                disabled={toolbarDisabled}
                icon={<PictureOutlined />}
                loading={uploading}
                size="small"
                type="text"
              />
            </Tooltip>
          </Upload>
          <Tooltip title="选择系统图片">
            <Button
              aria-label="选择系统图片"
              disabled={toolbarDisabled}
              icon={<FolderOpenOutlined />}
              size="small"
              type="text"
              onClick={openImagePicker}
            />
          </Tooltip>
        </Space.Compact>
        <Space.Compact>
          <ToolbarButton
            disabled={toolbarDisabled || !editor?.can().undo()}
            icon={<UndoOutlined />}
            title="撤销"
            onClick={() => editor?.chain().focus().undo().run()}
          />
          <ToolbarButton
            disabled={toolbarDisabled || !editor?.can().redo()}
            icon={<RedoOutlined />}
            title="重做"
            onClick={() => editor?.chain().focus().redo().run()}
          />
        </Space.Compact>
      </div>
      <EditorContent editor={editor} />
      {slashMenu.open ? (
        <div
          className="admin-rich-text-slash-menu"
          style={{ left: slashMenu.left, top: slashMenu.top }}
        >
          {filteredSlashCommands.length ? (
            filteredSlashCommands.map((command, index) => (
              <button
                key={command.key}
                type="button"
                className={
                  index === slashMenu.selectedIndex
                    ? "admin-rich-text-slash-item admin-rich-text-slash-item-active"
                    : "admin-rich-text-slash-item"
                }
                onMouseDown={(event) => {
                  event.preventDefault();
                  executeSlashCommand(command);
                }}
              >
                <span className="admin-rich-text-slash-icon">{command.icon}</span>
                <span className="admin-rich-text-slash-copy">
                  <span>{command.label}</span>
                  <small>{command.description}</small>
                </span>
              </button>
            ))
          ) : (
            <div className="admin-rich-text-slash-empty">没有匹配的命令</div>
          )}
        </div>
      ) : null}
      <Modal
        title="插入图片"
        open={imagePickerOpen}
        width={760}
        footer={null}
        destroyOnHidden
        onCancel={() => setImagePickerOpen(false)}
      >
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
            <Upload {...pickerUploadProps}>
              <Button icon={<UploadOutlined />} loading={uploading}>
                上传图片
              </Button>
            </Upload>
            <Input.Search
              allowClear
              placeholder="搜索系统图片"
              value={imageKeyword}
              style={{ width: 260 }}
              onChange={(event) => setImageKeyword(event.target.value)}
              onSearch={(nextKeyword) => void loadImages(nextKeyword)}
            />
          </Space>
          <Spin spinning={imagePickerLoading}>
            {images.length ? (
              <div className="admin-image-picker-grid">
                {images.map((image) => (
                  <button
                    key={image.id}
                    type="button"
                    className="admin-image-picker-item"
                    onClick={() => {
                      insertImage(image.url);
                      setImagePickerOpen(false);
                    }}
                  >
                    <AntImage
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
              <Empty className="admin-image-picker-empty" description="暂无图片文件" />
            )}
          </Spin>
        </Space>
      </Modal>
    </div>
  );
}
