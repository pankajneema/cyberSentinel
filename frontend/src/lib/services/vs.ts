import { apiDownload, apiFetch, Paginated } from "../api";

// ===================== Dashboard =====================
export interface VsDashboard {
  total_vulnerabilities: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  kev_count: number;
  avg_mttr_days: number;
  scan_coverage: number;
  sla_breaches: number;
}

export function fetchVsDashboard() {
  return apiFetch<VsDashboard>("/vs/dashboard");
}

// ===================== Profiles =====================
export type VsIntensity = "light" | "standard" | "deep";

export interface VsProfile {
  id: string;
  name: string;
  intensity: VsIntensity;
  engines: string[];
  authenticated: boolean;
  credential_id?: string | null;
  safe_mode: boolean;
  max_requests_per_sec: number;
  scan_window?: string | null;
  web_scan: boolean;
  created_at: string;
}

export interface CreateProfilePayload {
  name: string;
  intensity: VsIntensity;
  engines: string[];
  authenticated: boolean;
  credential_id?: string | null;
  safe_mode: boolean;
  max_requests_per_sec: number;
  scan_window?: string | null;
  web_scan: boolean;
}

export function fetchProfiles() {
  return apiFetch<VsProfile[]>("/vs/profiles");
}

export function createProfile(payload: CreateProfilePayload) {
  return apiFetch<VsProfile>("/vs/profiles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteProfile(id: string) {
  return apiFetch<{ message: string }>(`/vs/profiles/${id}`, {
    method: "DELETE",
  });
}

// ===================== Scans =====================
export type VsScheduleType = "QUICK" | "INTERVAL" | "CRON";
export type VsScanStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "PAUSED";

export interface VsScan {
  id: string;
  name: string;
  profile_id: string;
  asset_ids: string[];
  schedule_type: VsScheduleType;
  schedule_value?: string | null;
  status: VsScanStatus;
  last_run_at?: string | null;
  next_run_at?: string | null;
  created_at?: string;
}

export interface CreateScanPayload {
  name: string;
  profile_id: string;
  asset_ids: string[];
  schedule_type: VsScheduleType;
  schedule_value?: string | null;
}

export type UpdateScanPayload = Partial<CreateScanPayload>;

export interface VsScanRun {
  id: string;
  scan_id: string;
  status: VsScanStatus;
  triggered_by?: string | null;
  started_at?: string | null;
  // Real field names from VsScanRun.to_dict() (backend/api_service/models/vs_models.py) —
  // there is no "finished_at"/"findings_count"/"error" on the wire.
  completed_at?: string | null;
  engine_versions?: Record<string, string> | null;
  stats?: { targets: number; findings: number; new: number; reappeared: number; fixed: number } | null;
  error_message?: string | null;
}

export function fetchScans(page?: number, page_size?: number) {
  const search = new URLSearchParams();
  if (page) search.set("page", String(page));
  if (page_size) search.set("page_size", String(page_size));
  const qs = search.toString();
  return apiFetch<Paginated<VsScan>>(`/vs/scans${qs ? `?${qs}` : ""}`);
}

export function getScan(id: string) {
  return apiFetch<VsScan>(`/vs/scans/${id}`);
}

export function createScan(payload: CreateScanPayload) {
  return apiFetch<VsScan>("/vs/scans", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateScan(id: string, payload: UpdateScanPayload) {
  return apiFetch<VsScan>(`/vs/scans/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteScan(id: string) {
  return apiFetch<{ message: string }>(`/vs/scans/${id}`, {
    method: "DELETE",
  });
}

export function runScan(id: string) {
  return apiFetch<VsScan>(`/vs/scans/${id}/run`, { method: "POST" });
}

export function pauseScan(id: string) {
  return apiFetch<VsScan>(`/vs/scans/${id}/pause`, { method: "POST" });
}

export function resumeScan(id: string) {
  return apiFetch<VsScan>(`/vs/scans/${id}/resume`, { method: "POST" });
}

export function stopScan(id: string) {
  return apiFetch<VsScan>(`/vs/scans/${id}/stop`, { method: "POST" });
}

export function fetchScanRuns(id: string) {
  return apiFetch<VsScanRun[]>(`/vs/scans/${id}/runs`);
}

// ===================== Findings =====================
export type VsSeverity = "critical" | "high" | "medium" | "low" | "info";
export type VsConfidence = "tentative" | "firm" | "confirmed";
export type VsFindingStatus =
  | "open"
  | "confirmed"
  | "in_progress"
  | "remediated"
  | "verified"
  | "closed"
  | "accepted_risk"
  | "false_positive";

export interface VsRiskFactor {
  name: string;
  points: number;
  detail?: string;
}

export interface VsFinding {
  id: string;
  asset_id: string;
  scan_run_id?: string | null;
  source_engine: string;
  plugin_id?: string | null;
  cve_id?: string | null;
  title: string;
  description?: string | null;
  category?: string | null;
  // Runtime shape from the worker adapters (worker/tools/vs_engines.go) is an
  // object — {asset_id, host, port, service?, version?, url?} — never a plain
  // string; kept as a union for defensiveness against older/other producers.
  location?: {
    asset_id?: string | null;
    host?: string | null;
    port?: number | string | null;
    service?: string | null;
    version?: string | null;
    url?: string | null;
  } | string | null;
  evidence?: string | null;
  confidence: VsConfidence;
  severity: VsSeverity;
  cvss_base?: number | null;
  epss?: number | null;
  kev: boolean;
  composite_risk?: number | null;
  risk_factors?: VsRiskFactor[] | null;
  status: VsFindingStatus;
  assigned_to?: string | null;
  sla_due_at?: string | null;
  first_detected_at?: string | null;
  last_detected_at?: string | null;
}

export interface FindingListParams {
  severity?: string;
  status?: string;
  asset_id?: string;
  kev?: boolean;
  q?: string;
  page?: number;
  page_size?: number;
}

export function fetchFindings(params?: FindingListParams) {
  const search = new URLSearchParams();
  if (params?.severity && params.severity !== "all")
    search.set("severity", params.severity);
  if (params?.status && params.status !== "all")
    search.set("status", params.status);
  if (params?.asset_id) search.set("asset_id", params.asset_id);
  if (params?.kev) search.set("kev", "true");
  if (params?.q) search.set("q", params.q);
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Paginated<VsFinding>>(`/vs/findings${qs ? `?${qs}` : ""}`);
}

export function getFinding(id: string) {
  return apiFetch<VsFinding>(`/vs/findings/${id}`);
}

export function transitionFinding(
  id: string,
  payload: { status: VsFindingStatus; justification?: string }
) {
  return apiFetch<VsFinding>(`/vs/findings/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function assignFinding(
  id: string,
  payload: { assigned_to?: string | null }
) {
  return apiFetch<VsFinding>(`/vs/findings/${id}/assign`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// ===================== CVE =====================
export interface VsCvssVector {
  score: number;
  vector: string;
}

export interface VsCveDetail {
  cve_id: string;
  cvss_v31?: VsCvssVector | null;
  cvss_v40?: VsCvssVector | null;
  epss?: number | null;
  epss_percentile?: number | null;
  kev: boolean;
  kev_date_added?: string | null;
  kev_due_date?: string | null;
  cwe_ids?: string[] | null;
  affected_versions?: string[] | null;
  references?: string[] | null;
  published_at?: string | null;
  modified_at?: string | null;
}

export function fetchCve(cveId: string) {
  return apiFetch<VsCveDetail>(`/vs/cve/${cveId}`);
}

// ===================== Credentials =====================
export interface VsCredential {
  id: string;
  name: string;
  cred_type: string;
  username?: string | null;
  created_at: string;
}

export interface CreateCredentialPayload {
  name: string;
  cred_type: string;
  username?: string;
  secret: string;
}

export function fetchCredentials() {
  return apiFetch<VsCredential[]>("/vs/credentials");
}

export function createCredential(payload: CreateCredentialPayload) {
  return apiFetch<VsCredential>("/vs/credentials", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteCredential(id: string) {
  return apiFetch<{ message: string }>(`/vs/credentials/${id}`, {
    method: "DELETE",
  });
}

// ===================== Trends / Compliance / Verify / Reports =====================
export interface VsTrendPoint {
  date: string;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  kev: number;
  open: number;
  remediated: number;
}

export function fetchTrends(days = 30) {
  return apiFetch<{ points: VsTrendPoint[] }>(`/vs/trends?days=${days}`);
}

// Real shape from compliance_summary() (backend/api_service/scoring/vs_compliance.py) —
// `frameworks` is the actual per-framework map; `severity_counts`/`total_findings`/
// `open_findings` are org-wide summary fields, not additional "frameworks".
export interface VsComplianceControl {
  open_findings: number;
  severity_counts: Record<string, number>;
}

export interface VsComplianceFramework {
  controls: Record<string, VsComplianceControl>;
  open_control_count: number;
  severity_counts: Record<string, number>;
}

export interface VsComplianceSummary {
  total_findings: number;
  open_findings: number;
  severity_counts: Record<string, number>;
  frameworks: Record<string, VsComplianceFramework>;
  coverage: string[];
}

export function fetchCompliance() {
  return apiFetch<VsComplianceSummary>("/vs/compliance");
}

// Verification pass: re-scan the finding's asset to confirm/close it.
export function verifyFinding(id: string) {
  return apiFetch<{ status: string; run_id: string }>(`/vs/findings/${id}/verify`, {
    method: "POST",
  });
}

export function fetchVsReportJson(reportType = "executive") {
  return apiFetch<Record<string, unknown>>(`/vs/report?report_type=${reportType}&format=json`);
}

/** Download a VS report as a file (server filename preferred). */
export function downloadVsReport(
  reportType: string,
  format: "pdf" | "csv"
): Promise<void> {
  return apiDownload(
    `/vs/report?report_type=${encodeURIComponent(reportType)}&format=${format}`,
    `vs-${reportType}.${format}`
  );
}
