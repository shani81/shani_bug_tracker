"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type RTContext = { connected: boolean; lastEvent: string | null };
const Ctx = React.createContext<RTContext>({ connected: false, lastEvent: null });

// Subscribes to the SSE stream and refreshes server components on any change,
// giving the whole app real-time updates with no manual refresh.
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [connected, setConnected] = React.useState(false);
  const [lastEvent, setLastEvent] = React.useState<string | null>(null);
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as { type: string };
        if (evt.type === "ping") {
          setConnected(true);
          return;
        }
        setLastEvent(evt.type);
        // debounce bursts of events into a single refresh
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => router.refresh(), 180);
      } catch {
        /* ignore malformed */
      }
    };
    return () => {
      es.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [router]);

  return <Ctx.Provider value={{ connected, lastEvent }}>{children}</Ctx.Provider>;
}

export function useRealtime() {
  return React.useContext(Ctx);
}
