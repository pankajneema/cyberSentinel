import { apiFetch, apiFetchBlob, triggerBrowserDownload, API_BASE, Paginated } from "../api";
import { getTokens } from "../token-storage";

// ===================== Types =====================
export type ControlStatus = "satisfied" | "partial" | "gap" | "not_applicable" | "unknown";
export type GapStatus = "open" | "in_progress" | "resolved" | "verified" | "closed" | "accepted_risk";
export type EvidenceCollection = "automated" | "manual";
export type EvidenceStatus = "valid" | "stale" | "superseded" | "revoked";

export interface CaPostureCounts {
  satisfied: number;
  partial: number;
  gap: number;
  unknown: number;
  not_applicable: number;
  applicable: number;
  total: number;
}

export interface CaFramework {
  id: string;
  key: string;
  name: string;
  version: string;
  authority?: string | null;
  region?: string | null;
  description?: string | null;
  is_reference: boolean;
  control_count: number;
  enabled: boolean;
  enablement?: Record<string, unknown> | null;
  posture?: (CaPostureCounts & { score: number | null }) | null;
}

export interface CaControlState {
  id: string;
  status: ControlStatus;
  computed_at?: string | null;
  computed_from?: Array<Record<string, unknown>> | null;
  na_justification?: string | null;
  na_scope?: string | null;
}

export interface CaControl {
  id: string;
  framework_id: string;
  control_ref: string;
  title: string;
  description?: string | null;
  category?: string | null;
  criticality: string;
  control_type: string;
  evidence_guidance?: string | null;
  state: CaControlState;
}

export interface CaCheckInfo {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  collection: EvidenceCollection;
  freshness_days: number;
  required: boolean;
  rationale?: string | null;
}

export interface CaEvidence {
  id: string;
  check_id?: string | null;
  collection: EvidenceCollection;
  source_type: string;
  source_ref?: Record<string, unknown> | null;
  summary?: string | null;
  content?: Record<string, unknown> | null;
  content_hash: string;
  result?: "pass" | "fail" | null;
  captured_at?: string | null;
  valid_until?: string | null;
  status: EvidenceStatus;
  uploaded_by?: string | null;
  file_id?: string | null;
}

export interface CaControlDetail extends CaControl {
  checks: CaCheckInfo[];
  evidence: CaEvidence[];
  related_controls: Array<{
    id: string; control_ref: string; title: string;
    framework_key: string; framework_name: string;
  }>;
}

export interface CaGap {
  id: string;
  control_id: string;
  control_ref?: string;
  control_title?: string;
  framework_id?: string;
  title: string;
  description?: string | null;
  missing?: Array<{ check_key?: string; check_name?: string; required?: boolean; state?: string; detail?: string }> | null;
  severity: string;
  status: GapStatus;
  assigned_to?: string | null;
  sla_due_at?: string | null;
  first_detected_at?: string | null;
  resolved_at?: string | null;
}

export interface CaPolicy {
  id: string;
  key?: string | null;
  title: string;
  description?: string | null;
  status: "draft" | "active" | "archived" | "template";
  current_version_id?: string | null;
  review_frequency_days: number;
  next_review_at?: string | null;
  ack_count?: number;
}

export interface CaPolicyDetail extends CaPolicy {
  versions: Array<{ id: string; version: number; body_md: string; sha256: string; published_at?: string | null }>;
  acks: Array<{ member_user_id: string; acked_at?: string | null }>;
}

export interface CaAudit {
  id: string;
  framework_id: string;
  name: string;
  audit_firm?: string | null;
  status: "preparation" | "fieldwork" | "remediation" | "complete";
  period_start?: string | null;
  period_end?: string | null;
  scope?: Record<string, unknown> | null;
}

export interface CaAuditorGrant {
  id: string;
  audit_id: string;
  auditor_email: string;
  expires_at: string;
  revoked_at?: string | null;
  last_access_at?: string | null;
}

export interface CaFrameworkPosture {
  framework_id: string;
  framework_key: string;
  framework_name: string;
  counts: CaPostureCounts;
  score: number | null;
}

export interface CaTrendPoint {
  date: string;
  framework_id: string;
  satisfied: number;
  partial: number;
  gap: number;
  not_applicable: number;
  unknown: number;
  score: number | null;
}

// ===================== Frameworks =====================
export function fetchFrameworks() {
  return apiFetch<{ items: CaFramework[]; total: number }>("/ca/frameworks");
}
export function enableFramework(id: string, target_date?: string) {
  return apiFetch<{ enabled: boolean }>(`/ca/frameworks/${id}/enable`, {
    method: "POST",
    body: JSON.stringify({ target_date: target_date ?? null }),
  });
}
export function pauseFramework(id: string) {
  return apiFetch<{ paused: boolean }>(`/ca/frameworks/${id}/pause`, { method: "POST" });
}

// ===================== Controls =====================
export function fetchControls(params: {
  framework_id: string; status?: string; category?: string; page?: number; page_size?: number;
}) {
  const q = new URLSearchParams();
  q.set("framework_id", params.framework_id);
  if (params.status) q.set("status", params.status);
  if (params.category) q.set("category", params.category);
  q.set("page", String(params.page ?? 1));
  q.set("page_size", String(params.page_size ?? 50));
  return apiFetch<Paginated<CaControl>>(`/ca/controls?${q.toString()}`);
}
export function fetchControlDetail(id: string) {
  return apiFetch<CaControlDetail>(`/ca/controls/${id}`);
}
export function setControlApplicability(id: string, payload: {
  not_applicable: boolean; justification?: string; scope?: string;
}) {
  return apiFetch<{ status: ControlStatus }>(`/ca/controls/${id}/applicability`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// ===================== Evidence =====================
export function fetchEvidence(params: {
  check_id?: string; status?: string; collection?: string; page?: number; page_size?: number;
} = {}) {
  const q = new URLSearchParams();
  if (params.check_id) q.set("check_id", params.check_id);
  if (params.status) q.set("status", params.status);
  if (params.collection) q.set("collection", params.collection);
  q.set("page", String(params.page ?? 1));
  q.set("page_size", String(params.page_size ?? 50));
  return apiFetch<Paginated<CaEvidence>>(`/ca/evidence?${q.toString()}`);
}

export async function uploadManualEvidence(payload: {
  summary: string; check_id?: string; control_id?: string; valid_days?: number; file?: File | null;
}): Promise<CaEvidence> {
  const token = getTokens()?.accessToken;
  const form = new FormData();
  form.set("summary", payload.summary);
  if (payload.check_id) form.set("check_id", payload.check_id);
  if (payload.control_id) form.set("control_id", payload.control_id);
  form.set("valid_days", String(payload.valid_days ?? 180));
  if (payload.file) form.set("file", payload.file);
  const res = await fetch(`${API_BASE}/ca/evidence`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json();
}

export function revokeEvidence(id: string, justification: string) {
  return apiFetch<{ revoked: boolean }>(`/ca/evidence/${id}/revoke`, {
    method: "POST",
    body: JSON.stringify({ justification }),
  });
}

export async function downloadEvidenceFile(id: string, filename: string) {
  const { blob } = await apiFetchBlob(`/ca/evidence/${id}/file`);
  triggerBrowserDownload(blob, filename);
}

// ===================== Gaps =====================
export function fetchGaps(params: { status?: string; severity?: string; page?: number; page_size?: number } = {}) {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.severity) q.set("severity", params.severity);
  q.set("page", String(params.page ?? 1));
  q.set("page_size", String(params.page_size ?? 50));
  return apiFetch<Paginated<CaGap>>(`/ca/gaps?${q.toString()}`);
}
export function fetchGapsSummary() {
  return apiFetch<{ by_status: Record<string, number>; open_by_severity: Record<string, number>; sla_breaches: number }>(
    "/ca/gaps/summary"
  );
}
export function transitionGap(id: string, payload: { status: GapStatus; justification?: string }) {
  return apiFetch<CaGap>(`/ca/gaps/${id}/status`, { method: "PATCH", body: JSON.stringify(payload) });
}
export function assignGap(id: string, assigned_to: string | null) {
  return apiFetch<CaGap>(`/ca/gaps/${id}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ assigned_to }),
  });
}

// ===================== Policies =====================
export function fetchPolicies() {
  return apiFetch<{ items: CaPolicy[]; total: number }>("/ca/policies");
}
export function fetchPolicyTemplates() {
  return apiFetch<{ items: CaPolicy[] }>("/ca/policies/templates");
}
export function createPolicy(payload: {
  title: string; key?: string; description?: string; review_frequency_days?: number; from_template_id?: string;
}) {
  return apiFetch<CaPolicy>("/ca/policies", { method: "POST", body: JSON.stringify(payload) });
}
export function fetchPolicyDetail(id: string) {
  return apiFetch<CaPolicyDetail>(`/ca/policies/${id}`);
}
export function updatePolicy(id: string, payload: Partial<Pick<CaPolicy, "title" | "description" | "status">>) {
  return apiFetch<CaPolicy>(`/ca/policies/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}
export function publishPolicyVersion(id: string, body_md: string) {
  return apiFetch<{ id: string; version: number }>(`/ca/policies/${id}/versions`, {
    method: "POST",
    body: JSON.stringify({ body_md }),
  });
}
export function acknowledgePolicy(id: string) {
  return apiFetch<{ acknowledged: boolean }>(`/ca/policies/${id}/ack`, { method: "POST" });
}

// ===================== Posture =====================
export function fetchPosture(framework_id?: string) {
  const q = framework_id ? `?framework_id=${framework_id}` : "";
  return apiFetch<{ items: CaFrameworkPosture[] }>(`/ca/posture${q}`);
}
export function fetchPostureTrend(framework_id: string, days = 30) {
  return apiFetch<{ items: CaTrendPoint[] }>(`/ca/posture/trend?framework_id=${framework_id}&days=${days}`);
}
export async function downloadCaReport(framework_id: string | null, format: "pdf" | "json" = "pdf") {
  const q = new URLSearchParams({ format });
  if (framework_id) q.set("framework_id", framework_id);
  const { blob } = await apiFetchBlob(`/ca/reports?${q.toString()}`);
  triggerBrowserDownload(blob, `compliance-report.${format}`);
}

export function runEvaluation() {
  return apiFetch<{ evaluated: boolean; changes: Array<{ control_ref: string; from: string; to: string }> }>(
    "/ca/evaluate",
    { method: "POST" }
  );
}

// ===================== Audits =====================
export function fetchAudits() {
  return apiFetch<{ items: CaAudit[] }>("/ca/audits");
}
export function createAudit(payload: {
  framework_id: string; name: string; audit_firm?: string;
  period_start?: string; period_end?: string; scope?: Record<string, unknown>;
}) {
  return apiFetch<CaAudit>("/ca/audits", { method: "POST", body: JSON.stringify(payload) });
}
export function fetchGrants(auditId: string) {
  return apiFetch<{ items: CaAuditorGrant[] }>(`/ca/audits/${auditId}/grants`);
}
export function createGrant(auditId: string, payload: { auditor_email: string; expires_in_days?: number }) {
  return apiFetch<{ grant: CaAuditorGrant; token: string }>(`/ca/audits/${auditId}/grants`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
export function revokeGrant(auditId: string, grantId: string) {
  return apiFetch<{ revoked: boolean }>(`/ca/audits/${auditId}/grants/${grantId}`, { method: "DELETE" });
}
export function fetchAuditFindings(auditId: string) {
  return apiFetch<{ items: Array<{ id: string; title: string; description?: string; severity?: string; status: string; control_id?: string }> }>(
    `/ca/audits/${auditId}/findings`
  );
}

// ===================== Auditor portal (separate opaque-token auth) =====================
async function auditorFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/ca/auditor${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.json();
}

export function auditorMe(token: string) {
  return auditorFetch<{
    auditor_email: string; expires_at: string;
    audit: CaAudit & { name: string }; framework: { key: string; name: string; version: string };
  }>("/me", token);
}
export function auditorControls(token: string) {
  return auditorFetch<{ items: CaControl[] }>("/controls", token);
}
export function auditorControlDetail(token: string, controlId: string) {
  return auditorFetch<CaControlDetail>(`/controls/${controlId}`, token);
}
export function auditorRaiseFinding(token: string, payload: {
  control_id?: string; title: string; description?: string; severity?: string;
}) {
  return auditorFetch<{ id: string }>("/findings", token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
