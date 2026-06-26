import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Shield,
  Radar,
  Bug,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  Server,
  Globe,
  ArrowRight,
  CheckCircle2,
  XCircle,
  BarChart3,
  RefreshCw,
  AlertCircle,
  Info,
  Activity,
  Eye,
  Plus,
  Play,
} from "lucide-react";
import { motion } from "framer-motion";
import { fetchAsmOverview, fetchVsDashboard, fetchAssets, VsDashboard } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Tooltip component for UX polish
const Tooltip = ({ children, content }: { children: React.ReactNode; content: string }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        {children}
      </div>
      {show && (
        <div className="absolute z-50 px-3 py-2 text-sm text-white bg-gray-900 rounded-lg shadow-lg -top-10 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
          {content}
          <div className="absolute w-2 h-2 bg-gray-900 transform rotate-45 -bottom-1 left-1/2 -translate-x-1/2" />
        </div>
      )}
    </div>
  );
};

// Map the backend exposure_breakdown ([{label,count}]) to the labelled rows
// this view renders. Counts are real; only the display colors are static.
function mapExposureBreakdown(breakdown?: Array<{ label: string; count: number }>) {
  const by = (l: string) =>
    breakdown?.find(b => b.label?.toLowerCase() === l)?.count ?? 0;
  return [
    { level: "Critical", count: by("critical"), color: "bg-destructive" },
    { level: "High", count: by("high"), color: "bg-warning" },
    { level: "Medium", count: by("medium"), color: "bg-accent" },
    { level: "Low", count: by("low"), color: "bg-success" },
  ];
}

function exposureToStatus(score: number): string {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export default function Dashboard() {
  const navigate = useNavigate();
  // `asm` holds a normalized view derived from the real /asm/dashboard/overview.
  const [asm, setAsm] = useState<any>(null);
  const [vs, setVs] = useState<VsDashboard | null>(null);
  const [assetTotal, setAssetTotal] = useState<number | null>(null);
  const [topAssets, setTopAssets] = useState<any[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const loadDashboardData = async () => {
    let cancelled = false;

    try {
      setLoading(true);
      setError(null);

      // Route is already guarded by <RequireAuth>; apiFetch attaches the
      // Supabase session token and redirects on 401. Everything below is
      // real, org-scoped data from /asm/dashboard/overview, /vs/dashboard
      // and /assets — no hardcoded values.

      const [ovRes, vsRes, assetsRes] = await Promise.all([
        fetchAsmOverview().catch(err => {
          console.error("ASM overview fetch error:", err);
          return null;
        }),
        fetchVsDashboard().catch(err => {
          console.error("VS Dashboard fetch error:", err);
          return null;
        }),
        fetchAssets({ page_size: 1 }).catch(err => {
          console.error("Assets fetch error:", err);
          return { total: 0, items: [], page: 1, page_size: 1 };
        }),
      ]);

      if (cancelled) return;

      // Normalize the rich overview into the shape this view renders.
      const normalized = ovRes
        ? {
            attack_surface_score: ovRes.attack_surface_index ?? 0,
            total_domains: ovRes.asset_counts?.domains ?? 0,
            total_ips: ovRes.asset_counts?.ips ?? 0,
            total_services: ovRes.asset_counts?.services ?? 0,
            public_assets: ovRes.exposure_summary?.public_assets ?? 0,
            risk_trend: ovRes.exposure_trend ?? 0,
            risk_breakdown: mapExposureBreakdown(ovRes.exposure_breakdown),
          }
        : null;

      setAsm(normalized);
      setVs(vsRes);
      setAssetTotal(assetsRes.total);
      setTopAssets(
        (ovRes?.top_exposed_assets || []).map((a: any) => ({
          name: a.name,
          type: a.type,
          risk: Math.round(a.exposure_score ?? 0),
          status: a.status || exposureToStatus(a.exposure_score ?? 0),
        }))
      );
      setRecentAlerts(
        (ovRes?.recent_activity || []).map((ev: any) => ({
          title: ev.action ? `${ev.action} — ${ev.asset}` : ev.asset,
          time: ev.time,
          severity: ev.type || "info",
        }))
      );
    } catch (e: any) {
      if (!cancelled) {
        let errorMessage = "Failed to load dashboard data";
        
        if (e instanceof Error) {
          try {
            const errorData = JSON.parse(e.message);
            errorMessage = errorData.detail || errorData.message || errorMessage;
          } catch {
            errorMessage = e.message || errorMessage;
          }
        }

        if (errorMessage.includes("401") || errorMessage.includes("unauthorized")) {
          navigate("/login");
          return;
        }

        setError(errorMessage);
      }
    } finally {
      if (!cancelled) {
        setLoading(false);
        setRetrying(false);
      }
    }

    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const handleRetry = () => {
    setRetrying(true);
    loadDashboardData();
  };

  // All values below come from real org-scoped API responses.
  const riskScore = asm?.attack_surface_score ?? 0;
  const totalAssets = assetTotal ?? 0;
  const totalVulnerabilities = vs?.total_vulnerabilities ?? 0;
  const publicAssets = asm?.public_assets ?? 0;

  const riskBreakdown = asm?.risk_breakdown || mapExposureBreakdown(undefined);

  // Scan coverage: discovered (domains + IPs) vs total inventory.
  const scannedAssets = (asm?.total_domains ?? 0) + (asm?.total_ips ?? 0);
  const scanCoverage = totalAssets > 0 ? Math.min(Math.round((scannedAssets / totalAssets) * 100), 100) : 0;

  const criticalCount = riskBreakdown.find(r => r.level === "Critical")?.count ?? 0;
  const highCount = riskBreakdown.find(r => r.level === "High")?.count ?? 0;
  const needsAttention = criticalCount > 0 || highCount > 0;

  const securityMetrics = [
    {
      label: "Total Assets",
      value: loading ? "—" : String(totalAssets),
      icon: Server,
      tooltip: "Total discovered assets in your infrastructure",
    },
    {
      label: "Open Vulnerabilities",
      value: loading ? "—" : String(totalVulnerabilities),
      icon: Bug,
      tooltip: "Active security vulnerabilities requiring attention",
    },
    {
      label: "Public Assets",
      value: loading ? "—" : String(publicAssets),
      icon: Globe,
      tooltip: "Assets exposed to the public internet",
    },
    {
      label: "Attack Surface Score",
      value: loading ? "—" : String(riskScore),
      icon: Shield,
      tooltip: "Average exposure score across your assets (0–100)",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Security Dashboard</h1>
          <p className="text-muted-foreground">
            {loading ? "Loading live security posture..." : "Real-time overview of your organization's security posture"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className={`w-2 h-2 rounded-full ${error ? "bg-destructive" : "bg-success"} animate-pulse`} />
          <span>{error ? "Connection error" : "Live monitoring active"}</span>
        </div>
      </div>

      {/* Error Alert with Retry */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying} className="ml-4">
              {retrying ? (
                <>
                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                  Retrying...
                </>
              ) : (
                <>
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Retry
                </>
              )}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* NEW: Critical Attention Banner (conditional) */}
      {!loading && needsAttention && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-destructive/10 border border-destructive/20 rounded-2xl p-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-destructive mb-1">Immediate Attention Required</h4>
              <p className="text-sm text-destructive/80 mb-3">
                {criticalCount > 0 && highCount > 0 
                  ? `${criticalCount} critical and ${highCount} high-severity issues detected`
                  : criticalCount > 0 
                  ? `${criticalCount} critical ${criticalCount === 1 ? 'issue' : 'issues'} detected`
                  : `${highCount} high-severity ${highCount === 1 ? 'issue' : 'issues'} detected`
                }
              </p>
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" asChild>
                  <Link to="/app/vs">View Vulnerabilities</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/app/reports">See Reports</Link>
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Security Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {securityMetrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="bg-card rounded-2xl border border-border p-5 hover:shadow-lg transition-all duration-300"
            >
              <div className="flex items-center justify-between mb-3">
                <Tooltip content={metric.tooltip}>
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center cursor-help">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                </Tooltip>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {loading ? (
                  <div className="h-8 w-16 bg-muted animate-pulse rounded" />
                ) : (
                  metric.value
                )}
              </div>
              <div className="text-sm text-muted-foreground">{metric.label}</div>
            </motion.div>
          );
        })}
      </div>

      {/* NEW: What Changed Recently + Scan Coverage */}
      <div className="grid lg:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="lg:col-span-2 bg-card rounded-2xl border border-border p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground text-lg">Discovery Summary</h3>
          </div>

          {loading ? (
            <div className="grid sm:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-4 bg-muted/30 rounded-xl">
                  <div className="h-8 w-12 bg-muted animate-pulse rounded mb-2" />
                  <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="p-4 bg-muted/30 rounded-xl hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-2xl font-bold text-primary">{asm?.total_domains ?? 0}</div>
                  <Globe className="w-4 h-4 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">Domains monitored</p>
              </div>

              <div className="p-4 bg-muted/30 rounded-xl hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-2xl font-bold text-foreground">{asm?.total_ips ?? 0}</div>
                  <Server className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">IP addresses discovered</p>
              </div>

              <div className="p-4 bg-muted/30 rounded-xl hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-2xl font-bold text-warning">{publicAssets}</div>
                  <AlertTriangle className="w-4 h-4 text-warning" />
                </div>
                <p className="text-sm text-muted-foreground">Public-facing assets</p>
              </div>
            </div>
          )}
        </motion.div>

        {/* NEW: Scan Coverage Indicator */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-card rounded-2xl border border-border p-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <Eye className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground text-lg">Scan Coverage</h3>
            <Tooltip content="Percentage of assets currently being monitored">
              <Info className="w-4 h-4 text-muted-foreground cursor-help" />
            </Tooltip>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-24">
              <div className="h-16 w-16 bg-muted animate-pulse rounded-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-3xl font-bold text-foreground">{scanCoverage}%</span>
                <span className="text-sm text-muted-foreground">
                  {scannedAssets} of {totalAssets} assets
                </span>
              </div>
              <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    scanCoverage >= 80 ? "bg-success" :
                    scanCoverage >= 50 ? "bg-warning" : "bg-destructive"
                  }`}
                  style={{ width: `${scanCoverage}%` }}
                />
              </div>
              {scanCoverage < 80 && (
                <p className="text-xs text-muted-foreground">
                  Consider adding more assets to improve coverage
                </p>
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* Main Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Risk Score Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="lg:col-span-1 bg-card rounded-2xl border border-border p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-foreground text-lg">Risk Score</h3>
              <Tooltip content="Overall security health score based on vulnerabilities, exposed services, and asset risk">
                <Info className="w-4 h-4 text-muted-foreground cursor-help" />
              </Tooltip>
            </div>
            <span className="flex items-center gap-1 text-success text-sm font-medium">
              <TrendingUp className="w-4 h-4" />
              {asm?.risk_trend || "+0"} pts
            </span>
          </div>

          <div className="flex items-center justify-center mb-6">
            <div className="relative w-32 h-32">
              <svg className="w-32 h-32 transform -rotate-90">
                <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="12" fill="none" className="text-muted" />
                <circle
                  cx="64" cy="64" r="56"
                  stroke="url(#riskGradient)"
                  strokeWidth="12"
                  fill="none"
                  strokeDasharray={`${(riskScore / 100) * 352} 352`}
                  strokeLinecap="round"
                />
                <defs>
                  <linearGradient id="riskGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="hsl(243, 75%, 59%)" />
                    <stop offset="100%" stopColor="hsl(186, 100%, 42%)" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {loading ? (
                  <div className="h-10 w-16 bg-muted animate-pulse rounded" />
                ) : (
                  <>
                    <span className="text-4xl font-bold text-foreground">{riskScore}</span>
                    <span className="text-xs text-muted-foreground">out of 100</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {riskBreakdown.map((item) => (
              <div key={item.level} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                <div className={`w-3 h-3 rounded-full ${item.color}`} />
                <span className="text-sm text-muted-foreground">{item.level}</span>
                <span className="text-sm font-semibold text-foreground ml-auto">
                  {loading ? "—" : item.count}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* ASM & VS Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2 grid sm:grid-cols-2 gap-4"
        >
          {/* ASM Card */}
          <div className="bg-card rounded-2xl border border-border p-6 hover:shadow-lg transition-all duration-300">
            <div className="flex items-center gap-3 mb-4">
              <Tooltip content="Continuous monitoring of your external attack surface">
                <div className="w-12 h-12 rounded-xl gradient-bg flex items-center justify-center cursor-help">
                  <Radar className="w-6 h-6 text-primary-foreground" />
                </div>
              </Tooltip>
              <div>
                <h3 className="font-semibold text-foreground">Attack Surface</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">Monitoring</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center p-3 bg-muted/30 rounded-xl">
                {loading ? (
                  <div className="h-7 w-12 bg-muted animate-pulse rounded mx-auto mb-1" />
                ) : (
                  <div className="text-xl font-bold text-foreground">{asm?.total_domains ?? 0}</div>
                )}
                <div className="text-xs text-muted-foreground">Domains</div>
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-xl">
                {loading ? (
                  <div className="h-7 w-12 bg-muted animate-pulse rounded mx-auto mb-1" />
                ) : (
                  <div className="text-xl font-bold text-foreground">{asm?.total_ips ?? 0}</div>
                )}
                <div className="text-xs text-muted-foreground">IPs</div>
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-xl">
                {loading ? (
                  <div className="h-7 w-12 bg-muted animate-pulse rounded mx-auto mb-1" />
                ) : (
                  <div className="text-xl font-bold text-foreground">{asm?.total_services ?? 0}</div>
                )}
                <div className="text-xs text-muted-foreground">Services</div>
              </div>
            </div>

            <Button variant="outline" className="w-full" asChild>
              <Link to="/app/asm">
                View Dashboard
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>

          {/* VS Card */}
          <div className="bg-card rounded-2xl border border-border p-6 hover:shadow-lg transition-all duration-300">
            <div className="flex items-center gap-3 mb-4">
              <Tooltip content="Automated vulnerability scanning and assessment">
                <div className="w-12 h-12 rounded-xl bg-accent flex items-center justify-center cursor-help">
                  <Bug className="w-6 h-6 text-accent-foreground" />
                </div>
              </Tooltip>
              <div>
                <h3 className="font-semibold text-foreground">Vulnerability Scans</h3>
                <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">Active</span>
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                <span className="text-sm text-muted-foreground">Critical</span>
                {loading ? (
                  <div className="h-5 w-10 bg-muted animate-pulse rounded" />
                ) : (
                  <span className="text-sm font-medium text-destructive">{vs?.critical ?? 0}</span>
                )}
              </div>
              <div className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                <span className="text-sm text-muted-foreground">High</span>
                {loading ? (
                  <div className="h-5 w-10 bg-muted animate-pulse rounded" />
                ) : (
                  <span className="text-sm font-medium text-warning">{vs?.high ?? 0}</span>
                )}
              </div>
              <div className="flex items-center justify-between p-2 bg-muted/30 rounded-lg">
                <span className="text-sm text-muted-foreground">Medium / Low</span>
                {loading ? (
                  <div className="h-5 w-10 bg-muted animate-pulse rounded" />
                ) : (
                  <span className="text-sm font-medium text-foreground">{(vs?.medium ?? 0) + (vs?.low ?? 0)}</span>
                )}
              </div>
            </div>

            <Button variant="outline" className="w-full" asChild>
              <Link to="/app/vs">
                View Results
                <ArrowRight className="w-4 h-4 ml-2" />
              </Link>
            </Button>
          </div>
        </motion.div>
      </div>

      {/* Recent Alerts & Top Assets */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Alerts - IMPROVED EMPTY STATE */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-card rounded-2xl border border-border p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground text-lg">Recent Alerts</h3>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/app/reports">View All</Link>
            </Button>
          </div>

          <div className="space-y-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-muted/30 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                    <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                  </div>
                </div>
              ))
            ) : recentAlerts.length > 0 ? (
              recentAlerts.map((alert, index) => {
                const Icon = alert.icon || XCircle;
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + index * 0.1 }}
                    className="flex items-start gap-3 p-3 bg-muted/30 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      alert.severity === "critical" ? "bg-destructive/10" :
                      alert.severity === "high" ? "bg-warning/10" :
                      alert.severity === "medium" ? "bg-accent/10" : "bg-muted"
                    }`}>
                      <Icon className={`w-4 h-4 ${
                        alert.severity === "critical" ? "text-destructive" :
                        alert.severity === "high" ? "text-warning" :
                        alert.severity === "medium" ? "text-accent" : "text-muted-foreground"
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground">{alert.title}</p>
                      <p className="text-xs text-muted-foreground">{alert.time}</p>
                    </div>
                  </motion.div>
                );
              })
            ) : (
              <div className="text-center py-12">
                <Shield className="w-16 h-16 mx-auto mb-3 opacity-30 text-muted-foreground" />
                <p className="text-muted-foreground mb-3">No recent security alerts</p>
                <p className="text-sm text-muted-foreground mb-4">Your system is currently secure. Run scans regularly to stay protected.</p>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/app/vs">
                    <Play className="w-4 h-4 mr-2" />
                    Run Scan Now
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </motion.div>

        {/* Top Assets at Risk - IMPROVED EMPTY STATE */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-card rounded-2xl border border-border p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground text-lg">Top Assets at Risk</h3>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/app/asm">View All</Link>
            </Button>
          </div>

          <div className="space-y-3">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-muted animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                    <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                  </div>
                  <div className="h-4 w-8 bg-muted animate-pulse rounded" />
                </div>
              ))
            ) : topAssets.length > 0 ? (
              topAssets.map((asset, index) => (
                <motion.div
                  key={asset.name || index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + index * 0.1 }}
                  className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                    <Server className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{asset.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{asset.type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-12 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          asset.status === "critical" ? "bg-destructive" :
                          asset.status === "high" ? "bg-warning" :
                          asset.status === "medium" ? "bg-accent" : "bg-success"
                        }`}
                        style={{ width: `${asset.risk}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-foreground w-8">{asset.risk}</span>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="text-center py-12">
                <Server className="w-16 h-16 mx-auto mb-3 opacity-30 text-muted-foreground" />
                <p className="text-muted-foreground mb-3">No assets discovered yet</p>
                <p className="text-sm text-muted-foreground mb-4">Start by adding assets to monitor your attack surface.</p>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/app/asm">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Assets
                  </Link>
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      </div>

    </div>
  );
}