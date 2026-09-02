"use client";

import { clearAuthToken, getAuthToken } from "@/lib/auth-token";
import { getActiveSaasContextHeaders } from "@/lib/saas-context";
import type { ApiResponse } from "@/lib/response";
import { feedback } from "@/ui/feedback/feedback";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | null;
  skipAuthRedirect?: boolean;
  silent?: boolean;
};

type TextStreamRequestOptions = RequestOptions & {
  onChunk: (chunk: string) => void;
  onResponse?: (response: Response) => void;
};

export type EventStreamMessage = {
  event: string;
  data: unknown;
  id?: number;
};

type EventStreamRequestOptions = RequestOptions & {
  onEvent?: (message: EventStreamMessage) => void;
  onChunk?: (chunk: string) => void;
  onResponse?: (response: Response) => void;
};

export class ApiError extends Error {
  status: number;
  response?: ApiResponse;

  constructor(message: string, status: number, response?: ApiResponse) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.response = response;
  }
}

function buildUrl(path: string) {
  if (/^https?:\/\//.test(path)) return path;
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  return `${baseUrl}${path}`;
}

function normalizeBody(body: RequestOptions["body"]) {
  if (!body) return undefined;
  if (body instanceof FormData || body instanceof Blob || typeof body === "string") {
    return body;
  }
  return JSON.stringify(body);
}

function applyAuthAndContextHeaders(headers: Headers, token: string | null) {
  if (!token) return;
  headers.set("Authorization", `Bearer ${token}`);
  const saasContextHeaders = getActiveSaasContextHeaders();
  if (saasContextHeaders) {
    Object.entries(saasContextHeaders).forEach(([key, value]) => headers.set(key, value));
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers);
  const body = normalizeBody(options.body);

  applyAuthAndContextHeaders(headers, token);
  if (body && !(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "application/json");

  const response = await fetch(buildUrl(path), {
    ...options,
    headers,
    body,
  });

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    payload = {
      success: false,
      msg: response.statusText || "Request failed",
    };
  }

  if (response.status === 401) {
    clearAuthToken();
    if (!options.skipAuthRedirect && typeof window !== "undefined") {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?redirect=${redirect}`);
    }
  }

  if (!response.ok || !payload.success) {
    const message = payload.msg || "Request failed";
    if (!options.silent) {
      feedback.error(message);
    }
    throw new ApiError(message, response.status, payload);
  }

  return payload.data as T;
}

export async function requestTextStream(
  path: string,
  options: TextStreamRequestOptions,
): Promise<string> {
  const token = getAuthToken();
  const headers = new Headers(options.headers);
  const body = normalizeBody(options.body);

  applyAuthAndContextHeaders(headers, token);
  if (body && !(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "text/plain");

  const response = await fetch(buildUrl(path), {
    ...options,
    headers,
    body,
  });

  options.onResponse?.(response);

  if (response.status === 401) {
    clearAuthToken();
    if (!options.skipAuthRedirect && typeof window !== "undefined") {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?redirect=${redirect}`);
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = response.statusText || "Request failed";
    try {
      const payload = JSON.parse(text) as ApiResponse;
      message = payload.msg || message;
    } catch {
      message = text || message;
    }
    if (!options.silent) {
      feedback.error(message);
    }
    throw new ApiError(message, response.status);
  }

  if (!response.body) throw new ApiError("响应没有可读取的流", response.status);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let output = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      output += chunk;
      options.onChunk(chunk);
    }
    const tail = decoder.decode();
    if (tail) {
      output += tail;
      options.onChunk(tail);
    }
    return output;
  } finally {
    reader.releaseLock();
  }
}

export function parseEventStreamBlock(block: string): EventStreamMessage | null {
  let event = "message";
  let id: number | undefined;
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("id:")) {
      const parsed = Number(line.slice("id:".length).trim());
      if (Number.isSafeInteger(parsed) && parsed > 0) id = parsed;
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || event;
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  const rawData = dataLines.join("\n");
  let data: unknown = rawData;
  try {
    data = JSON.parse(rawData);
  } catch {
    data = rawData;
  }
  return { event, data, ...(id == null ? {} : { id }) };
}

export async function requestEventStream(
  path: string,
  options: EventStreamRequestOptions = {},
): Promise<string> {
  const token = getAuthToken();
  const headers = new Headers(options.headers);
  const body = normalizeBody(options.body);

  applyAuthAndContextHeaders(headers, token);
  if (body && !(body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Accept", "text/event-stream");

  const response = await fetch(buildUrl(path), {
    ...options,
    headers,
    body,
  });

  options.onResponse?.(response);

  if (response.status === 401) {
    clearAuthToken();
    if (!options.skipAuthRedirect && typeof window !== "undefined") {
      const redirect = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?redirect=${redirect}`);
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let message = response.statusText || "Request failed";
    try {
      const payload = JSON.parse(text) as ApiResponse;
      message = payload.msg || message;
    } catch {
      message = text || message;
    }
    if (!options.silent) {
      feedback.error(message);
    }
    throw new ApiError(message, response.status);
  }

  if (!response.body) throw new ApiError("响应没有可读取的流", response.status);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let streamError = "";

  const dispatchBlock = (block: string) => {
    const message = parseEventStreamBlock(block);
    if (!message) return;
    options.onEvent?.(message);
    if (
      message.event === "delta" &&
      message.data &&
      typeof message.data === "object" &&
      "text" in message.data &&
      typeof (message.data as { text?: unknown }).text === "string"
    ) {
      const text = (message.data as { text: string }).text;
      output += text;
      options.onChunk?.(text);
    }
    if (
      message.event === "error" &&
      message.data &&
      typeof message.data === "object" &&
      "message" in message.data
    ) {
      streamError = String((message.data as { message?: unknown }).message || "流式请求失败");
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.search(/\r?\n\r?\n/);
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex);
        const match = buffer.slice(separatorIndex).match(/^\r?\n\r?\n/);
        buffer = buffer.slice(separatorIndex + (match?.[0].length ?? 2));
        dispatchBlock(block);
        separatorIndex = buffer.search(/\r?\n\r?\n/);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatchBlock(buffer);
  } finally {
    reader.releaseLock();
  }

  if (streamError) {
    if (!options.silent) feedback.error(streamError);
    throw new ApiError(streamError, response.status);
  }

  return output;
}

export function buildQueryString(params: Record<string, unknown>) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== "") {
          searchParams.append(key, String(item));
        }
      });
      return;
    }
    searchParams.set(key, String(value));
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
}
