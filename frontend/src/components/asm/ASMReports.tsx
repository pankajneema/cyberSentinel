import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SeverityBadge } from "./SeverityBadge";
import {
  FileText,
  Download,
  Mail,
  Calendar,
  Plus,
  Eye,
  MoreHorizontal,
  Clock,
  CheckCircle2,
  Shield,
  BarChart3,
  PieChart,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";

const reports = [
  { id: 1, name: "Executive Summary - January", type: "executive", date: "2024-01-20", format: "PDF", size: "2.4 MB", status: "ready" },
  { id: 2, name: "Technical Vulnerability Report", type: "technical", date: "2024-01-19", format: "PDF", size: "8.7 MB", status: "ready" },
  { id: 3, name: "SOC2 Compliance Mapping", type: "compliance", date: "2024-01-18", format: "PDF", size: "3.1 MB", status: "ready" },
  { id: 4, name: "ISO 27001 Gap Analysis", type: "compliance", date: "2024-01-15", format: "PDF", size: "4.5 MB", status: "ready" },
  { id: 5, name: "Weekly Asset Summary", type: "executive", date: "2024-01-14", format: "CSV", size: "1.2 MB", status: "ready" },
];

const scheduledReports = [
  { id: 1, name: "Weekly Executive Summary", frequency: "Weekly", nextRun: "Monday 09:00", recipients: ["cto@company.com", "ciso@company.com"], enabled: true },
  { id: 2, name: "Monthly Compliance Report", frequency: "Monthly", nextRun: "Feb 1 08:00", recipients: ["compliance@company.com"], enabled: true },
  { id: 3, name: "Daily Findings Alert", frequency: "Daily", nextRun: "Tomorrow 06:00", recipients: ["security-team@company.com"], enabled: false },
];

export function ASMReports() {
  const [isNewReportOpen, setIsNewReportOpen] = useState(false);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "executive": return <PieChart className="w-4 h-4 text-primary" />;
      case "technical": return <BarChart3 className="w-4 h-4 text-secondary" />;
      case "compliance": return <Shield className="w-4 h-4 text-accent" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Reports</h2>
          <p className="text-sm text-muted-foreground">Generate and schedule security reports</p>
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
                <Button variant="gradient" onClick={() => setIsNewReportOpen(false)}>Generate</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Quick Stats */}
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          { label: "Total Reports", value: reports.length, icon: FileText },
          { label: "Scheduled", value: scheduledReports.filter(r => r.enabled).length, icon: Calendar },
          { label: "This Month", value: 12, icon: BarChart3 },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="card-elevated p-5"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <stat.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                <div className="text-sm text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          </motion.div>
        ))}
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
                    transition={{ delay: index * 0.05 }}
                    className="border-t border-border hover:bg-muted/20 transition-colors"
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        {getTypeIcon(report.type)}
                        <span className="font-medium text-foreground">{report.name}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-xs px-2 py-1 bg-muted rounded-full capitalize">{report.type}</span>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">{report.date}</td>
                    <td className="p-4 text-sm text-muted-foreground">{report.format}</td>
                    <td className="p-4 text-sm text-muted-foreground">{report.size}</td>
                    <td className="p-4">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Mail className="w-4 h-4" />
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
                    <div className="font-medium text-foreground">{schedule.name}</div>
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
                  <Button variant="outline" size="sm">Edit</Button>
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
              { name: "Executive Summary", description: "High-level overview for leadership", icon: PieChart },
              { name: "Technical Deep Dive", description: "Detailed vulnerability analysis", icon: BarChart3 },
              { name: "SOC2 Compliance", description: "SOC2 control mapping report", icon: Shield },
              { name: "ISO 27001", description: "ISO 27001 gap analysis", icon: Shield },
              { name: "Asset Inventory", description: "Complete asset listing", icon: FileText },
              { name: "Incident Report", description: "Security incident documentation", icon: FileText },
            ].map((template, index) => (
              <motion.div
                key={template.name}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                className="card-elevated p-5 cursor-pointer hover:shadow-lg"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <template.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="font-medium text-foreground">{template.name}</div>
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
    </div>
  );
}
