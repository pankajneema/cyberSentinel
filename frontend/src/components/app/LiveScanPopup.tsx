import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Radar,
  Bug,
  X,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useRealtime, RealtimeEvent } from "@/hooks/useRealtime";

interface ScanNotification {
  id: string;
  type: "asm" | "vs";
  title: string;
  target: string;
  status: "running" | "completed" | "found";
  progress?: number;
  message?: string;
  severity?: "critical" | "high" | "medium" | "low";
}

const TERMINAL = new Set(["scan.completed", "scan.failed", "scan.stopped"]);

export function LiveScanPopup() {
  const { events } = useRealtime();
  const [running, setRunning] = useState<Record<string, ScanNotification>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [seen, setSeen] = useState<string>("");

  /**
   * Derive the live "running scans" set from the realtime event stream:
   * a `scan.started` adds an entry keyed by discovery id; any terminal event
   * (completed/failed/stopped) removes it. Toasts for terminal/finding events
   * are handled globally by RealtimeProvider.
   */
  useEffect(() => {
    if (!events.length || events[0].id === seen) return;
    // Process every event newer than the last one we handled (events is
    // newest-first). Applying oldest->newest keeps start/terminal ordering
    // correct so no scan card is missed or left stranded when several events
    // land in one render batch.
    const seenIdx = seen ? events.findIndex((e) => e.id === seen) : -1;
    const fresh = (seenIdx === -1 ? events.slice() : events.slice(0, seenIdx)).reverse();
    setSeen(events[0].id);
    if (!fresh.length) return;

    setRunning((prev) => {
      const next = { ...prev };
      for (const ev of fresh) {
        const did = (ev.meta?.discovery_id as string) || ev.id;
        if (ev.type === "scan.started") {
          next[did] = {
            id: did,
            type: "asm",
            title: ev.title || "ASM discovery",
            target: (ev.body as string) || "",
            status: "running",
          };
        } else if (TERMINAL.has(ev.type)) {
          delete next[did];
        }
      }
      return next;
    });
  }, [events, seen]);

  const activeScans = Object.values(running).filter(
    (n) => !dismissed.includes(n.id)
  );

  const getSeverityColor = (severity?: string) => {
    switch (severity) {
      case "critical":
        return "from-red-500 to-red-600";
      case "high":
        return "from-orange-500 to-orange-600";
      case "medium":
        return "from-yellow-500 to-yellow-600";
      default:
        return "from-blue-500 to-blue-600";
    }
  };

  if (activeScans.length === 0) return null;

  return (
    <>
      {/* Floating Scan Status */}
      <AnimatePresence>
        {activeScans.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="fixed top-20 right-4 z-50 space-y-2"
          >
            {activeScans.map((scan) => (
              <motion.div
                key={scan.id}
                layout
                initial={{ opacity: 0, scale: 0.8, x: 50 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.8, x: 50 }}
                className="bg-gradient-to-r from-card/95 to-card/80 backdrop-blur-xl border border-border/50 rounded-xl p-3 shadow-2xl min-w-[280px]"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      scan.type === "asm"
                        ? "bg-primary/20"
                        : "bg-accent/20"
                    }`}
                  >
                    {scan.type === "asm" ? (
                      <Radar className="w-5 h-5 text-primary animate-pulse" />
                    ) : (
                      <Bug className="w-5 h-5 text-accent animate-pulse" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {scan.title}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 -mr-1"
                        onClick={() =>
                          setDismissed((d) => [...d, scan.id])
                        }
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground truncate">
                      {scan.target}
                    </p>

                    {typeof scan.progress === "number" && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <Progress
                          value={scan.progress}
                          className="h-1.5 flex-1"
                        />
                        <span className="text-xs font-medium text-primary">
                          {Math.round(scan.progress)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
