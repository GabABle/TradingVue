export type DrawingTool =
  | 'cursor'
  | 'trendline'
  | 'hline'
  | 'vline'
  | 'rect'
  | 'fib'
  | 'text'
  | 'eraser';

export interface DrawingPoint {
  time: number; // UTCTimestamp (unix seconds)
  price: number;
}

export interface TrendLineDrawing {
  id: string; type: 'trendline'; color: string;
  p1: DrawingPoint; p2: DrawingPoint;
}
export interface HLineDrawing {
  id: string; type: 'hline'; color: string; price: number;
}
export interface VLineDrawing {
  id: string; type: 'vline'; color: string; time: number;
}
export interface RectDrawing {
  id: string; type: 'rect'; color: string;
  p1: DrawingPoint; p2: DrawingPoint;
}
export interface FibDrawing {
  id: string; type: 'fib'; color: string;
  p1: DrawingPoint; p2: DrawingPoint;
}
export interface TextDrawing {
  id: string; type: 'text'; color: string;
  pos: DrawingPoint; text: string;
}

export type Drawing =
  | TrendLineDrawing | HLineDrawing | VLineDrawing
  | RectDrawing | FibDrawing | TextDrawing;

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export const FIB_COLORS: Record<string, string> = {
  '0':     '#a0a0b0',
  '0.236': '#26c6da',
  '0.382': '#2962ff',
  '0.5':   '#ff9800',
  '0.618': '#2962ff',
  '0.786': '#26c6da',
  '1':     '#a0a0b0',
};

export const DRAWING_COLORS = [
  '#2962ff', '#26a69a', '#ef5350',
  '#ff9800', '#b39ddb', '#d1d4dc',
];

export const DEFAULT_DRAWING_COLOR = '#2962ff';

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function loadDrawings(symbol: string): Drawing[] {
  try {
    const raw = localStorage.getItem(`tradingVue_drawings_${symbol}`);
    if (!raw) return [];
    return JSON.parse(raw) as Drawing[];
  } catch { return []; }
}

export function saveDrawings(symbol: string, drawings: Drawing[]): void {
  try {
    localStorage.setItem(`tradingVue_drawings_${symbol}`, JSON.stringify(drawings));
  } catch { /* ignore */ }
}
