import { useState, useEffect, useCallback } from "react";
import {
  X, TrendingUp, TrendingDown, ArrowLeftRight, RefreshCw,
  Wallet, BarChart3, Clock, CheckCircle, XCircle, AlertCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ── Types ────────────────────────────────────────────────────────────────────
interface AlpacaAccount {
  equity: string;
  cash: string;
  buying_power: string;
  portfolio_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  last_equity: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
  status: string;
}

interface AlpacaPosition {
  symbol: string;
  qty: string;
  side: string;
  avg_entry_price: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  change_today: string;
}

interface AlpacaOrder {
  id: string;
  symbol: string;
  qty: string;
  filled_qty: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  status: string;
  limit_price?: string;
  filled_avg_price?: string;
  created_at: string;
  filled_at?: string;
}

interface Props {
  open: boolean;
  symbol: string;
  currentPrice: number | null;
  onClose: () => void;
}

type Tab = "trade" | "portfolio" | "orders";

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtUSD = (v: string | number | null | undefined) => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (isNaN(n)) return "—";
  const abs = Math.abs(n);
  const fmt = abs >= 1e6
    ? `${(n / 1e6).toFixed(2)}M`
    : abs >= 1e3
      ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : n.toFixed(2);
  return `$${fmt}`;
};

const fmtPct = (v: string | number | null | undefined) => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
};

const colorPL = (v: string | number | null | undefined) => {
  const n = typeof v === "string" ? parseFloat(v) : (v ?? 0);
  if (isNaN(n) || n === 0) return "text-[#d1d4dc]";
  return n > 0 ? "text-[#26a69a]" : "text-[#ef5350]";
};

const ORDER_STATUS_CFG: Record<string, { label: string; cls: string }> = {
  filled:           { label: "Filled",     cls: "text-[#26a69a]" },
  partially_filled: { label: "Partial",    cls: "text-[#f59e0b]" },
  pending_new:      { label: "Pending",    cls: "text-[#787b86]" },
  new:              { label: "New",        cls: "text-[#2962ff]" },
  accepted:         { label: "Accepted",   cls: "text-[#2962ff]" },
  canceled:         { label: "Cancelled",  cls: "text-[#4c525e]" },
  expired:          { label: "Expired",    cls: "text-[#4c525e]" },
  rejected:         { label: "Rejected",   cls: "text-[#ef5350]" },
};

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, valueClass = "text-[#d1d4dc]" }: {
  label: string; value: string; sub?: string; valueClass?: string;
}) {
  return (
    <div className="bg-[#131722] rounded-lg px-3 py-2.5 border border-[#2a2e39]">
      <p className="text-[9px] font-semibold text-[#4c525e] uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-sm font-bold font-mono ${valueClass}`}>{value}</p>
      {sub && <p className="text-[10px] text-[#787b86] mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function TradingModal({ open, symbol, currentPrice, onClose }: Props) {
  const { authFetch } = useAuth();
  const [tab, setTab] = useState<Tab>("trade");

  // Trade form state
  const [side, setSide]             = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType]   = useState<"market" | "limit">("market");
  const [qty, setQty]               = useState("1");
  const [limitPrice, setLimitPrice] = useState(() => currentPrice?.toFixed(2) ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [tradeError, setTradeError] = useState("");
  const [tradeSuccess, setTradeSuccess] = useState("");

  // Portfolio state
  const [account, setAccount]     = useState<AlpacaAccount | null>(null);
  const [positions, setPositions] = useState<AlpacaPosition[]>([]);
  const [orders, setOrders]       = useState<AlpacaOrder[]>([]);
  const [loading, setLoading]     = useState(false);
  const [portfolioError, setPortfolioError] = useState("");

  // Reset on symbol change
  useEffect(() => {
    if (open) {
      setTradeError("");
      setTradeSuccess("");
      if (currentPrice != null) setLimitPrice(currentPrice.toFixed(2));
    }
  }, [open, symbol, currentPrice]);

  const loadPortfolio = useCallback(async () => {
    setLoading(true);
    setPortfolioError("");
    try {
      const [accRes, posRes] = await Promise.all([
        authFetch(`${BASE}/api/trading/account`),
        authFetch(`${BASE}/api/trading/positions`),
      ]);
      if (!accRes.ok) {
        const d = await accRes.json() as { error?: string };
        setPortfolioError(d.error ?? "Failed to load account");
        return;
      }
      setAccount(await accRes.json() as AlpacaAccount);
      setPositions(posRes.ok ? (await posRes.json() as AlpacaPosition[]) : []);
    } catch {
      setPortfolioError("Network error. Check your Alpaca paper trading API keys.");
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  const loadOrders = useCallback(async () => {
    try {
      const r = await authFetch(`${BASE}/api/trading/orders`);
      if (r.ok) setOrders(await r.json() as AlpacaOrder[]);
    } catch { /* ignore */ }
  }, [authFetch]);

  useEffect(() => {
    if (!open) return;
    loadPortfolio();
    loadOrders();
  }, [open, loadPortfolio, loadOrders]);

  const handleTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setTradeError("");
    setTradeSuccess("");
    const qtyNum = parseFloat(qty);
    if (isNaN(qtyNum) || qtyNum <= 0) { setTradeError("Enter a valid quantity."); return; }
    if (orderType === "limit") {
      const lp = parseFloat(limitPrice);
      if (isNaN(lp) || lp <= 0) { setTradeError("Enter a valid limit price."); return; }
    }
    setSubmitting(true);
    try {
      const body: Record<string, string | number> = {
        symbol: symbol.replace("/", ""),
        qty: qtyNum,
        side,
        type: orderType,
        time_in_force: "day",
      };
      if (orderType === "limit") body["limit_price"] = parseFloat(limitPrice);

      const r = await authFetch(`${BASE}/api/trading/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        setTradeError(d.error ?? "Order rejected.");
      } else {
        setTradeSuccess(`${side === "buy" ? "Buy" : "Sell"} order placed for ${qtyNum} × ${symbol}!`);
        setQty("1");
        await Promise.all([loadPortfolio(), loadOrders()]);
      }
    } catch {
      setTradeError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const cancelOrder = async (id: string) => {
    try {
      await authFetch(`${BASE}/api/trading/orders/${id}`, { method: "DELETE" });
      await loadOrders();
    } catch { /* ignore */ }
  };

  if (!open) return null;

  const estValue = (() => {
    const q = parseFloat(qty);
    const p = orderType === "limit" ? parseFloat(limitPrice) : (currentPrice ?? 0);
    if (!isNaN(q) && p > 0) return fmtUSD(q * p);
    return "—";
  })();

  const dailyPL = (() => {
    if (!account) return null;
    return parseFloat(account.equity) - parseFloat(account.last_equity);
  })();

  // Current symbol's position (if any)
  const normalizedSymbol = symbol.replace("/", "");
  const symPosition = positions.find(p => p.symbol === normalizedSymbol);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "trade",     label: "Trade",     icon: <ArrowLeftRight className="w-3.5 h-3.5" /> },
    { id: "portfolio", label: "Portfolio", icon: <Wallet className="w-3.5 h-3.5" /> },
    { id: "orders",    label: "Orders",    icon: <Clock className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative h-full w-full max-w-[420px] bg-[#1e222d] border-l border-[#2a2e39] shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e39] shrink-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#2962ff]" />
            <span className="font-semibold text-sm text-[#d1d4dc]">Paper Trading</span>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/30 tracking-wider">PAPER</span>
          </div>
          <button onClick={onClose} className="text-[#4c525e] hover:text-[#787b86] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 border-b border-[#2a2e39]">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold transition-colors border-b-2 ${
                tab === t.id
                  ? "border-[#2962ff] text-[#d1d4dc]"
                  : "border-transparent text-[#787b86] hover:text-[#d1d4dc]"
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── TRADE TAB ─────────────────────────────────────────────── */}
          {tab === "trade" && (
            <div className="p-5 space-y-5">
              {/* Symbol + price header */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-lg text-[#d1d4dc] font-mono">{symbol}</p>
                  {symPosition && (
                    <p className="text-[10px] text-[#787b86]">
                      Holding: <span className="font-mono text-[#d1d4dc]">{parseFloat(symPosition.qty).toFixed(symPosition.qty.includes(".") ? 4 : 0)} shares</span>
                      {" · "}
                      <span className={colorPL(symPosition.unrealized_pl)}>
                        {fmtUSD(symPosition.unrealized_pl)} ({fmtPct(symPosition.unrealized_plpc)})
                      </span>
                    </p>
                  )}
                </div>
                {currentPrice != null && (
                  <div className="text-right">
                    <p className="text-lg font-bold font-mono text-[#d1d4dc]">
                      ${currentPrice < 1 ? currentPrice.toFixed(4) : currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-[10px] text-[#4c525e]">last price</p>
                  </div>
                )}
              </div>

              <form onSubmit={handleTrade} className="space-y-4">
                {/* Buy / Sell */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSide("buy")}
                    className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
                      side === "buy"
                        ? "bg-[#26a69a] text-white shadow-lg shadow-[#26a69a]/20"
                        : "bg-[#131722] text-[#787b86] border border-[#2a2e39] hover:border-[#26a69a]/50 hover:text-[#26a69a]"
                    }`}
                  >
                    <TrendingUp className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                    BUY
                  </button>
                  <button
                    type="button"
                    onClick={() => setSide("sell")}
                    className={`py-2.5 rounded-lg text-sm font-bold transition-all ${
                      side === "sell"
                        ? "bg-[#ef5350] text-white shadow-lg shadow-[#ef5350]/20"
                        : "bg-[#131722] text-[#787b86] border border-[#2a2e39] hover:border-[#ef5350]/50 hover:text-[#ef5350]"
                    }`}
                  >
                    <TrendingDown className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
                    SELL
                  </button>
                </div>

                {/* Order type */}
                <div className="flex bg-[#131722] border border-[#2a2e39] rounded-lg p-0.5">
                  {(["market", "limit"] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setOrderType(t)}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all capitalize ${
                        orderType === t
                          ? "bg-[#2a2e39] text-[#d1d4dc] shadow-sm"
                          : "text-[#4c525e] hover:text-[#787b86]"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Quantity */}
                <div>
                  <label className="block text-[10px] font-semibold text-[#4c525e] uppercase tracking-widest mb-1.5">
                    Quantity (shares)
                  </label>
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    value={qty}
                    onChange={e => setQty(e.target.value)}
                    className="w-full bg-[#131722] border border-[#2a2e39] rounded-lg px-3 py-2.5 text-sm font-mono text-[#d1d4dc] placeholder-[#4c525e] focus:outline-none focus:border-[#2962ff] transition-colors"
                    placeholder="1"
                  />
                </div>

                {/* Limit price */}
                {orderType === "limit" && (
                  <div>
                    <label className="block text-[10px] font-semibold text-[#4c525e] uppercase tracking-widest mb-1.5">
                      Limit Price
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={limitPrice}
                      onChange={e => setLimitPrice(e.target.value)}
                      className="w-full bg-[#131722] border border-[#2a2e39] rounded-lg px-3 py-2.5 text-sm font-mono text-[#d1d4dc] placeholder-[#4c525e] focus:outline-none focus:border-[#2962ff] transition-colors"
                      placeholder="0.00"
                    />
                  </div>
                )}

                {/* Estimated value */}
                <div className="flex items-center justify-between px-3 py-2 bg-[#131722] border border-[#2a2e39] rounded-lg">
                  <span className="text-[10px] font-semibold text-[#4c525e] uppercase tracking-widest">Est. value</span>
                  <span className="text-sm font-bold font-mono text-[#d1d4dc]">{estValue}</span>
                </div>

                {/* Feedback */}
                {tradeError && (
                  <div className="flex items-center gap-2 text-xs text-[#ef5350] bg-[#ef5350]/5 border border-[#ef5350]/20 rounded-lg px-3 py-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />{tradeError}
                  </div>
                )}
                {tradeSuccess && (
                  <div className="flex items-center gap-2 text-xs text-[#26a69a] bg-[#26a69a]/5 border border-[#26a69a]/20 rounded-lg px-3 py-2">
                    <CheckCircle className="w-3.5 h-3.5 shrink-0" />{tradeSuccess}
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={submitting}
                  className={`w-full py-3 rounded-lg text-sm font-bold transition-all disabled:opacity-50 ${
                    side === "buy"
                      ? "bg-[#26a69a] hover:bg-[#1e8e83] text-white shadow-lg shadow-[#26a69a]/20"
                      : "bg-[#ef5350] hover:bg-[#d93b38] text-white shadow-lg shadow-[#ef5350]/20"
                  }`}
                >
                  {submitting ? "Placing order…" : `${side === "buy" ? "Buy" : "Sell"} ${symbol}`}
                </button>

                <p className="text-[9px] text-[#4c525e] text-center leading-relaxed">
                  Paper trading only — no real money involved. GFD (good for day) orders.
                </p>
              </form>
            </div>
          )}

          {/* ── PORTFOLIO TAB ─────────────────────────────────────────── */}
          {tab === "portfolio" && (
            <div className="p-5 space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[#787b86]">Account Overview</p>
                <button
                  onClick={loadPortfolio}
                  disabled={loading}
                  className="p-1 rounded hover:bg-[#2a2e39] text-[#4c525e] hover:text-[#787b86] transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {portfolioError ? (
                <div className="flex items-start gap-2 text-xs text-[#ef5350] bg-[#ef5350]/5 border border-[#ef5350]/20 rounded-lg px-3 py-3">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{portfolioError}</span>
                </div>
              ) : loading ? (
                <div className="flex items-center justify-center py-10">
                  <RefreshCw className="w-5 h-5 text-[#2962ff] animate-spin" />
                </div>
              ) : account ? (
                <>
                  {/* Account stats */}
                  <div className="grid grid-cols-2 gap-2">
                    <StatCard
                      label="Portfolio Value"
                      value={fmtUSD(account.portfolio_value)}
                    />
                    <StatCard
                      label="Buying Power"
                      value={fmtUSD(account.buying_power)}
                    />
                    <StatCard
                      label="Unrealized P&L"
                      value={fmtUSD(account.unrealized_pl)}
                      sub={fmtPct(account.unrealized_plpc)}
                      valueClass={colorPL(account.unrealized_pl)}
                    />
                    <StatCard
                      label="Today's P&L"
                      value={dailyPL !== null ? fmtUSD(dailyPL) : "—"}
                      valueClass={dailyPL !== null ? colorPL(dailyPL) : "text-[#787b86]"}
                    />
                  </div>

                  {/* Positions */}
                  <div>
                    <p className="text-[10px] font-semibold text-[#4c525e] uppercase tracking-widest mb-2">
                      Open Positions ({positions.length})
                    </p>
                    {positions.length === 0 ? (
                      <div className="text-center py-6 text-xs text-[#4c525e]">
                        No open positions
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {positions.map(pos => {
                          const plNum = parseFloat(pos.unrealized_pl);
                          const plPct = parseFloat(pos.unrealized_plpc) * 100;
                          const isUp = plNum >= 0;
                          return (
                            <div
                              key={pos.symbol}
                              className="bg-[#131722] border border-[#2a2e39] rounded-lg px-3 py-2.5 hover:border-[#2a2e39]/80 transition-colors"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-mono font-bold text-sm text-[#d1d4dc]">{pos.symbol}</span>
                                <span className={`text-xs font-bold font-mono ${isUp ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
                                  {isUp ? "+" : ""}{fmtUSD(pos.unrealized_pl)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[10px] text-[#787b86]">
                                <span>
                                  {parseFloat(pos.qty).toFixed(pos.qty.includes(".") ? 4 : 0)} shares @ {fmtUSD(pos.avg_entry_price)}
                                </span>
                                <span className="flex items-center gap-2">
                                  <span className="font-mono text-[#d1d4dc]">{fmtUSD(pos.market_value)}</span>
                                  <span className={`font-mono ${isUp ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
                                    {isUp ? "+" : ""}{plPct.toFixed(2)}%
                                  </span>
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-[9px] text-[#4c525e] mt-1">
                                <span>Current: {fmtUSD(pos.current_price)}</span>
                                <span>Daily: <span className={colorPL(pos.change_today)}>{fmtPct(pos.change_today)}</span></span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}

          {/* ── ORDERS TAB ────────────────────────────────────────────── */}
          {tab === "orders" && (
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[#787b86]">Recent Orders</p>
                <button
                  onClick={loadOrders}
                  className="p-1 rounded hover:bg-[#2a2e39] text-[#4c525e] hover:text-[#787b86] transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>

              {orders.length === 0 ? (
                <div className="text-center py-10 text-xs text-[#4c525e]">No orders yet</div>
              ) : (
                <div className="space-y-1.5">
                  {orders.map(order => {
                    const cfg = ORDER_STATUS_CFG[order.status] ?? { label: order.status, cls: "text-[#787b86]" };
                    const isBuy = order.side === "buy";
                    const filledQty = parseFloat(order.filled_qty ?? "0");
                    const totalQty = parseFloat(order.qty ?? "0");
                    const canCancel = ["new", "pending_new", "accepted", "partially_filled"].includes(order.status);
                    return (
                      <div key={order.id} className="bg-[#131722] border border-[#2a2e39] rounded-lg px-3 py-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                              isBuy
                                ? "bg-[#26a69a]/10 text-[#26a69a] border-[#26a69a]/30"
                                : "bg-[#ef5350]/10 text-[#ef5350] border-[#ef5350]/30"
                            }`}>
                              {isBuy ? "BUY" : "SELL"}
                            </span>
                            <span className="font-mono font-bold text-sm text-[#d1d4dc]">{order.symbol}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-semibold ${cfg.cls}`}>{cfg.label}</span>
                            {canCancel && (
                              <button
                                onClick={() => cancelOrder(order.id)}
                                title="Cancel order"
                                className="text-[#4c525e] hover:text-[#ef5350] transition-colors"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-[#787b86]">
                          <span>
                            {filledQty > 0 ? `${filledQty}/${totalQty}` : totalQty} shares · {order.type}
                            {order.limit_price ? ` @ ${fmtUSD(order.limit_price)}` : ""}
                          </span>
                          <span>{new Date(order.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        {order.filled_avg_price && filledQty > 0 && (
                          <div className="text-[9px] text-[#4c525e] mt-0.5">
                            Avg fill: <span className="font-mono text-[#787b86]">{fmtUSD(order.filled_avg_price)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
