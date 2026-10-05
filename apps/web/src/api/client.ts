export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let refreshHandler: (() => Promise<boolean>) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** 由 AuthProvider 注册：401 时静默续期一次，失败再跳登录页。 */
export function setRefreshHandler(handler: () => Promise<boolean>): void {
  refreshHandler = handler;
}

function cookie(name: string): string | null {
  const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : null;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  /** 内部使用：避免刷新逻辑递归 */
  skipRetry?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const needsCsrf = path.endsWith('/auth/refresh') || path.endsWith('/auth/logout');
  if (needsCsrf) {
    const token = cookie('hl_csrf');
    if (token) headers['X-CSRF-Token'] = token;
  }

  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body,
    credentials: 'include',
    signal: options.signal,
  });

  if (res.status === 401 && !options.skipRetry && refreshHandler) {
    const refreshed = await refreshHandler();
    if (refreshed) return api<T>(path, { ...options, skipRetry: true });
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, error?.code ?? 'INTERNAL', error?.message ?? '请求失败', error?.details);
  }
  return payload as T;
}

api.get = <T,>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
api.post = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
api.patch = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
api.del = <T,>(path: string) => api<T>(path, { method: 'DELETE' });
api.upload = <T,>(path: string, formData: FormData) => api<T>(path, { method: 'POST', formData });

/** 调用已经带 /api/v1 前缀的绝对路径（例如服务端返回的媒体 URL）。 */
api.absolute = <T,>(path: string) => api<T>(path.replace(/^\/api\/v1/, ''));
