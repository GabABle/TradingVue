import { useState, useEffect, useRef } from "react";
import type { IntervalKey } from "@/lib/ranges";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// Seconds per interval bar — used to bucket incoming trades
const INTERVAL_SECONDS: Record<IntervalKey, number> = {
  "1Min":  60,
  "5Min":  300,
  "15Min": 900,
  "30Min": 1800,
  "1Hour": 3600,
  "4Hour": 14400,
  "1Day":  86400,
  "1Week": 604800,
};

// Only stream for intraday intervals (daily/weekly bars don't need live ticks)
const STREAMABLE: Set<IntervalKey> = new Set(["1Min", "5Min", "15Min", "30Min", "1Hour"]);

// Futures symbols look like GC=F, CL=F — Alpaca doesn't stream these
const FUTURES_RE = /[A-Z]=F$/;

export interface LiveBar {
  t: string; // ISO timestamp of bar open
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface TradeAccumulator {
  start: number; // epoch seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Opens an SSE connection to /api/market/stream for the given symbol+interval,
 * receives individual trade ticks, and assembles the forming (incomplete) current
 * candle in real time. Returns null when streaming is disabled or unavailable.
 */
export function useLiveBar(
  symbol: string,
  interval: IntervalKey,
  token: string | null,
): LiveBar | null {
  const [liveBar, setLiveBar] = useState<LiveBar | null>(null);
  const accRef  = useRef<TradeAccumulator | null>(null);

  const enabled =
    STREAMABLE.has(interval) &&
    !FUTURES_RE.test(symbol) &&
    !!token;

  useEffect(() => {
    if (!enabled) {
      setLiveBar(null);
      return;
    }

    accRef.current = null;
    setLiveBar(null);

    const intervalSecs = INTERVAL_SECONDS[interval];
    const url = `${BASE}/api/market/stream?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&token=${encodeURIComponent(token!)}`;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    function connect() {
      if (!alive) return;
      es = new EventSource(url);

      es.addEventListener("trade", (evt: MessageEvent) => {
        try {
          const trade = JSON.parse(evt.data) as { p: number; s: number; t: string };
          const tradeEpoch = Math.floor(new Date(trade.t).getTime() / 1000);
          const barStart   = Math.floor(tradeEpoch / intervalSecs) * intervalSecs;

          let acc = accRef.current;
          if (!acc || acc.start !== barStart) {
            // New bar period — reset accumulator
            acc = { start: barStart, o: trade.p, h: trade.p, l: trade.p, c: trade.p, v: trade.s };
          } else {
            acc.h  = Math.max(acc.h, trade.p);
            acc.l  = Math.min(acc.l, trade.p);
            acc.c  = trade.p;
            acc.v += trade.s;
          }
          accRef.current = acc;

          setLiveBar({
            t: new Date(barStart * 1000).toISOString(),
            o: acc.o,
            h: acc.h,
            l: acc.l,
            c: acc.c,
            v: acc.v,
          });
        } catch { /* ignore bad JSON */ }
      });

      es.onerror = () => {
        es?.close();
        if (alive) retryTimer = setTimeout(connect, 5_000);
      };
    }

    connect();

    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
      accRef.current = null;
      setLiveBar(null);
    };
  }, [symbol, interval, enabled, token]);

  return liveBar;
}
