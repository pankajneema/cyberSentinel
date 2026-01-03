import { useState } from "react";
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

interface Subdomain {
  id: number;
  name: string;
  risk: "critical" | "high" | "medium" | "low";
  dns: string;
  hosting: string;
  ip: string;
  status: "active" | "inactive";
  parentDomain: string;
  children?: Subdomain[];
}

const subdomains: Subdomain[] = [
  {
    id: 1,
    name: "company.com",
    risk: "medium",
    dns: "A",
    hosting: "AWS",
    ip: "52.84.123.45",
    status: "active",
    parentDomain: "",
    children: [
      { id: 2, name: "api.company.com", risk: "high", dns: "A", hosting: "AWS", ip: "52.84.123.46", status: "active", parentDomain: "company.com" },
      { id: 5, name: "app.company.com", risk: "medium", dns: "A", hosting: "Cloudflare", ip: "104.26.10.5", status: "active", parentDomain: "company.com" },
      { id: 7, name: "mail.company.com", risk: "critical", dns: "MX", hosting: "Google", ip: "142.250.185.5", status: "active", parentDomain: "company.com" },
      { id: 8, name: "cdn.company.com", risk: "low", dns: "CNAME", hosting: "Cloudflare", ip: "104.26.10.6", status: "active", parentDomain: "company.com" },
    ],
  },
];

function SubdomainNode({ subdomain, level = 0, onDelete, onRescan }: { subdomain: Subdomain; level?: number; onDelete: (id: number, name: string) => void; onRescan: (name: string) => void; }) {
  const [isExpanded, setIsExpanded] = useState(level < 2);
  const hasChildren = subdomain.children && subdomain.children.length > 0;

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
        <div className={`p-2 rounded-lg ${subdomain.status === "active" ? "bg-primary/10" : "bg-muted"}`}>
          <Globe className={`w-4 h-4 ${subdomain.status === "active" ? "text-primary" : "text-muted-foreground"}`} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="font-medium text-foreground group-hover:text-primary transition-colors">{subdomain.name}</span>
        </div>
        <div className="hidden md:flex items-center gap-4">
          <span className="text-xs px-2.5 py-1 bg-muted rounded-lg text-muted-foreground font-mono">{subdomain.dns}</span>
          <span className="text-xs text-muted-foreground w-20">{subdomain.hosting}</span>
        </div>
        <SeverityBadge severity={subdomain.risk} showDot={false} />
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); onRescan(subdomain.name); }}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(subdomain.id, subdomain.name); }}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </motion.div>
      <AnimatePresence>
        {isExpanded && hasChildren && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {subdomain.children?.map((child) => (
              <SubdomainNode key={child.id} subdomain={child} level={level + 1} onDelete={onDelete} onRescan={onRescan} />
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
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);
  const [newSubdomain, setNewSubdomain] = useState("");
  const [parentDomain, setParentDomain] = useState("");
  const [isScanning, setIsScanning] = useState(false);

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

  const handleDelete = (id: number, name: string) => setDeleteConfirm({ id, name });
  const confirmDelete = () => { if (deleteConfirm) { toast({ title: "Subdomain Removed", description: `${deleteConfirm.name} has been removed` }); setDeleteConfirm(null); } };
  const handleRescan = (name: string) => toast({ title: "Re-scanning", description: `Scanning ${name}...` });
  const handleFullScan = () => { setIsScanning(true); toast({ title: "Discovery Started", description: "Scanning all subdomains..." }); setTimeout(() => setIsScanning(false), 3000); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2"><Network className="w-5 h-5 text-primary" />Subdomain Discovery</h2>
          <p className="text-sm text-muted-foreground">Explore your domain hierarchy - subdomains are linked to parent domains from Asset Inventory</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" disabled={isScanning} onClick={handleFullScan}><Radar className={`w-4 h-4 mr-2 ${isScanning ? "animate-spin" : ""}`} />{isScanning ? "Scanning..." : "Discover All"}</Button>
          <Button variant="outline"><Download className="w-4 h-4 mr-2" />Export</Button>
          <Button variant="gradient" onClick={() => setIsAddOpen(true)}><Plus className="w-4 h-4 mr-2" />Add Subdomain</Button>
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-4">
        {[{ label: "Total Subdomains", value: "127", icon: Globe, color: "bg-primary/10 text-primary" }, { label: "Active", value: "118", icon: Shield, color: "bg-success/10 text-success" }, { label: "Critical Risk", value: "8", icon: Network, color: "bg-destructive/10 text-destructive" }, { label: "New This Week", value: "12", icon: Plus, color: "bg-accent/10 text-accent" }].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="bg-card rounded-2xl border border-border p-5 hover:shadow-md transition-all">
            <div className="flex items-center gap-4"><div className={`p-3 rounded-xl ${stat.color}`}><stat.icon className="w-5 h-5" /></div><div><div className="text-2xl font-bold text-foreground">{stat.value}</div><div className="text-xs text-muted-foreground">{stat.label}</div></div></div>
          </motion.div>
        ))}
      </div>

      <div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><Input placeholder="Search subdomains..." className="pl-11 h-12 rounded-xl" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>

      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30"><div className="flex items-center gap-2"><Globe className="w-5 h-5 text-primary" /><h3 className="font-semibold text-foreground">Domain Hierarchy</h3></div></div>
        <div className="p-4 space-y-1">{subdomains.map((subdomain) => (<SubdomainNode key={subdomain.id} subdomain={subdomain} onDelete={handleDelete} onRescan={handleRescan} />))}</div>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="w-5 h-5 text-primary" />Add Subdomain</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Parent Domain</Label>
              <Select value={parentDomain} onValueChange={setParentDomain}><SelectTrigger><SelectValue placeholder="Select parent domain" /></SelectTrigger><SelectContent><SelectItem value="company.com">company.com</SelectItem><SelectItem value="api.company.com">api.company.com</SelectItem><SelectItem value="app.company.com">app.company.com</SelectItem></SelectContent></Select>
            </div>
            <div className="space-y-2"><Label>Subdomain</Label><Input placeholder="e.g., staging" value={newSubdomain} onChange={(e) => setNewSubdomain(e.target.value)} /></div>
            <div className="flex justify-end gap-3 pt-4"><Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button><Button variant="gradient" onClick={handleAddSubdomain}>Add Subdomain</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove Subdomain?</AlertDialogTitle><AlertDialogDescription>Are you sure you want to remove <span className="font-mono font-semibold">{deleteConfirm?.name}</span>?</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}