import { apiFetch } from "../api";

// Types
export interface SubscriptionPlan {
  plan: "starter" | "pro" | "enterprise";
  billing_period: "monthly" | "annual";
  status: "trial" | "active" | "cancelled";
}

export interface CreateSubscriptionPayload {
  plan: "starter" | "pro" | "enterprise";
  billing_period: "monthly" | "annual";
}

export interface Invoice {
  id: string;
  amount: number;
  status: "paid" | "pending" | "failed";
  created_at: string;
}

export interface UpgradePlanPayload {
  plan: "pro" | "enterprise";
  billing_period?: "monthly" | "annual";
}

// API Functions
export function getCurrentPlan() {
  return apiFetch<SubscriptionPlan>("/billing/plan");
}

export function createSubscription(payload: CreateSubscriptionPayload) {
  return apiFetch<SubscriptionPlan>("/billing/subscribe", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listInvoices() {
  return apiFetch<Invoice[]>("/billing/invoices");
}

export function getInvoice(invoiceId: string) {
  return apiFetch<Invoice>(`/billing/invoices/${invoiceId}`);
}

export function upgradePlan(payload: UpgradePlanPayload) {
  return apiFetch<SubscriptionPlan>("/billing/upgrade", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function cancelSubscription() {
  return apiFetch<{ message: string }>("/billing/cancel", {
    method: "POST",
  });
}
