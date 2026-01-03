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

export function LiveScanPopup() {
  const [notifications, setNotifications] = useState<ScanNotification[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [toasts, setToasts] = useState<ScanNotification[]>([]);

  /**
   * 🔌 REAL DATA INTEGRATION POINT
   *
   * Use this effect to:
   * - subscribe to WebSocket
   * - listen to SSE
   * - poll backend API
   *
   * Example:
   * socket.on("scan_update", (data) => setNotifications(...))
   * socket.on("scan_event", (toast) => setToasts(...))
   */
  useEffect(() => {
    return () => {
      // cleanup socket / subscriptions here
    };
  }, []);

  const activeScans = notifications.filter(
    (n) => n.status === "running" && !dismissed.includes(n.id)
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

  if (activeScans.length === 0 && toasts.length === 0) return null;

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

      {/* Toast Notifications */}
      <AnimatePresence>
        {toasts.length > 0 && (
          <div className="fixed bottom-24 right-4 z-50 space-y-2">
            {toasts.map((toast) => (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, x: 100, scale: 0.8 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 100, scale: 0.8 }}
                transition={{ type: "spring", damping: 20, stiffness: 300 }}
                className="relative overflow-hidden"
              >
                <div
                  className={`relative bg-gradient-to-r ${
                    toast.status === "found"
                      ? getSeverityColor(toast.severity)
                      : "from-success to-emerald-600"
                  } rounded-xl p-0.5 shadow-2xl`}
                >
                  <div className="bg-card/95 backdrop-blur-xl rounded-[10px] p-3 flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        toast.status === "found"
                          ? toast.severity === "critical"
                            ? "bg-destructive/20"
                            : "bg-warning/20"
                          : "bg-success/20"
                      }`}
                    >
                      {toast.status === "found" ? (
                        <AlertTriangle
                          className={`w-5 h-5 ${
                            toast.severity === "critical"
                              ? "text-destructive"
                              : "text-warning"
                          }`}
                        />
                      ) : (
                        <CheckCircle2 className="w-5 h-5 text-success" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold">
                        {toast.title}
                      </span>
                      {toast.message && (
                        <p className="text-xs text-muted-foreground">
                          {toast.message}
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/70">
                        {toast.target}
                      </p>
                    </div>

                    <Link
                      to={toast.type === "asm" ? "/app/asm" : "/app/vs"}
                      className="text-primary hover:text-primary/80"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
