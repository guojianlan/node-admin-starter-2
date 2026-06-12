"use client";

import { clearAuthToken, getAuthToken } from "@/lib/auth-token";
import type { ApiResponse } from "@/lib/response";
import { feedback } from "@/ui/feedback/feedback";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | Record<string, unknown> | null;
  skipAuthRedirect?: boolean;
  silent?: boolean;
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

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers);
  const body = normalizeBody(options.body);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
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
