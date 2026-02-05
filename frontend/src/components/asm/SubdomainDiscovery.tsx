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
  Download,
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

interface SubdomainNode {
  id: string;
  name: string;
  type: "asset" | "subdomain";
  asset_id?: string;
  risk: "critical" | "high" | "medium" | "low";
  dns?: string;
  hosting?: string;
  ip?: string;
  status: "active" | "inactive";
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
  const [isExpanded, setIsExpanded] = useState(level < 2);
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex items-center gap-3 p-3 hover:bg-muted/50 rounded-xl cursor-pointer transition-all duration-200 group"
        style={{ marginLeft: level * 28 }}
        onClick={() => hasChildren && setIsExpanded(!isExpanded)}
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
              {node.type === "asset" 
                ? node.name 
                : (() => {
                    const parentAsset = assets.find(a => a.id === node.asset_id);
                    return parentAsset ? `${node.name}.${parentAsset.name}` : node.name;
                  })()
              }
            </span>
            {node.type === "asset" && (
              <span className="text-xs px-2 py-0.5 bg-primary/20 text-primary rounded-full">
                Parent Domain
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
        {isExpanded && hasChildren && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }} 
            animate={{ opacity: 1, height: "auto" }} 
            exit={{ opacity: 0, height: 0 }}
          >
            {node.children?.map((child) => (
              <SubdomainNodeComponent 
                key={child.id} 
                node={child} 
                level={level + 1} 
                onDelete={onDelete} 
                onRescan={onRescan}
                assets={assets}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SubdomainDiscovery() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [newSubdomain, setNewSubdomain] = useState("");
  const [parentDomain, setParentDomain] = useState("");
  const [subdomains, setSubdomains] = useState<AsmSubdomain[]>([]);
  const [assets, setAssets] = useState<ApiAsset[]>([]);
  const [totalSubdomainsStat, setTotalSubdomainsStat] = useState<string>("0");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // Load all subdomains
        const res = await fetchSubdomains(undefined, 1, 1000);
        if (!cancelled) {
          setSubdomains(res.items || []);
        }
        
        // Load assets (domains) to use as parents
        const assetsRes = await fetchAssets({ type: "domain", page: 1, page_size: 1000 });
        if (!cancelled) {
          setAssets(assetsRes.items || []);
        }
        
        const overview = await fetchAsmOverview();
        if (!cancelled) setTotalSubdomainsStat(String(overview.asset_counts?.subdomains || 0));
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
        risk: "medium", // Default risk, can be enhanced later
        status: "active",
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

  // Filter based on search query
  const filteredStructure = useMemo(() => {
    if (!searchQuery) return hierarchicalStructure;
    
    const query = searchQuery.toLowerCase();
    const filterNode = (node: SubdomainNode): SubdomainNode | null => {
      const matches = node.name.toLowerCase().includes(query);
      const filteredChildren = node.children
        ? node.children.map(filterNode).filter((n): n is SubdomainNode => n !== null)
        : [];
      
      if (matches || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren.length > 0 ? filteredChildren : node.children,
        };
      }
      return null;
    };

    return hierarchicalStructure.map(filterNode).filter((n): n is SubdomainNode => n !== null);
  }, [hierarchicalStructure, searchQuery]);

  const handleAddSubdomain = () => {
    if (!newSubdomain || !parentDomain) {
      toast({ title: "Error", description: "Please enter subdomain and select parent domain", variant: "destructive" });
      return;
    }
    toast({ title: "Subdomain Added", description: `${newSubdomain} has been added under ${parentDomain}` });
    setIsAddOpen(false);
    setNewSubdomain("");
    setParentDomain("");
  };

  const handleDelete = (id: string, name: string) => setDeleteConfirm({ id, name });
  const confirmDelete = () => { 
    if (deleteConfirm) { 
      toast({ title: "Subdomain Removed", description: `${deleteConfirm.name} has been removed` }); 
      setDeleteConfirm(null); 
    } 
  };
  const handleRescan = (name: string) => toast({ title: "Re-scanning", description: `Scanning ${name}...` });

  const domainAssets = assets.filter(a => a.type === "domain");

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            Subdomain Discovery
          </h2>
          <p className="text-sm text-muted-foreground">
            Explore your domain hierarchy - subdomains are linked to parent domains from Asset Inventory
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button variant="gradient" onClick={() => setIsAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Subdomain
          </Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        {[
          { label: "Total Subdomains", value: totalSubdomainsStat, icon: Globe, color: "bg-primary/10 text-primary" },
          { label: "Active", value: String(subdomains.length), icon: Shield, color: "bg-success/10 text-success" },
          { label: "Parent Domains", value: String(domainAssets.length), icon: Network, color: "bg-accent/10 text-accent" },
          { label: "New This Week", value: "0", icon: Plus, color: "bg-accent/10 text-accent" },
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

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input 
          placeholder="Search subdomains or domains..." 
          className="pl-11 h-12 rounded-xl" 
          value={searchQuery} 
          onChange={(e) => setSearchQuery(e.target.value)} 
        />
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
