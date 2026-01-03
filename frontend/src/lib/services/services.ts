import { apiFetch } from "../api";

// Types
export interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  billing_period: "monthly" | "yearly" | "one-time";
  features: string[];
  is_active: boolean;
}

export interface ServiceDetails extends Service {
  documentation_url?: string;
  support_email?: string;
  prerequisites?: string[];
}

export interface PurchaseServicePayload {
  billing_period?: "monthly" | "yearly";
}

// API Functions
export function listServices() {
  return apiFetch<Service[]>("/services");
}

export function getService(serviceId: string) {
  return apiFetch<ServiceDetails>(`/services/${serviceId}`);
}

export function purchaseService(serviceId: string, payload?: PurchaseServicePayload) {
  return apiFetch<{ message: string; subscription_id: string }>(`/services/${serviceId}/purchase`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

export function activateService(serviceId: string) {
  return apiFetch<{ message: string }>(`/services/${serviceId}/activate`, {
    method: "POST",
  });
}

export function deactivateService(serviceId: string) {
  return apiFetch<{ message: string }>(`/services/${serviceId}/deactivate`, {
    method: "POST",
  });
}