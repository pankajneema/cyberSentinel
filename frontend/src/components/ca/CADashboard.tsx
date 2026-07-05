import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, ShieldAlert, HelpCircle, AlarmClock, RefreshCw } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/asm/StatCard";
import { RiskGauge } from "@/components/asm/RiskGauge";
import { EmptyState } from "@/components/asm/EmptyState";
import { toast } from "@/hooks/use-toast";
import {
  CaFrameworkPosture, CaTrendPoint, fetchGapsSummary, fetchPosture,
  fetchPostureTrend, runEvaluation,
} from "@/lib/services/ca";

interface CADashboardProps {
  canWrite: boolean;
  onNavigateToFrameworks: () => void;
  onNavigateToGaps: () => void;
}

export function CADashboard({ canWrite, onNavigateToFrameworks, onNavigateToGaps }: CADashboardProps) {
  const [posture, setPosture] = useState<CaFrameworkPosture[]>([]);
  const [trend, setTrend] = useState<CaTrendPoint[]>([]);
  const [selectedFw, setSelectedFw] = useState<string>("");
  const [slaBreaches, setSlaBreaches] = useState(0);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [p, g] = await Promise.all([fetchPosture(), fetchGapsSummary()]);
        if (cancelled) return;
        setPosture(p.items);
        setSlaBreaches(g.sla_breaches);
        if (p.items.length && !p.items.find((i) => i.framework_id === selectedFw)) {
          setSelectedFw(p.items[0].framework_id);
        }
      } catch {
        if (!cancelled) setPosture([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  useEffect(() => {
    if (!selectedFw) return;
    let cancelled = false;
    fetchPostureTrend(selectedFw, 90)
      .then((r) => { if (!cancelled) setTrend(r.items); })
      .catch(() => { if (!cancelled) setTrend([]); });
    return () => { cancelled = true; };
  }, [selectedFw, reload]);

  const selected = posture.find((p) => p.framework_id === selectedFw);
  const totals = posture.reduce(
    (acc, p) => ({
      satisfied: acc.satisfied + p.counts.satisfied,
      gap: acc.gap + p.counts.gap,
      unknown: acc.unknown + p.counts.unknown,
    }),
    { satisfied: 0, gap: 0, unknown: 0 },
  );

  const handleEvaluate = async () => {
    setEvaluating(true);
    try {
      const r = await runEvaluation();
      toast({
        title: "Evaluation complete",
        description: r.changes.length
          ? `${r.changes.length} control(s) changed state.`
          : "No control state changes.",
      });
      setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Evaluation failed", description: String(e), variant: "destructive" });
    } finally {
      setEvaluating(false);
    }
  };

  if (!loading && posture.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No compliance frameworks enabled"
        description="Enable a framework (SOC 2, ISO 27001, PCI-DSS…) to start collecting evidence from your existing scans and computing a real compliance posture."
        actionLabel={canWrite ? "Choose frameworks" : undefined}
        onAction={canWrite ? onNavigateToFrameworks : undefined}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 flex-1 min-w-0">
          <StatCard label="Controls satisfied" value={totals.satisfied} icon={ShieldCheck} variant="success" />
          <StatCard label="Open gaps" value={totals.gap} icon={ShieldAlert} variant="critical" onClick={onNavigateToGaps} />
          <StatCard label="Not assessed" value={totals.unknown} icon={HelpCircle} />
          <StatCard label="Gap SLA breaches" value={slaBreaches} icon={AlarmClock} variant={slaBreaches ? "warning" : "default"} onClick={onNavigateToGaps} />
        </div>
        {canWrite && (
          <Button variant="outline" onClick={handleEvaluate} disabled={evaluating} className="rounded-xl">
            <RefreshCw className={`w-4 h-4 mr-2 ${evaluating ? "animate-spin" : ""}`} />
            Re-evaluate now
          </Button>
        )}
      </div>

      {/* Per-framework posture — score is always shown WITH its counts (honesty rule). */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {posture.map((p) => (
          <motion.div
            key={p.framework_id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={`bg-card rounded-2xl border shadow-sm p-5 cursor-pointer transition-colors ${
              p.framework_id === selectedFw ? "border-primary/40" : "border-border"
            }`}
            onClick={() => setSelectedFw(p.framework_id)}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-heading font-bold text-foreground truncate">{p.framework_name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {p.counts.applicable} applicable control(s)
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-xs">
                  <span className="text-success">{p.counts.satisfied} satisfied</span>
                  <span className="text-warning">{p.counts.partial} partial</span>
                  <span className="text-destructive">{p.counts.gap} gap</span>
                  <span className="text-muted-foreground">{p.counts.unknown} not assessed</span>
                  {p.counts.not_applicable > 0 && (
                    <span className="text-muted-foreground">{p.counts.not_applicable} N/A</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-center">
                {p.score === null ? (
                  <span className="text-2xl font-bold text-muted-foreground">—</span>
                ) : (
                  <RiskGauge score={p.score} size="sm" showLabel={false} />
                )}
                <p className="text-[11px] text-muted-foreground mt-1">compliance</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Posture trend from real daily snapshots — no synthetic history. */}
      <div className="bg-card rounded-2xl border border-border shadow-sm p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3 className="font-heading font-bold text-foreground">Posture trend (90 days)</h3>
          <Select value={selectedFw} onValueChange={setSelectedFw}>
            <SelectTrigger className="w-56 rounded-xl">
              <SelectValue placeholder="Framework" />
            </SelectTrigger>
            <SelectContent>
              {posture.map((p) => (
                <SelectItem key={p.framework_id} value={p.framework_id}>{p.framework_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {trend.length < 2 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Collecting history — the trend appears after the engine has recorded at least two daily snapshots.
            {selected && selected.score !== null && ` Current score: ${selected.score}%.`}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trend}>
              <defs>
                <linearGradient id="caScore" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Area type="monotone" dataKey="score" stroke="hsl(var(--primary))" fill="url(#caScore)" name="Score %" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
