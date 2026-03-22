import type { DrawingTool } from '@/lib/drawings';
import { DRAWING_COLORS } from '@/lib/drawings';
import { MousePointer2, Minus, Square, Type, Eraser, Trash2 } from 'lucide-react';

function TrendLineIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="14" x2="14" y2="2" />
      <circle cx="2" cy="14" r="2" fill="currentColor" stroke="none" />
      <circle cx="14" cy="2" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function VLineIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="8" y1="1" x2="8" y2="15" />
      <line x1="5" y1="1" x2="11" y2="1" strokeWidth="1" />
      <line x1="5" y1="15" x2="11" y2="15" strokeWidth="1" />
    </svg>
  );
}

function FibIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round">
      <line x1="1" y1="3"  x2="15" y2="3"  strokeWidth="1.5" />
      <line x1="1" y1="6"  x2="15" y2="6"  strokeWidth="0.8" />
      <line x1="1" y1="8"  x2="15" y2="8"  strokeWidth="0.8" />
      <line x1="1" y1="10" x2="15" y2="10" strokeWidth="0.8" />
      <line x1="1" y1="13" x2="15" y2="13" strokeWidth="1.5" />
      <line x1="1" y1="3"  x2="1"  y2="13" strokeWidth="1.5" />
      <line x1="15" y1="3" x2="15" y2="13" strokeWidth="1.5" />
    </svg>
  );
}

type ToolDef = { id: DrawingTool; label: string; shortcut?: string; Icon: React.FC };

const TOOL_GROUPS: ToolDef[][] = [
  [{ id: 'cursor',    label: 'Cursor',                  shortcut: 'V', Icon: MousePointer2 as React.FC }],
  [
    { id: 'trendline', label: 'Trend Line',              shortcut: 'T', Icon: TrendLineIcon },
    { id: 'hline',     label: 'Horizontal Line',         shortcut: 'H', Icon: Minus as React.FC },
    { id: 'vline',     label: 'Vertical Line',                          Icon: VLineIcon },
  ],
  [
    { id: 'rect',      label: 'Rectangle',               shortcut: 'R', Icon: Square as React.FC },
    { id: 'fib',       label: 'Fibonacci Retracement',   shortcut: 'F', Icon: FibIcon },
  ],
  [
    { id: 'text',      label: 'Text',                    shortcut: 'A', Icon: Type as React.FC },
  ],
  [
    { id: 'eraser',    label: 'Eraser',                  shortcut: 'E', Icon: Eraser as React.FC },
  ],
];

interface DrawingToolbarProps {
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  activeColor: string;
  onColorChange: (color: string) => void;
  onClearAll: () => void;
  hasDrawings: boolean;
}

export function DrawingToolbar({
  activeTool, onToolChange, activeColor, onColorChange, onClearAll, hasDrawings,
}: DrawingToolbarProps) {
  return (
    <div className="w-10 shrink-0 flex flex-col items-center bg-[#1e222d] border-r border-[#2a2e39] py-2 gap-0 z-20 select-none">
      {TOOL_GROUPS.map((group, gi) => (
        <div
          key={gi}
          className={`flex flex-col items-center gap-0.5 w-full px-1 ${gi > 0 ? 'mt-0.5 pt-0.5 border-t border-[#2a2e39]/60' : ''}`}
        >
          {group.map(({ id, label, shortcut, Icon }) => (
            <button
              key={id}
              title={shortcut ? `${label}  [${shortcut}]` : label}
              onClick={() => onToolChange(id)}
              className={`w-8 h-8 flex items-center justify-center rounded transition-all ${
                activeTool === id
                  ? 'bg-[#2962ff] text-white shadow-[0_0_0_1px_#2962ff]'
                  : 'text-[#787b86] hover:bg-[#2a2e39] hover:text-[#d1d4dc]'
              }`}
            >
              <Icon />
            </button>
          ))}
        </div>
      ))}

      {/* Color swatches */}
      <div className="mt-auto pt-2 border-t border-[#2a2e39]/60 w-full flex flex-col items-center gap-1 px-1">
        {DRAWING_COLORS.map((c) => (
          <button
            key={c}
            title={c}
            onClick={() => onColorChange(c)}
            style={{ backgroundColor: c, width: 18, height: 18, borderRadius: 3 }}
            className={`shrink-0 transition-all ${
              activeColor === c
                ? 'ring-2 ring-white ring-offset-1 ring-offset-[#1e222d] scale-110'
                : 'hover:scale-110 opacity-80 hover:opacity-100'
            }`}
          />
        ))}

        {/* Clear all */}
        <button
          title="Clear all drawings"
          onClick={onClearAll}
          disabled={!hasDrawings}
          className={`mt-1 w-8 h-8 flex items-center justify-center rounded transition-colors ${
            hasDrawings
              ? 'text-[#787b86] hover:bg-[#2a2e39] hover:text-[#ef5350]'
              : 'text-[#2a2e39] cursor-not-allowed'
          }`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
