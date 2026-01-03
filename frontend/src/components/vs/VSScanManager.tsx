import { useEffect, useState } from "react";
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
  Zap,
  Shield,
  Key,
  Server,
  ChevronRight,
  Settings,
  Trash2,
  Eye,
  Edit,
  FileText,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { fetchScans, createScan, type Scan } from "@/lib/api";

const availableAssets = [
  { id: 1, name: "api.company.com", type: "Domain", lastScan: "2h ago" },
  { id: 2, name: "app.company.com", type: "Domain", lastScan: "1d ago" },
  { id: 3, name: "db-prod.company.com", type: "Domain", lastScan: "3d ago" },
  { id: 4, name: "192.168.1.0/24", type: "IP Range", lastScan: "1w ago" },
  { id: 5, name: "staging.app.com", type: "Domain", lastScan: "2d ago" },
  { id: 6, name: "mail.company.com", type: "Domain", lastScan: "5d ago" },
];

export function VSScanManager() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isNewScanOpen, setIsNewScanOpen] = useState(false);
  const [scanStep, setScanStep] = useState(1);
  const [selectedAssets, setSelectedAssets] = useState<number[]>([]);
  const [scanConfig, setScanConfig] = useState({
    name: "",
    type: "full",
    schedule: "now",
    credential: "",
    excludePorts: "",
    excludePaths: "",
  });
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchScans();
        setScans(data);
      } catch (e: any) {
        setError(e.message ?? "Failed to load scans");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filteredScans = scans.filter((scan: any) => {
    const matchesSearch =
      (scan.name || "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      (scan.target || "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "all" || scan.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle2 className="w-4 h-4 text-success" />;
      case "running": return <RefreshCw className="w-4 h-4 text-primary animate-spin" />;
      case "scheduled": return <Clock className="w-4 h-4 text-muted-foreground" />;
      case "paused": return <Pause className="w-4 h-4 text-warning" />;
      default: return null;
    }
  };

  const handleCreateScan = async () => {
    if (selectedAssets.length === 0 || !scanConfig.name) {
      toast({ title: "Error", description: "Please select assets and provide a scan name", variant: "destructive" });
      return;
    }
    try {
      // For now, use the first selected asset as target name
      const firstAsset = availableAssets.find(a => a.id === selectedAssets[0]);
      const target = firstAsset ? firstAsset.name : "target";
      await createScan({
        name: scanConfig.name,
        target,
        scan_type: scanConfig.type,
        frequency: scanConfig.schedule === "now" ? null : scanConfig.schedule,
      });
      toast({
        title: "Scan Created",
        description: `${scanConfig.name} has been ${scanConfig.schedule === "now" ? "started" : "scheduled"}`,
      });
      setIsNewScanOpen(false);
      resetScanWizard();
      const data = await fetchScans();
      setScans(data);
    } catch (e: any) {
      toast({
        title: "Failed to create scan",
        description: e.message ?? "Unexpected error while creating scan",
        variant: "destructive",
      });
    }
  };

  const resetScanWizard = () => {
    setScanStep(1);
    setSelectedAssets([]);
    setScanConfig({ name: "", type: "full", schedule: "now", credential: "", excludePorts: "", excludePaths: "" });
  };

  const toggleAsset = (id: number) => {
    setSelectedAssets(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Scan Manager</h2>
          <p className="text-sm text-muted-foreground">Create, schedule, and manage vulnerability scans</p>
        </div>
        <Button variant="gradient" onClick={() => setIsNewScanOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Scan
        </Button>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Total Scans", value: scans.length, icon: FileText, color: "bg-primary/10 text-primary" },
          { label: "Running", value: scans.filter((s: any) => s.status === "running").length, icon: RefreshCw, color: "bg-secondary/10 text-secondary" },
          { label: "Scheduled", value: scans.filter((s: any) => s.status === "scheduled").length, icon: Calendar, color: "bg-accent/10 text-accent" },
          { label: "Completed", value: scans.filter((s: any) => s.status === "completed").length, icon: CheckCircle2, color: "bg-success/10 text-success" },
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
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
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
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Scans List */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/30">
              <tr className="text-left text-sm text-muted-foreground">
                <th className="p-4 font-medium">Scan Name</th>
                <th className="p-4 font-medium">Target Assets</th>
                <th className="p-4 font-medium">Type</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium">Last Run</th>
                <th className="p-4 font-medium">Findings</th>
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
                    {scan.nextRun && (
                      <div className="text-xs text-muted-foreground mt-0.5">Next: {scan.nextRun}</div>
                    )}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-1">
                      {scan.targets.slice(0, 2).map((target, i) => (
                        <span key={i} className="text-xs px-2 py-0.5 bg-muted rounded-full font-mono">{target}</span>
                      ))}
                      {scan.targets.length > 2 && (
                        <span className="text-xs px-2 py-0.5 bg-muted rounded-full">+{scan.targets.length - 2}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={cn(
                      "text-xs px-2 py-1 rounded-full",
                      scan.type === "Full" && "bg-primary/10 text-primary",
                      scan.type === "Authenticated" && "bg-secondary/10 text-secondary",
                      scan.type === "Quick" && "bg-accent/10 text-accent"
                    )}>
                      {scan.type}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(scan.status)}
                      <span className="text-sm capitalize text-foreground">{scan.status}</span>
                    </div>
                    {scan.status === "running" && (
                      <div className="mt-2 w-24">
                        <Progress value={scan.progress} className="h-1" />
                        <span className="text-xs text-muted-foreground">{scan.progress}%</span>
                      </div>
                    )}
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {scan.lastRun || "—"}
                  </td>
                  <td className="p-4">
                    <div className="flex gap-1">
                      {scan.findings.critical > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">{scan.findings.critical}C</span>
                      )}
                      {scan.findings.high > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-warning/10 text-warning">{scan.findings.high}H</span>
                      )}
                      {scan.findings.medium > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">{scan.findings.medium}M</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem><Eye className="w-4 h-4 mr-2" />View Results</DropdownMenuItem>
                        {scan.status === "running" ? (
                          <DropdownMenuItem><Pause className="w-4 h-4 mr-2" />Pause</DropdownMenuItem>
                        ) : scan.status === "paused" ? (
                          <DropdownMenuItem><Play className="w-4 h-4 mr-2" />Resume</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem><Play className="w-4 h-4 mr-2" />Run Now</DropdownMenuItem>
                        )}
                        <DropdownMenuItem><Edit className="w-4 h-4 mr-2" />Edit</DropdownMenuItem>
                        <DropdownMenuItem><FileText className="w-4 h-4 mr-2" />View Logs</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive"><Trash2 className="w-4 h-4 mr-2" />Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <p className="text-sm text-muted-foreground">Select assets from your inventory to scan:</p>
                <div className="border border-border rounded-xl max-h-64 overflow-y-auto">
                  {availableAssets.map(asset => (
                    <div
                      key={asset.id}
                      className={cn(
                        "flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer transition-colors border-b border-border last:border-b-0",
                        selectedAssets.includes(asset.id) && "bg-primary/5"
                      )}
                      onClick={() => toggleAsset(asset.id)}
                    >
                      <Checkbox checked={selectedAssets.includes(asset.id)} />
                      <Server className="w-4 h-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="text-sm font-medium font-mono">{asset.name}</div>
                        <div className="text-xs text-muted-foreground">{asset.type} • Last scan: {asset.lastScan}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-sm text-muted-foreground">{selectedAssets.length} asset(s) selected</div>
              </motion.div>
            )}

            {/* Step 2: Configure */}
            {scanStep === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>Scan Name</Label>
                  <Input 
                    placeholder="e.g., Production Weekly Scan"
                    value={scanConfig.name}
                    onChange={(e) => setScanConfig({ ...scanConfig, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Scan Type</Label>
                    <Select value={scanConfig.type} onValueChange={(v) => setScanConfig({ ...scanConfig, type: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="quick"><Zap className="w-4 h-4 inline mr-2" />Quick Scan</SelectItem>
                        <SelectItem value="full"><Shield className="w-4 h-4 inline mr-2" />Full Scan</SelectItem>
                        <SelectItem value="authenticated"><Key className="w-4 h-4 inline mr-2" />Authenticated</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Schedule</Label>
                    <Select value={scanConfig.schedule} onValueChange={(v) => setScanConfig({ ...scanConfig, schedule: v })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="now">Run Now</SelectItem>
                        <SelectItem value="daily">Daily</SelectItem>
                        <SelectItem value="weekly">Weekly</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Exclude Ports (optional)</Label>
                  <Input 
                    placeholder="e.g., 22, 3389, 8080"
                    value={scanConfig.excludePorts}
                    onChange={(e) => setScanConfig({ ...scanConfig, excludePorts: e.target.value })}
                  />
                </div>
              </motion.div>
            )}

            {/* Step 3: Review */}
            {scanStep === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="bg-muted/30 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Scan Name</span>
                    <span className="text-sm font-medium">{scanConfig.name || "Unnamed Scan"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Assets</span>
                    <span className="text-sm font-medium">{selectedAssets.length} selected</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Type</span>
                    <span className="text-sm font-medium capitalize">{scanConfig.type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Schedule</span>
                    <span className="text-sm font-medium capitalize">{scanConfig.schedule === "now" ? "Immediately" : scanConfig.schedule}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex justify-between pt-4 border-t border-border">
            <Button variant="outline" onClick={() => scanStep > 1 ? setScanStep(scanStep - 1) : setIsNewScanOpen(false)}>
              {scanStep === 1 ? "Cancel" : "Back"}
            </Button>
            <Button 
              variant="gradient" 
              onClick={() => scanStep < 3 ? setScanStep(scanStep + 1) : handleCreateScan()}
              disabled={scanStep === 1 && selectedAssets.length === 0}
            >
              {scanStep === 3 ? (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  {scanConfig.schedule === "now" ? "Start Scan" : "Schedule Scan"}
                </>
              ) : "Next"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}