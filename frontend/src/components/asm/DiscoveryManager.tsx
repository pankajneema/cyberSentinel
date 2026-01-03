import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "./EmptyState";
import {
  Search,
  Plus,
  Play,
  Pause,
  Trash2,
  MoreHorizontal,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Calendar,
  Eye,
  RefreshCw,
  Radar,
  Edit,
  Globe,
  Server,
  Shield,
  Zap,
  Target,
  Code,
  Box,
  Users,
  Cloud,
  FileText,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import {
  fetchAssets,
  fetchDiscoveries,
  createDiscovery,
  updateDiscovery,
  deleteDiscovery,
  type ApiAsset,
  type AsmDiscovery,
  type CreateDiscoveryPayload,
  type UpdateDiscoveryPayload,
} from "@/lib/api";

const discoveryTypes = [
  { 
    value: "domain", 
    label: "Domain", 
    icon: Globe, 
    description: "Add domain names (e.g., example.com)",
    color: "bg-primary/10 text-primary"
  },
  { 
    value: "ip", 
    label: "IP Address", 
    icon: Server, 
    description: "Add IP addresses or CIDR ranges",
    color: "bg-destructive/10 text-destructive"
  },
  { 
    value: "cloud", 
    label: "Cloud Asset", 
    icon: Cloud, 
    description: "AWS, Azure, GCP resources",
    color: "bg-success/10 text-success"
  },
  { 
    value: "repo", 
    label: "Repository", 
    icon: Code, 
    description: "GitHub, GitLab, Bitbucket repos",
    color: "bg-warning/10 text-warning"
  },
  { 
    value: "saas", 
    label: "SaaS App", 
    icon: Box, 
    description: "Third-party SaaS applications",
    color: "bg-accent/10 text-accent"
  },
  { 
    value: "user", 
    label: "User Account", 
    icon: Users, 
    description: "Employee or service accounts",
    color: "bg-secondary/10 text-secondary"
  },
];

const scheduleOptions = [
  { value: "QUICK", label: "Quick (Run Once)", intervalValue: null },
  { value: "INTERVAL", label: "Every 5 Hours", intervalValue: "5h" },
  { value: "INTERVAL", label: "Daily", intervalValue: "24h" },
  { value: "INTERVAL", label: "Weekly", intervalValue: "168h" },
  { value: "INTERVAL", label: "Monthly", intervalValue: "720h" },
];

export function ScanManager() {
  const [searchQuery, setSearchQuery] = useState("");
  const [discoveries, setDiscoveries] = useState<AsmDiscovery[]>([]);
  const [inventoryAssets, setInventoryAssets] = useState<ApiAsset[]>([]);
  const [isNewDiscoveryOpen, setIsNewDiscoveryOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [selectedDiscovery, setSelectedDiscovery] = useState<AsmDiscovery | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  const [targetMode, setTargetMode] = useState<"FROM_ASSET" | "MANUAL_ENTRY">("FROM_ASSET");
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [newDiscovery, setNewDiscovery] = useState({ 
    name: "", 
    asset_type: "" as CreateDiscoveryPayload["asset_type"] | "",
    manual_targets: "",
    intensity: "NORMAL" as CreateDiscoveryPayload["intensity"],
    schedule_type: "QUICK" as CreateDiscoveryPayload["schedule_type"],
    schedule_value: null as string | null,
    notifications: true,
  });

  const [editForm, setEditForm] = useState<UpdateDiscoveryPayload>({});

  useEffect(() => {
    loadDiscoveries();
    loadInventoryAssets();
  }, []);

  const loadDiscoveries = async () => {
    try {
      setIsLoading(true);
      const data = await fetchDiscoveries();
      setDiscoveries(data.items);
    } catch (err: any) {
      console.error("Failed to load discoveries:", err);
      toast({
        title: "Error loading discoveries",
        description: err.message || "Could not fetch discoveries",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadInventoryAssets = async () => {
    try {
      const data = await fetchAssets();
      setInventoryAssets(data.items);
    } catch (err: any) {
      console.error("Failed to load assets:", err);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "ACTIVE": return <CheckCircle2 className="w-4 h-4 text-success" />;
      case "RUNNING": return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
      case "PENDING": return <Clock className="w-4 h-4 text-warning" />;
      case "PAUSED": return <Pause className="w-4 h-4 text-muted-foreground" />;
      case "FAILED": return <XCircle className="w-4 h-4 text-destructive" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ACTIVE": return "bg-success/10 text-success";
      case "RUNNING": return "bg-primary/10 text-primary";
      case "PENDING": return "bg-warning/10 text-warning";
      case "PAUSED": return "bg-muted text-muted-foreground";
      case "FAILED": return "bg-destructive/10 text-destructive";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const filteredDiscoveries = discoveries.filter((discovery) =>
    discovery.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getFilteredAssetsByType = () => {
    if (!newDiscovery.asset_type) return inventoryAssets;
    return inventoryAssets.filter(asset => asset.type === newDiscovery.asset_type);
  };

  const handleCreateDiscovery = async () => {
    const hasTarget = targetMode === "FROM_ASSET" 
      ? selectedAssets.length > 0 
      : newDiscovery.manual_targets.trim();
      
    if (!newDiscovery.name || !hasTarget || !newDiscovery.asset_type) {
      toast({ 
        title: "Validation Error", 
        description: "Please fill in all required fields", 
        variant: "destructive" 
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const payload: CreateDiscoveryPayload = {
        name: newDiscovery.name,
        asset_type: newDiscovery.asset_type as CreateDiscoveryPayload["asset_type"],
        target_source: targetMode,
        asset_ids: targetMode === "FROM_ASSET" ? selectedAssets : null,
        manual_targets: targetMode === "MANUAL_ENTRY" 
          ? newDiscovery.manual_targets.split("\n").map(t => t.trim()).filter(Boolean)
          : null,
        intensity: newDiscovery.intensity,
        schedule_type: newDiscovery.schedule_type,
        schedule_value: newDiscovery.schedule_value,
      };

      console.log("Creating discovery with payload:", payload);

      const created = await createDiscovery(payload);
      
      // Set status to PENDING for new discoveries
      const createdWithPending = { ...created, status: "PENDING" as any };
      setDiscoveries([createdWithPending, ...discoveries]);
      
      toast({ 
        title: "Discovery Created Successfully", 
        description: `${created.name} has been queued and will start shortly`
      });

      setIsNewDiscoveryOpen(false);
      resetForm();
    } catch (err: any) {
      console.error("Failed to create discovery:", err);
      toast({
        title: "Error creating discovery",
        description: err.message || "Failed to create discovery",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateDiscovery = async () => {
    if (!selectedDiscovery) return;

    setIsSubmitting(true);

    try {
      const updated = await updateDiscovery(selectedDiscovery.id, editForm);
      
      setDiscoveries(discoveries.map(d => d.id === updated.id ? updated : d));
      setSelectedDiscovery(updated);
      
      toast({
        title: "Discovery Updated",
        description: `${updated.name} has been updated successfully`,
      });
      
      setIsEditOpen(false);
      setEditForm({});
    } catch (err: any) {
      console.error("Failed to update discovery:", err);
      toast({
        title: "Error updating discovery",
        description: err.message || "Failed to update discovery",
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
      await deleteDiscovery(deleteConfirm.id);

      setDiscoveries(discoveries.filter(d => d.id !== deleteConfirm.id));
      
      toast({ 
        title: "Discovery Deleted", 
        description: `${deleteConfirm.name} has been deleted` 
      });
      
      setDeleteConfirm(null);
      
      if (selectedDiscovery?.id === deleteConfirm.id) {
        setSelectedDiscovery(null);
      }
    } catch (err: any) {
      console.error("Failed to delete discovery:", err);
      toast({
        title: "Error deleting discovery",
        description: err.message || "Failed to delete discovery",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRunDiscovery = async (id: string, name: string) => {
    try {
      // First set to PENDING
      setDiscoveries(discoveries.map(d => 
        d.id === id ? { ...d, status: "PENDING" as any } : d
      ));
      
      toast({ 
        title: "Discovery Queued", 
        description: `${name} has been queued and will start shortly` 
      });
      
      // Change to RUNNING after 2 seconds
      setTimeout(() => {
        setDiscoveries(prev => prev.map(d => 
          d.id === id ? { ...d, status: "RUNNING" as any } : d
        ));
        
        toast({
          title: "Discovery Started",
          description: `${name} is now running`,
        });
        
        // Change to ACTIVE after scan completes (5 seconds)
        setTimeout(() => {
          setDiscoveries(prev => prev.map(d => 
            d.id === id ? { ...d, status: "ACTIVE" as any } : d
          ));
          
          toast({
            title: "Discovery Completed",
            description: `${name} scan completed successfully`,
          });
        }, 5000);
      }, 2000);
    } catch (err: any) {
      toast({
        title: "Error",
        description: "Failed to start discovery",
        variant: "destructive",
      });
    }
  };

  const handleToggleStatus = async (discovery: AsmDiscovery) => {
    const newStatus = discovery.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    
    try {
      const updated = await updateDiscovery(discovery.id, { status: newStatus as any });
      setDiscoveries(discoveries.map(d => d.id === updated.id ? updated : d));
      
      toast({
        title: `Discovery ${newStatus === "ACTIVE" ? "Activated" : "Paused"}`,
        description: `${discovery.name} is now ${newStatus.toLowerCase()}`,
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: "Failed to update discovery status",
        variant: "destructive",
      });
    }
  };

  const handleStopDiscovery = async (id: string, name: string) => {
    try {
      setDiscoveries(discoveries.map(d => 
        d.id === id ? { ...d, status: "PAUSED" as any } : d
      ));
      
      toast({ 
        title: "Discovery Stopped", 
        description: `${name} has been stopped` 
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: "Failed to stop discovery",
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setWizardStep(1);
    setTargetMode("FROM_ASSET");
    setSelectedAssets([]);
    setNewDiscovery({ 
      name: "", 
      asset_type: "",
      manual_targets: "",
      intensity: "NORMAL",
      schedule_type: "QUICK",
      schedule_value: null,
      notifications: true,
    });
  };

  const openEditDialog = (discovery: AsmDiscovery) => {
    setSelectedDiscovery(discovery);
    setEditForm({
      name: discovery.name,
      intensity: discovery.intensity as UpdateDiscoveryPayload["intensity"],
      schedule_type: discovery.schedule_type as UpdateDiscoveryPayload["schedule_type"],
      schedule_value: discovery.schedule_value,
      status: discovery.status as UpdateDiscoveryPayload["status"],
    });
    setIsEditOpen(true);
  };

  const openViewDialog = (discovery: AsmDiscovery) => {
    setSelectedDiscovery(discovery);
    setIsViewOpen(true);
  };

  const renderWizardStep = () => {
    switch (wizardStep) {
      case 1:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-2xl gradient-bg flex items-center justify-center mx-auto mb-4">
                <Radar className="w-8 h-8 text-primary-foreground" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Select Asset Type</h3>
              <p className="text-sm text-muted-foreground">Choose the type of asset you want to discover</p>
            </div>

            <div className="grid gap-3">
              {discoveryTypes.map((type) => {
                const Icon = type.icon;
                const isSelected = newDiscovery.asset_type === type.value;
                return (
                  <motion.button
                    key={type.value}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    onClick={() => setNewDiscovery({ ...newDiscovery, asset_type: type.value as any })}
                    className={`p-4 rounded-xl border-2 transition-all text-left flex items-center gap-4 ${
                      isSelected 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:border-primary/30 bg-muted/30"
                    }`}
                  >
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${type.color}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-foreground">{type.label}</div>
                      <div className="text-sm text-muted-foreground">{type.description}</div>
                    </div>
                    {isSelected && <CheckCircle2 className="w-5 h-5 text-primary" />}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        );

      case 2:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
                <Target className="w-8 h-8 text-accent" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Configure Target</h3>
              <p className="text-sm text-muted-foreground">Select assets from inventory or add new targets</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Discovery Name</Label>
                <Input
                  placeholder="e.g., Weekly Production Discovery"
                  value={newDiscovery.name}
                  onChange={(e) => setNewDiscovery({ ...newDiscovery, name: e.target.value })}
                  className="h-12"
                />
              </div>

              <div className="space-y-3">
                <Label>Target Selection</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setTargetMode("FROM_ASSET")}
                    className={cn(
                      "p-4 rounded-xl border-2 transition-all text-left",
                      targetMode === "FROM_ASSET" 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:border-primary/30"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Server className="w-5 h-5 text-primary" />
                      <div>
                        <div className="font-medium text-foreground text-sm">From Asset Inventory</div>
                        <div className="text-xs text-muted-foreground">Select existing assets</div>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => setTargetMode("MANUAL_ENTRY")}
                    className={cn(
                      "p-4 rounded-xl border-2 transition-all text-left",
                      targetMode === "MANUAL_ENTRY" 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:border-primary/30"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Edit className="w-5 h-5 text-secondary" />
                      <div>
                        <div className="font-medium text-foreground text-sm">Manual Entry</div>
                        <div className="text-xs text-muted-foreground">Enter new targets</div>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {targetMode === "FROM_ASSET" ? (
                <div className="space-y-3">
                  <Label>Select Assets ({selectedAssets.length} selected)</Label>
                  <div className="border border-border rounded-xl max-h-48 overflow-y-auto">
                    {getFilteredAssetsByType().length > 0 ? (
                      getFilteredAssetsByType().map((asset) => {
                        const isSelected = selectedAssets.includes(asset.id);
                        return (
                          <div
                            key={asset.id}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedAssets(selectedAssets.filter(id => id !== asset.id));
                              } else {
                                setSelectedAssets([...selectedAssets, asset.id]);
                              }
                            }}
                            className={cn(
                              "flex items-center gap-3 p-3 cursor-pointer transition-colors border-b border-border last:border-b-0",
                              isSelected ? "bg-primary/10" : "hover:bg-muted/50"
                            )}
                          >
                            <div className={cn(
                              "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                              isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"
                            )}>
                              {isSelected && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm text-foreground truncate">{asset.name}</div>
                              <div className="text-xs text-muted-foreground capitalize">{asset.type}</div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        No {newDiscovery.asset_type} assets found in inventory
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Click to select/deselect assets from your inventory</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Target</Label>
                  <Textarea
                    placeholder={
                      newDiscovery.asset_type === "ip" 
                        ? "Enter IP addresses or CIDR ranges\ne.g., 192.168.1.0/24\n10.0.0.1-10.0.0.255" 
                        : newDiscovery.asset_type === "domain"
                        ? "Enter domains to discover\ne.g., *.company.com\napi.company.com"
                        : newDiscovery.asset_type === "cloud"
                        ? "Enter cloud resource identifiers\ne.g., arn:aws:s3:::mybucket"
                        : "Enter targets, one per line"
                    }
                    value={newDiscovery.manual_targets}
                    onChange={(e) => setNewDiscovery({ ...newDiscovery, manual_targets: e.target.value })}
                    rows={4}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Enter one target per line for multiple targets</p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Discovery Intensity</Label>
                <Select 
                  value={newDiscovery.intensity} 
                  onValueChange={(value: CreateDiscoveryPayload["intensity"]) => setNewDiscovery({ ...newDiscovery, intensity: value })}
                >
                  <SelectTrigger className="h-12">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LIGHT">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-success" />
                        <span>Light - Quick discovery, minimal impact</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="NORMAL">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-warning" />
                        <span>Normal - Balanced discovery (recommended)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="DEEP">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-destructive" />
                        <span>Deep - Comprehensive discovery, may take longer</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </motion.div>
        );

      case 3:
        const selectedSchedule = scheduleOptions.find(opt => 
          opt.value === newDiscovery.schedule_type && opt.intervalValue === newDiscovery.schedule_value
        ) || scheduleOptions.find(opt => opt.value === "NONE");
        
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
                <Calendar className="w-8 h-8 text-success" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Schedule & Options</h3>
              <p className="text-sm text-muted-foreground">Set when and how to run this discovery</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Schedule</Label>
                <Select 
                  value={selectedSchedule?.label || "Quick (Run Once)"}
                  onValueChange={(selectedLabel) => {
                    const option = scheduleOptions.find(opt => opt.label === selectedLabel);
                    if (option) {
                      setNewDiscovery({ 
                        ...newDiscovery, 
                        schedule_type: option.value as any,
                        schedule_value: option.intervalValue
                      });
                    }
                  }}
                >
                  <SelectTrigger className="h-12">
                    <SelectValue placeholder="Select schedule" />
                  </SelectTrigger>
                  <SelectContent>
                    {scheduleOptions.map((opt, idx) => (
                      <SelectItem key={idx} value={opt.label}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="p-4 bg-muted/30 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-foreground">Email Notifications</div>
                    <div className="text-sm text-muted-foreground">Get notified when discovery completes</div>
                  </div>
                  <Switch 
                    checked={newDiscovery.notifications} 
                    onCheckedChange={(checked) => setNewDiscovery({ ...newDiscovery, notifications: checked })} 
                  />
                </div>
              </div>

              <div className="p-4 bg-primary/5 border border-primary/20 rounded-xl">
                <h4 className="font-medium text-foreground mb-3">Discovery Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name:</span>
                    <span className="font-medium text-foreground">{newDiscovery.name || "Not set"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type:</span>
                    <span className="font-medium text-foreground capitalize">{newDiscovery.asset_type || "Not set"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Target:</span>
                    <span className="font-medium text-foreground truncate max-w-[200px]">
                      {targetMode === "FROM_ASSET" 
                        ? (selectedAssets.length > 0 ? `${selectedAssets.length} asset(s) selected` : "Not set")
                        : (newDiscovery.manual_targets ? `${newDiscovery.manual_targets.split('\n').filter(t => t.trim()).length} target(s)` : "Not set")
                      }
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Schedule:</span>
                    <span className="font-medium text-foreground">
                      {selectedSchedule?.label || "Not set"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        );

      default:
        return null;
    }
  };

  const renderDiscoveryCard = (discovery: AsmDiscovery, index: number) => {
    const canEdit = discovery.status === "ACTIVE" || discovery.status === "PAUSED";
    const canRunNow = discovery.status === "ACTIVE";
    const canToggleStatus = discovery.status === "ACTIVE" || discovery.status === "PAUSED";
    const canStop = discovery.status === "PENDING";
    
    return (
      <motion.div
        key={discovery.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.05 }}
        className="bg-card rounded-2xl border border-border p-5 hover:shadow-md transition-all"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {getStatusIcon(discovery.status)}
            <div>
              <div className="font-medium text-foreground">{discovery.name}</div>
              <div className="text-sm text-muted-foreground capitalize">
                {discovery.asset_type} • {discovery.intensity} intensity
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2.5 py-1 rounded-full capitalize ${getStatusColor(discovery.status)}`}>
              {discovery.status}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openViewDialog(discovery)}>
                  <Eye className="w-4 h-4 mr-2" />View Details
                </DropdownMenuItem>
                
                {/* {canRunNow && (
                  <DropdownMenuItem onClick={() => handleRunDiscovery(discovery.id, discovery.name)}>
                    <Play className="w-4 h-4 mr-2" />Run Now
                  </DropdownMenuItem>
                )} */}
                
                {canEdit && (
                  <DropdownMenuItem onClick={() => openEditDialog(discovery)}>
                    <Edit className="w-4 h-4 mr-2" />Edit
                  </DropdownMenuItem>
                )}
                
                {/* {canStop && (
                  <DropdownMenuItem onClick={() => handleStopDiscovery(discovery.id, discovery.name)}>
                    <XCircle className="w-4 h-4 mr-2" />Stop
                  </DropdownMenuItem>
                )} */}
                
                {discovery.status === "RUNNING" && (
                  <DropdownMenuItem onClick={() => openViewDialog(discovery)}>
                    <Activity className="w-4 h-4 mr-2" />View Logs
                  </DropdownMenuItem>
                )}
                
                {canToggleStatus && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleToggleStatus(discovery)}>
                      {discovery.status === "ACTIVE" ? (
                        <>
                          <Pause className="w-4 h-4 mr-2" />Pause
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />Activate
                        </>
                      )}
                    </DropdownMenuItem>
                  </>
                )}
                
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="text-destructive"
                  onClick={() => setDeleteConfirm({ id: discovery.id, name: discovery.name })}
                >
                  <Trash2 className="w-4 h-4 mr-2" />Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4" />
            <span>{discovery.schedule_type === "QUICK" ? "Manual" : discovery.schedule_value || "Scheduled"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            <span>Last: {discovery.last_run_at || "Never"}</span>
          </div>
          {discovery.next_run_at && discovery.schedule_type !== "QUICK" && (
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4" />
              <span>Next: {discovery.next_run_at}</span>
            </div>
          )}
        </div>
        
        {discovery.status === "RUNNING" && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Discovery in progress...</span>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => openViewDialog(discovery)}
                className="h-8"
              >
                <Activity className="w-3 h-3 mr-1.5" />
                View Logs
              </Button>
            </div>
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
            <Radar className="w-5 h-5 text-primary" />
            Discovery Management
          </h2>
          <p className="text-sm text-muted-foreground">
            {isLoading ? "Loading discoveries..." : `${discoveries.length} discoveries configured`}
          </p>
        </div>
        <Button variant="gradient" onClick={() => setIsNewDiscoveryOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Discovery
        </Button>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All Discoveries</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="running">Running</TabsTrigger>
          <TabsTrigger value="paused">Paused</TabsTrigger>
          <TabsTrigger value="pending">Pending</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4 mt-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search discoveries..."
              className="pl-11 h-11 rounded-xl"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            {filteredDiscoveries.map((discovery, index) => renderDiscoveryCard(discovery, index))}
          </div>

          {filteredDiscoveries.length === 0 && !isLoading && (
            <EmptyState
              icon={Search}
              title="No discoveries found"
              description="No discoveries match your search. Create a new discovery to get started."
              actionLabel="New Discovery"
              onAction={() => setIsNewDiscoveryOpen(true)}
            />
          )}
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          <div className="space-y-3">
            {discoveries.filter(d => d.status === "ACTIVE").map((discovery, index) => (
              <motion.div
                key={discovery.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-card rounded-2xl border border-border p-5"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-success" />
                    <div>
                      <div className="font-medium text-foreground">{discovery.name}</div>
                      <div className="text-sm text-muted-foreground capitalize">{discovery.asset_type} • {discovery.intensity}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => openViewDialog(discovery)}
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      View
                    </Button>
                    {/* <Button 
                      variant="default" 
                      size="sm"
                      onClick={() => handleRunDiscovery(discovery.id, discovery.name)}
                    >
                      <Play className="w-4 h-4 mr-1" />
                      Run Now
                    </Button> */}
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => openEditDialog(discovery)}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => handleToggleStatus(discovery)}
                    >
                      <Pause className="w-4 h-4 mr-1" />
                      Pause
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    <span>{discovery.schedule_type === "QUICK" ? "Manual" : discovery.schedule_value}</span>
                  </div>
                  {discovery.next_run_at && (
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-4 h-4" />
                      <span>Next: {discovery.next_run_at}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
            {discoveries.filter(d => d.status === "ACTIVE").length === 0 && (
              <EmptyState
                icon={CheckCircle2}
                title="No active discoveries"
                description="There are no active discoveries configured."
                actionLabel="New Discovery"
                onAction={() => setIsNewDiscoveryOpen(true)}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="running" className="mt-4">
          <div className="space-y-3">
            {discoveries.filter(d => d.status === "RUNNING").map((discovery, index) => (
              <motion.div
                key={discovery.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-card rounded-2xl border border-primary/30 p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    <div>
                      <div className="font-medium text-foreground">{discovery.name}</div>
                      <div className="text-sm text-muted-foreground capitalize">{discovery.asset_type} • Running</div>
                    </div>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => openViewDialog(discovery)}
                  >
                    <Activity className="w-4 h-4 mr-1" />
                    View Logs
                  </Button>
                </div>
                <div className="bg-primary/5 rounded-lg p-3">
                  <div className="text-xs text-muted-foreground mb-2">Discovery Progress</div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-primary"
                      initial={{ width: "0%" }}
                      animate={{ width: "65%" }}
                      transition={{ duration: 2, ease: "easeInOut" }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-2">Scanning targets...</div>
                </div>
              </motion.div>
            ))}
            {discoveries.filter(d => d.status === "RUNNING").length === 0 && (
              <EmptyState
                icon={Loader2}
                title="No running discoveries"
                description="There are no discoveries currently running."
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="paused" className="mt-4">
          <div className="space-y-3">
            {discoveries.filter(d => d.status === "PAUSED").map((discovery, index) => (
              <motion.div
                key={discovery.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-card rounded-2xl border border-border p-5"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Pause className="w-5 h-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium text-foreground">{discovery.name}</div>
                      <div className="text-sm text-muted-foreground capitalize">{discovery.asset_type} • Paused</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => openViewDialog(discovery)}
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      View
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => openEditDialog(discovery)}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                    <Button 
                      variant="default" 
                      size="sm"
                      onClick={() => handleToggleStatus(discovery)}
                    >
                      <Play className="w-4 h-4 mr-1" />
                      Activate
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
            {discoveries.filter(d => d.status === "PAUSED").length === 0 && (
              <EmptyState
                icon={Pause}
                title="No paused discoveries"
                description="There are no paused discoveries."
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="pending" className="mt-4">
          <div className="space-y-3">
            {discoveries.filter(d => d.status === "PENDING").map((discovery, index) => (
              <motion.div
                key={discovery.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-card rounded-2xl border border-warning/30 p-5"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-warning" />
                    <div>
                      <div className="font-medium text-foreground">{discovery.name}</div>
                      <div className="text-sm text-muted-foreground capitalize">{discovery.asset_type} • Queued</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => openViewDialog(discovery)}
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      View
                    </Button>
                    {/* <Button 
                      variant="destructive" 
                      size="sm"
                      onClick={() => handleStopDiscovery(discovery.id, discovery.name)}
                    >
                      <XCircle className="w-4 h-4 mr-1" />
                      Stop
                    </Button> */}
                  </div>
                </div>
                <div className="mt-3 p-3 bg-warning/5 rounded-lg border border-warning/20">
                  <div className="text-sm text-warning flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>Scan queued - Will start shortly</span>
                  </div>
                </div>
              </motion.div>
            ))}
            {discoveries.filter(d => d.status === "PENDING").length === 0 && (
              <EmptyState
                icon={Clock}
                title="No pending discoveries"
                description="There are no discoveries in the queue."
              />
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* New Discovery Wizard Dialog */}
      <Dialog open={isNewDiscoveryOpen} onOpenChange={(open) => { setIsNewDiscoveryOpen(open); if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Create New Discovery
            </DialogTitle>
            <DialogDescription>
              Step {wizardStep} of 3 - {wizardStep === 1 ? "Select Type" : wizardStep === 2 ? "Configure Target" : "Schedule & Options"}
            </DialogDescription>
          </DialogHeader>

          {/* Progress Indicator */}
          <div className="flex items-center gap-2 py-2">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex-1 flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  step === wizardStep 
                    ? "bg-primary text-primary-foreground" 
                    : step < wizardStep 
                    ? "bg-success text-success-foreground"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {step < wizardStep ? <CheckCircle2 className="w-4 h-4" /> : step}
                </div>
                {step < 3 && (
                  <div className={`flex-1 h-1 mx-2 rounded ${step < wizardStep ? "bg-success" : "bg-muted"}`} />
                )}
              </div>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {renderWizardStep()}
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex gap-3 pt-4 border-t border-border">
            {wizardStep > 1 && (
              <Button 
                variant="outline" 
                className="flex-1" 
                onClick={() => setWizardStep(wizardStep - 1)}
                disabled={isSubmitting}
              >
                Back
              </Button>
            )}
            {wizardStep < 3 ? (
              <Button 
                variant="gradient" 
                className="flex-1" 
                onClick={() => setWizardStep(wizardStep + 1)}
                disabled={wizardStep === 1 && !newDiscovery.asset_type}
              >
                Continue
              </Button>
            ) : (
              <Button 
                variant="gradient" 
                className="flex-1" 
                onClick={handleCreateDiscovery}
                disabled={isSubmitting}
              >
                <Radar className="w-4 h-4 mr-2" />
                {isSubmitting ? "Creating..." : "Create Discovery"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-primary" />
              Discovery Details
            </DialogTitle>
            <DialogDescription>
              {selectedDiscovery?.name}
            </DialogDescription>
          </DialogHeader>
          {selectedDiscovery && (
            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Status</div>
                    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm ${getStatusColor(selectedDiscovery.status)}`}>
                      {getStatusIcon(selectedDiscovery.status)}
                      <span className="capitalize">{selectedDiscovery.status}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Asset Type</div>
                    <div className="font-medium capitalize">{selectedDiscovery.asset_type}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Intensity</div>
                    <div className="font-medium capitalize">{selectedDiscovery.intensity}</div>
                  </div>
                                      <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Schedule</div>
                    <div className="font-medium">
                      {selectedDiscovery.schedule_type === "QUICK" ? "Manual (Run Once)" : selectedDiscovery.schedule_value || "Scheduled"}
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="text-sm text-muted-foreground mb-2">Timeline</div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Last Run:</span>
                      <span className="font-medium">{selectedDiscovery.last_run_at || "Never"}</span>
                    </div>
                    {selectedDiscovery.next_run_at && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Next Run:</span>
                        <span className="font-medium">{selectedDiscovery.next_run_at}</span>
                      </div>
                    )}
                  </div>
                </div>

                {selectedDiscovery.status === "RUNNING" && (
                  <div className="border-t border-border pt-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Activity className="w-4 h-4 text-primary" />
                      <div className="text-sm font-medium">Live Logs</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-4 font-mono text-xs space-y-1 max-h-48 overflow-y-auto">
                      <div className="text-success">[12:34:56] Starting discovery scan...</div>
                      <div className="text-muted-foreground">[12:34:57] Initializing scan engine</div>
                      <div className="text-muted-foreground">[12:34:58] Loading target list</div>
                      <div className="text-primary">[12:35:02] Scanning 15 targets</div>
                      <div className="text-muted-foreground">[12:35:05] Target 1/15 completed</div>
                      <div className="text-muted-foreground">[12:35:08] Target 2/15 completed</div>
                      <div className="text-primary animate-pulse">[12:35:11] Scan in progress...</div>
                    </div>
                  </div>
                )}

                <div className="border-t border-border pt-4">
                  <div className="text-sm text-muted-foreground mb-2">Discovery Configuration</div>
                  <div className="bg-muted/30 rounded-lg p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Discovery ID:</span>
                      <span className="font-mono text-xs">{selectedDiscovery.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Created:</span>
                      <span>{selectedDiscovery.created_at || "N/A"}</span>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Discovery</DialogTitle>
            <DialogDescription>Update discovery configuration</DialogDescription>
          </DialogHeader>
          {selectedDiscovery && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Discovery Name</Label>
                <Input 
                  value={editForm.name ?? selectedDiscovery.name} 
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Intensity</Label>
                  <Select 
                    value={editForm.intensity ?? selectedDiscovery.intensity}
                    onValueChange={(value: UpdateDiscoveryPayload["intensity"]) => setEditForm({ ...editForm, intensity: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LIGHT">Light</SelectItem>
                      <SelectItem value="NORMAL">Normal</SelectItem>
                      <SelectItem value="DEEP">Deep</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select 
                    value={editForm.status ?? selectedDiscovery.status}
                    onValueChange={(value: UpdateDiscoveryPayload["status"]) => setEditForm({ ...editForm, status: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="PAUSED">Paused</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Schedule</Label>
                <Select 
                  value={scheduleOptions.find(opt => 
                    opt.value === (editForm.schedule_type ?? selectedDiscovery.schedule_type) && 
                    opt.intervalValue === (editForm.schedule_value ?? selectedDiscovery.schedule_value)
                  )?.label || "Quick (Run Once)"}
                  onValueChange={(selectedLabel) => {
                    const option = scheduleOptions.find(opt => opt.label === selectedLabel);
                    if (option) {
                      setEditForm({ 
                        ...editForm, 
                        schedule_type: option.value as any,
                        schedule_value: option.intervalValue
                      });
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scheduleOptions.map((opt, idx) => (
                      <SelectItem key={idx} value={opt.label}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  onClick={handleUpdateDiscovery}
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
            <AlertDialogTitle>Delete Discovery</AlertDialogTitle>
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