import { useState, useCallback, useEffect, useRef } from "react";
import { Plus, X, Star, GripVertical, ChevronDown, ChevronRight, Pencil, Check, Trash2, Bell, Briefcase, Download, Upload } from "lucide-react";
import { useGetQuote } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  type WatchlistSection,
  createSection,
  makeId,
  addSymbolToSections,
  removeSymbolFromSections,
  DEFAULT_STOCKS,
} from "@/lib/watchlist-sections";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type MarketSession = "pre" | "regular" | "after" | "closed";

function SessionPill({ session }: { session?: MarketSession }) {
  if (!session || session === "regular") return null;
  const cfg = {
    pre:    { label: "PRE", cls: "text-[#f59e0b]" },
    after:  { label: "AH",  cls: "text-[#818cf8]" },
    closed: { label: "—",   cls: "text-[#4c525e]" },
  }[session];
  return (
    <span className={`text-[8px] font-bold tracking-widest leading-none ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

interface WatchlistProps {
  sections: WatchlistSection[];
  onSectionsChange: (sections: WatchlistSection[]) => void;
  activeSymbol: string;
  onSelect: (symbol: string) => void;
  onSearchOpen: (initial?: string) => void;
  onAlertOpen: (symbol: string, currentPrice: number | null) => void;
  fullHeight?: boolean;
}

interface SymbolDragState {
  symbol: string;
  fromSectionId: string;
}

interface SymbolDropTarget {
  sectionId: string;
  insertBefore: string | null;
}

function fmt(p: number | null | undefined): string {
  if (p == null) return "—";
  return p < 1 ? p.toFixed(4) : p.toFixed(2);
}

// Deterministic hue from symbol string so each ticker gets a consistent color
function symbolHue(sym: string): number {
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) & 0xffff;
  return h % 360;
}

function TickerIcon({ symbol }: { symbol: string }) {
  const hue = symbolHue(symbol);
  const label = symbol.length <= 2 ? symbol : symbol.slice(0, 2);
  return (
    <span
      className="shrink-0 w-[18px] h-[18px] rounded-sm flex items-center justify-center text-[8px] font-bold leading-none select-none"
      style={{ background: `hsl(${hue},55%,28%)`, color: `hsl(${hue},80%,75%)` }}
    >
      {label}
    </span>
  );
}


function SymbolRow({
  symbol,
  isActive,
  isFaded,
  isDragOver,
  dragOverTop,
  hasAlert,
  isTagged,
  onClick,
  onRemove,
  onAlertClick,
  onPortfolioToggle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onChangePercent,
}: {
  symbol: string;
  isActive: boolean;
  isFaded: boolean;
  isDragOver: boolean;
  dragOverTop: boolean;
  hasAlert: boolean;
  isTagged: boolean;
  onClick: () => void;
  onRemove: () => void;
  onAlertClick: (price: number | null) => void;
  onPortfolioToggle: (symbol: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, symbol: string) => void;
  onDrop: (e: React.DragEvent, sectionId?: string) => void;
  onChangePercent?: (symbol: string, pct: number | null) => void;
}) {
  const { data: quote } = useGetQuote({ symbol }, { query: { refetchInterval: 15000 } });

  // Report changePercent to parent for sorting
  useEffect(() => {
    onChangePercent?.(symbol, quote?.changePercent ?? null);
  }, [symbol, quote?.changePercent, onChangePercent]);
  const session   = (quote as any)?.session  as MarketSession | undefined;
  const prevClose = (quote as any)?.prevClose    as number | null | undefined;
  const regularClose = (quote as any)?.regularClose as number | null | undefined;
  const isUp = (quote?.changePercent ?? 0) >= 0;

  const closePrice: number | null | undefined =
    session === "pre"   ? prevClose :
    session === "after" ? regularClose :
    quote?.price;

  const rawExtPrice: number | null | undefined =
    session === "pre"
      ? ((quote as any)?.preMarketPrice ?? null)
      : session === "after"
        ? (quote?.price ?? null)
        : null;
  const extPrice: number | null = rawExtPrice ?? null;

  return (
    <div
      className={`relative transition-opacity ${isFaded ? "opacity-30" : ""}`}
      onDragOver={(e) => onDragOver(e, symbol)}
      onDrop={(e) => onDrop(e)}
    >
      {isDragOver && (
        <div className={`absolute left-1 right-1 h-0.5 bg-[#2962ff] rounded-full z-10 pointer-events-none ${dragOverTop ? "top-0" : "bottom-0"}`} />
      )}

      <div
        className={`group flex items-center gap-1 px-1.5 py-2 cursor-pointer transition-colors rounded-sm mx-1 my-0.5 border ${
          isActive
            ? "bg-[#2962ff]/15 border-[#2962ff]/30"
            : "hover:bg-[#2a2e39] border-transparent"
        }`}
        onClick={onClick}
      >
        <div
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="text-[#2a2e39] hover:text-[#4c525e] cursor-grab active:cursor-grabbing shrink-0 transition-colors p-0.5 -ml-0.5 touch-none"
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
        >
          <GripVertical className="w-3 h-3" />
        </div>

        <TickerIcon symbol={symbol} />

        <div className="flex-1 min-w-0 flex items-center gap-1 min-w-0">
          <span className={`text-xs font-bold font-mono truncate ${isActive ? "text-[#2962ff]" : "text-[#d1d4dc]"}`}>
            {symbol}
          </span>
          {isTagged && (
            <span
              className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#26a69a]"
              title="Tagged"
            />
          )}
        </div>

        <div className="w-[46px] shrink-0 text-center">
          {quote ? (
            <span className="text-[11px] font-mono font-bold text-[#d1d4dc]">
              {fmt(closePrice)}
            </span>
          ) : (
            <div className="mx-auto w-9 h-3 bg-[#2a2e39] rounded animate-pulse" />
          )}
        </div>

        <div className="w-[40px] shrink-0 text-center">
          {extPrice != null ? (
            <span className={`text-[11px] font-mono font-semibold ${session === "pre" ? "text-[#f59e0b]" : "text-[#818cf8]"}`}>
              {fmt(extPrice)}
            </span>
          ) : null}
        </div>

        <div className="w-[46px] shrink-0 text-center">
          {quote ? (
            <span className={`text-[11px] font-semibold font-mono ${isUp ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
              {isUp ? "+" : ""}{quote.changePercent.toFixed(2)}%
            </span>
          ) : (
            <span className="text-[10px] text-[#787b86]">—</span>
          )}
        </div>

        {/* Portfolio / briefcase — always visible when tagged, hover-only otherwise */}
        <button
          className={`shrink-0 p-0.5 rounded transition-all z-10 ${
            isTagged
              ? "text-[#26a69a] hover:text-[#26a69a]/70"
              : "text-[#2a2e39] opacity-0 group-hover:opacity-100 group-hover:text-[#4c525e] hover:text-[#787b86]"
          }`}
          onClick={(e) => { e.stopPropagation(); onPortfolioToggle(symbol); }}
          title={isTagged ? "Remove tag" : "Tag symbol"}
        >
          <Briefcase className={`w-3 h-3 ${isTagged ? "fill-[#26a69a]/20" : ""}`} />
        </button>

        {/* Price alerts deprecated for now — bell hidden */}
        {false && (
        <button
          className={`shrink-0 p-0.5 rounded transition-all z-10 ${
            hasAlert
              ? "text-[#f59e0b] hover:text-[#f59e0b]/70"
              : "text-[#2a2e39] opacity-0 group-hover:opacity-100 group-hover:text-[#4c525e] hover:text-[#787b86]"
          }`}
          onClick={(e) => { e.stopPropagation(); onAlertClick(quote?.price ?? null); }}
          title={hasAlert ? "Alert active — click to manage" : "Set price alert"}
        >
          <Bell className={`w-3 h-3 ${hasAlert ? "fill-[#f59e0b]/20" : ""}`} />
        </button>
        )}

        {/* Remove button — hover only */}
        <button
          className="shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-[#ef5350] text-[#787b86] transition-all z-10"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

    </div>
  );
}

function SectionHeader({
  section,
  onToggleCollapse,
  onRename,
  onDelete,
  onAddSymbol,
  onSectionDragStart,
  onSectionDragEnd,
}: {
  section: WatchlistSection;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddSymbol: () => void;
  onSectionDragStart: (e: React.DragEvent) => void;
  onSectionDragEnd: (e: React.DragEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(section.name);
      setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 30);
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 group/header border-t border-[#2a2e39]/60 mt-1 first:border-t-0 first:mt-0">
      {/* Section drag handle */}
      <div
        draggable
        onDragStart={onSectionDragStart}
        onDragEnd={onSectionDragEnd}
        className="text-[#2a2e39] hover:text-[#4c525e] cursor-grab active:cursor-grabbing shrink-0 transition-colors p-0.5 touch-none"
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder section"
      >
        <GripVertical className="w-3 h-3" />
      </div>

      <button onClick={onToggleCollapse} className="text-[#4c525e] hover:text-[#787b86] transition-colors shrink-0 p-0.5">
        {section.collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {editing ? (
        <input
          ref={inputRef}
          className="flex-1 min-w-0 bg-[#1e2030] text-[#d1d4dc] text-[10px] font-semibold tracking-widest uppercase rounded px-1 py-0.5 outline-none border border-[#2962ff]/50"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
          onBlur={commit}
        />
      ) : (
        <span
          className="flex-1 min-w-0 text-[10px] font-semibold text-[#787b86] tracking-widest uppercase truncate cursor-pointer hover:text-[#d1d4dc] transition-colors"
          onDoubleClick={() => setEditing(true)}
          title="Double-click to rename"
        >
          {section.name}
        </span>
      )}

      <div className="flex items-center gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity">
        {editing ? (
          <button onClick={commit} className="p-0.5 rounded text-[#26a69a] hover:text-[#26a69a]/80" title="Save"><Check className="w-3 h-3" /></button>
        ) : (
          <button onClick={() => setEditing(true)} className="p-0.5 rounded text-[#4c525e] hover:text-[#787b86]" title="Rename"><Pencil className="w-3 h-3" /></button>
        )}
        <button onClick={onAddSymbol} className="p-0.5 rounded text-[#4c525e] hover:text-[#787b86]" title="Add symbol"><Plus className="w-3 h-3" /></button>
        <button onClick={onDelete} className="p-0.5 rounded text-[#4c525e] hover:text-[#ef5350]" title="Delete section"><Trash2 className="w-3 h-3" /></button>
      </div>
    </div>
  );
}

// Parse imported watchlist JSON into sections. Accepts the exported section
// array, a { sections: [...] } wrapper, or a flat array of symbol strings.
function normalizeImportedSections(parsed: unknown): WatchlistSection[] {
  let raw: any = parsed;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as any).sections)) {
    raw = (parsed as any).sections;
  }
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (raw.every((x: any) => typeof x === "string")) {
    const syms = raw.map((x: string) => x.trim().toUpperCase()).filter(Boolean);
    return syms.length ? [createSection("Imported", syms)] : [];
  }
  const out: WatchlistSection[] = [];
  for (const sec of raw) {
    if (!sec || typeof sec !== "object") continue;
    const symbols = Array.isArray(sec.symbols)
      ? sec.symbols.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim().toUpperCase())
      : [];
    out.push({
      id: makeId(),
      name: typeof sec.name === "string" && sec.name.trim() ? sec.name.trim() : "Imported",
      symbols,
      collapsed: !!sec.collapsed,
    });
  }
  return out;
}

type SortDir = "desc" | "asc" | null;

export function Watchlist({ sections: propSections, onSectionsChange, activeSymbol, onSelect, onSearchOpen, onAlertOpen, fullHeight }: WatchlistProps) {
  const { authFetch } = useAuth();

  // Local state mirrors the prop for instant UI updates; syncs back to parent via onSectionsChange.
  const [sections, setSections] = useState<WatchlistSection[]>(propSections);
  const fromParentRef = useRef(false);

  // When parent updates sections (DB load), push them into local state.
  useEffect(() => {
    fromParentRef.current = true;
    setSections(propSections);
  }, [propSections]);

  // Whenever local sections change due to user action, notify parent to auto-save.
  useEffect(() => {
    if (fromParentRef.current) {
      fromParentRef.current = false;
      return;
    }
    onSectionsChange(sections);
  }, [sections]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [pctMap, setPctMap] = useState<Record<string, number | null>>({});

  // Set of symbols that have at least one active alert for this user
  const [alertedSymbols, setAlertedSymbols] = useState<Set<string>>(new Set());

  const refreshAlerts = useCallback(async () => {
    try {
      const r = await authFetch(`${BASE}/api/alerts`);
      if (r.ok) {
        const data = await r.json() as { alerts: Array<{ symbol: string }> };
        setAlertedSymbols(new Set(data.alerts.map(a => a.symbol)));
      }
    } catch { /* ignore */ }
  }, [authFetch]);

  useEffect(() => {
    refreshAlerts();
    const iv = setInterval(refreshAlerts, 10_000);
    return () => clearInterval(iv);
  }, [refreshAlerts]);

  const handleChangePercent = useCallback((sym: string, pct: number | null) => {
    setPctMap(prev => {
      if (prev[sym] === pct) return prev;
      return { ...prev, [sym]: pct };
    });
  }, []);

  // ── Portfolio tag state ───────────────────────────────────────────────────
  const [taggedSymbols, setTaggedSymbols] = useState<Set<string>>(new Set());
  const [portfolioFilter, setPortfolioFilter] = useState(false);

  const refreshPortfolio = useCallback(async () => {
    try {
      const r = await authFetch(`${BASE}/api/user/portfolio`);
      if (r.ok) {
        const data = await r.json() as { symbols: string[] };
        setTaggedSymbols(new Set(data.symbols));
      }
    } catch { /* ignore */ }
  }, [authFetch]);

  useEffect(() => { refreshPortfolio(); }, [refreshPortfolio]);

  const handlePortfolioToggle = useCallback(async (symbol: string) => {
    const isTagged = taggedSymbols.has(symbol);
    // Optimistic update
    setTaggedSymbols(prev => {
      const next = new Set(prev);
      if (isTagged) next.delete(symbol); else next.add(symbol);
      return next;
    });
    try {
      await authFetch(`${BASE}/api/user/portfolio/${encodeURIComponent(symbol)}`, {
        method: isTagged ? "DELETE" : "PUT",
      });
    } catch { /* ignore */ }
  }, [authFetch, taggedSymbols]);

  const toggleSort = useCallback(() => {
    setSortDir(d => d === null ? "desc" : d === "desc" ? "asc" : null);
  }, []);

  // -- Export / import --------------------------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(sections, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tradingvue-watchlist-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [sections]);

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = normalizeImportedSections(JSON.parse(String(reader.result)));
        if (imported.length === 0) { window.alert("No watchlist symbols found in that file."); return; }
        setSections(imported);
      } catch {
        window.alert("Import failed: the file is not valid watchlist JSON.");
      }
    };
    reader.readAsText(file);
  }, []);

  // --- Symbol drag state ---
  const symbolDragState = useRef<SymbolDragState | null>(null);
  const [draggingSymbol, setDraggingSymbol] = useState<string | null>(null);
  const [symbolDropTarget, setSymbolDropTarget] = useState<SymbolDropTarget | null>(null);

  // --- Section drag state ---
  const sectionDragId = useRef<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<string | null>(null);
  const [sectionDropBefore, setSectionDropBefore] = useState<string | null>(null); // sectionId to insert before, "__end__" for end


  const addSection = useCallback(() => {
    setSections((prev) => [...prev, createSection(`Group ${prev.length + 1}`)]);
  }, []);

  const renameSection = useCallback((id: string, name: string) => {
    setSections((prev) => prev.map((s) => s.id === id ? { ...s, name } : s));
  }, []);

  const deleteSection = useCallback((id: string) => {
    setSections((prev) => {
      const target = prev.find((s) => s.id === id);
      if (!target) return prev;
      const orphaned = target.symbols;
      const remaining = prev.filter((s) => s.id !== id);
      if (remaining.length === 0) return [];
      return [{ ...remaining[0], symbols: [...remaining[0].symbols, ...orphaned] }, ...remaining.slice(1)];
    });
  }, [setSections]);

  const toggleCollapse = useCallback((id: string) => {
    setSections((prev) => prev.map((s) => s.id === id ? { ...s, collapsed: !s.collapsed } : s));
  }, []);

  // ---- Symbol drag handlers ----
  const handleSymbolDragStart = useCallback((e: React.DragEvent, symbol: string, fromSectionId: string) => {
    symbolDragState.current = { symbol, fromSectionId };
    setDraggingSymbol(symbol);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", symbol);
    const ghost = document.createElement("div");
    ghost.style.cssText = "position:fixed;top:-9999px;left:-9999px;padding:4px 10px;background:#1e222d;color:#d1d4dc;font-size:12px;font-family:monospace;border:1px solid #2962ff55;border-radius:4px;white-space:nowrap;";
    ghost.textContent = symbol;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }, []);

  const handleSymbolDragEnd = useCallback(() => {
    symbolDragState.current = null;
    setDraggingSymbol(null);
    setSymbolDropTarget(null);
  }, []);

  const handleSymbolDragOver = useCallback((e: React.DragEvent, sectionId: string, overSymbol: string | null) => {
    if (sectionDragId.current) return; // section drag in progress — ignore
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const ds = symbolDragState.current;
    if (!ds) return;
    if (overSymbol === ds.symbol) return;
    setSymbolDropTarget({ sectionId, insertBefore: overSymbol });
  }, []);

  const handleSymbolDrop = useCallback((e: React.DragEvent, sectionId: string) => {
    if (sectionDragId.current) return; // section drag in progress — ignore
    e.preventDefault();
    const ds = symbolDragState.current;
    if (!ds) return;

    const { symbol: draggedSym, fromSectionId } = ds;
    const dt = symbolDropTarget;

    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, symbols: [...s.symbols] }));
      const srcIdx = next.findIndex((s) => s.id === fromSectionId);
      if (srcIdx !== -1) next[srcIdx].symbols = next[srcIdx].symbols.filter((s) => s !== draggedSym);
      const dstIdx = next.findIndex((s) => s.id === sectionId);
      if (dstIdx === -1) return prev;
      const dst = next[dstIdx];
      if (dt && dt.sectionId === sectionId && dt.insertBefore) {
        const pos = dst.symbols.indexOf(dt.insertBefore);
        if (pos === -1) dst.symbols.push(draggedSym);
        else dst.symbols.splice(pos, 0, draggedSym);
      } else {
        dst.symbols.push(draggedSym);
      }
      return next;
    });

    setSymbolDropTarget(null);
    symbolDragState.current = null;
  }, [symbolDropTarget]);

  // ---- Section drag handlers ----
  const handleSectionDragStart = useCallback((e: React.DragEvent, sectionId: string) => {
    sectionDragId.current = sectionId;
    setDraggingSection(sectionId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `section:${sectionId}`);
    const ghost = document.createElement("div");
    ghost.style.cssText = "position:fixed;top:-9999px;left:-9999px;padding:4px 10px;background:#1e222d;color:#787b86;font-size:10px;font-family:monospace;border:1px solid #2962ff55;border-radius:4px;text-transform:uppercase;letter-spacing:0.1em;";
    const sec = sections.find((s) => s.id === sectionId);
    ghost.textContent = sec?.name ?? "Section";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }, [sections]);

  const handleSectionDragEnd = useCallback(() => {
    sectionDragId.current = null;
    setDraggingSection(null);
    setSectionDropBefore(null);
  }, []);

  const handleSectionDragOver = useCallback((e: React.DragEvent, targetSectionId: string) => {
    if (!sectionDragId.current) return;
    if (sectionDragId.current === targetSectionId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setSectionDropBefore(targetSectionId);
  }, []);

  const handleSectionListEndDragOver = useCallback((e: React.DragEvent) => {
    if (!sectionDragId.current) return;
    e.preventDefault();
    setSectionDropBefore("__end__");
  }, []);

  const handleSectionDrop = useCallback((e: React.DragEvent, targetSectionId: string | "__end__") => {
    const draggedId = sectionDragId.current;
    if (!draggedId) return;
    e.preventDefault();
    e.stopPropagation();

    setSections((prev) => {
      if (draggedId === targetSectionId) return prev;
      const without = prev.filter((s) => s.id !== draggedId);
      const dragged = prev.find((s) => s.id === draggedId);
      if (!dragged) return prev;
      if (targetSectionId === "__end__") return [...without, dragged];
      const idx = without.findIndex((s) => s.id === targetSectionId);
      if (idx === -1) return [...without, dragged];
      const result = [...without];
      result.splice(idx, 0, dragged);
      return result;
    });

    sectionDragId.current = null;
    setDraggingSection(null);
    setSectionDropBefore(null);
  }, []);

  const allSymbols = sections.flatMap((s) => s.symbols);
  const hasAny = allSymbols.length > 0;

  return (
    <div className={`flex flex-col bg-[#131722] overflow-hidden ${fullHeight ? "h-full" : "w-[320px] shrink-0 border-l border-[#2a2e39] h-full"}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#2a2e39] shrink-0">
        <div className="flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 text-[#ff9800]" />
          <span className="text-xs font-semibold text-[#d1d4dc] tracking-wide">WATCHLIST</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
              portfolioFilter
                ? "bg-[#26a69a]/20 text-[#26a69a] hover:bg-[#26a69a]/30"
                : "hover:bg-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc]"
            }`}
            onClick={() => setPortfolioFilter(f => !f)}
            title={portfolioFilter ? "Show all symbols" : "Show tagged only"}
          >
            <Briefcase className="w-3.5 h-3.5" />
          </button>
          <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />
          <button
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc] transition-colors"
            onClick={handleExport}
            title="Export watchlist"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc] transition-colors"
            onClick={() => fileInputRef.current?.click()}
            title="Import watchlist"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc] transition-colors"
            onClick={addSection}
            title="New section"
          >
            <span className="text-[10px] font-bold leading-none pb-px">§</span>
          </button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#2a2e39] text-[#787b86] hover:text-[#d1d4dc] transition-colors"
            onClick={() => onSearchOpen()}
            title="Add symbol"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Column headers — structure mirrors SymbolRow exactly so columns stay aligned
          at any watchlist width: same mx-1 px-1.5 gap-1 container, same spacers for
          the grip handle (left) and the bell + remove buttons (right). */}
      {hasAny && (
        <div className="flex items-center gap-1 px-1.5 mx-1 pt-1.5 pb-0.5 border-b border-[#2a2e39]/50 shrink-0">
          {/* grip spacer */}
          <div className="shrink-0 w-3 p-0.5 -ml-0.5" />
          {/* icon spacer — matches TickerIcon w-[18px] */}
          <div className="shrink-0 w-[18px]" />
          <div className="flex-1 min-w-0 text-[9px] font-semibold text-[#4c525e] tracking-widest uppercase">Symbol</div>
          <div className="w-[46px] shrink-0 text-center text-[9px] font-semibold text-[#4c525e] tracking-widest uppercase">Last</div>
          <div className="w-[40px] shrink-0 text-center text-[9px] font-semibold text-[#f59e0b]/70 tracking-widest uppercase">Ext</div>
          <button
            onClick={toggleSort}
            title={sortDir === null ? "Sort by % change (high→low)" : sortDir === "desc" ? "Sort by % change (low→high)" : "Clear sort"}
            className={`w-[46px] shrink-0 flex items-center justify-center gap-0.5 text-[9px] font-semibold tracking-widest uppercase transition-colors hover:text-[#d1d4dc] ${sortDir !== null ? "text-[#2962ff]" : "text-[#4c525e]"}`}
          >
            %
            <span className="text-[8px] leading-none">
              {sortDir === "desc" ? "▼" : sortDir === "asc" ? "▲" : ""}
            </span>
          </button>
          {/* briefcase spacer */}
          <div className="shrink-0 w-3 p-0.5" />
          {/* bell spacer */}
          <div className="shrink-0 w-3 p-0.5" />
          {/* remove spacer */}
          <div className="shrink-0 w-3 p-0.5" />
        </div>
      )}

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto py-1 scrollbar-thin"
        onDragOver={handleSectionListEndDragOver}
        onDrop={(e) => handleSectionDrop(e, "__end__")}
      >
        {sections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Star className="w-6 h-6 text-[#2a2e39]" />
            <p className="text-xs text-[#787b86] text-center">No symbols yet.<br />Click + to add.</p>
          </div>
        ) : (
          sections.map((section) => {
            const isSectionDragging = draggingSection === section.id;
            const showDropLineBefore = sectionDropBefore === section.id && draggingSection !== section.id;

            return (
              <div
                key={section.id}
                className={`relative transition-opacity ${isSectionDragging ? "opacity-30" : ""}`}
                onDragOver={(e) => {
                  if (sectionDragId.current) {
                    handleSectionDragOver(e, section.id);
                  } else {
                    e.preventDefault();
                    if (!symbolDragState.current) return;
                    setSymbolDropTarget({ sectionId: section.id, insertBefore: null });
                  }
                }}
                onDrop={(e) => {
                  if (sectionDragId.current) {
                    handleSectionDrop(e, section.id);
                  } else {
                    handleSymbolDrop(e, section.id);
                  }
                }}
              >
                {/* Section drop indicator line */}
                {showDropLineBefore && (
                  <div className="absolute left-2 right-2 top-0 h-0.5 bg-[#2962ff] rounded-full z-20 pointer-events-none" />
                )}

                {sections.length > 1 && (
                  <SectionHeader
                    section={section}
                    onToggleCollapse={() => toggleCollapse(section.id)}
                    onRename={(name) => renameSection(section.id, name)}
                    onDelete={() => deleteSection(section.id)}
                    onAddSymbol={() => onSearchOpen()}
                    onSectionDragStart={(e) => handleSectionDragStart(e, section.id)}
                    onSectionDragEnd={handleSectionDragEnd}
                  />
                )}

                {!section.collapsed && (
                  <>
                    {(sortDir !== null
                      ? [...section.symbols].sort((a, b) => {
                          const pa = pctMap[a] ?? null;
                          const pb = pctMap[b] ?? null;
                          if (pa === null && pb === null) return 0;
                          if (pa === null) return 1;
                          if (pb === null) return -1;
                          return sortDir === "desc" ? pb - pa : pa - pb;
                        })
                      : section.symbols
                    ).filter(sym => !portfolioFilter || taggedSymbols.has(sym)).map((sym) => (
                      <SymbolRow
                        key={sym}
                        symbol={sym}
                        isActive={sym === activeSymbol}
                        isFaded={sym === draggingSymbol}
                        isDragOver={symbolDropTarget?.sectionId === section.id && symbolDropTarget?.insertBefore === sym}
                        dragOverTop={true}
                        hasAlert={alertedSymbols.has(sym)}
                        isTagged={taggedSymbols.has(sym)}
                        onClick={() => onSelect(sym)}
                        onRemove={() => setSections(prev => removeSymbolFromSections(prev, sym))}
                        onAlertClick={(price) => { onAlertOpen(sym, price); refreshAlerts(); }}
                        onPortfolioToggle={handlePortfolioToggle}
                        onDragStart={(e) => handleSymbolDragStart(e, sym, section.id)}
                        onDragEnd={handleSymbolDragEnd}
                        onDragOver={(e, s) => handleSymbolDragOver(e, section.id, s)}
                        onDrop={(e) => handleSymbolDrop(e, section.id)}
                        onChangePercent={handleChangePercent}
                      />
                    ))}

                    {section.symbols.length === 0 && (
                      <div
                        className="mx-2 my-1 px-3 py-2.5 border border-dashed border-[#2a2e39] rounded text-[10px] text-[#4c525e] text-center transition-colors"
                        style={symbolDropTarget?.sectionId === section.id ? { borderColor: "#2962ff55", color: "#2962ff77" } : {}}
                      >
                        Drop symbols here
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })
        )}

        {/* End drop zone for sections — renders a line at the very bottom when dragging */}
        {draggingSection && sectionDropBefore === "__end__" && (
          <div className="relative h-2 mx-2">
            <div className="absolute left-0 right-0 top-1 h-0.5 bg-[#2962ff] rounded-full pointer-events-none" />
          </div>
        )}
      </div>

      {/* Add defaults footer */}
      {!hasAny && sections.length > 0 && (
        <div className="border-t border-[#2a2e39] p-3 shrink-0">
          <button
            className="w-full text-xs text-[#787b86] hover:text-[#d1d4dc] transition-colors text-center"
            onClick={() => setSections(prev => DEFAULT_STOCKS.reduce((acc, sym) => addSymbolToSections(acc, sym), prev))}
          >
            + Add defaults
          </button>
        </div>
      )}
    </div>
  );
}
