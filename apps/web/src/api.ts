import type { ApiErrorBody } from '@skill-hub/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    /** 原始错误响应体（如 409 名称冲突时带回已有 Skill 的 id） */
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/** 调用后台 /api 接口：JSON 收发（body 为 FormData 时按 multipart 上传），非 2xx 抛 ApiError（message 取服务端提示）。 */
export async function api<T = void>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const isJson = init.body !== undefined && !(init.body instanceof FormData);
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: isJson ? { 'Content-Type': 'application/json' } : undefined,
    body: isJson ? JSON.stringify(init.body) : (init.body as FormData | undefined),
  });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const body = data as Partial<ApiErrorBody> | undefined;
    const message = (Array.isArray(body?.message) ? body.message[0] : body?.message);
    throw new ApiError(res.status, message ?? `请求失败（HTTP ${res.status}）`, body?.code, body);
  }
  return data as T;
}

/** Only navigate after the server has invalidated the session. */
export async function logout(): Promise<void> {
  try { await api('/auth/logout', { method: 'POST' }); } catch (err) { if (!(err instanceof ApiError && err.status === 401)) throw err; }
}

/** Only allow local application paths for login return links. */
export function safeNext(next: string | null): string | null {
  return next && /^\/(?:admin|tenant|workspace|skills)(?:\/|$|\?)/.test(next) && !next.includes('\\') ? next : null;
}
