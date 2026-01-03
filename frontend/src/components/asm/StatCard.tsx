import { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  variant?: "default" | "critical" | "warning" | "success";
  onClick?: () => void;
}

export function StatCard({ label, value, icon: Icon, trend, variant = "default", onClick }: StatCardProps) {
  const variants = {
    default: "border-border",
    critical: "border-destructive/30 bg-destructive/5",
    warning: "border-warning/30 bg-warning/5",
    success: "border-success/30 bg-success/5",
  };

  const iconVariants = {
    default: "text-primary bg-primary/10",
    critical: "text-destructive bg-destructive/10",
    warning: "text-warning bg-warning/10",
    success: "text-success bg-success/10",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className={cn(
        "p-5 rounded-xl border bg-card transition-all cursor-pointer",
        variants[variant],
        onClick && "hover:shadow-md"
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={cn("p-2.5 rounded-lg", iconVariants[variant])}>
          <Icon className="w-5 h-5" />
        </div>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium px-2 py-0.5 rounded-full",
              trend.value >= 0 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
            )}
          >
            {trend.value >= 0 ? "+" : ""}{trend.value}%
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-foreground mb-1">{value}</div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {trend && <div className="text-xs text-muted-foreground mt-1">{trend.label}</div>}
    </motion.div>
  );
}
