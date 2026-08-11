import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  User,
  GitBranch,
  Boxes,
  ChevronRight,
  Bug,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "@/components/asm/SeverityBadge";
import { EmptyState } from "@/components/asm/EmptyState";
import { fetchFindings, type VsFinding } from "@/lib/services/vs";
import { fetchAssets, type ApiAsset } from "@/lib/services/assets";

interface AssetGroup {
  id: string;
  name: string;
  type: ApiAsset["type"] | "unknown";
  counts: { critical: number; high: number; medium: number; low: number; info: number };
  total: number;
  findings: VsFinding[];
}

function typeIcon(type: string) {
  switch (type) {
    case "domain": return <Globe className="w-4 h-4 text-primary" />;
    case "ip": return <Server className="w-4 h-4 text-secondary" />;
    case "cloud": return <Cloud className="w-4 h-4 text-accent" />;
    case "repo": return <GitBranch className="w-4 h-4 text-primary" />;
    case "saas": return <Boxes className="w-4 h-4 text-secondary" />;
    case "user": return <User className="w-4 h-4 text-accent" />;
    default: return <Server className="w-4 h-4 text-muted-foreground" />;
  }
}

export function VSAssetView() {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedAsset, setSelectedAsset] = useState<AssetGroup | null>(null);

  const [findings, setFindings] = useState<VsFinding[]>([]);
  const [assets, setAssets] = useState<ApiAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [findingPage, assetPage] = await Promise.all([
        fetchFindings({ page: 1, page_size: 200 }),
        fetchAssets({ page: 1, page_size: 500 }),
      ]);
      setFindings(findingPage.items);
      setAssets(assetPage.items);
    } catch (e: any) {
      setError(e.message ?? "Failed to load asset findings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const groups = useMemo<AssetGroup[]>(() => {
    const assetMap = new Map(assets.map((a) => [a.id, a]));
    const byAsset = new Map<string, AssetGroup>();
    for (const f of findings) {
      let g = byAsset.get(f.asset_id);
      if (!g) {
        const a = assetMap.get(f.asset_id);
        g = {
          id: f.asset_id,
          name: a?.name ?? f.asset_id,
          type: a?.type ?? "unknown",
          counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
          total: 0,
          findings: [],
        };
        byAsset.set(f.asset_id, g);
      }
      g.counts[f.severity] += 1;
      g.total += 1;
      g.findings.push(f);
    }
    return Array.from(byAsset.values()).sort((a, b) => b.counts.critical - a.counts.critical || b.total - a.total);
  }, [findings, assets]);

  const filteredGroups = groups.filter((g) => {
    const matchesSearch = g.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = typeFilter === "all" || g.type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Asset-Centric View</h2>
          <p className="text-sm text-muted-foreground">View vulnerabilities grouped by asset</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} /> Refresh
        </Button>
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
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="domain">Domains</SelectItem>
            <SelectItem value="ip">IP Addresses</SelectItem>
            <SelectItem value="cloud">Cloud</SelectItem>
            <SelectItem value="repo">Repos</SelectItem>
            <SelectItem value="saas">SaaS</SelectItem>
            <SelectItem value="user">Users</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-2" /> Retry</Button>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border">
          <EmptyState
            icon={Bug}
            title={groups.length === 0 ? "No findings by asset" : "No assets match your filters"}
            description={groups.length === 0 ? "Run a vulnerability scan to see findings grouped by asset." : "Try adjusting your search or type filter."}
          />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredGroups.map((asset, index) => (
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
                  <div className="p-2 rounded-xl bg-muted">{typeIcon(asset.type)}</div>
                  <div>
                    <div className="font-medium text-foreground font-mono text-sm truncate max-w-[160px]">{asset.name}</div>
                    <div className="text-xs text-muted-foreground capitalize">{asset.type}</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 mb-4">
                {[
                  { label: "C", value: asset.counts.critical, color: "bg-destructive/10 text-destructive" },
                  { label: "H", value: asset.counts.high, color: "bg-warning/10 text-warning" },
                  { label: "M", value: asset.counts.medium, color: "bg-accent/10 text-accent" },
                  { label: "L", value: asset.counts.low, color: "bg-success/10 text-success" },
                ].map((item) => (
                  <div key={item.label} className={cn("text-center p-2 rounded-lg", item.color)}>
                    <div className="text-lg font-bold">{item.value}</div>
                    <div className="text-xs">{item.label}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t border-border">
                <div className="flex items-center gap-1"><Bug className="w-3 h-3" />{asset.total} findings</div>
                <ChevronRight className="w-3 h-3" />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Asset Detail Sheet */}
      <Sheet open={!!selectedAsset} onOpenChange={() => setSelectedAsset(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedAsset && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-muted">{typeIcon(selectedAsset.type)}</div>
                  <div>
                    <SheetTitle className="font-mono">{selectedAsset.name}</SheetTitle>
                    <p className="text-sm text-muted-foreground capitalize">{selectedAsset.type} • {selectedAsset.total} findings</p>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: "Critical", value: selectedAsset.counts.critical, color: "bg-destructive/10 text-destructive" },
                    { label: "High", value: selectedAsset.counts.high, color: "bg-warning/10 text-warning" },
                    { label: "Medium", value: selectedAsset.counts.medium, color: "bg-accent/10 text-accent" },
                    { label: "Low", value: selectedAsset.counts.low, color: "bg-success/10 text-success" },
                  ].map((item) => (
                    <div key={item.label} className={cn("text-center p-3 rounded-lg", item.color)}>
                      <div className="text-xl font-bold">{item.value}</div>
                      <div className="text-xs">{item.label}</div>
                    </div>
                  ))}
                </div>

                <Tabs defaultValue="all">
                  <TabsList>
                    <TabsTrigger value="all">All ({selectedAsset.total})</TabsTrigger>
                    <TabsTrigger value="exploitable">
                      Critical/High ({selectedAsset.counts.critical + selectedAsset.counts.high})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="all" className="mt-4 space-y-2">
                    {selectedAsset.findings.map((vuln) => (
                      <div key={vuln.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                        <SeverityBadge severity={vuln.severity} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{vuln.title}</div>
                          <div className="text-xs text-muted-foreground font-mono">{vuln.cve_id ?? vuln.source_engine}</div>
                        </div>
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="exploitable" className="mt-4 space-y-2">
                    {selectedAsset.findings
                      .filter((v) => v.severity === "critical" || v.severity === "high")
                      .map((vuln) => (
                        <div key={vuln.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                          <SeverityBadge severity={vuln.severity} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{vuln.title}</div>
                            <div className="text-xs text-muted-foreground font-mono">{vuln.cve_id ?? vuln.source_engine}</div>
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
