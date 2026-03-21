import { useState } from "react";
import { Plus, X, Star } from "lucide-react";
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

function WatchlistItem({
  symbol,
  isActive,
  onClick,
  onRemove,
}: {
  symbol: string;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const { data: quote } = useGetQuote(
    { symbol },
    { query: { refetchInterval: 15000 } }
  );

  const isUp = (quote?.change ?? 0) >= 0;

  return (
    <div
      className={`group relative flex items-center justify-between px-3 py-2.5 cursor-pointer transition-colors rounded-md mx-2 my-0.5 ${
        isActive
          ? "bg-[#2962ff]/15 border border-[#2962ff]/30"
          : "hover:bg-[#2a2e39] border border-transparent"
      }`}
      onClick={onClick}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-bold font-mono ${isActive ? "text-[#2962ff]" : "text-[#d1d4dc]"}`}>
            {symbol}
          </span>
        </div>
        {quote ? (
          <div className={`text-[10px] font-semibold mt-0.5 ${isUp ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
            {isUp ? "+" : ""}{quote.changePercent.toFixed(2)}%
          </div>
        ) : (
          <div className="text-[10px] text-[#787b86]">—</div>
        )}
      </div>

      <div className="text-right">
        {quote ? (
          <div className="text-xs font-mono font-bold text-[#d1d4dc]">
            {quote.price < 1
              ? quote.price.toFixed(4)
              : quote.price.toFixed(2)}
          </div>
        ) : (
          <div className="w-12 h-3 bg-[#2a2e39] rounded animate-pulse" />
        )}
      </div>

      {/* Remove button - shows on hover */}
      <button
        className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-[#ef5350] text-[#787b86] transition-all"
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

export function Watchlist({
  symbols,
  activeSymbol,
  onSelect,
  onAdd,
  onRemove,
  onSearchOpen,
  fullHeight,
}: WatchlistProps) {
  return (
    <div className={`flex flex-col bg-[#131722] overflow-hidden ${fullHeight ? "h-full" : "w-52 shrink-0 border-l border-[#2a2e39] h-full"}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-[#2a2e39]">
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

      {/* Symbol List */}
      <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
        {symbols.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Star className="w-6 h-6 text-[#2a2e39]" />
            <p className="text-xs text-[#787b86] text-center">
              No symbols yet.<br />Click + to add.
            </p>
          </div>
        ) : (
          symbols.map((sym) => (
            <WatchlistItem
              key={sym}
              symbol={sym}
              isActive={sym === activeSymbol}
              onClick={() => onSelect(sym)}
              onRemove={() => onRemove(sym)}
            />
          ))
        )}
      </div>

      {/* Footer: Add defaults link */}
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
