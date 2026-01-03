import { apiFetch } from "../api";

// Types
export interface Scan {
  id: string;
  name: string;
  target: string;
  scan_type: "external" | "internal" | "web" | "network";
  frequency?: string | null;
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  updated_at?: string;
}

export interface ScanDetails extends Scan {
  vulnerabilities?: Vulnerability[];
  started_at?: string;
  completed_at?: string;
  duration?: number;
  findings_count?: number;
}

export interface Vulnerability {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  cvss_score?: number;
  description: string;
  affected_asset: string;
  status: "open" | "in_progress" | "resolved";
  discovered_at: string;
}

export interface CreateScanPayload {
  name: string;
  target: string;
  scan_type: "external" | "internal" | "web" | "network";
  frequency?: string | null;
}

export interface ScanListParams {
  skip?: number;
  limit?: number;
}

// API Functions
export function fetchScans(params?: ScanListParams) {
  const search = new URLSearchParams();
  if (params?.skip) search.set("skip", String(params.skip));
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return apiFetch<Scan[]>(`/scans${qs ? `?${qs}` : ""}`);
}

export function createScan(payload: CreateScanPayload) {
  return apiFetch<{ scan_id: string; status: string }>("/scans", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getScanResults(scanId: string) {
  return apiFetch<ScanDetails>(`/scans/${scanId}`);
}

export function retestScan(scanId: string) {
  return apiFetch<{ scan_id: string; status: string }>(`/scans/${scanId}/retest`, {
    method: "POST",
  });
}

export function deleteScan(scanId: string) {
  return apiFetch<{ message: string }>(`/scans/${scanId}`, {
    method: "DELETE",
  });
}