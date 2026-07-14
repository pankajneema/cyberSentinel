import { useEffect, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SeverityBadge } from "./SeverityBadge";
import { EmptyState } from "./EmptyState";
import {
  Search,
  Download,
  Plus,
  MoreHorizontal,
  Globe,
  Server,
  Cloud,
  Code,
  Box,
  Trash2,
  Edit,
  Eye,
  Tag,
  RefreshCw,
  X,
  Users,
  Shield,
  Upload,
  FileText,
  CheckCircle2,
  Copy,
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
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { motion, AnimatePresence } from "framer-motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  type ApiAsset,
  type AssetListParams,
  type CreateAssetPayload,
  type UpdateAssetPayload,
} from "@/lib/api";
import { useMe } from "@/hooks/useMe";
import { exportRowsToCsv } from "@/lib/csv";
import {
  importAssets,
  parseAssetsCsv,
  rescoreAsset,
  getVerificationToken,
  verifyOwnership,
  type RescoreResult,
  type VerificationToken,
} from "@/lib/services/assets";

const typeIcons: Record<string, typeof Globe> = {
  domain: Globe,
  ip: Server,
  cloud: Cloud,
  repo: Code,
  saas: Box,
  user: Users,
};

const assetTypes = [
  { value: "domain", label: "Domain", icon: Globe, description: "Add domain names (e.g., example.com)" },
  { value: "ip", label: "IP Address", icon: Server, description: "Add IP addresses or CIDR ranges" },
  { value: "cloud", label: "Cloud Asset", icon: Cloud, description: "AWS, Azure, GCP resources" },
  { value: "repo", label: "Repository", icon: Code, description: "GitHub, GitLab, Bitbucket repos" },
  { value: "saas", label: "SaaS App", icon: Box, description: "Third-party SaaS applications" },
  { value: "user", label: "User Account", icon: Users, description: "Employee or service accounts" },
];

export function AssetInventory() {
  const [searchQuery, setSearchQuery] = useState("");
  const [assets, setAssets] = useState<ApiAsset[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<ApiAsset | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [exposureFilter, setExposureFilter] = useState("all");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isTagOpen, setIsTagOpen] = useState(false);
  const [bulkTags, setBulkTags] = useState("");
  const [rescoringId, setRescoringId] = useState<string | null>(null);
  // Cache of the latest score breakdown per asset (for the detail sheet "why").
  const [scoreBreakdown, setScoreBreakdown] = useState<Record<string, RescoreResult>>({});

  // ---- ownership verification (authorization-to-scan gate) ----
  const [verifyAsset, setVerifyAsset] = useState<ApiAsset | null>(null);
  const [verifyToken, setVerifyToken] = useState<VerificationToken | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);      // generating the token
  const [verifySubmitting, setVerifySubmitting] = useState(false); // checking / attesting

  const openVerify = async (asset: ApiAsset) => {
    setVerifyAsset(asset);
    setVerifyToken(null);
    setVerifyLoading(true);
    try {
      setVerifyToken(await getVerificationToken(asset.id));
    } catch (e: any) {
      toast({ title: "Couldn't start verification", description: e?.message ?? "Please try again.", variant: "destructive" });
      setVerifyAsset(null);
    } finally {
      setVerifyLoading(false);
    }
  };

  const submitVerify = async () => {
    if (!verifyAsset) return;
    setVerifySubmitting(true);
    try {
      const res = await verifyOwnership(verifyAsset.id);
      if (res.ownership_verified) {
        setAssets((prev) => prev.map((a) => (a.id === verifyAsset.id ? { ...a, ownership_verified: true } : a)));
        setSelectedAsset((s) => (s && s.id === verifyAsset.id ? { ...s, ownership_verified: true } : s));
        toast({ title: "Ownership verified", description: `${verifyAsset.name} can now be scanned at any intensity.` });
        setVerifyAsset(null);
        setVerifyToken(null);
      }
    } catch (e: any) {
      toast({
        title: "Not verified yet",
        description: e?.message ?? "Add the DNS TXT record, wait for propagation, then try again.",
        variant: "destructive",
      });
    } finally {
      setVerifySubmitting(false);
    }
  };

  // While the verify modal is open for a domain, auto-poll so the badge flips the
  // moment DNS propagates — no manual "check again". (The server also re-checks in
  // the background, so it verifies even if the customer closes the tab.)
  useEffect(() => {
    if (!verifyAsset || verifyAsset.type !== "domain" || !verifyToken) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await verifyOwnership(verifyAsset.id);
        if (!cancelled && res.ownership_verified) {
          setAssets((prev) => prev.map((a) => (a.id === verifyAsset.id ? { ...a, ownership_verified: true } : a)));
          setSelectedAsset((s) => (s && s.id === verifyAsset.id ? { ...s, ownership_verified: true } : s));
          toast({ title: "Ownership verified", description: `${verifyAsset.name} can now be scanned at any intensity.` });
          setVerifyAsset(null);
          setVerifyToken(null);
        }
      } catch {
        /* not propagated yet — keep polling silently */
      }
    };
    const id = setInterval(check, 12000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyAsset, verifyToken]);

  const handleCsvFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to import assets." });
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseAssetsCsv(text);
      if (rows.length === 0) {
        toast({ title: "Empty file", description: "No valid rows found in the CSV." });
        return;
      }
      const res = await importAssets(rows);
      toast({
        title: "Import complete",
        description: `${res.created} added, ${res.skipped} skipped${res.errors.length ? `, ${res.errors.length} error(s)` : ""}.`,
      });
      // Refresh the list to show the imported assets.
      try {
        const data = await fetchAssets({ page_size: 200 });
        setAssets(data.items);
      } catch { /* list will refresh on next navigation */ }
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : "Please try again." });
    } finally {
      setImporting(false);
    }
  };
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [selectedAssetType, setSelectedAssetType] = useState<string | null>(null);
  const [newAsset, setNewAsset] = useState({
    name: "",
    type: "" as ApiAsset["type"] | "",
    exposure: "public" as ApiAsset["exposure"],
    criticality: "normal" as NonNullable<ApiAsset["criticality"]>,
    tags: "",
    description: "",
    bulkInput: "",
    department: "",
    accessLevel: "",
    cloudProvider: "",
  });
  const [editForm, setEditForm] = useState<UpdateAssetPayload>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { canWrite } = useMe();

  const debouncedSearch = useDebouncedValue(searchQuery);

  // Fetch assets with filters
  useEffect(() => {
    const controller = new AbortController();
    
    const loadAssets = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);

        const params: AssetListParams = {
          q: debouncedSearch || undefined,
          type: typeFilter !== "all" ? typeFilter : undefined,
          exposure: exposureFilter !== "all" ? exposureFilter : undefined,
        };

        const data = await fetchAssets(params);
        setAssets(data.items);
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Failed to load assets:", err);
          setLoadError(err.message || "Failed to load assets");
          toast({
            title: "Error loading assets",
            description: err.message || "Could not fetch assets from server",
            variant: "destructive",
          });
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadAssets();
    return () => controller.abort();
  }, [debouncedSearch, typeFilter, exposureFilter]);

  const filteredAssets = assets;

  const toggleSelectAll = () => {
    if (selectedAssets.length === filteredAssets.length) {
      setSelectedAssets([]);
    } else {
      setSelectedAssets(filteredAssets.map((a) => a.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedAssets((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Business-criticality badge colors (mirrors the exposure badge styling).
  const criticalityBadgeClass = (c: ApiAsset["criticality"]) => {
    switch (c ?? "normal") {
      case "critical": return "bg-destructive/10 text-destructive";
      case "high": return "bg-warning/10 text-warning";
      case "low": return "bg-muted text-muted-foreground";
      default: return "bg-primary/10 text-primary"; // normal
    }
  };

  const getSeverity = (risk: number) => {
    if (risk >= 80) return "critical";
    if (risk >= 60) return "high";
    if (risk >= 40) return "medium";
    return "low";
  };

  const handleAddAsset = async () => {
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to add assets." });
      return;
    }
    if (!newAsset.name && !newAsset.bulkInput) {
      toast({ 
        title: "Validation Error", 
        description: "Please enter asset details", 
        variant: "destructive" 
      });
      return;
    }

    if (!selectedAssetType) {
      toast({ 
        title: "Validation Error", 
        description: "Please select an asset type", 
        variant: "destructive" 
      });
      return;
    }

    setIsSubmitting(true);

    // Build tags from the free-text field plus any type-specific selections so
    // none of the entered context (provider/department/access) is dropped.
    const buildTags = () => {
      const base = newAsset.tags
        ? newAsset.tags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];
      const extra: string[] = [];
      if (selectedAssetType === "cloud" && newAsset.cloudProvider) extra.push(newAsset.cloudProvider);
      if (selectedAssetType === "user" && newAsset.department) extra.push(newAsset.department);
      if (selectedAssetType === "user" && newAsset.accessLevel) extra.push(`access:${newAsset.accessLevel}`);
      return Array.from(new Set([...base, ...extra]));
    };
    const description = newAsset.description.trim() || undefined;

    try {
      if (newAsset.name) {
        const payload: CreateAssetPayload = {
          name: newAsset.name.trim(),
          type: selectedAssetType as ApiAsset["type"],
          exposure: newAsset.exposure,
          criticality: newAsset.criticality,
          tags: buildTags(),
          description,
        };

        const createdAsset = await createAsset(payload);

        setAssets((prev) => [createdAsset, ...prev]);
        
        toast({
          title: "Asset Added",
          description: `${createdAsset.name} has been added successfully`,
        });
      } else if (newAsset.bulkInput) {
        const lines = newAsset.bulkInput.split("\n").filter((l) => l.trim());
        let successCount = 0;
        let failCount = 0;

        for (const line of lines) {
          try {
            const payload: CreateAssetPayload = {
              name: line.trim(),
              type: selectedAssetType as ApiAsset["type"],
              exposure: newAsset.exposure,
              criticality: newAsset.criticality,
              tags: buildTags(),
              description,
            };

            const createdAsset = await createAsset(payload);
            setAssets((prev) => [createdAsset, ...prev]);
            successCount++;
          } catch (err) {
            console.error(`Failed to add ${line}:`, err);
            failCount++;
          }
        }

        toast({
          title: "Bulk Import Complete",
          description: `${successCount} asset${successCount !== 1 ? "s" : ""} added successfully${failCount > 0 ? `, ${failCount} failed` : ""}`,
          variant: failCount > 0 ? "destructive" : "default",
        });
      }

      // Reset form
      setIsAddOpen(false);
      setSelectedAssetType(null);
      setNewAsset({
        name: "",
        type: "",
        exposure: "public",
        criticality: "normal",
        tags: "",
        description: "",
        bulkInput: "",
        department: "",
        accessLevel: "",
        cloudProvider: "",
      });
    } catch (err: any) {
      console.error("Failed to add asset:", err);
      toast({
        title: "Error adding asset",
        description: err.message || "Failed to add asset to inventory",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateAsset = async () => {
    if (!selectedAsset) return;
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to edit assets." });
      return;
    }

    setIsSubmitting(true);

    try {
      const payload: UpdateAssetPayload = {
        name: editForm.name?.trim(),
        exposure: editForm.exposure,
        criticality: editForm.criticality,
        tags: editForm.tags,
        status: editForm.status,
      };

      const updatedAsset = await updateAsset(selectedAsset.id, payload);
      
      setAssets((prev) =>
        prev.map((a) => (a.id === updatedAsset.id ? updatedAsset : a))
      );
      
      setSelectedAsset(updatedAsset);
      
      toast({
        title: "Asset Updated",
        description: `${updatedAsset.name} has been updated successfully`,
      });
      
      setIsEditOpen(false);
      setEditForm({});
    } catch (err: any) {
      console.error("Failed to update asset:", err);
      toast({
        title: "Error updating asset",
        description: err.message || "Failed to update asset",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to delete assets." });
      return;
    }

    setIsSubmitting(true);

    try {
      await deleteAsset(deleteConfirm.id);
      
      setAssets((prev) => prev.filter((a) => a.id !== deleteConfirm.id));
      
      toast({ 
        title: "Asset Deleted", 
        description: `${deleteConfirm.name} has been removed from inventory` 
      });
      
      setDeleteConfirm(null);
      
      if (selectedAsset?.id === deleteConfirm.id) {
        setSelectedAsset(null);
      }
    } catch (err: any) {
      console.error("Failed to delete asset:", err);
      toast({
        title: "Error deleting asset",
        description: err.message || "Failed to delete asset",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedAssets.length === 0) return;
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to delete assets." });
      return;
    }

    setIsSubmitting(true);
    let successCount = 0;
    let failCount = 0;

    try {
      for (const assetId of selectedAssets) {
        try {
          await deleteAsset(assetId);
          successCount++;
        } catch (err) {
          console.error(`Failed to delete asset ${assetId}:`, err);
          failCount++;
        }
      }

      setAssets((prev) => prev.filter((a) => !selectedAssets.includes(a.id)));
      setSelectedAssets([]);

      toast({
        title: "Bulk Delete Complete",
        description: `${successCount} asset${successCount !== 1 ? "s" : ""} deleted${failCount > 0 ? `, ${failCount} failed` : ""}`,
        variant: failCount > 0 ? "destructive" : "default",
      });
    } catch (err: any) {
      console.error("Bulk delete error:", err);
      toast({
        title: "Error during bulk delete",
        description: err.message || "Some assets could not be deleted",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Export the currently filtered assets to a CSV file (client-side download).
  const handleExport = () => {
    if (filteredAssets.length === 0) {
      toast({ title: "Nothing to export", description: "No assets match the current filters." });
      return;
    }
    const rows = filteredAssets.map((a) => ({
      name: a.name,
      type: a.type,
      exposure: a.exposure,
      risk_score: a.risk_score == null ? "unscanned" : a.risk_score,
      status: a.status ?? "",
      tags: (a.tags || []).join("|"),
      last_seen: a.last_seen ?? "",
    }));
    exportRowsToCsv(rows, `assets-${new Date().toISOString().slice(0, 10)}.csv`);
    toast({ title: "Exported", description: `${filteredAssets.length} asset(s) exported to CSV.` });
  };

  // Apply tags to all selected assets (merged with existing, de-duplicated).
  const handleBulkTag = async () => {
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to tag assets." });
      return;
    }
    const tags = bulkTags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length === 0) {
      toast({ title: "No tags", description: "Enter one or more comma-separated tags." });
      return;
    }
    setIsSubmitting(true);
    let ok = 0;
    let failed = 0;
    const updates: ApiAsset[] = [];
    for (const id of selectedAssets) {
      const current = assets.find((a) => a.id === id);
      if (!current) continue;
      const merged = Array.from(new Set([...(current.tags || []), ...tags]));
      try {
        const updated = await updateAsset(id, { tags: merged });
        updates.push(updated);
        ok++;
      } catch (err) {
        console.error(`Failed to tag ${id}:`, err);
        failed++;
      }
    }
    if (updates.length) {
      setAssets((prev) => prev.map((a) => updates.find((u) => u.id === a.id) ?? a));
    }
    setIsSubmitting(false);
    setIsTagOpen(false);
    setBulkTags("");
    setSelectedAssets([]);
    toast({
      title: "Tags applied",
      description: `${ok} asset(s) tagged${failed ? `, ${failed} failed` : ""}.`,
      variant: failed ? "destructive" : "default",
    });
  };

  // Recompute an asset's exposure score from real ASM scan data.
  const handleRescore = async (asset: ApiAsset) => {
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to rescan assets." });
      return;
    }
    setRescoringId(asset.id);
    try {
      const res = await rescoreAsset(asset.id);
      if (!res.scored) {
        toast({
          title: "No scan data yet",
          description: res.message || "Run an ASM discovery against this asset first.",
        });
        return;
      }
      setScoreBreakdown((prev) => ({ ...prev, [asset.id]: res }));
      setAssets((prev) =>
        prev.map((a) => (a.id === asset.id ? { ...a, risk_score: res.risk_score } : a))
      );
      setSelectedAsset((prev) =>
        prev && prev.id === asset.id ? { ...prev, risk_score: res.risk_score } : prev
      );
      toast({
        title: "Exposure rescored",
        description: `${asset.name}: ${res.risk_score}/100 (${res.severity}) from ${res.matched_ips.length} IP(s).`,
      });
    } catch (err: any) {
      toast({ title: "Rescore failed", description: err.message || "Please try again.", variant: "destructive" });
    } finally {
      setRescoringId(null);
    }
  };

  const openEditDialog = (asset: ApiAsset) => {
    if (!canWrite) {
      toast({ title: "Read-only access", description: "You don't have permission to edit assets." });
      return;
    }
    setSelectedAsset(asset);
    setEditForm({
      name: asset.name,
      exposure: asset.exposure,
      criticality: asset.criticality ?? "normal",
      tags: asset.tags,
      status: asset.status,
    });
    setIsEditOpen(true);
  };

  const renderAssetTypeForm = () => {
    const type = assetTypes.find(t => t.value === selectedAssetType);
    if (!type) return null;

    const Icon = type.icon;

    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-6"
      >
        <div className="flex items-center gap-3 p-4 bg-primary/5 rounded-xl border border-primary/20">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Icon className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h4 className="font-medium text-foreground">{type.label}</h4>
            <p className="text-sm text-muted-foreground">{type.description}</p>
          </div>
        </div>

        <Tabs defaultValue="single" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single">Single Entry</TabsTrigger>
            <TabsTrigger value="bulk">Bulk Import</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>
                {selectedAssetType === "ip" ? "IP Address / CIDR Range" :
                 selectedAssetType === "domain" ? "Domain Name" :
                 selectedAssetType === "user" ? "Email / Username" :
                 "Asset Name"}
              </Label>
              <Input
                placeholder={
                  selectedAssetType === "ip" ? "e.g., 192.168.1.1 or 10.0.0.0/24" :
                  selectedAssetType === "domain" ? "e.g., api.company.com" :
                  selectedAssetType === "user" ? "e.g., john@company.com" :
                  "Enter asset name"
                }
                value={newAsset.name}
                onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
              />
            </div>

            {selectedAssetType === "user" && (
              <>
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Select value={newAsset.department} onValueChange={(v) => setNewAsset({ ...newAsset, department: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="engineering">Engineering</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="marketing">Marketing</SelectItem>
                      <SelectItem value="hr">HR</SelectItem>
                      <SelectItem value="finance">Finance</SelectItem>
                      <SelectItem value="it">IT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Access Level</Label>
                  <Select value={newAsset.accessLevel} onValueChange={(v) => setNewAsset({ ...newAsset, accessLevel: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select access level" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="standard">Standard User</SelectItem>
                      <SelectItem value="limited">Limited Access</SelectItem>
                      <SelectItem value="guest">Guest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {selectedAssetType === "cloud" && (
              <div className="space-y-2">
                <Label>Cloud Provider</Label>
                <Select value={newAsset.cloudProvider} onValueChange={(v) => setNewAsset({ ...newAsset, cloudProvider: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aws">Amazon Web Services</SelectItem>
                    <SelectItem value="azure">Microsoft Azure</SelectItem>
                    <SelectItem value="gcp">Google Cloud Platform</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Exposure</Label>
              <Select 
                value={newAsset.exposure} 
                onValueChange={(value: ApiAsset["exposure"]) => setNewAsset({ ...newAsset, exposure: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public (Internet-facing)</SelectItem>
                  <SelectItem value="internal">Internal (Private network)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Criticality</Label>
              <Select
                value={newAsset.criticality}
                onValueChange={(value: NonNullable<ApiAsset["criticality"]>) => setNewAsset({ ...newAsset, criticality: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tags (comma-separated)</Label>
              <Input
                placeholder="e.g., production, critical, api"
                value={newAsset.tags}
                onChange={(e) => setNewAsset({ ...newAsset, tags: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea
                placeholder="Add notes about this asset..."
                value={newAsset.description}
                onChange={(e) => setNewAsset({ ...newAsset, description: e.target.value })}
                rows={3}
              />
            </div>
          </TabsContent>

          <TabsContent value="bulk" className="space-y-4 mt-4">
            <div className="p-4 bg-muted/30 rounded-xl border border-dashed border-border">
              <div className="flex items-center gap-3 mb-3">
                <Upload className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">Bulk Import</span>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Enter one {selectedAssetType === "ip" ? "IP/CIDR" : selectedAssetType === "domain" ? "domain" : "asset"} per line
              </p>
              <Textarea
                placeholder={
                  selectedAssetType === "ip" 
                    ? "192.168.1.1\n192.168.1.2\n10.0.0.0/24" 
                    : selectedAssetType === "domain"
                    ? "api.company.com\nmail.company.com\nstaging.company.com"
                    : "Enter assets, one per line..."
                }
                value={newAsset.bulkInput}
                onChange={(e) => setNewAsset({ ...newAsset, bulkInput: e.target.value })}
                rows={8}
                className="font-mono text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={importing}
                onClick={() => { setIsAddOpen(false); fileInputRef.current?.click(); }}
              >
                <FileText className="w-4 h-4" />
                {importing ? "Importing…" : "Upload CSV"}
              </Button>
              <span className="text-xs text-muted-foreground">or paste directly above</span>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex gap-3 pt-4 border-t border-border">
          <Button 
            variant="outline" 
            className="flex-1" 
            onClick={() => setSelectedAssetType(null)}
            disabled={isSubmitting}
          >
            Back
          </Button>
          <Button 
            variant="gradient" 
            className="flex-1" 
            onClick={handleAddAsset}
            disabled={isSubmitting}
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {isSubmitting ? "Adding..." : `Add Asset${newAsset.bulkInput ? "s" : ""}`}
          </Button>
        </div>
      </motion.div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Assets", value: assets.length },
          { label: "Domains", value: assets.filter(a => a.type === "domain").length },
          { label: "IPs", value: assets.filter(a => a.type === "ip").length },
          { label: "Cloud", value: assets.filter(a => a.type === "cloud").length },
        ].map((stat) => (
          <div key={stat.label} className="bg-card rounded-xl border border-border px-4 py-3">
            <div className="text-xs text-muted-foreground">{stat.label}</div>
            <div className="text-lg font-semibold text-foreground">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search assets by name, IP, domain..."
            className="pl-11 h-11 rounded-xl"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[140px] h-11 rounded-xl">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="domain">Domain</SelectItem>
              <SelectItem value="ip">IP Address</SelectItem>
              <SelectItem value="cloud">Cloud</SelectItem>
              <SelectItem value="repo">Repository</SelectItem>
              <SelectItem value="saas">SaaS</SelectItem>
              <SelectItem value="user">User</SelectItem>
            </SelectContent>
          </Select>
          <Select value={exposureFilter} onValueChange={setExposureFilter}>
            <SelectTrigger className="w-[140px] h-11 rounded-xl">
              <SelectValue placeholder="Exposure" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Exposure</SelectItem>
              <SelectItem value="public">Public</SelectItem>
              <SelectItem value="internal">Internal</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          {canWrite && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleCsvFile}
              />
              <Button
                variant="outline"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                title="CSV columns: name,type,exposure,tags,description"
              >
                <Upload className="w-4 h-4 mr-2" />
                {importing ? "Importing…" : "Import CSV"}
              </Button>
            </>
          )}
          {canWrite && (
            <Button variant="gradient" onClick={() => setIsAddOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Asset
            </Button>
          )}
        </div>
      </div>

      {/* Bulk Actions */}
      <AnimatePresence>
        {canWrite && selectedAssets.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-3 p-4 bg-primary/5 border border-primary/20 rounded-xl"
          >
            <span className="text-sm font-medium text-foreground">
              {selectedAssets.length} selected
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsTagOpen(true)}>
                <Tag className="w-4 h-4 mr-1" />
                Tag
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleBulkDelete}
                disabled={isSubmitting}
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelectedAssets([])}>
              <X className="w-4 h-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
        {loadError && (
          <div className="p-4 text-sm text-destructive border-b border-border">
            {loadError}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr className="text-left text-sm text-muted-foreground">
                <th className="p-4 font-medium">
                  <Checkbox
                    checked={selectedAssets.length === filteredAssets.length && filteredAssets.length > 0}
                    onCheckedChange={canWrite ? toggleSelectAll : undefined}
                    disabled={!canWrite}
                  />
                </th>
                <th className="p-4 font-medium">Asset Name</th>
                <th className="p-4 font-medium">Type</th>
                <th className="p-4 font-medium">Exposure</th>
                <th className="p-4 font-medium">Criticality</th>
                <th className="p-4 font-medium">Risk Score</th>
                <th className="p-4 font-medium">Tags</th>
                <th className="p-4 font-medium">Last Seen</th>
                <th className="p-4 font-medium">Verified</th>
                <th className="p-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredAssets.map((asset) => {
                const TypeIcon = typeIcons[asset.type] || Server;
                return (
                  <motion.tr
                    key={asset.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-t border-border hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedAsset(asset)}
                  >
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedAssets.includes(asset.id)}
                        onCheckedChange={canWrite ? () => toggleSelect(asset.id) : undefined}
                        disabled={!canWrite}
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                          <TypeIcon className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{asset.name}</div>
                          <div className="text-xs text-muted-foreground capitalize">{asset.type}</div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="capitalize text-sm text-muted-foreground">{asset.type}</span>
                    </td>
                    <td className="p-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        asset.exposure === "public" 
                          ? "bg-warning/10 text-warning" 
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {asset.exposure}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`capitalize text-xs px-2.5 py-1 rounded-full font-medium ${criticalityBadgeClass(asset.criticality)}`}>
                        {asset.criticality ?? "normal"}
                      </span>
                    </td>
                    <td className="p-4">
                      {asset.risk_score == null ? (
                        <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-muted text-muted-foreground border border-border">
                          Unscanned
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <SeverityBadge severity={getSeverity(asset.risk_score) as any} showDot={false} />
                          <span className="text-xs text-muted-foreground tabular-nums">{asset.risk_score}</span>
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {asset.tags.slice(0, 2).map((tag) => (
                          <span key={tag} className="text-xs px-2 py-0.5 bg-muted rounded-full text-muted-foreground">
                            {tag}
                          </span>
                        ))}
                        {asset.tags.length > 2 && (
                          <span className="text-xs px-2 py-0.5 bg-muted rounded-full text-muted-foreground">
                            +{asset.tags.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {asset.last_seen ?? "—"}
                    </td>
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      {asset.ownership_verified ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium bg-success/10 text-success">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                        </span>
                      ) : canWrite ? (
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openVerify(asset)}>
                          <Shield className="w-3.5 h-3.5 mr-1" /> Verify
                        </Button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium bg-muted text-muted-foreground">
                          Unverified
                        </span>
                      )}
                    </td>
                    <td className="p-4" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setSelectedAsset(asset)}>
                            <Eye className="w-4 h-4 mr-2" />View Details
                          </DropdownMenuItem>
                          {canWrite && (
                            <>
                              <DropdownMenuItem onClick={() => openEditDialog(asset)}>
                                <Edit className="w-4 h-4 mr-2" />Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={rescoringId === asset.id || (asset.type !== "domain" && asset.type !== "ip")}
                                onClick={() => handleRescore(asset)}
                              >
                                <RefreshCw className={`w-4 h-4 mr-2 ${rescoringId === asset.id ? "animate-spin" : ""}`} />
                                {rescoringId === asset.id ? "Rescoring…" : "Rescore exposure"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => setDeleteConfirm({ id: asset.id, name: asset.name })}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />Delete
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredAssets.length === 0 && !isLoading && !loadError && (
          <EmptyState
            icon={Server}
            title="No assets found"
            description="No assets match your current filters. Try adjusting your search or add new assets."
            actionLabel={canWrite ? "Add Asset" : undefined}
            onAction={canWrite ? () => setIsAddOpen(true) : undefined}
          />
        )}
      </div>

      {/* Ownership verification */}
      <Dialog
        open={!!verifyAsset}
        onOpenChange={(o) => { if (!o) { setVerifyAsset(null); setVerifyToken(null); } }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" /> Verify ownership
            </DialogTitle>
            <DialogDescription>
              {verifyAsset?.type === "domain"
                ? `Prove you control ${verifyAsset?.name} to run active (NORMAL/DEEP) scans. Passive (LIGHT) scans never need this.`
                : `Attest that your organization owns ${verifyAsset?.name}.`}
            </DialogDescription>
          </DialogHeader>

          {verifyLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Generating token…</div>
          ) : verifyAsset?.type === "domain" && verifyToken ? (
            <ol className="space-y-3 text-sm">
              <li>
                <span className="font-medium">1.</span> Add this <span className="font-medium">TXT record</span> to{" "}
                <span className="font-mono">{verifyAsset.name}</span>’s DNS:
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 text-xs bg-muted rounded-lg p-2 break-all">{verifyToken.dns_txt_record}</code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => { navigator.clipboard.writeText(verifyToken.dns_txt_record); toast({ title: "Copied to clipboard" }); }}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Host/Name: <span className="font-mono">@</span> (root) · Type: <span className="font-mono">TXT</span>
                </div>
              </li>
              <li><span className="font-medium">2.</span> Wait a few minutes for DNS to propagate.</li>
              <li>
                <span className="font-medium">3.</span> That's it — we detect it <span className="font-medium">automatically</span>.
                This dialog flips to verified the moment it propagates, and we keep re-checking in the background even if
                you close it. (Or hit <span className="font-medium">Check now</span> to try immediately.)
              </li>
            </ol>
          ) : (
            <div className="py-4 text-sm text-muted-foreground">
              As an owner/admin you can attest ownership of this {verifyAsset?.type}. Click below to confirm.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setVerifyAsset(null); setVerifyToken(null); }}>Cancel</Button>
            <Button onClick={submitVerify} disabled={verifySubmitting || verifyLoading}>
              {verifySubmitting ? "Checking…" : verifyAsset?.type === "domain" ? "Check now" : "Attest ownership"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Asset Detail Sheet */}
      <Sheet open={!!selectedAsset && !isEditOpen} onOpenChange={() => setSelectedAsset(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedAsset && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  {(() => {
                    const TypeIcon = typeIcons[selectedAsset.type] || Server;
                    return <TypeIcon className="w-5 h-5 text-primary" />;
                  })()}
                  {selectedAsset.name}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                {canWrite && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={rescoringId === selectedAsset.id || (selectedAsset.type !== "domain" && selectedAsset.type !== "ip")}
                      onClick={() => handleRescore(selectedAsset)}
                    >
                      <RefreshCw className={`w-4 h-4 mr-1 ${rescoringId === selectedAsset.id ? "animate-spin" : ""}`} />
                      {rescoringId === selectedAsset.id ? "Rescoring…" : "Rescore"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEditDialog(selectedAsset)}><Edit className="w-4 h-4 mr-1" />Edit</Button>
                    {selectedAsset.ownership_verified ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium bg-success/10 text-success">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Ownership verified
                      </span>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => openVerify(selectedAsset)}>
                        <Shield className="w-4 h-4 mr-1" /> Verify ownership
                      </Button>
                    )}
                  </div>
                )}

                <div className="space-y-4">
                  <h4 className="font-medium text-foreground">Asset Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-muted/30 rounded-xl">
                      <div className="text-xs text-muted-foreground mb-1">Type</div>
                      <div className="text-sm font-medium capitalize">{selectedAsset.type}</div>
                    </div>
                    <div className="p-4 bg-muted/30 rounded-xl">
                      <div className="text-xs text-muted-foreground mb-1">Exposure</div>
                      <div className="text-sm font-medium capitalize">{selectedAsset.exposure}</div>
                    </div>
                    <div className="p-4 bg-muted/30 rounded-xl">
                      <div className="text-xs text-muted-foreground mb-1">Criticality</div>
                      <div className="text-sm font-medium capitalize">{selectedAsset.criticality ?? "normal"}</div>
                    </div>
                    <div className="p-4 bg-muted/30 rounded-xl">
                      <div className="text-xs text-muted-foreground mb-1">Exposure Score</div>
                      <div className="text-sm font-medium">
                        {selectedAsset.risk_score == null ? "Unscanned" : `${selectedAsset.risk_score}/100`}
                      </div>
                    </div>
                    <div className="p-4 bg-muted/30 rounded-xl">
                      <div className="text-xs text-muted-foreground mb-1">Last Seen</div>
                      <div className="text-sm font-medium">{selectedAsset.last_seen ?? "—"}</div>
                    </div>
                    {selectedAsset.status && (
                      <div className="p-4 bg-muted/30 rounded-xl col-span-2">
                        <div className="text-xs text-muted-foreground mb-1">Status</div>
                        <div className="text-sm font-medium capitalize">{selectedAsset.status}</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="font-medium text-foreground">Tags</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedAsset.tags.length > 0 ? (
                      selectedAsset.tags.map((tag) => (
                        <span key={tag} className="px-3 py-1.5 bg-primary/10 text-primary text-sm rounded-lg">
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No tags assigned</span>
                    )}
                  </div>
                </div>

                {scoreBreakdown[selectedAsset.id]?.scored && (
                  <div className="space-y-3">
                    <h4 className="font-medium text-foreground">Why this score</h4>
                    <p className="text-xs text-muted-foreground">
                      Computed from {scoreBreakdown[selectedAsset.id].matched_ips.length} discovered IP(s) using CVSS/EPSS/KEV-aware exposure scoring.
                    </p>
                    <div className="space-y-2">
                      {scoreBreakdown[selectedAsset.id].factors.map((f, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-2.5 bg-muted/30 rounded-lg">
                          <span className="text-foreground">{f.detail}</span>
                          <span className="font-medium text-muted-foreground tabular-nums">+{f.points}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Add Asset Dialog */}
      <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) setSelectedAssetType(null); }}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Add New Asset
            </DialogTitle>
            <DialogDescription>
              Select the type of asset you want to add to your inventory
            </DialogDescription>
          </DialogHeader>

          <AnimatePresence mode="wait">
            {!selectedAssetType ? (
              <motion.div
                key="type-selection"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, x: -20 }}
                className="grid grid-cols-2 gap-3 py-4"
              >
                {assetTypes.map((type) => {
                  const Icon = type.icon;
                  return (
                    <motion.button
                      key={type.value}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setSelectedAssetType(type.value)}
                      className="p-4 bg-muted/30 hover:bg-muted/50 rounded-xl border border-border hover:border-primary/30 transition-all text-left group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="font-medium text-foreground">{type.label}</div>
                      <div className="text-xs text-muted-foreground mt-1">{type.description}</div>
                    </motion.button>
                  );
                })}
              </motion.div>
            ) : (
              <div key="form" className="py-4">
                {renderAssetTypeForm()}
              </div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Asset</DialogTitle>
            <DialogDescription>Update asset information</DialogDescription>
          </DialogHeader>
          {selectedAsset && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Asset Name</Label>
                <Input 
                  value={editForm.name ?? selectedAsset.name} 
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Exposure</Label>
                  <Select 
                    value={editForm.exposure ?? selectedAsset.exposure}
                    onValueChange={(value: ApiAsset["exposure"]) => setEditForm({ ...editForm, exposure: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public</SelectItem>
                      <SelectItem value="internal">Internal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select 
                    value={editForm.status ?? selectedAsset.status ?? "active"}
                    onValueChange={(value: ApiAsset["status"]) => setEditForm({ ...editForm, status: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Criticality</Label>
                  <Select
                    value={editForm.criticality ?? selectedAsset.criticality ?? "normal"}
                    onValueChange={(value: NonNullable<ApiAsset["criticality"]>) => setEditForm({ ...editForm, criticality: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Tags (comma-separated)</Label>
                <Input 
                  value={editForm.tags ? editForm.tags.join(", ") : selectedAsset.tags.join(", ")}
                  onChange={(e) => setEditForm({ 
                    ...editForm, 
                    tags: e.target.value.split(",").map(t => t.trim()).filter(Boolean)
                  })}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <Button 
                  variant="outline" 
                  className="flex-1" 
                  onClick={() => setIsEditOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  variant="gradient" 
                  className="flex-1" 
                  onClick={handleUpdateAsset}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk Tag Dialog */}
      <Dialog open={isTagOpen} onOpenChange={(open) => { setIsTagOpen(open); if (!open) setBulkTags(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5 text-primary" />
              Tag {selectedAssets.length} asset{selectedAssets.length !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              Tags are merged with each asset's existing tags (duplicates ignored).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Tags (comma-separated)</Label>
              <Input
                autoFocus
                placeholder="e.g., production, pci, external"
                value={bulkTags}
                onChange={(e) => setBulkTags(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleBulkTag(); }}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setIsTagOpen(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button variant="gradient" className="flex-1" onClick={handleBulkTag} disabled={isSubmitting}>
                {isSubmitting ? "Applying…" : "Apply Tags"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Asset</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConfirm?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteConfirm} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
