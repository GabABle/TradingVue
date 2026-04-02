import { useState, useEffect, useCallback, useMemo } from "react";
import { useGetBars, useGetQuote } from "@workspace/api-client-react";
import { ChartWidget } from "@/components/ChartWidget";
import { TopToolbar } from "@/components/TopToolbar";
import { RightPanel } from "@/components/RightPanel";
import { SymbolSearch } from "@/components/SymbolSearch";
import { AlertModal } from "@/components/AlertModal";
import { useAlertEvents } from "@/hooks/useAlertEvents";
import {
  type RangeKey,
  type IntervalKey,
  RANGE_CONFIG,
  INTERVAL_LABELS,
  getRangeStart,
  resolveInterval,
} from "@/lib/ranges";
import { Activity, AlertCircle, Star } from "lucide-react";

const DEFAULT_WATCHLIST = [
  "AAPL", "MSFT", "TSLA", "GOOGL", "NVDA", "AMZN", "BTCUSD", "ETHUSD",
  "MU", "META", "SNDK", "AVGO", "PLTR", "TSM", "LITE", "INTC",
  "DUO", "AI", "SE", "UPST", "NFLX", "UBER", "DASH", "ADBE", "SNOW",
];
const STORAGE_KEY = "tradingTerminalState_v1";

interface PersistedState {
  symbol: string;
  selectedRange: RangeKey;
  interval: IntervalKey;
  showRSI: boolean;
  showStoch: boolean;
  smaPeriod: number | null;
  emaPeriod: number | null;
  watchlist: string[];
}

const VALID_RANGES    = Object.keys(RANGE_CONFIG) as RangeKey[];
const VALID_INTERVALS = Object.keys(INTERVAL_LABELS) as IntervalKey[];

function loadState(): PersistedState {
  const defaults: PersistedState = {
    symbol: "AAPL", selectedRange: "1Y", interval: "1Day",
    showRSI: false, showStoch: false, smaPeriod: null, emaPeriod: null,
    watchlist: DEFAULT_WATCHLIST,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<PersistedState>;
    return {
      symbol:        typeof p.symbol === "string" && p.symbol.length > 0 ? p.symbol : defaults.symbol,
      selectedRange: VALID_RANGES.includes(p.selectedRange as RangeKey) ? p.selectedRange as RangeKey : defaults.selectedRange,
      interval:      VALID_INTERVALS.includes(p.interval as IntervalKey) ? p.interval as IntervalKey : defaults.interval,
      showRSI:       typeof p.showRSI === "boolean"   ? p.showRSI   : defaults.showRSI,
      showStoch:     typeof p.showStoch === "boolean"  ? p.showStoch : defaults.showStoch,
      smaPeriod:     typeof p.smaPeriod === "number"   || p.smaPeriod === null ? p.smaPeriod ?? null : defaults.smaPeriod,
      emaPeriod:     typeof p.emaPeriod === "number"   || p.emaPeriod === null ? p.emaPeriod ?? null : defaults.emaPeriod,
      watchlist:     (() => {
        const existing = Array.isArray(p.watchlist) && p.watchlist.length > 0 ? p.watchlist : defaults.watchlist;
        const existingSet = new Set(existing);
        return [...existing, ...DEFAULT_WATCHLIST.filter((s) => !existingSet.has(s))];
      })(),
    };
  } catch { return defaults; }
}

export default function TradingTerminal() {
  const saved = loadState();

  const [symbol, setSymbol]               = useState(saved.symbol);
  const [selectedRange, setSelectedRange] = useState<RangeKey>(saved.selectedRange);
  const [interval, setInterval]           = useState<IntervalKey>(saved.interval);
  const [showRSI, setShowRSI]             = useState(saved.showRSI);
  const [showStoch, setShowStoch]         = useState(saved.showStoch);
  const [smaPeriod, setSmaPeriod]         = useState<number | null>(saved.smaPeriod);
  const [emaPeriod, setEmaPeriod]         = useState<number | null>(saved.emaPeriod);
  const [watchlist, setWatchlist]         = useState<string[]>(saved.watchlist);
  const [searchOpen, setSearchOpen]       = useState(false);
  const [searchInitial, setSearchInitial] = useState("");
  const [alertOpen, setAlertOpen]         = useState(false);

  // Persist app state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        symbol, selectedRange, interval, showRSI, showStoch, smaPeriod, emaPeriod, watchlist,
      }));
    } catch { /* ignore */ }
  }, [symbol, selectedRange, interval, showRSI, showStoch, smaPeriod, emaPeriod, watchlist]);

  const handleRangeChange = useCallback((newRange: RangeKey) => {
    setSelectedRange(newRange);
    setInterval(prev => resolveInterval(newRange, prev));
  }, []);

  const handleIntervalChange = useCallback((newInterval: IntervalKey) => {
    setInterval(newInterval);
  }, []);

  // A unique timestamp generated each time symbol/interval/range changes.
  // Using Date.now() ensures each combination gets a URL the proxy has NEVER cached,
  // completely bypassing any stale proxy cache regardless of response headers.
  const cacheBust = useMemo(() => Date.now(), [symbol, interval, selectedRange]);
  const { data: barsData, isLoading, error } = useGetBars(
    {
      symbol,
      timeframe: interval,
      start: getRangeStart(selectedRange),
      limit: 2000,
      ...({ _t: cacheBust } as any),
    },
    // gcTime: 0 evicts react-query cache immediately on unmount
    // request.cache 'no-store' forces fetch() to bypass browser/proxy HTTP cache entirely
    // refetchOnWindowFocus 'always' forces a fresh fetch when user focuses the tab
    { query: { gcTime: 0, refetchOnWindowFocus: 'always' } as any, request: { cache: 'no-store' } },
  );

  const { data: quoteData } = useGetQuote({ symbol });
  const _session      = (quoteData as any)?.session      as string | undefined;
  const _prevClose    = (quoteData as any)?.prevClose    as number | null | undefined;
  const _regularClose = (quoteData as any)?.regularClose as number | null | undefined;
  // Yellow reference line: yesterday's close during PRE, today's regular close during AFTER
  const referencePrice: number | null =
    _session === "pre"   ? (_prevClose    ?? null) :
    _session === "after" ? (_regularClose ?? null) :
    null;
  // Amber/indigo EXT line: current extended-hours price
  const _extSession = (_session === "pre" || _session === "after") ? _session : null;
  const _preMarketPrice = (quoteData as any)?.preMarketPrice as number | null | undefined;
  const _extPrice: number | null =
    _extSession === "pre"
      ? (_preMarketPrice ?? null)                 // only show PRE line if actual pre-market bars exist
      : _extSession === "after"
        ? ((quoteData as any)?.price ?? null)     // after-hours: latestTrade is a post-market trade
        : null;

  // Request notification permission on first alert open
  const openAlerts = useCallback(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    setAlertOpen(true);
  }, []);

  // SSE — show browser notification when an alert triggers
  useAlertEvents(useCallback((payload) => {
    const { alert, currentPrice } = payload;
    const dir = alert.condition === "above" ? "▲" : "▼";
    const title = `🔔 ${alert.symbol} Alert Triggered`;
    const body = `${dir} ${alert.symbol} reached $${currentPrice.toFixed(2)} (target: $${alert.targetPrice})`;

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    } else {
      // Fallback: simple alert
      console.warn("[TradingVue Alert]", title, body);
    }
  }, []));

  // Keyboard shortcuts: any letter key opens symbol search
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[a-zA-Z]$/.test(e.key) && !searchOpen) {
        e.preventDefault();
        setSearchInitial(e.key.toUpperCase());
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [searchOpen]);

  const openSearch = useCallback((initial = "") => {
    setSearchInitial(initial);
    setSearchOpen(true);
  }, []);

  const handleSymbolSelect = (sym: string) => { setSymbol(sym); };

  const isInWatchlist = watchlist.includes(symbol);
  const toggleWatchlist = () => {
    if (isInWatchlist) setWatchlist(prev => prev.filter(s => s !== symbol));
    else               setWatchlist(prev => [symbol, ...prev]);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0a0e17] text-[#d1d4dc] overflow-hidden font-sans">

      <TopToolbar
        symbol={symbol}
        selectedRange={selectedRange}
        interval={interval}
        onRangeChange={handleRangeChange}
        onIntervalChange={handleIntervalChange}
        showRSI={showRSI} setShowRSI={setShowRSI}
        showStoch={showStoch} setShowStoch={setShowStoch}
        smaPeriod={smaPeriod} setSmaPeriod={setSmaPeriod}
        emaPeriod={emaPeriod} setEmaPeriod={setEmaPeriod}
        onSearchOpen={openSearch}
        onAlertOpen={openAlerts}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">

        <main className="flex-1 relative p-3 flex flex-col min-w-0">

          {isLoading && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#131722]/70 backdrop-blur-sm rounded-xl m-3">
              <div className="w-10 h-10 border-4 border-[#2962ff]/30 border-t-[#2962ff] rounded-full animate-spin" />
              <p className="mt-3 text-[#787b86] text-sm animate-pulse">Loading market data…</p>
            </div>
          )}

          {error && !isLoading && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#131722] rounded-xl m-3 border border-[#ef5350]/20">
              <AlertCircle className="w-10 h-10 text-[#ef5350] mb-3" />
              <h3 className="text-lg font-bold text-[#d1d4dc] mb-1">Data Unavailable</h3>
              <p className="text-[#787b86] text-sm text-center max-w-sm">
                {(error as any)?.message ?? "Could not fetch market data."}
              </p>
            </div>
          )}

          {!isLoading && !error && barsData?.bars.length === 0 && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#131722] rounded-xl m-3 border border-[#2a2e39]">
              <Activity className="w-14 h-14 text-[#2a2e39] mb-3" />
              <p className="text-[#787b86] text-sm">
                No data for <span className="font-mono font-bold text-[#d1d4dc]">{symbol}</span> at this range / interval.
              </p>
            </div>
          )}

          {!error && barsData && barsData.bars.length > 0 && (
            <div className="relative flex-1 w-full h-full rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-300">
              <ChartWidget
                key={`${symbol}|${interval}|${selectedRange}`}
                data={barsData.bars}
                showRSI={showRSI}
                showStoch={showStoch}
                smaPeriod={smaPeriod}
                emaPeriod={emaPeriod}
                referencePrice={referencePrice}
                extPrice={_extPrice}
                extSession={_extSession}
              />

              {/* Watchlist star */}
              <button
                onClick={toggleWatchlist}
                title={isInWatchlist ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
                className={`
                  absolute top-3 left-3 z-20
                  flex items-center gap-1.5 px-2.5 py-1.5
                  rounded-md border text-xs font-semibold
                  backdrop-blur-sm transition-all duration-150 group
                  ${isInWatchlist
                    ? "bg-[#1e222d]/90 border-[#f59e0b]/40 text-[#f59e0b] hover:border-[#ef5350]/50 hover:text-[#ef5350]"
                    : "bg-[#1e222d]/80 border-[#2a2e39] text-[#787b86] hover:border-[#f59e0b]/50 hover:text-[#f59e0b]"
                  }
                `}
              >
                <Star className={`w-3.5 h-3.5 transition-all ${isInWatchlist ? "fill-[#f59e0b]" : "fill-transparent group-hover:fill-[#f59e0b]/20"}`} />
                {isInWatchlist ? "Watching" : "Watch"}
              </button>

            </div>
          )}
        </main>

        <RightPanel
          symbols={watchlist}
          activeSymbol={symbol}
          onSelect={setSymbol}
          onAdd={sym => setWatchlist(p => p.includes(sym) ? p : [...p, sym])}
          onRemove={sym => setWatchlist(p => p.filter(s => s !== sym))}
          onSearchOpen={openSearch}
          chatContext={{ symbol, range: selectedRange, interval, showRSI, showStoch, smaPeriod, emaPeriod }}
        />
      </div>

      <SymbolSearch
        open={searchOpen}
        initialQuery={searchInitial}
        onClose={() => { setSearchOpen(false); setSearchInitial(""); }}
        onSelect={handleSymbolSelect}
      />

      <AlertModal
        open={alertOpen}
        symbol={symbol}
        currentPrice={(quoteData as any)?.price ?? null}
        onClose={() => setAlertOpen(false)}
      />
    </div>
  );
}
