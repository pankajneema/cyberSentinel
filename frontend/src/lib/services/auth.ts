import { apiFetch } from "../api";

// Types
export interface SignupPayload {
  company_name: string;
  full_name: string;
  email: string;
  password: string;
  role: string;
  country: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: {
    id: string;
    email: string;
    full_name: string;
    role: string;
  };
}

export interface MagicLinkPayload {
  email: string;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ResetPasswordPayload {
  token: string;
  new_password: string;
}

// API Functions
export function signup(payload: SignupPayload) {
  return apiFetch<AuthResponse>("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload: LoginPayload) {
  return apiFetch<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// logout / magic-link / refresh / forgot-password / reset-password are now
// handled entirely by Supabase (see contexts/AuthContext.tsx). The old backend
// stubs were removed in Phase 1.

export function verifyToken() {
  return apiFetch<{ valid: boolean; user: any }>("/auth/verify");
}

export interface MeResponse {
  user_id: string;
  email: string;
  role: string;
  org_id: string | null;
  org_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  country: string | null;
}

/** Verified identity + synced profile/org/role (Supabase era). */
export function getMe() {
  return apiFetch<MeResponse>("/auth/me");
}

export interface ProfileUpdate {
  full_name?: string;
  avatar_url?: string;
  country?: string;
  phone?: string;
}

export function updateProfile(payload: ProfileUpdate) {
  return apiFetch<MeResponse>("/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export interface MemberSettings {
  notifications: Record<string, unknown>;
  preferences: Record<string, unknown>;
}

export function getMemberSettings() {
  return apiFetch<MemberSettings>("/auth/settings");
}

export function putMemberSettings(payload: MemberSettings) {
  return apiFetch<MemberSettings>("/auth/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}