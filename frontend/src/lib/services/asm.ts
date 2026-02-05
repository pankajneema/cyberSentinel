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
  status?: "RUNNING" | "PAUSED" | "FAILED" | "COMPLETED";
}

export interface AsmDashboard {
  attack_surface_score: number;
  total_discoveries: number;
  active_discoveries: number;
  last_discovery_run: string | null;
}

export interface AsmOverview {
  attack_surface_index: number;
  total_discoveries: number;
  active_discoveries: number;
  last_discovery_run: string | null;
  asset_counts: {
    domains: number;
    subdomains: number;
    ips: number;
    services: number;
    assets_total: number;
  };
  exposure_summary: {
    public_assets: number;
    internet_facing_services: number;
    unknown_assets: number;
  };
  exposure_breakdown: Array<{
    label: string;
    count: number;
  }>;
  exposure_trend: number;
  top_exposed_assets: Array<{
    id: string;
    name: string;
    type: string;
    exposure: string;
    exposure_score: number;
    tags: string[];
    status: string;
    last_seen: string | null;
  }>;
  recent_activity: Array<{
    id?: string;
    action: string;
    asset: string;
    time: string;
    type: string;
  }>;
}

export interface AsmSubdomain {
  id: string;
  asm_discovery_id: string;
  asset_id: string;
  subdomain: string;
  created_at?: string | null;
  asset_name?: string | null;  // Parent domain/asset name
  asset_type?: string | null;  // Parent asset type
}

export interface AsmDiscoveryRun {
  id: string;
  asm_discovery_id: string;
  user_id: string;
  triggered_by: string;
  run_mode: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  error_message?: string | null;
  summary?: any;
  created_at?: string | null;
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

export function fetchAsmOverview() {
  return apiFetch<AsmOverview>("/asm/dashboard/overview");
}

export function fetchSubdomains(discoveryId?: string, page = 1, page_size = 50) {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("page_size", String(page_size));
  if (discoveryId) qs.set("discovery_id", discoveryId);
  return apiFetch<Paginated<AsmSubdomain>>(`/asm/subdomains?${qs.toString()}`);
}

export function getRunDetail(runId: string) {
  return apiFetch<AsmDiscoveryRun>(`/asm/runs/${runId}`);
}

export function fetchDiscoveryRuns(discoveryId: string, page = 1, page_size = 50) {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("page_size", String(page_size));
  return apiFetch<Paginated<AsmDiscoveryRun>>(`/asm/discoveries/${discoveryId}/runs?${qs.toString()}`);
}

export function fetchAllRuns(page = 1, page_size = 50) {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("page_size", String(page_size));
  return apiFetch<Paginated<AsmDiscoveryRun>>(`/asm/runs?${qs.toString()}`);
}