import { cn } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low" | "info";

interface SeverityBadgeProps {
  severity: Severity;
  showDot?: boolean;
  className?: string;
}

export function SeverityBadge({ severity, showDot = true, className }: SeverityBadgeProps) {
  const styles: Record<Severity, string> = {
    critical: "bg-destructive/10 text-destructive border-destructive/20",
    high: "bg-warning/10 text-warning border-warning/20",
    medium: "bg-accent/10 text-accent border-accent/20",
    low: "bg-success/10 text-success border-success/20",
    info: "bg-muted text-muted-foreground border-border",
  };

  const dotStyles: Record<Severity, string> = {
    critical: "bg-destructive",
    high: "bg-warning",
    medium: "bg-accent",
    low: "bg-success",
    info: "bg-muted-foreground",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
        styles[severity],
        className
      )}
    >
      {showDot && <span className={cn("w-1.5 h-1.5 rounded-full", dotStyles[severity])} />}
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}
