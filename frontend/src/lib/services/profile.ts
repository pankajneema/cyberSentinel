import { apiFetch } from "../api";

// Types
export interface UserProfile {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role?: string;
  is_superadmin?: boolean;
  phone?: string;
  country?: string;
  avatar_url?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UpdateProfilePayload {
  full_name?: string;
  email?: string;
  phone?: string;
  country?: string;
}

export interface UpdateAvatarPayload {
  avatar_url: string;
}

export interface ChangePasswordPayload {
  current_password: string;
  new_password: string;
}

// API Functions
export function getProfile() {
  return apiFetch<UserProfile>("/profile");
}

export function updateProfile(payload: UpdateProfilePayload) {
  return apiFetch<UserProfile>("/profile", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function updateAvatar(payload: UpdateAvatarPayload) {
  return apiFetch<UserProfile>("/profile/avatar", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function changePassword(payload: ChangePasswordPayload) {
  return apiFetch<{ message: string }>("/profile/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
