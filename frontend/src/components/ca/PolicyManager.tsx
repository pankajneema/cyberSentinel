import { useEffect, useState } from "react";
import { BookText, CheckCheck, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/asm/EmptyState";
import { toast } from "@/hooks/use-toast";
import {
  CaPolicy, CaPolicyDetail, acknowledgePolicy, createPolicy, fetchPolicies,
  fetchPolicyDetail, fetchPolicyTemplates, publishPolicyVersion, updatePolicy,
} from "@/lib/services/ca";

const POLICY_STATUS_STYLE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  active: "bg-success/10 text-success border-success/20",
  archived: "bg-muted text-muted-foreground border-border",
};

export function PolicyManager({ canWrite }: { canWrite: boolean }) {
  const [policies, setPolicies] = useState<CaPolicy[]>([]);
  const [templates, setTemplates] = useState<CaPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [detail, setDetail] = useState<CaPolicyDetail | null>(null);
  const [editBody, setEditBody] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchPolicies(), fetchPolicyTemplates()])
      .then(([p, t]) => { if (!cancelled) { setPolicies(p.items); setTemplates(t.items); } })
      .catch(() => { if (!cancelled) setPolicies([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);

  const cloneTemplate = async (tpl: CaPolicy) => {
    try {
      await createPolicy({ title: tpl.title, from_template_id: tpl.id });
      toast({ title: `Policy created from template: ${tpl.title}` });
      setTemplatesOpen(false);
      setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    }
  };

  const openDetail = async (id: string) => {
    try {
      const d = await fetchPolicyDetail(id);
      setDetail(d);
      setEditBody(d.versions[0]?.body_md ?? "");
    } catch (e) {
      toast({ title: "Failed to load policy", description: String(e), variant: "destructive" });
    }
  };

  const publish = async () => {
    if (!detail) return;
    try {
      await publishPolicyVersion(detail.id, editBody);
      toast({ title: "Version published", description: "Members must acknowledge the new version." });
      openDetail(detail.id);
      setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Publish failed", description: String(e), variant: "destructive" });
    }
  };

  const activate = async () => {
    if (!detail) return;
    try {
      await updatePolicy(detail.id, { status: "active" });
      toast({ title: "Policy activated", description: "It now counts toward policy checks." });
      openDetail(detail.id);
      setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Activation failed", description: String(e), variant: "destructive" });
    }
  };

  const ack = async (id: string) => {
    try {
      await acknowledgePolicy(id);
      toast({ title: "Acknowledged" });
      setReload((n) => n + 1);
      if (detail) openDetail(detail.id);
    } catch (e) {
      toast({ title: "Failed", description: String(e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canWrite && (
          <Button className="rounded-xl" onClick={() => setTemplatesOpen(true)}>
            <FilePlus2 className="w-4 h-4 mr-2" /> New from template
          </Button>
        )}
      </div>

      {!loading && policies.length === 0 ? (
        <EmptyState icon={BookText} title="No policies yet"
          description="Create your organization's security policies from the built-in templates. Active, acknowledged policies satisfy administrative controls across frameworks."
          actionLabel={canWrite ? "Browse templates" : undefined}
          onAction={canWrite ? () => setTemplatesOpen(true) : undefined} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {policies.map((p) => (
            <div key={p.id}
              className="bg-card rounded-2xl border border-border shadow-sm p-5 cursor-pointer"
              onClick={() => openDetail(p.id)}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-heading font-bold">{p.title}</h3>
                <span className={`text-[11px] px-2 py-0.5 rounded-full border ${POLICY_STATUS_STYLE[p.status] ?? ""}`}>
                  {p.status}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{p.description}</p>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <span><CheckCheck className="w-3.5 h-3.5 inline mr-1" />{p.ack_count ?? 0} acknowledgment(s)</span>
                {p.next_review_at && <span>review by {new Date(p.next_review_at).toLocaleDateString()}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Templates */}
      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Policy templates</DialogTitle></DialogHeader>
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="border border-border rounded-xl p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm">{t.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-1">{t.description}</p>
                </div>
                <Button size="sm" variant="outline" className="rounded-xl shrink-0" onClick={() => cloneTemplate(t)}>
                  Use
                </Button>
              </div>
            ))}
            {templates.length === 0 && <p className="text-sm text-muted-foreground">No templates loaded.</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Policy detail */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {detail && (
            <>
              <SheetHeader><SheetTitle className="font-heading">{detail.title}</SheetTitle></SheetHeader>
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={`px-2 py-0.5 rounded-full border ${POLICY_STATUS_STYLE[detail.status] ?? ""}`}>
                    {detail.status}
                  </span>
                  <span>{detail.versions.length} version(s)</span>
                  <span>{detail.acks.length} acknowledgment(s) on current version</span>
                </div>

                {canWrite && (
                  <>
                    <Textarea rows={16} className="font-mono text-xs" value={editBody}
                      onChange={(e) => setEditBody(e.target.value)} />
                    <div className="flex gap-2">
                      <Button size="sm" className="rounded-xl" onClick={publish}
                        disabled={editBody.trim().length < 10}>
                        Publish new version
                      </Button>
                      {detail.status !== "active" && detail.current_version_id && (
                        <Button size="sm" variant="outline" className="rounded-xl" onClick={activate}>
                          Activate policy
                        </Button>
                      )}
                    </div>
                  </>
                )}
                {!canWrite && detail.versions[0] && (
                  <pre className="text-xs bg-muted rounded-xl p-4 whitespace-pre-wrap">{detail.versions[0].body_md}</pre>
                )}

                {detail.current_version_id && (
                  <Button size="sm" variant="secondary" className="rounded-xl" onClick={() => ack(detail.id)}>
                    <CheckCheck className="w-4 h-4 mr-2" /> Acknowledge current version
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
