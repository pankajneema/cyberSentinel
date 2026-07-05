import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/asm/EmptyState";
import { fetchCompliance } from "@/lib/services/vs";

// The /vs/compliance response shape is not strictly typed on the client, so we
// parse it defensively: whatever real structure the API returns, we surface the
// frameworks, their controls, and any severity counts we can recognize.

const SEVERITY_KEYS = ["critical", "high", "medium", "low", "info"] as const;
type SeverityKey = (typeof SEVERITY_KEYS)[number];

const SEVERITY_STYLES: Record<SeverityKey, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/20",
  high: "bg-warning/10 text-warning border-warning/20",
  medium: "bg-accent/10 text-accent border-accent/20",
  low: "bg-success/10 text-success border-success/20",
  info: "bg-muted text-muted-foreground border-border",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Pull recognizable severity counts out of an arbitrary object. */
function extractCounts(value: unknown): Partial<Record<SeverityKey, number>> {
  const out: Partial<Record<SeverityKey, number>> = {};
  if (!isRecord(value)) return out;
  for (const key of Object.keys(value)) {
    const lower = key.toLowerCase();
    const match = SEVERITY_KEYS.find((s) => s === lower);
    if (match && typeof value[key] === "number") {
      out[match] = value[key] as number;
    }
  }
  return out;
}

/** Find a human label for a control from common id/name fields. */
function extractLabel(value: unknown, fallback: string): string {
  if (isRecord(value)) {
    for (const field of ["control", "control_id", "id", "name", "title", "label"]) {
      const v = value[field];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return fallback;
}

interface NormalizedControl {
  label: string;
  counts: Partial<Record<SeverityKey, number>>;
  /** Total count if the control's value was a bare number. */
  total?: number;
}

/** Normalize a framework's value into a list of controls. */
function normalizeControls(frameworkValue: unknown): NormalizedControl[] {
  // Framework value can be: { controls: [...] } | { controls: {...} } |
  // a map of control-id -> counts/number | an array of control objects.
  let source: unknown = frameworkValue;
  if (isRecord(frameworkValue) && "controls" in frameworkValue) {
    source = (frameworkValue as Record<string, unknown>).controls;
  }

  const controls: NormalizedControl[] = [];

  if (Array.isArray(source)) {
    source.forEach((entry, i) => {
      controls.push({
        label: extractLabel(entry, `Control ${i + 1}`),
        counts: extractCounts(entry),
      });
    });
  } else if (isRecord(source)) {
    for (const [key, val] of Object.entries(source)) {
      if (typeof val === "number") {
        controls.push({ label: key, counts: {}, total: val });
      } else {
        controls.push({ label: extractLabel(val, key), counts: extractCounts(val) });
      }
    }
  }

  return controls;
}

export function VSCompliance() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetchCompliance();
        if (!cancelled) setData(res ?? {});
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

  const frameworks = data && isRecord(data) ? Object.entries(data) : [];
  const hasFrameworks = frameworks.some(([, v]) => normalizeControls(v).length > 0);

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
      ) : !hasFrameworks ? (
        <EmptyState
          icon={ShieldCheck}
          title="No compliance-mapped findings yet"
          description="Once findings are detected and mapped to framework controls, coverage will appear here."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {frameworks.map(([framework, value], fi) => {
            const controls = normalizeControls(value);
            if (controls.length === 0) return null;
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
                      {controls.length} control{controls.length === 1 ? "" : "s"} with open findings
                    </p>
                  </div>
                </div>
                <div className="divide-y divide-border">
                  {controls.map((ctrl, ci) => {
                    const counts = SEVERITY_KEYS.filter(
                      (s) => (ctrl.counts[s] ?? 0) > 0
                    );
                    return (
                      <div
                        key={`${ctrl.label}-${ci}`}
                        className="flex items-center justify-between gap-3 px-5 py-3"
                      >
                        <span className="text-sm font-medium text-foreground font-mono break-all">
                          {ctrl.label}
                        </span>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {counts.length > 0 ? (
                            counts.map((s) => (
                              <span
                                key={s}
                                className={cn(
                                  "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
                                  SEVERITY_STYLES[s]
                                )}
                              >
                                {ctrl.counts[s]} {s}
                              </span>
                            ))
                          ) : typeof ctrl.total === "number" ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-muted text-muted-foreground border-border">
                              {ctrl.total} finding{ctrl.total === 1 ? "" : "s"}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">mapped</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
