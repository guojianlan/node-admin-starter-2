export type ApiShowType = 0 | 1 | 2 | 3 | 4 | 5 | 99;

export type ApiResponse<T = unknown> = {
  success: boolean;
  msg: string;
  data?: T;
  showType?: ApiShowType;
  errorCode?: string | number;
  description?: string;
  placement?: "top" | "topLeft" | "topRight" | "bottom" | "bottomLeft" | "bottomRight";
};

export type PageResult<T> = {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
};

export function success<T>(data: T, msg = "success"): ApiResponse<T> {
  return {
    success: true,
    msg,
    data,
  };
}

export function fail(msg: string, options: Partial<ApiResponse> = {}): ApiResponse {
  return {
    success: false,
    msg,
    ...options,
  };
}
