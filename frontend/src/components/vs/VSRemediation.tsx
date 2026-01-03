import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  MessageSquare,
  ChevronRight,
  Link2,
  ArrowRight,
  Timer,
  Target,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "@/components/asm/SeverityBadge";
import { toast } from "@/hooks/use-toast";

interface RemediationItem {
  id: number;
  vulnerability: string;
  cve: string;
  severity: "critical" | "high" | "medium" | "low";
  asset: string;
  owner: string;
  status: "open" | "in_progress" | "pending_verification" | "closed";
  slaDeadline: string;
  slaOverdue: boolean;
  ticketId: string | null;
  comments: number;
}

const remediationItems: RemediationItem[] = [
  { id: 1, vulnerability: "Remote Code Execution in Apache Log4j", cve: "CVE-2024-1234", severity: "critical", asset: "api.company.com", owner: "John D.", status: "in_progress", slaDeadline: "2024-01-22", slaOverdue: false, ticketId: "SEC-1234", comments: 5 },
  { id: 2, vulnerability: "SQL Injection in Login", cve: "CVE-2024-5678", severity: "critical", asset: "app.company.com", owner: "Sarah M.", status: "pending_verification", slaDeadline: "2024-01-20", slaOverdue: true, ticketId: "SEC-1235", comments: 8 },
  { id: 3, vulnerability: "Cross-Site Scripting (XSS)", cve: "CVE-2024-9012", severity: "high", asset: "staging.app.com", owner: "DevOps Team", status: "open", slaDeadline: "2024-01-25", slaOverdue: false, ticketId: null, comments: 2 },
  { id: 4, vulnerability: "Privilege Escalation", cve: "CVE-2024-2345", severity: "high", asset: "admin.company.com", owner: "Security Team", status: "in_progress", slaDeadline: "2024-01-24", slaOverdue: false, ticketId: "SEC-1236", comments: 3 },
  { id: 5, vulnerability: "Information Disclosure", cve: "CVE-2024-7890", severity: "medium", asset: "cdn.company.com", owner: "Unassigned", status: "open", slaDeadline: "2024-01-30", slaOverdue: false, ticketId: null, comments: 0 },
];

const slaConfig = {
  critical: "24 hours",
  high: "72 hours",
  medium: "7 days",
  low: "30 days",
};

export function VSRemediation() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedItem, setSelectedItem] = useState<RemediationItem | null>(null);
  const [newComment, setNewComment] = useState("");

  const filteredItems = remediationItems.filter(item => {
    const matchesSearch = item.vulnerability.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         item.asset.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "open": return <span className="px-2 py-1 text-xs rounded-full bg-destructive/10 text-destructive">Open</span>;
      case "in_progress": return <span className="px-2 py-1 text-xs rounded-full bg-warning/10 text-warning">In Progress</span>;
      case "pending_verification": return <span className="px-2 py-1 text-xs rounded-full bg-accent/10 text-accent">Pending Verification</span>;
      case "closed": return <span className="px-2 py-1 text-xs rounded-full bg-success/10 text-success">Closed</span>;
      default: return null;
    }
  };

  const stats = {
    open: remediationItems.filter(i => i.status === "open").length,
    inProgress: remediationItems.filter(i => i.status === "in_progress").length,
    overdue: remediationItems.filter(i => i.slaOverdue).length,
    closed: remediationItems.filter(i => i.status === "closed").length,
  };

  const handleAddComment = () => {
    if (newComment.trim()) {
      toast({ title: "Comment Added", description: "Your comment has been posted" });
      setNewComment("");
    }
  };

  const handleCreateTicket = (item: RemediationItem) => {
    toast({ title: "Ticket Created", description: `Jira ticket created for ${item.cve}` });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Remediation & Workflow</h2>
          <p className="text-sm text-muted-foreground">Track and manage vulnerability remediation</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Open", value: stats.open, icon: AlertTriangle, color: "bg-destructive/10 text-destructive" },
          { label: "In Progress", value: stats.inProgress, icon: Clock, color: "bg-warning/10 text-warning" },
          { label: "Overdue SLA", value: stats.overdue, icon: Timer, color: "bg-destructive/10 text-destructive border-destructive/30 border-2" },
          { label: "Closed", value: stats.closed, icon: CheckCircle2, color: "bg-success/10 text-success" },
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
                <div className="text-2xl font-bold">{stat.value}</div>
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
        <div className="grid grid-cols-4 gap-4 text-sm">
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
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="pending_verification">Pending Verification</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Remediation Items */}
      <div className="space-y-3">
        {filteredItems.map((item, index) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className={cn(
              "bg-card rounded-2xl border p-5 hover:shadow-md cursor-pointer transition-all",
              item.slaOverdue ? "border-destructive/50" : "border-border"
            )}
            onClick={() => setSelectedItem(item)}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <SeverityBadge severity={item.severity} />
                <div>
                  <div className="font-medium text-foreground">{item.vulnerability}</div>
                  <div className="text-sm text-muted-foreground font-mono">{item.cve} • {item.asset}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {getStatusBadge(item.status)}
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </div>
            </div>

            <div className="flex items-center gap-6 mt-4 pt-4 border-t border-border text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="w-4 h-4" />
                <span>{item.owner}</span>
              </div>
              <div className={cn(
                "flex items-center gap-2",
                item.slaOverdue ? "text-destructive" : "text-muted-foreground"
              )}>
                <Calendar className="w-4 h-4" />
                <span>{item.slaOverdue ? "Overdue: " : "Due: "}{item.slaDeadline}</span>
              </div>
              {item.ticketId && (
                <div className="flex items-center gap-2 text-primary">
                  <Link2 className="w-4 h-4" />
                  <span>{item.ticketId}</span>
                </div>
              )}
              {item.comments > 0 && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MessageSquare className="w-4 h-4" />
                  <span>{item.comments}</span>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="sm:max-w-xl">
          {selectedItem && (
            <>
              <DialogHeader>
                <div className="flex items-start gap-3">
                  <SeverityBadge severity={selectedItem.severity} />
                  <div>
                    <DialogTitle>{selectedItem.vulnerability}</DialogTitle>
                    <p className="text-sm text-muted-foreground font-mono mt-1">{selectedItem.cve}</p>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-4 mt-4">
                {/* Status & Actions */}
                <div className="flex items-center justify-between">
                  {getStatusBadge(selectedItem.status)}
                  <div className="flex gap-2">
                    {!selectedItem.ticketId && (
                      <Button variant="outline" size="sm" onClick={() => handleCreateTicket(selectedItem)}>
                        <Link2 className="w-4 h-4 mr-1" />Create Ticket
                      </Button>
                    )}
                    <Button variant="gradient" size="sm">
                      <ArrowRight className="w-4 h-4 mr-1" />Update Status
                    </Button>
                  </div>
                </div>

                {/* Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Asset</div>
                    <div className="text-sm font-mono">{selectedItem.asset}</div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Owner</div>
                    <div className="text-sm">{selectedItem.owner}</div>
                  </div>
                  <div className={cn(
                    "p-3 rounded-lg",
                    selectedItem.slaOverdue ? "bg-destructive/10" : "bg-muted/30"
                  )}>
                    <div className="text-xs text-muted-foreground mb-1">SLA Deadline</div>
                    <div className={cn("text-sm font-medium", selectedItem.slaOverdue && "text-destructive")}>
                      {selectedItem.slaDeadline}
                      {selectedItem.slaOverdue && " (OVERDUE)"}
                    </div>
                  </div>
                  <div className="p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">Ticket</div>
                    <div className="text-sm">{selectedItem.ticketId || "Not created"}</div>
                  </div>
                </div>

                {/* Comments */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    <span className="font-medium text-sm">Comments ({selectedItem.comments})</span>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    <div className="p-3 bg-muted/30 rounded-lg text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">John D.</span>
                        <span className="text-xs text-muted-foreground">2h ago</span>
                      </div>
                      <p className="text-muted-foreground">Working on deploying the patch to production.</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Textarea 
                      placeholder="Add a comment..." 
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      className="min-h-[60px]"
                    />
                  </div>
                  <Button variant="outline" size="sm" onClick={handleAddComment}>Post Comment</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}