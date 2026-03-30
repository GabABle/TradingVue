import { useState, useCallback, useEffect, useRef } from "react";
import { Plus, X, Star, GripVertical, ChevronDown, ChevronRight, Pencil, Check, Trash2 } from "lucide-react";
import { useGetQuote } from "@workspace/api-client-react";
import {
  type WatchlistSection,
  createSection,
  loadSections,
  saveSections,
  syncSectionsWithSymbols,
} from "@/lib/watchlist-sections";

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
  symbols: string[];
  activeSymbol: string;
  onSelect: (symbol: string) => void;
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onSearchOpen: (initial?: string) => void;
  fullHeight?: boolean;
}

const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "TSLA", "GOOGL", "NVDA", "AMZN", "BTCUSD", "ETHUSD"];

interface DragState {
  symbol: string;
  fromSectionId: string;
}

interface DropTarget {
  sectionId: string;
  insertBefore: string | null;
}

function fmt(p: number | null | undefined): string {
  if (p == null) return "—";
  return p < 1 ? p.toFixed(4) : p.toFixed(2);
}

function SymbolRow({
  symbol,
  isActive,
  isFaded,
  isDragOver,
  dragOverTop,
  onClick,
  onRemove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  symbol: string;
  isActive: boolean;
  isFaded: boolean;
  isDragOver: boolean;
  dragOverTop: boolean;
  onClick: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, symbol: string) => void;
  onDrop: (e: React.DragEvent, sectionId?: string) => void;
}) {
  const { data: quote } = useGetQuote({ symbol }, { query: { refetchInterval: 15000 } });
  const session   = (quote as any)?.session  as MarketSession | undefined;
  const prevClose = (quote as any)?.prevClose    as number | null | undefined;
  const regularClose = (quote as any)?.regularClose as number | null | undefined;
  const isUp = (quote?.changePercent ?? 0) >= 0;

  // Primary "close" column: the last regular-session reference price
  const closePrice: number | null | undefined =
    session === "pre"   ? prevClose :
    session === "after" ? regularClose :
    quote?.price;

  // Extended-hours column: the current pre/after price (shown only when live extended session)
  const extPrice: number | null =
    session === "pre" || session === "after" ? (quote?.price ?? null) : null;

  return (
    <div
      className={`relative transition-opacity ${isFaded ? "opacity-30" : ""}`}
      onDragOver={(e) => onDragOver(e, symbol)}
      onDrop={(e) => onDrop(e)}
    >
      {/* Drop indicator line */}
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
        {/* Drag handle */}
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

        {/* Symbol */}
        <div className="flex-1 min-w-0">
          <span className={`text-xs font-bold font-mono truncate block ${isActive ? "text-[#2962ff]" : "text-[#d1d4dc]"}`}>
            {symbol}
          </span>
        </div>

        {/* % Change (always the extended-hours change during PRE/AFTER, else day change) */}
        <div className="w-[46px] shrink-0 text-right">
          {quote ? (
            <span className={`text-[11px] font-semibold font-mono ${isUp ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
              {isUp ? "+" : ""}{quote.changePercent.toFixed(2)}%
            </span>
          ) : (
            <span className="text-[10px] text-[#787b86]">—</span>
          )}
        </div>

        {/* Regular close price */}
        <div className="w-[46px] shrink-0 text-right">
          {quote ? (
            <span className="text-[11px] font-mono font-bold text-[#d1d4dc]">
              {fmt(closePrice)}
            </span>
          ) : (
            <div className="ml-auto w-9 h-3 bg-[#2a2e39] rounded animate-pulse" />
          )}
        </div>

        {/* Extended-hours price (PRE=amber, AH=indigo; blank for regular/closed) */}
        <div className="w-[40px] shrink-0 text-right">
          {extPrice != null ? (
            <span className={`text-[11px] font-mono font-semibold ${session === "pre" ? "text-[#f59e0b]" : "text-[#818cf8]"}`}>
              {fmt(extPrice)}
            </span>
          ) : null}
        </div>

        {/* Remove */}
        <button
          className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-[#ef5350] text-[#787b86] transition-all z-10 bg-[#131722]/80"
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
}: {
  section: WatchlistSection;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onAddSymbol: () => void;
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

export function Watchlist({ symbols, activeSymbol, onSelect, onAdd, onRemove, onSearchOpen, fullHeight }: WatchlistProps) {
  const [sections, setSections] = useState<WatchlistSection[]>(() => loadSections(symbols));
  const dragState = useRef<DragState | null>(null);
  const [draggingSymbol, setDraggingSymbol] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  useEffect(() => {
    setSections((prev) => {
      const next = syncSectionsWithSymbols(prev, symbols);
      if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
      return next;
    });
  }, [symbols]);

  useEffect(() => { saveSections(sections); }, [sections]);

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
      if (remaining.length === 0) { orphaned.forEach(onRemove); return []; }
      return [{ ...remaining[0], symbols: [...remaining[0].symbols, ...orphaned] }, ...remaining.slice(1)];
    });
  }, [onRemove]);

  const toggleCollapse = useCallback((id: string) => {
    setSections((prev) => prev.map((s) => s.id === id ? { ...s, collapsed: !s.collapsed } : s));
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, symbol: string, fromSectionId: string) => {
    dragState.current = { symbol, fromSectionId };
    setDraggingSymbol(symbol);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", symbol);
    // Custom ghost label
    const ghost = document.createElement("div");
    ghost.style.cssText = "position:fixed;top:-9999px;left:-9999px;padding:4px 10px;background:#1e222d;color:#d1d4dc;font-size:12px;font-family:monospace;border:1px solid #2962ff55;border-radius:4px;white-space:nowrap;";
    ghost.textContent = symbol;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }, []);

  const handleDragEnd = useCallback(() => {
    dragState.current = null;
    setDraggingSymbol(null);
    setDropTarget(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, sectionId: string, overSymbol: string | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const ds = dragState.current;
    if (!ds) return;
    if (overSymbol === ds.symbol) return;
    setDropTarget({ sectionId, insertBefore: overSymbol });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, sectionId: string) => {
    e.preventDefault();
    const ds = dragState.current;
    if (!ds) return;

    const { symbol: draggedSym, fromSectionId } = ds;
    const dt = dropTarget;

    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, symbols: [...s.symbols] }));

      // Remove from source
      const srcIdx = next.findIndex((s) => s.id === fromSectionId);
      if (srcIdx !== -1) next[srcIdx].symbols = next[srcIdx].symbols.filter((s) => s !== draggedSym);

      // Insert into target
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

    setDropTarget(null);
    dragState.current = null;
  }, [dropTarget]);

  const allSymbols = sections.flatMap((s) => s.symbols);
  const hasAny = allSymbols.length > 0;

  return (
    <div className={`flex flex-col bg-[#131722] overflow-hidden ${fullHeight ? "h-full" : "w-60 shrink-0 border-l border-[#2a2e39] h-full"}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#2a2e39] shrink-0">
        <div className="flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 text-[#ff9800]" />
          <span className="text-xs font-semibold text-[#d1d4dc] tracking-wide">WATCHLIST</span>
        </div>
        <div className="flex items-center gap-1">
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

      {/* Column headers */}
      {hasAny && (
        <div className="flex items-center px-3 pt-1.5 pb-0.5 border-b border-[#2a2e39]/50 shrink-0">
          <div className="w-5 shrink-0" />
          <div className="flex-1 text-[9px] font-semibold text-[#4c525e] tracking-widest uppercase">Symbol</div>
          <div className="w-[46px] shrink-0 text-right text-[9px] font-semibold text-[#4c525e] tracking-widest uppercase">%</div>
          <div className="w-[46px] shrink-0 text-right text-[9px] font-semibold text-[#4c525e] tracking-widest uppercase">Close</div>
          <div className="w-[40px] shrink-0 text-right text-[9px] font-semibold text-[#f59e0b]/70 tracking-widest uppercase">Ext</div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
        {sections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <Star className="w-6 h-6 text-[#2a2e39]" />
            <p className="text-xs text-[#787b86] text-center">No symbols yet.<br />Click + to add.</p>
          </div>
        ) : (
          sections.map((section) => (
            <div
              key={section.id}
              onDragOver={(e) => { e.preventDefault(); if (!dragState.current) return; setDropTarget({ sectionId: section.id, insertBefore: null }); }}
              onDrop={(e) => handleDrop(e, section.id)}
            >
              {sections.length > 1 && (
                <SectionHeader
                  section={section}
                  onToggleCollapse={() => toggleCollapse(section.id)}
                  onRename={(name) => renameSection(section.id, name)}
                  onDelete={() => deleteSection(section.id)}
                  onAddSymbol={() => onSearchOpen()}
                />
              )}

              {!section.collapsed && (
                <>
                  {section.symbols.map((sym) => (
                    <SymbolRow
                      key={sym}
                      symbol={sym}
                      isActive={sym === activeSymbol}
                      isFaded={sym === draggingSymbol}
                      isDragOver={dropTarget?.sectionId === section.id && dropTarget?.insertBefore === sym}
                      dragOverTop={true}
                      onClick={() => onSelect(sym)}
                      onRemove={() => onRemove(sym)}
                      onDragStart={(e) => handleDragStart(e, sym, section.id)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e, s) => handleDragOver(e, section.id, s)}
                      onDrop={(e) => handleDrop(e, section.id)}
                    />
                  ))}

                  {section.symbols.length === 0 && (
                    <div className="mx-2 my-1 px-3 py-2.5 border border-dashed border-[#2a2e39] rounded text-[10px] text-[#4c525e] text-center transition-colors"
                      style={dropTarget?.sectionId === section.id ? { borderColor: "#2962ff55", color: "#2962ff77" } : {}}
                    >
                      Drop symbols here
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add defaults footer */}
      {!hasAny && sections.length > 0 && (
        <div className="border-t border-[#2a2e39] p-3 shrink-0">
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
