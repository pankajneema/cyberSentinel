import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Plus,
  Globe,
  Network,
  Radar,
  ChevronRight,
  ChevronDown,
  Trash2,
  RefreshCw,
  Shield,
  MapPin,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { SeverityBadge } from "./SeverityBadge";
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
import { fetchSubdomains, fetchAsmOverview, fetchAssets, type AsmSubdomain, type ApiAsset } from "@/lib/api";
import { fetchSubdomainIPs, getSubdomainDetail, type AsmIP } from "@/lib/services/asm";

interface SubdomainNode {
  id: string;
  name: string;
  type: "asset" | "subdomain" | "ip";
  asset_id?: string;
  risk: "critical" | "high" | "medium" | "low";
  dns?: string;
  hosting?: string;
  ip?: string;
  ip_count?: number;
  status: "active" | "inactive";
  resolved?: boolean | null;  // DNS resolution status
  reachable?: boolean | null;  // HTTP reachability (for IPs)
  children?: SubdomainNode[];
}

function SubdomainNodeComponent({ 
  node, 
  level = 0, 
  onDelete, 
  onRescan,
  assets 
}: { 
  node: SubdomainNode; 
  level?: number; 
  onDelete: (id: string, name: string) => void; 
  onRescan: (name: string) => void;
  assets: ApiAsset[];
}) {
  const [isExpanded, setIsExpanded] = useState(level < 1);
  const [ips, setIps] = useState<AsmIP[]>([]);
  const [loadingIPs, setLoadingIPs] = useState(false);
  const hasChildren = (node.children && node.children.length > 0) || (node.type === "subdomain" && (node.ip_count || 0) > 0);
  
  const loadIPs = async () => {
    if (node.type !== "subdomain" || ips.length > 0) return;
    setLoadingIPs(true);
    try {
      const data = await fetchSubdomainIPs(node.id, 1, 50);
      setIps(data.items || []);
    } catch (e) {
      console.error("Failed to load IPs:", e);
    } finally {
      setLoadingIPs(false);
    }
  };
  
  const handleToggle = () => {
    if (node.type === "subdomain" && !isExpanded && (node.ip_count || 0) > 0) {
      loadIPs();
    }
    setIsExpanded(!isExpanded);
  };

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-3 p-3 hover:bg-muted/50 rounded-xl cursor-pointer transition-all duration-200 group"
        style={{ marginLeft: level * 28 }}
        onClick={() => hasChildren && handleToggle()}
      >
        <div className="w-6 h-6 flex items-center justify-center">
          {hasChildren ? (
            <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </motion.div>
          ) : (
            <div className="w-2 h-2 rounded-full bg-primary/50" />
          )}
        </div>
        <div className={`p-2 rounded-lg ${node.status === "active" ? "bg-primary/10" : "bg-muted"}`}>
          <Globe className={`w-4 h-4 ${node.status === "active" ? "text-primary" : "text-muted-foreground"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground group-hover:text-primary transition-colors">
              {node.type === "ip" 
                ? node.ip || node.name
                : node.type === "asset" 
                ? node.name 
                : (() => {
                    const parentAsset = assets.find(a => a.id === node.asset_id);
                    return parentAsset ? `${node.name}` : node.name;
                  })()
              }
            </span>
            {node.type === "asset" && (
              <span className="text-xs px-2 py-0.5 bg-primary/20 text-primary rounded-full">
                Parent Domain
              </span>
            )}
            {node.type === "subdomain" && node.ip_count !== undefined && node.ip_count > 0 && (
              <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-600 rounded-full">
                {node.ip_count} IP{node.ip_count !== 1 ? 's' : ''}
              </span>
            )}
            {node.type === "subdomain" && node.resolved !== null && node.resolved !== undefined && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                node.resolved 
                  ? "bg-green-500/20 text-green-600" 
                  : "bg-red-500/20 text-red-600"
              }`}>
                {node.resolved ? "Resolved" : "Unresolved"}
              </span>
            )}
            {node.type === "ip" && (
              <span className="text-xs px-2 py-0.5 bg-muted text-muted-foreground rounded-full">
                IP Address
              </span>
            )}
            {node.type === "ip" && node.reachable !== null && node.reachable !== undefined && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                node.reachable 
                  ? "bg-green-500/20 text-green-600" 
                  : "bg-red-500/20 text-red-600"
              }`}>
                {node.reachable ? "Reachable" : "Not Reachable"}
              </span>
            )}
          </div>
        </div>
        <div className="hidden md:flex items-center gap-4">
          {node.dns && (
            <span className="text-xs px-2.5 py-1 bg-muted rounded-lg text-muted-foreground font-mono">
              {node.dns}
            </span>
          )}
          {node.hosting && (
            <span className="text-xs text-muted-foreground w-20">{node.hosting}</span>
          )}
        </div>
        <SeverityBadge severity={node.risk} showDot={false} />
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8" 
            onClick={(e) => { 
              e.stopPropagation(); 
              onRescan(node.name); 
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          {node.type === "subdomain" && (
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8 text-destructive hover:text-destructive" 
              onClick={(e) => { 
                e.stopPropagation(); 
                onDelete(node.id, node.name); 
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </motion.div>
      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }} 
            animate={{ opacity: 1, height: "auto" }} 
            exit={{ opacity: 0, height: 0 }}
          >
            {/* Show subdomain children */}
            {node.children && node.children.length > 0 && node.children.map((child) => (
              <SubdomainNodeComponent 
                key={child.id} 
                node={child} 
                level={level + 1} 
                onDelete={onDelete} 
                onRescan={onRescan}
                assets={assets}
              />
            ))}
            
            {/* Show IPs for subdomain */}
            {node.type === "subdomain" && (
              <div style={{ marginLeft: (level + 1) * 28 }}>
                {loadingIPs ? (
                  <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Loading IPs...
                  </div>
                ) : ips.length > 0 ? (
                  ips.map((ip) => (
                    <SubdomainNodeComponent
                      key={ip.id}
                      node={{
                        id: ip.id,
                        name: ip.ip_address,
                        type: "ip",
                        asset_id: ip.asset_id,
                        risk: ip.exposure_level === "high" ? "high" : ip.exposure_level === "medium" ? "medium" : "low",
                        ip: ip.ip_address,
                        status: ip.status === "active" ? "active" : "inactive",
                        reachable: ip.reachable ?? null,  // HTTP reachability status
                      }}
                      level={level + 1}
                      onDelete={onDelete}
                      onRescan={onRescan}
                      assets={assets}
                    />
                  ))
                ) : node.ip_count === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">
                    No IPs found for this subdomain
                  </div>
                ) : null}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SubdomainDiscovery() {
  const [searchQuery, setSearchQuery] = useState("");
  const [resolvedFilter, setResolvedFilter] = useState<"all" | "resolved" | "unresolved">("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [newSubdomain, setNewSubdomain] = useState("");
  const [parentDomain, setParentDomain] = useState("");
  const [subdomains, setSubdomains] = useState<AsmSubdomain[]>([]);
  const [assets, setAssets] = useState<ApiAsset[]>([]);
  const [totalSubdomainsStat, setTotalSubdomainsStat] = useState<string>("0");
  const [totalIPsStat, setTotalIPsStat] = useState<string>("0");
  const [activeSubdomainsStat, setActiveSubdomainsStat] = useState<string>("0");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Load subdomains with pagination (max 100 per page for performance)
        const res = await fetchSubdomains(undefined, 1, 100);
        if (!cancelled) {
          setSubdomains(res.items || []);
        }
        
        // Load assets (domains) to use as parents
        const assetsRes = await fetchAssets({ type: "domain", page: 1, page_size: 100 });
        if (!cancelled) {
          setAssets(assetsRes.items || []);
        }
        
        // Get accurate counts from overview API
        const overview = await fetchAsmOverview();
        if (!cancelled) {
          setTotalSubdomainsStat(String(overview.asset_counts?.subdomains || 0));
          setTotalIPsStat(String(overview.asset_counts?.ips || 0));
          
          // For active subdomains, we need to count from all subdomains
          // Fetch all subdomains to get accurate active count
          const allSubdomainsRes = await fetchSubdomains(undefined, 1, 1000);
          if (!cancelled) {
            const activeCount = (allSubdomainsRes.items || []).filter(sd => sd.status === "active").length;
            setActiveSubdomainsStat(String(activeCount));
          }
        }
      } catch (e) {
        console.error("Failed to load subdomains", e);
      }
    };
    load();
    return () => { cancelled = true };
  }, []);

  // Build hierarchical structure: assets (domains) as parents, subdomains as children
  const hierarchicalStructure = useMemo(() => {
    const assetMap = new Map<string, SubdomainNode>();
    const subdomainNodes: SubdomainNode[] = [];

    // First, create parent nodes for all domain assets
    assets.forEach((asset) => {
      if (asset.type === "domain") {
        assetMap.set(asset.id, {
          id: asset.id,
          name: asset.name,
          type: "asset",
          asset_id: asset.id,
          risk: asset.risk_score >= 70 ? "critical" : asset.risk_score >= 50 ? "high" : asset.risk_score >= 30 ? "medium" : "low",
          status: asset.status === "active" ? "active" : "inactive",
          children: [],
        });
      }
    });

    // Then, add subdomains as children of their parent assets
    subdomains.forEach((subdomain) => {
      const parentAsset = assetMap.get(subdomain.asset_id);
      const subdomainNode: SubdomainNode = {
        id: subdomain.id,
        name: subdomain.subdomain,
        type: "subdomain",
        asset_id: subdomain.asset_id,
        // No fabricated severity: a bare subdomain is low-signal; real exposure
        // is scored on its resolved IPs/ports separately, not invented here.
        risk: "low" as SubdomainNode["risk"],
        status: (subdomain.status || "active") as "active" | "inactive",
        ip_count: subdomain.ip_count || 0,
        resolved: subdomain.resolved ?? null,  // DNS resolution status
      };

      if (parentAsset) {
        // Add to parent's children
        if (!parentAsset.children) {
          parentAsset.children = [];
        }
        parentAsset.children.push(subdomainNode);
      } else {
        // If parent asset not found, show as standalone
        subdomainNodes.push(subdomainNode);
      }
    });

    // Return all parent assets that have children, plus standalone subdomains
    const result = Array.from(assetMap.values()).filter(asset => 
      asset.children && asset.children.length > 0
    );
    
    return [...result, ...subdomainNodes];
  }, [subdomains, assets]);

  // Filter based on search query and resolved status
  const filteredStructure = useMemo(() => {
    const query = searchQuery.toLowerCase();
    
    const filterNode = (node: SubdomainNode): SubdomainNode | null => {
      // Filter by search query
      const matchesQuery = !query || node.name.toLowerCase().includes(query);
      
      // Filter by resolved status (only for subdomains)
      let matchesResolved = true;
      if (resolvedFilter !== "all" && node.type === "subdomain") {
        if (resolvedFilter === "resolved") {
          matchesResolved = node.resolved === true;
        } else if (resolvedFilter === "unresolved") {
          matchesResolved = node.resolved === false;
        }
      }
      
      // Filter children recursively
      const filteredChildren = node.children
        ? node.children.map(filterNode).filter((n): n is SubdomainNode => n !== null)
        : [];
      
      // Include node if it matches filters OR has matching children
      if ((matchesQuery && matchesResolved) || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren.length > 0 ? filteredChildren : node.children,
        };
      }
      return null;
    };

    return hierarchicalStructure.map(filterNode).filter((n): n is SubdomainNode => n !== null);
  }, [hierarchicalStructure, searchQuery, resolvedFilter]);

  // Subdomains are DISCOVERED by ASM scans, not manually managed — there is no
  // backend endpoint to add/remove/rescan an individual subdomain. These handlers
  // tell the truth instead of showing a fake success for an action that no-ops.
  const handleAddSubdomain = () => {
    toast({
      title: "Not available",
      description: "Subdomains are found automatically by discovery scans. Run a discovery to enumerate them.",
    });
    setIsAddOpen(false);
    setNewSubdomain("");
    setParentDomain("");
  };

  const handleDelete = (id: string, name: string) => setDeleteConfirm({ id, name });
  const confirmDelete = () => {
    if (deleteConfirm) {
      toast({
        title: "Not available",
        description: "Discovered subdomains can't be deleted manually — they reflect real scan results.",
      });
      setDeleteConfirm(null);
    }
  };
  const handleRescan = (name: string) =>
    toast({
      title: "Not available",
      description: `Re-run the discovery for ${name}'s domain to refresh its subdomains.`,
    });

  const domainAssets = assets.filter(a => a.type === "domain");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end" />

      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Total Subdomains", value: totalSubdomainsStat, icon: Globe, color: "bg-primary/10 text-primary" },
          { label: "Total IPs", value: totalIPsStat, icon: Network, color: "bg-blue-500/10 text-blue-600" },
          { label: "Active Subdomains", value: activeSubdomainsStat, icon: Shield, color: "bg-success/10 text-success" },
          { label: "Parent Domains", value: String(domainAssets.length), icon: Network, color: "bg-accent/10 text-accent" },
        ].map((stat, i) => (
          <motion.div 
            key={stat.label} 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: i * 0.1 }} 
            className="bg-card rounded-2xl border border-border p-5 hover:shadow-md transition-all"
          >
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search subdomains or domains..." 
            className="pl-11 h-12 rounded-xl" 
            value={searchQuery} 
            onChange={(e) => setSearchQuery(e.target.value)} 
          />
        </div>
        <Select value={resolvedFilter} onValueChange={(v) => setResolvedFilter(v as "all" | "resolved" | "unresolved")}>
          <SelectTrigger className="w-full sm:w-[200px] h-12 rounded-xl">
            <SelectValue placeholder="Filter by DNS status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Subdomains</SelectItem>
            <SelectItem value="resolved">Resolved Only</SelectItem>
            <SelectItem value="unresolved">Unresolved Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground">Domain Hierarchy</h3>
          </div>
        </div>
        <div className="p-4 space-y-1">
          {filteredStructure.length > 0 ? (
            filteredStructure.map((node) => (
              <SubdomainNodeComponent 
                key={node.id} 
                node={node} 
                onDelete={handleDelete} 
                onRescan={handleRescan}
                assets={assets}
              />
            ))
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? "No results found" : "No subdomains found. Start a discovery to find subdomains."}
            </div>
          )}
        </div>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              Add Subdomain
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Parent Domain</Label>
              <Select value={parentDomain} onValueChange={setParentDomain}>
                <SelectTrigger>
                  <SelectValue placeholder="Select parent domain" />
                </SelectTrigger>
                <SelectContent>
                  {domainAssets.map((asset) => (
                    <SelectItem key={asset.id} value={asset.id}>
                      {asset.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Subdomain</Label>
              <Input 
                placeholder="e.g., staging" 
                value={newSubdomain} 
                onChange={(e) => setNewSubdomain(e.target.value)} 
              />
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button variant="gradient" onClick={handleAddSubdomain}>
                Add Subdomain
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Subdomain?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <span className="font-mono font-semibold">{deleteConfirm?.name}</span>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
