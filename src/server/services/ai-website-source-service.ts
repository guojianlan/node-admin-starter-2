import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 4;
const SENSITIVE_QUERY_KEY = /(token|secret|password|passwd|api[-_]?key|signature|credential|auth)/i;
const blockedHostnames = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data.ec2.internal",
]);

export class WebsiteSourceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "WebsiteSourceError";
    this.status = status;
  }
}

type ResolvedAddress = { address: string; family: number };
type WebsiteResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
};

export type WebsiteSourceRuntime = {
  lookup: (hostname: string) => Promise<ResolvedAddress[]>;
  request: (
    url: URL,
    address: ResolvedAddress,
    timeoutMs: number,
    maxBytes: number,
  ) => Promise<WebsiteResponse>;
};

export type WebsiteSourceSnapshot = {
  sourceUrl: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  publishedAt: string | null;
  fetchedAt: string;
  contentHash: string;
  markdown: string;
};

function parseIpv4(address: string) {
  const octets = address.split(".").map(Number);
  return octets.length === 4 &&
    octets.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ? octets
    : null;
}

export function isPublicIpAddress(rawAddress: string) {
  const address = rawAddress.toLowerCase().split("%")[0];
  const family = net.isIP(address);
  if (family === 4) {
    const value = parseIpv4(address);
    if (!value) return false;
    const [a, b] = value;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && value[2] === 2) ||
      (a === 198 && b === 51 && value[2] === 100) ||
      (a === 203 && b === 0 && value[2] === 113) ||
      a >= 224
    );
  }
  if (family !== 6) return false;
  if (address.startsWith("::ffff:")) return isPublicIpAddress(address.slice(7));
  return !(
    address === "::" ||
    address === "::1" ||
    address.startsWith("fc") ||
    address.startsWith("fd") ||
    /^fe[89ab]/.test(address) ||
    address.startsWith("2001:db8:")
  );
}

function parseWebsiteUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new WebsiteSourceError("请输入有效的网站 URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebsiteSourceError("网站来源仅支持 HTTP 或 HTTPS URL");
  }
  if (url.username || url.password) throw new WebsiteSourceError("网站 URL 不能包含账号或密码");
  const hostname = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    blockedHostnames.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new WebsiteSourceError("该网站地址不允许作为外部来源");
  }
  return url;
}

export function sanitizePersistedUrl(value: URL | string) {
  const url = typeof value === "string" ? new URL(value) : new URL(value.toString());
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  return url.toString();
}

async function resolvePublicAddress(url: URL, runtime: WebsiteSourceRuntime) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw new WebsiteSourceError("网站地址指向内网或保留 IP");
    }
    return { address: hostname, family: net.isIP(hostname) };
  }
  let addresses: ResolvedAddress[];
  try {
    addresses = await runtime.lookup(hostname);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WebsiteSourceError(`网站域名解析失败：${message}`, 502);
  }
  if (!addresses.length) throw new WebsiteSourceError("网站域名无法解析", 502);
  if (addresses.some((item) => !isPublicIpAddress(item.address))) {
    throw new WebsiteSourceError("网站域名解析到内网或保留 IP");
  }
  return addresses[0];
}

function requestPinned(
  url: URL,
  address: ResolvedAddress,
  timeoutMs: number,
  maxBytes: number,
): Promise<WebsiteResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9",
          "accept-encoding": "identity",
          "user-agent": "AdminBase-WebsiteSource/1.0",
        },
        lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      },
      (response) => {
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (declaredLength > maxBytes) {
          response.destroy();
          reject(new Error("网页内容超过允许的大小"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy(new Error("网页内容超过允许的大小"));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    request.setTimeout(timeoutMs, () => request.destroy(new Error("抓取网站超时")));
    request.on("error", reject);
    request.end();
  });
}

export const defaultWebsiteSourceRuntime: WebsiteSourceRuntime = {
  lookup: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  request: requestPinned,
};

function resolveCanonicalUrl(document: globalThis.Document, fetchedUrl: URL) {
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim();
  if (!canonical) return fetchedUrl;
  try {
    const url = new URL(canonical, fetchedUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url : fetchedUrl;
  } catch {
    return fetchedUrl;
  }
}

function resolvePublishedAt(document: globalThis.Document) {
  const value =
    document.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ||
    document.querySelector('meta[name="date"]')?.getAttribute("content") ||
    document.querySelector("time[datetime]")?.getAttribute("datetime");
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeWebsiteMarkdown(html: string, fetchedUrl: URL) {
  const { document } = parseHTML(html);
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    try {
      anchor.setAttribute("href", new URL(href, fetchedUrl).toString());
    } catch {
      anchor.removeAttribute("href");
    }
  }
  const canonicalUrl = resolveCanonicalUrl(document as unknown as globalThis.Document, fetchedUrl);
  const publishedAt = resolvePublishedAt(document as unknown as globalThis.Document);
  const article = new Readability(document as unknown as globalThis.Document, {
    charThreshold: 40,
  }).parse();
  const fallback = document.querySelector("main, article") ?? document.body;
  const title = (article?.title || document.title || fetchedUrl.hostname).trim().slice(0, 300);
  const contentHtml = article?.content || fallback?.innerHTML || "";
  const safeHtml = sanitizeHtml(contentHtml, {
    allowedTags: [
      "article",
      "section",
      "div",
      "p",
      "br",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "blockquote",
      "pre",
      "code",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "strong",
      "b",
      "em",
      "i",
      "a",
    ],
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["http", "https", "mailto"],
  });
  const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
  const body = turndown
    .turndown(safeHtml)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (body.length < 20) throw new WebsiteSourceError("网页没有可导入的正文内容", 422);
  return { title, body, canonicalUrl, publishedAt };
}

export async function fetchWebsiteSource(input: {
  url: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  runtime?: WebsiteSourceRuntime;
}): Promise<WebsiteSourceSnapshot> {
  const runtime = input.runtime ?? defaultWebsiteSourceRuntime;
  const timeoutMs = Math.min(60_000, Math.max(1_000, input.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const maxBytes = Math.min(20 * 1024 * 1024, Math.max(1024, input.maxBytes ?? DEFAULT_MAX_BYTES));
  const maxRedirects = Math.min(8, Math.max(0, input.maxRedirects ?? DEFAULT_MAX_REDIRECTS));
  const sourceUrl = parseWebsiteUrl(input.url);
  let currentUrl = sourceUrl;

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const address = await resolvePublicAddress(currentUrl, runtime);
    let response: WebsiteResponse;
    try {
      response = await runtime.request(currentUrl, address, timeoutMs, maxBytes);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("超时")) throw new WebsiteSourceError(message, 504);
      if (message.includes("超过允许")) throw new WebsiteSourceError(message, 413);
      throw new WebsiteSourceError(`网站抓取失败：${message}`, 502);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location) throw new WebsiteSourceError("网站返回了无目标地址的重定向", 502);
      if (redirect === maxRedirects) throw new WebsiteSourceError("网站重定向次数过多", 422);
      currentUrl = parseWebsiteUrl(new URL(location, currentUrl).toString());
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new WebsiteSourceError(`网站抓取失败（HTTP ${response.status}）`, 502);
    }
    const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new WebsiteSourceError("当前仅支持导入 HTML 网页", 415);
    }
    const extracted = normalizeWebsiteMarkdown(response.body.toString("utf8"), currentUrl);
    const fetchedAt = new Date().toISOString();
    const persistedSourceUrl = sanitizePersistedUrl(sourceUrl);
    const persistedCanonicalUrl = sanitizePersistedUrl(extracted.canonicalUrl);
    const markdown = [
      `# ${extracted.title}`,
      "",
      `> 来源：${persistedCanonicalUrl}`,
      `> 抓取时间：${fetchedAt}`,
      "",
      extracted.body,
      "",
    ].join("\n");
    return {
      sourceUrl: persistedSourceUrl,
      canonicalUrl: persistedCanonicalUrl,
      domain: extracted.canonicalUrl.hostname.toLowerCase(),
      title: extracted.title,
      publishedAt: extracted.publishedAt,
      fetchedAt,
      contentHash: crypto.createHash("sha256").update(extracted.body).digest("hex"),
      markdown,
    };
  }
  throw new WebsiteSourceError("网站重定向次数过多", 422);
}
