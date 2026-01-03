import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SeverityBadge } from "./SeverityBadge";
import { StatCard } from "./StatCard";
import { EmptyState } from "./EmptyState";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Cloud,
  Plus,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Shield,
  Lock,
  Database,
  Server,
  MoreHorizontal,
  CheckCircle2,
  Key,
  Settings,
  ExternalLink,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { motion } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";

const cloudAccounts = [
  { id: 1, provider: "AWS", name: "Production Account", accountId: "123456789012", status: "connected", issues: 23, lastSync: "5 min ago" },
  { id: 2, provider: "Azure", name: "Development", accountId: "sub-abc123", status: "connected", issues: 8, lastSync: "10 min ago" },
  { id: 3, provider: "GCP", name: "Analytics Project", accountId: "analytics-prod", status: "error", issues: 12, lastSync: "1 hour ago" },
];

const misconfigurations = [
  { id: 1, title: "Public S3 Bucket", resource: "s3://company-backups", provider: "AWS", severity: "critical" as const, category: "Storage" },
  { id: 2, title: "Exposed VM with Public IP", resource: "vm-prod-001", provider: "AWS", severity: "high" as const, category: "Compute" },
  { id: 3, title: "Over-permissive IAM Role", resource: "AdminFullAccess", provider: "AWS", severity: "high" as const, category: "IAM" },
  { id: 4, title: "Unencrypted RDS Instance", resource: "db-customers", provider: "AWS", severity: "critical" as const, category: "Database" },
  { id: 5, title: "Security Group - All Traffic Open", resource: "sg-0123456789", provider: "AWS", severity: "critical" as const, category: "Network" },
  { id: 6, title: "Storage Account Public Access", resource: "storageaccount1", provider: "Azure", severity: "high" as const, category: "Storage" },
  { id: 7, title: "VM without Disk Encryption", resource: "dev-vm-02", provider: "Azure", severity: "medium" as const, category: "Compute" },
  { id: 8, title: "Cloud Function Public Invocation", resource: "process-data", provider: "GCP", severity: "high" as const, category: "Serverless" },
];

const providerColors: Record<string, string> = {
  AWS: "bg-[#FF9900]/10 text-[#FF9900]",
  Azure: "bg-[#0078D4]/10 text-[#0078D4]",
  GCP: "bg-[#4285F4]/10 text-[#4285F4]",
};

export function CloudAttackSurface() {
  const [activeProvider, setActiveProvider] = useState("all");
  const [activeCategory, setActiveCategory] = useState("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  const [newAccount, setNewAccount] = useState({ provider: "", name: "", accountId: "" });

  const filteredMisconfigs = misconfigurations.filter((m) => {
    const matchesProvider = activeProvider === "all" || m.provider === activeProvider;
    const matchesCategory = activeCategory === "all" || m.category.toLowerCase() === activeCategory;
    return matchesProvider && matchesCategory;
  });

  const stats = {
    critical: misconfigurations.filter(m => m.severity === "critical").length,
    high: misconfigurations.filter(m => m.severity === "high").length,
    medium: misconfigurations.filter(m => m.severity === "medium").length,
  };

  const handleAddAccount = () => {
    if (!newAccount.provider || !newAccount.name || !newAccount.accountId) {
      toast({ title: "Error", description: "Please fill in all fields", variant: "destructive" });
      return;
    }
    toast({ title: "Account Connected", description: `${newAccount.name} has been added` });
    setIsAddOpen(false);
    setNewAccount({ provider: "", name: "", accountId: "" });
  };

  const handleDeleteConfirm = () => {
    if (deleteConfirm) {
      toast({ title: "Account Removed", description: `${deleteConfirm.name} has been disconnected` });
      setDeleteConfirm(null);
    }
  };

  const handleSync = (name: string) => {
    toast({ title: "Syncing", description: `Syncing ${name}...` });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Cloud className="w-5 h-5 text-primary" />
            Cloud Attack Surface
          </h2>
          <p className="text-sm text-muted-foreground">Monitor and secure your cloud infrastructure</p>
        </div>
        <Button variant="gradient" onClick={() => setIsAddOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Cloud Account
        </Button>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-4 gap-4">
        <StatCard label="Cloud Accounts" value={cloudAccounts.length} icon={Cloud} />
        <StatCard label="Critical Issues" value={stats.critical} icon={AlertTriangle} variant="critical" />
        <StatCard label="High Issues" value={stats.high} icon={Shield} variant="warning" />
        <StatCard label="Medium Issues" value={stats.medium} icon={Lock} />
      </div>

      {/* Connected Accounts */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground">Connected Accounts</h3>
          <Button variant="ghost" size="sm" onClick={() => toast({ title: "Syncing All", description: "Syncing all accounts..." })}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Sync All
          </Button>
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          {cloudAccounts.map((account, index) => (
            <motion.div
              key={account.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="p-5 border border-border rounded-xl hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${providerColors[account.provider]}`}>
                    <Cloud className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="font-medium text-foreground">{account.name}</div>
                    <div className="text-xs text-muted-foreground">{account.provider} • {account.accountId}</div>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleSync(account.name)}>
                      <RefreshCw className="w-4 h-4 mr-2" />Sync Now
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Key className="w-4 h-4 mr-2" />Re-authenticate
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Settings className="w-4 h-4 mr-2" />Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="text-destructive"
                      onClick={() => setDeleteConfirm({ id: account.id, name: account.name })}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex items-center justify-between text-sm mb-2">
                <div className="flex items-center gap-2">
                  {account.status === "connected" ? (
                    <CheckCircle2 className="w-4 h-4 text-success" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-destructive" />
                  )}
                  <span className="capitalize">{account.status}</span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs ${
                  account.issues > 20 ? "bg-destructive/10 text-destructive" :
                  account.issues > 10 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
                }`}>
                  {account.issues} issues
                </span>
              </div>
              <div className="text-xs text-muted-foreground">Last sync: {account.lastSync}</div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Misconfigurations */}
      <div className="bg-card rounded-2xl border border-border p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <h3 className="font-semibold text-foreground">Misconfigurations</h3>
          <div className="flex gap-2">
            {["all", "AWS", "Azure", "GCP"].map((provider) => (
              <Button
                key={provider}
                variant={activeProvider === provider ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveProvider(provider)}
              >
                {provider === "all" ? "All" : provider}
              </Button>
            ))}
          </div>
        </div>

        <Tabs value={activeCategory} onValueChange={setActiveCategory}>
          <TabsList className="mb-4">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="storage">Storage</TabsTrigger>
            <TabsTrigger value="compute">Compute</TabsTrigger>
            <TabsTrigger value="iam">IAM</TabsTrigger>
            <TabsTrigger value="network">Network</TabsTrigger>
          </TabsList>

          <TabsContent value={activeCategory}>
            <div className="space-y-3">
              {filteredMisconfigs.map((config, index) => (
                <motion.div
                  key={config.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center gap-4 p-4 border border-border rounded-xl hover:bg-muted/30 cursor-pointer transition-all group"
                >
                  <SeverityBadge severity={config.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground group-hover:text-primary transition-colors">{config.title}</div>
                    <div className="text-sm text-muted-foreground font-mono">{config.resource}</div>
                  </div>
                  <span className="text-xs px-2.5 py-1 bg-muted rounded-lg">{config.category}</span>
                  <span className={`text-xs px-2.5 py-1 rounded-lg ${providerColors[config.provider]}`}>{config.provider}</span>
                  <ExternalLink className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </motion.div>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {filteredMisconfigs.length === 0 && (
          <EmptyState
            icon={Cloud}
            title="No misconfigurations found"
            description="Your cloud infrastructure looks secure. Keep monitoring for new issues."
          />
        )}
      </div>

      {/* Category Breakdown */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Storage", icon: Database, count: 3, critical: 1 },
          { label: "Compute", icon: Server, count: 2, critical: 0 },
          { label: "IAM", icon: Key, count: 1, critical: 0 },
          { label: "Network", icon: Shield, count: 1, critical: 1 },
        ].map((category, index) => (
          <motion.div
            key={category.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + index * 0.1 }}
            className="bg-card rounded-2xl border border-border p-5 cursor-pointer hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-primary/10">
                <category.icon className="w-5 h-5 text-primary" />
              </div>
              <span className="font-medium text-foreground">{category.label}</span>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl font-bold text-foreground">{category.count}</div>
                <div className="text-xs text-muted-foreground">Issues found</div>
              </div>
              {category.critical > 0 && (
                <span className="text-xs px-2.5 py-1 bg-destructive/10 text-destructive rounded-lg">
                  {category.critical} critical
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Add Account Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Cloud className="w-5 h-5 text-primary" />
              Add Cloud Account
            </DialogTitle>
            <DialogDescription>
              Connect your cloud provider for security monitoring
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Cloud Provider</Label>
              <Select value={newAccount.provider} onValueChange={(value) => setNewAccount({ ...newAccount, provider: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AWS">Amazon Web Services (AWS)</SelectItem>
                  <SelectItem value="Azure">Microsoft Azure</SelectItem>
                  <SelectItem value="GCP">Google Cloud Platform</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Account Name</Label>
              <Input
                placeholder="e.g., Production Account"
                value={newAccount.name}
                onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Account ID</Label>
              <Input
                placeholder="e.g., 123456789012"
                value={newAccount.accountId}
                onChange={(e) => setNewAccount({ ...newAccount, accountId: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
              <Button variant="gradient" onClick={handleAddAccount}>Connect Account</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Cloud Account?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect <span className="font-semibold">{deleteConfirm?.name}</span>? 
              This will stop monitoring this cloud account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
