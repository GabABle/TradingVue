import { useRef, useState, useCallback, useEffect } from "react";
import { Watchlist } from "@/components/Watchlist";
import { NewsPanel } from "@/components/NewsPanel";
import { ChatPanel } from "@/components/ChatPanel";

const MIN_WIDTH    = 180;
const MAX_WIDTH    = 520;
const DEFAULT_WIDTH = 208;
const STORAGE_KEY_WIDTH = "tradingTerminalRightPanelWidth";

interface RightPanelProps {
  symbols: string[];
  activeSymbol: string;
  onSelect: (symbol: string) => void;
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onSearchOpen: (initial?: string) => void;
  onAlertOpen: (symbol: string, currentPrice: number | null) => void;
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

type DragTarget = "panel" | "news" | "chat" | null;

export function RightPanel({
  symbols,
  activeSymbol,
  onSelect,
  onAdd,
  onRemove,
  onSearchOpen,
  onAlertOpen,
  chatContext,
}: RightPanelProps) {
  const [width, setWidth]           = useState<number>(loadWidth);
  const [newsHeight, setNewsHeight]  = useState<number>(180);
  const [chatHeight, setChatHeight]  = useState<number>(240);

  const dragging  = useRef<DragTarget>(null);
  const startX    = useRef(0);
  const startY    = useRef(0);
  const startW    = useRef(0);
  const startNews = useRef(0);
  const startChat = useRef(0);
  const panelRef  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY_WIDTH, String(width)); } catch { /* ignore */ }
  }, [width]);

  const onPanelMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = "panel";
    startX.current   = e.clientX;
    startW.current   = width;
  }, [width]);

  const onNewsResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current   = "news";
    startY.current     = e.clientY;
    startNews.current  = newsHeight;
  }, [newsHeight]);

  const onChatResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current   = "chat";
    startY.current     = e.clientY;
    startChat.current  = chatHeight;
  }, [chatHeight]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const target = dragging.current;
      if (!target) return;

      if (target === "panel") {
        const delta = startX.current - e.clientX;
        const next  = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + delta));
        setWidth(next);
      }

      if (target === "news") {
        const panelH = panelRef.current?.offsetHeight ?? 600;
        const delta  = startY.current - e.clientY;
        const next   = Math.min(panelH - 240, Math.max(80, startNews.current + delta));
        setNewsHeight(next);
      }

      if (target === "chat") {
        const panelH = panelRef.current?.offsetHeight ?? 600;
        const delta  = startY.current - e.clientY;
        const next   = Math.min(panelH - 200, Math.max(120, startChat.current + delta));
        setChatHeight(next);
      }
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []);

  const ResizeHandle = ({
    onMouseDown,
    title,
  }: {
    onMouseDown: (e: React.MouseEvent) => void;
    title: string;
  }) => (
    <div
      onMouseDown={onMouseDown}
      title={title}
      className="relative shrink-0 h-1.5 cursor-row-resize flex items-center justify-center group z-10 bg-[#0d1017] border-y border-[#2a2e39] hover:bg-[#2962ff]/15 transition-colors"
    >
      <div className="w-8 h-0.5 rounded-full bg-[#2a2e39] group-hover:bg-[#2962ff]/50 transition-colors" />
    </div>
  );

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

      {/* ── Watchlist (takes remaining height) ── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <Watchlist
          symbols={symbols}
          activeSymbol={activeSymbol}
          onSelect={onSelect}
          onAdd={onAdd}
          onRemove={onRemove}
          onSearchOpen={onSearchOpen}
          onAlertOpen={onAlertOpen}
          fullHeight
        />
      </div>

      {/* ── News resize handle ── */}
      <ResizeHandle onMouseDown={onNewsResizeMouseDown} title="Drag to resize news" />

      {/* ── News panel ── */}
      <div className="shrink-0 overflow-hidden" style={{ height: newsHeight }}>
        <NewsPanel symbol={chatContext?.symbol ?? activeSymbol} />
      </div>

      {/* ── Chat resize handle ── */}
      <ResizeHandle onMouseDown={onChatResizeMouseDown} title="Drag to resize chat" />

      {/* ── Chat panel ── */}
      <div className="shrink-0 overflow-hidden" style={{ height: chatHeight }}>
        <ChatPanel context={chatContext} />
      </div>
    </div>
  );
}
