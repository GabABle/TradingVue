import { useEffect } from "react";

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

// Price alerts are deprecated for now: delivering them reliably (email when the
// app is closed) requires a backend, and this build is frontend-first with a
// stateless proxy only. This hook is intentionally a no-op so existing callers
// keep compiling unchanged. Re-enable later by restoring a polling/notify impl.
export function useAlertEvents(
  _token: string | null,
  _onTriggered: (payload: AlertTriggeredPayload) => void,
): void {
  useEffect(() => {
    /* deprecated: no-op */
  }, [_token]);
}
