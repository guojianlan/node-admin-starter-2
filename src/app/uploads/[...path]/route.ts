import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

export const runtime = "nodejs";

function uploadRoot() {
  return path.join(process.cwd(), "storage", "uploads");
}

const MIME_BY_EXT: Record<string, string> = {
  aac: "audio/aac",
  avif: "image/avif",
  bmp: "image/bmp",
  css: "text/css; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  flac: "audio/flac",
  gif: "image/gif",
  htm: "text/html; charset=utf-8",
  html: "text/html; charset=utf-8",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  m4a: "audio/mp4",
  m4v: "video/mp4",
  md: "text/markdown; charset=utf-8",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  ogv: "video/ogg",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml",
  ts: "text/plain; charset=utf-8",
  tsx: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml; charset=utf-8",
};

const DANGEROUS_EXTENSIONS = new Set([
  "html",
  "htm",
  "svg",
  "js",
  "mjs",
  "vbs",
  "sh",
  "bat",
  "cmd",
  "ps1",
]);

function getExtension(relativePath: string) {
  return path.extname(relativePath).replace(".", "").toLowerCase();
}

function getContentType(relativePath: string) {
  const ext = getExtension(relativePath);
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function parseRange(rangeHeader: string | null, size: number) {
  if (!rangeHeader) return null;

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return "invalid";

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return "invalid";

  let start: number;
  let end: number;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return "invalid";
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end ||
    start < 0 ||
    start >= size
  ) {
    return "invalid";
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function streamFile(filePath: string, start?: number, end?: number) {
  return Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const resolvedParams = await params;
  const relativePath = resolvedParams.path.join("/");
  const root = path.resolve(uploadRoot());
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(`${root}${path.sep}`)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return new Response("Not Found", { status: 404 });

    const dangerous = DANGEROUS_EXTENSIONS.has(getExtension(relativePath));
    const contentType = dangerous ? "application/octet-stream" : getContentType(relativePath);
    const range = parseRange(request.headers.get("range"), stat.size);
    const baseHeaders = {
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": contentType,
      ...(dangerous
        ? { "Content-Disposition": `attachment; filename="${encodeURIComponent(path.basename(relativePath))}"` }
        : {}),
      "X-Content-Type-Options": "nosniff",
    };

    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: {
          ...baseHeaders,
          "Content-Range": `bytes */${stat.size}`,
        },
      });
    }

    if (range) {
      const contentLength = range.end - range.start + 1;
      return new Response(streamFile(filePath, range.start, range.end), {
        status: 206,
        headers: {
          ...baseHeaders,
          "Content-Length": String(contentLength),
          "Content-Range": `bytes ${range.start}-${range.end}/${stat.size}`,
        },
      });
    }

    return new Response(streamFile(filePath), {
      headers: {
        ...baseHeaders,
        "Content-Length": String(stat.size),
      },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
