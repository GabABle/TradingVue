import { useState, useCallback, useEffect, useMemo } from "react";
import { Plus, X, Star, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { useGetQuote } from "@workspace/api-client-react";

interface WatchlistProps {
  symbols: string[];
  activeSymbol: string;
  onSelect: (symbol: string) => void;
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onSearchOpen: (initial?: string) => void;
  fullHeight?: boolean;
}

const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "TSLA", "GOOGL", "NVDA", "AMZN", "BTCUSD", "ETHUSD"];
const SORT_STORAGE_KEY = "tradingTerminalWatchlistSort";

type SortDir = "desc" | "asc" | null;

function WatchlistItem({
  symbol,
  isActive,
  onClick,
  onRemove,
  onQuote,
}: {
  symbol: string;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
  onQuote: (symbol: string, pct: number | null) => void;
}) {
  const { data: quote } = useGetQuote(
    { symbol },
    { query: { refetchInterval: 15000 } }
  );

  useEffect(() => {
    onQuote(symbol, quote?.changePercent ?? null);
  }, [symbol, quote?.changePercent]);

  const isUp = (quote?.change ?? 0) >= 0;

  return (
    <div
      className={`group relative flex items-center px-2 py-2.5 cursor-pointer transition-colors rounded-sm mx-1 my-0.5 ${
        isActive
          ? "bg-[#2962ff]/15 border border-[#2962ff]/30"
          : "hover:bg-[#2a2e39] border border-transparent"
      }`}
      onClick={onClick}
    >
      {/* Symbol */}
      <div className="flex-1 min-w-0 pr-1">
        <span
          className={`text-xs font-bold font-mono truncate block ${
            isActive ? "text-[#2962ff]" : "text-[#d1d4dc]"
          }`}
        >
          {symbol}
        </span>
      </div>

      {/* % Change — standalone column */}
      <div className="w-[58px] shrink-0 text-right pr-2">
        {quote ? (
          <span
            className={`text-xs font-semibold font-mono ${
              isUp ? "text-[#26a69a]" : "text-[#ef5350]"
            }`}
          >
            {isUp ? "+" : ""}
            {quote.changePercent.toFixed(2)}%
          </span>
        ) : (
          <span className="text-[10px] text-[#787b86]">—</span>
        )}
      </div>

      {/* Price */}
      <div className="w-[52px] shrink-0 text-right">
        {quote ? (
          <span className="text-xs font-mono font-bold text-[#d1d4dc]">
            {quote.price < 1
              ? quote.price.toFixed(4)
              : quote.price.toFixed(2)}
          </span>
        ) : (
          <div className="ml-auto w-10 h-3 bg-[#2a2e39] rounded animate-pulse" />
        )}
      </div>

      {/* Remove button — overlaps price on hover */}
      <button
        className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-[#ef5350] text-[#787b86] transition-all z-10 bg-[#131722]/80"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

function loadSortDir(): SortDir {
  try {
    const v = localStorage.getItem(SORT_STORAGE_KEY);
    if (v === "asc" || v === "desc") return v;
  } catch { /* ignore */ }
  return null;
}

export function Watchlist({
  symbols,
  activeSymbol,
  onSelect,
  onAdd,
  onRemove,
  onSearchOpen,
  fullHeight,
}: WatchlistProps) {
  const [sortDir, setSortDir] = useState<SortDir>(loadSortDir);
  const [quotesMap, setQuotesMap] = useState<Record<string, number | null>>({});

  const handleQuoteUpdate = useCallback((symbol: string, pct: number | null) => {
    setQuotesMap((prev) => {
      if (prev[symbol] === pct) return prev;
      return { ...prev, [symbol]: pct };
    });
  }, []);

  const cycleSortDir = useCallback(() => {
    setSortDir((prev) => {
      const next: SortDir = prev === null ? "desc" : prev === "desc" ? "asc" : null;
      try {
        if (next === null) localStorage.removeItem(SORT_STORAGE_KEY);
        else localStorage.setItem(SORT_STORAGE_KEY, next);
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const sortedSymbols = useMemo(() => {
    if (!sortDir) return symbols;
    return [...symbols].sort((a, b) => {
      const pa = quotesMap[a] ?? (sortDir === "desc" ? -Infinity : Infinity);
      const pb = quotesMap[b] ?? (sortDir === "desc" ? -Infinity : Infinity);
      return sortDir === "desc" ? pb - pa : pa - pb;
    });
  }, [symbols, sortDir, quotesMap]);

  const SortIcon = sortDir === "desc" ? ChevronDown : sortDir === "asc" ? ChevronUp : ChevronsUpDown;

  return (
    <div
      className={`flex flex-col bg-[#131722] overflow-hidden ${
        fullHeight ? "h-full" : "w-52 shrink-0 border-l border-[#2a2e39] h-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#2a2e39]">
        <div className="flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 text-[#ff9800]" />
          <span className="text-xs font-semibold text-[#d1d4dc] tracking-wide">WATCHLIST</span>
        </div>
        <button
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc] transition-colors"
          onClick={() => onSearchOpen()}
          title="Add symbol"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Column headers */}
      {symbols.length > 0 && (
        <div className="flex items-center px-3 pt-1.5 pb-0.5 border-b border-[#2a2e39]/50">
          <div className="flex-1 text-[9px] font-semibold text-[#4c525e] tracking-widest uppercase">
            Symbol
          </div>
          <button
            className={`w-[58px] shrink-0 flex items-center justify-end gap-0.5 pr-2 text-[9px] font-semibold tracking-widest uppercase transition-colors ${
              sortDir ? "text-[#2962ff]" : "text-[#4c525e] hover:text-[#787b86]"
            }`}
            onClick={cycleSortDir}
            title={
              sortDir === null
                ? "Sort by % change (high→low)"
                : sortDir === "desc"
                ? "Sort by % change (low→high)"
                : "Clear sort"
            }
          >
            <span>%</span>
            <SortIcon className="w-2.5 h-2.5" />
          </button>
          <div className="w-[52px] shrink-0 text-right text-[9px] font-semibold text-[#4c525e] tracking-widest uppercase">
            Price
          </div>
        </div>
      )}

      {/* Symbol list */}
      <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
        {symbols.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Star className="w-6 h-6 text-[#2a2e39]" />
            <p className="text-xs text-[#787b86] text-center">
              No symbols yet.
              <br />
              Click + to add.
            </p>
          </div>
        ) : (
          sortedSymbols.map((sym) => (
            <WatchlistItem
              key={sym}
              symbol={sym}
              isActive={sym === activeSymbol}
              onClick={() => onSelect(sym)}
              onRemove={() => onRemove(sym)}
              onQuote={handleQuoteUpdate}
            />
          ))
        )}
      </div>

      {/* Footer: Add defaults */}
      {symbols.length === 0 && (
        <div className="border-t border-[#2a2e39] p-3">
          <button
            className="w-full text-xs text-[#787b86] hover:text-[#d1d4dc] transition-colors text-center"
            onClick={() => DEFAULT_SYMBOLS.forEach(onAdd)}
          >
            + Add defaults
          </button>
        </div>
      )}
    </div>
  );
}
