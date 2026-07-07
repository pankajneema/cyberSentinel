import { motion } from "framer-motion";

interface ComplianceGaugeProps {
  score: number; // 0-100 compliance % — HIGH IS GOOD (inverse of RiskGauge)
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

// RiskGauge's thresholds are risk-oriented (high score = red). Reusing it for
// compliance rendered 14% green and 90% red — a misleading story over honest
// numbers. This gauge inverts the semantics.
export function ComplianceGauge({ score, size = "md", showLabel = true }: ComplianceGaugeProps) {
  const sizes = {
    sm: { width: 80, stroke: 6, fontSize: "text-lg" },
    md: { width: 120, stroke: 8, fontSize: "text-2xl" },
    lg: { width: 180, stroke: 10, fontSize: "text-4xl" },
  };
  const { width, stroke, fontSize } = sizes[size];
  const radius = (width - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (Math.max(0, Math.min(100, score)) / 100) * circumference;

  const color =
    score >= 80 ? "text-success" : score >= 60 ? "text-accent" : score >= 40 ? "text-warning" : "text-destructive";
  const label = score >= 80 ? "Strong" : score >= 60 ? "Moderate" : score >= 40 ? "Weak" : "Critical gaps";

  return (
    <div className="relative inline-flex flex-col items-center">
      <svg width={width} height={width} className="transform -rotate-90">
        <circle cx={width / 2} cy={width / 2} r={radius} fill="none" stroke="currentColor"
          strokeWidth={stroke} className="text-muted/30" />
        <motion.circle cx={width / 2} cy={width / 2} r={radius} fill="none" stroke="currentColor"
          strokeWidth={stroke} strokeLinecap="round" className={color}
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - progress }}
          transition={{ duration: 1, ease: "easeOut" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold ${fontSize} ${color}`}>{Math.round(score)}%</span>
        {showLabel && <span className="text-[11px] text-muted-foreground">{label}</span>}
      </div>
    </div>
  );
}
