import { useEffect, useState } from "react";
import { Download, FileUp, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import {
  CaEvidence, downloadEvidenceFile, fetchEvidence, revokeEvidence, uploadManualEvidence,
} from "@/lib/services/ca";
import { CollectionBadge, EvidenceStatusBadge } from "./CaStatusBadge";

export function EvidenceTable({ canWrite, isAdmin }: { canWrite: boolean; isAdmin: boolean }) {
  const [items, setItems] = useState<CaEvidence[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [collection, setCollection] = useState("all");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [validDays, setValidDays] = useState(180);
  const [file, setFile] = useState<File | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<CaEvidence | null>(null);
  const [revokeJustification, setRevokeJustification] = useState("");
  const [reload, setReload] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEvidence({
      collection: collection === "all" ? undefined : collection,
      status: status === "all" ? undefined : status,
      page, page_size: pageSize,
    })
      .then((r) => { if (!cancelled) { setItems(r.items); setTotal(r.total); } })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [collection, status, page, reload]);

  const submitUpload = async () => {
    try {
      await uploadManualEvidence({ summary, valid_days: validDays, file });
      toast({ title: "Evidence uploaded", description: "Recorded as MANUAL evidence (never system-collected)." });
      setUploadOpen(false); setSummary(""); setFile(null);
      setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Upload failed", description: String(e), variant: "destructive" });
    }
  };

  const submitRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await revokeEvidence(revokeTarget.id, revokeJustification);
      toast({ title: "Evidence revoked" });
      setRevokeTarget(null); setRevokeJustification("");
      setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Revoke failed", description: String(e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={collection} onValueChange={(v) => { setCollection(v); setPage(1); }}>
          <SelectTrigger className="w-44 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All collection</SelectItem>
            <SelectItem value="automated">Automated</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-44 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="valid">Valid</SelectItem>
            <SelectItem value="stale">Stale</SelectItem>
            <SelectItem value="superseded">Superseded</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
          </SelectContent>
        </Select>
        {canWrite && (
          <Button className="rounded-xl ml-auto" onClick={() => setUploadOpen(true)}>
            <FileUp className="w-4 h-4 mr-2" /> Upload manual evidence
          </Button>
        )}
      </div>

      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Summary</TableHead>
              <TableHead className="w-28">Collection</TableHead>
              <TableHead className="w-24">Result</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead className="w-40">Captured / valid until</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                No evidence yet — enable a framework and the engine will start collecting from your scans.
              </TableCell></TableRow>
            ) : items.map((ev) => (
              <TableRow key={ev.id}>
                <TableCell>
                  <p className="text-sm">{ev.summary}</p>
                  <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                    sha256:{ev.content_hash.slice(0, 16)}…
                  </p>
                </TableCell>
                <TableCell><CollectionBadge collection={ev.collection} /></TableCell>
                <TableCell>
                  {ev.result ? (
                    <span className={`text-xs font-semibold ${ev.result === "pass" ? "text-success" : "text-destructive"}`}>
                      {ev.result.toUpperCase()}
                    </span>
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell><EvidenceStatusBadge status={ev.status} /></TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {ev.captured_at && new Date(ev.captured_at).toLocaleDateString()}
                  {ev.valid_until && <><br />→ {new Date(ev.valid_until).toLocaleDateString()}</>}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {ev.file_id && (
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8"
                        onClick={() => downloadEvidenceFile(ev.id,
                          ((ev.content as { filename?: string })?.filename) || "evidence.bin")}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    )}
                    {isAdmin && ev.status !== "revoked" && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                        onClick={() => setRevokeTarget(ev)}>
                        <ShieldOff className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {total > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
            <span className="text-muted-foreground">{total} evidence item(s)</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</Button>
              <Button variant="outline" size="sm" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload manual evidence</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Manual evidence is encrypted at rest, hash-stamped, and always badged{" "}
            <span className="font-semibold">MANUAL</span> — it can never appear as system-collected.
          </p>
          <Textarea placeholder="What does this evidence show? *" value={summary}
            onChange={(e) => setSummary(e.target.value)} />
          <div className="flex items-center gap-3">
            <label className="text-sm text-muted-foreground whitespace-nowrap">Valid for (days)</label>
            <Input type="number" min={1} max={1095} value={validDays}
              onChange={(e) => setValidDays(Number(e.target.value) || 180)} className="w-28" />
          </div>
          <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button onClick={submitUpload} disabled={summary.trim().length < 3}>Upload</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revoke evidence</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Evidence is never deleted — revocation is recorded in the immutable audit trail and the
            item stops counting toward any control.
          </p>
          <Textarea placeholder="Justification *" value={revokeJustification}
            onChange={(e) => setRevokeJustification(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={submitRevoke}
              disabled={revokeJustification.trim().length < 3}>Revoke</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
