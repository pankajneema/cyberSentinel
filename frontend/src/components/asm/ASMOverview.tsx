import { useEffect, useState } from "react";
import { RiskGauge } from "./RiskGauge";
import { StatCard } from "./StatCard";
import {
  Server,
  Globe,
  AlertTriangle,
  Cloud,
  Shield,
  Target,
  Activity,
  ChevronRight,
  Clock,
  Layers,
  CheckCircle2,
  Circle,
  Eye,
  Network,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fetchAsmOverview, AsmOverview } from "@/lib/api";

interface ASMOverviewProps {
  onNavigateToScans?: () => void;
  onNavigateToReports?: () => void;
}

export function ASMOverview({ onNavigateToScans, onNavigateToReports }: ASMOverviewProps) {
  const [asm, setAsm] = useState<AsmOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const formatDate = (value?: string | null) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "alert": return <AlertTriangle className="w-4 h-4 text-destructive" />;
      case "success": return <CheckCircle2 className="w-4 h-4 text-success" />;
      case "info": return <Eye className="w-4 h-4 text-primary" />;
      default: return <Circle className="w-4 h-4 text-muted-foreground" />;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchAsmOverview();
        if (!cancelled) setAsm(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load ASM overview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const attackSurfaceIndex = asm ? asm.attack_surface_index : 0;
  const highExposureCount = asm ? asm.exposure_breakdown.find(e => e.label === "high")?.count || 0 : 0;
  const mediumExposureCount = asm ? asm.exposure_breakdown.find(e => e.label === "medium")?.count || 0 : 0;
  const lowExposureCount = asm ? asm.exposure_breakdown.find(e => e.label === "low")?.count || 0 : 0;

  // Use API data for top exposed assets, fallback to empty array
  const topExposedAssets = asm?.top_exposed_assets || [];
  
  // Use API data for recent activity, fallback to empty array
  const recentActivity = asm?.recent_activity || [];
  
  // Generate trend data from exposure_trend if available, otherwise empty
  const trendData = asm?.exposure_trend !== undefined ? [
    { month: "Jan", score: Math.max(0, Math.min(100, (asm.attack_surface_index || 0) + (asm.exposure_trend || 0) * 2)) },
    { month: "Feb", score: Math.max(0, Math.min(100, (asm.attack_surface_index || 0) + (asm.exposure_trend || 0) * 1.5)) },
    { month: "Mar", score: Math.max(0, Math.min(100, (asm.attack_surface_index || 0) + (asm.exposure_trend || 0) * 1)) },
    { month: "Apr", score: Math.max(0, Math.min(100, (asm.attack_surface_index || 0) + (asm.exposure_trend || 0) * 0.5)) },
    { month: "May", score: Math.max(0, Math.min(100, (asm.attack_surface_index || 0))) },
    { month: "Jun", score: Math.max(0, Math.min(100, asm.attack_surface_index || 0)) },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Primary KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: "Attack Surface Index", value: String(attackSurfaceIndex), icon: Target },
          { label: "Total Assets", value: String(asm?.asset_counts?.assets_total ?? "—"), icon: Layers },
          { label: "Public Assets", value: String(asm?.exposure_summary?.public_assets ?? "—"), icon: Globe },
          { label: "Active Discoveries", value: String(asm?.active_discoveries ?? "—"), icon: Activity },
          { label: "Last Run", value: formatDate(asm?.last_discovery_run), icon: Clock },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-card rounded-2xl border border-border p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <item.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-lg font-semibold text-foreground">{item.value}</div>
                <div className="text-xs text-muted-foreground">{item.label}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* Asset Landscape */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold text-foreground">Asset Landscape</div>
              <Server className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: "Domains", value: asm?.asset_counts?.domains ?? 0, icon: Globe },
                { label: "Subdomains", value: asm?.asset_counts?.subdomains ?? 0, icon: Network },
                { label: "IPs", value: asm?.asset_counts?.ips ?? 0, icon: Server },
                { label: "Cloud", value: asm?.asset_counts?.cloud ?? 0, icon: Cloud },
                { label: "Services", value: asm?.asset_counts?.services ?? 0, icon: Layers },
              ].map((item) => (
                <div key={item.label} className="bg-muted/30 rounded-xl p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </div>
                  <div className="text-lg font-semibold text-foreground mt-1">{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Exposure Summary */}
          <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold text-foreground">Exposure Summary</div>
              <Shield className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted/30 rounded-xl p-3">
                <div className="text-xs text-muted-foreground">Public Assets</div>
                <div className="text-lg font-semibold text-foreground">{asm?.exposure_summary?.public_assets ?? 0}</div>
              </div>
              <div className="bg-muted/30 rounded-xl p-3">
                <div className="text-xs text-muted-foreground">Internet-facing</div>
                <div className="text-lg font-semibold text-foreground">{asm?.exposure_summary?.internet_facing_services ?? 0}</div>
              </div>
              <div className="bg-muted/30 rounded-xl p-3">
                <div className="text-xs text-muted-foreground">Unknown Ownership</div>
                <div className="text-lg font-semibold text-foreground">{asm?.exposure_summary?.unknown_assets ?? 0}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Exposure Health */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold text-foreground">Exposure Health</div>
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex justify-center">
              <RiskGauge score={attackSurfaceIndex} size="lg" />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-base font-semibold text-destructive">{highExposureCount}</div>
                <div className="text-xs text-muted-foreground">High</div>
              </div>
              <div>
                <div className="text-base font-semibold text-warning">{mediumExposureCount}</div>
                <div className="text-xs text-muted-foreground">Medium</div>
              </div>
              <div>
                <div className="text-base font-semibold text-success">{lowExposureCount}</div>
                <div className="text-xs text-muted-foreground">Low</div>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="font-semibold text-foreground">Exposure Trend</div>
              <Activity className="w-4 h-4 text-muted-foreground" />
            </div>
            {trendData.length > 0 ? (
              <div className="h-32 flex items-end gap-2">
                {trendData.map((item, index) => (
                  <div key={item.month} className="flex-1 flex flex-col items-center gap-2">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${item.score}%` }}
                      transition={{ delay: 0.2 + index * 0.08, duration: 0.4 }}
                      className={cn(
                        "w-full rounded-lg transition-colors",
                        item.score >= 70 ? "bg-gradient-to-t from-destructive to-destructive/60" :
                        item.score >= 50 ? "bg-gradient-to-t from-warning to-warning/60" :
                        "bg-gradient-to-t from-success to-success/60"
                      )}
                    />
                    <span className="text-[10px] text-muted-foreground font-medium">{item.month}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                No trend data available
              </div>
            )}
          </div>
        </div>

        {/* Top Exposed + Activity */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="font-semibold text-foreground">Top Exposed Assets</div>
              <Button variant="ghost" size="sm" className="text-primary gap-1" onClick={onNavigateToReports}>
                View All
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <div className="divide-y divide-border">
              {topExposedAssets.length > 0 ? (
                topExposedAssets.slice(0, 4).map((asset) => {
                  const exposureLevel = asset.exposure_score >= 75 ? "high" : asset.exposure_score >= 50 ? "medium" : "low";
                  return (
                    <div key={asset.id} className="flex items-center gap-3 p-4">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0",
                        exposureLevel === "high" && "bg-destructive/10 text-destructive",
                        exposureLevel === "medium" && "bg-warning/10 text-warning",
                        exposureLevel === "low" && "bg-success/10 text-success"
                      )}>
                        {asset.exposure_score}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{asset.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{asset.type} • {asset.exposure}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  No exposed assets found yet.
                </div>
              )}
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="p-4 border-b border-border">
              <div className="font-semibold text-foreground">Recent Activity</div>
            </div>
            <div className="divide-y divide-border max-h-72 overflow-y-auto">
              {recentActivity.length > 0 ? (
                recentActivity.map((activity, index) => (
                  <motion.div
                    key={activity.id || index}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + index * 0.04 }}
                    className="flex items-start gap-3 p-4"
                  >
                    <div className="mt-0.5">{getActivityIcon(activity.type)}</div>
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">{activity.action}</p>
                      <p className="text-xs text-muted-foreground truncate">{activity.asset}</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">{activity.time}</p>
                    </div>
                  </motion.div>
                ))
              ) : (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  No recent activity yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
