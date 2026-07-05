import { useEffect, useState } from "react";
import { ClipboardList, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/asm/EmptyState";
import { SeverityBadge } from "@/components/asm/SeverityBadge";
import { toast } from "@/hooks/use-toast";
import {
  CaControl, CaControlDetail, CaFramework, ControlStatus,
  fetchControlDetail, fetchControls, fetchFrameworks, setControlApplicability,
} from "@/lib/services/ca";
import { CollectionBadge, ControlStatusBadge, EvidenceStatusBadge } from "./CaStatusBadge";

const STATUS_FILTERS: Array<{ value: ControlStatus | "all"; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "satisfied", label: "Satisfied" },
  { value: "partial", label: "Partial" },
  { value: "gap", label: "Gap" },
  { value: "unknown", label: "Not assessed" },
  { value: "not_applicable", label: "N/A" },
];

export function ControlsTable({ canWrite }: { canWrite: boolean }) {
  const [frameworks, setFrameworks] = useState<CaFramework[]>([]);
  const [fwId, setFwId] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [controls, setControls] = useState<CaControl[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<CaControlDetail | null>(null);
  const [naOpen, setNaOpen] = useState(false);
  const [naJustification, setNaJustification] = useState("");
  const [naScope, setNaScope] = useState("");
  const [reload, setReload] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    let cancelled = false;
    fetchFrameworks().then((r) => {
      if (cancelled) return;
      const enabled = r.items.filter((f) => f.enabled);
      setFrameworks(enabled);
      if (enabled.length && !enabled.find((f) => f.id === fwId)) setFwId(enabled[0].id);
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!fwId) return;
    let cancelled = false;
    setLoading(true);
    fetchControls({ framework_id: fwId, status: status === "all" ? undefined : status, page, page_size: pageSize })
      .then((r) => { if (!cancelled) { setControls(r.items); setTotal(r.total); } })
      .catch(() => { if (!cancelled) setControls([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fwId, status, page, reload]);

  const openDetail = async (id: string) => {
    try {
      setDetail(await fetchControlDetail(id));
    } catch (e) {
      toast({ title: "Failed to load control", description: String(e), variant: "destructive" });
    }
  };

  const submitNa = async () => {
    if (!detail) return;
    try {
      await setControlApplicability(detail.id, {
        not_applicable: true, justification: naJustification, scope: naScope || undefined,
      });
      toast({ title: `${detail.control_ref} marked N/A` });
      setNaOpen(false); setNaJustification(""); setNaScope("");
      setDetail(null); setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    }
  };

  const unsetNa = async () => {
    if (!detail) return;
    try {
      await setControlApplicability(detail.id, { not_applicable: false });
      toast({ title: `${detail.control_ref} back in scope`, description: "Status recomputed from evidence." });
      setDetail(null); setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    }
  };

  if (!frameworks.length) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No frameworks enabled"
        description="Enable a framework in the Frameworks tab to see its controls here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Select value={fwId} onValueChange={(v) => { setFwId(v); setPage(1); }}>
          <SelectTrigger className="w-64 rounded-xl"><SelectValue placeholder="Framework" /></SelectTrigger>
          <SelectContent>
            {frameworks.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-48 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Ref</TableHead>
              <TableHead>Control</TableHead>
              <TableHead className="w-32">Category</TableHead>
              <TableHead className="w-28">Criticality</TableHead>
              <TableHead className="w-36">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : controls.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No controls match the filter.</TableCell></TableRow>
            ) : controls.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => openDetail(c.id)}>
                <TableCell className="font-mono text-xs">{c.control_ref}</TableCell>
                <TableCell className="font-medium">{c.title}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{c.category}</TableCell>
                <TableCell><SeverityBadge severity={c.criticality as never} /></TableCell>
                <TableCell><ControlStatusBadge status={c.state.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {total > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
            <span className="text-muted-foreground">{total} controls</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      {/* Control detail — Sheet idiom mirrors VSFindings */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="font-heading flex items-center gap-3">
                  <span className="font-mono text-sm text-muted-foreground">{detail.control_ref}</span>
                  {detail.title}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4 space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <ControlStatusBadge status={detail.state.status} />
                  <SeverityBadge severity={detail.criticality as never} />
                  <span className="text-xs text-muted-foreground">
                    {detail.state.computed_at
                      ? `evaluated ${new Date(detail.state.computed_at).toLocaleString()}`
                      : "not evaluated yet"}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{detail.description}</p>
                {detail.evidence_guidance && (
                  <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">
                    <span className="font-semibold text-foreground">Auditor expects: </span>
                    {detail.evidence_guidance}
                  </p>
                )}
                {detail.state.status === "not_applicable" && (
                  <div className="bg-accent/5 border border-accent/20 rounded-xl p-3 text-sm">
                    <p className="font-semibold text-foreground">Marked Not Applicable</p>
                    <p className="text-muted-foreground mt-1">{detail.state.na_justification}</p>
                    {detail.state.na_scope && (
                      <p className="text-xs text-muted-foreground mt-1">Scope: {detail.state.na_scope}</p>
                    )}
                  </div>
                )}

                <div>
                  <h4 className="font-heading font-semibold text-sm mb-2">Checks satisfying this control</h4>
                  <div className="space-y-2">
                    {detail.checks.map((ch) => (
                      <div key={ch.id} className="border border-border rounded-xl p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">{ch.name}</span>
                          <div className="flex items-center gap-2">
                            <CollectionBadge collection={ch.collection} />
                            {!ch.required && (
                              <span className="text-[11px] text-muted-foreground">supporting</span>
                            )}
                          </div>
                        </div>
                        {ch.rationale && (
                          <p className="text-xs text-muted-foreground mt-1.5">{ch.rationale}</p>
                        )}
                      </div>
                    ))}
                    {detail.checks.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No checks mapped — this control needs manual evidence.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="font-heading font-semibold text-sm mb-2">Evidence</h4>
                  <div className="space-y-2">
                    {detail.evidence.map((ev) => (
                      <div key={ev.id} className="border border-border rounded-xl p-3">
                        <div className="flex items-center justify-between gap-2">
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
                            {ev.valid_until && ` → valid until ${new Date(ev.valid_until).toLocaleDateString()}`}
                          </span>
                        </div>
                        <p className="text-sm mt-1.5">{ev.summary}</p>
                        {ev.source_ref && (ev.source_ref as { table?: string }).table && (
                          <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                            source: {(ev.source_ref as { table?: string }).table}
                            {Array.isArray((ev.source_ref as { ids?: string[] }).ids) &&
                              ` (${((ev.source_ref as { ids?: string[] }).ids as string[]).length} row(s))`}
                          </p>
                        )}
                      </div>
                    ))}
                    {detail.evidence.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No evidence collected yet — this is why the control reads "Not assessed" or "Gap".
                      </p>
                    )}
                  </div>
                </div>

                {detail.related_controls.length > 0 && (
                  <div>
                    <h4 className="font-heading font-semibold text-sm mb-2">
                      Same evidence also satisfies
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {detail.related_controls.map((rc) => (
                        <span key={rc.id} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-muted border border-border">
                          <ExternalLink className="w-3 h-3" />
                          {rc.framework_key.toUpperCase()} {rc.control_ref}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {canWrite && (
                  <div className="flex gap-2 pt-2 border-t border-border">
                    {detail.state.status !== "not_applicable" ? (
                      <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setNaOpen(true)}>
                        Mark Not Applicable
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" className="rounded-xl" onClick={unsetNa}>
                        Return to scope
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* N/A justification — mandatory, audit-trailed */}
      <Dialog open={naOpen} onOpenChange={setNaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark control Not Applicable</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            A justification is required and permanently recorded in the compliance audit trail.
          </p>
          <Textarea
            placeholder="Justification (min 10 characters)…"
            value={naJustification}
            onChange={(e) => setNaJustification(e.target.value)}
          />
          <Textarea
            placeholder="Scope (optional — which part of the org this exclusion covers)"
            value={naScope}
            onChange={(e) => setNaScope(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNaOpen(false)}>Cancel</Button>
            <Button onClick={submitNa} disabled={naJustification.trim().length < 10}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
