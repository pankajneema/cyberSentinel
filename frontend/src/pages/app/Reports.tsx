import { useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  FileText,
  Download,
  Mail,
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
  Share2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";

const allReports = [
  { id: 1, name: "Executive Summary - January", type: "executive", module: "all", date: "2024-01-20", format: "PDF", size: "2.4 MB", status: "ready" },
  { id: 2, name: "ASM Technical Vulnerability Report", type: "technical", module: "asm", date: "2024-01-19", format: "PDF", size: "8.7 MB", status: "ready" },
  { id: 3, name: "VS Scan Results - Weekly", type: "technical", module: "vs", date: "2024-01-19", format: "PDF", size: "5.2 MB", status: "ready" },
  { id: 4, name: "SOC2 Compliance Mapping", type: "compliance", module: "all", date: "2024-01-18", format: "PDF", size: "3.1 MB", status: "ready" },
  { id: 5, name: "ASM Asset Inventory Export", type: "assets", module: "asm", date: "2024-01-17", format: "CSV", size: "1.8 MB", status: "ready" },
  { id: 6, name: "VS Critical Findings", type: "vulnerability", module: "vs", date: "2024-01-16", format: "PDF", size: "4.5 MB", status: "ready" },
  { id: 7, name: "ISO 27001 Gap Analysis", type: "compliance", module: "all", date: "2024-01-15", format: "PDF", size: "4.5 MB", status: "ready" },
  { id: 8, name: "ASM Weekly Asset Summary", type: "executive", module: "asm", date: "2024-01-14", format: "CSV", size: "1.2 MB", status: "ready" },
];

const scheduledReports = [
  { id: 1, name: "Weekly Executive Summary", module: "all", frequency: "Weekly", nextRun: "Monday 09:00", recipients: ["cto@company.com", "ciso@company.com"], enabled: true },
  { id: 2, name: "Monthly ASM Report", module: "asm", frequency: "Monthly", nextRun: "Feb 1 08:00", recipients: ["security@company.com"], enabled: true },
  { id: 3, name: "Daily VS Scan Summary", module: "vs", frequency: "Daily", nextRun: "Tomorrow 06:00", recipients: ["security-team@company.com"], enabled: false },
  { id: 4, name: "Monthly Compliance Report", module: "all", frequency: "Monthly", nextRun: "Feb 1 08:00", recipients: ["compliance@company.com"], enabled: true },
];

interface Report {
  id: number;
  name: string;
  type: string;
  module: string;
  date: string;
  format: string;
  size: string;
  status: string;
}

export default function Reports() {
  const [isNewReportOpen, setIsNewReportOpen] = useState(false);
  const [moduleFilter, setModuleFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "executive": return <PieChart className="w-4 h-4 text-primary" />;
      case "technical": return <BarChart3 className="w-4 h-4 text-secondary" />;
      case "compliance": return <Shield className="w-4 h-4 text-accent" />;
      case "vulnerability": return <Bug className="w-4 h-4 text-destructive" />;
      case "assets": return <Radar className="w-4 h-4 text-primary" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  const getModuleBadge = (module: string) => {
    switch (module) {
      case "asm": return <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">ASM</Badge>;
      case "vs": return <Badge variant="outline" className="text-xs bg-secondary/10 text-secondary border-secondary/20">VS</Badge>;
      default: return <Badge variant="outline" className="text-xs">All</Badge>;
    }
  };

  const filteredReports = allReports.filter(report => {
    const matchesModule = moduleFilter === "all" || report.module === moduleFilter || report.module === "all";
    const matchesSearch = report.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesModule && matchesSearch;
  });

  const handleDownload = (name: string) => {
    toast({
      title: "Downloading Report",
      description: `${name} is being downloaded.`,
    });
  };

  const handleEmail = (name: string) => {
    toast({
      title: "Email Sent",
      description: `${name} has been sent to your email.`,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-muted-foreground mt-1">Generate and manage security reports across all modules</p>
        </div>
        <Dialog open={isNewReportOpen} onOpenChange={setIsNewReportOpen}>
          <DialogTrigger asChild>
            <Button variant="gradient">
              <Plus className="w-4 h-4 mr-2" />
              Generate Report
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Generate New Report</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Module</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select module" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Modules</SelectItem>
                    <SelectItem value="asm">ASM - Attack Surface</SelectItem>
                    <SelectItem value="vs">VS - Vulnerability Scans</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Report Type</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select report type" />
                  </SelectTrigger>
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
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select date range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">Last 7 days</SelectItem>
                    <SelectItem value="30d">Last 30 days</SelectItem>
                    <SelectItem value="90d">Last 90 days</SelectItem>
                    <SelectItem value="custom">Custom range</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Format</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="csv">CSV</SelectItem>
                    <SelectItem value="json">JSON</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-3">
                <Label>Include Sections</Label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox id="summary" defaultChecked />
                    <label htmlFor="summary" className="text-sm">Executive Summary</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="assets" defaultChecked />
                    <label htmlFor="assets" className="text-sm">Asset Inventory</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="vulns" defaultChecked />
                    <label htmlFor="vulns" className="text-sm">Vulnerabilities</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="recommendations" defaultChecked />
                    <label htmlFor="recommendations" className="text-sm">Recommendations</label>
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="outline" onClick={() => setIsNewReportOpen(false)}>Cancel</Button>
                <Button variant="gradient" onClick={() => {
                  setIsNewReportOpen(false);
                  toast({
                    title: "Report Generation Started",
                    description: "Your report will be ready in a few minutes.",
                  });
                }}>Generate</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Quick Stats */}
      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Total Reports", value: allReports.length, icon: FileText, color: "primary" },
          { label: "ASM Reports", value: allReports.filter(r => r.module === "asm").length, icon: Radar, color: "primary" },
          { label: "VS Reports", value: allReports.filter(r => r.module === "vs").length, icon: Bug, color: "secondary" },
          { label: "Scheduled", value: scheduledReports.filter(r => r.enabled).length, icon: Calendar, color: "accent" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
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

        <TabsContent value="reports" className="mt-4">
          <div className="card-elevated overflow-hidden">
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
                {filteredReports.map((report, index) => (
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
                    <td className="p-4 text-sm text-muted-foreground">{report.date}</td>
                    <td className="p-4 text-sm text-muted-foreground">{report.format}</td>
                    <td className="p-4 text-sm text-muted-foreground">{report.size}</td>
                    <td className="p-4">
                      <div className="flex gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={(e) => { e.stopPropagation(); setSelectedReport(report); }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={(e) => { e.stopPropagation(); handleDownload(report.name); }}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={(e) => { e.stopPropagation(); handleEmail(report.name); }}
                        >
                          <Mail className="w-4 h-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive"
                          onClick={(e) => { e.stopPropagation(); toast({ title: "Report Deleted", description: `${report.name} has been deleted.` }); }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="scheduled" className="mt-4 space-y-4">
          {scheduledReports.map((schedule, index) => (
            <motion.div
              key={schedule.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
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
                      <span className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {schedule.frequency} • Next: {schedule.nextRun}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {schedule.recipients.map((email) => (
                        <span key={email} className="text-xs px-2 py-0.5 bg-muted rounded-full">
                          {email}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm">
                    <Edit className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                  <Button variant={schedule.enabled ? "outline" : "default"} size="sm">
                    {schedule.enabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              </div>
            </motion.div>
          ))}

          <Button variant="outline" className="w-full">
            <Plus className="w-4 h-4 mr-2" />
            Add Scheduled Report
          </Button>
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { name: "Executive Summary", description: "High-level overview for leadership", icon: PieChart, module: "all" },
              { name: "ASM Technical Report", description: "Detailed attack surface analysis", icon: Radar, module: "asm" },
              { name: "VS Scan Report", description: "Vulnerability scan results", icon: Bug, module: "vs" },
              { name: "SOC2 Compliance", description: "SOC2 control mapping report", icon: Shield, module: "all" },
              { name: "ISO 27001", description: "ISO 27001 gap analysis", icon: Shield, module: "all" },
              { name: "Asset Inventory", description: "Complete asset listing", icon: FileText, module: "asm" },
            ].map((template, index) => (
              <motion.div
                key={template.name}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                className="card-elevated p-5 cursor-pointer hover:shadow-lg transition-shadow"
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
                <Button variant="outline" size="sm" className="w-full">
                  Use Template
                </Button>
              </motion.div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Report Viewer Sheet */}
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
                        <span className="text-xs text-muted-foreground">{selectedReport.date}</span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">{selectedReport.format}</span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">{selectedReport.size}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button variant="gradient" size="sm" onClick={() => handleDownload(selectedReport.name)}>
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleEmail(selectedReport.name)}>
                    <Mail className="w-4 h-4 mr-2" />
                    Email
                  </Button>
                  <Button variant="outline" size="sm">
                    <Printer className="w-4 h-4 mr-2" />
                    Print
                  </Button>
                  <Button variant="outline" size="sm">
                    <Share2 className="w-4 h-4 mr-2" />
                    Share
                  </Button>
                </div>
              </SheetHeader>

              <ScrollArea className="flex-1 mt-4">
                <div className="space-y-6 pr-4">
                  {/* Report Summary Card */}
                  <div className="p-5 bg-muted/30 rounded-xl border border-border/50">
                    <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                      <PieChart className="w-5 h-5 text-primary" />
                      Executive Summary
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                      This report provides a comprehensive analysis of your security posture covering the period from {selectedReport.date}. 
                      The analysis includes findings from attack surface discovery, vulnerability assessments, and compliance checks.
                    </p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-3 bg-background rounded-lg text-center">
                        <div className="text-2xl font-bold text-foreground">156</div>
                        <div className="text-xs text-muted-foreground">Total Assets</div>
                      </div>
                      <div className="p-3 bg-background rounded-lg text-center">
                        <div className="text-2xl font-bold text-destructive">23</div>
                        <div className="text-xs text-muted-foreground">Vulnerabilities</div>
                      </div>
                      <div className="p-3 bg-background rounded-lg text-center">
                        <div className="text-2xl font-bold text-success">87%</div>
                        <div className="text-xs text-muted-foreground">Compliance</div>
                      </div>
                    </div>
                  </div>

                  {/* Key Findings */}
                  <div className="space-y-3">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-warning" />
                      Key Findings
                    </h3>
                    {[
                      { severity: "critical", title: "Critical RCE vulnerability in Apache Log4j", count: 3 },
                      { severity: "high", title: "Exposed admin endpoints discovered", count: 5 },
                      { severity: "medium", title: "SSL/TLS configuration issues", count: 8 },
                      { severity: "low", title: "Informational headers exposure", count: 12 },
                    ].map((finding, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 bg-muted/20 rounded-lg">
                        <Badge variant="outline" className={
                          finding.severity === "critical" ? "bg-destructive/10 text-destructive border-destructive/20" :
                          finding.severity === "high" ? "bg-warning/10 text-warning border-warning/20" :
                          finding.severity === "medium" ? "bg-accent/10 text-accent border-accent/20" :
                          "bg-success/10 text-success border-success/20"
                        }>
                          {finding.severity}
                        </Badge>
                        <span className="flex-1 text-sm">{finding.title}</span>
                        <span className="text-sm font-medium text-muted-foreground">{finding.count}</span>
                      </div>
                    ))}
                  </div>

                  <Separator />

                  {/* Compliance Status */}
                  <div className="space-y-3">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" />
                      Compliance Status
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { framework: "SOC2", score: 92, status: "passing" },
                        { framework: "GDPR", score: 88, status: "passing" },
                        { framework: "ISO 27001", score: 75, status: "warning" },
                        { framework: "HIPAA", score: 95, status: "passing" },
                      ].map((item, i) => (
                        <div key={i} className="p-3 bg-muted/20 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">{item.framework}</span>
                            <span className={`text-sm font-bold ${item.status === "passing" ? "text-success" : "text-warning"}`}>
                              {item.score}%
                            </span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full ${item.status === "passing" ? "bg-success" : "bg-warning"}`}
                              style={{ width: `${item.score}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Recommendations */}
                  <div className="space-y-3">
                    <h3 className="font-semibold text-foreground flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-success" />
                      Recommendations
                    </h3>
                    {[
                      "Immediately patch all critical vulnerabilities identified in the scan",
                      "Update SSL/TLS configuration to disable weak cipher suites",
                      "Implement proper access controls for admin endpoints",
                      "Review and update firewall rules based on findings",
                    ].map((rec, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-muted/20 rounded-lg">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>
                        <span className="text-sm">{rec}</span>
                      </div>
                    ))}
                  </div>

                  {/* Report Metadata */}
                  <div className="p-4 bg-muted/20 rounded-xl text-sm text-muted-foreground">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="font-medium text-foreground">Generated:</span> {selectedReport.date} 14:30 UTC
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Format:</span> {selectedReport.format}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Size:</span> {selectedReport.size}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Status:</span> {selectedReport.status}
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
