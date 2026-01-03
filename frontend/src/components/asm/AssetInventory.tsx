import { useEffect, useState } from "react";
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
  UserPlus,
  Tag,
  RefreshCw,
  X,
  Users,
  Shield,
  Upload,
  FileText,
  CheckCircle2,
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
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [selectedAssetType, setSelectedAssetType] = useState<string | null>(null);
  const [newAsset, setNewAsset] = useState({
    name: "",
    type: "" as ApiAsset["type"] | "",
    exposure: "public" as ApiAsset["exposure"],
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

  // Fetch assets with filters
  useEffect(() => {
    const controller = new AbortController();
    
    const loadAssets = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);

        const params: AssetListParams = {
          q: searchQuery || undefined,
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
  }, [searchQuery, typeFilter, exposureFilter]);

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

  const getSeverity = (risk: number) => {
    if (risk >= 80) return "critical";
    if (risk >= 60) return "high";
    if (risk >= 40) return "medium";
    return "low";
  };

  const handleAddAsset = async () => {
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

    try {
      if (newAsset.name) {
        const payload: CreateAssetPayload = {
          name: newAsset.name.trim(),
          type: selectedAssetType as ApiAsset["type"],
          exposure: newAsset.exposure,
          tags: newAsset.tags
            ? newAsset.tags.split(",").map((t) => t.trim()).filter(Boolean)
            : [],
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
              tags: newAsset.tags
                ? newAsset.tags.split(",").map((t) => t.trim()).filter(Boolean)
                : [],
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

    setIsSubmitting(true);

    try {
      const payload: UpdateAssetPayload = {
        name: editForm.name?.trim(),
        exposure: editForm.exposure,
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

  const openEditDialog = (asset: ApiAsset) => {
    setSelectedAsset(asset);
    setEditForm({
      name: asset.name,
      exposure: asset.exposure,
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
              <Button variant="outline" size="sm" className="gap-2">
                <FileText className="w-4 h-4" />
                Upload CSV
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Server className="w-5 h-5 text-primary" />
            Asset Inventory
          </h2>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading assets..." : `${assets.length} assets discovered`}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button variant="gradient" onClick={() => setIsAddOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Asset
          </Button>
        </div>
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
      </div>

      {/* Bulk Actions */}
      <AnimatePresence>
        {selectedAssets.length > 0 && (
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
              <Button variant="outline" size="sm">
                <Tag className="w-4 h-4 mr-1" />
                Tag
              </Button>
              <Button variant="outline" size="sm">
                <UserPlus className="w-4 h-4 mr-1" />
                Assign
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
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <th className="p-4 font-medium">Asset Name</th>
                <th className="p-4 font-medium">Type</th>
                <th className="p-4 font-medium">Exposure</th>
                <th className="p-4 font-medium">Risk Score</th>
                <th className="p-4 font-medium">Tags</th>
                <th className="p-4 font-medium">Last Seen</th>
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
                        onCheckedChange={() => toggleSelect(asset.id)}
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
                      <SeverityBadge severity={getSeverity(asset.risk_score) as any} showDot={false} />
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
                          <DropdownMenuItem onClick={() => openEditDialog(asset)}>
                            <Edit className="w-4 h-4 mr-2" />Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <RefreshCw className="w-4 h-4 mr-2" />Re-scan
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <UserPlus className="w-4 h-4 mr-2" />Assign Owner
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            className="text-destructive"
                            onClick={() => setDeleteConfirm({ id: asset.id, name: asset.name })}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />Delete
                          </DropdownMenuItem>
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
            actionLabel="Add Asset"
            onAction={() => setIsAddOpen(true)}
          />
        )}
      </div>

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
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-1" />Re-scan</Button>
                  <Button variant="outline" size="sm"><UserPlus className="w-4 h-4 mr-1" />Assign</Button>
                  <Button variant="outline" size="sm" onClick={() => openEditDialog(selectedAsset)}><Edit className="w-4 h-4 mr-1" />Edit</Button>
                </div>

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
                      <div className="text-xs text-muted-foreground mb-1">Risk Score</div>
                      <div className="text-sm font-medium">{selectedAsset.risk_score}/100</div>
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