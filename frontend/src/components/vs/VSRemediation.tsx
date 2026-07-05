import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Search,
  Clock,
  AlertTriangle,
  CheckCircle2,
  User,
  Calendar,
  ChevronRight,
  ArrowRight,
  Timer,
  Target,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "@/components/asm/SeverityBadge";
import { EmptyState } from "@/components/asm/EmptyState";
import { toast } from "@/hooks/use-toast";
import {
  fetchFindings,
  transitionFinding,
  type VsFinding,
  type VsFindingStatus,
} from "@/lib/services/vs";

interface VSRemediationProps {
  canWrite?: boolean;
}

// SLA guidelines by severity (display only; backend sets sla_due_at)
const slaConfig: Record<string, string> = {
  critical: "24 hours",
  high: "72 hours",
  medium: "7 days",
  low: "30 days",
};

// forward workflow: current -> next actionable step
const NEXT_STEP: Partial<Record<VsFindingStatus, { status: VsFindingStatus; label: string }>> = {
  open: { status: "confirmed", label: "Confirm" },
  confirmed: { status: "in_progress", label: "Start Remediation" },
  in_progress: { status: "remediated", label: "Mark Remediated" },
  remediated: { status: "verified", label: "Verify Fix" },
  verified: { status: "closed", label: "Close" },
};

const STATUS_LABEL: Record<VsFindingStatus, string> = {
  open: "Open",
  confirmed: "Confirmed",
  in_progress: "In Progress",
  remediated: "Remediated",
  verified: "Verified",
  closed: "Closed",
  accepted_risk: "Accepted Risk",
  false_positive: "False Positive",
};

// items in these states are actionable in the remediation workflow
const ACTIONABLE: VsFindingStatus[] = ["open", "confirmed", "in_progress", "remediated", "verified"];

function statusBadge(status: VsFindingStatus) {
  const map: Record<VsFindingStatus, string> = {
    open: "bg-destructive/10 text-destructive",
    confirmed: "bg-destructive/10 text-destructive",
    in_progress: "bg-warning/10 text-warning",
    remediated: "bg-accent/10 text-accent",
    verified: "bg-success/10 text-success",
    closed: "bg-success/10 text-success",
    accepted_risk: "bg-muted text-muted-foreground",
    false_positive: "bg-muted text-muted-foreground",
  };
  return <span className={cn("px-2 py-1 text-xs rounded-full", map[status])}>{STATUS_LABEL[status]}</span>;
}

function isOverdue(f: VsFinding) {
  return !!f.sla_due_at && new Date(f.sla_due_at).getTime() < Date.now();
}

export function VSRemediation({ canWrite = true }: VSRemediationProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [items, setItems] = useState<VsFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<VsFinding | null>(null);
  const [busy, setBusy] = useState(false);

  // justification modal for accept_risk / false_positive
  const [justifyTarget, setJustifyTarget] = useState<{ finding: VsFinding; status: VsFindingStatus } | null>(null);
  const [justification, setJustification] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const page = await fetchFindings({ page: 1, page_size: 200 });
      setItems(page.items.filter((f) => ACTIONABLE.includes(f.status)));
    } catch (e: any) {
      setError(e.message ?? "Failed to load remediation items");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.cve_id ?? "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    open: items.filter((i) => i.status === "open" || i.status === "confirmed").length,
    inProgress: items.filter((i) => i.status === "in_progress").length,
    overdue: items.filter((i) => isOverdue(i)).length,
    verified: items.filter((i) => i.status === "verified").length,
  };

  const doTransition = async (finding: VsFinding, status: VsFindingStatus, just?: string) => {
    if (!canWrite) return;
    setBusy(true);
    try {
      const updated = await transitionFinding(finding.id, { status, justification: just });
      toast({ title: "Status updated", description: `${finding.title} → ${STATUS_LABEL[status]}` });
      // remove from list if no longer actionable, else update in place
      setItems((prev) => {
        const next = prev.map((f) => (f.id === updated.id ? updated : f));
        return next.filter((f) => ACTIONABLE.includes(f.status));
      });
      setSelectedItem((prev) => (prev && prev.id === updated.id
        ? (ACTIONABLE.includes(updated.status) ? updated : null)
        : prev));
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message ?? "Unexpected error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const requestJustified = (finding: VsFinding, status: VsFindingStatus) => {
    setJustification("");
    setJustifyTarget({ finding, status });
  };

  const submitJustification = async () => {
    if (!justifyTarget) return;
    if (!justification.trim()) {
      toast({ title: "Justification required", description: "Please provide a reason.", variant: "destructive" });
      return;
    }
    await doTransition(justifyTarget.finding, justifyTarget.status, justification.trim());
    setJustifyTarget(null);
    setJustification("");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Remediation & Workflow</h2>
          <p className="text-sm text-muted-foreground">Track and manage vulnerability remediation</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Open", value: stats.open, icon: AlertTriangle, color: "bg-destructive/10 text-destructive" },
          { label: "In Progress", value: stats.inProgress, icon: Clock, color: "bg-warning/10 text-warning" },
          { label: "Overdue SLA", value: stats.overdue, icon: Timer, color: "bg-destructive/10 text-destructive border-destructive/30 border-2" },
          { label: "Awaiting Verify", value: stats.verified, icon: CheckCircle2, color: "bg-success/10 text-success" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className={cn("rounded-2xl p-5", stat.color)}
          >
            <div className="flex items-center gap-3">
              <stat.icon className="w-5 h-5" />
              <div>
                <div className="text-2xl font-bold">{loading ? "—" : stat.value}</div>
                <div className="text-xs opacity-80">{stat.label}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* SLA Guidelines */}
      <div className="bg-muted/30 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-primary" />
          <span className="font-medium text-sm">SLA Guidelines</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          {Object.entries(slaConfig).map(([severity, time]) => (
            <div key={severity} className="flex items-center gap-2">
              <SeverityBadge severity={severity as any} showDot={false} />
              <span className="text-muted-foreground">{time}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {ACTIONABLE.map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Items */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-2" /> Retry</Button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState
            icon={CheckCircle2}
            title={items.length === 0 ? "No open remediation work" : "No items match your filters"}
            description={items.length === 0 ? "All findings are resolved or none are actionable yet." : "Try adjusting your search or status filter."}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item, index) => {
            const overdue = isOverdue(item);
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className={cn(
                  "bg-card rounded-2xl border p-5 hover:shadow-md cursor-pointer transition-all",
                  overdue ? "border-destructive/50" : "border-border"
                )}
                onClick={() => setSelectedItem(item)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <SeverityBadge severity={item.severity} />
                    <div>
                      <div className="font-medium text-foreground">{item.title}</div>
                      <div className="text-sm text-muted-foreground font-mono">{item.cve_id ?? item.source_engine}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {statusBadge(item.status)}
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>

                <div className="flex items-center gap-6 mt-4 pt-4 border-t border-border text-sm flex-wrap">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="w-4 h-4" />
                    <span>{item.assigned_to || "Unassigned"}</span>
                  </div>
                  <div className={cn("flex items-center gap-2", overdue ? "text-destructive" : "text-muted-foreground")}>
                    <Calendar className="w-4 h-4" />
                    <span>
                      {item.sla_due_at
                        ? `${overdue ? "Overdue: " : "Due: "}${new Date(item.sla_due_at).toLocaleDateString()}`
                        : "No SLA"}
                    </span>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="sm:max-w-xl">
          {selectedItem && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-3">
                  <SeverityBadge severity={selectedItem.severity} />
                  <div>
                    <DialogTitle>{selectedItem.title}</DialogTitle>
                    {selectedItem.cve_id && <p className="text-sm text-muted-foreground font-mono mt-1">{selectedItem.cve_id}</p>}
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                {/* Status & Actions */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  {statusBadge(selectedItem.status)}
                  {canWrite && (
                    <div className="flex gap-2 flex-wrap">
                      {NEXT_STEP[selectedItem.status] && (
                        <Button
                          variant="gradient"
                          size="sm"
                          disabled={busy}
                          onClick={() => doTransition(selectedItem, NEXT_STEP[selectedItem.status]!.status)}
                        >
                          <ArrowRight className="w-4 h-4 mr-1" />{NEXT_STEP[selectedItem.status]!.label}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => requestJustified(selectedItem, "accepted_risk")}>
                        Accept Risk
                      </Button>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => requestJustified(selectedItem, "false_positive")}>
                        False Positive
                      </Button>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Source Engine</div>
                    <div className="text-sm">{selectedItem.source_engine}</div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Assigned To</div>
                    <div className="text-sm">{selectedItem.assigned_to || "Unassigned"}</div>
                  </div>
                  <div className={cn("p-3 rounded-lg", isOverdue(selectedItem) ? "bg-destructive/10" : "bg-muted/30")}>
                    <div className="text-xs text-muted-foreground mb-1">SLA Deadline</div>
                    <div className={cn("text-sm font-medium", isOverdue(selectedItem) && "text-destructive")}>
                      {selectedItem.sla_due_at ? new Date(selectedItem.sla_due_at).toLocaleString() : "No SLA"}
                      {isOverdue(selectedItem) && " (OVERDUE)"}
                    </div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Composite Risk</div>
                    <div className="text-sm">{typeof selectedItem.composite_risk === "number" ? selectedItem.composite_risk.toFixed(0) : "—"}</div>
                  </div>
                </div>

                {selectedItem.description && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-foreground text-sm">Description</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedItem.description}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Justification Modal */}
      <Dialog open={!!justifyTarget} onOpenChange={(o) => { if (!o) { setJustifyTarget(null); setJustification(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{justifyTarget ? STATUS_LABEL[justifyTarget.status] : ""} — Justification Required</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Provide a justification for this transition.</p>
            <div className="space-y-2">
              <Label>Justification *</Label>
              <Textarea rows={4} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Explain the reason…" />
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => { setJustifyTarget(null); setJustification(""); }}>Cancel</Button>
              <Button variant="gradient" onClick={submitJustification} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
