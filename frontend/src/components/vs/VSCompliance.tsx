import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/asm/EmptyState";
import { fetchCompliance, type VsComplianceSummary } from "@/lib/services/vs";

const SEVERITY_KEYS = ["critical", "high", "medium", "low", "info", "unknown"] as const;
type SeverityKey = (typeof SEVERITY_KEYS)[number];

const SEVERITY_STYLES: Record<SeverityKey, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/20",
  high: "bg-warning/10 text-warning border-warning/20",
  medium: "bg-accent/10 text-accent border-accent/20",
  low: "bg-success/10 text-success border-success/20",
  info: "bg-muted text-muted-foreground border-border",
  unknown: "bg-muted text-muted-foreground border-border",
};

function SeverityBadges({ counts }: { counts: Record<string, number> }) {
  const present = SEVERITY_KEYS.filter((s) => (counts[s] ?? 0) > 0);
  if (present.length === 0) {
    return <span className="text-xs text-muted-foreground">no open findings</span>;
  }
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {present.map((s) => (
        <span
          key={s}
          className={cn(
            "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
            SEVERITY_STYLES[s]
          )}
        >
          {counts[s]} {s}
        </span>
      ))}
    </div>
  );
}

export function VSCompliance() {
  const [data, setData] = useState<VsComplianceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetchCompliance();
        if (!cancelled) setData(res);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load compliance data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const frameworks = data ? Object.entries(data.frameworks) : [];
  const hasCoverage = frameworks.some(([, fw]) => fw.open_control_count > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Compliance Coverage</h2>
        <p className="text-sm text-muted-foreground">
          Controls with open findings, mapped across your security frameworks
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Loading compliance mapping…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      ) : !data || !hasCoverage ? (
        <EmptyState
          icon={ShieldCheck}
          title="No compliance-mapped findings yet"
          description="Once findings are detected and mapped to framework controls, coverage will appear here."
        />
      ) : (
        <>
          <div className="bg-card rounded-2xl border border-border shadow-sm p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-2xl font-bold text-foreground">{data.open_findings}</div>
                <div className="text-xs text-muted-foreground">Open findings</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{data.total_findings}</div>
                <div className="text-xs text-muted-foreground">Total findings</div>
              </div>
            </div>
            <SeverityBadges counts={data.severity_counts} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {frameworks.map(([framework, fw], fi) => {
              if (fw.open_control_count === 0) return null;
              const controls = Object.entries(fw.controls);
              return (
                <motion.div
                  key={framework}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: fi * 0.05 }}
                  className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden"
                >
                  <div className="flex items-center gap-3 p-5 border-b border-border">
                    <div className="p-2 rounded-xl bg-secondary/10">
                      <ShieldCheck className="w-5 h-5 text-secondary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{framework}</h3>
                      <p className="text-xs text-muted-foreground">
                        {fw.open_control_count} control{fw.open_control_count === 1 ? "" : "s"} with open findings
                      </p>
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {controls
                      .filter(([, ctrl]) => ctrl.open_findings > 0)
                      .map(([controlId, ctrl]) => (
                        <div
                          key={controlId}
                          className="flex items-center justify-between gap-3 px-5 py-3"
                        >
                          <span className="text-sm font-medium text-foreground font-mono break-all">
                            {controlId}
                          </span>
                          <SeverityBadges counts={ctrl.severity_counts} />
                        </div>
                      ))}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
