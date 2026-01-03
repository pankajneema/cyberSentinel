import { apiFetch, Paginated } from "../api";

// Types
export interface ApiAsset {
  id: string;
  name: string;
  type: "domain" | "ip" | "cloud" | "repo" | "saas" | "user";
  exposure: "public" | "internal";
  risk_score: number;
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