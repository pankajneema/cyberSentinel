// Auditor portal — token-based, read-only, deliberately outside the app shell.
// Auditor tokens are NOT regular login sessions: they are opaque grants
// scoped to a single audit, verified server-side on every request. No
// sidebar, no app nav.
import { useEffect, useState } from "react";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  CaControl, CaControlDetail, auditorControlDetail, auditorControls, auditorMe,
  auditorRaiseFinding,
} from "@/lib/services/ca";
import { CollectionBadge, ControlStatusBadge, EvidenceStatusBadge } from "@/components/ca/CaStatusBadge";
import { SeverityBadge } from "@/components/asm/SeverityBadge";

const TOKEN_KEY = "ca_auditor_token";

export default function AuditorPortal() {
  const [token, setToken] = useState<string>(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [tokenInput, setTokenInput] = useState("");
  const [me, setMe] = useState<Awaited<ReturnType<typeof auditorMe>> | null>(null);
  const [controls, setControls] = useState<CaControl[]>([]);
  const [detail, setDetail] = useState<CaControlDetail | null>(null);
  const [findingOpen, setFindingOpen] = useState(false);
  const [findingTitle, setFindingTitle] = useState("");
  const [findingDesc, setFindingDesc] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const [m, c] = await Promise.all([auditorMe(token), auditorControls(token)]);
        if (cancelled) return;
        setMe(m);
        setControls(c.items);
        setError("");
      } catch {
        if (!cancelled) {
          setError("Token invalid, expired, or revoked.");
          setMe(null);
          sessionStorage.removeItem(TOKEN_KEY);
          setToken("");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const signIn = () => {
    sessionStorage.setItem(TOKEN_KEY, tokenInput.trim());
    setToken(tokenInput.trim());
    setTokenInput("");
  };

  const signOut = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(""); setMe(null); setControls([]);
  };

  const openDetail = async (id: string) => {
    try {
      setDetail(await auditorControlDetail(token, id));
    } catch (e) {
      toast({ title: "Failed to load control", description: String(e), variant: "destructive" });
    }
  };

  const raiseFinding = async () => {
    try {
      await auditorRaiseFinding(token, {
        control_id: detail?.id, title: findingTitle, description: findingDesc || undefined,
      });
      toast({ title: "Finding submitted to the organization" });
      setFindingOpen(false); setFindingTitle(""); setFindingDesc("");
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    }
  };

  if (!me) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="bg-card rounded-2xl border border-border shadow-sm p-8 w-full max-w-md">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-xl bg-primary/10">
              <KeyRound className="w-6 h-6 text-primary" />
            </div>
            <h1 className="font-heading font-bold text-xl">Auditor Portal</h1>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Enter the access token issued by the organization. Access is read-only and limited to the
            evidence in scope for your audit; every access is logged.
          </p>
          <Input type="password" placeholder="Access token" value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && tokenInput.trim() && signIn()} />
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          <Button className="w-full mt-4 rounded-xl" onClick={signIn} disabled={!tokenInput.trim()}>
            Access audit
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10"><ShieldCheck className="w-5 h-5 text-primary" /></div>
            <div>
              <h1 className="font-heading font-bold">{me.audit.name}</h1>
              <p className="text-xs text-muted-foreground">
                {me.framework.name} v{me.framework.version} · read-only access for {me.auditor_email} ·
                expires {new Date(me.expires_at).toLocaleDateString()}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="rounded-xl" onClick={signOut}>
            <LogOut className="w-4 h-4 mr-2" /> Exit
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Ref</TableHead>
                <TableHead>Control</TableHead>
                <TableHead className="w-28">Criticality</TableHead>
                <TableHead className="w-36">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {controls.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => openDetail(c.id)}>
                  <TableCell className="font-mono text-xs">{c.control_ref}</TableCell>
                  <TableCell className="font-medium">{c.title}</TableCell>
                  <TableCell><SeverityBadge severity={c.criticality as never} /></TableCell>
                  <TableCell><ControlStatusBadge status={c.state.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </main>

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="font-heading">
                  <span className="font-mono text-sm text-muted-foreground mr-2">{detail.control_ref}</span>
                  {detail.title}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-2">
                  {detail.state && <ControlStatusBadge status={detail.state.status} />}
                  <SeverityBadge severity={detail.criticality as never} />
                </div>
                <p className="text-sm text-muted-foreground">{detail.description}</p>
                <div>
                  <h4 className="font-heading font-semibold text-sm mb-2">Evidence</h4>
                  <div className="space-y-2">
                    {detail.evidence.map((ev) => (
                      <div key={ev.id} className="border border-border rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CollectionBadge collection={ev.collection} />
                            <EvidenceStatusBadge status={ev.status} />
                            {ev.result && (
                              <span className={`text-xs font-semibold ${ev.result === "pass" ? "text-success" : "text-destructive"}`}>
                                {ev.result.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {ev.captured_at && new Date(ev.captured_at).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-sm mt-1.5">{ev.summary}</p>
                        <p className="text-[11px] text-muted-foreground font-mono mt-1">
                          integrity sha256:{ev.content_hash.slice(0, 24)}…
                        </p>
                      </div>
                    ))}
                    {detail.evidence.length === 0 && (
                      <p className="text-sm text-muted-foreground">No evidence recorded for this control.</p>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setFindingOpen(true)}>
                  Raise a finding on this control
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={findingOpen} onOpenChange={setFindingOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Raise audit finding</DialogTitle></DialogHeader>
          <Input placeholder="Title *" value={findingTitle} onChange={(e) => setFindingTitle(e.target.value)} />
          <Textarea placeholder="Description" value={findingDesc} onChange={(e) => setFindingDesc(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFindingOpen(false)}>Cancel</Button>
            <Button onClick={raiseFinding} disabled={findingTitle.trim().length < 3}>Submit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
