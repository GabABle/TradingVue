import { useState, useEffect, useCallback } from "react";
import { useGetBars } from "@workspace/api-client-react";
import { ChartWidget } from "@/components/ChartWidget";
import { TopToolbar } from "@/components/TopToolbar";
import { Watchlist } from "@/components/Watchlist";
import { SymbolSearch } from "@/components/SymbolSearch";
import {
  type RangeKey,
  type IntervalKey,
  RANGE_CONFIG,
  getRangeStart,
  resolveInterval,
} from "@/lib/ranges";
import { Activity, AlertCircle } from "lucide-react";

const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "TSLA", "GOOGL", "NVDA", "AMZN", "BTCUSD", "ETHUSD"];

export default function TradingTerminal() {
  const [symbol, setSymbol]           = useState("AAPL");
  const [selectedRange, setSelectedRange] = useState<RangeKey>("1Y");
  const [interval, setInterval]       = useState<IntervalKey>("1Day");
  const [showRSI, setShowRSI]         = useState(false);
  const [smaPeriod, setSmaPeriod]     = useState<number | null>(null);
  const [emaPeriod, setEmaPeriod]     = useState<number | null>(null);
  const [watchlist, setWatchlist]     = useState<string[]>(DEFAULT_WATCHLIST);
  const [searchOpen, setSearchOpen]   = useState(false);
  const [searchInitial, setSearchInitial] = useState("");

  // When range changes, auto-adjust interval to the best valid option
  const handleRangeChange = useCallback((newRange: RangeKey) => {
    setSelectedRange(newRange);
    setInterval((prev) => resolveInterval(newRange, prev));
  }, []);

  // When interval is picked directly, just update it (always valid — toolbar only shows valid options)
  const handleIntervalChange = useCallback((newInterval: IntervalKey) => {
    setInterval(newInterval);
  }, []);

  const { data: barsData, isLoading, error } = useGetBars({
    symbol,
    timeframe: interval,
    start: getRangeStart(selectedRange),
    limit: 2000,
  });

  // Global keydown: letter key → open search pre-filled
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        setSearchInitial(e.key.toUpperCase());
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const openSearch = useCallback((initial = "") => {
    setSearchInitial(initial);
    setSearchOpen(true);
  }, []);

  const handleSymbolSelect = (sym: string) => {
    setSymbol(sym);
    setWatchlist((prev) => (prev.includes(sym) ? prev : [sym, ...prev]));
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0a0e17] text-[#d1d4dc] overflow-hidden font-sans">

      <TopToolbar
        symbol={symbol}
        selectedRange={selectedRange}
        interval={interval}
        onRangeChange={handleRangeChange}
        onIntervalChange={handleIntervalChange}
        showRSI={showRSI}
        setShowRSI={setShowRSI}
        smaPeriod={smaPeriod}
        setSmaPeriod={setSmaPeriod}
        emaPeriod={emaPeriod}
        setEmaPeriod={setEmaPeriod}
        onSearchOpen={openSearch}
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
                {(error as any)?.message ?? "Could not fetch market data. Check your API keys or try a different symbol."}
              </p>
            </div>
          )}

          {!isLoading && !error && barsData?.bars.length === 0 && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#131722] rounded-xl m-3 border border-[#2a2e39]">
              <Activity className="w-14 h-14 text-[#2a2e39] mb-3" />
              <p className="text-[#787b86] text-sm">
                No data for{" "}
                <span className="font-mono font-bold text-[#d1d4dc]">{symbol}</span>{" "}
                at this range / interval.
              </p>
            </div>
          )}

          {!error && barsData && barsData.bars.length > 0 && (
            <div className="flex-1 w-full h-full rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-300">
              {/* key forces a clean remount whenever symbol / interval / range changes,
                  eliminating stale series references that cause lightweight-charts crashes */}
              <ChartWidget
                key={`${symbol}|${interval}|${selectedRange}`}
                data={barsData.bars}
                showRSI={showRSI}
                smaPeriod={smaPeriod}
                emaPeriod={emaPeriod}
              />
            </div>
          )}
        </main>

        <Watchlist
          symbols={watchlist}
          activeSymbol={symbol}
          onSelect={setSymbol}
          onAdd={(sym) => setWatchlist((p) => (p.includes(sym) ? p : [...p, sym]))}
          onRemove={(sym) => setWatchlist((p) => p.filter((s) => s !== sym))}
          onSearchOpen={openSearch}
        />
      </div>

      <SymbolSearch
        open={searchOpen}
        initialQuery={searchInitial}
        onClose={() => { setSearchOpen(false); setSearchInitial(""); }}
        onSelect={handleSymbolSelect}
      />
    </div>
  );
}
