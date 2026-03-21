import { Activity, TrendingUp, Settings2, Search, BarChart2 } from "lucide-react";
import { useGetQuote } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  type RangeKey,
  type IntervalKey,
  RANGE_CONFIG,
  INTERVAL_LABELS,
  RANGE_LABELS,
} from "@/lib/ranges";

interface TopToolbarProps {
  symbol: string;
  selectedRange: RangeKey;
  interval: IntervalKey;
  onRangeChange: (r: RangeKey) => void;
  onIntervalChange: (i: IntervalKey) => void;
  showRSI: boolean;
  setShowRSI: (s: boolean) => void;
  showStoch: boolean;
  setShowStoch: (s: boolean) => void;
  smaPeriod: number | null;
  setSmaPeriod: (p: number | null) => void;
  emaPeriod: number | null;
  setEmaPeriod: (p: number | null) => void;
  onSearchOpen: (initial?: string) => void;
}

export function TopToolbar({
  symbol,
  selectedRange,
  interval,
  onRangeChange,
  onIntervalChange,
  showRSI,
  setShowRSI,
  showStoch,
  setShowStoch,
  smaPeriod,
  setSmaPeriod,
  emaPeriod,
  setEmaPeriod,
  onSearchOpen,
}: TopToolbarProps) {
  const { data: quote } = useGetQuote(
    { symbol },
    { query: { refetchInterval: 10_000 } }
  );

  const validIntervals = RANGE_CONFIG[selectedRange].intervals;

  const formatPrice = (p: number) =>
    p < 1
      ? `$${p.toFixed(4)}`
      : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(p);

  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 bg-[#1e222d] border-b border-[#2a2e39] shadow-sm shrink-0 overflow-x-auto hide-scrollbar">

      {/* ── Left: symbol + live price ── */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Symbol search trigger — clicking opens search, but typing anywhere also works */}
        <button
          className="group flex items-center gap-2 px-3 py-1.5 bg-[#131722] hover:bg-[#2a2e39] border border-[#2a2e39] hover:border-[#363a45] rounded-md transition-all duration-150 shadow-sm"
          onClick={() => onSearchOpen()}
          title="Click or start typing to search symbols"
        >
          <Search className="w-3.5 h-3.5 text-[#4a4f5e] group-hover:text-[#787b86] transition-colors shrink-0" />
          <span className="text-[#d1d4dc] font-mono font-bold text-sm tracking-wide">{symbol}</span>
        </button>

        {quote ? (
          <div className="hidden sm:flex items-baseline gap-2">
            <span className="text-lg font-bold font-mono text-[#d1d4dc] tracking-tight">
              {formatPrice(quote.price)}
            </span>
            <span
              className={`text-xs font-semibold ${
                quote.change >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"
              }`}
            >
              {quote.change >= 0 ? "+" : ""}
              {quote.change.toFixed(2)}&nbsp;(
              {quote.change >= 0 ? "+" : ""}
              {quote.changePercent.toFixed(2)}%)
            </span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-20 h-5 bg-[#2a2e39] rounded animate-pulse" />
            <div className="w-14 h-4 bg-[#2a2e39] rounded animate-pulse" />
          </div>
        )}
      </div>

      {/* ── Right: controls ── */}
      <div className="flex items-center gap-2 shrink-0">

        {/* Interval selector */}
        <div className="flex bg-[#131722] rounded-md border border-[#2a2e39] p-0.5">
          {validIntervals.map((iv) => (
            <button
              key={iv}
              onClick={() => onIntervalChange(iv)}
              title={`${INTERVAL_LABELS[iv]} per bar`}
              className={`px-2.5 py-1 text-xs font-semibold rounded transition-all duration-150 min-w-[2rem] ${
                interval === iv
                  ? "bg-[#2a2e39] text-[#d1d4dc] shadow-sm"
                  : "text-[#4a4f5e] hover:text-[#787b86]"
              }`}
            >
              {INTERVAL_LABELS[iv]}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-[#2a2e39]" />

        {/* Date range selector */}
        <div className="flex bg-[#131722] rounded-md border border-[#2a2e39] p-0.5">
          {RANGE_LABELS.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              className={`px-2.5 py-1 text-xs font-semibold rounded transition-all duration-150 ${
                selectedRange === r
                  ? "bg-[#2962ff] text-white shadow-sm"
                  : "text-[#787b86] hover:text-[#d1d4dc] hover:bg-[#2a2e39]"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-[#2a2e39]" />

        {/* RSI toggle */}
        <button
          onClick={() => setShowRSI(!showRSI)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all duration-150 ${
            showRSI
              ? "bg-[#b22833]/10 border-[#b22833]/50 text-[#b22833]"
              : "bg-transparent border-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc] hover:border-[#787b86]"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          RSI
        </button>

        {/* Stochastic toggle */}
        <button
          onClick={() => setShowStoch(!showStoch)}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all duration-150 ${
            showStoch
              ? "bg-[#26c6da]/10 border-[#26c6da]/50 text-[#26c6da]"
              : "bg-transparent border-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc] hover:border-[#787b86]"
          }`}
        >
          <BarChart2 className="w-3.5 h-3.5" />
          Stoch
        </button>

        {/* Moving Averages */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-md border border-[#2a2e39] bg-transparent text-[#787b86] hover:text-[#d1d4dc] hover:border-[#787b86] transition-all duration-150">
              <TrendingUp className="w-3.5 h-3.5" />
              MAs
              <Settings2 className="w-3 h-3 ml-0.5" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-60 p-4 bg-[#1e222d] border-[#2a2e39] shadow-xl" align="end">
            <h4 className="font-semibold text-sm text-[#d1d4dc] mb-3">Moving Averages</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-[#787b86] flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#2962ff]" />
                  SMA
                </label>
                <select
                  className="bg-[#131722] border border-[#2a2e39] rounded px-2 py-1 text-xs text-[#d1d4dc] outline-none"
                  value={smaPeriod ?? "off"}
                  onChange={(e) =>
                    setSmaPeriod(e.target.value === "off" ? null : Number(e.target.value))
                  }
                >
                  <option value="off">Off</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm text-[#787b86] flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#ff9800]" />
                  EMA
                </label>
                <select
                  className="bg-[#131722] border border-[#2a2e39] rounded px-2 py-1 text-xs text-[#d1d4dc] outline-none"
                  value={emaPeriod ?? "off"}
                  onChange={(e) =>
                    setEmaPeriod(e.target.value === "off" ? null : Number(e.target.value))
                  }
                >
                  <option value="off">Off</option>
                  <option value="9">9</option>
                  <option value="21">21</option>
                  <option value="50">50</option>
                </select>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
