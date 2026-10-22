"use client";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; fieldErrors?: Record<string, string[]> };

/** fetch() for our JSON API: always resolves, never throws; failures carry the standard error shape. */
export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (response.ok) return { ok: true, data: body as T };
    const error = body?.error ?? {};
    return {
      ok: false,
      status: response.status,
      code: error.code ?? "unknown",
      message: error.message ?? "Request failed.",
      fieldErrors: error.fieldErrors,
    };
  } catch {
    return { ok: false, status: 0, code: "network", message: "Network error." };
  }
}
