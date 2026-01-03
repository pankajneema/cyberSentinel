import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SeverityBadge } from "./SeverityBadge";
import { EmptyState } from "./EmptyState";
import {
  Search,
  Filter,
  Download,
  MoreHorizontal,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Eye,
  UserPlus,
  FileText,
  MessageSquare,
  Link2,
  ChevronRight,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type Severity = "critical" | "high" | "medium" | "low";

const vulnerabilities: Array<{
  id: number;
  title: string;
  asset: string;
  category: string;
  cvss: number;
  severity: Severity;
  firstSeen: string;
  lastSeen: string;
  status: string;
  owner: string | null;
}> = [
  { id: 1, title: "Exposed MongoDB Database", asset: "db-prod.company.com", category: "Infra", cvss: 9.8, severity: "critical", firstSeen: "2024-01-15", lastSeen: "2024-01-20", status: "open", owner: null },
  { id: 2, title: "Outdated SSL/TLS Certificate", asset: "api.company.com", category: "Web", cvss: 7.5, severity: "high", firstSeen: "2024-01-10", lastSeen: "2024-01-20", status: "open", owner: "John D." },
  { id: 3, title: "Open SSH Port to Internet", asset: "192.168.1.100", category: "Infra", cvss: 8.1, severity: "high", firstSeen: "2024-01-12", lastSeen: "2024-01-19", status: "acknowledged", owner: "Sarah M." },
  { id: 4, title: "Missing Security Headers", asset: "app.company.com", category: "Web", cvss: 5.3, severity: "medium", firstSeen: "2024-01-08", lastSeen: "2024-01-20", status: "open", owner: null },
  { id: 5, title: "Public S3 Bucket", asset: "aws-s3-backup", category: "Cloud", cvss: 9.1, severity: "critical", firstSeen: "2024-01-05", lastSeen: "2024-01-20", status: "open", owner: "DevOps Team" },
  { id: 6, title: "Permissive CORS Policy", asset: "cdn.company.com", category: "Web", cvss: 4.3, severity: "medium", firstSeen: "2024-01-01", lastSeen: "2024-01-15", status: "resolved", owner: "John D." },
  { id: 7, title: "Weak Password Policy", asset: "auth.company.com", category: "Web", cvss: 6.5, severity: "medium", firstSeen: "2024-01-03", lastSeen: "2024-01-18", status: "open", owner: null },
  { id: 8, title: "Exposed Admin Panel", asset: "admin.company.com", category: "Web", cvss: 8.8, severity: "high", firstSeen: "2024-01-14", lastSeen: "2024-01-20", status: "acknowledged", owner: "Security Team" },
  { id: 9, title: "Information Disclosure", asset: "docs.company.com", category: "Web", cvss: 3.1, severity: "low", firstSeen: "2024-01-02", lastSeen: "2024-01-10", status: "open", owner: null },
];

export function Vulnerabilities() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedVuln, setSelectedVuln] = useState<typeof vulnerabilities[0] | null>(null);

  const filteredVulns = vulnerabilities.filter((vuln) => {
    const matchesSearch = vuln.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         vuln.asset.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || vuln.status === statusFilter;
    const matchesSeverity = severityFilter === "all" || vuln.severity === severityFilter;
    return matchesSearch && matchesStatus && matchesSeverity;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "open": return <AlertTriangle className="w-4 h-4 text-warning" />;
      case "acknowledged": return <Clock className="w-4 h-4 text-accent" />;
      case "resolved": return <CheckCircle2 className="w-4 h-4 text-success" />;
      default: return null;
    }
  };

  const stats = {
    critical: vulnerabilities.filter(v => v.severity === "critical").length,
    high: vulnerabilities.filter(v => v.severity === "high").length,
    medium: vulnerabilities.filter(v => v.severity === "medium").length,
    low: vulnerabilities.filter(v => v.severity === "low").length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Vulnerabilities</h2>
          <p className="text-sm text-muted-foreground">{vulnerabilities.length} findings across your attack surface</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Severity Stats */}
      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Critical", value: stats.critical, color: "bg-destructive/10 text-destructive border-destructive/20" },
          { label: "High", value: stats.high, color: "bg-warning/10 text-warning border-warning/20" },
          { label: "Medium", value: stats.medium, color: "bg-accent/10 text-accent border-accent/20" },
          { label: "Low", value: stats.low, color: "bg-success/10 text-success border-success/20" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`p-4 rounded-xl border ${stat.color} cursor-pointer hover:shadow-md transition-all`}
            onClick={() => setSeverityFilter(stat.label.toLowerCase())}
          >
            <div className="text-2xl font-bold">{stat.value}</div>
            <div className="text-sm opacity-80">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search vulnerabilities..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="acknowledged">Acknowledged</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[140px]">
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

      {/* Vulnerabilities List */}
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/30">
              <tr className="text-left text-sm text-muted-foreground">
                <th className="p-4 font-medium">Severity</th>
                <th className="p-4 font-medium">Vulnerability</th>
                <th className="p-4 font-medium">Asset</th>
                <th className="p-4 font-medium">Category</th>
                <th className="p-4 font-medium">CVSS</th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium">Owner</th>
                <th className="p-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredVulns.map((vuln) => (
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
                    <div className="font-medium text-foreground">{vuln.title}</div>
                    <div className="text-xs text-muted-foreground">First seen: {vuln.firstSeen}</div>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground font-mono">{vuln.asset}</td>
                  <td className="p-4">
                    <span className="text-xs px-2 py-1 bg-muted rounded-full">{vuln.category}</span>
                  </td>
                  <td className="p-4">
                    <span className={`font-bold ${
                      vuln.cvss >= 9 ? "text-destructive" :
                      vuln.cvss >= 7 ? "text-warning" :
                      vuln.cvss >= 4 ? "text-accent" : "text-success"
                    }`}>
                      {vuln.cvss}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(vuln.status)}
                      <span className="text-sm capitalize">{vuln.status}</span>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">
                    {vuln.owner || <span className="text-muted-foreground/50">Unassigned</span>}
                  </td>
                  <td className="p-4" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem><Eye className="w-4 h-4 mr-2" />View Details</DropdownMenuItem>
                        <DropdownMenuItem><UserPlus className="w-4 h-4 mr-2" />Assign</DropdownMenuItem>
                        <DropdownMenuItem><CheckCircle2 className="w-4 h-4 mr-2" />Mark Resolved</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem><Link2 className="w-4 h-4 mr-2" />Create Jira Ticket</DropdownMenuItem>
                        <DropdownMenuItem><FileText className="w-4 h-4 mr-2" />Export Report</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredVulns.length === 0 && (
          <EmptyState
            icon={AlertTriangle}
            title="No vulnerabilities found"
            description="No vulnerabilities match your current filters."
          />
        )}
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
                    <p className="text-sm text-muted-foreground mt-1">{selectedVuln.asset}</p>
                  </div>
                </div>
              </SheetHeader>

              <Tabs defaultValue="details" className="mt-6">
                <TabsList>
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="remediation">Remediation</TabsTrigger>
                  <TabsTrigger value="history">History</TabsTrigger>
                  <TabsTrigger value="comments">Comments</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="space-y-6 mt-4">
                  {/* Quick Actions */}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="gradient" size="sm"><CheckCircle2 className="w-4 h-4 mr-1" />Mark Resolved</Button>
                    <Button variant="outline" size="sm"><UserPlus className="w-4 h-4 mr-1" />Assign</Button>
                    <Button variant="outline" size="sm"><Link2 className="w-4 h-4 mr-1" />Create Ticket</Button>
                    <Button variant="outline" size="sm"><Download className="w-4 h-4 mr-1" />Export PDF</Button>
                  </div>

                  {/* Info Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">CVSS Score</div>
                      <div className="text-lg font-bold text-destructive">{selectedVuln.cvss}</div>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">Category</div>
                      <div className="text-sm font-medium">{selectedVuln.category}</div>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">First Seen</div>
                      <div className="text-sm font-medium">{selectedVuln.firstSeen}</div>
                    </div>
                    <div className="p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs text-muted-foreground mb-1">Last Seen</div>
                      <div className="text-sm font-medium">{selectedVuln.lastSeen}</div>
                    </div>
                  </div>

                  {/* Technical Summary */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-foreground">Technical Summary</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      This vulnerability allows unauthorized access to sensitive data through an exposed database endpoint. 
                      The MongoDB instance is accessible from the public internet without authentication, potentially exposing 
                      all stored data to malicious actors.
                    </p>
                  </div>

                  {/* Proof of Detection */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-foreground">Proof of Detection</h4>
                    <div className="p-4 bg-muted/50 rounded-lg font-mono text-xs overflow-x-auto">
                      <pre>{`$ nmap -sV -p 27017 db-prod.company.com
PORT      STATE SERVICE VERSION
27017/tcp open  mongodb MongoDB 4.4.6

$ mongosh --host db-prod.company.com
Current Mongosh Log ID: 65abc123def456
Connecting to: mongodb://db-prod.company.com:27017
Connected successfully.`}</pre>
                    </div>
                  </div>

                  {/* Attack Path */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-foreground">Attack Path</h4>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="px-3 py-1 bg-muted rounded-lg">Internet</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      <span className="px-3 py-1 bg-muted rounded-lg">Port 27017</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      <span className="px-3 py-1 bg-destructive/10 text-destructive rounded-lg">MongoDB</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      <span className="px-3 py-1 bg-destructive/10 text-destructive rounded-lg">Data Exposure</span>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="remediation" className="space-y-6 mt-4">
                  <div className="space-y-3">
                    <h4 className="font-medium text-foreground">Recommended Fix</h4>
                    <div className="space-y-2">
                      <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center">1</span>
                        <div>
                          <div className="font-medium text-sm">Enable Authentication</div>
                          <div className="text-xs text-muted-foreground">Configure MongoDB to require authentication for all connections.</div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center">2</span>
                        <div>
                          <div className="font-medium text-sm">Restrict Network Access</div>
                          <div className="text-xs text-muted-foreground">Configure firewall rules to only allow connections from trusted IPs.</div>
                        </div>
                      </div>
                      <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                        <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center">3</span>
                        <div>
                          <div className="font-medium text-sm">Enable TLS Encryption</div>
                          <div className="text-xs text-muted-foreground">Encrypt all database connections using TLS 1.3.</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h4 className="font-medium text-foreground">References</h4>
                    <div className="space-y-2">
                      <a href="#" className="flex items-center gap-2 text-sm text-primary hover:underline">
                        <ExternalLink className="w-4 h-4" />
                        MongoDB Security Checklist
                      </a>
                      <a href="#" className="flex items-center gap-2 text-sm text-primary hover:underline">
                        <ExternalLink className="w-4 h-4" />
                        CVE-2021-12345 Details
                      </a>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="history" className="mt-4">
                  <div className="space-y-4">
                    {[
                      { date: "2024-01-20", action: "Status changed to Open", user: "System" },
                      { date: "2024-01-18", action: "Assigned to DevOps Team", user: "John D." },
                      { date: "2024-01-15", action: "First detected", user: "Scanner" },
                    ].map((event, i) => (
                      <div key={i} className="flex items-start gap-3 pb-4 border-b border-border last:border-0">
                        <div className="w-2 h-2 mt-2 rounded-full bg-primary" />
                        <div>
                          <div className="text-sm font-medium">{event.action}</div>
                          <div className="text-xs text-muted-foreground">{event.date} • {event.user}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="comments" className="mt-4 space-y-4">
                  <div className="space-y-4">
                    {[
                      { user: "John D.", date: "2024-01-19", text: "Working on implementing the fix. Should be done by EOD." },
                      { user: "Sarah M.", date: "2024-01-18", text: "This needs to be prioritized. Assigning to DevOps." },
                    ].map((comment, i) => (
                      <div key={i} className="p-4 bg-muted/30 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{comment.user}</span>
                          <span className="text-xs text-muted-foreground">{comment.date}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">{comment.text}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    <Textarea placeholder="Add a comment..." />
                    <Button size="sm">
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Post Comment
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
