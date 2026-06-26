import { apiFetch, Paginated } from "../api";

// Types
export interface ApiAsset {
  id: string;
  name: string;
  type: "domain" | "ip" | "cloud" | "repo" | "saas" | "user";
  exposure: "public" | "internal";
  risk_score: number | null;        // null = never scored ("Unscanned")
  last_scored_at?: string | null;
  tags: string[];
  last_seen?: string;
  status?: "active" | "inactive" | "archived";
}

export interface AssetListParams {
  q?: string;
  type?: string;
  exposure?: string;
  page?: number;
  page_size?: number;
}

export interface CreateAssetPayload {
  name: string;
  type: "domain" | "ip" | "cloud" | "repo" | "saas" | "user";
  exposure: "public" | "internal";
  tags?: string[];
  description?: string;
}

export interface UpdateAssetPayload {
  name?: string;
  exposure?: "public" | "internal";
  tags?: string[];
  risk_score?: number;
  status?: "active" | "inactive" | "archived";
}

// API Functions
export function fetchAssets(params?: AssetListParams) {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.type && params.type !== "all") search.set("type", params.type);
  if (params?.exposure && params.exposure !== "all") search.set("exposure", params.exposure);
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Paginated<ApiAsset>>(`/assets${qs ? `?${qs}` : ""}`);
}

export function createAsset(payload: CreateAssetPayload) {
  return apiFetch<ApiAsset>("/assets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getAsset(assetId: string) {
  return apiFetch<ApiAsset>(`/assets/${assetId}`);
}

export function updateAsset(assetId: string, payload: UpdateAssetPayload) {
  return apiFetch<ApiAsset>(`/assets/${assetId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteAsset(assetId: string) {
  return apiFetch<{ message: string }>(`/assets/${assetId}`, {
    method: "DELETE",
  });
}

export interface ImportAssetRow {
  name: string;
  type: "domain" | "ip" | "cloud" | "repo" | "saas" | "user";
  exposure?: "public" | "internal";
  tags?: string[];
  description?: string;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

export function importAssets(assets: ImportAssetRow[]) {
  return apiFetch<ImportResult>("/assets/import", {
    method: "POST",
    body: JSON.stringify({ assets }),
  });
}

export interface RescoreFactor {
  name: string;
  points: number;
  detail: string;
}

export interface RescoreResult {
  scored: boolean;                 // false => no ASM scan data matched
  risk_score: number | null;
  severity?: "critical" | "high" | "medium" | "low" | "info";
  factors: RescoreFactor[];
  matched_ips: string[];
  message?: string;
}

/** Recompute an asset's exposure score from real ASM scan data. */
export function rescoreAsset(assetId: string) {
  return apiFetch<RescoreResult>(`/assets/${assetId}/rescore`, { method: "POST" });
}

/** Parse a CSV string into import rows. Supports a header row with
 *  name,type,exposure,tags,description (tags pipe- or semicolon-separated). */
export function parseAssetsCsv(text: string): ImportAssetRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const split = (l: string) => l.split(",").map((c) => c.trim());
  let header: string[] | null = null;
  const first = split(lines[0]).map((c) => c.toLowerCase());
  if (first.includes("name") || first.includes("type")) header = first;
  const rows: ImportAssetRow[] = [];
  const start = header ? 1 : 0;
  const idx = (k: string) => (header ? header.indexOf(k) : -1);
  for (let i = start; i < lines.length; i++) {
    const cols = split(lines[i]);
    const name = header ? cols[idx("name")] ?? "" : cols[0] ?? "";
    const type = (header ? cols[idx("type")] : cols[1]) || "domain";
    const exposure = (header ? cols[idx("exposure")] : cols[2]) as ImportAssetRow["exposure"];
    const tagsRaw = header ? cols[idx("tags")] : cols[3];
    const description = header ? cols[idx("description")] : cols[4];
    if (!name) continue;
    rows.push({
      name,
      type: (["domain", "ip", "cloud", "repo", "saas", "user"].includes(type) ? type : "domain") as ImportAssetRow["type"],
      exposure: exposure === "public" || exposure === "internal" ? exposure : "internal",
      tags: tagsRaw ? tagsRaw.split(/[|;]/).map((t) => t.trim()).filter(Boolean) : undefined,
      description: description || undefined,
    });
  }
  return rows;
}