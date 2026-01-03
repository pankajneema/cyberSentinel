import { apiFetch } from "../api";

// Types
export interface VsDashboard {
  total_vulnerabilities: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  avg_mttr_days: number;
  scan_coverage: number;
}

// API Functions
export function fetchVsDashboard() {
  return apiFetch<VsDashboard>("/vs/dashboard");
}