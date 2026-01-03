import { apiFetch } from "../api";

// Types
export interface Account {
  id: string;
  company_name: string;
  plan: string;
  members_count: number;
  created_at: string;
  settings: Record<string, any>;
}

export interface UpdateAccountPayload {
  company_name?: string;
  settings?: Record<string, any>;
}

export interface AccountMember {
  id: string;
  full_name: string;
  email: string;
  role: string;
  joined_at: string;
  is_active: boolean;
}

export interface InviteMemberPayload {
  email: string;
  role: string;
}

// API Functions
export function getAccount(accountId: string) {
  return apiFetch<Account>(`/accounts/${accountId}`);
}

export function updateAccount(accountId: string, payload: UpdateAccountPayload) {
  return apiFetch<Account>(`/accounts/${accountId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getAccountMembers(accountId: string) {
  return apiFetch<AccountMember[]>(`/accounts/${accountId}/members`);
}

export function inviteMember(accountId: string, payload: InviteMemberPayload) {
  return apiFetch<{ message: string; invite_id: string }>(`/accounts/${accountId}/invite`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function removeMember(accountId: string, memberId: string) {
  return apiFetch<{ message: string }>(`/accounts/${accountId}/members/${memberId}`, {
    method: "DELETE",
  });
}