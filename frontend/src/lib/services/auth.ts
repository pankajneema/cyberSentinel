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

export function logout() {
  return apiFetch<{ message: string }>("/auth/logout", {
    method: "POST",
  });
}

export function requestMagicLink(payload: MagicLinkPayload) {
  return apiFetch<{ message: string }>("/auth/magic-link", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function refreshToken() {
  return apiFetch<{ access_token: string }>("/auth/refresh", {
    method: "POST",
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

export function verifyToken() {
  return apiFetch<{ valid: boolean; user: any }>("/auth/verify");
}