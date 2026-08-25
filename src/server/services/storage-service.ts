import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { nowIso, sqlite } from "@/server/db";
import { decryptSecret } from "./secret";

export type StorageType = "local" | "s3";

export type StorageRow = {
  id: number;
  name: string;
  code: string;
  type: StorageType;
  endpoint: string | null;
  region: string | null;
  bucket: string | null;
  accessKey: string | null;
  secretKeyEncrypted: string | null;
  baseUrl: string | null;
  rootPath: string | null;
  isDefault: boolean;
  status: number;
  optionsJson: string | null;
};

export type FileObjectRow = {
  id?: number;
  originalName?: string;
  filename: string;
  path: string;
  url?: string;
  mime?: string | null;
  storageId?: number | null;
  storageType?: StorageType | null;
  endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  accessKey?: string | null;
  secretKeyEncrypted?: string | null;
  rootPath?: string | null;
};

type UploadConfig = {
  maxSizeBytes: number;
  allowedExtensions: string[];
  deniedExtensions: string[];
  enableSha256Dedupe: boolean;
  mimeCheckEnabled: boolean;
  magicCheckEnabled: boolean;
  dangerousFileStrategy: "reject" | "isolated-download" | "force-download";
};

const defaultAllowedExtensions = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "txt",
  "md",
  "markdown",
  "csv",
  "zip",
  "mp3",
  "mp4",
  "webm",
];

const defaultDeniedExtensions = [
  "exe",
  "bat",
  "cmd",
  "sh",
  "php",
  "html",
  "htm",
  "js",
  "mjs",
  "svg",
];
const dangerousExtensions = ["html", "htm", "svg", "js", "mjs", "vbs", "sh", "bat", "cmd", "ps1"];

const mimeRules: Record<string, string[]> = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  pdf: ["application/pdf"],
  txt: ["text/plain"],
  csv: ["text/csv", "application/vnd.ms-excel"],
  zip: ["application/zip", "application/x-zip-compressed"],
  mp3: ["audio/"],
  mp4: ["video/mp4"],
  webm: ["video/webm"],
};

const magicRules: Record<string, Array<number[]>> = {
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
  gif: [[0x47, 0x49, 0x46, 0x38]],
  webp: [[0x52, 0x49, 0x46, 0x46]],
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  zip: [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ],
};

function splitExtensions(value?: string | null) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().replace(/^\./, "").toLowerCase())
    .filter(Boolean);
}

function booleanConfig(value?: string | null) {
  return value === "1" || value?.toLowerCase() === "true";
}

function localRoot(rootPath?: string | null) {
  const configured = rootPath?.trim() || path.join("storage", "uploads");
  return path.isAbsolute(configured)
    ? configured
    : path.join(/*turbopackIgnore: true*/ process.cwd(), configured);
}

function joinPublicUrl(baseUrl: string | null | undefined, relativePath: string) {
  const cleanPath = relativePath.split(path.sep).join("/");
  if (!baseUrl) return `/uploads/${cleanPath}`;
  return `${baseUrl.replace(/\/$/, "")}/${cleanPath.replace(/^\//, "")}`;
}

function createS3Client(
  storage: Pick<StorageRow, "endpoint" | "region" | "accessKey" | "secretKeyEncrypted">,
) {
  const secretAccessKey = decryptSecret(storage.secretKeyEncrypted);
  if (!storage.accessKey || !secretAccessKey) {
    throw new Error("S3 存储缺少 Access Key 或 Secret Key");
  }
  return new S3Client({
    region: storage.region || "auto",
    endpoint: storage.endpoint || undefined,
    forcePathStyle: true,
    credentials: {
      accessKeyId: storage.accessKey,
      secretAccessKey,
    },
  });
}

async function streamToBuffer(body: unknown) {
  if (!body) return Buffer.alloc(0);
  if (typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function safeExt(filename: string) {
  return path
    .extname(filename)
    .replace(/[^a-zA-Z0-9.]/g, "")
    .toLowerCase();
}

export function classifyFile(input: { ext?: string | null; mime?: string | null }) {
  const ext = input.ext?.replace(/^\./, "").toLowerCase() ?? "";
  const mime = input.mime ?? "";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext))
    return "image";
  if (mime.startsWith("video/") || ["mp4", "webm", "mov", "m4v"].includes(ext)) return "video";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac"].includes(ext))
    return "audio";
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md"].includes(ext))
    return "document";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "archive";
  return "other";
}

export async function getDefaultStorage() {
  const row = (await sqlite
    .prepare(
      `SELECT
        id,
        name,
        code,
        type,
        endpoint,
        region,
        bucket,
        access_key AS "accessKey",
        secret_key_encrypted AS "secretKeyEncrypted",
        base_url AS "baseUrl",
        root_path AS "rootPath",
        is_default AS "isDefault",
        status,
        options_json AS "optionsJson"
       FROM sys_storage
       WHERE deleted_at IS NULL AND is_default = true AND status = 1
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get()) as StorageRow | undefined;

  if (row) return row;
  throw new Error("未配置可用的默认存储");
}

export async function getStorageById(storageId: number) {
  return (await sqlite
    .prepare(
      `SELECT
        id,
        name,
        code,
        type,
        endpoint,
        region,
        bucket,
        access_key AS "accessKey",
        secret_key_encrypted AS "secretKeyEncrypted",
        base_url AS "baseUrl",
        root_path AS "rootPath",
        is_default AS "isDefault",
        status,
        options_json AS "optionsJson"
       FROM sys_storage
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .get(storageId)) as StorageRow | undefined;
}

export async function getUploadConfig(): Promise<UploadConfig> {
  const rows = (await sqlite
    .prepare(
      `SELECT key, "values" AS values
       FROM sys_config_items
       WHERE deleted_at IS NULL
         AND key IN (
           'file.max_upload_size_mb',
           'file.allowed_extensions',
           'file.denied_extensions',
           'file.enable_sha256_dedupe',
           'file.mime_check_enabled',
           'file.magic_check_enabled',
           'file.dangerous_file_strategy'
         )`,
    )
    .all()) as Array<{ key: string; values: string | null }>;
  const map = new Map(rows.map((row) => [row.key, row.values]));
  const maxMb = Number(map.get("file.max_upload_size_mb") ?? 50);

  return {
    maxSizeBytes: Math.max(Number.isFinite(maxMb) ? maxMb : 50, 1) * 1024 * 1024,
    allowedExtensions: splitExtensions(map.get("file.allowed_extensions")).length
      ? splitExtensions(map.get("file.allowed_extensions"))
      : defaultAllowedExtensions,
    deniedExtensions: splitExtensions(map.get("file.denied_extensions")).length
      ? splitExtensions(map.get("file.denied_extensions"))
      : defaultDeniedExtensions,
    enableSha256Dedupe: booleanConfig(map.get("file.enable_sha256_dedupe")),
    mimeCheckEnabled:
      map.get("file.mime_check_enabled") == null
        ? true
        : booleanConfig(map.get("file.mime_check_enabled")),
    magicCheckEnabled:
      map.get("file.magic_check_enabled") == null
        ? true
        : booleanConfig(map.get("file.magic_check_enabled")),
    dangerousFileStrategy: ["reject", "isolated-download", "force-download"].includes(
      String(map.get("file.dangerous_file_strategy") ?? ""),
    )
      ? (String(map.get("file.dangerous_file_strategy")) as UploadConfig["dangerousFileStrategy"])
      : "reject",
  };
}

export async function assertUploadAllowed(file: File, ext: string) {
  const config = await getUploadConfig();
  const normalizedExt = ext.replace(/^\./, "").toLowerCase();
  if (file.size > config.maxSizeBytes) {
    throw new Error(`文件大小不能超过 ${Math.floor(config.maxSizeBytes / 1024 / 1024)} MB`);
  }
  if (config.deniedExtensions.includes(normalizedExt)) {
    throw new Error("当前文件类型不允许上传");
  }
  if (config.dangerousFileStrategy === "reject" && dangerousExtensions.includes(normalizedExt)) {
    throw new Error("当前文件类型属于高风险类型，已按策略拒绝上传");
  }
  if (config.allowedExtensions.length && !config.allowedExtensions.includes(normalizedExt)) {
    throw new Error("当前文件类型不在允许上传范围内");
  }
  const expectedMimes = mimeRules[normalizedExt];
  if (config.mimeCheckEnabled && file.type && expectedMimes?.length) {
    const matched = expectedMimes.some((mime) =>
      mime.endsWith("/") ? file.type.startsWith(mime) : file.type === mime,
    );
    if (!matched) throw new Error("文件扩展名与 MIME 类型不匹配");
  }
  const expectedMagic = magicRules[normalizedExt];
  if (config.magicCheckEnabled && expectedMagic?.length) {
    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const matched = expectedMagic.some((signature) =>
      signature.every((byte, index) => bytes[index] === byte),
    );
    if (!matched) throw new Error("文件内容与扩展名不匹配");
  }
  return config;
}

export async function testStorageConnection(storage: {
  type: StorageType;
  endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  accessKey?: string | null;
  secretKeyEncrypted?: string | null;
  rootPath?: string | null;
}) {
  if (storage.type === "local") {
    const root = localRoot(storage.rootPath);
    await fs.mkdir(root, { recursive: true });
    const probe = path.join(root, `.probe-${crypto.randomUUID()}`);
    await fs.writeFile(probe, "ok");
    await fs.rm(probe, { force: true });
    return;
  }

  if (!storage.bucket) throw new Error("S3 存储缺少 bucket");
  const client = createS3Client({
    endpoint: storage.endpoint ?? null,
    region: storage.region ?? null,
    accessKey: storage.accessKey ?? null,
    secretKeyEncrypted: storage.secretKeyEncrypted ?? null,
  });
  await client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
}

async function storeBufferInDefaultStorage(input: {
  originalName: string;
  mime: string | null;
  buffer: Buffer;
  groupId: number | null;
  userId: number;
  enableSha256Dedupe: boolean;
  usageType?: "general" | "knowledge" | "user_content";
  metadata?: Record<string, unknown>;
}) {
  const storage = await getDefaultStorage();
  const extWithDot = safeExt(input.originalName);
  const ext = extWithDot.replace(".", "");
  const sha256 = crypto.createHash("sha256").update(input.buffer).digest("hex");

  if (input.enableSha256Dedupe) {
    const existing = (await sqlite
      .prepare(
        `SELECT id, url
         FROM sys_file
         WHERE storage_id = ?
           AND sha256 = ?
           AND usage_type = ?
           AND deleted_at IS NULL
         ORDER BY id ASC
         LIMIT 1`,
      )
      .get(storage.id, sha256, input.usageType ?? "general")) as
      | { id: number; url: string }
      | undefined;
    if (existing) return { ...existing, deduped: true };
  }

  const dateDir = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const filename = `${crypto.randomUUID()}${extWithDot}`;
  const relativePath = `${dateDir}/${filename}`;

  if (storage.type === "local") {
    const absoluteDir = path.join(localRoot(storage.rootPath), dateDir);
    await fs.mkdir(absoluteDir, { recursive: true });
    await fs.writeFile(path.join(absoluteDir, filename), input.buffer);
  } else {
    if (!storage.bucket) throw new Error("S3 存储缺少 bucket");
    const client = createS3Client(storage);
    await client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: relativePath,
        Body: input.buffer,
        ContentType: input.mime || "application/octet-stream",
      }),
    );
  }

  const now = nowIso();
  const fileType = classifyFile({ ext, mime: input.mime });
  const url = joinPublicUrl(storage.baseUrl, relativePath);
  const result = await sqlite
    .prepare(
      `INSERT INTO sys_file
        (group_id, storage_id, original_name, filename, path, url, size, ext, mime, type,
         usage_type, sha256, metadata_json, uploader_id, created_at, updated_at)
       VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .run(
      input.usageType === "knowledge" ? null : (input.groupId ?? 1),
      storage.id,
      input.originalName,
      filename,
      relativePath,
      url,
      input.buffer.length,
      ext,
      input.mime,
      fileType,
      input.usageType ?? "general",
      sha256,
      JSON.stringify({ storageType: storage.type, ...(input.metadata ?? {}) }),
      input.userId,
      now,
      now,
    );

  return {
    id: Number(result.lastInsertRowid),
    url,
    deduped: false,
  };
}

export async function uploadFileToDefaultStorage(input: {
  file: File;
  groupId: number | null;
  userId: number;
  usageType?: "general" | "knowledge" | "user_content";
}) {
  const ext = safeExt(input.file.name).replace(".", "");
  const uploadConfig = await assertUploadAllowed(input.file, ext);
  return storeBufferInDefaultStorage({
    originalName: input.file.name,
    mime: input.file.type || null,
    buffer: Buffer.from(await input.file.arrayBuffer()),
    groupId: input.groupId,
    userId: input.userId,
    enableSha256Dedupe: uploadConfig.enableSha256Dedupe,
    usageType: input.usageType,
  });
}

const trustedGeneratedTextExtensions = new Set(["txt", "md", "markdown", "json", "csv"]);

export async function storeTrustedGeneratedText(input: {
  name: string;
  content: string;
  userId: number;
  groupId?: number | null;
  source?: string;
  usageType?: "general" | "knowledge" | "user_content";
  metadata?: Record<string, unknown>;
}) {
  const originalName = path.basename(input.name);
  const ext = safeExt(originalName).replace(".", "");
  if (!trustedGeneratedTextExtensions.has(ext)) {
    throw new Error("系统生成文件仅支持 TXT、Markdown、JSON 和 CSV 文本");
  }
  const buffer = Buffer.from(input.content, "utf8");
  if (buffer.length > 20 * 1024 * 1024) throw new Error("系统生成文本不能超过 20 MB");
  return storeBufferInDefaultStorage({
    originalName,
    mime:
      ext === "json"
        ? "application/json"
        : ext === "csv"
          ? "text/csv"
          : ext === "md" || ext === "markdown"
            ? "text/markdown"
            : "text/plain",
    buffer,
    groupId: input.groupId ?? null,
    userId: input.userId,
    enableSha256Dedupe: true,
    usageType: input.usageType,
    metadata: {
      trustedGenerated: true,
      source: input.source ?? "system",
      ...(input.metadata ?? {}),
    },
  });
}

export async function readStoredObject(row: FileObjectRow) {
  if ((row.storageType ?? "local") === "local") {
    return fs.readFile(path.join(localRoot(row.rootPath), row.path));
  }

  if (!row.bucket) throw new Error("S3 文件缺少 bucket");
  const client = createS3Client({
    endpoint: row.endpoint ?? null,
    region: row.region ?? null,
    accessKey: row.accessKey ?? null,
    secretKeyEncrypted: row.secretKeyEncrypted ?? null,
  });
  const result = await client.send(new GetObjectCommand({ Bucket: row.bucket, Key: row.path }));
  return streamToBuffer(result.Body);
}

export async function deleteStoredObject(row: FileObjectRow) {
  if ((row.storageType ?? "local") === "local") {
    await fs.rm(path.join(localRoot(row.rootPath), row.path), { force: true });
    return;
  }

  if (!row.bucket) throw new Error("S3 文件缺少 bucket");
  const client = createS3Client({
    endpoint: row.endpoint ?? null,
    region: row.region ?? null,
    accessKey: row.accessKey ?? null,
    secretKeyEncrypted: row.secretKeyEncrypted ?? null,
  });
  await client.send(new DeleteObjectCommand({ Bucket: row.bucket, Key: row.path }));
}

export async function copyStoredObject(input: {
  source: FileObjectRow;
  targetPath: string;
  contentType?: string | null;
}) {
  if ((input.source.storageType ?? "local") === "local") {
    const root = localRoot(input.source.rootPath);
    await fs.mkdir(path.dirname(path.join(root, input.targetPath)), { recursive: true });
    await fs.copyFile(path.join(root, input.source.path), path.join(root, input.targetPath));
    return;
  }

  if (!input.source.bucket) throw new Error("S3 文件缺少 bucket");
  const client = createS3Client({
    endpoint: input.source.endpoint ?? null,
    region: input.source.region ?? null,
    accessKey: input.source.accessKey ?? null,
    secretKeyEncrypted: input.source.secretKeyEncrypted ?? null,
  });
  const copySource = `${input.source.bucket}/${input.source.path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  await client.send(
    new CopyObjectCommand({
      Bucket: input.source.bucket,
      Key: input.targetPath,
      CopySource: copySource,
      ContentType: input.contentType ?? undefined,
    }),
  );
}

export async function copyStoredFileToUsage(input: {
  sourceFileId: number;
  sourceUsageType: "general" | "knowledge" | "user_content";
  targetUsageType: "general" | "knowledge" | "user_content";
  userId: number;
  sha256?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const source = (await sqlite
    .prepare(
      `SELECT f.id, f.storage_id AS "storageId", f.original_name AS "originalName",
        f.filename, f.path, f.size, f.ext, f.mime, f.type, f.sha256,
        COALESCE(s.type, 'local') AS "storageType", s.endpoint, s.region, s.bucket,
        s.access_key AS "accessKey", s.secret_key_encrypted AS "secretKeyEncrypted",
        s.base_url AS "baseUrl", s.root_path AS "rootPath"
       FROM sys_file f
       LEFT JOIN sys_storage s ON s.id = f.storage_id
       WHERE f.id = ? AND f.usage_type = ? AND f.deleted_at IS NULL`,
    )
    .get(input.sourceFileId, input.sourceUsageType)) as
    | (FileObjectRow & {
        id: number;
        storageId: number | null;
        originalName: string;
        size: number;
        ext: string | null;
        mime: string | null;
        type: string | null;
        sha256: string | null;
        baseUrl: string | null;
      })
    | undefined;
  if (!source) throw new Error("源文件不存在或已进入回收站");

  const extWithDot = source.ext ? `.${source.ext}` : safeExt(source.originalName);
  const dateDir = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const filename = `${crypto.randomUUID()}${extWithDot}`;
  const targetPath = `${dateDir}/${filename}`;
  const targetObject: FileObjectRow = { ...source, filename, path: targetPath };
  await copyStoredObject({ source, targetPath, contentType: source.mime });

  try {
    const now = nowIso();
    const result = await sqlite
      .prepare(
        `INSERT INTO sys_file
          (group_id, storage_id, original_name, filename, path, url, size, ext, mime, type,
           usage_type, sha256, metadata_json, uploader_id, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .run(
        input.targetUsageType === "general" ? 1 : null,
        source.storageId,
        source.originalName,
        filename,
        targetPath,
        joinPublicUrl(source.baseUrl, targetPath),
        source.size,
        source.ext,
        source.mime,
        source.type ?? classifyFile({ ext: source.ext, mime: source.mime }),
        input.targetUsageType,
        input.sha256 ?? source.sha256,
        JSON.stringify({
          importedFromFileId: source.id,
          importedFromUsageType: input.sourceUsageType,
          importedAt: now,
          sourceSha256: input.sha256 ?? source.sha256,
          ...(input.metadata ?? {}),
        }),
        input.userId,
        now,
        now,
      );
    return {
      id: Number(result.lastInsertRowid),
      originalName: source.originalName,
      path: targetPath,
      usageType: input.targetUsageType,
    };
  } catch (error) {
    await deleteStoredObject(targetObject).catch(() => undefined);
    throw error;
  }
}

export async function deleteUnreferencedStoredFile(input: {
  fileId: number;
  usageType: "general" | "knowledge" | "user_content";
}) {
  const referenced = await sqlite
    .prepare("SELECT id FROM sys_file_reference WHERE file_id = ? LIMIT 1")
    .get(input.fileId);
  if (referenced) return false;
  const row = (await sqlite
    .prepare(
      `SELECT f.id, f.filename, f.path, f.mime, f.storage_id AS "storageId",
        COALESCE(s.type, 'local') AS "storageType", s.endpoint, s.region, s.bucket,
        s.access_key AS "accessKey", s.secret_key_encrypted AS "secretKeyEncrypted",
        s.root_path AS "rootPath"
       FROM sys_file f LEFT JOIN sys_storage s ON s.id = f.storage_id
       WHERE f.id = ? AND f.usage_type = ?`,
    )
    .get(input.fileId, input.usageType)) as FileObjectRow | undefined;
  if (!row) return false;
  await deleteStoredObject(row);
  await sqlite
    .prepare("DELETE FROM sys_file WHERE id = ? AND usage_type = ?")
    .run(input.fileId, input.usageType);
  return true;
}
