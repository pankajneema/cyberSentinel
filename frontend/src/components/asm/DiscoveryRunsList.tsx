import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { 
  Eye, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Zap,
  Calendar,
  FileText,
  Search,
  Download,
  ArrowUpDown
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion } from "framer-motion";
import { fetchAllRuns, getRunDetail, getDiscovery, type AsmDiscoveryRun } from "@/lib/services/asm";
import { type AsmDiscovery } from "@/lib/services/asm";

interface DiscoveryRunWithName extends AsmDiscoveryRun {
  discovery_name?: string;
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case "COMPLETED":
      return <CheckCircle2 className="w-4 h-4 text-success" />;
    case "RUNNING":
      return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
    case "FAILED":
      return <AlertCircle className="w-4 h-4 text-destructive" />;
    case "PENDING":
      return <Clock className="w-4 h-4 text-muted-foreground" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "COMPLETED":
      return "bg-success/10 text-success";
    case "RUNNING":
      return "bg-primary/10 text-primary";
    case "FAILED":
      return "bg-destructive/10 text-destructive";
    case "PENDING":
      return "bg-muted/10 text-muted-foreground";
    default:
      return "bg-muted/10 text-muted-foreground";
  }
};

const getTriggerIcon = (trigger: string) => {
  switch (trigger) {
    case "UI":
      return "👤";
    case "CRON":
      return "⏰";
    case "API":
      return "🔗";
    default:
      return "•";
  }
};

const getIntensityColor = (intensity?: string) => {
  switch (intensity?.toUpperCase()) {
    case "LIGHT":
      return "bg-blue-500/20 text-blue-600";
    case "NORMAL":
      return "bg-amber-500/20 text-amber-600";
    case "DEEP":
      return "bg-red-500/20 text-red-600";
    default:
      return "bg-muted/10 text-muted-foreground";
  }
};

const formatDate = (dateString?: string | null) => {
  if (!dateString) return "N/A";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "N/A";
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return "N/A";
  }
};

const formatDuration = (start?: string | null, end?: string | null) => {
  if (!start) return "N/A";
  try {
    const startDate = new Date(start);
    if (isNaN(startDate.getTime())) return "N/A";
    const endDate = end ? new Date(end) : new Date();
    if (end && isNaN(endDate.getTime())) return "N/A";
    const duration = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
    
    if (duration < 0) return "N/A";
    if (duration < 60) return `${duration}s`;
    if (duration < 3600) return `${Math.floor(duration / 60)}m`;
    return `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`;
  } catch {
    return "N/A";
  }
};

const formatDurationSeconds = (seconds?: number | null) => {
  if (seconds == null) return "N/A";
  if (seconds < 0) return "N/A";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

export function DiscoveryRunsList() {
  const [runs, setRuns] = useState<DiscoveryRunWithName[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalRuns, setTotalRuns] = useState(0);
  const [selectedRun, setSelectedRun] = useState<DiscoveryRunWithName | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("started_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [discoveryCache, setDiscoveryCache] = useState<Record<string, string>>({});

  const pageSize = 50;

  useEffect(() => {
    fetchRuns();
  }, [page, searchQuery, sortBy, sortDir]);

  const fetchRuns = async () => {
    setLoading(true);
    try {
      const data = await fetchAllRuns(page, pageSize, searchQuery, sortBy, sortDir);
      setRuns(data.items);
      setTotalRuns(data.total);

      // Fetch discovery names for all runs
      const discoveryIds = [...new Set(data.items.map(r => r.asm_discovery_id))];
      const newCache: Record<string, string> = { ...discoveryCache };
      
      await Promise.all(
        discoveryIds.map(async (id) => {
          if (!newCache[id]) {
            try {
              const discovery = await getDiscovery(id);
              newCache[id] = discovery.name;
            } catch (err) {
              console.error(`Failed to fetch discovery ${id}:`, err);
              newCache[id] = "Unknown";
            }
          }
        })
      );
      
      setDiscoveryCache(newCache);
    } catch (error) {
      console.error("Failed to fetch discovery runs:", error);
    } finally {
      setLoading(false);
    }
  };

  const exportRuns = () => {
    if (!runs.length) return;
    const rows = runs.map((r) => ({
      id: r.id,
      discovery_id: r.asm_discovery_id,
      name: discoveryCache[r.asm_discovery_id] || "",
      status: r.status,
      run_mode: r.run_mode,
      triggered_by: r.triggered_by,
      started_at: r.started_at,
      completed_at: r.completed_at,
      duration_seconds: r.duration_seconds ?? "",
    }));
    const keys = Object.keys(rows[0] || {});
    const lines = [
      keys.join(","),
      ...rows.map((row) => keys.map((k) => JSON.stringify((row as any)[k] ?? "")).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "asm-runs-export.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleViewDetails = async (run: DiscoveryRunWithName) => {
    try {
      const runDetail = await getRunDetail(run.id);
      setSelectedRun({ ...runDetail, discovery_name: discoveryCache[run.asm_discovery_id] || "Unknown" });
      setDetailOpen(true);
    } catch (error) {
      console.error("Failed to fetch run details:", error);
      setSelectedRun({ ...run, discovery_name: discoveryCache[run.asm_discovery_id] || "Unknown" });
      setDetailOpen(true);
    }
  };

  const filteredRuns = runs;
  const completedRuns = runs.filter(r => r.status === "COMPLETED").length;
  const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Total Runs", value: totalRuns, icon: Zap },
          { label: "Completed", value: completedRuns, icon: CheckCircle2 },
          { label: "Success Rate", value: `${successRate}%`, icon: CheckCircle2 },
          { label: "This Page", value: filteredRuns.length, icon: FileText },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="card-elevated p-4"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <stat.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Search + Sort + Export */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by discovery name or run ID..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            className="pl-11 h-11 rounded-xl bg-card"
          />
        </div>
        <select
          className="h-11 rounded-xl border border-border bg-card px-3 text-sm"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
        >
          <option value="started_at">Newest</option>
          <option value="completed_at">Completed</option>
          <option value="status">Status</option>
          <option value="created_at">Created</option>
        </select>
        <Button variant="outline" size="icon" onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}>
          <ArrowUpDown className="w-4 h-4" />
        </Button>
        <Button variant="outline" size="icon" onClick={exportRuns} disabled={!runs.length} title="Export CSV">
          <Download className="w-4 h-4" />
        </Button>
      </div>

      {/* Runs Table */}
      <div className="card-elevated overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="p-8 text-center">
            <div className="text-muted-foreground">No discovery runs found</div>
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead className="bg-muted/30 border-b border-border">
                <tr className="text-left text-sm text-muted-foreground">
                  <th className="p-4 font-medium">Discovery</th>
                  <th className="p-4 font-medium">Run Date</th>
                  <th className="p-4 font-medium">Triggered By</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium">Summary</th>
                  <th className="p-4 font-medium">Intensity</th>
                  <th className="p-4 font-medium">Duration</th>
                  <th className="p-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run, index) => (
                  <motion.tr
                    key={run.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.05 }}
                    className="border-t border-border hover:bg-muted/20 transition-colors"
                  >
                    <td className="p-4">
                      <div className="text-sm font-medium text-foreground">
                        {discoveryCache[run.asm_discovery_id] || "Loading..."}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {formatDate(run.started_at || run.created_at)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="text-lg">{getTriggerIcon(run.triggered_by)}</span>
                        <span>{run.triggered_by}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(run.status)}
                        <Badge 
                          variant="outline" 
                          className={`capitalize ${getStatusColor(run.status)}`}
                        >
                          {run.status.toLowerCase()}
                        </Badge>
                      </div>
                    </td>
                    <td className="p-4">
                      {run.summary ? (
                        <div className="text-sm space-y-1">
                          {run.summary.subdomains && (
                            <div className="text-foreground">
                              <span className="text-muted-foreground">Subdomains:</span>{" "}
                              <span className="font-medium">{run.summary.subdomains.found || 0}</span>
                              {run.summary.subdomains.inserted !== undefined && (
                                <span className="text-muted-foreground ml-1">
                                  ({run.summary.subdomains.inserted} new)
                                </span>
                              )}
                            </div>
                          )}
                          {run.summary.ips && (
                            <div className="text-foreground">
                              <span className="text-muted-foreground">IPs:</span>{" "}
                              <span className="font-medium">{run.summary.ips.found || 0}</span>
                              {run.summary.ips.inserted !== undefined && (
                                <span className="text-muted-foreground ml-1">
                                  ({run.summary.ips.inserted} new)
                                </span>
                              )}
                            </div>
                          )}
                          {/* Fallback for old summary format */}
                          {!run.summary.subdomains && !run.summary.ips && run.summary.found !== undefined && (
                            <div className="text-foreground">
                              <span className="text-muted-foreground">Found:</span> {run.summary.found}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-4">
                      {run.summary?.intensity ? (
                        <Badge 
                          variant="outline" 
                          className={`capitalize ${getIntensityColor(run.summary.intensity)}`}
                        >
                          {run.summary.intensity}
                        </Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-4">
                    <div className="text-sm text-muted-foreground">
                      {run.duration_seconds != null
                        ? formatDurationSeconds(run.duration_seconds)
                        : run.started_at && run.completed_at 
                        ? formatDuration(run.started_at, run.completed_at)
                        : run.started_at 
                        ? formatDuration(run.started_at, null)
                        : "N/A"
                      }
                    </div>
                    </td>
                    <td className="p-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewDetails(run)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
            
            {/* Pagination */}
            {totalRuns > 0 && (
              <div className="flex items-center justify-between p-4 border-t border-border">
                <div className="text-sm text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalRuns)} of {totalRuns} runs
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(1)}
                    disabled={page === 1}
                  >
                    First
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <div className="flex items-center gap-1 px-2">
                    <span className="text-sm text-muted-foreground">Page</span>
                    <span className="text-sm font-medium text-foreground">{page}</span>
                    <span className="text-sm text-muted-foreground">of</span>
                    <span className="text-sm font-medium text-foreground">{Math.ceil(totalRuns / pageSize)}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page * pageSize >= totalRuns}
                  >
                    Next
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.ceil(totalRuns / pageSize))}
                    disabled={page * pageSize >= totalRuns}
                  >
                    Last
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Run Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-primary" />
              Run Details
            </DialogTitle>
          </DialogHeader>
          {selectedRun && (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-6 py-4">
                {/* General Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Discovery</div>
                    <div className="font-medium">{selectedRun.discovery_name || "Unknown"}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Status</div>
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${getStatusColor(selectedRun.status)}`}>
                      {getStatusIcon(selectedRun.status)}
                      <span className="capitalize">{selectedRun.status}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Triggered By</div>
                    <div className="font-medium">{selectedRun.triggered_by}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Run Mode</div>
                    <div className="font-medium capitalize">{selectedRun.run_mode}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Started At</div>
                    <div className="font-medium">{formatDate(selectedRun.started_at || selectedRun.created_at)}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Completed At</div>
                    <div className="font-medium">{formatDate(selectedRun.completed_at)}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Duration</div>
                    <div className="font-medium">
                      {selectedRun.duration_seconds != null
                        ? formatDurationSeconds(selectedRun.duration_seconds)
                        : selectedRun.started_at && selectedRun.completed_at 
                        ? formatDuration(selectedRun.started_at, selectedRun.completed_at)
                        : selectedRun.started_at 
                        ? formatDuration(selectedRun.started_at, null)
                        : "N/A"
                      }
                    </div>
                  </div>
                </div>

                {/* Summary */}
                {selectedRun.summary && (
                  <div className="border-t border-border pt-4">
                    <div className="text-sm font-medium mb-3">Discovery Summary</div>
                    <div className="space-y-4">
                      {/* Subdomains Summary */}
                      {selectedRun.summary.subdomains && (
                        <div className="bg-muted/30 rounded-lg p-4">
                          <div className="text-sm font-medium mb-3 text-foreground">Subdomains</div>
                          <div className="grid grid-cols-4 gap-4">
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Found</div>
                              <div className="text-lg font-bold text-foreground">{selectedRun.summary.subdomains.found || 0}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Inserted</div>
                              <div className="text-lg font-bold text-success">{selectedRun.summary.subdomains.inserted || 0}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Skipped</div>
                              <div className="text-lg font-bold text-muted-foreground">{selectedRun.summary.subdomains.skipped || 0}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Errors</div>
                              <div className="text-lg font-bold text-destructive">{selectedRun.summary.subdomains.errors || 0}</div>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* IPs Summary */}
                      {selectedRun.summary.ips && (
                        <div className="bg-muted/30 rounded-lg p-4">
                          <div className="text-sm font-medium mb-3 text-foreground">IP Addresses</div>
                          <div className="grid grid-cols-4 gap-4">
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Found</div>
                              <div className="text-lg font-bold text-foreground">{selectedRun.summary.ips.found || 0}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Inserted</div>
                              <div className="text-lg font-bold text-success">{selectedRun.summary.ips.inserted || 0}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Skipped</div>
                              <div className="text-lg font-bold text-muted-foreground">{selectedRun.summary.ips.skipped || 0}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Errors</div>
                              <div className="text-lg font-bold text-destructive">{selectedRun.summary.ips.errors || 0}</div>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Pipeline Info */}
                      {selectedRun.summary.pipeline_steps !== undefined && (
                        <div className="bg-muted/30 rounded-lg p-4">
                          <div className="text-sm font-medium mb-2 text-foreground">Pipeline</div>
                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">{selectedRun.summary.pipeline_steps}</span> steps executed
                            {selectedRun.summary.intensity && (
                              <span className="ml-2">
                                • Intensity: <span className="font-medium text-foreground capitalize">{selectedRun.summary.intensity}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* Fallback for old format */}
                      {!selectedRun.summary.subdomains && !selectedRun.summary.ips && selectedRun.summary.found !== undefined && (
                        <div className="grid grid-cols-2 gap-4 bg-muted/30 rounded-lg p-4">
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Found</div>
                            <div className="text-lg font-bold text-foreground">{selectedRun.summary.found}</div>
                          </div>
                          {selectedRun.summary.inserted !== undefined && (
                            <div>
                              <div className="text-xs text-muted-foreground mb-1">Inserted</div>
                              <div className="text-lg font-bold text-success">{selectedRun.summary.inserted}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Discovered Domains */}
                {selectedRun.summary?.domains && Array.isArray(selectedRun.summary.domains) && selectedRun.summary.domains.length > 0 && (
                  <div className="border-t border-border pt-4">
                    <div className="text-sm font-medium mb-3">Discovered Domains</div>
                    <div className="bg-muted/30 rounded-lg p-4 max-h-64 overflow-y-auto">
                      <div className="space-y-2">
                        {selectedRun.summary.domains.map((domain: string, idx: number) => (
                          <div key={idx} className="text-sm font-mono text-foreground py-1 px-2 bg-background rounded">
                            {domain}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {selectedRun.error_message && (
                  <div className="border-t border-border pt-4">
                    <div className="text-sm font-medium text-destructive mb-2">Error</div>
                    <div className="bg-destructive/10 rounded-lg p-3 text-sm text-destructive">
                      {selectedRun.error_message}
                    </div>
                  </div>
                )}

                {/* Raw Summary JSON */}
                {selectedRun.summary && (
                  <div className="border-t border-border pt-4">
                    <div className="text-sm font-medium mb-2">Raw Summary</div>
                    <div className="bg-muted/30 rounded-lg p-4">
                      <pre className="text-xs font-mono text-foreground overflow-x-auto">
                        {JSON.stringify(selectedRun.summary, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
