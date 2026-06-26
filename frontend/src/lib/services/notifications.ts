import { apiFetch } from "../api";

// Types
export interface Notification {
  id: string;
  title: string;
  body?: string | null;
  type: string;
  link?: string | null;
  is_read: boolean;
  created_at?: string | null;
}

export interface UnreadCount {
  count: number;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  in_app: boolean;
}

export type NotificationPreferencesUpdate = Partial<NotificationPreferences>;

// API Functions
export function fetchNotifications(unreadOnly?: boolean) {
  const qs = unreadOnly ? "?unread_only=true" : "";
  return apiFetch<Notification[]>(`/notifications${qs}`);
}

export function getUnreadCount() {
  return apiFetch<UnreadCount>(`/notifications/unread-count`);
}

export function markRead(id: string) {
  return apiFetch<Notification>(`/notifications/${id}/read`, { method: "POST" });
}

export function markUnread(id: string) {
  return apiFetch<Notification>(`/notifications/${id}/unread`, { method: "POST" });
}

export function markAllRead() {
  return apiFetch<{ message: string }>(`/notifications/read-all`, { method: "POST" });
}

export function getNotificationPreferences() {
  return apiFetch<NotificationPreferences>(`/notifications/preferences`);
}

export function updateNotificationPreferences(payload: NotificationPreferencesUpdate) {
  return apiFetch<NotificationPreferences>(`/notifications/preferences`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}
