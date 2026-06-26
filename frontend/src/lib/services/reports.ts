import { apiFetch, API_BASE } from "../api";
import { getAccessToken } from "../supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ReportModule = "all" | "asm" | "vs";
export type ReportType =
  | "executive"
  | "technical"
  | "compliance"
  | "assets"
  | "vulnerability";
export type ReportFormat = "pdf" | "csv" | "json";
export type ScheduleFrequency = "daily" | "weekly" | "monthly";

export interface ReportKeyFinding {
  severity: string;
  title: string;
  count: number;
}

export interface ReportContent {
  meta?: {
    module?: string;
    report_type?: string;
    date_range?: string | null;
    generated_at?: string;
  };
  summary?: {
    total_assets: number;
    public_assets: number;
    internal_assets: number;
    type_breakdown: Record<string, number>;
    exposure_breakdown: Record<string, number>;
  };
  top_exposed_assets?: {
    name: string;
    type: string;
    exposure: string;
    risk_score: number | null;
  }[];
  vulnerabilities?: {
    total: number;
    by_severity: Record<string, number>;
    note?: string;
  };
  key_findings?: ReportKeyFinding[];
  recommendations?: string[];
}

export interface Report {
  id: string;
  name: string;
  module: string;
  type: string;
  format: string;
  dateRange?: string | null;
  date?: string | null;
  size: string;
  sizeBytes: number;
  sections: string[];
  status: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  content?: ReportContent | null;
}

export interface ScheduledReport {
  id: string;
  name: string;
  module: string;
  type: string;
  format: string;
  frequency: string;
  recipients: string[];
  enabled: boolean;
  nextRun?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface GenerateReportPayload {
  name?: string;
  module: ReportModule;
  report_type: ReportType;
  format: ReportFormat;
  date_range?: string;
  sections?: string[];
}

export interface ScheduledReportPayload {
  name: string;
  module: ReportModule;
  report_type: ReportType;
  format: ReportFormat;
  frequency: ScheduleFrequency;
  recipients?: string[];
  enabled?: boolean;
}

export interface ReportListResponse {
  items: Report[];
  total: number;
}

export interface ScheduledReportListResponse {
  items: ScheduledReport[];
  total: number;
}

export interface ReportListParams {
  module?: string;
  q?: string;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
export function fetchReports(params?: ReportListParams) {
  const search = new URLSearchParams();
  if (params?.module && params.module !== "all") search.set("module", params.module);
  if (params?.q) search.set("q", params.q);
  const qs = search.toString();
  return apiFetch<ReportListResponse>(`/reports${qs ? `?${qs}` : ""}`);
}

export function generateReport(payload: GenerateReportPayload) {
  return apiFetch<Report>("/reports/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getReport(id: string) {
  return apiFetch<Report>(`/reports/${id}`);
}

export function deleteReport(id: string) {
  return apiFetch<{ message: string }>(`/reports/${id}`, { method: "DELETE" });
}

/**
 * Download a report file. apiFetch returns JSON, so we do a small custom fetch
 * that returns the raw Blob plus the server-provided filename.
 */
export async function downloadReport(
  id: string
): Promise<{ blob: Blob; filename: string }> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/reports/${id}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(text || "Download failed");
  }
  const blob = await res.blob();
  let filename = "report";
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  if (match) filename = match[1];
  return { blob, filename };
}

/** Trigger a browser download for a report file. */
export async function triggerReportDownload(id: string): Promise<void> {
  const { blob, filename } = await downloadReport(id);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Scheduled reports
// ---------------------------------------------------------------------------
export function fetchScheduledReports() {
  return apiFetch<ScheduledReportListResponse>("/reports/scheduled");
}

export function createScheduledReport(payload: ScheduledReportPayload) {
  return apiFetch<ScheduledReport>("/reports/scheduled", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateScheduledReport(
  id: string,
  payload: Partial<ScheduledReportPayload>
) {
  return apiFetch<ScheduledReport>(`/reports/scheduled/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteScheduledReport(id: string) {
  return apiFetch<{ message: string }>(`/reports/scheduled/${id}`, {
    method: "DELETE",
  });
}
