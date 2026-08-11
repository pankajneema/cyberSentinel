// Organizations & memberships service (Phase 2). Calls the RBAC-enforced
// /orgs/* backend on top of our own self-hosted identity.

import { apiFetch } from "../api";

export interface OrgMember {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
}

export interface OrgInvite {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  created_at: string;
}

export function listMembers() {
  return apiFetch<OrgMember[]>("/orgs/me/members");
}

export function changeMemberRole(memberId: string, role: string) {
  return apiFetch<OrgMember>(`/orgs/members/${memberId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function removeMember(memberId: string) {
  return apiFetch<{ ok: boolean }>(`/orgs/members/${memberId}`, { method: "DELETE" });
}

export function listInvites() {
  return apiFetch<OrgInvite[]>("/orgs/invites");
}

export function createInvite(email: string, role: string) {
  return apiFetch<OrgInvite>("/orgs/invites", {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}

export function revokeInvite(inviteId: string) {
  return apiFetch<{ ok: boolean }>(`/orgs/invites/${inviteId}`, { method: "DELETE" });
}

/** Finalize an org-join after the invited user has a live session. */
export function acceptInvite(token: string) {
  return apiFetch<OrgMember>("/orgs/invites/accept", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}
