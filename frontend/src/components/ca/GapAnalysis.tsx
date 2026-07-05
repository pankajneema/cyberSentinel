import { useEffect, useState } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/asm/EmptyState";
import { SeverityBadge } from "@/components/asm/SeverityBadge";
import { toast } from "@/hooks/use-toast";
import { CaGap, GapStatus, fetchGaps, fetchGapsSummary, transitionGap } from "@/lib/services/ca";
import { GAP_STATUS_LABEL, GapStatusBadge } from "./CaStatusBadge";

// Forward-only remediation map — same idiom as VSRemediation NEXT_STEP.
const NEXT_STEP: Partial<Record<GapStatus, { to: GapStatus; label: string }>> = {
  open: { to: "in_progress", label: "Start remediation" },
  in_progress: { to: "resolved", label: "Mark resolved" },
  resolved: { to: "verified", label: "Verify" },
  verified: { to: "closed", label: "Close" },
};

export function GapAnalysis({ canWrite }: { canWrite: boolean }) {
  const [gaps, setGaps] = useState<CaGap[]>([]);
  const [summary, setSummary] = useState<{ by_status: Record<string, number>; sla_breaches: number } | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CaGap | null>(null);
  const [justifyTarget, setJustifyTarget] = useState<{ gap: CaGap; to: GapStatus } | null>(null);
  const [justification, setJustification] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchGaps({ status: statusFilter === "all" ? undefined : statusFilter, page_size: 100 }),
      fetchGapsSummary(),
    ])
      .then(([g, s]) => { if (!cancelled) { setGaps(g.items); setSummary(s); } })
      .catch(() => { if (!cancelled) setGaps([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [statusFilter, reload]);

  const doTransition = async (gap: CaGap, to: GapStatus, justificationText?: string) => {
    try {
      await transitionGap(gap.id, { status: to, justification: justificationText });
      toast({ title: `Gap → ${GAP_STATUS_LABEL[to]}` });
      setSelected(null); setJustifyTarget(null); setJustification("");
      setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Transition failed", description: String(e), variant: "destructive" });
    }
  };

  const overdue = (g: CaGap) =>
    g.sla_due_at && ["open", "in_progress"].includes(g.status) && new Date(g.sla_due_at) < new Date();

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["open", "in_progress", "resolved", "accepted_risk"] as GapStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              className={`bg-card rounded-2xl border shadow-sm p-4 text-left transition-colors ${
                statusFilter === s ? "border-primary/40" : "border-border"
              }`}
            >
              <p className="text-2xl font-bold">{summary.by_status[s] ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{GAP_STATUS_LABEL[s]}</p>
            </button>
          ))}
        </div>
      )}
      {summary && summary.sla_breaches > 0 && (
        <p className="text-sm text-destructive font-medium">
          ⚠ {summary.sla_breaches} gap(s) past their remediation SLA.
        </p>
      )}

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Gap</TableHead>
              <TableHead className="w-28">Severity</TableHead>
              <TableHead className="w-32">Status</TableHead>
              <TableHead className="w-36">SLA due</TableHead>
              <TableHead className="w-44">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : gaps.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="py-4">
                <EmptyState icon={CheckCircle2} title="No gaps"
                  description={statusFilter === "all"
                    ? "No compliance gaps detected — or no framework is enabled yet."
                    : "No gaps in this state."} />
              </TableCell></TableRow>
            ) : gaps.map((g) => (
              <TableRow key={g.id} className="cursor-pointer" onClick={() => setSelected(g)}>
                <TableCell>
                  <p className="font-medium text-sm">{g.title}</p>
                  <p className="text-xs text-muted-foreground">{g.control_ref}</p>
                </TableCell>
                <TableCell><SeverityBadge severity={g.severity as never} /></TableCell>
                <TableCell><GapStatusBadge status={g.status} /></TableCell>
                <TableCell className={`text-xs ${overdue(g) ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                  {g.sla_due_at ? new Date(g.sla_due_at).toLocaleDateString() : "—"}
                  {overdue(g) && " (overdue)"}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {canWrite && NEXT_STEP[g.status] && (
                    <Button size="sm" variant="outline" className="rounded-xl"
                      onClick={() => doTransition(g, NEXT_STEP[g.status]!.to)}>
                      {NEXT_STEP[g.status]!.label}
                    </Button>
                  )}
                  {canWrite && ["open", "in_progress"].includes(g.status) && (
                    <Button size="sm" variant="ghost" className="rounded-xl text-muted-foreground"
                      onClick={() => setJustifyTarget({ gap: g, to: "accepted_risk" })}>
                      Accept risk
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Gap detail: what exactly is missing (from real check results) */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-heading flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-destructive" />
                  {selected.title}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-2">
                  <GapStatusBadge status={selected.status} />
                  <SeverityBadge severity={selected.severity as never} />
                </div>
                <p className="text-sm text-muted-foreground">{selected.description}</p>
                <div>
                  <h4 className="font-heading font-semibold text-sm mb-2">What's missing</h4>
                  <div className="space-y-2">
                    {(selected.missing ?? []).map((m, i) => (
                      <div key={i} className="border border-border rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">{m.check_name ?? m.check_key}</span>
                          <span className="text-xs text-destructive">{m.state}</span>
                        </div>
                        {m.detail && <p className="text-xs text-muted-foreground mt-1">{m.detail}</p>}
                      </div>
                    ))}
                    {(!selected.missing || selected.missing.length === 0) && (
                      <p className="text-sm text-muted-foreground">No failing checks recorded.</p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Risk-acceptance requires justification (audit-trailed) */}
      <Dialog open={!!justifyTarget} onOpenChange={(o) => !o && setJustifyTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Accept risk</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Risk acceptance requires a justification and is permanently recorded in the audit trail.
          </p>
          <Textarea placeholder="Why is this risk acceptable? *" value={justification}
            onChange={(e) => setJustification(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setJustifyTarget(null)}>Cancel</Button>
            <Button variant="destructive"
              disabled={justification.trim().length < 3}
              onClick={() => justifyTarget && doTransition(justifyTarget.gap, justifyTarget.to, justification)}>
              Accept risk
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
