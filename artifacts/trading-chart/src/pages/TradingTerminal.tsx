import { useState } from "react";
import { useGetBars } from "@workspace/api-client-react";
import { GetBarsTimeframe } from "@workspace/api-client-react/src/generated/api.schemas";
import { ChartWidget } from "@/components/ChartWidget";
import { TopToolbar } from "@/components/TopToolbar";
import { Activity, AlertCircle } from "lucide-react";

export default function TradingTerminal() {
  // Global App State
  const [symbol, setSymbol] = useState("AAPL");
  const [timeframe, setTimeframe] = useState<GetBarsTimeframe>("1Day");
  
  // Indicator State
  const [showRSI, setShowRSI] = useState(false);
  const [smaPeriod, setSmaPeriod] = useState<number | null>(null);
  const [emaPeriod, setEmaPeriod] = useState<number | null>(null);

  // Fetch Bar Data
  const { data: barsData, isLoading, error } = useGetBars({
    symbol,
    timeframe,
    limit: 1000 // Get enough data for indicators
  });

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground overflow-hidden font-sans">
      
      {/* Header Toolbar */}
      <TopToolbar 
        symbol={symbol}
        setSymbol={setSymbol}
        timeframe={timeframe}
        setTimeframe={setTimeframe}
        showRSI={showRSI}
        setShowRSI={setShowRSI}
        smaPeriod={smaPeriod}
        setSmaPeriod={setSmaPeriod}
        emaPeriod={emaPeriod}
        setEmaPeriod={setEmaPeriod}
      />

      {/* Main Content Area */}
      <main className="flex-1 relative p-4 flex flex-col min-h-0 bg-[#0a0e17]">
        
        {/* State Layers */}
        {isLoading && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/50 backdrop-blur-sm rounded-xl m-4">
            <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
            <p className="mt-4 text-muted-foreground font-medium animate-pulse">Loading market data...</p>
          </div>
        )}

        {error && !isLoading && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-panel rounded-xl m-4 border border-destructive/20 shadow-2xl">
            <div className="p-6 bg-destructive/10 rounded-full mb-4">
               <AlertCircle className="w-10 h-10 text-destructive" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">Data Unavailable</h3>
            <p className="text-muted-foreground max-w-md text-center">
              {(error as any)?.message || "We couldn't fetch market data for this symbol right now. Please verify your API keys or try a different symbol."}
            </p>
          </div>
        )}

        {/* Empty State / No Data (if api returned empty bars array) */}
        {!isLoading && !error && barsData?.bars.length === 0 && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-panel rounded-xl m-4 border border-border">
             <Activity className="w-16 h-16 text-muted-foreground mb-4 opacity-20" />
             <p className="text-muted-foreground font-medium">No trading data available for {symbol} at {timeframe}.</p>
          </div>
        )}

        {/* The Chart */}
        {!error && barsData && barsData.bars.length > 0 && (
          <div className="flex-1 w-full h-full shadow-2xl rounded-xl overflow-hidden animate-in fade-in duration-500">
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
    </div>
  );
}
