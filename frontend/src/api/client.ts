/** Thin fetch wrapper: bearer token, JSON, and errors as ApiError { status, code, message, fieldErrors }. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fieldErrors: Record<string, string> = {}) {
    super(message);
  }
}
import { API_BASE, csrfToken, forgetCsrf, isBackground, PORTAL_MODE } from '../lib/portal';

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

/** Headers every API request needs: the token and, behind the portal, CSRF and background marking. */
export async function authHeaders(method = 'GET'): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (PORTAL_MODE) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['X-CSRF-Token'] = await csrfToken();
    if (isBackground()) headers['X-Background-Request'] = '1';
  }
  return headers;
}

export const apiUrl = (path: string) => `${API_BASE}${path}`;

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}, retried = false): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  const headers = await authHeaders(method);
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { method, headers, body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'The helpdesk service could not be reached. Check your connection and try again.');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null; // e.g. an HTML error page from the gateway
  }
  // The gateway refused the CSRF token (it rotates with the portal session): fetch a new one, retry once.
  if (PORTAL_MODE && res.status === 403 && !data && !retried && headers['X-CSRF-Token'] !== undefined) {
    forgetCsrf();
    return api<T>(path, opts, true);
  }
  if (!res.ok) {
    // The bridge's own 401 means "not signed in to the portal": the caller handles it (no loop).
    if (res.status === 401 && onUnauthorized && path !== '/auth/platform-sso') onUnauthorized();
    throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? `Request failed (HTTP ${res.status})`, data?.details?.fieldErrors ?? {});
  }
  return data as T;
}
