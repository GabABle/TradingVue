import { useRef, useState, useCallback, useEffect } from "react";
import { Watchlist } from "@/components/Watchlist";
import { ChatPanel } from "@/components/ChatPanel";

const MIN_WIDTH = 180;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 208; // w-52 = 13rem = 208px
const STORAGE_KEY_WIDTH = "tradingTerminalRightPanelWidth";

interface RightPanelProps {
  symbols: string[];
  activeSymbol: string;
  onSelect: (symbol: string) => void;
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onSearchOpen: (initial?: string) => void;
  chatContext?: {
    symbol?: string;
    range?: string;
    interval?: string;
    showRSI?: boolean;
    showStoch?: boolean;
    smaPeriod?: number | null;
    emaPeriod?: number | null;
  };
}

function loadWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_WIDTH);
    if (stored) {
      const n = parseInt(stored, 10);
      if (!isNaN(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch { /* ignore */ }
  return DEFAULT_WIDTH;
}

export function RightPanel({
  symbols,
  activeSymbol,
  onSelect,
  onAdd,
  onRemove,
  onSearchOpen,
  chatContext,
}: RightPanelProps) {
  const [width, setWidth] = useState<number>(loadWidth);
  const [chatHeight, setChatHeight] = useState<number>(280);
  const draggingPanel = useRef(false);
  const draggingChat  = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(0);
  const startY   = useRef(0);
  const startH   = useRef(0);
  const panelRef  = useRef<HTMLDivElement>(null);

  // ── Persist width ──
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_WIDTH, String(width)); } catch { /* ignore */ }
  }, [width]);

  // ── Left-edge drag for panel width ──
  const onPanelMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingPanel.current = true;
    startX.current = e.clientX;
    startW.current = width;
  }, [width]);

  // ── Top-edge drag for chat height ──
  const onChatMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingChat.current = true;
    startY.current = e.clientY;
    startH.current = chatHeight;
  }, [chatHeight]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (draggingPanel.current) {
        const delta = startX.current - e.clientX;
        const next  = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + delta));
        setWidth(next);
      }
      if (draggingChat.current) {
        const panelH = panelRef.current?.offsetHeight ?? 600;
        const delta  = startY.current - e.clientY;
        const next   = Math.min(panelH - 120, Math.max(120, startH.current + delta));
        setChatHeight(next);
      }
    };
    const onUp = () => {
      draggingPanel.current = false;
      draggingChat.current  = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      className="relative shrink-0 flex flex-col border-l border-[#2a2e39] bg-[#131722] h-full overflow-hidden"
      style={{ width }}
    >
      {/* ── Left resize handle ── */}
      <div
        onMouseDown={onPanelMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 z-20 cursor-col-resize group"
        title="Drag to resize panel"
      >
        <div className="w-full h-full group-hover:bg-[#2962ff]/40 transition-colors" />
      </div>

      {/* ── Watchlist (takes remaining height above chat) ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Watchlist
          symbols={symbols}
          activeSymbol={activeSymbol}
          onSelect={onSelect}
          onAdd={onAdd}
          onRemove={onRemove}
          onSearchOpen={onSearchOpen}
          fullHeight
        />
      </div>

      {/* ── Chat resize handle ── */}
      <div
        onMouseDown={onChatMouseDown}
        className="relative shrink-0 h-1.5 cursor-row-resize flex items-center justify-center group z-10 bg-[#0f131d] border-y border-[#2a2e39] hover:bg-[#2962ff]/20 transition-colors"
        title="Drag to resize chat"
      >
        <div className="w-8 h-0.5 rounded-full bg-[#2a2e39] group-hover:bg-[#2962ff]/50 transition-colors" />
      </div>

      {/* ── Chat panel ── */}
      <div className="shrink-0 overflow-hidden" style={{ height: chatHeight }}>
        <ChatPanel context={chatContext} />
      </div>
    </div>
  );
}
