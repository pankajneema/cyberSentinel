import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { getAccessToken } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";

/**
 * Realtime notification channel (WebSocket).
 *
 * Connects to the API's /ws/realtime endpoint (authenticated via the Supabase
 * access token as a query param, since browsers can't set WS headers), receives
 * live events (ASM scan lifecycle, findings, team messages), surfaces toasts for
 * important ones, and lets components send team messages. Auto-reconnects with
 * capped backoff.
 */

export interface RealtimeEvent {
  id: string;
  org_id?: string;
  type: string;
  title: string;
  body?: string;
  severity?: string;
  link?: string;
  meta?: Record<string, unknown>;
  created_at?: string;
}

interface RealtimeContextValue {
  connected: boolean;
  events: RealtimeEvent[];
  sendChat: (text: string, title?: string) => void;
  clear: () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  connected: false,
  events: [],
  sendChat: () => {},
  clear: () => {},
});

function wsBaseUrl(): string {
  const host = import.meta.env.VITE_API_URL || "http://localhost:8000";
  return host.replace(/^http/, "ws");
}

const TOAST_TYPES = new Set([
  "scan.completed",
  "scan.failed",
  "finding.critical",
  "finding.high",
  "findings.new",
  "team.message",
]);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback(async () => {
    if (closedRef.current) return;
    const token = await getAccessToken();
    if (!token) {
      // Not authenticated yet — retry shortly.
      setTimeout(connect, 2000);
      return;
    }
    // Send the JWT as a subprotocol value (["cybersentinel-auth", token]) so it
    // stays out of the URL / server access logs / browser history. The server
    // reads and verifies it, echoing only the sentinel protocol name.
    const url = `${wsBaseUrl()}/ws/realtime`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, ["cybersentinel-auth", token]);
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      retryRef.current = 0;
      setConnected(true);
      // Heartbeat keeps intermediaries from idling the socket.
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 25000);
    };

    ws.onmessage = (msg) => {
      let data: RealtimeEvent & { type: string };
      try {
        data = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (data.type === "pong" || data.type === "connected") return;

      setEvents((prev) => [data, ...prev].slice(0, 100));

      if (TOAST_TYPES.has(data.type)) {
        const isError = data.severity === "high" || data.type === "scan.failed";
        toast({
          title: data.title,
          description: data.body,
          variant: isError ? "destructive" : undefined,
        });
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingRef.current) clearInterval(pingRef.current);
      scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (closedRef.current) return;
    retryRef.current = Math.min(retryRef.current + 1, 6);
    const delay = Math.min(1000 * 2 ** retryRef.current, 30000);
    setTimeout(connect, delay);
  }, [connect]);

  useEffect(() => {
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
      if (pingRef.current) clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendChat = useCallback((text: string, title?: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "chat", text, title }));
    }
  }, []);

  const clear = useCallback(() => setEvents([]), []);

  return (
    <RealtimeContext.Provider value={{ connected, events, sendChat, clear }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

/** Convenience: only ASM scan-lifecycle events. */
export function useScanEvents() {
  const { events } = useRealtime();
  return events.filter((e) => e.type.startsWith("scan."));
}
