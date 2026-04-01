import { useEffect, useRef, useState } from "react";
import { Search, X, TrendingUp, Bitcoin, DollarSign } from "lucide-react";
import { useDebounce } from "use-debounce";
import { useSearchSymbols } from "@workspace/api-client-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface SymbolSearchProps {
  open: boolean;
  initialQuery?: string;
  onClose: () => void;
  onSelect: (symbol: string) => void;
}

const POPULAR_STOCKS = ["AAPL", "MSFT", "TSLA", "NVDA", "AMZN", "GOOGL"];
const POPULAR_CRYPTO_SYM = ["BTCUSD", "ETHUSD"];
const POPULAR_FX = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"];

export function SymbolSearch({ open, initialQuery = "", onClose, onSelect }: SymbolSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery] = useDebounce(query, 250);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: results, isFetching } = useSearchSymbols(
    { query: debouncedQuery },
    { query: { enabled: debouncedQuery.trim().length > 0 } }
  );

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
    }
  }, [open, initialQuery]);

  const handleSelect = (symbol: string) => {
    onSelect(symbol);
    onClose();
    setQuery("");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter") {
      const first = results?.results?.[0];
      if (first) handleSelect(first.symbol);
    }
  };

  const items = results?.results ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="p-0 gap-0 bg-[#1e222d] border-[#2a2e39] shadow-2xl max-w-lg w-full overflow-hidden rounded-xl [&>button]:text-[#787b86] [&>button]:hover:text-[#d1d4dc]"
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
          const len = inputRef.current?.value.length ?? 0;
          inputRef.current?.setSelectionRange(len, len);
        }}
      >
        {/* Search Input Row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#2a2e39]">
          <Search className="w-5 h-5 text-[#787b86] shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[#d1d4dc] text-base outline-none placeholder:text-[#787b86] font-mono"
            placeholder="Search symbol, e.g. AAPL, BTC..."
            value={query}
            onChange={(e) => setQuery(e.target.value.toUpperCase())}
            onKeyDown={handleInputKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-[#787b86] hover:text-[#d1d4dc] transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results List */}
        <div className="max-h-72 overflow-y-auto">
          {isFetching && (
            <div className="py-6 text-center">
              <div className="w-5 h-5 border-2 border-[#2962ff]/30 border-t-[#2962ff] rounded-full animate-spin mx-auto" />
              <p className="text-[#787b86] text-sm mt-2">Searching...</p>
            </div>
          )}

          {!isFetching && query.length > 0 && items.length === 0 && (
            <div className="py-8 text-center text-[#787b86] text-sm">
              No results for{" "}
              <span className="text-[#d1d4dc] font-mono">&ldquo;{query}&rdquo;</span>
            </div>
          )}

          {!isFetching && items.length > 0 && (
            <ul>
              {items.map((res, i) => {
                const isCrypto = res.type === "crypto";
                const isForex  = res.type === "forex";
                const iconBg   = isCrypto ? "bg-[#ff9800]/10" : isForex ? "bg-[#26a69a]/10" : "bg-[#2962ff]/10";
                const badgeCls = isCrypto ? "bg-[#ff9800]/10 text-[#ff9800]" : isForex ? "bg-[#26a69a]/10 text-[#26a69a]" : "bg-[#2962ff]/10 text-[#2962ff]";
                return (
                  <li key={res.symbol}>
                    <button
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#2a2e39] ${
                        i === 0 ? "bg-[#2a2e39]/40" : ""
                      }`}
                      onClick={() => handleSelect(res.symbol)}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
                        {isCrypto ? (
                          <Bitcoin className="w-4 h-4 text-[#ff9800]" />
                        ) : isForex ? (
                          <DollarSign className="w-4 h-4 text-[#26a69a]" />
                        ) : (
                          <TrendingUp className="w-4 h-4 text-[#2962ff]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold font-mono text-[#d1d4dc] text-sm">{res.symbol}</div>
                        <div className="text-xs text-[#787b86] truncate">{res.name}</div>
                      </div>
                      <span className={`text-[10px] uppercase px-2 py-0.5 rounded font-semibold ${badgeCls}`}>
                        {res.type || "stock"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {!query && (
            <div className="px-4 py-4 space-y-3">
              <div>
                <p className="text-[10px] text-[#4c525e] uppercase font-semibold mb-2 tracking-wider">Stocks</p>
                <div className="flex flex-wrap gap-2">
                  {POPULAR_STOCKS.map((sym) => (
                    <button key={sym} className="px-3 py-1.5 text-xs font-mono font-bold bg-[#2a2e39] hover:bg-[#363a45] text-[#d1d4dc] rounded-md transition-colors" onClick={() => handleSelect(sym)}>{sym}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] text-[#4c525e] uppercase font-semibold mb-2 tracking-wider">Crypto</p>
                <div className="flex flex-wrap gap-2">
                  {POPULAR_CRYPTO_SYM.map((sym) => (
                    <button key={sym} className="px-3 py-1.5 text-xs font-mono font-bold bg-[#ff9800]/10 hover:bg-[#ff9800]/20 text-[#ff9800] rounded-md transition-colors" onClick={() => handleSelect(sym)}>{sym}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] text-[#4c525e] uppercase font-semibold mb-2 tracking-wider">Forex</p>
                <div className="flex flex-wrap gap-2">
                  {POPULAR_FX.map((sym) => (
                    <button key={sym} className="px-3 py-1.5 text-xs font-mono font-bold bg-[#26a69a]/10 hover:bg-[#26a69a]/20 text-[#26a69a] rounded-md transition-colors" onClick={() => handleSelect(sym)}>{sym}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="px-4 py-2 border-t border-[#2a2e39] flex items-center gap-4 text-[10px] text-[#787b86]">
          <span>
            <kbd className="bg-[#2a2e39] px-1.5 py-0.5 rounded font-mono text-[9px]">↵</kbd> select
          </span>
          <span>
            <kbd className="bg-[#2a2e39] px-1.5 py-0.5 rounded font-mono text-[9px]">Esc</kbd> close
          </span>
          <span className="ml-auto">Start typing anywhere to search</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
