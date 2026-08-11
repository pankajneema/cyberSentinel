// Profile — edit synced profile fields (name, country, phone, avatar URL).
// Real file upload (object storage) is a follow-up; this stores an avatar URL.

import { useEffect, useState } from "react";
import { updateProfile } from "@/lib/services/auth";
import { useMe, refreshMe } from "@/hooks/useMe";
import { toast } from "@/hooks/use-toast";

export default function Profile() {
  const { me, loading } = useMe();
  const [fullName, setFullName] = useState("");
  const [country, setCountry] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const email = me?.email ?? "";
  const orgName = me?.org_name ?? null;
  const role = me?.role ?? "";

  useEffect(() => {
    if (!me) return;
    setFullName(me.full_name || "");
    setCountry(me.country || "");
    setPhone(me.phone || "");
    setAvatarUrl(me.avatar_url || "");
  }, [me]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({ full_name: fullName, country, phone, avatar_url: avatarUrl });
      void refreshMe().catch(() => {});
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
