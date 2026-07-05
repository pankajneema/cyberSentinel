import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BookOpenCheck, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { CaFramework, enableFramework, fetchFrameworks, pauseFramework } from "@/lib/services/ca";
import { Skeleton } from "@/components/ui/skeleton";

export function FrameworkPicker({ canWrite }: { canWrite: boolean }) {
  const [frameworks, setFrameworks] = useState<CaFramework[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchFrameworks()
      .then((r) => { if (!cancelled) setFrameworks(r.items); })
      .catch(() => { if (!cancelled) setFrameworks([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reload]);

  const toggle = async (fw: CaFramework) => {
    setBusy(fw.id);
    try {
      if (fw.enabled) {
        await pauseFramework(fw.id);
        toast({ title: `${fw.name} paused` });
      } else {
        await enableFramework(fw.id);
        toast({
          title: `${fw.name} enabled`,
          description: "First evaluation ran — posture reflects real evidence (it may be low; that's honest).",
        });
      }
      setReload((n) => n + 1);
    } catch (e) {
      toast({ title: "Action failed", description: String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {frameworks.map((fw) => (
        <motion.div
          key={fw.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-2xl border border-border shadow-sm p-5 flex flex-col"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="p-2 rounded-xl bg-primary/10">
              <BookOpenCheck className="w-5 h-5 text-primary" />
            </div>
            <div className="flex items-center gap-2">
              {fw.is_reference && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                  reference
                </span>
              )}
              {fw.enabled && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/20">
                  active
                </span>
              )}
            </div>
          </div>
          <h3 className="font-heading font-bold text-foreground mt-3">{fw.name}</h3>
          <p className="text-xs text-muted-foreground">
            v{fw.version} · {fw.authority} · {fw.control_count} controls
          </p>
          <p className="text-sm text-muted-foreground mt-2 line-clamp-2 flex-1">{fw.description}</p>
          {fw.enabled && fw.posture && (
            <p className="text-xs mt-3">
              <span className="font-semibold text-foreground">
                {fw.posture.score === null ? "—" : `${fw.posture.score}%`}
              </span>{" "}
              <span className="text-muted-foreground">
                · {fw.posture.satisfied} satisfied / {fw.posture.gap} gap / {fw.posture.unknown} not assessed
              </span>
            </p>
          )}
          {canWrite && (
            <Button
              variant={fw.enabled ? "outline" : "default"}
              size="sm"
              className="mt-4 rounded-xl self-start"
              disabled={busy === fw.id}
              onClick={() => toggle(fw)}
            >
              {fw.enabled ? <Pause className="w-4 h-4 mr-1.5" /> : <Play className="w-4 h-4 mr-1.5" />}
              {fw.enabled ? "Pause" : "Enable"}
            </Button>
          )}
        </motion.div>
      ))}
    </div>
  );
}
