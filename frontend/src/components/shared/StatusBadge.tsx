import type { ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Pause,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Single registry for machine/workflow status rendering. Entries are grouped
// per module so each keeps its exact current label, color, and icon.
export interface StatusMeta {
  label: string;
  /** Pill/badge classes (bg-{token}/10 text-{token} idiom). */
  tone: string;
  /** Small status-dot classes (where a dot is rendered). */
  dot?: string;
  icon?: ReactNode;
}

type StatusGroup = Record<string, StatusMeta> & { DEFAULT: StatusMeta };

export const STATUS_META = {
  /** ASM discovery cards (DiscoveryManager). */
  asmDiscovery: {
    RUNNING: {
      label: "Running",
      tone: "bg-primary/10 text-primary",
      icon: <Loader2 className="w-4 h-4 text-primary animate-spin" />,
    },
    COMPLETED: {
      label: "Completed",
      tone: "bg-success/10 text-success",
      icon: <CheckCircle2 className="w-4 h-4 text-success" />,
    },
    PENDING: {
      label: "Pending",
      tone: "bg-warning/10 text-warning",
      icon: <Clock className="w-4 h-4 text-warning" />,
    },
    PAUSED: {
      label: "Paused",
      tone: "bg-muted text-muted-foreground",
      icon: <Pause className="w-4 h-4 text-muted-foreground" />,
    },
    FAILED: {
      label: "Failed",
      tone: "bg-destructive/10 text-destructive",
      icon: <XCircle className="w-4 h-4 text-destructive" />,
    },
    DEFAULT: {
      label: "Unknown",
      tone: "bg-muted text-muted-foreground",
      icon: <Clock className="w-4 h-4 text-muted-foreground" />,
    },
  },

  /** ASM discovery runs (DiscoveryRunsList). */
  asmRun: {
    COMPLETED: {
      label: "Completed",
      tone: "bg-success/10 text-success",
      icon: <CheckCircle2 className="w-4 h-4 text-success" />,
    },
    RUNNING: {
      label: "Running",
      tone: "bg-primary/10 text-primary",
      icon: <Loader2 className="w-4 h-4 text-primary animate-spin" />,
    },
    FAILED: {
      label: "Failed",
      tone: "bg-destructive/10 text-destructive",
      icon: <AlertCircle className="w-4 h-4 text-destructive" />,
    },
    PENDING: {
      label: "Pending",
      tone: "bg-muted/10 text-muted-foreground",
      icon: <Clock className="w-4 h-4 text-muted-foreground" />,
    },
    DEFAULT: {
      label: "Unknown",
      tone: "bg-muted/10 text-muted-foreground",
      icon: <Clock className="w-4 h-4 text-muted-foreground" />,
    },
  },

  /** VS scans (VSDashboard badge/dot, VSScanManager label/icon). */
  vsScan: {
    PENDING: {
      label: "Pending",
      tone: "bg-muted text-muted-foreground",
      dot: "bg-muted-foreground",
      icon: <Clock className="w-4 h-4 text-muted-foreground" />,
    },
    RUNNING: {
      label: "Running",
      tone: "bg-primary/10 text-primary",
      dot: "bg-primary animate-pulse",
      icon: <RefreshCw className="w-4 h-4 text-primary animate-spin" />,
    },
    COMPLETED: {
      label: "Completed",
      tone: "bg-success/10 text-success",
      dot: "bg-success",
      icon: <CheckCircle2 className="w-4 h-4 text-success" />,
    },
    FAILED: {
      label: "Failed",
      tone: "bg-destructive/10 text-destructive",
      dot: "bg-destructive",
      icon: <AlertTriangle className="w-4 h-4 text-destructive" />,
    },
    PAUSED: {
      label: "Paused",
      tone: "bg-warning/10 text-warning",
      dot: "bg-warning",
      icon: <Pause className="w-4 h-4 text-warning" />,
    },
    DEFAULT: {
      label: "Unknown",
      tone: "bg-muted text-muted-foreground",
      dot: "bg-muted-foreground",
      icon: <Clock className="w-4 h-4 text-muted-foreground" />,
    },
  },

  /** VS finding remediation workflow (VSRemediation). */
  vsFinding: {
    open: { label: "Open", tone: "bg-destructive/10 text-destructive" },
    confirmed: { label: "Confirmed", tone: "bg-destructive/10 text-destructive" },
    in_progress: { label: "In Progress", tone: "bg-warning/10 text-warning" },
    remediated: { label: "Remediated", tone: "bg-accent/10 text-accent" },
    verified: { label: "Verified", tone: "bg-success/10 text-success" },
    closed: { label: "Closed", tone: "bg-success/10 text-success" },
    accepted_risk: { label: "Accepted Risk", tone: "bg-muted text-muted-foreground" },
    false_positive: { label: "False Positive", tone: "bg-muted text-muted-foreground" },
    DEFAULT: { label: "Unknown", tone: "bg-muted text-muted-foreground" },
  },
} satisfies Record<string, StatusGroup>;

export type StatusGroupName = keyof typeof STATUS_META;

export function statusMeta(group: StatusGroupName, status: string): StatusMeta {
  const entries: StatusGroup = STATUS_META[group];
  return entries[status] ?? entries.DEFAULT;
}

/** Status pill (VS idiom: px-2 py-1 rounded-full). */
export function StatusBadge({
  group,
  status,
  className,
}: {
  group: StatusGroupName;
  status: string;
  className?: string;
}) {
  const meta = statusMeta(group, status);
  return (
    <span className={cn("px-2 py-1 text-xs rounded-full", meta.tone, className)}>
      {meta.label}
    </span>
  );
}
