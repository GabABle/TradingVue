import { useEffect, useRef } from "react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

export interface AlertTriggeredPayload {
  type: "alert_triggered";
  alert: {
    id: string;
    symbol: string;
    targetPrice: number;
    condition: "above" | "below";
    triggeredPrice?: number;
    triggeredAt?: string;
  };
  currentPrice: number;
}

export function useAlertEvents(token: string | null, onTriggered: (payload: AlertTriggeredPayload) => void) {
  const cbRef = useRef(onTriggered);
  cbRef.current = onTriggered;

  useEffect(() => {
    if (!token) return;

    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    function connect() {
      if (!alive) return;
      // EventSource doesn't support custom headers — pass token as query param
      es = new EventSource(`${BASE}/api/alerts/events?token=${encodeURIComponent(token!)}`);

      es.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data) as { type: string } & AlertTriggeredPayload;
          if (data.type === "alert_triggered") {
            cbRef.current(data);
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        es?.close();
        if (alive) {
          retryTimeout = setTimeout(connect, 5_000);
        }
      };
    }

    connect();

    return () => {
      alive = false;
      if (retryTimeout) clearTimeout(retryTimeout);
      es?.close();
    };
  }, [token]);
}
