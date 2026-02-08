import { apiFetch } from "../api";

// Types
export interface Account {
  id: string;
  name: string;
  plan: string;
  created_at?: string;
}

export interface UpdateAccountPayload {
  name?: string;
  plan?: string;
}

export interface AccountMember {
  id: string;
  name: string;
  email: string;
  role: string;
  company_id?: string | null;
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
  return apiFetch<{ message: string; email: string; role: string }>(`/accounts/${accountId}/invite`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function removeMember(accountId: string, memberId: string) {
  return apiFetch<{ message: string }>(`/accounts/${accountId}/members/${memberId}`, {
    method: "DELETE",
  });
}
