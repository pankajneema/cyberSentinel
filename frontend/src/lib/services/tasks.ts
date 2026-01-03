import { apiFetch } from "../api";

// Types
export interface Task {
  id: string;
  title: string;
  description?: string;
  priority: "critical" | "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed" | "overdue";
  assignee_id?: string;
  assignee_name?: string;
  due_date?: string;
  asset_name?: string;
  created_at: string;
  updated_at?: string;
}

export interface TaskDetails extends Task {
  messages?: TaskMessage[];
}

export interface TaskMessage {
  id: string;
  task_id: string;
  message: string;
  platform: "internal" | "slack" | "jira" | "email";
  sender_name?: string;
  created_at: string;
}

export interface TaskListParams {
  q?: string;
  status?: "pending" | "in_progress" | "completed" | "overdue";
  priority?: "critical" | "high" | "medium" | "low";
  page?: number;
  page_size?: number;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  priority: "critical" | "high" | "medium" | "low";
  assignee_id?: string;
  assignee_name?: string;
  due_date?: string;
  asset_name?: string;
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string;
  priority?: "critical" | "high" | "medium" | "low";
  status?: "pending" | "in_progress" | "completed" | "overdue";
  assignee_id?: string;
  assignee_name?: string;
  due_date?: string;
  asset_name?: string;
}

export interface CreateMessagePayload {
  message: string;
  platform: "internal" | "slack" | "jira" | "email";
}

// API Functions
export function listTasks(params?: TaskListParams) {
  const search = new URLSearchParams();
  if (params?.q) search.set("q", params.q);
  if (params?.status) search.set("status", params.status);
  if (params?.priority) search.set("priority", params.priority);
  if (params?.page) search.set("page", String(params.page));
  if (params?.page_size) search.set("page_size", String(params.page_size));
  const qs = search.toString();
  return apiFetch<Task[]>(`/tasks${qs ? `?${qs}` : ""}`);
}

export function createTask(payload: CreateTaskPayload) {
  return apiFetch<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getTask(taskId: string) {
  return apiFetch<TaskDetails>(`/tasks/${taskId}`);
}

export function updateTask(taskId: string, payload: UpdateTaskPayload) {
  return apiFetch<Task>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteTask(taskId: string) {
  return apiFetch<{ message: string }>(`/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export function getTaskMessages(taskId: string) {
  return apiFetch<TaskMessage[]>(`/tasks/${taskId}/messages`);
}

export function createTaskMessage(taskId: string, payload: CreateMessagePayload) {
  return apiFetch<TaskMessage>(`/tasks/${taskId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}