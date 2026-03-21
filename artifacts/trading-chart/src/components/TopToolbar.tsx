import { useState, useEffect } from "react";
import { Search, ChevronDown, Activity, TrendingUp, Settings2 } from "lucide-react";
import { useDebounce } from "use-debounce";
import { useSearchSymbols, useGetQuote } from "@workspace/api-client-react";
import { GetBarsTimeframe } from "@workspace/api-client-react/src/generated/api.schemas";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface TopToolbarProps {
  symbol: string;
  setSymbol: (s: string) => void;
  timeframe: GetBarsTimeframe;
  setTimeframe: (t: GetBarsTimeframe) => void;
  showRSI: boolean;
  setShowRSI: (s: boolean) => void;
  smaPeriod: number | null;
  setSmaPeriod: (p: number | null) => void;
  emaPeriod: number | null;
  setEmaPeriod: (p: number | null) => void;
}

const TIMEFRAMES: { label: string, value: GetBarsTimeframe }[] = [
  { label: '1m', value: '1Min' },
  { label: '5m', value: '5Min' },
  { label: '15m', value: '15Min' },
  { label: '1H', value: '1Hour' },
  { label: '4H', value: '4Hour' },
  { label: '1D', value: '1Day' },
  { label: '1W', value: '1Week' },
];

export function TopToolbar({
  symbol, setSymbol, timeframe, setTimeframe,
  showRSI, setShowRSI, smaPeriod, setSmaPeriod, emaPeriod, setEmaPeriod
}: TopToolbarProps) {
  
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery] = useDebounce(searchQuery, 300);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const { data: searchResults, isFetching: isSearching } = useSearchSymbols(
    { query: debouncedQuery },
    { query: { enabled: debouncedQuery.length > 1 } }
  );

  const { data: quote } = useGetQuote(
    { symbol },
    { query: { refetchInterval: 10000 } } // Refresh quote every 10s
  );

  const formatPrice = (p: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(p);

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-panel border-b border-border shadow-sm">
      
      {/* Left Group: Symbol Search & Quote */}
      <div className="flex items-center gap-4 flex-wrap">
        
        {/* Symbol Search Popover */}
        <Popover open={isSearchOpen} onOpenChange={setIsSearchOpen}>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-2 px-4 py-2 bg-background hover:bg-accent border border-border rounded-md text-foreground font-mono font-bold text-lg transition-all duration-200 shadow-sm focus:ring-2 focus:ring-primary/50 outline-none">
              {symbol}
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0 bg-panel border-border shadow-xl" align="start">
            <div className="flex items-center px-3 border-b border-border">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                className="w-full px-2 py-3 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="Search stocks & crypto..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {isSearching && <div className="p-4 text-sm text-muted-foreground text-center">Searching...</div>}
              {!isSearching && searchResults?.results && searchResults.results.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground text-center">No results found.</div>
              )}
              {!isSearching && searchResults?.results && searchResults.results.map((res) => (
                <button
                  key={res.symbol}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-accent text-left transition-colors"
                  onClick={() => {
                    setSymbol(res.symbol);
                    setIsSearchOpen(false);
                    setSearchQuery("");
                  }}
                >
                  <div>
                    <div className="font-bold font-mono text-foreground">{res.symbol}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[180px]">{res.name}</div>
                  </div>
                  <span className="text-[10px] uppercase bg-background px-2 py-1 rounded text-muted-foreground border border-border">
                    {res.type}
                  </span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Live Quote Info */}
        {quote && (
          <div className="hidden sm:flex items-baseline gap-3 pr-4 border-r border-border">
            <span className="text-2xl font-bold tracking-tight text-foreground font-mono">
              {formatPrice(quote.price)}
            </span>
            <div className={`flex items-center text-sm font-semibold ${quote.change >= 0 ? 'text-trade-up' : 'text-trade-down'}`}>
              <span>{quote.change > 0 ? '+' : ''}{quote.change.toFixed(2)}</span>
              <span className="mx-1">({quote.change > 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%)</span>
            </div>
          </div>
        )}
      </div>

      {/* Right Group: Controls */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
        
        {/* Timeframes */}
        <div className="flex bg-background rounded-md border border-border p-1 shadow-sm shrink-0">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`px-3 py-1 text-xs font-semibold rounded-sm transition-all duration-200 ${
                timeframe === tf.value 
                  ? 'bg-primary text-primary-foreground shadow-sm' 
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="w-px h-6 bg-border mx-2 shrink-0"></div>

        {/* Indicators Toggle */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowRSI(!showRSI)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border transition-all duration-200 ${
              showRSI 
                ? 'bg-primary/10 border-primary text-primary shadow-sm' 
                : 'bg-background border-border text-muted-foreground hover:border-muted-foreground'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            RSI
          </button>
          
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-all duration-200 shadow-sm">
                <TrendingUp className="w-3.5 h-3.5" />
                MAs
                <Settings2 className="w-3.5 h-3.5 ml-1" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-4 bg-panel border-border shadow-xl">
              <div className="space-y-4">
                <h4 className="font-semibold text-sm text-foreground">Moving Averages</h4>
                
                <div className="space-y-3">
                  {/* SMA Control */}
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-muted-foreground flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#2962ff]"></div>
                      SMA
                    </label>
                    <div className="flex items-center gap-2">
                      <select 
                        className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground outline-none"
                        value={smaPeriod || "off"}
                        onChange={(e) => setSmaPeriod(e.target.value === "off" ? null : Number(e.target.value))}
                      >
                        <option value="off">Off</option>
                        <option value="20">20</option>
                        <option value="50">50</option>
                        <option value="100">100</option>
                        <option value="200">200</option>
                      </select>
                    </div>
                  </div>

                  {/* EMA Control */}
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-muted-foreground flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#ff9800]"></div>
                      EMA
                    </label>
                    <div className="flex items-center gap-2">
                      <select 
                        className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground outline-none"
                        value={emaPeriod || "off"}
                        onChange={(e) => setEmaPeriod(e.target.value === "off" ? null : Number(e.target.value))}
                      >
                        <option value="off">Off</option>
                        <option value="9">9</option>
                        <option value="21">21</option>
                        <option value="50">50</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

      </div>
    </div>
  );
}
