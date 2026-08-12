import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SeverityBadge } from "@/components/asm/SeverityBadge";
import { EmptyState } from "@/components/asm/EmptyState";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  Download,
  MoreHorizontal,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Eye,
  UserPlus,
  Shield,
  ShieldAlert,
  RefreshCw,
  Bug,
  Flame,
  Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { exportRowsToCsv } from "@/lib/csv";
import {
  fetchFindings,
  transitionFinding,
  assignFinding,
  fetchCve,
  verifyFinding,
  downloadVsReport,
  type VsFinding,
  type VsFindingStatus,
  type VsCveDetail,
} from "@/lib/services/vs";

interface VSFindingsProps {
  canWrite?: boolean;
}

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

// transitions offered from the findings list
const TRANSITIONS: { status: VsFindingStatus; label: string }[] = [
  { status: "confirmed", label: "Confirm" },
  { status: "in_progress", label: "Start Progress" },
  { status: "remediated", label: "Mark Remediated" },
  { status: "verified", label: "Verify" },
  { status: "closed", label: "Close" },
  { status: "accepted_risk", label: "Accept Risk" },
  { status: "false_positive", label: "Mark False Positive" },
];

const JUSTIFICATION_REQUIRED: VsFindingStatus[] = ["accepted_risk", "false_positive"];

function getStatusIcon(status: VsFindingStatus) {
  switch (status) {
    case "open":
    case "confirmed":
      return <AlertTriangle className="w-4 h-4 text-destructive" />;
    case "in_progress":
    case "remediated":
      return <Clock className="w-4 h-4 text-warning" />;
    case "verified":
    case "closed":
      return <CheckCircle2 className="w-4 h-4 text-success" />;
    default:
      return <Shield className="w-4 h-4 text-muted-foreground" />;
  }
}

// `location` from the worker is an object ({host, port, service, version, url}),
// never a plain string — format it into something readable instead of dumping
// the raw object (which React can't render as a child at all).
function formatLocation(location: VsFinding["location"]): string | null {
  if (!location) return null;
  if (typeof location === "string") return location;
  const { url, host, port, service, version } = location;
  if (url) return url;
  let out = host ? String(host) : "";
  if (port) out += out ? `:${port}` : String(port);
  if (service) out += out ? ` (${service}${version ? ` ${version}` : ""})` : String(service);
  return out || null;
}

export function VSFindings({ canWrite = true }: VSFindingsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [kevOnly, setKevOnly] = useState(false);

  const [findings, setFindings] = useState<VsFinding[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedVuln, setSelectedVuln] = useState<VsFinding | null>(null);
  const [cve, setCve] = useState<VsCveDetail | null>(null);
  const [cveLoading, setCveLoading] = useState(false);

  const [actionBusy, setActionBusy] = useState(false);

  // justification modal
  const [justifyTarget, setJustifyTarget] = useState<{ finding: VsFinding; status: VsFindingStatus } | null>(null);
  const [justification, setJustification] = useState("");

  // assign modal
  const [assignTarget, setAssignTarget] = useState<VsFinding | null>(null);
  const [assignee, setAssignee] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const page = await fetchFindings({
        q: searchQuery || undefined,
        status: statusFilter,
        severity: severityFilter,
        kev: kevOnly || undefined,
        page: 1,
        page_size: 200,
      });
      setFindings(page.items);
      setTotal(page.total);
    } catch (e: any) {
      setError(e.message ?? "Failed to load findings");
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, severityFilter, kevOnly]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // load CVE detail when a finding with cve_id is opened
  useEffect(() => {
    setCve(null);
    if (!selectedVuln?.cve_id) return;
    let cancelled = false;
    setCveLoading(true);
    fetchCve(selectedVuln.cve_id)
      .then((d) => { if (!cancelled) setCve(d); })
      .catch(() => { if (!cancelled) setCve(null); })
      .finally(() => { if (!cancelled) setCveLoading(false); });
    return () => { cancelled = true; };
  }, [selectedVuln?.cve_id]);

  const stats = {
    critical: findings.filter((v) => v.severity === "critical").length,
    high: findings.filter((v) => v.severity === "high").length,
    medium: findings.filter((v) => v.severity === "medium").length,
    low: findings.filter((v) => v.severity === "low").length,
  };

  const doTransition = async (finding: VsFinding, status: VsFindingStatus, just?: string) => {
    if (!canWrite) return;
    setActionBusy(true);
    try {
      const updated = await transitionFinding(finding.id, { status, justification: just });
      toast({ title: "Status updated", description: `${finding.title} → ${STATUS_LABEL[status]}` });
      setFindings((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setSelectedVuln((prev) => (prev && prev.id === updated.id ? updated : prev));
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message ?? "Unexpected error", variant: "destructive" });
    } finally {
      setActionBusy(false);
    }
  };

  const requestTransition = (finding: VsFinding, status: VsFindingStatus) => {
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to change findings." });
      return;
    }
    if (JUSTIFICATION_REQUIRED.includes(status)) {
      setJustification("");
      setJustifyTarget({ finding, status });
    } else {
      doTransition(finding, status);
    }
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

  const submitAssign = async () => {
    if (!assignTarget) return;
    if (!canWrite) return;
    setActionBusy(true);
    try {
      const updated = await assignFinding(assignTarget.id, { assigned_to: assignee.trim() || null });
      toast({ title: "Finding assigned", description: assignee.trim() ? `Assigned to ${assignee.trim()}` : "Unassigned" });
      setFindings((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
      setSelectedVuln((prev) => (prev && prev.id === updated.id ? updated : prev));
      setAssignTarget(null);
      setAssignee("");
    } catch (e: any) {
      toast({ title: "Assign failed", description: e.message ?? "Unexpected error", variant: "destructive" });
    } finally {
      setActionBusy(false);
    }
  };

  const openAssign = (finding: VsFinding) => {
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to assign findings." });
      return;
    }
    setAssignTarget(finding);
    setAssignee(finding.assigned_to ?? "");
  };

  const handleExport = () => {
    if (findings.length === 0) {
      toast({ title: "Nothing to export", description: "No findings match the current filters." });
      return;
    }
    exportRowsToCsv(
      findings.map((f) => ({
        id: f.id,
        title: f.title,
        severity: f.severity,
        cve_id: f.cve_id ?? "",
        cvss_base: f.cvss_base ?? "",
        epss: f.epss ?? "",
        kev: f.kev,
        composite_risk: f.composite_risk ?? "",
        status: f.status,
        asset_id: f.asset_id,
        source_engine: f.source_engine,
        assigned_to: f.assigned_to ?? "",
        first_detected_at: f.first_detected_at ?? "",
        last_detected_at: f.last_detected_at ?? "",
      })),
      "vs-findings"
    );
  };

  const doVerify = async (finding: VsFinding) => {
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to verify findings." });
      return;
    }
    setActionBusy(true);
    try {
      await verifyFinding(finding.id);
      toast({ title: "Verification scan queued", description: `Re-scanning to confirm "${finding.title}".` });
    } catch (e: any) {
      const msg = e?.message ?? "Unexpected error";
      // 400 = the finding has no originating scan to re-run.
      const friendly = /no originating scan|400/i.test(msg)
        ? "This finding has no originating scan to re-run, so it can't be verified automatically."
        : msg;
      toast({ title: "Verification unavailable", description: friendly, variant: "destructive" });
    } finally {
      setActionBusy(false);
    }
  };

  const [reportBusy, setReportBusy] = useState<"pdf" | "csv" | null>(null);
  const handleReportDownload = async (reportType: string, format: "pdf" | "csv") => {
    setReportBusy(format);
    try {
      await downloadVsReport(reportType, format);
      toast({ title: "Report downloading", description: `Your ${format.toUpperCase()} report is being generated.` });
    } catch (e: any) {
      toast({ title: "Download failed", description: e?.message ?? "Unexpected error", variant: "destructive" });
    } finally {
      setReportBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Vulnerability Findings</h2>
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : `${total} findings detected across your assets`}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={handleExport} disabled={findings.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button
            variant="outline"
            onClick={() => handleReportDownload("executive", "pdf")}
            disabled={reportBusy !== null}
          >
            {reportBusy === "pdf" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Executive PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => handleReportDownload("technical", "csv")}
            disabled={reportBusy !== null}
          >
            {reportBusy === "csv" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Technical CSV
          </Button>
        </div>
      </div>

      {/* Severity Stats (of loaded page) */}
      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Critical", value: stats.critical, color: "bg-destructive/10 text-destructive border-destructive/20", filter: "critical" },
          { label: "High", value: stats.high, color: "bg-warning/10 text-warning border-warning/20", filter: "high" },
          { label: "Medium", value: stats.medium, color: "bg-accent/10 text-accent border-accent/20", filter: "medium" },
          { label: "Low", value: stats.low, color: "bg-success/10 text-success border-success/20", filter: "low" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className={cn(
              "p-4 rounded-xl border cursor-pointer hover:shadow-md transition-all",
              stat.color,
              severityFilter === stat.filter && "ring-2 ring-offset-2"
            )}
            onClick={() => setSeverityFilter(severityFilter === stat.filter ? "all" : stat.filter)}
          >
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="text-sm opacity-80">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by CVE, title, or asset..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {(Object.keys(STATUS_LABEL) as VsFindingStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant={kevOnly ? "default" : "outline"}
          onClick={() => setKevOnly((v) => !v)}
          className="gap-2"
        >
          <Flame className="w-4 h-4" /> KEV only
        </Button>
      </div>

      {/* Findings Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading findings…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4 mr-2" /> Retry
          </Button>
        </div>
      ) : findings.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState
            icon={Bug}
            title="No findings"
            description="No vulnerabilities match your current filters. Run a scan or adjust the filters."
          />
        </div>
      ) : (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-left text-sm text-muted-foreground">
                  <th className="p-4 font-medium">Severity</th>
                  <th className="p-4 font-medium">CVE</th>
                  <th className="p-4 font-medium">Vulnerability</th>
                  <th className="p-4 font-medium">CVSS</th>
                  <th className="p-4 font-medium">Risk</th>
                  <th className="p-4 font-medium">Threat</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {findings.map((vuln) => (
                  <motion.tr
                    key={vuln.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-t border-border hover:bg-muted/20 cursor-pointer transition-colors"
                    onClick={() => setSelectedVuln(vuln)}
                  >
                    <td className="p-4">
                      <SeverityBadge severity={vuln.severity} />
                    </td>
                    <td className="p-4">
                      {vuln.cve_id ? (
                        <div className="flex items-center gap-1">
                          <code className="text-sm font-mono text-primary">{vuln.cve_id}</code>
                          <ExternalLink className="w-3 h-3 text-muted-foreground" />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="font-medium text-foreground max-w-xs truncate">{vuln.title}</div>
                      <div className="text-xs text-muted-foreground">{vuln.source_engine}</div>
                    </td>
                    <td className="p-4">
                      {typeof vuln.cvss_base === "number" ? (
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "font-bold",
                            vuln.cvss_base >= 9 ? "text-destructive" :
                            vuln.cvss_base >= 7 ? "text-warning" :
                            vuln.cvss_base >= 4 ? "text-accent" : "text-success"
                          )}>
                            {vuln.cvss_base.toFixed(1)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-4">
                      {typeof vuln.composite_risk === "number" ? (
                        <span className="text-sm font-semibold text-foreground">{vuln.composite_risk.toFixed(0)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {vuln.kev && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive flex items-center gap-1">
                            <Flame className="w-3 h-3" /> KEV
                          </span>
                        )}
                        {typeof vuln.epss === "number" && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning">
                            EPSS {(vuln.epss * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(vuln.status)}
                        <span className="text-sm">{STATUS_LABEL[vuln.status]}</span>
                      </div>
                    </td>
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setSelectedVuln(vuln)}><Eye className="w-4 h-4 mr-2" />View Details</DropdownMenuItem>
                          {canWrite && (
                            <>
                              <DropdownMenuItem onClick={() => openAssign(vuln)}><UserPlus className="w-4 h-4 mr-2" />Assign</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {TRANSITIONS.map((t) => (
                                <DropdownMenuItem
                                  key={t.status}
                                  disabled={vuln.status === t.status}
                                  onClick={() => requestTransition(vuln, t.status)}
                                >
                                  {t.label}
                                </DropdownMenuItem>
                              ))}
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

      {/* Detail Sheet */}
      <Sheet open={!!selectedVuln} onOpenChange={() => setSelectedVuln(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedVuln && (
            <>
              <SheetHeader>
                <div className="flex items-start gap-3">
                  <SeverityBadge severity={selectedVuln.severity} />
                  <div>
                    <SheetTitle>{selectedVuln.title}</SheetTitle>
                    <div className="flex items-center gap-2 mt-1">
                      {selectedVuln.cve_id && (
                        <code className="text-sm font-mono text-primary">{selectedVuln.cve_id}</code>
                      )}
                      <span className="text-xs text-muted-foreground">{selectedVuln.source_engine}</span>
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Quick Actions */}
                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="gradient" size="sm" disabled={actionBusy} onClick={() => requestTransition(selectedVuln, "remediated")}>
                      <CheckCircle2 className="w-4 h-4 mr-1" />Mark Remediated
                    </Button>
                    {(selectedVuln.status === "open" || selectedVuln.status === "confirmed") && (
                      <Button variant="outline" size="sm" disabled={actionBusy} onClick={() => doVerify(selectedVuln)}>
                        <RefreshCw className="w-4 h-4 mr-1" />Verify
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openAssign(selectedVuln)}>
                      <UserPlus className="w-4 h-4 mr-1" />Assign
                    </Button>
                    <Button variant="outline" size="sm" disabled={actionBusy} onClick={() => requestTransition(selectedVuln, "accepted_risk")}>
                      <Shield className="w-4 h-4 mr-1" />Accept Risk
                    </Button>
                    <Button variant="outline" size="sm" disabled={actionBusy} onClick={() => requestTransition(selectedVuln, "false_positive")}>
                      <AlertTriangle className="w-4 h-4 mr-1" />False Positive
                    </Button>
                  </div>
                )}

                {/* Scores row */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">CVSS Base</div>
                    <div className="text-xl font-bold text-foreground">
                      {typeof selectedVuln.cvss_base === "number" ? selectedVuln.cvss_base.toFixed(1) : "—"}
                    </div>
                    {typeof selectedVuln.cvss_base === "number" && (
                      <Progress value={selectedVuln.cvss_base * 10} className="h-2 mt-2" />
                    )}
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">EPSS</div>
                    <div className="text-xl font-bold text-foreground">
                      {typeof selectedVuln.epss === "number" ? `${(selectedVuln.epss * 100).toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Composite Risk</div>
                    <div className="text-xl font-bold text-foreground">
                      {typeof selectedVuln.composite_risk === "number" ? selectedVuln.composite_risk.toFixed(0) : "—"}
                    </div>
                  </div>
                </div>

                {/* KEV banner */}
                {selectedVuln.kev && (
                  <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-xl flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-destructive" />
                    <div>
                      <div className="font-medium text-destructive">Known Exploited Vulnerability (CISA KEV)</div>
                      {cve?.kev_due_date && (
                        <div className="text-xs text-muted-foreground">Remediation due: {cve.kev_due_date}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Info grid */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Confidence</div>
                    <div className="text-sm capitalize">{selectedVuln.confidence}</div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Status</div>
                    <div className="text-sm">{STATUS_LABEL[selectedVuln.status]}</div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Assigned To</div>
                    <div className="text-sm">{selectedVuln.assigned_to || "Unassigned"}</div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">SLA Due</div>
                    <div className="text-sm">{selectedVuln.sla_due_at ? new Date(selectedVuln.sla_due_at).toLocaleDateString() : "—"}</div>
                  </div>
                  {selectedVuln.category && (
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">Category</div>
                      <div className="text-sm">{selectedVuln.category}</div>
                    </div>
                  )}
                  {formatLocation(selectedVuln.location) && (
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">Location</div>
                      <div className="text-sm font-mono break-all">{formatLocation(selectedVuln.location)}</div>
                    </div>
                  )}
                </div>

                {/* Description */}
                {selectedVuln.description && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-foreground">Description</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{selectedVuln.description}</p>
                  </div>
                )}

                {/* Why this score */}
                {selectedVuln.risk_factors && selectedVuln.risk_factors.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-foreground">Why this score</h4>
                    <div className="space-y-2">
                      {selectedVuln.risk_factors.map((rf, i) => (
                        <div key={i} className="flex items-start justify-between gap-3 p-3 bg-muted/30 rounded-lg">
                          <div>
                            <div className="text-sm font-medium">{rf.name}</div>
                            {rf.detail && <div className="text-xs text-muted-foreground">{rf.detail}</div>}
                          </div>
                          <span className={cn(
                            "text-sm font-bold shrink-0",
                            rf.points >= 0 ? "text-destructive" : "text-success"
                          )}>
                            {rf.points >= 0 ? "+" : ""}{rf.points}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Evidence */}
                {selectedVuln.evidence && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-foreground">Evidence</h4>
                    <pre className="text-xs bg-muted/50 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{selectedVuln.evidence}</pre>
                  </div>
                )}

                {/* CVE detail */}
                {selectedVuln.cve_id && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-foreground">CVE Intelligence</h4>
                    {cveLoading ? (
                      <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading {selectedVuln.cve_id}…</div>
                    ) : cve ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          {cve.cvss_v31 && (
                            <div className="p-3 bg-muted/30 rounded-lg">
                              <div className="text-xs text-muted-foreground">CVSS v3.1</div>
                              <div className="font-bold">{cve.cvss_v31.score}</div>
                              <div className="text-xs font-mono text-muted-foreground break-all">{cve.cvss_v31.vector}</div>
                            </div>
                          )}
                          {cve.cvss_v40 && (
                            <div className="p-3 bg-muted/30 rounded-lg">
                              <div className="text-xs text-muted-foreground">CVSS v4.0</div>
                              <div className="font-bold">{cve.cvss_v40.score}</div>
                              <div className="text-xs font-mono text-muted-foreground break-all">{cve.cvss_v40.vector}</div>
                            </div>
                          )}
                        </div>
                        {cve.affected_versions && cve.affected_versions.length > 0 && (
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Affected Versions</div>
                            <div className="flex flex-wrap gap-1">
                              {cve.affected_versions.map((v, i) => (
                                <span key={i} className="text-xs px-2 py-0.5 bg-muted rounded-full font-mono">{v}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {cve.cwe_ids && cve.cwe_ids.length > 0 && (
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">CWE</div>
                            <div className="flex flex-wrap gap-1">
                              {cve.cwe_ids.map((c, i) => (
                                <span key={i} className="text-xs px-2 py-0.5 bg-muted rounded-full font-mono">{c}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {cve.references && cve.references.length > 0 && (
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">References</div>
                            <ul className="space-y-1">
                              {cve.references.slice(0, 5).map((r, i) => (
                                <li key={i}>
                                  <a href={r} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all inline-flex items-center gap-1">
                                    <ExternalLink className="w-3 h-3 shrink-0" />{r}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No enriched CVE data available.</p>
                    )}
                  </div>
                )}

                {/* Detection Timeline */}
                {(selectedVuln.first_detected_at || selectedVuln.last_detected_at) && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-foreground">Detection Timeline</h4>
                    <div className="flex items-center gap-4 text-sm flex-wrap">
                      {selectedVuln.first_detected_at && (
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-primary" />
                          <span className="text-muted-foreground">First:</span>
                          <span className="font-medium">{new Date(selectedVuln.first_detected_at).toLocaleString()}</span>
                        </div>
                      )}
                      {selectedVuln.last_detected_at && (
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-destructive" />
                          <span className="text-muted-foreground">Last:</span>
                          <span className="font-medium">{new Date(selectedVuln.last_detected_at).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Justification Modal */}
      <Dialog open={!!justifyTarget} onOpenChange={(o) => { if (!o) { setJustifyTarget(null); setJustification(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {justifyTarget ? STATUS_LABEL[justifyTarget.status] : ""} — Justification Required
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Provide a justification for transitioning "{justifyTarget?.finding.title}" to{" "}
              <span className="font-medium">{justifyTarget ? STATUS_LABEL[justifyTarget.status] : ""}</span>.
            </p>
            <div className="space-y-2">
              <Label>Justification *</Label>
              <Textarea rows={4} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Explain the reason…" />
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => { setJustifyTarget(null); setJustification(""); }}>Cancel</Button>
              <Button variant="gradient" onClick={submitJustification} disabled={actionBusy}>
                {actionBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Assign Modal */}
      <Dialog open={!!assignTarget} onOpenChange={(o) => { if (!o) { setAssignTarget(null); setAssignee(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" />Assign Finding
            </DialogTitle>
          </DialogHeader>
          {assignTarget && (
            <div className="space-y-4 py-2">
              <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
                <div className="flex items-center gap-2 mb-1">
                  <SeverityBadge severity={assignTarget.severity} />
                  {assignTarget.cve_id && <code className="text-sm font-mono text-primary">{assignTarget.cve_id}</code>}
                </div>
                <div className="text-sm font-medium">{assignTarget.title}</div>
              </div>
              <div className="space-y-2">
                <Label>Assignee (user id or email)</Label>
                <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="user@company.com — leave blank to unassign" />
              </div>
              <div className="flex justify-end gap-3 pt-2 border-t border-border">
                <Button variant="outline" onClick={() => { setAssignTarget(null); setAssignee(""); }}>Cancel</Button>
                <Button variant="gradient" onClick={submitAssign} disabled={actionBusy}>
                  {actionBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Save
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
