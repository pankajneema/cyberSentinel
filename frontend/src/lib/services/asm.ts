import { apiFetch, Paginated } from "../api";

// Types
export interface AsmDiscovery {
  id: string;
  name: string;
  asset_type: string;
  discovery_type: string;
  intensity: string;
  schedule_type: string;
  schedule_value: string | null;
  status: string;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDiscoveryPayload {
  name: string;
  asset_type: "domain" | "ip" | "cloud" | "repo" | "saas" | "user";
  target_source: "FROM_ASSET" | "MANUAL_ENTRY";
  asset_ids?: string[] | null;
  manual_targets?: string[] | null;
  discovery_type: "QUICK" | "MANUAL" | "SCHEDULED";
  intensity: "LIGHT" | "NORMAL" | "DEEP";
  schedule_type: "NONE" | "INTERVAL" | "CRON";
  schedule_value?: string | null;
}

export interface UpdateDiscoveryPayload {
  name?: string;
  intensity?: "LIGHT" | "NORMAL" | "DEEP";
  schedule_type?: "NONE" | "INTERVAL" | "CRON";
  schedule_value?: string | null;
  status?: "ACTIVE" | "PAUSED";
}

export interface AsmDashboard {
  attack_surface_score: number;
  total_discoveries: number;
  active_discoveries: number;
  last_discovery_run: string | null;
}

export interface DiscoveryListParams {
  page?: number;
  page_size?: number;
}

// API Functions
export function fetchDiscoveries(params?: DiscoveryListParams) {
  const search = new URLSearchParams();
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Paginated<AsmDiscovery>>(`/asm/discoveries${qs ? `?${qs}` : ""}`);
}

export function createDiscovery(payload: CreateDiscoveryPayload) {
  return apiFetch<AsmDiscovery>("/asm/discoveries", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getDiscovery(discoveryId: string) {
  return apiFetch<AsmDiscovery>(`/asm/discoveries/${discoveryId}`);
}

export function updateDiscovery(discoveryId: string, payload: UpdateDiscoveryPayload) {
  return apiFetch<AsmDiscovery>(`/asm/discoveries/${discoveryId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteDiscovery(discoveryId: string) {
  return apiFetch<{ message: string }>(`/asm/discoveries/${discoveryId}`, {
    method: "DELETE",
  });
}

export function fetchAsmDashboard() {
  return apiFetch<AsmDashboard>("/asm/dashboard");
}