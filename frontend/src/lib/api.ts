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
export * from "./services/scans";
export * from "./services/vs";
export * from "./services/tasks";
export * from "./services/reports";
export * from "./services/settings";
export * from "./services/activity";
export * from "./services/team";
