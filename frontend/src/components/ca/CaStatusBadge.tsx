import { cn } from "@/lib/utils";
import type { ControlStatus, EvidenceStatus, GapStatus } from "@/lib/services/ca";

// Same pill idiom as SeverityBadge (bg-{token}/10 text-{token} border-{token}/20).
const CONTROL_STYLES: Record<ControlStatus, string> = {
  satisfied: "bg-success/10 text-success border-success/20",
  partial: "bg-warning/10 text-warning border-warning/20",
  gap: "bg-destructive/10 text-destructive border-destructive/20",
  unknown: "bg-muted text-muted-foreground border-border",
  not_applicable: "bg-accent/10 text-accent border-accent/20",
};

export const CONTROL_STATUS_LABEL: Record<ControlStatus, string> = {
  satisfied: "Satisfied",
  partial: "Partial",
  gap: "Gap",
  unknown: "Not assessed",
  not_applicable: "N/A",
};

export function ControlStatusBadge({ status }: { status: ControlStatus }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border",
      CONTROL_STYLES[status] ?? CONTROL_STYLES.unknown,
    )}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {CONTROL_STATUS_LABEL[status] ?? status}
    </span>
  );
}

const GAP_STYLES: Record<GapStatus, string> = {
  open: "bg-destructive/10 text-destructive border-destructive/20",
  in_progress: "bg-warning/10 text-warning border-warning/20",
  resolved: "bg-accent/10 text-accent border-accent/20",
  verified: "bg-success/10 text-success border-success/20",
  closed: "bg-muted text-muted-foreground border-border",
  accepted_risk: "bg-secondary/10 text-secondary border-secondary/20",
};

export const GAP_STATUS_LABEL: Record<GapStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  verified: "Verified",
  closed: "Closed",
  accepted_risk: "Risk accepted",
};

export function GapStatusBadge({ status }: { status: GapStatus }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
      GAP_STYLES[status] ?? GAP_STYLES.open,
    )}>
      {GAP_STATUS_LABEL[status] ?? status}
    </span>
  );
}

const EVIDENCE_STYLES: Record<EvidenceStatus, string> = {
  valid: "bg-success/10 text-success border-success/20",
  stale: "bg-warning/10 text-warning border-warning/20",
  superseded: "bg-muted text-muted-foreground border-border",
  revoked: "bg-destructive/10 text-destructive border-destructive/20",
};

export function EvidenceStatusBadge({ status }: { status: EvidenceStatus }) {
  return (
    <span className={cn(
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
      EVIDENCE_STYLES[status] ?? EVIDENCE_STYLES.valid,
    )}>
      {status}
    </span>
  );
}

export function CollectionBadge({ collection }: { collection: "automated" | "manual" }) {
  // Manual evidence is ALWAYS visibly badged — it must never read as system-collected.
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wide border",
      collection === "automated"
        ? "bg-primary/10 text-primary border-primary/20"
        : "bg-warning/10 text-warning border-warning/20",
    )}>
      {collection}
    </span>
  );
}
