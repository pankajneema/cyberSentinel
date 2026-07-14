/**
 * Live scan task/stage progress via Server-Sent Events.
 *
 * Subscribes to GET /api/v1/scans/events (which streams the worker's
 * task_events:{org_id} Redis channel). Distinct from useScanEvents in
 * useRealtime.tsx, which surfaces coarse WebSocket scan.* notifications — this
 * hook yields fine-grained per-stage progress for a running task.
 */
import { useEffect, useRef, useState } from "react";

import { getAccessToken } from "@/lib/supabase";

export interface ScanTaskEvent {
  task_id: string;
  org_id: string;
  service: string;
  kind: "task" | "stage";
  status: string;
  stage?: string;
  tool?: string;
  progress: number;
  error?: string;
  ts: string;
}

function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_URL as string) || "http://localhost:8000";
}

/**
 * Stream live scan events. Pass a taskId to filter to a single task; omit it to
 * receive every scan event for the caller's org.
 */
export function useScanTaskStream(taskId?: string) {
  const [events, setEvents] = useState<ScanTaskEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let closed = false;
    let es: EventSource | null = null;

    (async () => {
      const token = await getAccessToken();
      if (!token || closed) return;
      // EventSource cannot set headers, so the JWT rides as a query param (the
      // SSE endpoint verifies it the same way the WebSocket endpoint does).
      const url = `${apiBaseUrl()}/api/v1/scans/events?token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => setConnected(true);
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data) as ScanTaskEvent;
          if (taskId && ev.task_id !== taskId) return;
          setEvents((prev) => [...prev.slice(-199), ev]);
        } catch {
          /* ignore keepalive comments / malformed frames */
        }
      };
      es.onerror = () => {
        setConnected(false); // EventSource auto-reconnects
      };
    })();

    return () => {
      closed = true;
      if (es) es.close();
      esRef.current = null;
    };
  }, [taskId]);

  return { events, connected };
}
