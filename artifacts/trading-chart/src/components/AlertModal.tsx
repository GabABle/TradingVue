import { useState, useEffect, useCallback } from "react";
import { Bell, Plus, Trash2, X, CheckCircle, AlertCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

interface Alert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: "above" | "below";
  email: string;
  createdAt: string;
}

interface Props {
  open: boolean;
  symbol: string;
  currentPrice: number | null;
  onClose: () => void;
}

export function AlertModal({ open, symbol, currentPrice, onClose }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [targetPrice, setTargetPrice] = useState("");
  const [condition, setCondition] = useState<"above" | "below">("above");
  const [email, setEmail] = useState(() => localStorage.getItem("tradingvue_alertEmail") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchAlerts = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/alerts?symbol=${encodeURIComponent(symbol)}`);
      if (r.ok) {
        const data = await r.json() as { alerts: Alert[] };
        setAlerts(data.alerts);
      }
    } catch { /* ignore */ }
  }, [symbol]);

  useEffect(() => {
    if (open) {
      fetchAlerts();
      setError("");
      setSuccess("");
      if (currentPrice != null) {
        setTargetPrice(currentPrice.toFixed(2));
      }
    }
  }, [open, fetchAlerts, currentPrice]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) {
      setError("Please enter a valid price.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }

    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, targetPrice: price, condition, email: email.trim() }),
      });
      if (!r.ok) {
        const d = await r.json() as { error?: string };
        setError(d.error ?? "Failed to create alert.");
      } else {
        localStorage.setItem("tradingvue_alertEmail", email.trim());
        setSuccess("Alert created! You'll be notified when the price is reached.");
        await fetchAlerts();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${BASE}/api/alerts/${id}`, { method: "DELETE" });
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch { /* ignore */ }
  };

  if (!open) return null;

  const formatPrice = (p: number) =>
    p < 1 ? `$${p.toFixed(4)}` : `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-md mx-4 bg-[#1e222d] border border-[#2a2e39] rounded-xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2e39]">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#f59e0b]" />
            <h2 className="font-semibold text-sm text-[#d1d4dc]">Price Alerts</h2>
            <span className="text-xs font-mono text-[#787b86]">· {symbol}</span>
          </div>
          <button onClick={onClose} className="text-[#4c525e] hover:text-[#787b86] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Create form */}
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="flex gap-2">
              {/* Condition */}
              <div className="flex bg-[#131722] border border-[#2a2e39] rounded-md p-0.5 shrink-0">
                {(["above", "below"] as const).map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCondition(c)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded transition-all duration-150 ${
                      condition === c
                        ? c === "above"
                          ? "bg-[#26a69a]/20 text-[#26a69a] border border-[#26a69a]/40"
                          : "bg-[#ef5350]/20 text-[#ef5350] border border-[#ef5350]/40"
                        : "text-[#4c525e] hover:text-[#787b86]"
                    }`}
                  >
                    {c === "above" ? "▲ Above" : "▼ Below"}
                  </button>
                ))}
              </div>

              {/* Price input */}
              <input
                type="number"
                step="any"
                min="0"
                placeholder={currentPrice != null ? currentPrice.toFixed(2) : "Price"}
                value={targetPrice}
                onChange={e => setTargetPrice(e.target.value)}
                className="flex-1 min-w-0 bg-[#131722] border border-[#2a2e39] rounded-md px-3 py-1.5 text-sm text-[#d1d4dc] placeholder-[#4c525e] focus:outline-none focus:border-[#2962ff] font-mono"
              />
            </div>

            {/* Email */}
            <input
              type="email"
              placeholder="Email for notification"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#131722] border border-[#2a2e39] rounded-md px-3 py-1.5 text-sm text-[#d1d4dc] placeholder-[#4c525e] focus:outline-none focus:border-[#2962ff]"
            />

            {currentPrice != null && (
              <p className="text-[10px] text-[#4c525e]">
                Current price: <span className="font-mono text-[#787b86]">{formatPrice(currentPrice)}</span>
              </p>
            )}

            {error && (
              <div className="flex items-center gap-1.5 text-xs text-[#ef5350]">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}
            {success && (
              <div className="flex items-center gap-1.5 text-xs text-[#26a69a]">
                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#2962ff] hover:bg-[#1e53e5] disabled:opacity-50 text-white text-xs font-semibold rounded-md transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {saving ? "Creating…" : "Create Alert"}
            </button>
          </form>

          {/* Active alerts */}
          {alerts.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#4c525e]">Active alerts</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                {alerts.map(alert => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between px-3 py-2 bg-[#131722] border border-[#2a2e39] rounded-lg group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`text-xs font-bold shrink-0 ${
                          alert.condition === "above" ? "text-[#26a69a]" : "text-[#ef5350]"
                        }`}
                      >
                        {alert.condition === "above" ? "▲" : "▼"}
                      </span>
                      <span className="font-mono text-sm text-[#d1d4dc] font-semibold">
                        {formatPrice(alert.targetPrice)}
                      </span>
                      <span className="text-xs text-[#4c525e] truncate">{alert.email}</span>
                    </div>
                    <button
                      onClick={() => handleDelete(alert.id)}
                      className="text-[#4c525e] hover:text-[#ef5350] transition-colors shrink-0 ml-2 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-[#4c525e] leading-relaxed">
            Alerts trigger in-browser notifications instantly, plus an email when the price is reached. Alerts check every 30 seconds.
          </p>
        </div>
      </div>
    </div>
  );
}
