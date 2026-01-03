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
import { fetchAsmDashboard, AsmDashboard } from "@/lib/api";

const trendData = [
  { month: "Jan", score: 72 },
  { month: "Feb", score: 68 },
  { month: "Mar", score: 75 },
  { month: "Apr", score: 71 },
  { month: "May", score: 65 },
  { month: "Jun", score: 62 },
];

const topRisks = [
  { id: 1, title: "Exposed MongoDB Instance", asset: "db-prod.company.com", severity: "critical" as const, score: 95 },
  { id: 2, title: "Outdated SSL Certificate", asset: "api.company.com", severity: "high" as const, score: 78 },
  { id: 3, title: "Open SSH Port", asset: "192.168.1.100", severity: "high" as const, score: 72 },
  { id: 4, title: "Missing WAF Configuration", asset: "app.company.com", severity: "medium" as const, score: 58 },
  { id: 5, title: "Permissive CORS Policy", asset: "cdn.company.com", severity: "medium" as const, score: 45 },
];

const defaultQuickStats = [
  { label: "Last Scan", value: "—", icon: Clock, status: "success" },
  { label: "Assets Monitored", value: "—", icon: Layers, status: "neutral" },
  { label: "Active Threats", value: "23", icon: AlertTriangle, status: "danger" },
  { label: "Coverage", value: "94%", icon: Shield, status: "success" },
];

const recentActivity = [
  { id: 1, action: "New vulnerability detected", asset: "api.company.com", time: "5 min ago", type: "alert" },
  { id: 2, action: "Scan completed", asset: "Full external scan", time: "2 hours ago", type: "success" },
  { id: 3, action: "Asset discovered", asset: "staging.company.com", time: "4 hours ago", type: "info" },
  { id: 4, action: "Issue remediated", asset: "db-backup.company.com", time: "1 day ago", type: "success" },
];

interface ASMOverviewProps {
  onNavigateToScans?: () => void;
  onNavigateToReports?: () => void;
}

export function ASMOverview({ onNavigateToScans, onNavigateToReports }: ASMOverviewProps) {
  const [asm, setAsm] = useState<AsmDashboard | null>(null);
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
        const data = await fetchAsmDashboard();
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

  const attackSurfaceScore = asm ? asm.attack_surface_score : 62;
  const criticalCount = asm ? asm.critical_count : 23;
  const highCount = asm ? asm.high_count : 47;
  const resolvedCount = asm ? asm.resolved_count : 156;

  const quickStats = [
    {
      label: "Last Scan",
      value: asm?.last_scan ? new Date(asm.last_scan).toLocaleString() : defaultQuickStats[0].value,
      icon: Clock,
      status: "success" as const,
    },
    {
      label: "Assets Monitored",
      value: asm?.total_assets != null ? String(asm.total_assets) : defaultQuickStats[1].value,
      icon: Layers,
      status: "neutral" as const,
    },
    defaultQuickStats[2],
    defaultQuickStats[3],
  ];

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
                Security Overview
              </motion.h1>
              
              <motion.p 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="text-white/70 max-w-lg text-lg"
              >
                {loading ? "Loading attack surface overview..." : "Real-time visibility into your organization's external exposure"}
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
        {/* Left Column - Risk Score & Trend */}
        <div className="lg:col-span-4 space-y-6">
          {/* Risk Score Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card rounded-2xl border border-border p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-medium text-muted-foreground">Attack Surface Score</h3>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/10 text-success text-xs font-medium">
                <TrendingDown className="w-3 h-3" />
                -8%
              </div>
            </div>
            
            <div className="flex justify-center">
              <RiskGauge score={attackSurfaceScore} size="lg" />
            </div>
            
            <div className="mt-6 pt-4 border-t border-border">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-destructive">{criticalCount}</div>
                  <div className="text-xs text-muted-foreground">Critical</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-warning">{highCount}</div>
                  <div className="text-xs text-muted-foreground">High</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-success">{resolvedCount}</div>
                  <div className="text-xs text-muted-foreground">Resolved</div>
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
                <h3 className="font-semibold text-foreground">Score Trend</h3>
                <p className="text-sm text-muted-foreground">Last 6 months</p>
              </div>
              <Activity className="w-5 h-5 text-muted-foreground" />
            </div>
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
          </motion.div>
        </div>

        {/* Middle Column - Stats & Risks */}
        <div className="lg:col-span-5 space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="Total Assets"
              value="1,247"
              icon={Server}
              trend={{ value: 12, label: "+43 this week" }}
            />
            <StatCard
              label="Exposed Services"
              value="328"
              icon={Globe}
              trend={{ value: -5, label: "-18 resolved" }}
              variant="warning"
            />
            <StatCard
              label="Critical Findings"
              value="23"
              icon={AlertTriangle}
              trend={{ value: 8, label: "+2 new" }}
              variant="critical"
            />
            <StatCard
              label="Cloud Issues"
              value="47"
              icon={Cloud}
              trend={{ value: -12, label: "-6 fixed" }}
            />
          </div>

          {/* Top Risks */}
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
                <h3 className="font-semibold text-foreground">Top Risks</h3>
              </div>
              <Button variant="ghost" size="sm" className="text-primary gap-1" onClick={onNavigateToReports}>
                View All
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            <div className="divide-y divide-border">
              {topRisks.slice(0, 4).map((risk, index) => (
                <motion.div
                  key={risk.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + index * 0.05 }}
                  className="flex items-center gap-4 p-4 hover:bg-muted/50 cursor-pointer transition-colors group"
                  onClick={onNavigateToReports}
                >
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center text-sm font-bold shrink-0",
                    risk.severity === "critical" && "bg-destructive/10 text-destructive",
                    risk.severity === "high" && "bg-warning/10 text-warning",
                    risk.severity === "medium" && "bg-accent/10 text-accent"
                  )}>
                    {risk.score}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {risk.title}
                    </div>
                    <div className="text-xs text-muted-foreground truncate font-mono">{risk.asset}</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </motion.div>
              ))}
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
                Scan Management
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