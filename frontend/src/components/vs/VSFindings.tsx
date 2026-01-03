import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SeverityBadge } from "@/components/asm/SeverityBadge";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
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
  Link2,
  ChevronRight,
  Shield,
  Zap,
  RefreshCw,
  FileText,
  Bug,
  Filter,
  Send,
  Slack,
  Mail,
  Calendar,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";

type Severity = "critical" | "high" | "medium" | "low";

interface Vulnerability {
  id: number;
  cve: string;
  title: string;
  asset: string;
  severity: Severity;
  cvss: number;
  exploitability: "known" | "poc" | "none";
  patchAvailable: boolean;
  firstSeen: string;
  lastSeen: string;
  status: "open" | "in_progress" | "fixed" | "accepted_risk";
  owner: string | null;
}

const vulnerabilities: Vulnerability[] = [
  { id: 1, cve: "CVE-2024-1234", title: "Remote Code Execution in Apache Log4j", asset: "api.company.com", severity: "critical", cvss: 9.8, exploitability: "known", patchAvailable: true, firstSeen: "2024-01-15", lastSeen: "2024-01-20", status: "open", owner: null },
  { id: 2, cve: "CVE-2024-5678", title: "SQL Injection in Login Endpoint", asset: "app.company.com", severity: "critical", cvss: 9.1, exploitability: "poc", patchAvailable: true, firstSeen: "2024-01-10", lastSeen: "2024-01-20", status: "in_progress", owner: "John D." },
  { id: 3, cve: "CVE-2024-9012", title: "Cross-Site Scripting (XSS) in Search", asset: "staging.app.com", severity: "high", cvss: 7.5, exploitability: "none", patchAvailable: true, firstSeen: "2024-01-12", lastSeen: "2024-01-19", status: "open", owner: null },
  { id: 4, cve: "CVE-2024-3456", title: "Outdated SSL/TLS Configuration", asset: "mail.company.com", severity: "medium", cvss: 5.3, exploitability: "none", patchAvailable: true, firstSeen: "2024-01-08", lastSeen: "2024-01-20", status: "fixed", owner: "DevOps Team" },
  { id: 5, cve: "CVE-2024-7890", title: "Information Disclosure via HTTP Headers", asset: "cdn.company.com", severity: "low", cvss: 3.1, exploitability: "none", patchAvailable: false, firstSeen: "2024-01-05", lastSeen: "2024-01-15", status: "accepted_risk", owner: "Security Team" },
  { id: 6, cve: "CVE-2024-2345", title: "Privilege Escalation in Admin Panel", asset: "admin.company.com", severity: "high", cvss: 8.8, exploitability: "poc", patchAvailable: true, firstSeen: "2024-01-14", lastSeen: "2024-01-20", status: "open", owner: null },
  { id: 7, cve: "CVE-2024-6789", title: "Denial of Service in API Gateway", asset: "api.company.com", severity: "high", cvss: 7.2, exploitability: "known", patchAvailable: true, firstSeen: "2024-01-11", lastSeen: "2024-01-18", status: "in_progress", owner: "Sarah M." },
  { id: 8, cve: "CVE-2024-0123", title: "Weak Password Policy", asset: "auth.company.com", severity: "medium", cvss: 6.5, exploitability: "none", patchAvailable: false, firstSeen: "2024-01-03", lastSeen: "2024-01-18", status: "open", owner: null },
];

const teamMembers = [
  { id: "1", name: "John Smith", email: "john@company.com" },
  { id: "2", name: "Sarah Johnson", email: "sarah@company.com" },
  { id: "3", name: "Mike Chen", email: "mike@company.com" },
  { id: "4", name: "Emily Davis", email: "emily@company.com" },
];

export function VSFindings() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedVuln, setSelectedVuln] = useState<Vulnerability | null>(null);
  const [selectedItems, setSelectedItems] = useState<number[]>([]);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [assignVuln, setAssignVuln] = useState<Vulnerability | null>(null);
  const [assignForm, setAssignForm] = useState({
    assignee: "",
    priority: "high",
    dueDate: "",
    description: "",
    notifyVia: [] as string[],
  });

  const filteredVulns = vulnerabilities.filter((vuln) => {
    const matchesSearch = vuln.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         vuln.cve.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         vuln.asset.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || vuln.status === statusFilter;
    const matchesSeverity = severityFilter === "all" || vuln.severity === severityFilter;
    return matchesSearch && matchesStatus && matchesSeverity;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "open": return <AlertTriangle className="w-4 h-4 text-destructive" />;
      case "in_progress": return <Clock className="w-4 h-4 text-warning" />;
      case "fixed": return <CheckCircle2 className="w-4 h-4 text-success" />;
      case "accepted_risk": return <Shield className="w-4 h-4 text-muted-foreground" />;
      default: return null;
    }
  };

  const getExploitBadge = (exp: string) => {
    switch (exp) {
      case "known": return <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">In-the-Wild</span>;
      case "poc": return <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning">PoC Available</span>;
      default: return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">None Known</span>;
    }
  };

  const stats = {
    critical: vulnerabilities.filter(v => v.severity === "critical").length,
    high: vulnerabilities.filter(v => v.severity === "high").length,
    medium: vulnerabilities.filter(v => v.severity === "medium").length,
    low: vulnerabilities.filter(v => v.severity === "low").length,
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === filteredVulns.length) {
      setSelectedItems([]);
    } else {
      setSelectedItems(filteredVulns.map(v => v.id));
    }
  };

  const handleBulkAction = (action: string) => {
    toast({ title: `${action}`, description: `Applied to ${selectedItems.length} vulnerabilities` });
    setSelectedItems([]);
  };

  const handleAssignTask = () => {
    if (!assignVuln || !assignForm.assignee) {
      toast({ title: "Error", description: "Please select an assignee", variant: "destructive" });
      return;
    }
    
    toast({ 
      title: "Task Created & Assigned", 
      description: `Task for "${assignVuln.cve}" assigned to ${teamMembers.find(m => m.id === assignForm.assignee)?.name}` 
    });
    
    setIsAssignDialogOpen(false);
    setAssignVuln(null);
    setAssignForm({ assignee: "", priority: "high", dueDate: "", description: "", notifyVia: [] });
    
    // Navigate to team page
    navigate("/app/team");
  };

  const openAssignDialog = (vuln: Vulnerability) => {
    setAssignVuln(vuln);
    setAssignForm({
      ...assignForm,
      priority: vuln.severity === "critical" ? "critical" : vuln.severity === "high" ? "high" : "medium",
      description: `Fix vulnerability: ${vuln.title}\n\nAsset: ${vuln.asset}\nCVE: ${vuln.cve}\nCVSS: ${vuln.cvss}`,
    });
    setIsAssignDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Vulnerability Findings</h2>
          <p className="text-sm text-muted-foreground">{vulnerabilities.length} findings detected across your assets</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Severity Stats */}
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
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by CVE, title, or asset..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="fixed">Fixed</SelectItem>
            <SelectItem value="accepted_risk">Accepted Risk</SelectItem>
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
          </SelectContent>
        </Select>
      </div>

      {/* Bulk Actions */}
      {selectedItems.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 p-3 bg-primary/5 rounded-xl border border-primary/20"
        >
          <span className="text-sm font-medium">{selectedItems.length} selected</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => handleBulkAction("Assigned owner")}>
              <UserPlus className="w-4 h-4 mr-1" />Assign
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBulkAction("Created tickets")}>
              <Link2 className="w-4 h-4 mr-1" />Create Ticket
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBulkAction("Status updated")}>
              <CheckCircle2 className="w-4 h-4 mr-1" />Change Status
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleBulkAction("Exported")}>
              <Download className="w-4 h-4 mr-1" />Export
            </Button>
          </div>
        </motion.div>
      )}

      {/* Findings Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/30">
              <tr className="text-left text-sm text-muted-foreground">
                <th className="p-4 font-medium w-10">
                  <Checkbox 
                    checked={selectedItems.length === filteredVulns.length && filteredVulns.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <th className="p-4 font-medium">Severity</th>
                <th className="p-4 font-medium">CVE</th>
                <th className="p-4 font-medium">Vulnerability</th>
                <th className="p-4 font-medium">Asset</th>
                <th className="p-4 font-medium">CVSS</th>
                <th className="p-4 font-medium">Exploit</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredVulns.map((vuln) => (
                <motion.tr
                  key={vuln.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={cn(
                    "border-t border-border hover:bg-muted/20 cursor-pointer transition-colors",
                    selectedItems.includes(vuln.id) && "bg-primary/5"
                  )}
                  onClick={() => setSelectedVuln(vuln)}
                >
                  <td className="p-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox 
                      checked={selectedItems.includes(vuln.id)}
                      onCheckedChange={() => {
                        setSelectedItems(prev => 
                          prev.includes(vuln.id) ? prev.filter(id => id !== vuln.id) : [...prev, vuln.id]
                        );
                      }}
                    />
                  </td>
                  <td className="p-4">
                    <SeverityBadge severity={vuln.severity} />
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1">
                      <code className="text-sm font-mono text-primary">{vuln.cve}</code>
                      <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="font-medium text-foreground max-w-xs truncate">{vuln.title}</div>
                    <div className="text-xs text-muted-foreground">First seen: {vuln.firstSeen}</div>
                  </td>
                  <td className="p-4 font-mono text-sm text-muted-foreground">{vuln.asset}</td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "font-bold",
                        vuln.cvss >= 9 ? "text-destructive" :
                        vuln.cvss >= 7 ? "text-warning" :
                        vuln.cvss >= 4 ? "text-accent" : "text-success"
                      )}>
                        {vuln.cvss}
                      </span>
                      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full",
                            vuln.cvss >= 9 ? "bg-destructive" :
                            vuln.cvss >= 7 ? "bg-warning" :
                            vuln.cvss >= 4 ? "bg-accent" : "bg-success"
                          )}
                          style={{ width: `${vuln.cvss * 10}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="p-4">{getExploitBadge(vuln.exploitability)}</td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(vuln.status)}
                      <span className="text-sm capitalize">{vuln.status.replace("_", " ")}</span>
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
                        <DropdownMenuItem onClick={() => openAssignDialog(vuln)}><UserPlus className="w-4 h-4 mr-2" />Assign Task to Team</DropdownMenuItem>
                        <DropdownMenuItem><CheckCircle2 className="w-4 h-4 mr-2" />Mark as Fixed</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem><Link2 className="w-4 h-4 mr-2" />Create Jira Ticket</DropdownMenuItem>
                        <DropdownMenuItem><RefreshCw className="w-4 h-4 mr-2" />Re-scan Asset</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vulnerability Detail Sheet */}
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
                      <code className="text-sm font-mono text-primary">{selectedVuln.cve}</code>
                      <ExternalLink className="w-3 h-3 text-muted-foreground cursor-pointer" />
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <Tabs defaultValue="details" className="mt-6">
                <TabsList>
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="remediation">Remediation</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="space-y-6 mt-4">
                  {/* Quick Actions */}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="gradient" size="sm"><CheckCircle2 className="w-4 h-4 mr-1" />Mark Fixed</Button>
                    <Button variant="outline" size="sm" onClick={() => { setSelectedVuln(null); openAssignDialog(selectedVuln); }}>
                      <UserPlus className="w-4 h-4 mr-1" />Assign Task
                    </Button>
                    <Button variant="outline" size="sm"><Link2 className="w-4 h-4 mr-1" />Create Ticket</Button>
                    <Button variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />Re-scan</Button>
                  </div>

                  {/* CVSS Meter */}
                  <div className="p-4 bg-muted/30 rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">CVSS Score</span>
                      <span className={cn(
                        "text-2xl font-bold",
                        selectedVuln.cvss >= 9 ? "text-destructive" :
                        selectedVuln.cvss >= 7 ? "text-warning" :
                        selectedVuln.cvss >= 4 ? "text-accent" : "text-success"
                      )}>
                        {selectedVuln.cvss}
                      </span>
                    </div>
                    <Progress 
                      value={selectedVuln.cvss * 10} 
                      className="h-3"
                    />
                  </div>

                  {/* Info Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">Asset</div>
                      <div className="text-sm font-mono">{selectedVuln.asset}</div>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">Exploitability</div>
                      <div>{getExploitBadge(selectedVuln.exploitability)}</div>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">Patch Available</div>
                      <div className="flex items-center gap-1">
                        {selectedVuln.patchAvailable ? (
                          <><CheckCircle2 className="w-4 h-4 text-success" /><span className="text-sm">Yes</span></>
                        ) : (
                          <><AlertTriangle className="w-4 h-4 text-warning" /><span className="text-sm">No</span></>
                        )}
                      </div>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">Owner</div>
                      <div className="text-sm">{selectedVuln.owner || "Unassigned"}</div>
                    </div>
                  </div>

                  {/* Description */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-foreground">Description</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      This vulnerability allows attackers to execute arbitrary code remotely due to improper input validation. 
                      The vulnerability is actively being exploited in the wild and requires immediate attention.
                    </p>
                  </div>

                  {/* Detection Timeline */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-foreground">Detection Timeline</h4>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-primary" />
                        <span className="text-muted-foreground">First seen:</span>
                        <span className="font-medium">{selectedVuln.firstSeen}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-destructive" />
                        <span className="text-muted-foreground">Last seen:</span>
                        <span className="font-medium">{selectedVuln.lastSeen}</span>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="remediation" className="space-y-6 mt-4">
                  <div className="space-y-3">
                    <h4 className="font-medium text-foreground">Recommended Fix</h4>
                    <div className="space-y-2">
                      {[
                        "Update to the latest patched version",
                        "Apply security configuration changes",
                        "Verify fix by re-scanning the asset"
                      ].map((step, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                          <span className="text-sm">{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {selectedVuln.patchAvailable && (
                    <div className="p-4 bg-success/10 border border-success/20 rounded-xl">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-5 h-5 text-success" />
                        <span className="font-medium text-success">Patch Available</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        A security patch is available. Apply the latest updates to remediate this vulnerability.
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="history" className="space-y-4 mt-4">
                  {[
                    { action: "Vulnerability detected", user: "System", time: selectedVuln.firstSeen },
                    { action: "Assigned to DevOps Team", user: "Admin", time: "2024-01-16" },
                    { action: "Status changed to In Progress", user: "John D.", time: "2024-01-17" },
                  ].map((event, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                      <div className="w-2 h-2 rounded-full bg-primary mt-2" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{event.action}</div>
                        <div className="text-xs text-muted-foreground">{event.user} • {event.time}</div>
                      </div>
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Assign Task Dialog */}
      <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" />
              Assign Task to Team
            </DialogTitle>
          </DialogHeader>
          {assignVuln && (
            <div className="space-y-4 py-2">
              {/* Vulnerability Info */}
              <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
                <div className="flex items-center gap-2 mb-2">
                  <SeverityBadge severity={assignVuln.severity} />
                  <code className="text-sm font-mono text-primary">{assignVuln.cve}</code>
                </div>
                <div className="text-sm font-medium">{assignVuln.title}</div>
                <div className="text-xs text-muted-foreground mt-1">Asset: {assignVuln.asset}</div>
              </div>

              {/* Assignee */}
              <div className="space-y-2">
                <Label>Assign To *</Label>
                <Select value={assignForm.assignee} onValueChange={(v) => setAssignForm({ ...assignForm, assignee: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select team member" />
                  </SelectTrigger>
                  <SelectContent>
                    {teamMembers.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
                            {member.name.split(" ").map(n => n[0]).join("")}
                          </div>
                          <span>{member.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority & Due Date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={assignForm.priority} onValueChange={(v) => setAssignForm({ ...assignForm, priority: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">🔴 Critical</SelectItem>
                      <SelectItem value="high">🟠 High</SelectItem>
                      <SelectItem value="medium">🟡 Medium</SelectItem>
                      <SelectItem value="low">🟢 Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input 
                    type="date" 
                    value={assignForm.dueDate} 
                    onChange={(e) => setAssignForm({ ...assignForm, dueDate: e.target.value })}
                  />
                </div>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label>Task Description</Label>
                <Textarea 
                  rows={4} 
                  value={assignForm.description}
                  onChange={(e) => setAssignForm({ ...assignForm, description: e.target.value })}
                  placeholder="Describe the task..."
                />
              </div>

              {/* Notify Via */}
              <div className="space-y-2">
                <Label>Notify Via</Label>
                <div className="flex gap-2">
                  {[
                    { id: "slack", label: "Slack", icon: Slack },
                    { id: "email", label: "Email", icon: Mail },
                    { id: "jira", label: "Jira", icon: Link2 },
                  ].map((platform) => (
                    <Button
                      key={platform.id}
                      type="button"
                      variant={assignForm.notifyVia.includes(platform.id) ? "default" : "outline"}
                      size="sm"
                      className="gap-2"
                      onClick={() => {
                        setAssignForm({
                          ...assignForm,
                          notifyVia: assignForm.notifyVia.includes(platform.id)
                            ? assignForm.notifyVia.filter(p => p !== platform.id)
                            : [...assignForm.notifyVia, platform.id]
                        });
                      }}
                    >
                      <platform.icon className="w-4 h-4" />
                      {platform.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button variant="outline" onClick={() => setIsAssignDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="gradient" onClick={handleAssignTask}>
                  <Send className="w-4 h-4 mr-2" />
                  Assign Task
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}