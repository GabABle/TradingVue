import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, BarChart3 } from "lucide-react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type Statement = "income" | "balance" | "cashflow";
type Timeframe = "annual" | "quarterly";

interface Period {
  label: string;
  revenue: number | null;
  netIncome: number | null;
  assets: number | null;
  liabilities: number | null;
  cfo: number | null;
  cfi: number | null;
  cff: number | null;
}

interface FinancialsResponse {
  symbol: string;
  timeframe: Timeframe;
  available: boolean;
  periods: Period[];
}

const STATEMENTS: { key: Statement; label: string }[] = [
  { key: "income", label: "Income statement" },
  { key: "balance", label: "Balance sheet" },
  { key: "cashflow", label: "Cash flow" },
];

// ── formatting ──────────────────────────────────────────────────────────────
function fmtMoney(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(2)}K`;
  return `${sign}${a.toFixed(0)}`;
}
function fmtPct(v: number): string {
  return `${v.toFixed(0)}%`;
}

// ── series config per statement ─────────────────────────────────────────────
interface BarSeries { key: keyof Period; color: string; label: string; }
interface LineSeries { get: (p: Period) => number | null; color: string; label: string; }

function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => min + i * step);
}

// ── SVG combo chart ─────────────────────────────────────────────────────────
function Chart({ statement, periods }: { statement: Statement; periods: Period[] }) {
  const W = 320, H = 190;
  const padL = 40, padR = 44, padT = 14, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const bars: BarSeries[] =
    statement === "income"
      ? [{ key: "revenue", color: "#2962ff", label: "Revenue" }, { key: "netIncome", color: "#22d3ee", label: "Net income" }]
      : statement === "balance"
        ? [{ key: "assets", color: "#a855f7", label: "Total assets" }, { key: "liabilities", color: "#eab308", label: "Total liabilities" }]
        : [];

  const moneyLines: LineSeries[] =
    statement === "cashflow"
      ? [
          { get: (p) => p.cfo, color: "#e05fbf", label: "Operating" },
          { get: (p) => p.cfi, color: "#4aa3ff", label: "Investing" },
          { get: (p) => p.cff, color: "#2dd4bf", label: "Financing" },
        ]
      : [];

  const pctLine: LineSeries | null =
    statement === "income"
      ? { get: (p) => (p.revenue && p.revenue !== 0 && p.netIncome != null ? (p.netIncome / p.revenue) * 100 : null), color: "#f59e0b", label: "Net margin %" }
      : statement === "balance"
        ? { get: (p) => (p.assets && p.assets !== 0 && p.liabilities != null ? (p.liabilities / p.assets) * 100 : null), color: "#4aa3ff", label: "Liabilities to assets %" }
        : null;

  // money domain (bars + money lines)
  const moneyVals: number[] = [];
  periods.forEach((p) => {
    bars.forEach((b) => { const v = p[b.key] as number | null; if (v != null) moneyVals.push(v); });
    moneyLines.forEach((l) => { const v = l.get(p); if (v != null) moneyVals.push(v); });
  });
  let mMin = Math.min(0, ...moneyVals);
  let mMax = Math.max(0, ...moneyVals);
  if (moneyVals.length === 0) { mMin = 0; mMax = 1; }
  if (mMin === mMax) mMax = mMin + 1;

  // pct domain
  const pctVals: number[] = [];
  if (pctLine) periods.forEach((p) => { const v = pctLine.get(p); if (v != null) pctVals.push(v); });
  let pMin = pctVals.length ? Math.min(0, ...pctVals) : 0;
  let pMax = pctVals.length ? Math.max(0, ...pctVals) : 1;
  if (pMin === pMax) pMax = pMin + 1;

  const yMoney = (v: number) => padT + plotH - ((v - mMin) / (mMax - mMin)) * plotH;
  const yPct = (v: number) => padT + plotH - ((v - pMin) / (pMax - pMin)) * plotH;

  const n = periods.length || 1;
  const step = plotW / n;
  const xCenter = (i: number) => padL + step * (i + 0.5);

  const barW = bars.length ? Math.min(14, (step * 0.5) / bars.length) : 0;
  const zeroY = yMoney(0);

  const moneyTicks = niceTicks(mMin, mMax, 5);
  const pctTicks = pctLine ? niceTicks(pMin, pMax, 5) : [];

  function linePath(get: (p: Period) => number | null, yfn: (v: number) => number): string {
    let d = ""; let started = false;
    periods.forEach((p, i) => {
      const v = get(p);
      if (v == null) { started = false; return; }
      const x = xCenter(i), y = yfn(v);
      d += `${started ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
      started = true;
    });
    return d.trim();
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" className="block">
      {/* grid + left (%) axis */}
      {pctTicks.map((t, i) => (
        <text key={`pl${i}`} x={padL - 5} y={yPct(t) + 3} textAnchor="end" fontSize="7" fill="#4c525e">{fmtPct(t)}</text>
      ))}
      {/* right ($) axis + gridlines */}
      {moneyTicks.map((t, i) => (
        <g key={`mr${i}`}>
          <line x1={padL} y1={yMoney(t)} x2={W - padR} y2={yMoney(t)} stroke="#1e2230" strokeWidth="1" />
          <text x={W - padR + 4} y={yMoney(t) + 3} textAnchor="start" fontSize="7" fill="#4c525e">{fmtMoney(t)}</text>
        </g>
      ))}
      {/* zero baseline */}
      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="#3a3f4b" strokeWidth="1" />

      {/* bars */}
      {bars.map((b, bi) =>
        periods.map((p, i) => {
          const v = p[b.key] as number | null;
          if (v == null) return null;
          const y = yMoney(v);
          const x = xCenter(i) + (bi - (bars.length - 1) / 2) * (barW + 2) - barW / 2;
          const top = Math.min(y, zeroY);
          const h = Math.max(1, Math.abs(zeroY - y));
          return <rect key={`b${bi}-${i}`} x={x} y={top} width={barW} height={h} rx="1" fill={b.color} />;
        }),
      )}

      {/* pct line */}
      {pctLine && (
        <>
          <path d={linePath(pctLine.get, yPct)} fill="none" stroke={pctLine.color} strokeWidth="1.5" />
          {periods.map((p, i) => {
            const v = pctLine.get(p); if (v == null) return null;
            return <circle key={`pc${i}`} cx={xCenter(i)} cy={yPct(v)} r="2.2" fill="#131722" stroke={pctLine.color} strokeWidth="1.3" />;
          })}
        </>
      )}

      {/* money lines (cash flow) */}
      {moneyLines.map((l, li) => (
        <g key={`ml${li}`}>
          <path d={linePath(l.get, yMoney)} fill="none" stroke={l.color} strokeWidth="1.5" />
          {periods.map((p, i) => {
            const v = l.get(p); if (v == null) return null;
            return <circle key={`mc${li}-${i}`} cx={xCenter(i)} cy={yMoney(v)} r="2.2" fill="#131722" stroke={l.color} strokeWidth="1.3" />;
          })}
        </g>
      ))}

      {/* x labels */}
      {periods.map((p, i) => (
        <text key={`x${i}`} x={xCenter(i)} y={H - padB + 16} textAnchor="middle" fontSize="8" fill="#787b86">{p.label}</text>
      ))}
    </svg>
  );
}

function Legend({ statement }: { statement: Statement }) {
  const items =
    statement === "income"
      ? [["Revenue", "#2962ff"], ["Net income", "#22d3ee"], ["Net margin %", "#f59e0b"]]
      : statement === "balance"
        ? [["Total assets", "#a855f7"], ["Total liabilities", "#eab308"], ["Liabilities to assets %", "#4aa3ff"]]
        : [["Operating", "#e05fbf"], ["Investing", "#4aa3ff"], ["Financing", "#2dd4bf"]];
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 pb-1">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1 text-[9px] text-[#787b86]">
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

export function FinancialsPanel({ symbol }: { symbol: string }) {
  const [statement, setStatement] = useState<Statement>("income");
  const [timeframe, setTimeframe] = useState<Timeframe>("annual");
  const [data, setData] = useState<FinancialsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    fetch(`${BASE}/api/market/financials?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: FinancialsResponse) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData({ symbol, timeframe, available: false, periods: [] }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [symbol, timeframe]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const label = useMemo(() => STATEMENTS.find((s) => s.key === statement)?.label ?? "", [statement]);
  const periods = data?.periods ?? [];
  const hasData = data?.available && periods.length > 0;

  return (
    <div className="flex flex-col h-full bg-[#131722]">
      {/* Header: statement dropdown + timeframe toggle */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2e39] shrink-0">
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-1 text-xs font-semibold text-[#d1d4dc] hover:text-white transition-colors"
          >
            <BarChart3 className="w-3.5 h-3.5 text-[#787b86]" />
            {label}
            <ChevronDown className="w-3 h-3 text-[#787b86]" />
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-6 z-30 w-40 bg-[#1e222d] border border-[#2a2e39] rounded-md shadow-xl py-1">
              {STATEMENTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => { setStatement(s.key); setMenuOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                    s.key === statement ? "text-[#2962ff] bg-[#2962ff]/10" : "text-[#d1d4dc] hover:bg-[#2a2e39]"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          {(["annual", "quarterly"] as Timeframe[]).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`capitalize transition-colors ${timeframe === tf ? "text-[#2962ff]" : "text-[#4c525e] hover:text-[#787b86]"}`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col justify-center overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-[#2962ff]/30 border-t-[#2962ff] rounded-full animate-spin" />
          </div>
        ) : hasData ? (
          <>
            <div className="px-1">
              <Chart statement={statement} periods={periods} />
            </div>
            <Legend statement={statement} />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
            <BarChart3 className="w-6 h-6 text-[#2a2e39]" />
            <p className="text-[10px] text-[#787b86] leading-relaxed">
              No financial statements available for <span className="font-mono text-[#d1d4dc]">{symbol}</span>.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
