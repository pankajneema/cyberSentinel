import { apiFetch } from "../api";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  is_superadmin?: boolean;
  avatar_url?: string | null;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  created_at?: string | null;
}

export interface TeamRole {
  id: string;
  name: string;
  description?: string | null;
}

export function listMembers() {
  return apiFetch<TeamMember[]>("/team/members");
}

export function removeMember(memberId: string) {
  return apiFetch<{ message: string }>(`/team/members/${memberId}`, { method: "DELETE" });
}

export function listInvites(status?: string) {
  const qs = status ? `?status_filter=${encodeURIComponent(status)}` : "";
  return apiFetch<TeamInvite[]>(`/team/invites${qs}`);
}

export function createInvite(payload: { email: string; role: string }) {
  return apiFetch<TeamInvite>("/team/invites", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function acceptInvite(token: string) {
  return apiFetch<{ message: string }>(`/team/invites/${token}/accept`, { method: "POST" });
}

export function acceptInvitePublic(token: string, payload: { full_name: string; password: string }) {
  return apiFetch<{
    message: string;
    access_token: string;
    token_type: string;
    user: { id: string; email: string; full_name: string; role: string };
  }>(`/team/invites/${token}/accept-public`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function declineInvite(token: string) {
  return apiFetch<{ message: string }>(`/team/invites/${token}/decline`, { method: "POST" });
}

export function listRoles() {
  return apiFetch<TeamRole[]>("/team/roles");
}

export function createRole(payload: { name: string; description?: string }) {
  return apiFetch<TeamRole>("/team/roles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteRole(roleId: string) {
  return apiFetch<{ message: string }>(`/team/roles/${roleId}`, { method: "DELETE" });
}
