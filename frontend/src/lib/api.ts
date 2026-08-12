// API Configuration
import { getTokens, setTokens, clearTokens } from "./token-storage";

const API_HOST = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const API_BASE = `${API_HOST}/api/v1`;

// Concurrent 401s share a single in-flight refresh instead of each firing
// their own — the second caller just awaits the first's result.
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const tokens = getTokens();
  if (!tokens?.refreshToken) return false;

  if (!refreshPromise) {
    refreshPromise = fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) return false;
        const data = await res.json();
        setTokens(data.access_token, data.refresh_token);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

function bounceToLogin(): void {
  clearTokens();
  window.location.href = "/login";
}

/**
 * Pulls a human-readable message out of an error response: prefers the
 * backend's JSON `detail` field, falls back to raw text, then a generic
 * "HTTP <status>" if the body is empty or unparseable.
 */
async function extractErrorDetail(res: Response): Promise<string | null> {
  const body = await res
    .clone()
    .json()
    .catch(() => null);
  if (body?.detail) {
    return typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
  }
  const text = await res.text().catch(() => "");
  return text || null;
}

async function apiFetch<T>(path: string, init?: RequestInit, _retried = false): Promise<T> {
  const token = getTokens()?.accessToken;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init?.headers || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  // 401 = access token invalid/expired -> refresh once and retry; if that
  // fails too, the session is genuinely over.
  if (res.status === 401) {
    if (!_retried && (await tryRefresh())) {
      return apiFetch<T>(path, init, true);
    }
    bounceToLogin();
    throw new Error("Unauthorized");
  }

  // 403 = authenticated but not allowed (RBAC or a business-rule gate like
  // ownership verification). Do NOT log out — just surface the backend's
  // actual reason instead of a generic message that hides it.
  if (res.status === 403) {
    const detail = await extractErrorDetail(res);
    throw new Error(detail || "You don't have permission to perform this action.");
  }

  if (!res.ok) {
    const detail = await extractErrorDetail(res);
    throw new Error(detail || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Build a query string from params, skipping null/undefined/empty values.
 * Returns "" or "?k=v&...".
 */
export function buildQuery(
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Authenticated blob fetch with the same 401/403 handling as apiFetch.
 * Returns the blob plus the server-provided filename (from Content-Disposition), if any.
 */
export async function apiFetchBlob(
  path: string,
  init?: RequestInit,
  _retried = false
): Promise<{ blob: Blob; filename: string | null }> {
  const token = getTokens()?.accessToken;
  const headers: HeadersInit = { ...(init?.headers || {}) };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    if (!_retried && (await tryRefresh())) {
      return apiFetchBlob(path, init, true);
    }
    bounceToLogin();
    throw new Error("Unauthorized");
  }
  if (res.status === 403) {
    const detail = await extractErrorDetail(res);
    throw new Error(detail || "You don't have permission to perform this action.");
  }
  if (!res.ok) {
    const detail = await extractErrorDetail(res);
    throw new Error(detail || "Download failed");
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return { blob, filename: match ? match[1] : null };
}

/** Trigger a browser download for an in-memory blob. */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Download an API path as a file. Uses the server-provided filename when
 * available, falling back to the given one.
 */
export async function apiDownload(
  path: string,
  fallbackFilename: string
): Promise<void> {
  const { blob, filename } = await apiFetchBlob(path);
  triggerBrowserDownload(blob, filename ?? fallbackFilename);
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// Export the apiFetch function for use in service files
export { apiFetch };

// Re-export all services
export * from "./services/auth";
export * from "./services/user";
export * from "./services/profile";
export * from "./services/account";
export * from "./services/billing";
export * from "./services/services";
export * from "./services/assets";
export * from "./services/asm";
export * from "./services/vs";
export * from "./services/tasks";
export * from "./services/reports";
export * from "./services/activity";
export * from "./services/team";
export * from "./services/notifications";
