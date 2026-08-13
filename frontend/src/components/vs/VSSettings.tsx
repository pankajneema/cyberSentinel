import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
  Shield,
  Key,
  Plus,
  Trash2,
  Loader2,
  RefreshCw,
  Zap,
  Lock,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/asm/EmptyState";
import {
  fetchProfiles,
  createProfile,
  deleteProfile,
  fetchCredentials,
  createCredential,
  deleteCredential,
  type VsProfile,
  type VsCredential,
  type VsIntensity,
  type CreateProfilePayload,
} from "@/lib/services/vs";

interface VSSettingsProps {
  canWrite?: boolean;
}

// Must match the worker's actual engine set (worker/services/vs.go vsEngineTool) —
// picking anything else silently produces zero scan stages, not an error.
const ENGINE_OPTIONS: { value: string; label: string }[] = [
  { value: "nuclei", label: "Nuclei (CVE / misconfig templates)" },
  { value: "sslyze", label: "SSL/TLS Analysis" },
  { value: "nmap", label: "Port & Service Scan (Nmap NSE)" },
  { value: "default-login", label: "Default / Weak Credentials" },
];

export function VSSettings({ canWrite = true }: VSSettingsProps) {
  const [profiles, setProfiles] = useState<VsProfile[]>([]);
  const [credentials, setCredentials] = useState<VsCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // profile dialog
  const [profileOpen, setProfileOpen] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<CreateProfilePayload>({
    name: "",
    intensity: "standard",
    engines: ["nuclei"],
    authenticated: false,
    credential_id: null,
    safe_mode: true,
    max_requests_per_sec: 10,
    scan_window: null,
    web_scan: false,
  });

  // credential dialog
  const [credOpen, setCredOpen] = useState(false);
  const [savingCred, setSavingCred] = useState(false);
  const [credForm, setCredForm] = useState({ name: "", cred_type: "ssh", username: "", secret: "" });

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [profs, creds] = await Promise.all([fetchProfiles(), fetchCredentials()]);
      setProfiles(profs);
      setCredentials(creds);
    } catch (e: any) {
      setError(e.message ?? "Failed to load scan settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const resetProfileForm = () =>
    setProfileForm({
      name: "", intensity: "standard", engines: ["nuclei"], authenticated: false,
      credential_id: null, safe_mode: true, max_requests_per_sec: 10, scan_window: null, web_scan: false,
    });

  const toggleEngine = (e: string) =>
    setProfileForm((prev) => ({
      ...prev,
      engines: prev.engines.includes(e) ? prev.engines.filter((x) => x !== e) : [...prev.engines, e],
    }));

  const handleCreateProfile = async () => {
    if (!canWrite) return;
    if (!profileForm.name || profileForm.engines.length === 0) {
      toast({ title: "Missing information", description: "Provide a name and at least one engine.", variant: "destructive" });
      return;
    }
    if (profileForm.authenticated && !profileForm.credential_id) {
      toast({ title: "Credential required", description: "Authenticated profiles need a credential.", variant: "destructive" });
      return;
    }
    setSavingProfile(true);
    try {
      const created = await createProfile({
        ...profileForm,
        credential_id: profileForm.authenticated ? profileForm.credential_id : null,
      });
      setProfiles((prev) => [...prev, created]);
      toast({ title: "Profile created", description: created.name });
      setProfileOpen(false);
      resetProfileForm();
    } catch (e: any) {
      toast({ title: "Failed to create profile", description: e.message ?? "Unexpected error", variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDeleteProfile = async (p: VsProfile) => {
    if (!canWrite) return;
    setBusyId(p.id);
    try {
      await deleteProfile(p.id);
      setProfiles((prev) => prev.filter((x) => x.id !== p.id));
      toast({ title: "Profile deleted", description: p.name });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message ?? "Unexpected error", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateCred = async () => {
    if (!canWrite) return;
    if (!credForm.name || !credForm.secret) {
      toast({ title: "Missing information", description: "Provide a name and secret.", variant: "destructive" });
      return;
    }
    setSavingCred(true);
    try {
      const created = await createCredential({
        name: credForm.name,
        cred_type: credForm.cred_type,
        username: credForm.username || undefined,
        secret: credForm.secret,
      });
      setCredentials((prev) => [...prev, created]);
      toast({ title: "Credential added", description: created.name });
      setCredOpen(false);
      setCredForm({ name: "", cred_type: "ssh", username: "", secret: "" });
    } catch (e: any) {
      toast({ title: "Failed to add credential", description: e.message ?? "Unexpected error", variant: "destructive" });
    } finally {
      setSavingCred(false);
    }
  };

  const handleDeleteCred = async (c: VsCredential) => {
    if (!canWrite) return;
    setBusyId(c.id);
    try {
      await deleteCredential(c.id);
      setCredentials((prev) => prev.filter((x) => x.id !== c.id));
      toast({ title: "Credential deleted", description: c.name });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message ?? "Unexpected error", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Scan Settings</h2>
          <p className="text-sm text-muted-foreground">Manage scan profiles and authentication credentials</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-2" /> Retry</Button>
        </div>
      )}

      {/* Scan Profiles */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10"><Shield className="w-5 h-5 text-primary" /></div>
            <div>
              <h3 className="font-semibold text-foreground">Scan Profiles</h3>
              <p className="text-sm text-muted-foreground">Reusable engine + intensity configurations</p>
            </div>
          </div>
          {canWrite && (
            <Button variant="gradient" size="sm" onClick={() => { resetProfileForm(); setProfileOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> New Profile
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
        ) : profiles.length === 0 ? (
          <EmptyState icon={Shield} title="No scan profiles" description="Create a profile to define scan intensity and engines." />
        ) : (
          <div className="space-y-3">
            {profiles.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-4 p-4 rounded-xl bg-muted/30">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{p.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary capitalize">{p.intensity}</span>
                    {p.authenticated && <span className="text-xs px-2 py-0.5 rounded-full bg-secondary/10 text-secondary flex items-center gap-1"><Lock className="w-3 h-3" />Auth</span>}
                    {p.web_scan && <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent">Web</span>}
                    {p.safe_mode && <span className="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">Safe mode</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Engines: {p.engines.join(", ") || "—"} • {p.max_requests_per_sec} req/s
                    {p.scan_window ? ` • Window: ${p.scan_window}` : ""}
                  </div>
                </div>
                {canWrite && (
                  <Button variant="ghost" size="icon" className="text-destructive" disabled={busyId === p.id} onClick={() => handleDeleteProfile(p)}>
                    {busyId === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Credentials */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card rounded-2xl border border-border p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-secondary/10"><Key className="w-5 h-5 text-secondary" /></div>
            <div>
              <h3 className="font-semibold text-foreground">Credentials</h3>
              <p className="text-sm text-muted-foreground">Secrets for authenticated scans (write-only, never displayed)</p>
            </div>
          </div>
          {canWrite && (
            <Button variant="gradient" size="sm" onClick={() => { setCredForm({ name: "", cred_type: "ssh", username: "", secret: "" }); setCredOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Add Credential
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
        ) : credentials.length === 0 ? (
          <EmptyState icon={Key} title="No credentials" description="Add a credential to enable authenticated scanning." />
        ) : (
          <div className="space-y-3">
            {credentials.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-4 p-4 rounded-xl bg-muted/30">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase">{c.cred_type}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {c.username ? `User: ${c.username} • ` : ""}Secret: •••••••• (hidden)
                  </div>
                </div>
                {canWrite && (
                  <Button variant="ghost" size="icon" className="text-destructive" disabled={busyId === c.id} onClick={() => handleDeleteCred(c)}>
                    {busyId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Profile Dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Zap className="w-5 h-5 text-primary" />New Scan Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} placeholder="e.g., Standard External" />
            </div>
            <div className="space-y-2">
              <Label>Intensity</Label>
              <Select value={profileForm.intensity} onValueChange={(v) => setProfileForm({ ...profileForm, intensity: v as VsIntensity })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="deep">Deep</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Engines</Label>
              <div className="flex flex-wrap gap-3">
                {ENGINE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={profileForm.engines.includes(opt.value)} onCheckedChange={() => toggleEngine(opt.value)} />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Max requests/sec</Label>
                <Input type="number" min={1} value={profileForm.max_requests_per_sec}
                  onChange={(e) => setProfileForm({ ...profileForm, max_requests_per_sec: parseInt(e.target.value) || 1 })} />
              </div>
              <div className="space-y-2">
                <Label>Scan window (optional)</Label>
                <Input value={profileForm.scan_window ?? ""} placeholder="e.g., 22:00-06:00"
                  onChange={(e) => setProfileForm({ ...profileForm, scan_window: e.target.value || null })} />
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
              <div><div className="text-sm font-medium">Safe mode</div><div className="text-xs text-muted-foreground">Avoid intrusive checks</div></div>
              <Switch checked={profileForm.safe_mode} onCheckedChange={(c) => setProfileForm({ ...profileForm, safe_mode: c })} />
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
              <div><div className="text-sm font-medium">Web scan</div><div className="text-xs text-muted-foreground">Include web application checks</div></div>
              <Switch checked={profileForm.web_scan} onCheckedChange={(c) => setProfileForm({ ...profileForm, web_scan: c })} />
            </div>
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30">
              <div><div className="text-sm font-medium">Authenticated</div><div className="text-xs text-muted-foreground">Use a stored credential</div></div>
              <Switch
                checked={profileForm.authenticated}
                onCheckedChange={(c) => setProfileForm({ ...profileForm, authenticated: c, credential_id: c ? profileForm.credential_id : null })}
              />
            </div>
            {profileForm.authenticated && (
              <div className="space-y-2">
                <Label>Credential</Label>
                {credentials.length === 0 ? (
                  <p className="text-xs text-warning">No credentials available. Add one first.</p>
                ) : (
                  <Select value={profileForm.credential_id ?? ""} onValueChange={(v) => setProfileForm({ ...profileForm, credential_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select credential" /></SelectTrigger>
                    <SelectContent>
                      {credentials.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setProfileOpen(false)}>Cancel</Button>
              <Button variant="gradient" onClick={handleCreateProfile} disabled={savingProfile}>
                {savingProfile ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Create
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Credential Dialog */}
      <Dialog open={credOpen} onOpenChange={setCredOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Key className="w-5 h-5 text-secondary" />Add Credential</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={credForm.name} onChange={(e) => setCredForm({ ...credForm, name: e.target.value })} placeholder="e.g., Prod SSH key" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={credForm.cred_type} onValueChange={(v) => setCredForm({ ...credForm, cred_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ssh">SSH</SelectItem>
                    <SelectItem value="password">Password</SelectItem>
                    <SelectItem value="api_key">API Key</SelectItem>
                    <SelectItem value="token">Token</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Username (optional)</Label>
                <Input value={credForm.username} onChange={(e) => setCredForm({ ...credForm, username: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Secret *</Label>
              <Input type="password" autoComplete="new-password" value={credForm.secret}
                onChange={(e) => setCredForm({ ...credForm, secret: e.target.value })} placeholder="Stored write-only; never shown again" />
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setCredOpen(false)}>Cancel</Button>
              <Button variant="gradient" onClick={handleCreateCred} disabled={savingCred}>
                {savingCred ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}Add
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
