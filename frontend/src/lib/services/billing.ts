import { apiFetch } from "../api";

// Types
export interface SubscriptionPlan {
  id: string;
  name: string;
  plan: "free" | "pro" | "enterprise";
  billing_period: "monthly" | "yearly";
  price: number;
  features: string[];
  is_active: boolean;
}

export interface CreateSubscriptionPayload {
  company_id: string;
  plan: "free" | "pro" | "enterprise";
  billing_period: "monthly" | "yearly";
}

export interface Invoice {
  id: string;
  invoice_number: string;
  amount: number;
  status: "paid" | "pending" | "failed";
  created_at: string;
  due_date: string;
  paid_at?: string;
}

export interface PaymentMethod {
  id: string;
  type: "card" | "bank";
  last4: string;
  brand?: string;
  exp_month?: number;
  exp_year?: number;
  is_default: boolean;
}

export interface AddPaymentMethodPayload {
  type: "card" | "bank";
  token: string;
  is_default?: boolean;
}

export interface UpgradePlanPayload {
  plan: "pro" | "enterprise";
  billing_period?: "monthly" | "yearly";
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

export function addPaymentMethod(payload: AddPaymentMethodPayload) {
  return apiFetch<PaymentMethod>("/billing/payment-method", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function removePaymentMethod(methodId: string) {
  return apiFetch<{ message: string }>(`/billing/payment-method/${methodId}`, {
    method: "DELETE",
  });
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