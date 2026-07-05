import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Play,
  Pause,
  Square,
  Plus,
  Search,
  MoreHorizontal,
  RefreshCw,
  CheckCircle2,
  Clock,
  Calendar,
  Shield,
  Server,
  ChevronRight,
  Trash2,
  FileText,
  AlertTriangle,
  History,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/asm/EmptyState";
import {
  fetchScans,
  createScan,
  deleteScan,
  runScan,
  pauseScan,
  resumeScan,
  stopScan,
  fetchScanRuns,
  fetchProfiles,
  type VsScan,
  type VsScanStatus,
  type VsScanRun,
  type VsProfile,
  type VsScheduleType,
} from "@/lib/services/vs";
import { fetchAssets, type ApiAsset } from "@/lib/services/assets";

interface VSScanManagerProps {
  canWrite?: boolean;
}

const STATUS_META: Record<
  VsScanStatus,
  { label: string; icon: JSX.Element }
> = {
  PENDING: { label: "Pending", icon: <Clock className="w-4 h-4 text-muted-foreground" /> },
  RUNNING: { label: "Running", icon: <RefreshCw className="w-4 h-4 text-primary animate-spin" /> },
  COMPLETED: { label: "Completed", icon: <CheckCircle2 className="w-4 h-4 text-success" /> },
  FAILED: { label: "Failed", icon: <AlertTriangle className="w-4 h-4 text-destructive" /> },
  PAUSED: { label: "Paused", icon: <Pause className="w-4 h-4 text-warning" /> },
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function VSScanManager({ canWrite = true }: VSScanManagerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scans, setScans] = useState<VsScan[]>([]);
  const [profiles, setProfiles] = useState<VsProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // wizard state
  const [isNewScanOpen, setIsNewScanOpen] = useState(false);
  const [scanStep, setScanStep] = useState(1);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [assets, setAssets] = useState<ApiAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [assetsError, setAssetsError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanConfig, setScanConfig] = useState({
    name: "",
    profile_id: "",
    schedule_type: "QUICK" as VsScheduleType,
    schedule_value: "",
  });

  // run history dialog
  const [historyScan, setHistoryScan] = useState<VsScan | null>(null);
  const [runs, setRuns] = useState<VsScanRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);

  const loadScans = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [scanPage, profList] = await Promise.all([
        fetchScans(1, 100),
        fetchProfiles().catch(() => [] as VsProfile[]),
      ]);
      setScans(scanPage.items);
      setProfiles(profList);
    } catch (e: any) {
      setError(e.message ?? "Failed to load scans");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScans();
  }, [loadScans]);

  const profileName = (id: string) =>
    profiles.find((p) => p.id === id)?.name ?? "—";

  const filteredScans = scans.filter((scan) => {
    const matchesSearch = (scan.name || "")
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || scan.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // ---- wizard ----
  const openWizard = async () => {
    setIsNewScanOpen(true);
    setAssetsLoading(true);
    setAssetsError(null);
    try {
      const page = await fetchAssets({ page: 1, page_size: 200 });
      setAssets(page.items);
    } catch (e: any) {
      setAssetsError(e.message ?? "Failed to load assets");
    } finally {
      setAssetsLoading(false);
    }
  };

  const resetScanWizard = () => {
    setScanStep(1);
    setSelectedAssets([]);
    setScanConfig({ name: "", profile_id: "", schedule_type: "QUICK", schedule_value: "" });
  };

  const toggleAsset = (asset: ApiAsset) => {
    if (!asset.ownership_verified) return; // only verified assets are scannable
    setSelectedAssets((prev) =>
      prev.includes(asset.id) ? prev.filter((a) => a !== asset.id) : [...prev, asset.id]
    );
  };

  const handleCreateScan = async () => {
    if (!canWrite) return;
    if (selectedAssets.length === 0 || !scanConfig.name || !scanConfig.profile_id) {
      toast({
        title: "Missing information",
        description: "Provide a name, select a profile, and pick at least one verified asset.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      const created = await createScan({
        name: scanConfig.name,
        profile_id: scanConfig.profile_id,
        asset_ids: selectedAssets,
        schedule_type: scanConfig.schedule_type,
        schedule_value:
          scanConfig.schedule_type === "QUICK"
            ? undefined
            : scanConfig.schedule_value || undefined,
      });
      if (scanConfig.schedule_type === "QUICK") {
        await runScan(created.id).catch(() => {
          /* scan created; run trigger surfaced below on reload */
        });
      }
      toast({
        title: "Scan created",
        description:
          scanConfig.schedule_type === "QUICK"
            ? `${scanConfig.name} has been started`
            : `${scanConfig.name} has been scheduled`,
      });
      setIsNewScanOpen(false);
      resetScanWizard();
      await loadScans();
    } catch (e: any) {
      toast({
        title: "Failed to create scan",
        description: e.message ?? "Unexpected error while creating scan",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ---- lifecycle actions ----
  const runAction = async (
    scan: VsScan,
    action: (id: string) => Promise<VsScan>,
    label: string
  ) => {
    if (!canWrite) return;
    setBusyId(scan.id);
    try {
      await action(scan.id);
      toast({ title: label, description: `"${scan.name}" — ${label.toLowerCase()}` });
      await loadScans();
    } catch (e: any) {
      toast({
        title: `${label} failed`,
        description: e.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (scan: VsScan) => {
    if (!canWrite) return;
    setBusyId(scan.id);
    try {
      await deleteScan(scan.id);
      toast({ title: "Scan deleted", description: `"${scan.name}" removed` });
      await loadScans();
    } catch (e: any) {
      toast({
        title: "Delete failed",
        description: e.message ?? "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (scan: VsScan) => {
    setHistoryScan(scan);
    setRunsLoading(true);
    setRunsError(null);
    setRuns([]);
    try {
      const data = await fetchScanRuns(scan.id);
      setRuns(data);
    } catch (e: any) {
      setRunsError(e.message ?? "Failed to load run history");
    } finally {
      setRunsLoading(false);
    }
  };

  const verifiedSelectedCount = selectedAssets.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Scan Manager</h2>
          <p className="text-sm text-muted-foreground">Create, schedule, and manage vulnerability scans</p>
        </div>
        {canWrite && (
          <Button variant="gradient" onClick={openWizard}>
            <Plus className="w-4 h-4 mr-2" />
            New Scan
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Total Scans", value: scans.length, icon: FileText, color: "bg-primary/10 text-primary" },
          { label: "Running", value: scans.filter((s) => s.status === "RUNNING").length, icon: RefreshCw, color: "bg-secondary/10 text-secondary" },
          { label: "Pending", value: scans.filter((s) => s.status === "PENDING").length, icon: Calendar, color: "bg-accent/10 text-accent" },
          { label: "Completed", value: scans.filter((s) => s.status === "COMPLETED").length, icon: CheckCircle2, color: "bg-success/10 text-success" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-card rounded-2xl border border-border p-5"
          >
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-xl", stat.color)}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{loading ? "—" : stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search scans..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="RUNNING">Running</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="PAUSED">Paused</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading scans…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={loadScans}>
            <RefreshCw className="w-4 h-4 mr-2" /> Retry
          </Button>
        </div>
      ) : filteredScans.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState
            icon={Shield}
            title={scans.length === 0 ? "No scans yet" : "No scans match your filters"}
            description={
              scans.length === 0
                ? "Create your first vulnerability scan to start assessing your assets."
                : "Try adjusting your search or status filter."
            }
            actionLabel={canWrite && scans.length === 0 ? "New Scan" : undefined}
            onAction={canWrite && scans.length === 0 ? openWizard : undefined}
          />
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-left text-sm text-muted-foreground">
                  <th className="p-4 font-medium">Scan Name</th>
                  <th className="p-4 font-medium">Profile</th>
                  <th className="p-4 font-medium">Targets</th>
                  <th className="p-4 font-medium">Schedule</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium">Last Run</th>
                  <th className="p-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filteredScans.map((scan) => (
                  <motion.tr
                    key={scan.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-t border-border hover:bg-muted/20 transition-colors"
                  >
                    <td className="p-4">
                      <div className="font-medium text-foreground">{scan.name}</div>
                      {scan.next_run_at && (
                        <div className="text-xs text-muted-foreground mt-0.5">Next: {fmtDate(scan.next_run_at)}</div>
                      )}
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">{profileName(scan.profile_id)}</td>
                    <td className="p-4">
                      <span className="text-xs px-2 py-0.5 bg-muted rounded-full">
                        {scan.asset_ids.length} asset{scan.asset_ids.length === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary capitalize">
                        {scan.schedule_type.toLowerCase()}
                        {scan.schedule_value ? ` · ${scan.schedule_value}` : ""}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {STATUS_META[scan.status]?.icon}
                        <span className="text-sm text-foreground">{STATUS_META[scan.status]?.label ?? scan.status}</span>
                      </div>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">{fmtDate(scan.last_run_at)}</td>
                    <td className="p-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" disabled={busyId === scan.id}>
                            {busyId === scan.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="w-4 h-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openHistory(scan)}>
                            <History className="w-4 h-4 mr-2" />Run History
                          </DropdownMenuItem>
                          {canWrite && (
                            <>
                              <DropdownMenuSeparator />
                              {scan.status === "RUNNING" ? (
                                <>
                                  <DropdownMenuItem onClick={() => runAction(scan, pauseScan, "Paused")}>
                                    <Pause className="w-4 h-4 mr-2" />Pause
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => runAction(scan, stopScan, "Stopped")}>
                                    <Square className="w-4 h-4 mr-2" />Stop
                                  </DropdownMenuItem>
                                </>
                              ) : scan.status === "PAUSED" ? (
                                <>
                                  <DropdownMenuItem onClick={() => runAction(scan, resumeScan, "Resumed")}>
                                    <Play className="w-4 h-4 mr-2" />Resume
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => runAction(scan, stopScan, "Stopped")}>
                                    <Square className="w-4 h-4 mr-2" />Stop
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <DropdownMenuItem onClick={() => runAction(scan, runScan, "Started")}>
                                  <Play className="w-4 h-4 mr-2" />Run Now
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(scan)}>
                                <Trash2 className="w-4 h-4 mr-2" />Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Scan Dialog */}
      <Dialog open={isNewScanOpen} onOpenChange={(open) => { setIsNewScanOpen(open); if (!open) resetScanWizard(); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Vulnerability Scan</DialogTitle>
          </DialogHeader>

          {/* Progress Steps */}
          <div className="flex items-center justify-between mb-6">
            {["Select Assets", "Configure Scan", "Review & Start"].map((step, i) => (
              <div key={step} className="flex items-center">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium",
                  scanStep > i + 1 ? "bg-success text-success-foreground" :
                  scanStep === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  {scanStep > i + 1 ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                </div>
                {i < 2 && <ChevronRight className="w-4 h-4 mx-2 text-muted-foreground" />}
              </div>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {/* Step 1: Select Assets */}
            {scanStep === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <p className="text-sm text-muted-foreground">Select verified assets from your inventory to scan:</p>
                {assetsLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading assets…
                  </div>
                ) : assetsError ? (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{assetsError}</div>
                ) : assets.length === 0 ? (
                  <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground text-center">
                    No assets in your inventory. Add assets in ASM first.
                  </div>
                ) : (
                  <div className="border border-border rounded-xl max-h-64 overflow-y-auto">
                    {assets.map((asset) => {
                      const verified = !!asset.ownership_verified;
                      return (
                        <div
                          key={asset.id}
                          className={cn(
                            "flex items-center gap-3 p-3 transition-colors border-b border-border last:border-b-0",
                            verified ? "hover:bg-muted/50 cursor-pointer" : "opacity-60 cursor-not-allowed",
                            selectedAssets.includes(asset.id) && "bg-primary/5"
                          )}
                          onClick={() => toggleAsset(asset)}
                        >
                          <Checkbox checked={selectedAssets.includes(asset.id)} disabled={!verified} />
                          <Server className="w-4 h-4 text-muted-foreground" />
                          <div className="flex-1">
                            <div className="text-sm font-medium font-mono">{asset.name}</div>
                            <div className="text-xs text-muted-foreground capitalize">{asset.type} • {asset.exposure}</div>
                          </div>
                          {!verified && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" /> Unverified
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {assets.some((a) => !a.ownership_verified) && (
                  <p className="text-xs text-warning">
                    Unverified assets can't be scanned. Verify asset ownership in ASM before scanning.
                  </p>
                )}
                <div className="text-sm text-muted-foreground">{verifiedSelectedCount} asset(s) selected</div>
              </motion.div>
            )}

            {/* Step 2: Configure */}
            {scanStep === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="space-y-2">
                  <Label>Scan Name</Label>
                  <Input
                    placeholder="e.g., Production Weekly Scan"
                    value={scanConfig.name}
                    onChange={(e) => setScanConfig({ ...scanConfig, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Scan Profile</Label>
                  {profiles.length === 0 ? (
                    <div className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
                      No scan profiles exist yet. Create one in the Settings tab before scanning.
                    </div>
                  ) : (
                    <Select value={scanConfig.profile_id} onValueChange={(v) => setScanConfig({ ...scanConfig, profile_id: v })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a profile" />
                      </SelectTrigger>
                      <SelectContent>
                        {profiles.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name} ({p.intensity})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Schedule</Label>
                    <Select
                      value={scanConfig.schedule_type}
                      onValueChange={(v) => setScanConfig({ ...scanConfig, schedule_type: v as VsScheduleType })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="QUICK">Run Now (once)</SelectItem>
                        <SelectItem value="INTERVAL">Interval</SelectItem>
                        <SelectItem value="CRON">Cron</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {scanConfig.schedule_type !== "QUICK" && (
                    <div className="space-y-2">
                      <Label>{scanConfig.schedule_type === "INTERVAL" ? "Interval (e.g. 24h)" : "Cron expression"}</Label>
                      <Input
                        placeholder={scanConfig.schedule_type === "INTERVAL" ? "24h" : "0 2 * * *"}
                        value={scanConfig.schedule_value}
                        onChange={(e) => setScanConfig({ ...scanConfig, schedule_value: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Step 3: Review */}
            {scanStep === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="bg-muted/30 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Scan Name</span>
                    <span className="text-sm font-medium">{scanConfig.name || "Unnamed Scan"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Profile</span>
                    <span className="text-sm font-medium">{profileName(scanConfig.profile_id)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Assets</span>
                    <span className="text-sm font-medium">{selectedAssets.length} selected</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Schedule</span>
                    <span className="text-sm font-medium capitalize">
                      {scanConfig.schedule_type === "QUICK"
                        ? "Immediately"
                        : `${scanConfig.schedule_type.toLowerCase()} · ${scanConfig.schedule_value || "—"}`}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex justify-between pt-4 border-t border-border">
            <Button variant="outline" onClick={() => scanStep > 1 ? setScanStep(scanStep - 1) : setIsNewScanOpen(false)} disabled={submitting}>
              {scanStep === 1 ? "Cancel" : "Back"}
            </Button>
            <Button
              variant="gradient"
              onClick={() => scanStep < 3 ? setScanStep(scanStep + 1) : handleCreateScan()}
              disabled={
                submitting ||
                (scanStep === 1 && selectedAssets.length === 0) ||
                (scanStep === 2 && (!scanConfig.name || !scanConfig.profile_id))
              }
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Working…</>
              ) : scanStep === 3 ? (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  {scanConfig.schedule_type === "QUICK" ? "Start Scan" : "Schedule Scan"}
                </>
              ) : "Next"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Run History Dialog */}
      <Dialog open={!!historyScan} onOpenChange={(open) => { if (!open) setHistoryScan(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Run History — {historyScan?.name}</DialogTitle>
          </DialogHeader>
          {runsLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading runs…
            </div>
          ) : runsError ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{runsError}</div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No runs recorded yet for this scan.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {runs.map((run) => (
                <div key={run.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                  {STATUS_META[run.status]?.icon}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{STATUS_META[run.status]?.label ?? run.status}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(run.started_at)}
                      {run.finished_at ? ` → ${fmtDate(run.finished_at)}` : ""}
                    </div>
                    {run.error && <div className="text-xs text-destructive mt-0.5">{run.error}</div>}
                  </div>
                  {typeof run.findings_count === "number" && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                      {run.findings_count} findings
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
