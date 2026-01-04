// API Configuration
const API_HOST = import.meta.env.VITE_API_URL || "http://localhost:8000";
export const API_BASE = `${API_HOST}/api/v1`;

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Get token from localStorage
  const token = localStorage.getItem("access_token");
  
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init?.headers || {}),
  };

  // Add Authorization header if token exists
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });

  // Handle unauthorized - redirect to login
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    window.location.href = "/login";
    throw new Error("Unauthorized");
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
export * from "./services/settings";
export * from "./services/activity";