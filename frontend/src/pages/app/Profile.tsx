// Profile — edit synced profile fields (name, country, phone, avatar URL).
// Avatar upload to Supabase Storage is a follow-up; this stores an avatar URL.

import { useEffect, useState } from "react";
import { getMe, updateProfile } from "@/lib/services/auth";
import { toast } from "@/hooks/use-toast";

export default function Profile() {
  const [email, setEmail] = useState("");
  const [orgName, setOrgName] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [fullName, setFullName] = useState("");
  const [country, setCountry] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMe()
      .then((me) => {
        setEmail(me.email);
        setOrgName(me.org_name);
        setRole(me.role);
        setFullName(me.full_name || "");
        setCountry(me.country || "");
        setPhone(me.phone || "");
        setAvatarUrl(me.avatar_url || "");
      })
      .finally(() => setLoading(false));
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({ full_name: fullName, country, phone, avatar_url: avatarUrl });
      toast({ title: "Profile saved" });
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading profile…</div>;

  return (
    <div className="max-w-xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-sm text-muted-foreground">
          {email} · {orgName ?? "—"} · <span className="capitalize">{role}</span>
        </p>
      </div>

      <form onSubmit={onSave} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Full name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Country</label>
            <input value={country} onChange={(e) => setCountry(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Avatar URL</label>
          <input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://…" className="w-full rounded-md border px-3 py-2 text-sm" />
        </div>
        <button type="submit" disabled={saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {saving ? "Saving…" : "Save profile"}
        </button>
      </form>
    </div>
  );
}
