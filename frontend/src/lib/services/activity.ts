import { apiFetch } from "../api";

// Types
export interface ActivityLog {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_name: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  changes?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

export interface ActivityListParams {
  skip?: number;
  limit?: number;
}

export interface AuditLogParams {
  skip?: number;
  limit?: number;
}

// API Functions
export function getActivity(params?: ActivityListParams) {
  const search = new URLSearchParams();
  if (params?.skip) search.set("skip", String(params.skip));
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return apiFetch<ActivityLog[]>(`/activity${qs ? `?${qs}` : ""}`);
}

export function getAuditLogs(params?: AuditLogParams) {
  const search = new URLSearchParams();
  if (params?.skip) search.set("skip", String(params.skip));
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return apiFetch<AuditLog[]>(`/audit-logs${qs ? `?${qs}` : ""}`);
}