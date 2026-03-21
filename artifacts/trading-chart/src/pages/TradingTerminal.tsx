import { useState, useEffect, useCallback } from "react";
import { useGetBars } from "@workspace/api-client-react";
import { GetBarsTimeframe } from "@workspace/api-client-react/src/generated/api.schemas";
import { ChartWidget } from "@/components/ChartWidget";
import { TopToolbar } from "@/components/TopToolbar";
import { Watchlist } from "@/components/Watchlist";
import { SymbolSearch } from "@/components/SymbolSearch";
import { Activity, AlertCircle } from "lucide-react";

export type RangeKey = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y";

interface RangeConfig {
  timeframe: GetBarsTimeframe;
  daysBack: number;
}

const RANGE_CONFIG: Record<RangeKey, RangeConfig> = {
  "1D": { timeframe: "5Min",  daysBack: 1    },
  "1W": { timeframe: "1Hour", daysBack: 7    },
  "1M": { timeframe: "1Day",  daysBack: 30   },
  "3M": { timeframe: "1Day",  daysBack: 90   },
  "6M": { timeframe: "1Day",  daysBack: 180  },
  "1Y": { timeframe: "1Day",  daysBack: 365  },
  "5Y": { timeframe: "1Week", daysBack: 1825 },
};

function getRangeStart(range: RangeKey): string {
  const d = new Date();
  d.setDate(d.getDate() - RANGE_CONFIG[range].daysBack);
  return d.toISOString().split("T")[0];
}

const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "TSLA", "GOOGL", "NVDA", "AMZN", "BTCUSD", "ETHUSD"];

export default function TradingTerminal() {
  const [symbol, setSymbol] = useState("AAPL");
  const [selectedRange, setSelectedRange] = useState<RangeKey>("1Y");
  const [showRSI, setShowRSI] = useState(false);
  const [smaPeriod, setSmaPeriod] = useState<number | null>(null);
  const [emaPeriod, setEmaPeriod] = useState<number | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>(DEFAULT_WATCHLIST);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitial, setSearchInitial] = useState("");

  // Derive bar timeframe and start date from selected range
  const { timeframe, daysBack: _ } = RANGE_CONFIG[selectedRange];
  const startDate = getRangeStart(selectedRange);

  const { data: barsData, isLoading, error } = useGetBars({
    symbol,
    timeframe,
    start: startDate,
    limit: 2000,
  });

  // Global keydown: any letter key opens search dialog pre-filled
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
    // Auto-add to watchlist if not already there
    setWatchlist((prev) => (prev.includes(sym) ? prev : [sym, ...prev]));
  };

  const addToWatchlist = (sym: string) => {
    setWatchlist((prev) => (prev.includes(sym) ? prev : [...prev, sym]));
  };

  const removeFromWatchlist = (sym: string) => {
    setWatchlist((prev) => prev.filter((s) => s !== sym));
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0a0e17] text-[#d1d4dc] overflow-hidden font-sans">

      {/* Top Toolbar */}
      <TopToolbar
        symbol={symbol}
        selectedRange={selectedRange}
        setSelectedRange={setSelectedRange}
        showRSI={showRSI}
        setShowRSI={setShowRSI}
        smaPeriod={smaPeriod}
        setSmaPeriod={setSmaPeriod}
        emaPeriod={emaPeriod}
        setEmaPeriod={setEmaPeriod}
        onSearchOpen={openSearch}
      />

      {/* Body: Chart + Watchlist */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Chart Area */}
        <main className="flex-1 relative p-3 flex flex-col min-w-0">

          {isLoading && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#131722]/70 backdrop-blur-sm rounded-xl m-3">
              <div className="w-10 h-10 border-4 border-[#2962ff]/30 border-t-[#2962ff] rounded-full animate-spin" />
              <p className="mt-3 text-[#787b86] text-sm animate-pulse">Loading market data...</p>
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
              <p className="text-[#787b86] text-sm">No data for <span className="font-mono font-bold text-[#d1d4dc]">{symbol}</span> in this range.</p>
            </div>
          )}

          {!error && barsData && barsData.bars.length > 0 && (
            <div className="flex-1 w-full h-full rounded-xl overflow-hidden shadow-2xl animate-in fade-in duration-300">
              <ChartWidget
                data={barsData.bars}
                symbol={symbol}
                showRSI={showRSI}
                smaPeriod={smaPeriod}
                emaPeriod={emaPeriod}
              />
            </div>
          )}
        </main>

        {/* Watchlist Sidebar */}
        <Watchlist
          symbols={watchlist}
          activeSymbol={symbol}
          onSelect={setSymbol}
          onAdd={addToWatchlist}
          onRemove={removeFromWatchlist}
          onSearchOpen={openSearch}
        />
      </div>

      {/* Symbol Search Dialog */}
      <SymbolSearch
        open={searchOpen}
        initialQuery={searchInitial}
        onClose={() => {
          setSearchOpen(false);
          setSearchInitial("");
        }}
        onSelect={handleSymbolSelect}
      />
    </div>
  );
}
