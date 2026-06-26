import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  Download,
  Calendar,
  Plus,
  Eye,
  Clock,
  Shield,
  BarChart3,
  PieChart,
  Radar,
  Bug,
  Search,
  Trash2,
  Edit,
  Printer,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { getMe } from "@/lib/services/auth";
import {
  fetchReports,
  generateReport,
  getReport,
  deleteReport,
  triggerReportDownload,
  fetchScheduledReports,
  createScheduledReport,
  updateScheduledReport,
  deleteScheduledReport,
  type Report,
  type ScheduledReport,
  type ReportModule,
  type ReportType,
  type ReportFormat,
  type ScheduleFrequency,
  type GenerateReportPayload,
} from "@/lib/services/reports";

const SECTION_OPTIONS = [
  { id: "summary", label: "Executive Summary" },
  { id: "assets", label: "Asset Inventory" },
  { id: "vulnerabilities", label: "Vulnerabilities" },
  { id: "recommendations", label: "Recommendations" },
];

const TEMPLATES: {
  name: string;
  description: string;
  icon: typeof PieChart;
  module: ReportModule;
  type: ReportType;
}[] = [
  { name: "Executive Summary", description: "High-level overview for leadership", icon: PieChart, module: "all", type: "executive" },
  { name: "ASM Technical Report", description: "Detailed attack surface analysis", icon: Radar, module: "asm", type: "technical" },
  { name: "VS Scan Report", description: "Vulnerability scan results", icon: Bug, module: "vs", type: "vulnerability" },
  { name: "Asset Inventory", description: "Complete asset listing", icon: FileText, module: "asm", type: "assets" },
];

function getTypeIcon(type: string) {
  switch (type) {
    case "executive": return <PieChart className="w-4 h-4 text-primary" />;
    case "technical": return <BarChart3 className="w-4 h-4 text-secondary" />;
    case "compliance": return <Shield className="w-4 h-4 text-accent" />;
    case "vulnerability": return <Bug className="w-4 h-4 text-destructive" />;
    case "assets": return <Radar className="w-4 h-4 text-primary" />;
    default: return <FileText className="w-4 h-4" />;
  }
}

function getModuleBadge(module: string) {
  switch (module) {
    case "asm": return <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">ASM</Badge>;
    case "vs": return <Badge variant="outline" className="text-xs bg-secondary/10 text-secondary border-secondary/20">VS</Badge>;
    default: return <Badge variant="outline" className="text-xs">All</Badge>;
  }
}

function severityClass(sev: string) {
  switch (sev) {
    case "critical": return "bg-destructive/10 text-destructive border-destructive/20";
    case "high": return "bg-warning/10 text-warning border-warning/20";
    case "medium": return "bg-accent/10 text-accent border-accent/20";
    default: return "bg-success/10 text-success border-success/20";
  }
}

const EMPTY_GEN = {
  name: "",
  module: "all" as ReportModule,
  report_type: "executive" as ReportType,
  date_range: "all",
  format: "pdf" as ReportFormat,
};

export default function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [moduleFilter, setModuleFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [isNewReportOpen, setIsNewReportOpen] = useState(false);
  const [genForm, setGenForm] = useState({ ...EMPTY_GEN });
  const [genSections, setGenSections] = useState<string[]>(SECTION_OPTIONS.map((s) => s.id));
  const [isGenerating, setIsGenerating] = useState(false);

  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Scheduled dialog
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduledReport | null>(null);
  const [schedForm, setSchedForm] = useState({
    name: "",
    module: "all" as ReportModule,
    report_type: "executive" as ReportType,
    format: "pdf" as ReportFormat,
    frequency: "weekly" as ScheduleFrequency,
    recipients: "",
  });
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [currentRole, setCurrentRole] = useState<string>("reader");
  const canWrite = currentRole !== "reader";

  useEffect(() => {
    let mounted = true;
    getMe()
      .then((me) => mounted && setCurrentRole(me.role ?? "reader"))
      .catch(() => mounted && setCurrentRole("reader"));
    return () => { mounted = false; };
  }, []);

  const loadAll = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [r, s] = await Promise.all([
        fetchReports({ module: moduleFilter, q: searchQuery || undefined }),
        fetchScheduledReports(),
      ]);
      setReports(r.items);
      setScheduled(s.items);
    } catch (err: any) {
      setLoadError(err?.message || "Failed to load reports");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(loadAll, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleFilter, searchQuery]);

  const handleGenerate = async () => {
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to generate reports." });
      return;
    }
    setIsGenerating(true);
    try {
      const payload: GenerateReportPayload = {
        name: genForm.name.trim() || undefined,
        module: genForm.module,
        report_type: genForm.report_type,
        format: genForm.format,
        date_range: genForm.date_range,
        sections: genSections,
      };
      const created = await generateReport(payload);
      setReports((prev) => [created, ...prev]);
      setIsNewReportOpen(false);
      setGenForm({ ...EMPTY_GEN });
      setGenSections(SECTION_OPTIONS.map((s) => s.id));
      toast({ title: "Report generated", description: `${created.name} is ready.` });
    } catch (err: any) {
      toast({ title: "Generation failed", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleView = async (report: Report) => {
    setDetailLoading(true);
    setSelectedReport(report);
    try {
      const full = await getReport(report.id);
      setSelectedReport(full);
    } catch (err: any) {
      toast({ title: "Could not load report", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    try {
      await triggerReportDownload(id);
      toast({ title: "Download started" });
    } catch (err: any) {
      toast({ title: "Download failed", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteReport(deleteConfirm.id);
      setReports((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
      if (selectedReport?.id === deleteConfirm.id) setSelectedReport(null);
      toast({ title: "Report deleted", description: `${deleteConfirm.name} has been removed.` });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setDeleteConfirm(null);
    }
  };

  const openTemplate = (module: ReportModule, type: ReportType, name: string) => {
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to generate reports." });
      return;
    }
    setGenForm({ ...EMPTY_GEN, module, report_type: type, name });
    setGenSections(SECTION_OPTIONS.map((s) => s.id));
    setIsNewReportOpen(true);
  };

  const openNewSchedule = () => {
    setEditingSchedule(null);
    setSchedForm({ name: "", module: "all", report_type: "executive", format: "pdf", frequency: "weekly", recipients: "" });
    setIsScheduleOpen(true);
  };

  const openEditSchedule = (s: ScheduledReport) => {
    setEditingSchedule(s);
    setSchedForm({
      name: s.name,
      module: s.module as ReportModule,
      report_type: s.type as ReportType,
      format: s.format as ReportFormat,
      frequency: s.frequency as ScheduleFrequency,
      recipients: (s.recipients || []).join(", "),
    });
    setIsScheduleOpen(true);
  };

  const handleSaveSchedule = async () => {
    if (!schedForm.name.trim()) {
      toast({ title: "Name required", description: "Enter a name for the scheduled report." });
      return;
    }
    setSavingSchedule(true);
    const recipients = schedForm.recipients.split(",").map((r) => r.trim()).filter(Boolean);
    try {
      if (editingSchedule) {
        const updated = await updateScheduledReport(editingSchedule.id, {
          name: schedForm.name.trim(),
          module: schedForm.module,
          report_type: schedForm.report_type,
          format: schedForm.format,
          frequency: schedForm.frequency,
          recipients,
        });
        setScheduled((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        toast({ title: "Schedule updated" });
      } else {
        const created = await createScheduledReport({
          name: schedForm.name.trim(),
          module: schedForm.module,
          report_type: schedForm.report_type,
          format: schedForm.format,
          frequency: schedForm.frequency,
          recipients,
        });
        setScheduled((prev) => [created, ...prev]);
        toast({ title: "Schedule created" });
      }
      setIsScheduleOpen(false);
    } catch (err: any) {
      toast({ title: "Save failed", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleToggleSchedule = async (s: ScheduledReport) => {
    try {
      const updated = await updateScheduledReport(s.id, { enabled: !s.enabled });
      setScheduled((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      toast({ title: updated.enabled ? "Schedule enabled" : "Schedule disabled" });
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message || "Please try again.", variant: "destructive" });
    }
  };

  const handleDeleteSchedule = async (s: ScheduledReport) => {
    try {
      await deleteScheduledReport(s.id);
      setScheduled((prev) => prev.filter((x) => x.id !== s.id));
      toast({ title: "Schedule removed" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err?.message || "Please try again.", variant: "destructive" });
    }
  };

  const formatDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-muted-foreground mt-1">Generate and manage security reports across all modules</p>
        </div>
        {canWrite && (
          <Button variant="gradient" onClick={() => { setGenForm({ ...EMPTY_GEN }); setGenSections(SECTION_OPTIONS.map((s) => s.id)); setIsNewReportOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />
            Generate Report
          </Button>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Total Reports", value: reports.length, icon: FileText, color: "primary" },
          { label: "ASM Reports", value: reports.filter((r) => r.module === "asm").length, icon: Radar, color: "primary" },
          { label: "VS Reports", value: reports.filter((r) => r.module === "vs").length, icon: Bug, color: "secondary" },
          { label: "Scheduled", value: scheduled.filter((r) => r.enabled).length, icon: Calendar, color: "accent" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="card-elevated p-5"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-${stat.color}/10`}>
                <stat.icon className={`w-5 h-5 text-${stat.color}`} />
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search reports..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={moduleFilter} onValueChange={setModuleFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by module" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Modules</SelectItem>
            <SelectItem value="asm">ASM Only</SelectItem>
            <SelectItem value="vs">VS Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports">Generated Reports</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled Reports</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>

        {/* Generated Reports */}
        <TabsContent value="reports" className="mt-4">
          <div className="card-elevated overflow-hidden">
            {loadError && (
              <div className="p-4 text-sm text-destructive border-b border-border">{loadError}</div>
            )}
            {isLoading ? (
              <div className="divide-y divide-border">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="p-4 flex items-center gap-3">
                    <div className="w-4 h-4 rounded bg-muted animate-pulse" />
                    <div className="h-4 w-48 bg-muted rounded animate-pulse" />
                    <div className="h-4 w-16 bg-muted rounded animate-pulse ml-auto" />
                  </div>
                ))}
              </div>
            ) : reports.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                  <FileText className="w-6 h-6 text-muted-foreground" />
                </div>
                <h3 className="font-semibold text-foreground">No reports yet</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Generate a report to capture a snapshot of your organization's attack surface and exposure.
                </p>
                {canWrite && (
                  <Button variant="gradient" className="mt-4" onClick={() => setIsNewReportOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Generate Report
                  </Button>
                )}
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-muted/30">
                  <tr className="text-left text-sm text-muted-foreground">
                    <th className="p-4 font-medium">Report Name</th>
                    <th className="p-4 font-medium">Module</th>
                    <th className="p-4 font-medium">Type</th>
                    <th className="p-4 font-medium">Date</th>
                    <th className="p-4 font-medium">Format</th>
                    <th className="p-4 font-medium">Size</th>
                    <th className="p-4 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report, index) => (
                    <motion.tr
                      key={report.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: index * 0.03 }}
                      className="border-t border-border hover:bg-muted/20 transition-colors"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {getTypeIcon(report.type)}
                          <span className="font-medium text-foreground">{report.name}</span>
                        </div>
                      </td>
                      <td className="p-4">{getModuleBadge(report.module)}</td>
                      <td className="p-4">
                        <span className="text-xs px-2 py-1 bg-muted rounded-full capitalize">{report.type}</span>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">{formatDate(report.date)}</td>
                      <td className="p-4 text-sm text-muted-foreground uppercase">{report.format}</td>
                      <td className="p-4 text-sm text-muted-foreground">{report.size}</td>
                      <td className="p-4">
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleView(report)}>
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={downloadingId === report.id}
                            onClick={() => handleDownload(report.id)}
                          >
                            {downloadingId === report.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                          </Button>
                          {canWrite && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => setDeleteConfirm({ id: report.id, name: report.name })}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* Scheduled Reports */}
        <TabsContent value="scheduled" className="mt-4 space-y-4">
          {isLoading ? (
            <div className="card-elevated p-4 h-20 animate-pulse" />
          ) : scheduled.length === 0 ? (
            <div className="card-elevated flex flex-col items-center justify-center text-center py-12 px-6">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-4">
                <Calendar className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-foreground">No scheduled reports</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Schedule recurring reports to be generated automatically.
              </p>
            </div>
          ) : (
            scheduled.map((schedule, index) => (
              <motion.div
                key={schedule.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="card-elevated p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className={`w-3 h-3 mt-1.5 rounded-full ${schedule.enabled ? "bg-success" : "bg-muted"}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-foreground">{schedule.name}</div>
                        {getModuleBadge(schedule.module)}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        <span className="flex items-center gap-1 capitalize">
                          <Clock className="w-4 h-4" />
                          {schedule.frequency} • Next: {formatDate(schedule.nextRun)}
                        </span>
                      </div>
                      {schedule.recipients.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {schedule.recipients.map((email) => (
                            <span key={email} className="text-xs px-2 py-0.5 bg-muted rounded-full">{email}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditSchedule(schedule)}>
                        <Edit className="w-3 h-3 mr-1" />
                        Edit
                      </Button>
                      <Button variant={schedule.enabled ? "outline" : "default"} size="sm" onClick={() => handleToggleSchedule(schedule)}>
                        {schedule.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteSchedule(schedule)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))
          )}

          {canWrite && (
            <Button variant="outline" className="w-full" onClick={openNewSchedule}>
              <Plus className="w-4 h-4 mr-2" />
              Add Scheduled Report
            </Button>
          )}
        </TabsContent>

        {/* Templates */}
        <TabsContent value="templates" className="mt-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TEMPLATES.map((template, index) => (
              <motion.div
                key={template.name}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                className="card-elevated p-5 hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <template.icon className="w-5 h-5 text-primary" />
                    </div>
                    <div className="font-medium text-foreground">{template.name}</div>
                  </div>
                  {getModuleBadge(template.module)}
                </div>
                <p className="text-sm text-muted-foreground mb-4">{template.description}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={!canWrite}
                  onClick={() => openTemplate(template.module, template.type, template.name)}
                >
                  Use Template
                </Button>
              </motion.div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Generate Dialog */}
      <Dialog open={isNewReportOpen} onOpenChange={setIsNewReportOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate New Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Report Name (optional)</Label>
              <Input
                placeholder="Auto-generated if left blank"
                value={genForm.name}
                onChange={(e) => setGenForm({ ...genForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Module</Label>
              <Select value={genForm.module} onValueChange={(v: ReportModule) => setGenForm({ ...genForm, module: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Modules</SelectItem>
                  <SelectItem value="asm">ASM - Attack Surface</SelectItem>
                  <SelectItem value="vs">VS - Vulnerability Scans</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select value={genForm.report_type} onValueChange={(v: ReportType) => setGenForm({ ...genForm, report_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="executive">Executive Summary</SelectItem>
                  <SelectItem value="technical">Technical Report</SelectItem>
                  <SelectItem value="compliance">Compliance Mapping</SelectItem>
                  <SelectItem value="assets">Asset Inventory</SelectItem>
                  <SelectItem value="vulnerability">Vulnerability Report</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date Range</Label>
              <Select value={genForm.date_range} onValueChange={(v) => setGenForm({ ...genForm, date_range: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Format</Label>
              <Select value={genForm.format} onValueChange={(v: ReportFormat) => setGenForm({ ...genForm, format: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">PDF (HTML)</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <Label>Include Sections</Label>
              <div className="space-y-2">
                {SECTION_OPTIONS.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`sec-${s.id}`}
                      checked={genSections.includes(s.id)}
                      onCheckedChange={(checked) =>
                        setGenSections((prev) =>
                          checked ? [...prev, s.id] : prev.filter((x) => x !== s.id)
                        )
                      }
                    />
                    <label htmlFor={`sec-${s.id}`} className="text-sm">{s.label}</label>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setIsNewReportOpen(false)} disabled={isGenerating}>Cancel</Button>
              <Button variant="gradient" onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating…</> : "Generate"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Schedule Dialog */}
      <Dialog open={isScheduleOpen} onOpenChange={setIsScheduleOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingSchedule ? "Edit Scheduled Report" : "Add Scheduled Report"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={schedForm.name} onChange={(e) => setSchedForm({ ...schedForm, name: e.target.value })} placeholder="Weekly exposure summary" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Module</Label>
                <Select value={schedForm.module} onValueChange={(v: ReportModule) => setSchedForm({ ...schedForm, module: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Modules</SelectItem>
                    <SelectItem value="asm">ASM</SelectItem>
                    <SelectItem value="vs">VS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Select value={schedForm.frequency} onValueChange={(v: ScheduleFrequency) => setSchedForm({ ...schedForm, frequency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={schedForm.report_type} onValueChange={(v: ReportType) => setSchedForm({ ...schedForm, report_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="executive">Executive</SelectItem>
                    <SelectItem value="technical">Technical</SelectItem>
                    <SelectItem value="compliance">Compliance</SelectItem>
                    <SelectItem value="assets">Asset Inventory</SelectItem>
                    <SelectItem value="vulnerability">Vulnerability</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Format</Label>
                <Select value={schedForm.format} onValueChange={(v: ReportFormat) => setSchedForm({ ...schedForm, format: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF (HTML)</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Recipients (comma-separated emails)</Label>
              <Input value={schedForm.recipients} onChange={(e) => setSchedForm({ ...schedForm, recipients: e.target.value })} placeholder="security@company.com, ciso@company.com" />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setIsScheduleOpen(false)} disabled={savingSchedule}>Cancel</Button>
              <Button variant="gradient" onClick={handleSaveSchedule} disabled={savingSchedule}>
                {savingSchedule ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : (editingSchedule ? "Save Changes" : "Create Schedule")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConfirm?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Report Viewer Sheet — renders REAL content only */}
      <Sheet open={!!selectedReport} onOpenChange={() => setSelectedReport(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-hidden flex flex-col">
          {selectedReport && (
            <>
              <SheetHeader className="pb-4 border-b border-border">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {getTypeIcon(selectedReport.type)}
                    <div>
                      <SheetTitle className="text-lg">{selectedReport.name}</SheetTitle>
                      <div className="flex items-center gap-2 mt-1">
                        {getModuleBadge(selectedReport.module)}
                        <span className="text-xs text-muted-foreground">{formatDate(selectedReport.date)}</span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground uppercase">{selectedReport.format}</span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">{selectedReport.size}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button variant="gradient" size="sm" onClick={() => handleDownload(selectedReport.id)}>
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => window.print()}>
                    <Printer className="w-4 h-4 mr-2" />
                    Print
                  </Button>
                </div>
              </SheetHeader>

              <ScrollArea className="flex-1 mt-4">
                <div className="space-y-6 pr-4">
                  {detailLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" /> Loading report…
                    </div>
                  )}

                  {/* Summary */}
                  {selectedReport.content?.summary && (
                    <div className="p-5 bg-muted/30 rounded-xl border border-border/50">
                      <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                        <PieChart className="w-5 h-5 text-primary" />
                        Summary
                      </h3>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="p-3 bg-background rounded-lg text-center">
                          <div className="text-2xl font-bold text-foreground">{selectedReport.content.summary.total_assets}</div>
                          <div className="text-xs text-muted-foreground">Total Assets</div>
                        </div>
                        <div className="p-3 bg-background rounded-lg text-center">
                          <div className="text-2xl font-bold text-warning">{selectedReport.content.summary.public_assets}</div>
                          <div className="text-xs text-muted-foreground">Public Assets</div>
                        </div>
                        <div className="p-3 bg-background rounded-lg text-center">
                          <div className="text-2xl font-bold text-foreground">{selectedReport.content.summary.internal_assets}</div>
                          <div className="text-xs text-muted-foreground">Internal Assets</div>
                        </div>
                      </div>
                      {/* Exposure breakdown */}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {Object.entries(selectedReport.content.summary.exposure_breakdown || {}).map(([sev, n]) => (
                          <Badge key={sev} variant="outline" className={`text-xs capitalize ${severityClass(sev)}`}>
                            {sev}: {n}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Top exposed assets */}
                  {selectedReport.content?.top_exposed_assets && selectedReport.content.top_exposed_assets.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-foreground flex items-center gap-2">
                        <Radar className="w-5 h-5 text-primary" />
                        Top Exposed Assets
                      </h3>
                      <div className="space-y-2">
                        {selectedReport.content.top_exposed_assets.map((a, i) => (
                          <div key={i} className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg">
                            <span className="flex-1 text-sm font-medium">{a.name}</span>
                            <span className="text-xs text-muted-foreground capitalize">{a.type}</span>
                            <span className="text-xs text-muted-foreground capitalize">{a.exposure}</span>
                            <span className="text-sm font-medium text-muted-foreground tabular-nums">{a.risk_score ?? "—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Key findings */}
                  {selectedReport.content?.key_findings && (
                    <>
                      <Separator />
                      <div className="space-y-3">
                        <h3 className="font-semibold text-foreground flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5 text-warning" />
                          Key Findings
                        </h3>
                        {selectedReport.content.key_findings.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No notable findings for this report.</p>
                        ) : (
                          selectedReport.content.key_findings.map((finding, i) => (
                            <div key={i} className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg">
                              <Badge variant="outline" className={severityClass(finding.severity)}>{finding.severity}</Badge>
                              <span className="flex-1 text-sm">{finding.title}</span>
                              <span className="text-sm font-medium text-muted-foreground">{finding.count}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  )}

                  {/* Vulnerabilities (honest) */}
                  {selectedReport.content?.vulnerabilities && (
                    <>
                      <Separator />
                      <div className="space-y-3">
                        <h3 className="font-semibold text-foreground flex items-center gap-2">
                          <Bug className="w-5 h-5 text-destructive" />
                          Vulnerabilities
                        </h3>
                        <div className="p-3 bg-muted/20 rounded-lg text-sm">
                          <span className="font-medium text-foreground">{selectedReport.content.vulnerabilities.total}</span>{" "}
                          <span className="text-muted-foreground">total</span>
                          {selectedReport.content.vulnerabilities.note && (
                            <p className="text-xs text-muted-foreground mt-1">{selectedReport.content.vulnerabilities.note}</p>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Recommendations */}
                  {selectedReport.content?.recommendations && selectedReport.content.recommendations.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-3">
                        <h3 className="font-semibold text-foreground flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-success" />
                          Recommendations
                        </h3>
                        {selectedReport.content.recommendations.map((rec, i) => (
                          <div key={i} className="flex items-start gap-3 p-3 bg-muted/20 rounded-lg">
                            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                            <span className="text-sm">{rec}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {!detailLoading && !selectedReport.content && (
                    <p className="text-sm text-muted-foreground">No content available for this report.</p>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
