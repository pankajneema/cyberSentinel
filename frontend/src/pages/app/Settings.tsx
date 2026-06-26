// Settings — notifications, UI preferences, and a security tab (MFA / sessions).
// MFA enrollment + active-session listing use Supabase; wired minimally here.

import { useEffect, useState } from "react";
import { getMemberSettings, putMemberSettings } from "@/lib/services/auth";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/services/notifications";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";

type Tab = "notifications" | "preferences" | "security";

export default function Settings() {
  const [tab, setTab] = useState<Tab>("notifications");
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [weeklyDigest, setWeeklyDigest] = useState(false);
  const [theme, setTheme] = useState("system");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Notification delivery channels (real, persisted via the notifications API).
  const [channels, setChannels] = useState<NotificationPreferences | null>(null);
  const [savingChannels, setSavingChannels] = useState(false);

  useEffect(() => {
    getMemberSettings()
      .then((s) => {
        const n = s.notifications as Record<string, boolean>;
        const p = s.preferences as Record<string, string>;
        if (n?.email_alerts !== undefined) setEmailAlerts(!!n.email_alerts);
        if (n?.weekly_digest !== undefined) setWeeklyDigest(!!n.weekly_digest);
        if (p?.theme) setTheme(p.theme);
      })
      .finally(() => setLoading(false));
    getNotificationPreferences()
      .then(setChannels)
      .catch(() => {/* leave null; section hidden until available */});
  }, []);

  async function saveChannels(next: NotificationPreferences) {
    setChannels(next);
    setSavingChannels(true);
    try {
      const saved = await updateNotificationPreferences(next);
      setChannels(saved);
      toast({ title: "Notification preferences saved" });
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "" });
    } finally {
      setSavingChannels(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await putMemberSettings({
        notifications: { email_alerts: emailAlerts, weekly_digest: weeklyDigest },
        preferences: { theme },
      });
      toast({ title: "Settings saved" });
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "" });
    } finally {
      setSaving(false);
    }
  }

  async function enrollMfa() {
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
      if (error) throw error;
      const uri = data?.totp?.uri;
      toast({
        title: "MFA enrollment started",
        description: uri ? "Scan the TOTP QR in your authenticator app." : "Follow the prompts.",
      });
    } catch (err) {
      toast({ title: "MFA error", description: err instanceof Error ? err.message : "" });
    }
  }

  async function signOutEverywhere() {
    await supabase.auth.signOut({ scope: "global" });
    window.location.href = "/login";
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading settings…</div>;

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="flex gap-2 border-b">
        {(["notifications", "preferences", "security"] as Tab[]).map((t) => (
          <button
            key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize ${tab === t ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "notifications" && (
        <div className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={emailAlerts} onChange={(e) => setEmailAlerts(e.target.checked)} />
            Email me about new high-risk exposures
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={weeklyDigest} onChange={(e) => setWeeklyDigest(e.target.checked)} />
            Weekly summary digest
          </label>
          <button onClick={save} disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>

          {channels && (
            <div className="mt-4 space-y-3 rounded-lg border p-4">
              <div>
                <h3 className="text-sm font-semibold">Delivery channels</h3>
                <p className="text-xs text-muted-foreground">How you receive notifications.</p>
              </div>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={channels.in_app}
                  disabled={savingChannels}
                  onChange={(e) => saveChannels({ ...channels, in_app: e.target.checked })}
                />
                In-app notifications
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={channels.email}
                  disabled={savingChannels}
                  onChange={(e) => saveChannels({ ...channels, email: e.target.checked })}
                />
                Email notifications
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={channels.push}
                  disabled={savingChannels}
                  onChange={(e) => saveChannels({ ...channels, push: e.target.checked })}
                />
                Push notifications
              </label>
            </div>
          )}
        </div>
      )}

      {tab === "preferences" && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Theme</label>
            <select value={theme} onChange={(e) => setTheme(e.target.value)}
              className="rounded-md border px-3 py-2 text-sm">
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <button onClick={save} disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {tab === "security" && (
        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold">Multi-factor authentication</h3>
            <p className="mb-3 text-sm text-muted-foreground">Add a TOTP authenticator for extra security.</p>
            <button onClick={enrollMfa} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent">
              Enroll authenticator app
            </button>
          </div>
          <div className="rounded-lg border p-4">
            <h3 className="text-sm font-semibold">Sessions</h3>
            <p className="mb-3 text-sm text-muted-foreground">Sign out of all devices.</p>
            <button onClick={signOutEverywhere} className="rounded-md border px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10">
              Sign out everywhere
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
