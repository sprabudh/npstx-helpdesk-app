/** Thin fetch wrapper: bearer token, JSON, and errors as ApiError { status, code, message, fieldErrors }. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors: Record<string, string> = {}) {
    super(message);
  }
}
const TOKEN_KEY = 'npstx.helpdesk.token';
const memoryStore = new Map<string, string>();
const stores = (): Storage[] => {
  const out: Storage[] = [];
  try {
    if (window.localStorage) out.push(window.localStorage);
  } catch {}
  try {
    if (window.sessionStorage) out.push(window.sessionStorage);
  } catch {}
  return out;
};
export function readStored(key: string): string | null {
  for (const s of stores()) {
    try {
      const value = s.getItem(key);
      if (value !== null) return value;
    } catch {}
  }
  return memoryStore.get(key) ?? null;
}
export function writeStored(key: string, value: string): void {
  memoryStore.set(key, value);
  for (const s of stores()) {
    try {
      s.setItem(key, value);
    } catch {}
  }
}
export function removeStored(key: string): void {
  memoryStore.delete(key);
  for (const s of stores()) {
    try {
      s.removeItem(key);
    } catch {}
  }
}
let token: string | null = readStored(TOKEN_KEY);
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);
export function setToken(t: string | null) {
  token = t;
  if (t) writeStored(TOKEN_KEY, t);
  else removeStored(TOKEN_KEY);
}
export const getToken = () => token;

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'), headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'The helpdesk service could not be reached. Check your connection and try again.');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? `Request failed (HTTP ${res.status})`, data?.details?.fieldErrors ?? {});
  }
  return data as T;
}
