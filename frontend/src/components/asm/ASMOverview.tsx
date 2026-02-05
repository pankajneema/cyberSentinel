import { useEffect, useState } from "react";
import { RiskGauge } from "./RiskGauge";
import { StatCard } from "./StatCard";
import {
  Server,
  Globe,
  AlertTriangle,
  Cloud,
  TrendingDown,
  Sparkles,
  Shield,
  Target,
  Activity,
  ChevronRight,
  Clock,
  Layers,
  CheckCircle2,
  Circle,
  Eye,
  FileText,
  FileSearch,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { fetchAsmOverview, AsmOverview } from "@/lib/api";

const defaultQuickStats = [
  { label: "Last Discovery Run", value: "—", icon: Clock, status: "success" },
  { label: "Total Assets", value: "—", icon: Layers, status: "neutral" },
  { label: "Public Assets", value: "—", icon: Globe, status: "warning" },
  { label: "Active Discoveries", value: "—", icon: Activity, status: "success" },
];

interface ASMOverviewProps {
  onNavigateToScans?: () => void;
  onNavigateToReports?: () => void;
}

export function ASMOverview({ onNavigateToScans, onNavigateToReports }: ASMOverviewProps) {
  const [asm, setAsm] = useState<AsmOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const quickStats = [
    {
      label: "Last Discovery Run",
      value: asm?.last_discovery_run ? new Date(asm.last_discovery_run).toLocaleString() : defaultQuickStats[0].value,
      icon: Clock,
      status: "success" as const,
    },
    {
      label: "Total Assets",
      value: asm?.asset_counts?.assets_total != null ? String(asm.asset_counts.assets_total) : defaultQuickStats[1].value,
      icon: Layers,
      status: "neutral" as const,
    },
    {
      label: "Public Assets",
      value: asm?.exposure_summary?.public_assets != null ? String(asm.exposure_summary.public_assets) : defaultQuickStats[2].value,
      icon: Globe,
      status: "warning" as const,
    },
    {
      label: "Active Discoveries",
      value: asm?.active_discoveries != null ? String(asm.active_discoveries) : defaultQuickStats[3].value,
      icon: Activity,
      status: "success" as const,
    },
  ];

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
      {/* Premium Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl"
      >
        {/* Animated background */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/90 to-secondary" />
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent/30 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/4" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-secondary/40 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/4" />
        </div>
        
        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }} />

        <div className="relative z-10 p-8 lg:p-10">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div className="space-y-4">
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20"
              >
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-sm font-medium text-white/90">Attack Surface Management</span>
              </motion.div>
              
              <motion.h1 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-3xl lg:text-4xl font-bold text-white"
              >
                Exposure Overview
              </motion.h1>
              
              <motion.p 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-white/70 max-w-lg text-lg"
              >
                {loading ? "Loading attack surface overview..." : "Real-time visibility into your organization's external exposure and discovered assets"}
              </motion.p>

              {/* Quick Stats Pills */}
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="flex flex-wrap gap-3 pt-2"
              >
                {quickStats.map((stat) => (
                  <div 
                    key={stat.label}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-xl backdrop-blur-sm border",
                      stat.status === "success" && "bg-success/20 border-success/30",
                      stat.status === "danger" && "bg-destructive/20 border-destructive/30",
                      stat.status === "neutral" && "bg-white/10 border-white/20"
                    )}
                  >
                    <stat.icon className={cn(
                      "w-4 h-4",
                      stat.status === "success" && "text-success",
                      stat.status === "danger" && "text-destructive",
                      stat.status === "neutral" && "text-white/70"
                    )} />
                    <span className="text-sm font-semibold text-white">{stat.value}</span>
                    <span className="text-xs text-white/60">{stat.label}</span>
                  </div>
                ))}
              </motion.div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Main Dashboard Grid */}
      <div className="grid lg:grid-cols-12 gap-6">
        {/* Left Column - Attack Surface Index & Trend */}
        <div className="lg:col-span-4 space-y-6">
          {/* Attack Surface Index Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card rounded-2xl border border-border p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">Attack Surface Index</h3>
                <div className="group relative">
                  <Circle className="w-3 h-3 text-muted-foreground cursor-help" />
                  <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 text-xs bg-popover border border-border rounded-lg shadow-lg z-10">
                    This module shows exposure-based risks, not confirmed vulnerabilities.
                  </div>
                </div>
              </div>
              {asm?.exposure_trend !== undefined && asm.exposure_trend !== 0 && (
                <div className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                  asm.exposure_trend < 0 ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
                )}>
                  <TrendingDown className="w-3 h-3" />
                  {asm.exposure_trend > 0 ? "+" : ""}{asm.exposure_trend}%
                </div>
              )}
            </div>
            
            <div className="flex justify-center">
              <RiskGauge score={attackSurfaceIndex} size="lg" />
            </div>
            
            <div className="mt-6 pt-4 border-t border-border">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-destructive">{highExposureCount}</div>
                  <div className="text-xs text-muted-foreground">High Exposure</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-warning">{mediumExposureCount}</div>
                  <div className="text-xs text-muted-foreground">Medium Exposure</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-success">{lowExposureCount}</div>
                  <div className="text-xs text-muted-foreground">Low Exposure</div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Trend Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card rounded-2xl border border-border p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-semibold text-foreground">Exposure Trend</h3>
                <p className="text-sm text-muted-foreground">Last 6 months</p>
              </div>
              <Activity className="w-5 h-5 text-muted-foreground" />
            </div>
            {trendData.length > 0 ? (
              <div className="h-32 flex items-end gap-2">
                {trendData.map((item, index) => (
                  <div key={item.month} className="flex-1 flex flex-col items-center gap-2">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${item.score}%` }}
                      transition={{ delay: 0.3 + index * 0.1, duration: 0.5 }}
                      className={cn(
                        "w-full rounded-lg transition-colors cursor-pointer hover:opacity-80",
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
          </motion.div>
        </div>

        {/* Middle Column - Stats & Exposure Hotspots */}
        <div className="lg:col-span-5 space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="Total Domains"
              value={asm?.asset_counts?.domains != null ? String(asm.asset_counts.domains) : "—"}
              icon={Server}
              trend={asm?.asset_counts?.domains ? { value: 0, label: `${asm.asset_counts.subdomains} subdomains` } : undefined}
            />
            <StatCard
              label="Internet-Facing Services"
              value={asm?.exposure_summary?.internet_facing_services != null ? String(asm.exposure_summary.internet_facing_services) : "—"}
              icon={Globe}
              variant="warning"
            />
            <StatCard
              label="High Exposure Assets"
              value={String(highExposureCount)}
              icon={AlertTriangle}
              variant="critical"
            />
            <StatCard
              label="Cloud Assets"
              value={asm?.asset_counts?.services != null ? String(asm.asset_counts.services) : "—"}
              icon={Cloud}
            />
          </div>

          {/* Exposure Hotspots */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden"
          >
            <div className="flex items-center justify-between p-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-destructive/10">
                  <Target className="w-5 h-5 text-destructive" />
                </div>
                <h3 className="font-semibold text-foreground">Exposure Hotspots</h3>
              </div>
              <Button variant="ghost" size="sm" className="text-primary gap-1" onClick={onNavigateToReports}>
                View All
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <div className="divide-y divide-border">
              {topExposedAssets.length > 0 ? (
                topExposedAssets.slice(0, 4).map((asset, index) => {
                  const exposureLevel = asset.exposure_score >= 75 ? "high" : asset.exposure_score >= 50 ? "medium" : "low";
                  return (
                    <motion.div
                      key={asset.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 + index * 0.05 }}
                      className="flex items-center gap-4 p-4 hover:bg-muted/50 cursor-pointer transition-colors group"
                      onClick={onNavigateToReports}
                    >
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold shrink-0",
                        exposureLevel === "high" && "bg-destructive/10 text-destructive",
                        exposureLevel === "medium" && "bg-warning/10 text-warning",
                        exposureLevel === "low" && "bg-accent/10 text-accent"
                      )}>
                        {asset.exposure_score}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                          {asset.name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate font-mono">
                          {asset.type} • {asset.exposure}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </motion.div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No exposed assets found. Run a discovery to identify assets.
                </div>
              )}
            </div>
          </motion.div>
        </div>

        {/* Right Column - Activity & Quick Actions */}
        <div className="lg:col-span-3 space-y-6">
          {/* Quick Actions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card rounded-2xl border border-border p-5 shadow-sm"
          >
            <h3 className="font-semibold text-foreground mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <Button 
                variant="outline" 
                className="w-full justify-start gap-2"
                onClick={onNavigateToScans}
              >
                <FileSearch className="w-4 h-4" />
                Discovery Management
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start gap-2"
                onClick={onNavigateToReports}
              >
                <FileText className="w-4 h-4" />
                View Reports
              </Button>
            </div>
          </motion.div>

          {/* Recent Activity */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden"
          >
            <div className="p-5 border-b border-border">
              <h3 className="font-semibold text-foreground">Recent Activity</h3>
            </div>
            <div className="divide-y divide-border max-h-80 overflow-y-auto">
              {recentActivity.map((activity, index) => (
                <motion.div
                  key={activity.id}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + index * 0.05 }}
                  className="flex items-start gap-3 p-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="mt-0.5">{getActivityIcon(activity.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{activity.action}</p>
                    <p className="text-xs text-muted-foreground truncate">{activity.asset}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{activity.time}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}