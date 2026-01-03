import { useEffect, useState } from "react";
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
import { fetchVsDashboard, VsDashboard } from "@/lib/api";

interface VSDashboardProps {
  onNavigateToScans?: () => void;
  onNavigateToFindings?: () => void;
}

const defaultSeverityData = {
  critical: 12,
  high: 34,
  medium: 89,
  low: 156,
} as const;

const topVulnerableAssets = [
  { asset: "api.company.com", criticalCount: 5, highCount: 8, total: 23 },
  { asset: "db-prod.company.com", criticalCount: 3, highCount: 12, total: 28 },
  { asset: "app.company.com", criticalCount: 2, highCount: 6, total: 15 },
  { asset: "staging.app.com", criticalCount: 1, highCount: 9, total: 18 },
  { asset: "mail.company.com", criticalCount: 1, highCount: 4, total: 9 },
];

const cvssDistribution = [
  { range: "9.0-10.0", count: 12, color: "bg-destructive" },
  { range: "7.0-8.9", count: 34, color: "bg-warning" },
  { range: "4.0-6.9", count: 89, color: "bg-accent" },
  { range: "0.1-3.9", count: 156, color: "bg-success" },
];

const recentScans = [
  { name: "Production API Scan", status: "completed", findings: 23, time: "2h ago" },
  { name: "Weekly External Scan", status: "running", findings: 12, time: "In progress" },
  { name: "Database Servers", status: "scheduled", findings: 0, time: "In 4h" },
];

export function VSDashboard({ onNavigateToScans, onNavigateToFindings }: VSDashboardProps) {
  const [vs, setVs] = useState<VsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            <div className="flex items-center gap-1 text-success text-xs font-medium">
              <TrendingDown className="w-3 h-3" />
              -12%
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
            <div className="flex items-center gap-1 text-destructive text-xs font-medium">
              <TrendingUp className="w-3 h-3" />
              +3
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
            {vs ? vs.avg_mttr_days.toFixed(1) : "4.2"}
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
            {vs ? vs.scan_coverage : 87}
            <span className="text-lg">%</span>
          </div>
          <div className="text-sm text-muted-foreground">Scan Coverage</div>
        </motion.div>
      </div>

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
            {topVulnerableAssets.map((asset, index) => (
              <motion.div
                key={asset.asset}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + index * 0.05 }}
                className="flex items-center gap-4 p-4 hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <div className="p-2 rounded-lg bg-muted">
                  <Server className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate font-mono">{asset.asset}</div>
                  <div className="flex gap-2 mt-1">
                    {asset.criticalCount > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                        {asset.criticalCount}C
                      </span>
                    )}
                    {asset.highCount > 0 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-warning/10 text-warning">
                        {asset.highCount}H
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-foreground">{asset.total}</div>
                  <div className="text-xs text-muted-foreground">total</div>
                </div>
              </motion.div>
            ))}
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
              <Button 
                className="w-full bg-white text-secondary hover:bg-white/90"
                onClick={onNavigateToScans}
              >
                <Play className="w-4 h-4 mr-2" />
                Start New Scan
              </Button>
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
              {recentScans.map((scan, index) => (
                <div
                  key={scan.name}
                  className="flex items-center gap-3 p-4 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={onNavigateToScans}
                >
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    scan.status === "completed" && "bg-success",
                    scan.status === "running" && "bg-primary animate-pulse",
                    scan.status === "scheduled" && "bg-muted-foreground"
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{scan.name}</div>
                    <div className="text-xs text-muted-foreground">{scan.time}</div>
                  </div>
                  {scan.findings > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                      {scan.findings}
                    </span>
                  )}
                </div>
              ))}
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
              <div className="text-xs text-muted-foreground font-mono">{item.range}</div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}