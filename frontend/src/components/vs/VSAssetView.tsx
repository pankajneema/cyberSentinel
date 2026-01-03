import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Search,
  Server,
  Globe,
  Cloud,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Shield,
  Clock,
  TrendingDown,
  TrendingUp,
  Bug,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "@/components/asm/SeverityBadge";

interface Asset {
  id: number;
  name: string;
  type: "domain" | "ip" | "cloud";
  vulnerabilities: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  lastScan: string;
  patchCompliance: number;
  trend: "up" | "down" | "stable";
}

const assets: Asset[] = [
  { id: 1, name: "api.company.com", type: "domain", vulnerabilities: { critical: 2, high: 5, medium: 8, low: 12 }, lastScan: "2h ago", patchCompliance: 78, trend: "down" },
  { id: 2, name: "app.company.com", type: "domain", vulnerabilities: { critical: 1, high: 3, medium: 12, low: 8 }, lastScan: "1d ago", patchCompliance: 85, trend: "up" },
  { id: 3, name: "db-prod.company.com", type: "domain", vulnerabilities: { critical: 3, high: 8, medium: 5, low: 2 }, lastScan: "3h ago", patchCompliance: 62, trend: "stable" },
  { id: 4, name: "192.168.1.100", type: "ip", vulnerabilities: { critical: 0, high: 2, medium: 6, low: 10 }, lastScan: "6h ago", patchCompliance: 91, trend: "up" },
  { id: 5, name: "staging.app.com", type: "domain", vulnerabilities: { critical: 0, high: 4, medium: 15, low: 20 }, lastScan: "2d ago", patchCompliance: 75, trend: "down" },
  { id: 6, name: "aws-prod-cluster", type: "cloud", vulnerabilities: { critical: 1, high: 6, medium: 10, low: 5 }, lastScan: "4h ago", patchCompliance: 70, trend: "stable" },
];

const assetVulnerabilities = [
  { id: 1, cve: "CVE-2024-1234", title: "Remote Code Execution", severity: "critical" as const, status: "open", firstSeen: "2024-01-15" },
  { id: 2, cve: "CVE-2024-5678", title: "SQL Injection Vulnerability", severity: "critical" as const, status: "in_progress", firstSeen: "2024-01-12" },
  { id: 3, cve: "CVE-2024-9012", title: "Cross-Site Scripting", severity: "high" as const, status: "open", firstSeen: "2024-01-10" },
  { id: 4, cve: "CVE-2024-3456", title: "Privilege Escalation", severity: "high" as const, status: "fixed", firstSeen: "2024-01-08" },
  { id: 5, cve: "CVE-2024-7890", title: "Information Disclosure", severity: "medium" as const, status: "open", firstSeen: "2024-01-05" },
];

export function VSAssetView() {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  const filteredAssets = assets.filter(asset => {
    const matchesSearch = asset.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || asset.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "domain": return <Globe className="w-4 h-4 text-primary" />;
      case "ip": return <Server className="w-4 h-4 text-secondary" />;
      case "cloud": return <Cloud className="w-4 h-4 text-accent" />;
      default: return null;
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case "up": return <TrendingUp className="w-4 h-4 text-success" />;
      case "down": return <TrendingDown className="w-4 h-4 text-destructive" />;
      default: return <div className="w-4 h-1 bg-muted-foreground rounded" />;
    }
  };

  const getTotalVulns = (vulns: Asset["vulnerabilities"]) => {
    return vulns.critical + vulns.high + vulns.medium + vulns.low;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Asset-Centric View</h2>
          <p className="text-sm text-muted-foreground">View vulnerabilities grouped by asset</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="domain">Domains</SelectItem>
            <SelectItem value="ip">IP Addresses</SelectItem>
            <SelectItem value="cloud">Cloud Resources</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Asset Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredAssets.map((asset, index) => (
          <motion.div
            key={asset.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="bg-card rounded-2xl border border-border p-5 hover:shadow-md cursor-pointer transition-all"
            onClick={() => setSelectedAsset(asset)}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-muted">
                  {getTypeIcon(asset.type)}
                </div>
                <div>
                  <div className="font-medium text-foreground font-mono text-sm">{asset.name}</div>
                  <div className="text-xs text-muted-foreground capitalize">{asset.type}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {getTrendIcon(asset.trend)}
              </div>
            </div>

            {/* Vulnerability Counts */}
            <div className="grid grid-cols-4 gap-2 mb-4">
              {[
                { label: "C", value: asset.vulnerabilities.critical, color: "bg-destructive/10 text-destructive" },
                { label: "H", value: asset.vulnerabilities.high, color: "bg-warning/10 text-warning" },
                { label: "M", value: asset.vulnerabilities.medium, color: "bg-accent/10 text-accent" },
                { label: "L", value: asset.vulnerabilities.low, color: "bg-success/10 text-success" },
              ].map((item) => (
                <div key={item.label} className={cn("text-center p-2 rounded-lg", item.color)}>
                  <div className="text-lg font-bold">{item.value}</div>
                  <div className="text-xs">{item.label}</div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t border-border">
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {asset.lastScan}
              </div>
              <div className="flex items-center gap-1">
                <Shield className="w-3 h-3" />
                {asset.patchCompliance}% patched
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Asset Detail Sheet */}
      <Sheet open={!!selectedAsset} onOpenChange={() => setSelectedAsset(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedAsset && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-muted">
                    {getTypeIcon(selectedAsset.type)}
                  </div>
                  <div>
                    <SheetTitle className="font-mono">{selectedAsset.name}</SheetTitle>
                    <p className="text-sm text-muted-foreground capitalize">{selectedAsset.type} • Last scan: {selectedAsset.lastScan}</p>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-muted/30 rounded-xl">
                    <div className="flex items-center gap-2 mb-1">
                      <Bug className="w-4 h-4 text-destructive" />
                      <span className="text-sm text-muted-foreground">Total Vulnerabilities</span>
                    </div>
                    <div className="text-2xl font-bold">{getTotalVulns(selectedAsset.vulnerabilities)}</div>
                  </div>
                  <div className="p-4 bg-muted/30 rounded-xl">
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-4 h-4 text-success" />
                      <span className="text-sm text-muted-foreground">Patch Compliance</span>
                    </div>
                    <div className="text-2xl font-bold">{selectedAsset.patchCompliance}%</div>
                  </div>
                </div>

                {/* Tabs */}
                <Tabs defaultValue="all">
                  <TabsList>
                    <TabsTrigger value="all">All ({getTotalVulns(selectedAsset.vulnerabilities)})</TabsTrigger>
                    <TabsTrigger value="exploitable">Exploitable ({selectedAsset.vulnerabilities.critical + selectedAsset.vulnerabilities.high})</TabsTrigger>
                    <TabsTrigger value="fixed">Fixed History</TabsTrigger>
                  </TabsList>

                  <TabsContent value="all" className="mt-4 space-y-2">
                    {assetVulnerabilities.map((vuln) => (
                      <div
                        key={vuln.id}
                        className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        <SeverityBadge severity={vuln.severity} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{vuln.title}</div>
                          <div className="text-xs text-muted-foreground font-mono">{vuln.cve}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {vuln.status === "open" && <AlertTriangle className="w-4 h-4 text-destructive" />}
                          {vuln.status === "in_progress" && <Clock className="w-4 h-4 text-warning" />}
                          {vuln.status === "fixed" && <CheckCircle2 className="w-4 h-4 text-success" />}
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="exploitable" className="mt-4 space-y-2">
                    {assetVulnerabilities.filter(v => v.severity === "critical" || v.severity === "high").map((vuln) => (
                      <div
                        key={vuln.id}
                        className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl hover:bg-muted/50 cursor-pointer transition-colors"
                      >
                        <SeverityBadge severity={vuln.severity} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{vuln.title}</div>
                          <div className="text-xs text-muted-foreground font-mono">{vuln.cve}</div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="fixed" className="mt-4 space-y-2">
                    {assetVulnerabilities.filter(v => v.status === "fixed").map((vuln) => (
                      <div
                        key={vuln.id}
                        className="flex items-center gap-3 p-3 bg-success/5 border border-success/20 rounded-xl"
                      >
                        <CheckCircle2 className="w-5 h-5 text-success" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{vuln.title}</div>
                          <div className="text-xs text-muted-foreground font-mono">{vuln.cve} • Fixed on 2024-01-18</div>
                        </div>
                      </div>
                    ))}
                  </TabsContent>
                </Tabs>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}