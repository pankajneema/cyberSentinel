import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, X, ChevronUp, ChevronDown, Radar, Bug, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface ActiveScan {
  id: string;
  name: string;
  type: "asm" | "vuln";
  progress: number;
  target: string;
  status: "running" | "completed";
}

// Mock active scans - in real app this would come from context/state
const mockActiveScans: ActiveScan[] = [
  { id: "1", name: "API Endpoint Discovery", type: "asm", progress: 67, target: "api.company.com", status: "running" },
  { id: "2", name: "Vulnerability Scan", type: "vuln", progress: 34, target: "*.company.com", status: "running" },
];

export function LiveScanIndicator() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [scans, setScans] = useState<ActiveScan[]>(mockActiveScans);

  // Simulate progress updates
  useEffect(() => {
    const interval = setInterval(() => {
      setScans((prev) =>
        prev.map((scan) => ({
          ...scan,
          progress: Math.min(scan.progress + Math.random() * 2, 100),
          status: scan.progress >= 98 ? "completed" : "running",
        }))
      );
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const runningScans = scans.filter((s) => s.status === "running");

  if (!isVisible || runningScans.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        className="fixed bottom-6 right-6 z-50"
      >
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden min-w-[320px] max-w-[400px]">
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 bg-primary/5 border-b border-border cursor-pointer"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-primary-foreground text-[10px] rounded-full flex items-center justify-center font-bold">
                  {runningScans.length}
                </span>
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">Live Scans</div>
                <div className="text-xs text-muted-foreground">
                  {runningScans.length} scan{runningScans.length > 1 ? "s" : ""} in progress
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setIsExpanded(!isExpanded)}>
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsVisible(false);
                }}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Expanded Content */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: "auto" }}
                exit={{ height: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 space-y-4 max-h-[300px] overflow-y-auto">
                  {scans.map((scan) => (
                    <div key={scan.id} className="space-y-2">
                      <div className="flex items-center gap-2">
                        {scan.type === "asm" ? (
                          <Radar className="w-4 h-4 text-primary" />
                        ) : (
                          <Bug className="w-4 h-4 text-accent" />
                        )}
                        <span className="text-sm font-medium text-foreground flex-1">{scan.name}</span>
                        {scan.status === "completed" ? (
                          <CheckCircle2 className="w-4 h-4 text-success" />
                        ) : (
                          <span className="text-xs text-muted-foreground">{Math.round(scan.progress)}%</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{scan.target}</div>
                      <Progress value={scan.progress} className="h-1.5" />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mini Progress */}
          {!isExpanded && (
            <div className="px-4 py-2">
              <div className="flex gap-1">
                {runningScans.slice(0, 3).map((scan) => (
                  <div key={scan.id} className="flex-1">
                    <Progress value={scan.progress} className="h-1" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
