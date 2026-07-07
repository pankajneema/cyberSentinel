import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/asm/StatCard";
import {
  Bug,
  AlertTriangle,
  Clock,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Play,
  Shield,
  Target,
  Activity,
  ChevronRight,
  Server,
  Zap,
  BarChart3,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { fetchVsDashboard, fetchTrends, VsDashboard, VsTrendPoint } from "@/lib/api";
import {
  fetchFindings,
  fetchScans,
  VsFinding,
  VsScan,
  VsScanStatus,
  VsSeverity,
} from "@/lib/services/vs";
import { fetchAssets } from "@/lib/services/assets";
import { SeverityBadge } from "@/components/asm/SeverityBadge";
import { statusMeta } from "@/components/shared/StatusBadge";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface VSDashboardProps {
  onNavigateToScans?: () => void;
  onNavigateToFindings?: () => void;
  canWrite?: boolean;
}

const defaultSeverityData = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
} as const;

interface TopVulnerableAsset {
  assetId: string;
  name: string;
  severity: VsSeverity;
  count: number;
  maxRisk: number;
}

interface CvssBucket {
  range: string;
  label: string;
  count: number;
  color: string;
}

const SEVERITY_RANK: Record<VsSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function scanStatusDot(status: VsScanStatus): string {
  return statusMeta("vsScan", status).dot ?? "bg-muted-foreground";
}

function scanStatusBadge(status: VsScanStatus): string {
  return statusMeta("vsScan", status).tone;
}

function formatScanTime(v?: string | null): string {
  if (!v) return "Never run";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VSDashboard({ onNavigateToScans, onNavigateToFindings, canWrite = true }: VSDashboardProps) {
  const [vs, setVs] = useState<VsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [trends, setTrends] = useState<VsTrendPoint[]>([]);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [trendsError, setTrendsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchVsDashboard();
        if (!cancelled) setVs(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load VS dashboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadTrends = async () => {
      try {
        setTrendsLoading(true);
        setTrendsError(null);
        const data = await fetchTrends(30);
        if (!cancelled) setTrends(data.points ?? []);
      } catch (e: any) {
        if (!cancelled) setTrendsError(e?.message ?? "Failed to load trends");
      } finally {
        if (!cancelled) setTrendsLoading(false);
      }
    };
    loadTrends();
    return () => {
      cancelled = true;
    };
  }, []);

  // Findings (drives Top Vulnerable Assets + CVSS Distribution) + asset names.
  const [findings, setFindings] = useState<VsFinding[]>([]);
  const [assetNames, setAssetNames] = useState<Record<string, string>>({});
  const [findingsLoading, setFindingsLoading] = useState(true);
  const [findingsError, setFindingsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setFindingsLoading(true);
        setFindingsError(null);
        const [f, a] = await Promise.all([
          fetchFindings({ page_size: 200 }),
          fetchAssets({ page_size: 500 }),
        ]);
        if (cancelled) return;
        const names: Record<string, string> = {};
        for (const asset of a.items) names[asset.id] = asset.name;
        setFindings(f.items);
        setAssetNames(names);
      } catch (e: any) {
        if (!cancelled) setFindingsError(e?.message ?? "Failed to load findings");
      } finally {
        if (!cancelled) setFindingsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Recent scans.
  const [recentScans, setRecentScans] = useState<VsScan[]>([]);
  const [scansLoading, setScansLoading] = useState(true);
  const [scansError, setScansError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setScansLoading(true);
        setScansError(null);
        const data = await fetchScans(1, 5);
        if (!cancelled) setRecentScans(data.items ?? []);
      } catch (e: any) {
        if (!cancelled) setScansError(e?.message ?? "Failed to load scans");
      } finally {
        if (!cancelled) setScansLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const topVulnerableAssets = useMemo<TopVulnerableAsset[]>(() => {
    const groups = new Map<
      string,
      { severity: VsSeverity; count: number; maxRisk: number }
    >();
    for (const f of findings) {
      const risk = f.composite_risk ?? 0;
      const g = groups.get(f.asset_id);
      if (!g) {
        groups.set(f.asset_id, { severity: f.severity, count: 1, maxRisk: risk });
      } else {
        g.count += 1;
        if (risk > g.maxRisk) g.maxRisk = risk;
        if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[g.severity]) g.severity = f.severity;
      }
    }
    return Array.from(groups.entries())
      .map(([assetId, g]) => ({
        assetId,
        name: assetNames[assetId] ?? assetId,
        severity: g.severity,
        count: g.count,
        maxRisk: g.maxRisk,
      }))
      .sort((a, b) => b.maxRisk - a.maxRisk)
      .slice(0, 5);
  }, [findings, assetNames]);

  const cvssDistribution = useMemo<CvssBucket[]>(() => {
    let low = 0,
      medium = 0,
      high = 0,
      critical = 0,
      scored = 0;
    for (const f of findings) {
      const s = f.cvss_base;
      if (s == null) continue;
      scored += 1;
      if (s < 4) low += 1;
      else if (s < 7) medium += 1;
      else if (s < 9) high += 1;
      else critical += 1;
    }
    if (scored === 0) return [];
    return [
      { range: "0.0–3.9", label: "Low", count: low, color: "bg-success" },
      { range: "4.0–6.9", label: "Medium", count: medium, color: "bg-accent" },
      { range: "7.0–8.9", label: "High", count: high, color: "bg-warning" },
      { range: "9.0–10", label: "Critical", count: critical, color: "bg-destructive" },
    ];
  }, [findings]);

  const severityData = {
    critical: vs?.critical ?? defaultSeverityData.critical,
    high: vs?.high ?? defaultSeverityData.high,
    medium: vs?.medium ?? defaultSeverityData.medium,
    low: vs?.low ?? defaultSeverityData.low,
  };

  const totalVulns = vs
    ? vs.total_vulnerabilities
    : Object.values(severityData).reduce((a, b) => a + b, 0);
  
  return (
    <div className="space-y-6">
      {/* Hero Stats */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-2xl border border-border p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-xl bg-primary/10">
              <Bug className="w-5 h-5 text-primary" />
            </div>
          </div>
          <div className="text-3xl font-bold text-foreground">
            {loading ? "…" : totalVulns}
          </div>
          <div className="text-sm text-muted-foreground">Total Vulnerabilities</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-destructive/5 rounded-2xl border border-destructive/20 p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-xl bg-destructive/10">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
          </div>
          <div className="text-3xl font-bold text-destructive">{severityData.critical}</div>
          <div className="text-sm text-muted-foreground">Critical</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card rounded-2xl border border-border p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-xl bg-accent/10">
              <Clock className="w-5 h-5 text-accent" />
            </div>
          </div>
          <div className="text-3xl font-bold text-foreground">
            {vs ? vs.avg_mttr_days.toFixed(1) : "—"}
            <span className="text-lg">d</span>
          </div>
          <div className="text-sm text-muted-foreground">Avg. MTTR</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-card rounded-2xl border border-border p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-xl bg-success/10">
              <Shield className="w-5 h-5 text-success" />
            </div>
          </div>
          <div className="text-3xl font-bold text-foreground">
            {vs ? vs.scan_coverage : 0}
            <span className="text-lg">%</span>
          </div>
          <div className="text-sm text-muted-foreground">Scan Coverage</div>
        </motion.div>
      </div>

      {/* Severity Trend */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-card rounded-2xl border border-border p-6 shadow-sm"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-semibold text-foreground">Severity Trend</h3>
            <p className="text-sm text-muted-foreground">Open findings by severity over the last 30 days</p>
          </div>
          <TrendingUp className="w-5 h-5 text-muted-foreground" />
        </div>

        {trendsLoading ? (
          <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
            Loading trend history…
          </div>
        ) : trendsError ? (
          <div className="h-72 flex items-center justify-center text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-xl">
            {trendsError}
          </div>
        ) : trends.length === 0 ? (
          <div className="h-72 flex flex-col items-center justify-center text-center px-4">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-3">
              <TrendingDown className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">No trend history yet</p>
            <p className="text-sm text-muted-foreground mt-1">Snapshots accrue daily.</p>
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trends} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  {[
                    { key: "critical", color: "hsl(var(--destructive))" },
                    { key: "high", color: "hsl(var(--warning))" },
                    { key: "medium", color: "hsl(var(--accent))" },
                    { key: "low", color: "hsl(var(--success))" },
                  ].map((s) => (
                    <linearGradient key={s.key} id={`vs-trend-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={s.color} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={s.color} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "0.75rem",
                    fontSize: "0.8rem",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "0.8rem" }} />
                <Area type="monotone" dataKey="critical" stroke="hsl(var(--destructive))" fill="url(#vs-trend-critical)" strokeWidth={2} />
                <Area type="monotone" dataKey="high" stroke="hsl(var(--warning))" fill="url(#vs-trend-high)" strokeWidth={2} />
                <Area type="monotone" dataKey="medium" stroke="hsl(var(--accent))" fill="url(#vs-trend-medium)" strokeWidth={2} />
                <Area type="monotone" dataKey="low" stroke="hsl(var(--success))" fill="url(#vs-trend-low)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </motion.div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-12 gap-6">
        {error && (
          <div className="lg:col-span-12 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-2">
            {error}
          </div>
        )}
        {/* Severity Breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-4 bg-card rounded-2xl border border-border p-6 shadow-sm"
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-foreground">Severity Breakdown</h3>
            <BarChart3 className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="space-y-4">
            {[
              { label: "Critical", value: severityData.critical, color: "bg-destructive", textColor: "text-destructive" },
              { label: "High", value: severityData.high, color: "bg-warning", textColor: "text-warning" },
              { label: "Medium", value: severityData.medium, color: "bg-accent", textColor: "text-accent" },
              { label: "Low", value: severityData.low, color: "bg-success", textColor: "text-success" },
            ].map((item, index) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + index * 0.1 }}
                className="cursor-pointer hover:bg-muted/50 rounded-lg p-2 -mx-2 transition-colors"
                onClick={onNavigateToFindings}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground">{item.label}</span>
                  <span className={cn("text-sm font-bold", item.textColor)}>{item.value}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(item.value / totalVulns) * 100}%` }}
                    transition={{ delay: 0.5 + index * 0.1, duration: 0.5 }}
                    className={cn("h-full rounded-full", item.color)}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Top Vulnerable Assets */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-5 bg-card rounded-2xl border border-border shadow-sm overflow-hidden"
        >
          <div className="flex items-center justify-between p-5 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-destructive/10">
                <Target className="w-5 h-5 text-destructive" />
              </div>
              <h3 className="font-semibold text-foreground">Top Vulnerable Assets</h3>
            </div>
            <Button variant="ghost" size="sm" className="text-primary gap-1" onClick={onNavigateToFindings}>
              View All
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="divide-y divide-border">
            {findingsLoading ? (
              <div className="p-6 text-sm text-muted-foreground">Loading assets…</div>
            ) : findingsError ? (
              <div className="p-6 text-sm text-destructive">{findingsError}</div>
            ) : topVulnerableAssets.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No vulnerable assets yet
              </div>
            ) : (
              topVulnerableAssets.map((asset, index) => (
                <motion.div
                  key={asset.assetId}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + index * 0.05 }}
                  className="flex items-center gap-4 p-4 hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={onNavigateToFindings}
                >
                  <div className="p-2 rounded-lg bg-muted">
                    <Server className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate font-mono">
                      {asset.name}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <SeverityBadge severity={asset.severity} />
                      <span className="text-xs text-muted-foreground">
                        {asset.count} finding{asset.count === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-foreground">
                      {asset.maxRisk.toFixed(1)}
                    </div>
                    <div className="text-xs text-muted-foreground">max risk</div>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </motion.div>

        {/* Right Column - CTA & Recent */}
        <div className="lg:col-span-3 space-y-6">
          {/* Start Scan CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="relative overflow-hidden rounded-2xl"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-secondary via-secondary/90 to-primary" />
            <div className="absolute inset-0 opacity-20">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
            </div>
            <div className="relative z-10 p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-xl bg-white/10">
                  <Zap className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-semibold text-white">Quick Scan</h3>
              </div>
              <p className="text-sm text-white/70 mb-4">
                Start a new vulnerability scan on your assets
              </p>
              {canWrite ? (
                <Button 
                  className="w-full bg-white text-secondary hover:bg-white/90"
                  onClick={onNavigateToScans}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Start New Scan
                </Button>
              ) : (
                <div className="text-xs text-white/70 bg-white/10 rounded-lg px-3 py-2">
                  Read-only access. Ask an admin to start a scan.
                </div>
              )}
            </div>
          </motion.div>

          {/* Recent Scans */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-card rounded-2xl border border-border shadow-sm"
          >
            <div className="p-5 border-b border-border">
              <h3 className="font-semibold text-foreground">Recent Scans</h3>
            </div>
            <div className="divide-y divide-border">
              {scansLoading ? (
                <div className="p-6 text-sm text-muted-foreground">Loading scans…</div>
              ) : scansError ? (
                <div className="p-6 text-sm text-destructive">{scansError}</div>
              ) : recentScans.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No scans yet</div>
              ) : (
                recentScans.map((scan) => (
                  <div
                    key={scan.id}
                    className="flex items-center gap-3 p-4 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={onNavigateToScans}
                  >
                    <div className={cn("w-2 h-2 rounded-full", scanStatusDot(scan.status))} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{scan.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatScanTime(scan.last_run_at)}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full",
                        scanStatusBadge(scan.status)
                      )}
                    >
                      {scan.status.charAt(0) + scan.status.slice(1).toLowerCase()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* CVSS Distribution */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="bg-card rounded-2xl border border-border p-6 shadow-sm"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="font-semibold text-foreground">CVSS Distribution</h3>
            <p className="text-sm text-muted-foreground">Vulnerability scores breakdown</p>
          </div>
          <Activity className="w-5 h-5 text-muted-foreground" />
        </div>
        {findingsLoading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            Loading distribution…
          </div>
        ) : findingsError ? (
          <div className="text-sm text-destructive py-6 text-center">{findingsError}</div>
        ) : cvssDistribution.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No scored findings yet
          </div>
        ) : (
          <div className="grid sm:grid-cols-4 gap-4">
            {cvssDistribution.map((item, index) => (
              <motion.div
                key={item.range}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.6 + index * 0.1 }}
                className="text-center p-4 bg-muted/30 rounded-xl hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={onNavigateToFindings}
              >
                <div className={cn("w-3 h-3 rounded-full mx-auto mb-2", item.color)} />
                <div className="text-2xl font-bold text-foreground">{item.count}</div>
                <div className="text-xs font-medium text-foreground">{item.label}</div>
                <div className="text-xs text-muted-foreground font-mono">{item.range}</div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
