import { useEffect, useState } from "react";
import { Copy, KeyRound, ScrollText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/asm/EmptyState";
import { toast } from "@/hooks/use-toast";
import {
  CaAudit, CaAuditorGrant, CaFramework, createAudit, createGrant, fetchAuditFindings,
  fetchAudits, fetchFrameworks, fetchGrants, revokeGrant,
} from "@/lib/services/ca";

export function AuditManager({ isAdmin }: { isAdmin: boolean }) {
  const [audits, setAudits] = useState<CaAudit[]>([]);
  const [frameworks, setFrameworks] = useState<CaFramework[]>([]);
  const [selected, setSelected] = useState<CaAudit | null>(null);
  const [grants, setGrants] = useState<CaAuditorGrant[]>([]);
  const [findings, setFindings] = useState<Array<{ id: string; title: string; severity?: string; status: string }>>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [firm, setFirm] = useState("");
  const [fwId, setFwId] = useState("");
  const [grantEmail, setGrantEmail] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchAudits(), fetchFrameworks()])
      .then(([a, f]) => {
        if (cancelled) return;
        setAudits(a.items);
        setFrameworks(f.items.filter((x) => x.enabled));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [reload]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    Promise.all([fetchGrants(selected.id), fetchAuditFindings(selected.id)])
      .then(([g, f]) => { if (!cancelled) { setGrants(g.items); setFindings(f.items); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selected, reload]);

  const submitCreate = async () => {
    try {
      await createAudit({ framework_id: fwId, name, audit_firm: firm || undefined });
      toast({ title: "Audit created" });
      setCreateOpen(false); setName(""); setFirm("");
      setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    }
  };

  const issueGrant = async () => {
    if (!selected) return;
    try {
      const r = await createGrant(selected.id, { auditor_email: grantEmail, expires_in_days: 30 });
      setIssuedToken(r.token);
      setGrantEmail("");
      setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    }
  };

  const doRevoke = async (g: CaAuditorGrant) => {
    if (!selected) return;
    try {
      await revokeGrant(selected.id, g.id);
      toast({ title: "Grant revoked" });
      setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {isAdmin && (
          <Button className="rounded-xl" onClick={() => setCreateOpen(true)} disabled={!frameworks.length}>
            <ScrollText className="w-4 h-4 mr-2" /> New audit
          </Button>
        )}
      </div>

      {audits.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audits"
          description="Create an audit instance to package evidence per control and give your auditor scoped, read-only access." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            {audits.map((a) => (
              <div key={a.id}
                className={`bg-card rounded-2xl border shadow-sm p-4 cursor-pointer ${selected?.id === a.id ? "border-primary/40" : "border-border"}`}
                onClick={() => setSelected(a)}>
                <div className="flex items-center justify-between">
                  <h3 className="font-heading font-bold text-sm">{a.name}</h3>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted border border-border">{a.status}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {frameworks.find((f) => f.id === a.framework_id)?.name ?? "…"}
                  {a.audit_firm && ` · ${a.audit_firm}`}
                </p>
              </div>
            ))}
          </div>

          {selected && (
            <div className="bg-card rounded-2xl border border-border shadow-sm p-5 space-y-5">
              <div>
                <h4 className="font-heading font-semibold text-sm mb-2 flex items-center gap-2">
                  <KeyRound className="w-4 h-4" /> Auditor access (read-only, scoped)
                </h4>
                {isAdmin && (
                  <div className="flex gap-2">
                    <Input placeholder="auditor@firm.com" value={grantEmail}
                      onChange={(e) => setGrantEmail(e.target.value)} />
                    <Button size="sm" className="rounded-xl" onClick={issueGrant}
                      disabled={!grantEmail.includes("@")}>Issue token</Button>
                  </div>
                )}
                <div className="space-y-2 mt-3">
                  {grants.map((g) => (
                    <div key={g.id} className="flex items-center justify-between text-sm border border-border rounded-xl px-3 py-2">
                      <div>
                        <p className="font-medium">{g.auditor_email}</p>
                        <p className="text-[11px] text-muted-foreground">
                          expires {new Date(g.expires_at).toLocaleDateString()}
                          {g.revoked_at && " · REVOKED"}
                          {g.last_access_at && ` · last access ${new Date(g.last_access_at).toLocaleString()}`}
                        </p>
                      </div>
                      {isAdmin && !g.revoked_at && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => doRevoke(g)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {grants.length === 0 && <p className="text-xs text-muted-foreground">No auditor grants.</p>}
                </div>
              </div>

              <div>
                <h4 className="font-heading font-semibold text-sm mb-2">Auditor-raised findings</h4>
                <div className="space-y-2">
                  {findings.map((f) => (
                    <div key={f.id} className="border border-border rounded-xl px-3 py-2 text-sm flex items-center justify-between">
                      <span>{f.title}</span>
                      <span className="text-[11px] text-muted-foreground">{f.status}</span>
                    </div>
                  ))}
                  {findings.length === 0 && <p className="text-xs text-muted-foreground">None raised.</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create audit */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New audit</DialogTitle></DialogHeader>
          <Input placeholder="Name (e.g. SOC 2 Type II FY2026) *" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Audit firm (optional)" value={firm} onChange={(e) => setFirm(e.target.value)} />
          <Select value={fwId} onValueChange={setFwId}>
            <SelectTrigger><SelectValue placeholder="Framework *" /></SelectTrigger>
            <SelectContent>
              {frameworks.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={submitCreate} disabled={name.trim().length < 3 || !fwId}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time token display */}
      <Dialog open={!!issuedToken} onOpenChange={(o) => !o && setIssuedToken(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Auditor token — shown once</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Share this token with the auditor over a secure channel. It is stored only as a hash and
            cannot be recovered — issue a new grant if lost. The auditor signs in at{" "}
            <span className="font-mono">{window.location.origin}/auditor</span>.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={issuedToken ?? ""} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={() => {
              navigator.clipboard.writeText(issuedToken ?? "");
              toast({ title: "Copied" });
            }}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
