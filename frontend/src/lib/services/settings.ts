import { apiFetch } from "../api";

// Types
export interface UserSettings {
  notifications: {
    email: boolean;
    slack: boolean;
    push: boolean;
  };
  preferences: {
    theme: "light" | "dark" | "system";
    language: string;
    timezone: string;
  };
}

export interface UpdateSettingsPayload {
  notifications?: {
    email?: boolean;
    slack?: boolean;
    push?: boolean;
  };
  preferences?: {
    theme?: "light" | "dark" | "system";
    language?: string;
    timezone?: string;
  };
}

// API Functions
export function getSettings() {
  return apiFetch<UserSettings>("/settings");
}

export function updateSettings(payload: UpdateSettingsPayload) {
  return apiFetch<UserSettings>("/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}