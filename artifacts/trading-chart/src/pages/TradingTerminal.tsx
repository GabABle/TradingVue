import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useGetBars, useGetQuote } from "@workspace/api-client-react";
import { ChartWidget } from "@/components/ChartWidget";
import { TopToolbar } from "@/components/TopToolbar";
import { RightPanel } from "@/components/RightPanel";
import { SymbolSearch } from "@/components/SymbolSearch";
import { AlertModal } from "@/components/AlertModal";
import { TradingModal } from "@/components/TradingModal";
import { useAlertEvents } from "@/hooks/useAlertEvents";
import { useLiveBar } from "@/hooks/useLiveBar";
import { useAuth } from "@/contexts/AuthContext";
import {
  type RangeKey,
  type IntervalKey,
  RANGE_CONFIG,
  INTERVAL_LABELS,
  getRangeStart,
  resolveInterval,
} from "@/lib/ranges";
import { Activity, AlertCircle, Star } from "lucide-react";
import {
  type WatchlistSection,
  loadSections,
  saveSections,
  addSymbolToSections,
  removeSymbolFromSections,
} from "@/lib/watchlist-sections";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

const DEFAULT_WATCHLIST = [
  "AAPL", "MSFT", "TSLA", "GOOGL", "NVDA", "AMZN", "BTCUSD", "ETHUSD",
  "MU", "META", "SNDK", "AVGO", "PLTR", "TSM", "LITE", "INTC",
  "DUO", "AI", "SE", "UPST", "NFLX", "UBER", "DASH", "ADBE", "SNOW",
];

const STORAGE_KEY = "tradingTerminalState_v2";

interface PersistedState {
  symbol: string;
  selectedRange: RangeKey;
  interval: IntervalKey;
  showRSI: boolean;
  showStoch: boolean;
  smaPeriod: number | null;
  emaPeriod: number | null;
}

const VALID_RANGES    = Object.keys(RANGE_CONFIG) as RangeKey[];
const VALID_INTERVALS = Object.keys(INTERVAL_LABELS) as IntervalKey[];

function loadState(): PersistedState {
  const defaults: PersistedState = {
    symbol: "AAPL", selectedRange: "1Y", interval: "1Day",
    showRSI: false, showStoch: false, smaPeriod: null, emaPeriod: null,
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
    };
  } catch { return defaults; }
}

export default function TradingTerminal() {
  const { token, authFetch } = useAuth();
  const saved = loadState();

  const [symbol, setSymbol]               = useState(saved.symbol);
  const [selectedRange, setSelectedRange] = useState<RangeKey>(saved.selectedRange);
  const [interval, setInterval]           = useState<IntervalKey>(saved.interval);
  const [showRSI, setShowRSI]             = useState(saved.showRSI);
  const [showStoch, setShowStoch]         = useState(saved.showStoch);
  const [smaPeriod, setSmaPeriod]         = useState<number | null>(saved.smaPeriod);
  const [emaPeriod, setEmaPeriod]         = useState<number | null>(saved.emaPeriod);
  // Sections are the source of truth for the watchlist (loaded from localStorage immediately,
  // then superseded by DB data once fetched).
  const [sections, setSections]           = useState<WatchlistSection[]>(() => loadSections(DEFAULT_WATCHLIST));
  const [searchOpen, setSearchOpen]       = useState(false);
  const [searchInitial, setSearchInitial] = useState("");
  const [alertOpen, setAlertOpen]         = useState(false);
  const [alertSymbol, setAlertSymbol]     = useState(symbol);
  const [alertPrice, setAlertPrice]       = useState<number | null>(null);
  const [tradeOpen, setTradeOpen]         = useState(false);

  // Flat symbol list derived from sections (single source of truth)
  const watchlist = useMemo(() => sections.flatMap((s) => s.symbols), [sections]);

  // ── Persist chart prefs to localStorage ───────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        symbol, selectedRange, interval, showRSI, showStoch, smaPeriod, emaPeriod,
      }));
    } catch { /* ignore */ }
  }, [symbol, selectedRange, interval, showRSI, showStoch, smaPeriod, emaPeriod]);

  // ── Load sections from DB on mount (supersedes localStorage) ──────────────
  const dbLoaded = useRef(false);
  useEffect(() => {
    authFetch(`${BASE}/api/user/watchlist`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { sections?: WatchlistSection[]; symbols?: string[] }) => {
        dbLoaded.current = true;
        if (Array.isArray(data.sections) && data.sections.length > 0) {
          // New format: full sections from DB
          setSections(data.sections);
          saveSections(data.sections); // keep localStorage in sync
        } else if (Array.isArray(data.symbols) && data.symbols.length > 0) {
          // Old flat-symbols format: migrate using current localStorage structure
          const migrated = loadSections(data.symbols);
          setSections(migrated);
        } else {
          // First-time user: save current (localStorage) sections to DB
          setSections(prev => {
            authFetch(`${BASE}/api/user/watchlist`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sections: prev }),
            }).catch(() => {});
            return prev;
          });
        }
      })
      .catch(() => { dbLoaded.current = true; /* keep localStorage sections on error */ });
  }, [authFetch]);

  // ── Auto-save sections to DB + localStorage on every change ───────────────
  const sectionsInitialized = useRef(false);
  useEffect(() => {
    if (!sectionsInitialized.current) {
      sectionsInitialized.current = true;
      return;
    }
    // Always keep localStorage up-to-date immediately
    saveSections(sections);
    // Debounce the DB write
    const timer = setTimeout(() => {
      authFetch(`${BASE}/api/user/watchlist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections }),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [sections, authFetch]);

  // ── Alert permission + SSE ────────────────────────────────────────────────
  const openAlerts = useCallback(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    setAlertSymbol(symbol);
    setAlertPrice(null);
    setAlertOpen(true);
  }, [symbol]);

  const handleAlertOpen = useCallback((sym: string, price: number | null) => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    setAlertSymbol(sym);
    setAlertPrice(price);
    setAlertOpen(true);
  }, []);

  useAlertEvents(token, useCallback((payload) => {
    const { alert, currentPrice } = payload;
    const dir = alert.condition === "above" ? "▲" : "▼";
    const title = `🔔 ${alert.symbol} Alert Triggered`;
    const body = `${dir} ${alert.symbol} reached $${currentPrice.toFixed(2)} (target: $${alert.targetPrice})`;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    }
  }, []));

  // ── Range / interval helpers ──────────────────────────────────────────────
  const handleRangeChange = useCallback((newRange: RangeKey) => {
    setSelectedRange(newRange);
    setInterval(prev => resolveInterval(newRange, prev));
  }, []);
  const handleIntervalChange = useCallback((newInterval: IntervalKey) => setInterval(newInterval), []);

  // Cache-bust key changes on every symbol/interval/range combination
  const cacheBust = useMemo(() => Date.now(), [symbol, interval, selectedRange]);
  const { data: barsData, isLoading, error } = useGetBars(
    { symbol, timeframe: interval, start: getRangeStart(selectedRange), limit: 2000, ...({ _t: cacheBust } as any) },
    { query: { gcTime: 0, refetchOnWindowFocus: "always" } as any, request: { cache: "no-store" } },
  );

  const { data: quoteData } = useGetQuote({ symbol });

  // ── Live streaming: assemble the forming current candle from trade ticks ──
  const liveBar = useLiveBar(symbol, interval, token);
  const _session      = (quoteData as any)?.session      as string | undefined;
  const _prevClose    = (quoteData as any)?.prevClose    as number | null | undefined;
  const _regularClose = (quoteData as any)?.regularClose as number | null | undefined;
  const referencePrice: number | null =
    _session === "pre"   ? (_prevClose    ?? null) :
    _session === "after" ? (_regularClose ?? null) :
    null;
  const _extSession = (_session === "pre" || _session === "after") ? _session : null;
  const _preMarketPrice = (quoteData as any)?.preMarketPrice as number | null | undefined;
  const _extPrice: number | null =
    _extSession === "pre"
      ? (_preMarketPrice ?? null)
      : _extSession === "after"
        ? ((quoteData as any)?.price ?? null)
        : null;

  // ── Keyboard shortcut: any letter opens search ────────────────────────────
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

  const isInWatchlist = watchlist.includes(symbol);
  const toggleWatchlist = () => {
    if (isInWatchlist) setSections(prev => removeSymbolFromSections(prev, symbol));
    else               setSections(prev => addSymbolToSections(prev, symbol));
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
        onTradeOpen={() => setTradeOpen(true)}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">

        <TradingModal
          open={tradeOpen}
          symbol={symbol}
          currentPrice={(quoteData as any)?.price ?? null}
          onClose={() => setTradeOpen(false)}
        />

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
                liveBar={liveBar}
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
          sections={sections}
          onSectionsChange={setSections}
          activeSymbol={symbol}
          onSelect={setSymbol}
          onSearchOpen={openSearch}
          onAlertOpen={handleAlertOpen}
          chatContext={{ symbol, range: selectedRange, interval, showRSI, showStoch, smaPeriod, emaPeriod }}
        />
      </div>

      <SymbolSearch
        open={searchOpen}
        initialQuery={searchInitial}
        onClose={() => { setSearchOpen(false); setSearchInitial(""); }}
        onSelect={sym => setSymbol(sym)}
      />

      <AlertModal
        open={alertOpen}
        symbol={alertSymbol}
        currentPrice={alertPrice ?? (alertSymbol === symbol ? ((quoteData as any)?.price ?? null) : null)}
        onClose={() => setAlertOpen(false)}
      />

    </div>
  );
}
