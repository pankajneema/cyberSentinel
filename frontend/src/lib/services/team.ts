// Team service — proxies the legacy team UI onto the new /orgs/* endpoints
// (Supabase-era org membership). Keeps the same exported types so the existing
// Team page UI works unchanged.

import {
  listMembers as orgListMembers,
  listInvites as orgListInvites,
  createInvite as orgCreateInvite,
  removeMember as orgRemoveMember,
  changeMemberRole as orgChangeRole,
  revokeInvite as orgRevokeInvite,
  acceptInvite as orgAcceptInvite,
} from "./orgs";

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

export async function listMembers(): Promise<TeamMember[]> {
  const members = await orgListMembers();
  return members.map((m) => ({
    id: m.id,
    name: m.full_name || m.email,
    email: m.email,
    role: m.role,
    status: m.is_active ? "active" : "inactive",
    avatar_url: null,
  }));
}

export function removeMember(memberId: string) {
  return orgRemoveMember(memberId);
}

export function changeMemberRole(memberId: string, role: string) {
  return orgChangeRole(memberId, role);
}

export async function listInvites(): Promise<TeamInvite[]> {
  const invites = await orgListInvites();
  return invites.map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role,
    status: i.status,
    token: "",
    created_at: i.created_at,
  }));
}

export function createInvite(payload: { email: string; role: string }) {
  return orgCreateInvite(payload.email, payload.role);
}

export function revokeInvite(inviteId: string) {
  return orgRevokeInvite(inviteId);
}

export function acceptInvite(token: string) {
  return orgAcceptInvite(token);
}

export function declineInvite(_token: string) {
  // No server-side "decline" in the org model; just resolve so the UI can move on.
  return Promise.resolve({ message: "Invitation declined" });
}

// Custom roles are not part of the new model — roles are fixed
// (owner / admin / analyst / reader).
export function listRoles(): Promise<TeamRole[]> {
  return Promise.resolve([]);
}

export function createRole(_payload: { name: string; description?: string }): Promise<TeamRole> {
  return Promise.reject(
    new Error("Custom roles aren't supported — use the built-in roles: admin, analyst, reader.")
  );
}

export function deleteRole(_roleId: string): Promise<{ message: string }> {
  return Promise.reject(new Error("Custom roles aren't supported."));
}
