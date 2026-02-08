import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Mail,
  Shield,
  Globe,
  Smartphone,
  Key,
  Check,
  Building,
  User,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  changePassword,
  getProfile,
  updateAvatar,
  updateProfile,
} from "@/lib/services/profile";
import { getSettings, updateSettings } from "@/lib/services/settings";
import { getCurrentUser } from "@/lib/services/user";
import { getAccount, updateAccount } from "@/lib/services/account";
import { getCurrentPlan, listInvoices } from "@/lib/services/billing";

export default function Account() {
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<{ full_name: string; email: string; phone?: string; country?: string; avatar_url?: string; role?: string; is_superadmin?: boolean } | null>(null);
  const [profileForm, setProfileForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    country: "",
  });
  const [avatarUrl, setAvatarUrl] = useState("");
  const [currentUser, setCurrentUser] = useState<{ id: string; role: string; company_id?: string | null } | null>(null);
  const [account, setAccount] = useState<{ id: string; name: string; plan: string } | null>(null);
  const [accountName, setAccountName] = useState("");
  const [settings, setSettings] = useState<{ notifications: { email: boolean; slack: boolean; push: boolean }; preferences: { theme: "light" | "dark" | "system"; language: string; timezone: string } } | null>(null);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [plan, setPlan] = useState<{ plan: string; billing_period: string; status: string } | null>(null);
  const [invoices, setInvoices] = useState<Array<{ id: string; amount: number; status: string; created_at: string }>>([]);

  const role = profile?.role || currentUser?.role || "reader";
  const isAdmin = role === "admin";
  const isSuperadmin = profile?.is_superadmin;
  const isAnalystOrReader = role === "analyst" || role === "reader";

  useEffect(() => {
    const loadAll = async () => {
      try {
        setIsLoading(true);
        const user = await getCurrentUser();
        setCurrentUser(user);

        const [profileRes, settingsRes] = await Promise.all([
          getProfile(),
          getSettings(),
        ]);

        setProfile(profileRes);
        setProfileForm({
          full_name: profileRes.full_name || "",
          email: profileRes.email || "",
          phone: profileRes.phone || "",
          country: profileRes.country || "",
        });
        setAvatarUrl(profileRes.avatar_url || "");
        setSettings(settingsRes);

        if (user.company_id) {
          const acct = await getAccount(user.company_id);
          setAccount(acct);
          setAccountName(acct.name);
        } else {
          setAccount(null);
        }

        if (profileRes.is_superadmin) {
          try {
            const [planRes, invoicesRes] = await Promise.all([
              getCurrentPlan(),
              listInvoices(),
            ]);
            setPlan(planRes);
            setInvoices(invoicesRes);
          } catch {
            setPlan(null);
            setInvoices([]);
          }
        } else {
          setPlan(null);
          setInvoices([]);
        }
      } catch (error: any) {
        toast({ title: "Failed to load account", description: error?.message || "Please try again" });
      } finally {
        setIsLoading(false);
      }
    };

    loadAll();
  }, []);

  const avatarFallback = useMemo(() => {
    if (profile?.full_name) {
      const parts = profile.full_name.trim().split(/\s+/);
      return parts.map((p) => p[0]).slice(0, 2).join("").toUpperCase();
    }
    return "U";
  }, [profile?.full_name]);

  const handleSaveProfile = async () => {
    try {
      const updated = await updateProfile({
        full_name: profileForm.full_name || undefined,
        email: profileForm.email || undefined,
        phone: profileForm.phone || undefined,
        country: profileForm.country || undefined,
      });
      setProfile(updated);

      if (account && isAdmin && accountName && accountName !== account.name) {
        const updatedAccount = await updateAccount(account.id, { name: accountName });
        setAccount(updatedAccount);
      }

      if (settings) {
        const updatedSettings = await updateSettings(settings);
        setSettings(updatedSettings);
      }

      toast({ title: "Profile Updated", description: "Your profile has been saved." });
    } catch (error: any) {
      toast({ title: "Update failed", description: error?.message || "Please try again" });
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;
    try {
      const updated = await updateSettings(settings);
      setSettings(updated);
      toast({ title: "Settings saved", description: "Your preferences were updated." });
    } catch (error: any) {
      toast({ title: "Settings failed", description: error?.message || "Please try again" });
    }
  };

  const handleUpdateAvatar = async () => {
    if (!avatarUrl.trim()) {
      toast({ title: "Avatar URL required", description: "Paste a valid image URL." });
      return;
    }
    try {
      const updated = await updateAvatar({ avatar_url: avatarUrl.trim() });
      setProfile(updated);
      toast({ title: "Avatar Updated", description: "Your photo was updated." });
    } catch (error: any) {
      toast({ title: "Avatar update failed", description: error?.message || "Please try again" });
    }
  };

  const handleChangePassword = async () => {
    if (!passwordForm.current || !passwordForm.next) {
      toast({ title: "Missing fields", description: "Enter your current and new password." });
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      toast({ title: "Password mismatch", description: "New passwords do not match." });
      return;
    }
    try {
      await changePassword({ current_password: passwordForm.current, new_password: passwordForm.next });
      setPasswordForm({ current: "", next: "", confirm: "" });
      toast({ title: "Password Updated", description: "Your password was changed." });
    } catch (error: any) {
      toast({ title: "Password update failed", description: error?.message || "Please try again" });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Account Settings</h1>
          <p className="text-muted-foreground mt-1">Loading your account…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Account Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and billing</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList className="flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          {!isAnalystOrReader && <TabsTrigger value="notifications">Notifications</TabsTrigger>}
          {isSuperadmin && <TabsTrigger value="billing">Billing</TabsTrigger>}
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-6">Personal Information</h3>
            <div className="flex items-start gap-6 mb-6">
              <Avatar className="w-20 h-20">
                <AvatarImage src={profile?.avatar_url || ""} />
                <AvatarFallback className="text-xl bg-primary text-primary-foreground">{avatarFallback}</AvatarFallback>
              </Avatar>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">Change Photo</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Update Avatar</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Label>Avatar URL</Label>
                    <Input
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://..."
                    />
                    <div className="flex justify-end">
                      <Button variant="gradient" onClick={handleUpdateAvatar}>Save</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Input
                  value={profileForm.full_name}
                  onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input
                  type="email"
                  value={profileForm.email}
                  onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <div className="flex items-center gap-2">
                  <Building className="w-4 h-4 text-muted-foreground" />
                  <Input
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    disabled={!account || !isAdmin}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <Input value={profile?.role || currentUser?.role || ""} disabled />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Country</Label>
                <Input
                  value={profileForm.country}
                  onChange={(e) => setProfileForm({ ...profileForm, country: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Select
                  value={settings?.preferences.timezone || "UTC"}
                  onValueChange={(v) =>
                    setSettings((prev) =>
                      prev
                        ? { ...prev, preferences: { ...prev.preferences, timezone: v } }
                        : prev
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UTC">UTC</SelectItem>
                    <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                    <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                    <SelectItem value="Asia/Kolkata">India Standard Time (IST)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <Button variant="gradient" onClick={handleSaveProfile}>
                Save Changes
              </Button>
            </div>
          </motion.div>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4">Password</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Current Password</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={passwordForm.current}
                  onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                />
              </div>
              <div></div>
              <div className="space-y-2">
                <Label>New Password</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={passwordForm.next}
                  onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Confirm New Password</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={passwordForm.confirm}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <Button variant="outline" onClick={handleChangePassword}>
                Update Password
              </Button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card-elevated p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-foreground">Two-Factor Authentication</h3>
                <p className="text-sm text-muted-foreground">Add an extra layer of security to your account</p>
              </div>
              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/20">Not Enabled</Badge>
            </div>
            <Button variant="outline">
              <Smartphone className="w-4 h-4 mr-2" />
              Enable 2FA
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4">API Keys</h3>
            <div className="text-sm text-muted-foreground">
              API keys are managed in the Security Center. This section will be wired next.
            </div>
            <Button variant="outline" className="mt-4" disabled>
              <Key className="w-4 h-4 mr-2" />
              Generate New API Key
            </Button>
          </motion.div>
        </TabsContent>

        {/* Notifications Tab */}
        {!isAnalystOrReader && (
        <TabsContent value="notifications" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-6">Notification Preferences</h3>
            <div className="space-y-6">
              {[
                { key: "email", label: "Email Alerts", description: "Receive security alerts via email", icon: Mail },
                { key: "push", label: "Critical Only", description: "Only receive critical severity alerts", icon: Shield },
                { key: "slack", label: "Slack Notifications", description: "Send alerts to Slack channels", icon: Globe },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <item.icon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{item.label}</div>
                      <div className="text-sm text-muted-foreground">{item.description}</div>
                    </div>
                  </div>
                  <Switch
                    checked={settings?.notifications?.[item.key as "email" | "push" | "slack"] || false}
                    onCheckedChange={(checked) =>
                      setSettings((prev) =>
                        prev
                          ? { ...prev, notifications: { ...prev.notifications, [item.key]: checked } }
                          : prev
                      )
                    }
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-6">
              <Button variant="gradient" onClick={handleSaveSettings}>
                Save Preferences
              </Button>
            </div>
          </motion.div>
        </TabsContent>
        )}

        {/* Billing Tab */}
        {isSuperadmin && (
        <TabsContent value="billing" className="mt-6 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-elevated p-6"
          >
            <div className="flex items-start justify-between mb-6">
              <div>
                <h3 className="font-semibold text-foreground">Current Plan</h3>
                <p className="text-sm text-muted-foreground">Subscription status and billing period</p>
              </div>
              {plan && <Badge className="bg-primary text-primary-foreground">{plan.plan}</Badge>}
            </div>
            {plan ? (
              <div className="grid sm:grid-cols-3 gap-4 mb-6">
                <div className="p-4 bg-muted/30 rounded-lg">
                  <div className="text-2xl font-bold text-foreground">{plan.plan.toUpperCase()}</div>
                  <div className="text-sm text-muted-foreground">Plan</div>
                </div>
                <div className="p-4 bg-muted/30 rounded-lg">
                  <div className="text-2xl font-bold text-foreground">{plan.billing_period}</div>
                  <div className="text-sm text-muted-foreground">Billing period</div>
                </div>
                <div className="p-4 bg-muted/30 rounded-lg">
                  <div className="text-2xl font-bold text-foreground">{plan.status}</div>
                  <div className="text-sm text-muted-foreground">Status</div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No subscription data available.</div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="card-elevated p-6"
          >
            <h3 className="font-semibold text-foreground mb-4">Billing History</h3>
            {invoices.length === 0 ? (
              <div className="text-sm text-muted-foreground">No invoices yet.</div>
            ) : (
              <div className="space-y-3">
                {invoices.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 border-b border-border last:border-0"
                  >
                    <div>
                      <div className="font-medium text-foreground">Invoice #{item.id.slice(0, 8)}</div>
                      <div className="text-sm text-muted-foreground">{new Date(item.created_at).toLocaleDateString()}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-foreground">${item.amount.toFixed(2)}</span>
                      <Badge variant="secondary" className="bg-success/10 text-success">
                        <Check className="w-3 h-3 mr-1" />
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
