import { apiFetch } from "../api";

// Types
export interface SignupPayload {
  email: string;
  password: string;
  full_name: string;
  company_name?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: {
    id: string;
    email: string;
    full_name: string | null;
    role: string;
  };
}

export interface RefreshPayload {
  refresh_token: string;
}

export interface LogoutPayload {
  refresh_token?: string;
  all?: boolean;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ResetPasswordPayload {
  token: string;
  new_password: string;
}

export interface ChangePasswordPayload {
  current_password: string;
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

export function refresh(payload: RefreshPayload) {
  return apiFetch<AuthResponse>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function logout(payload: LogoutPayload) {
  return apiFetch<{ message: string }>("/auth/logout", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function forgotPassword(payload: ForgotPasswordPayload) {
  return apiFetch<{ message: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function resetPassword(payload: ResetPasswordPayload) {
  return apiFetch<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function changePassword(payload: ChangePasswordPayload) {
  return apiFetch<{ message: string }>("/auth/password", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
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

/** Verified identity + synced profile/org/role. */
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
