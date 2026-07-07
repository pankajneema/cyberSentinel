// API Configuration
import { supabase, getAccessToken } from "./supabase";

const API_HOST = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const API_BASE = `${API_HOST}/api/v1`;

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Identity comes from the Supabase session, not localStorage (audit S-2).
  const token = await getAccessToken();

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

  // 401 = session invalid/expired -> sign out and bounce to login.
  if (res.status === 401) {
    await supabase.auth.signOut();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  // 403 = authenticated but not allowed (RBAC). Do NOT log out — just surface it.
  if (res.status === 403) {
    throw new Error("You don't have permission to perform this action.");
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(errorText);
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
  init?: RequestInit
): Promise<{ blob: Blob; filename: string | null }> {
  const token = await getAccessToken();
  const headers: HeadersInit = { ...(init?.headers || {}) };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (res.status === 401) {
    await supabase.auth.signOut();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (res.status === 403) {
    throw new Error("You don't have permission to perform this action.");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(text || "Download failed");
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
