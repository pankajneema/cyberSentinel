import { apiFetch, Paginated } from "../api";

// Types
export interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  company_name: string;
  country: string;
  created_at: string;
  updated_at: string;
  is_active: boolean;
}

export interface UpdateUserPayload {
  full_name?: string;
  role?: string;
  is_active?: boolean;
}

export interface UserListParams {
  skip?: number;
  limit?: number;
}

// API Functions
export function getCurrentUser() {
  return apiFetch<User>("/users/me");
}

export function listUsers(params?: UserListParams) {
  const search = new URLSearchParams();
  if (params?.skip) search.set("skip", String(params.skip));
  if (params?.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return apiFetch<User[]>(`/users${qs ? `?${qs}` : ""}`);
}

export function getUserById(userId: string) {
  return apiFetch<User>(`/users/${userId}`);
}

export function updateUser(userId: string, payload: UpdateUserPayload) {
  return apiFetch<User>(`/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteUser(userId: string) {
  return apiFetch<{ message: string }>(`/users/${userId}`, {
    method: "DELETE",
  });
}