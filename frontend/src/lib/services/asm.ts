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
  asset_type: "domain" | "ip" | "cloud";
  target_source: "FROM_ASSET" | "MANUAL_ENTRY";
  asset_ids?: string[] | null;
  manual_targets?: string[] | null;
  intensity: "LIGHT" | "NORMAL" | "DEEP";
  schedule_type: "QUICK" | "INTERVAL" | "CRON";
  schedule_value?: string | null;
}

export interface UpdateDiscoveryPayload {
  name?: string;
  intensity?: "LIGHT" | "NORMAL" | "DEEP";
  schedule_type?: "QUICK" | "INTERVAL" | "CRON";
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
    cloud: number;
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
  status?: string;  // active, inactive, archived
  resolved?: boolean | null;  // DNS resolution status: true=resolved, false=unresolved, null=not checked
  ip_count?: number;  // Number of IPs for this subdomain
  created_at?: string | null;
  asset_name?: string | null;  // Parent domain/asset name
  asset_type?: string | null;  // Parent asset type
}

export interface AsmIP {
  id: string;
  asm_discovery_id: string;
  asset_id: string;
  ip_address: string;
  subdomain_id?: string | null;  // Parent subdomain ID
  subdomain?: string | null;  // Denormalized subdomain name
  status: string;
  exposure_score?: number | null;
  exposure_level: string;  // low, medium, high, not_calculated
  reachable?: boolean | null;
  country?: string | null;
  country_code?: string | null;
  region?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  asn?: string | null;
  asn_org?: string | null;
  isp?: string | null;
  open_ports?: number | null;
  created_at?: string | null;
}

export interface AsmIPGeoPoint {
  id: string;
  ip_address: string;
  subdomain?: string | null;
  asset_id: string;
  asm_discovery_id: string;
  country?: string | null;
  country_code?: string | null;
  region?: string | null;
  city?: string | null;
  latitude: number;
  longitude: number;
  asn?: string | null;
  asn_org?: string | null;
  isp?: string | null;
}

export interface AsmIPGeoMapResponse {
  items: AsmIPGeoPoint[];
  countries: Array<{ country: string; count: number }>;
  total: number;
}

export interface AsmPort {
  id: string;
  asm_discovery_id: string;
  asset_id: string;
  ip_address: string;
  port: number;
  protocol?: string | null;
  status?: string | null;
  service?: string | null;
  banner?: string | null;
  created_at?: string | null;
}

export interface AsmService {
  id: string;
  asm_discovery_id: string;
  asset_id: string;
  ip_address: string;
  port: number;
  service_name: string;
  version?: string | null;
  product?: string | null;
  created_at?: string | null;
}

export interface AsmSSLCert {
  id: string;
  asm_discovery_id: string;
  asset_id: string;
  host: string;
  port: number;
  protocol?: string | null;
  cipher?: string | null;
  certificate_issuer?: string | null;
  certificate_subject?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  created_at?: string | null;
}

export interface AsmAPIEndpoint {
  id: string;
  asm_discovery_id: string;
  asset_id: string;
  url: string;
  method?: string | null;
  status_code?: number | null;
  endpoint_type?: string | null;
  created_at?: string | null;
}

export interface AsmCloudResource {
  id: string;
  asm_discovery_id: string;
  asset_id: string;
  service: string;
  resource_type: string;
  resource_name: string;
  access_status?: string | null;
  region?: string | null;
  created_at?: string | null;
}

export interface AsmAdminEndpoint {
  id: string;
  asm_discovery_id: string;
  asset_id: string;
  url: string;
  status_code?: number | null;
  endpoint_type?: string | null;
  created_at?: string | null;
}

export interface AsmBackupFile {
  id: string;
  asm_discovery_id: string;
  asset_id: string;
  file_url: string;
  file_extension?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface AsmChange {
  id: string;
  asm_discovery_id: string;
  asset_id: string;
  changes?: any[] | null;
  message?: string | null;
  created_at?: string | null;
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
  duration_seconds?: number | null;
  error_message?: string | null;
  summary?: any;
  created_at?: string | null;
}

export interface AsmSettingsPayload {
  thresholds: {
    critical: number;
    high: number;
    medium: number;
  };
  signals?: Record<string, number>;
  notifications?: {
    high_exposure: boolean;
    medium_exposure: boolean;
    new_assets: boolean;
    discovery_completed: boolean;
    daily_summary: boolean;
    weekly_report: boolean;
    email_recipients?: string;
    slack_webhook?: string;
    teams_webhook?: string;
  };
  automation?: {
    auto_create_tickets: boolean;
    auto_assign_assets: boolean;
    auto_verify_changes: boolean;
    auto_archive_stale: boolean;
  };
  suppression?: Array<{
    pattern: string;
    reason: string;
    expires: string;
  }>;
  grouping?: Array<{
    pattern: string;
    group: string;
    tags: string[];
  }>;
}

export interface AsmSettingsResponse {
  id: string | null;
  user_id: string;
  settings: AsmSettingsPayload;
  created_at: string | null;
  updated_at: string | null;
}

export interface DiscoveryListParams {
  page?: number;
  page_size?: number;
  q?: string;
  sort_by?: string;
  sort_dir?: string;
}

// API Functions
export function fetchDiscoveries(params?: DiscoveryListParams) {
  const search = new URLSearchParams();
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  if (params?.q) search.set("q", params.q);
  if (params?.sort_by) search.set("sort_by", params.sort_by);
  if (params?.sort_dir) search.set("sort_dir", params.sort_dir);
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

export function getAsmSettings() {
  return apiFetch<AsmSettingsResponse>("/asm/settings");
}

export function updateAsmSettings(payload: AsmSettingsPayload) {
  return apiFetch<AsmSettingsResponse>("/asm/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function fetchPorts(params?: { discovery_id?: string; ip_address?: string; q?: string; sort_by?: string; sort_dir?: string; page?: number; page_size?: number; }) {
  const search = new URLSearchParams();
  if (params?.discovery_id) search.set("discovery_id", params.discovery_id);
  if (params?.ip_address) search.set("ip_address", params.ip_address);
  if (params?.q) search.set("q", params.q);
  if (params?.sort_by) search.set("sort_by", params.sort_by);
  if (params?.sort_dir) search.set("sort_dir", params.sort_dir);
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Paginated<AsmPort>>(`/asm/ports${qs ? `?${qs}` : ""}`);
}

export function fetchServices(params?: { discovery_id?: string; ip_address?: string; q?: string; sort_by?: string; sort_dir?: string; page?: number; page_size?: number; }) {
  const search = new URLSearchParams();
  if (params?.discovery_id) search.set("discovery_id", params.discovery_id);
  if (params?.ip_address) search.set("ip_address", params.ip_address);
  if (params?.q) search.set("q", params.q);
  if (params?.sort_by) search.set("sort_by", params.sort_by);
  if (params?.sort_dir) search.set("sort_dir", params.sort_dir);
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Paginated<AsmService>>(`/asm/services${qs ? `?${qs}` : ""}`);
}

export function fetchSSLCerts(params?: { discovery_id?: string; host?: string; subdomain_id?: string; q?: string; sort_by?: string; sort_dir?: string; page?: number; page_size?: number; }) {
  const search = new URLSearchParams();
  if (params?.discovery_id) search.set("discovery_id", params.discovery_id);
  if (params?.host) search.set("host", params.host);
  if (params?.subdomain_id) search.set("subdomain_id", params.subdomain_id);
  if (params?.q) search.set("q", params.q);
  if (params?.sort_by) search.set("sort_by", params.sort_by);
  if (params?.sort_dir) search.set("sort_dir", params.sort_dir);
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Paginated<AsmSSLCert>>(`/asm/ssl${qs ? `?${qs}` : ""}`);
}

export function fetchApiEndpoints(params?: { discovery_id?: string; subdomain_id?: string; q?: string; sort_by?: string; sort_dir?: string; page?: number; page_size?: number; }) {
  const search = new URLSearchParams();
  if (params?.discovery_id) search.set("discovery_id", params.discovery_id);
  if (params?.subdomain_id) search.set("subdomain_id", params.subdomain_id);
  if (params?.q) search.set("q", params.q);
  if (params?.sort_by) search.set("sort_by", params.sort_by);
  if (params?.sort_dir) search.set("sort_dir", params.sort_dir);
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Paginated<AsmAPIEndpoint>>(`/asm/api-endpoints${qs ? `?${qs}` : ""}`);
}

export function fetchCloudResources(params?: { discovery_id?: string; q?: string; sort_by?: string; sort_dir?: string; page?: number; page_size?: number; }) {
  const search = new URLSearchParams();
  if (params?.discovery_id) search.set("discovery_id", params.discovery_id);
  if (params?.q) search.set("q", params.q);
  if (params?.sort_by) search.set("sort_by", params.sort_by);
  if (params?.sort_dir) search.set("sort_dir", params.sort_dir);
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Paginated<AsmCloudResource>>(`/asm/cloud-resources${qs ? `?${qs}` : ""}`);
}

export function fetchAdminEndpoints(params?: { discovery_id?: string; subdomain_id?: string; q?: string; sort_by?: string; sort_dir?: string; page?: number; page_size?: number; }) {
  const search = new URLSearchParams();
  if (params?.discovery_id) search.set("discovery_id", params.discovery_id);
  if (params?.subdomain_id) search.set("subdomain_id", params.subdomain_id);
  if (params?.q) search.set("q", params.q);
  if (params?.sort_by) search.set("sort_by", params.sort_by);
  if (params?.sort_dir) search.set("sort_dir", params.sort_dir);
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Paginated<AsmAdminEndpoint>>(`/asm/admin-endpoints${qs ? `?${qs}` : ""}`);
}

export function fetchBackupFiles(params?: { discovery_id?: string; subdomain_id?: string; q?: string; sort_by?: string; sort_dir?: string; page?: number; page_size?: number; }) {
  const search = new URLSearchParams();
  if (params?.discovery_id) search.set("discovery_id", params.discovery_id);
  if (params?.subdomain_id) search.set("subdomain_id", params.subdomain_id);
  if (params?.q) search.set("q", params.q);
  if (params?.sort_by) search.set("sort_by", params.sort_by);
  if (params?.sort_dir) search.set("sort_dir", params.sort_dir);
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Paginated<AsmBackupFile>>(`/asm/backup-files${qs ? `?${qs}` : ""}`);
}

export function fetchChanges(params?: { discovery_id?: string; q?: string; sort_by?: string; sort_dir?: string; page?: number; page_size?: number; }) {
  const search = new URLSearchParams();
  if (params?.discovery_id) search.set("discovery_id", params.discovery_id);
  if (params?.q) search.set("q", params.q);
  if (params?.sort_by) search.set("sort_by", params.sort_by);
  if (params?.sort_dir) search.set("sort_dir", params.sort_dir);
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Paginated<AsmChange>>(`/asm/changes${qs ? `?${qs}` : ""}`);
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

export function fetchDiscoveryRuns(
  discoveryId: string,
  page = 1,
  page_size = 50,
  q?: string,
  sort_by?: string,
  sort_dir?: string,
) {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("page_size", String(page_size));
  if (q) qs.set("q", q);
  if (sort_by) qs.set("sort_by", sort_by);
  if (sort_dir) qs.set("sort_dir", sort_dir);
  return apiFetch<Paginated<AsmDiscoveryRun>>(`/asm/discoveries/${discoveryId}/runs?${qs.toString()}`);
}

export function fetchAllRuns(
  page = 1,
  page_size = 50,
  q?: string,
  sort_by?: string,
  sort_dir?: string,
) {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("page_size", String(page_size));
  if (q) qs.set("q", q);
  if (sort_by) qs.set("sort_by", sort_by);
  if (sort_dir) qs.set("sort_dir", sort_dir);
  return apiFetch<Paginated<AsmDiscoveryRun>>(`/asm/runs?${qs.toString()}`);
}

export function fetchSubdomainIPs(subdomainId: string, page = 1, page_size = 50) {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("page_size", String(page_size));
  return apiFetch<Paginated<AsmIP>>(`/asm/subdomains/${subdomainId}/ips?${qs.toString()}`);
}

export function getSubdomainDetail(subdomainId: string) {
  return apiFetch<AsmSubdomain & { preview_ips?: AsmIP[] }>(`/asm/subdomains/${subdomainId}`);
}

export function fetchAllIPs(page = 1, page_size = 50) {
  const qs = new URLSearchParams();
  qs.set("page", String(page));
  qs.set("page_size", String(page_size));
  return apiFetch<Paginated<AsmIP>>(`/asm/ips?${qs.toString()}`);
}

export function fetchIPGeoMap(discovery_id?: string, max_points = 3000) {
  const qs = new URLSearchParams();
  qs.set("max_points", String(max_points));
  if (discovery_id) qs.set("discovery_id", discovery_id);
  return apiFetch<AsmIPGeoMapResponse>(`/asm/ips/geo-map?${qs.toString()}`);
}
