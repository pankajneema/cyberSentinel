import { apiFetch } from "../api";

export function submitContact(payload: {
  first_name: string;
  last_name: string;
  email: string;
  company?: string;
  subject: string;
  message: string;
}) {
  return apiFetch<{ message: string; sent: boolean }>("/marketing/contact", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function requestEarlyAccess(payload: { email: string; service: string }) {
  return apiFetch<{ message: string; sent: boolean }>("/marketing/early-access", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
