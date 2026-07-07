// Central RBAC matrix — single source of truth for "who can do what" in the UI.
// Backend enforces the same rules; the UI uses this only to show/hide controls.

export type Role = "owner" | "admin" | "analyst" | "reader";

const RANK: Record<Role, number> = {
  reader: 0,
  analyst: 1,
  admin: 2,
  owner: 3,
};

function rank(role: string | null | undefined): number {
  return RANK[(role as Role) ?? "reader"] ?? 0;
}

export const can = {
  /** Create/edit/delete assets, run discoveries & scans (operational write). */
  write: (role?: string | null) => rank(role) >= RANK.analyst,

  /** Invite/remove members and change their roles. */
  manageTeam: (role?: string | null) => rank(role) >= RANK.admin,

  /** Org-level: billing, org settings, rename/delete org. Owner only. */
  manageOrg: (role?: string | null) => (role as Role) === "owner",

  /** Roles that can be ASSIGNED to others (never owner). */
  assignableRoles: ["admin", "analyst", "reader"] as Role[],
};

/**
 * App-wide operational write gate as currently enforced by the pages:
 * everyone except readers. (Unknown roles are treated as writable, matching
 * the existing `role !== "reader"` checks.)
 */
export function canWrite(role?: string | null): boolean {
  return role !== "reader";
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  analyst: "Analyst",
  reader: "Reader",
};
