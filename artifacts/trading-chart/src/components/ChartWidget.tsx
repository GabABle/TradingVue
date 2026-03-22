import { useEffect, useRef, useState, useReducer, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import type { Bar } from "@workspace/api-client-react";
import { calculateSMA, calculateEMA, calculateRSI, calculateStochastic } from '@/lib/indicators';
import {
  type Drawing,
  type DrawingTool,
  type DrawingPoint,
  FIB_LEVELS,
  FIB_COLORS,
  uid,
} from '@/lib/drawings';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChartWidgetProps {
  data: Bar[];
  showRSI: boolean;
  showStoch: boolean;
  smaPeriod: number | null;
  emaPeriod: number | null;
  activeTool: DrawingTool;
  activeColor: string;
  drawings: Drawing[];
  onDrawingCreate: (d: Drawing) => void;
  onDrawingDelete: (id: string) => void;
}

interface PendingDrawing {
  type: 'trendline' | 'rect' | 'fib' | 'ruler';
  p1: DrawingPoint;
}

interface MousePos {
  time: number;
  price: number;
  x: number;
  y: number;
}

// ─── Safe runner ───────────────────────────────────────────────────────────────

function safe(fn: () => void, label = '') {
  try { fn(); } catch (e) { if (e) console.warn(`ChartWidget${label ? ` [${label}]` : ''}:`, e); }
}

// ─── Data helpers ──────────────────────────────────────────────────────────────

function toEpochSeconds(isoString: string): number {
  return Math.floor(new Date(isoString).getTime() / 1000);
}
function normalizeTime(isoString: string): Time {
  return toEpochSeconds(isoString) as Time;
}
function sanitizeBars(bars: Bar[]): Bar[] {
  const sorted = [...bars].sort((a, b) => toEpochSeconds(a.t) - toEpochSeconds(b.t));
  const seen = new Set<number>();
  return sorted.filter(b => {
    const ts = toEpochSeconds(b.t);
    if (seen.has(ts)) return false;
    seen.add(ts);
    return true;
  });
}

// ─── Coordinate helpers ────────────────────────────────────────────────────────

function getXY(
  chart: IChartApi,
  series: ISeriesApi<'Candlestick'>,
  pt: DrawingPoint,
): { x: number; y: number } | null {
  const x = chart.timeScale().timeToCoordinate(pt.time as Time);
  const y = series.priceToCoordinate(pt.price);
  if (x === null || y === null) return null;
  return { x, y };
}

function extendToBounds(
  x1: number, y1: number, x2: number, y2: number, W: number, H: number,
): [number, number, number, number] {
  const dx = x2 - x1, dy = y2 - y1;
  if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return [x1, y1, x2, y2];
  const ts: number[] = [];
  if (Math.abs(dx) > 0.01) { ts.push(-x1 / dx); ts.push((W - x1) / dx); }
  if (Math.abs(dy) > 0.01) { ts.push(-y1 / dy); ts.push((H - y1) / dy); }
  const valid = ts
    .filter(t => {
      const x = x1 + t * dx, y = y1 + t * dy;
      return x > -2 && x < W + 2 && y > -2 && y < H + 2;
    })
    .sort((a, b) => a - b);
  if (valid.length >= 2)
    return [x1 + valid[0] * dx, y1 + valid[0] * dy, x1 + valid[valid.length - 1] * dx, y1 + valid[valid.length - 1] * dy];
  return [x1, y1, x2, y2];
}

function lineDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.1) return Math.hypot(px - x1, py - y1);
  return Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / len;
}

function hitTest(
  d: Drawing, px: number, py: number,
  chart: IChartApi, series: ISeriesApi<'Candlestick'>,
  W: number, H: number, thr = 6,
): boolean {
  switch (d.type) {
    case 'hline': {
      const y = series.priceToCoordinate(d.price);
      return y !== null && Math.abs(py - y) < thr;
    }
    case 'vline': {
      const x = chart.timeScale().timeToCoordinate(d.time as Time);
      return x !== null && Math.abs(px - x) < thr;
    }
    case 'trendline': {
      const c1 = getXY(chart, series, d.p1);
      const c2 = getXY(chart, series, d.p2);
      if (!c1 || !c2) return false;
      const [ex1, ey1, ex2, ey2] = extendToBounds(c1.x, c1.y, c2.x, c2.y, W, H);
      return lineDist(px, py, ex1, ey1, ex2, ey2) < thr;
    }
    case 'rect': {
      const c1 = getXY(chart, series, d.p1);
      const c2 = getXY(chart, series, d.p2);
      if (!c1 || !c2) return false;
      const rx = Math.min(c1.x, c2.x), ry = Math.min(c1.y, c2.y);
      const rw = Math.abs(c2.x - c1.x), rh = Math.abs(c2.y - c1.y);
      const inX = px >= rx - thr && px <= rx + rw + thr;
      const inY = py >= ry - thr && py <= ry + rh + thr;
      if (!inX || !inY) return false;
      return px <= rx + thr || px >= rx + rw - thr || py <= ry + thr || py >= ry + rh - thr;
    }
    case 'ruler': {
      const c1 = getXY(chart, series, d.p1);
      const c2 = getXY(chart, series, d.p2);
      if (!c1 || !c2) return false;
      return (
        lineDist(px, py, c1.x, c1.y, c2.x, c1.y) < thr ||
        lineDist(px, py, c2.x, c1.y, c2.x, c2.y) < thr ||
        lineDist(px, py, c1.x, c1.y, c2.x, c2.y) < thr
      );
    }
    case 'fib': {
      return FIB_LEVELS.some(level => {
        const price = d.p1.price + level * (d.p2.price - d.p1.price);
        const y = series.priceToCoordinate(price);
        return y !== null && Math.abs(py - y) < thr;
      });
    }
    case 'text': {
      const c = getXY(chart, series, d.pos);
      return !!c && Math.abs(px - c.x) < 60 && Math.abs(py - c.y) < 16;
    }
  }
}

// ─── SVG shape renderers ───────────────────────────────────────────────────────

function renderShape(
  d: Drawing, chart: IChartApi, series: ISeriesApi<'Candlestick'>,
  W: number, H: number, opacity = 1,
): React.ReactNode {
  const op = opacity < 1 ? { opacity } : {};

  switch (d.type) {
    case 'hline': {
      const y = series.priceToCoordinate(d.price);
      if (y === null) return null;
      return (
        <g key={d.id} {...op}>
          <line x1={0} y1={y} x2={W} y2={y} stroke={d.color} strokeWidth="1.5" />
          <rect x={4} y={y - 14} width={60} height={14} fill="#131722cc" rx={2} />
          <text x={7} y={y - 3} fill={d.color} fontSize="10" fontFamily="monospace">
            {d.price.toFixed(2)}
          </text>
        </g>
      );
    }
    case 'vline': {
      const x = chart.timeScale().timeToCoordinate(d.time as Time);
      if (x === null) return null;
      return (
        <line key={d.id} x1={x} y1={0} x2={x} y2={H}
          stroke={d.color} strokeWidth="1.5" strokeDasharray="5 3" {...op} />
      );
    }
    case 'trendline': {
      const c1 = getXY(chart, series, d.p1);
      const c2 = getXY(chart, series, d.p2);
      if (!c1 || !c2) return null;
      const [ex1, ey1, ex2, ey2] = extendToBounds(c1.x, c1.y, c2.x, c2.y, W, H);
      return (
        <g key={d.id} {...op}>
          <line x1={ex1} y1={ey1} x2={ex2} y2={ey2} stroke={d.color} strokeWidth="1.5" />
          <circle cx={c1.x} cy={c1.y} r={3} fill={d.color} />
          <circle cx={c2.x} cy={c2.y} r={3} fill={d.color} />
        </g>
      );
    }
    case 'rect': {
      const c1 = getXY(chart, series, d.p1);
      const c2 = getXY(chart, series, d.p2);
      if (!c1 || !c2) return null;
      const rx = Math.min(c1.x, c2.x), ry = Math.min(c1.y, c2.y);
      const rw = Math.abs(c2.x - c1.x), rh = Math.abs(c2.y - c1.y);
      return (
        <rect key={d.id} x={rx} y={ry} width={rw} height={rh}
          stroke={d.color} strokeWidth="1.5" fill={d.color + '18'} {...op} />
      );
    }
    case 'ruler': {
      const c1 = getXY(chart, series, d.p1);
      const c2 = getXY(chart, series, d.p2);
      if (!c1 || !c2) return null;
      return renderRuler(d.id, c1, c2, d.p1, d.p2, d.color, op);
    }
    case 'fib': {
      const c1 = getXY(chart, series, d.p1);
      const c2 = getXY(chart, series, d.p2);
      if (!c1 || !c2) return null;
      return (
        <g key={d.id} {...op}>
          <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
            stroke={d.color} strokeWidth="1" strokeDasharray="4 2" opacity={0.4} />
          {FIB_LEVELS.map(level => {
            const price = d.p1.price + level * (d.p2.price - d.p1.price);
            const y = series.priceToCoordinate(price);
            if (y === null) return null;
            const col = FIB_COLORS[level.toString()] || d.color;
            return (
              <g key={level}>
                <line x1={0} y1={y} x2={W} y2={y}
                  stroke={col} strokeWidth="1"
                  strokeDasharray={level === 0 || level === 1 ? undefined : '4 2'}
                  opacity={0.85} />
                <rect x={W - 72} y={y - 13} width={70} height={14} fill="#131722bb" rx={2} />
                <text x={W - 70} y={y - 2} fill={col} fontSize="9" fontFamily="monospace">
                  {(level * 100).toFixed(1)}%  {price.toFixed(2)}
                </text>
              </g>
            );
          })}
        </g>
      );
    }
    case 'text': {
      const c = getXY(chart, series, d.pos);
      if (!c) return null;
      return (
        <text key={d.id} x={c.x} y={c.y} fill={d.color}
          fontSize="13" fontFamily="Inter, sans-serif" fontWeight="600"
          filter="url(#dropshadow)" {...op}>
          {d.text}
        </text>
      );
    }
  }
}

function renderRuler(
  id: string,
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  p1: DrawingPoint,
  p2: DrawingPoint,
  color: string,
  op: Record<string, number> = {},
): React.ReactNode {
  const priceDiff = p2.price - p1.price;
  const pct = p1.price !== 0 ? (priceDiff / p1.price) * 100 : 0;
  const isUp = priceDiff >= 0;
  const barColor = isUp ? '#26a69a' : '#ef5350';
  const bgColor = isUp ? '#26a69a22' : '#ef535022';

  const lx = Math.min(c1.x, c2.x);
  const rx = Math.max(c1.x, c2.x);
  const ty = Math.min(c1.y, c2.y);
  const by = Math.max(c1.y, c2.y);

  // Callout text
  const sign = isUp ? '+' : '';
  const line1 = `${sign}${priceDiff.toFixed(2)}`;
  const line2 = `${sign}${pct.toFixed(2)}%`;
  const w = Math.max(90, Math.max(line1.length, line2.length) * 7 + 16);
  const h = 36;
  const midX = (c1.x + c2.x) / 2;
  const midY = (c1.y + c2.y) / 2;
  const bx = Math.max(4, Math.min(midX - w / 2, 600 - w));
  const by2 = midY - h / 2;

  return (
    <g key={id} {...op}>
      {/* Shaded price range rectangle */}
      <rect x={lx} y={ty} width={rx - lx} height={by - ty}
        fill={bgColor} stroke={barColor} strokeWidth="1" strokeDasharray="4 2" />

      {/* Diagonal measurement line */}
      <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y}
        stroke={barColor} strokeWidth="1.5" />

      {/* Horizontal tick lines */}
      <line x1={c1.x - 4} y1={c1.y} x2={c1.x + 4} y2={c1.y}
        stroke={barColor} strokeWidth="1.5" />
      <line x1={c2.x - 4} y1={c2.y} x2={c2.x + 4} y2={c2.y}
        stroke={barColor} strokeWidth="1.5" />

      {/* Callout box */}
      <rect x={bx} y={by2} width={w} height={h} rx={4}
        fill="#1e222d" stroke={barColor} strokeWidth="1" />
      <text x={bx + w / 2} y={by2 + 14} fill={barColor}
        fontSize="12" fontFamily="monospace" fontWeight="700" textAnchor="middle">
        {line1}
      </text>
      <text x={bx + w / 2} y={by2 + 29} fill={barColor}
        fontSize="11" fontFamily="monospace" textAnchor="middle" opacity={0.85}>
        {line2}
      </text>
    </g>
  );
}

// ─── Preview renderers ────────────────────────────────────────────────────────

function renderPreview(
  pending: PendingDrawing, mouse: MousePos, color: string,
  chart: IChartApi, series: ISeriesApi<'Candlestick'>, W: number, H: number,
): React.ReactNode {
  const p2: DrawingPoint = { time: mouse.time, price: mouse.price };
  const preview = { ...pending, id: '__preview__', color, p2 } as unknown as Drawing;
  return renderShape(preview as Drawing, chart, series, W, H, 0.5);
}

// ─── Chart constants ──────────────────────────────────────────────────────────

const CHART_BG = '#131722';
const BASE_CHART_OPTIONS = {
  layout: {
    background: { type: ColorType.Solid, color: CHART_BG },
    textColor: '#d1d4dc', fontFamily: 'Inter, sans-serif',
  },
  grid: {
    vertLines: { color: '#2a2e39', style: 1 as const },
    horzLines: { color: '#2a2e39', style: 1 as const },
  },
  crosshair: {
    vertLine: { color: '#787b86', width: 1 as const, style: 3 as const, labelBackgroundColor: '#1e222d' },
    horzLine: { color: '#787b86', width: 1 as const, style: 3 as const, labelBackgroundColor: '#1e222d' },
  },
  timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
  rightPriceScale: { borderColor: '#2a2e39' },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ChartWidget({
  data, showRSI, showStoch, smaPeriod, emaPeriod,
  activeTool, activeColor, drawings, onDrawingCreate, onDrawingDelete,
}: ChartWidgetProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef   = useRef<HTMLDivElement>(null);
  const stochContainerRef = useRef<HTMLDivElement>(null);

  const mainChartRef  = useRef<IChartApi | null>(null);
  const rsiChartRef   = useRef<IChartApi | null>(null);
  const stochChartRef = useRef<IChartApi | null>(null);

  const candleRef  = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef  = useRef<ISeriesApi<'Histogram'> | null>(null);
  const smaRef     = useRef<ISeriesApi<'Line'> | null>(null);
  const emaRef     = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiRef     = useRef<ISeriesApi<'Line'> | null>(null);
  const stochKRef  = useRef<ISeriesApi<'Line'> | null>(null);
  const stochDRef  = useRef<ISeriesApi<'Line'> | null>(null);

  const [pending, setPending] = useState<PendingDrawing | null>(null);
  const [mousePos, setMousePos] = useState<MousePos | null>(null);
  const [textInput, setTextInput] = useState<{ pos: DrawingPoint; x: number; y: number; value: string } | null>(null);
  const [, forceRender] = useReducer((x: number) => x + 1, 0);

  // Stable refs for closure callbacks
  const activeToolRef    = useRef(activeTool);
  const activeColorRef   = useRef(activeColor);
  const drawingsRef      = useRef(drawings);
  const pendingRef       = useRef<PendingDrawing | null>(null);
  const onCreateRef      = useRef(onDrawingCreate);
  const onDeleteRef      = useRef(onDrawingDelete);

  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { activeColorRef.current = activeColor; }, [activeColor]);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  useEffect(() => { onCreateRef.current = onDrawingCreate; }, [onDrawingCreate]);
  useEffect(() => { onDeleteRef.current = onDrawingDelete; }, [onDrawingDelete]);

  // Reset pending when tool changes
  useEffect(() => {
    pendingRef.current = null;
    setPending(null);
    setTextInput(null);
  }, [activeTool]);

  // ── Main chart: init once ────────────────────────────────────────────────
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      ...BASE_CHART_OPTIONS,
      width: el.clientWidth,
      height: el.clientHeight,
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    });

    const volume = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    safe(() => chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } }), 'vol-scale');

    mainChartRef.current = chart;
    candleRef.current    = candle;
    volumeRef.current    = volume;

    // ── Resolve coordinates from a click event ──────────────────────────────
    // IMPORTANT: we get time from params.time when available (reliable even in gaps),
    // and fall back to coordinateToTime only as a secondary option.
    // Each tool only requires the coordinate(s) it actually needs.
    function resolveCoords(params: {
      point?: { x: number; y: number };
      time?: Time;
    }): { time: number | null; price: number | null; x: number; y: number } | null {
      if (!params.point) return null;
      const px = params.point.x;
      const py = params.point.y;

      // Time: prefer params.time (set by LWC even in gaps), fall back to coordinateToTime
      let time: number | null = null;
      if (params.time !== undefined && params.time !== null) {
        time = params.time as unknown as number;
      } else {
        const t = chart.timeScale().coordinateToTime(px);
        if (t !== null) time = t as unknown as number;
      }

      // Price: from the candle series scale
      const p = candle.coordinateToPrice(py);
      const price = p !== null ? p : null;

      return { time, price, x: px, y: py };
    }

    // ── Click handler ──────────────────────────────────────────────────────
    const clickHandler = (params: any) => {
      const tool = activeToolRef.current;
      const color = activeColorRef.current;
      if (tool === 'cursor') return;

      console.log('[TradingVue] chart click — tool:', tool, 'point:', params.point, 'time:', params.time);

      const coords = resolveCoords(params);
      if (!coords) {
        console.log('[TradingVue] resolveCoords returned null — click outside pane?');
        return;
      }
      const { time, price, x, y } = coords;
      console.log('[TradingVue] coords — time:', time, 'price:', price);

      // Eraser
      if (tool === 'eraser') {
        const W = el.clientWidth ?? 800;
        const H = el.clientHeight ?? 600;
        const hit = drawingsRef.current.find(d => hitTest(d, x, y, chart, candle, W, H));
        if (hit) onDeleteRef.current(hit.id);
        return;
      }

      // Text tool: needs price (to pin to price level)
      if (tool === 'text') {
        if (price === null) return;
        const pos: DrawingPoint = { time: time ?? 0, price };
        setTextInput({ pos, x, y, value: '' });
        return;
      }

      // Horizontal line: only needs price
      if (tool === 'hline') {
        if (price === null) { console.log('[TradingVue] hline skipped — price is null'); return; }
        const d = { id: uid(), type: 'hline' as const, color, price };
        console.log('[TradingVue] creating hline drawing:', d);
        onCreateRef.current(d);
        return;
      }

      // Vertical line: only needs time
      if (tool === 'vline') {
        if (time === null) return;
        onCreateRef.current({ id: uid(), type: 'vline', color, time });
        return;
      }

      // Two-point tools: need both
      if (tool === 'trendline' || tool === 'rect' || tool === 'fib' || tool === 'ruler') {
        // Use best available coords; for missing coord use a fallback
        const pt: DrawingPoint = {
          time: time ?? (pendingRef.current?.p1.time ?? 0),
          price: price ?? (pendingRef.current?.p1.price ?? 0),
        };

        if (pendingRef.current) {
          const { p1, type } = pendingRef.current;
          const id = uid();
          onCreateRef.current({ id, type, color, p1, p2: pt } as Drawing);
          pendingRef.current = null;
          setPending(null);
        } else {
          const p: PendingDrawing = { type: tool as PendingDrawing['type'], p1: pt };
          pendingRef.current = p;
          setPending(p);
        }
        return;
      }
    };

    // ── Crosshair move ────────────────────────────────────────────────────
    const moveHandler = (params: any) => {
      if (!params.point) { setMousePos(null); return; }
      const coords = resolveCoords(params);
      if (coords && (coords.time !== null || coords.price !== null)) {
        setMousePos({
          time: coords.time ?? 0,
          price: coords.price ?? 0,
          x: coords.x,
          y: coords.y,
        });
      }
    };

    // ── Right-click: delete in cursor mode ────────────────────────────────
    const contextHandler = (e: MouseEvent) => {
      if (activeToolRef.current !== 'cursor') return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const W = el.clientWidth;
      const H = el.clientHeight;
      const hit = drawingsRef.current.find(d => hitTest(d, px, py, chart, candle, W, H));
      if (hit) onDeleteRef.current(hit.id);
    };

    chart.subscribeClick(clickHandler);
    chart.subscribeCrosshairMove(moveHandler);
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => forceRender());
    el.addEventListener('contextmenu', contextHandler);

    const ro = new ResizeObserver(() => {
      if (!chartContainerRef.current) return;
      safe(() => chart.applyOptions({
        width: chartContainerRef.current!.clientWidth,
        height: chartContainerRef.current!.clientHeight,
      }), 'resize');
      forceRender();
    });
    ro.observe(el);

    // Trigger initial SVG render after chart is ready
    forceRender();

    return () => {
      ro.disconnect();
      chart.unsubscribeClick(clickHandler);
      chart.unsubscribeCrosshairMove(moveHandler);
      el.removeEventListener('contextmenu', contextHandler);
      safe(() => chart.remove(), 'chart-remove');
      mainChartRef.current = null;
      candleRef.current    = null;
      volumeRef.current    = null;
      smaRef.current       = null;
      emaRef.current       = null;
    };
  }, []);

  // ── RSI sub-chart ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showRSI || !rsiContainerRef.current) return;
    const el = rsiContainerRef.current;
    const rsiChart = createChart(el, {
      ...BASE_CHART_OPTIONS, width: el.clientWidth, height: el.clientHeight,
      timeScale: { ...BASE_CHART_OPTIONS.timeScale, visible: false },
    });
    const rsiLine = rsiChart.addSeries(LineSeries, { color: '#b22833', lineWidth: 2, priceLineVisible: false });
    safe(() => {
      rsiLine.createPriceLine({ price: 70, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OB' });
      rsiLine.createPriceLine({ price: 30, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OS' });
    });
    rsiChartRef.current = rsiChart;
    rsiRef.current      = rsiLine;
    const mainChart = mainChartRef.current;
    let syncMain: ((r: any) => void) | null = null;
    let syncRsi:  ((r: any) => void) | null = null;
    if (mainChart) {
      syncMain = (r: any) => safe(() => { if (r) rsiChart.timeScale().setVisibleLogicalRange(r); });
      syncRsi  = (r: any) => safe(() => { if (r) mainChart.timeScale().setVisibleLogicalRange(r); });
      safe(() => mainChart.timeScale().subscribeVisibleLogicalRangeChange(syncMain!));
      safe(() => rsiChart.timeScale().subscribeVisibleLogicalRangeChange(syncRsi!));
    }
    const ro = new ResizeObserver(() => {
      if (!rsiContainerRef.current) return;
      safe(() => rsiChart.applyOptions({ width: rsiContainerRef.current!.clientWidth, height: rsiContainerRef.current!.clientHeight }));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (mainChart && syncMain) safe(() => mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMain!));
      if (syncRsi) safe(() => rsiChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncRsi!));
      safe(() => rsiChart.remove());
      rsiChartRef.current = null; rsiRef.current = null;
    };
  }, [showRSI]);

  // ── Stochastic sub-chart ──────────────────────────────────────────────────
  useEffect(() => {
    if (!showStoch || !stochContainerRef.current) return;
    const el = stochContainerRef.current;
    const stochChart = createChart(el, {
      ...BASE_CHART_OPTIONS, width: el.clientWidth, height: el.clientHeight,
      timeScale: { ...BASE_CHART_OPTIONS.timeScale, visible: false },
    });
    const kLine = stochChart.addSeries(LineSeries, { color: '#26c6da', lineWidth: 2, priceLineVisible: false, title: '%K' });
    const dLine = stochChart.addSeries(LineSeries, { color: '#ff9800', lineWidth: 1, priceLineVisible: false, title: '%D', lineStyle: 2 });
    safe(() => {
      kLine.createPriceLine({ price: 80, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OB' });
      kLine.createPriceLine({ price: 20, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OS' });
    });
    stochChartRef.current = stochChart; stochKRef.current = kLine; stochDRef.current = dLine;
    const mainChart = mainChartRef.current;
    let syncMain: ((r: any) => void) | null = null;
    let syncStoch: ((r: any) => void) | null = null;
    if (mainChart) {
      syncMain  = (r: any) => safe(() => { if (r) stochChart.timeScale().setVisibleLogicalRange(r); });
      syncStoch = (r: any) => safe(() => { if (r) mainChart.timeScale().setVisibleLogicalRange(r); });
      safe(() => mainChart.timeScale().subscribeVisibleLogicalRangeChange(syncMain!));
      safe(() => stochChart.timeScale().subscribeVisibleLogicalRangeChange(syncStoch!));
    }
    const ro = new ResizeObserver(() => {
      if (!stochContainerRef.current) return;
      safe(() => stochChart.applyOptions({ width: stochContainerRef.current!.clientWidth, height: stochContainerRef.current!.clientHeight }));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (mainChart && syncMain)  safe(() => mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMain!));
      if (syncStoch)              safe(() => stochChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncStoch!));
      safe(() => stochChart.remove());
      stochChartRef.current = null; stochKRef.current = null; stochDRef.current = null;
    };
  }, [showStoch]);

  // ── Data + indicators ────────────────────────────────────────────────────
  useEffect(() => {
    const chart = mainChartRef.current, candle = candleRef.current, volume = volumeRef.current;
    if (!chart || !candle || !volume || !data.length) return;
    const bars = sanitizeBars(data);
    if (!bars.length) return;

    let ok = false;
    safe(() => {
      candle.setData(bars.map(b => ({
        time: normalizeTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c,
      })));
      ok = true;
    }, 'candle-setData');
    if (!ok) return;

    safe(() => {
      volume.setData(bars.map(b => ({
        time: normalizeTime(b.t), value: b.v,
        color: b.c >= b.o ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
      })));
    }, 'volume-setData');

    if (smaRef.current) { safe(() => chart.removeSeries(smaRef.current!)); smaRef.current = null; }
    if (smaPeriod) safe(() => {
      const s = chart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 2, title: `SMA ${smaPeriod}`, priceLineVisible: false });
      s.setData(calculateSMA(bars, smaPeriod).map(d => ({ time: normalizeTime(d.time as string), value: d.value })));
      smaRef.current = s;
    });

    if (emaRef.current) { safe(() => chart.removeSeries(emaRef.current!)); emaRef.current = null; }
    if (emaPeriod) safe(() => {
      const s = chart.addSeries(LineSeries, { color: '#ff9800', lineWidth: 2, title: `EMA ${emaPeriod}`, priceLineVisible: false });
      s.setData(calculateEMA(bars, emaPeriod).map(d => ({ time: normalizeTime(d.time as string), value: d.value })));
      emaRef.current = s;
    });

    if (showRSI && rsiRef.current && rsiChartRef.current) safe(() => {
      rsiRef.current!.setData(calculateRSI(bars, 14).map(d => ({ time: normalizeTime(d.time as string), value: d.value })));
      rsiChartRef.current!.timeScale().fitContent();
    });

    if (showStoch && stochKRef.current && stochDRef.current && stochChartRef.current) safe(() => {
      const sd = calculateStochastic(bars, 14, 3);
      stochKRef.current!.setData(sd.map(d => ({ time: normalizeTime(d.time), value: d.k })));
      stochDRef.current!.setData(sd.map(d => ({ time: normalizeTime(d.time), value: d.d })));
      stochChartRef.current!.timeScale().fitContent();
    });

    safe(() => chart.timeScale().fitContent(), 'fitContent');
  }, [data, showRSI, showStoch, smaPeriod, emaPeriod]);

  // ── Text input commit ──────────────────────────────────────────────────────
  const commitText = useCallback(() => {
    setTextInput(ti => {
      if (ti && ti.value.trim()) {
        onCreateRef.current({
          id: uid(), type: 'text',
          color: activeColorRef.current,
          pos: ti.pos, text: ti.value.trim(),
        });
      }
      return null;
    });
  }, []);

  // ── Cursor style ────────────────────────────────────────────────────────────
  const cursorStyle: React.CSSProperties = {
    cursor: activeTool === 'cursor' ? 'default'
          : activeTool === 'eraser' ? 'cell'
          : 'crosshair',
  };

  // ── Layout heights ──────────────────────────────────────────────────────────
  const indicatorCount = (showRSI ? 1 : 0) + (showStoch ? 1 : 0);
  const mainCls  = indicatorCount === 0 ? 'h-full' : indicatorCount === 1 ? 'h-[75%]' : 'h-[60%]';
  const panelCls = indicatorCount === 2 ? 'h-[20%]' : 'h-[25%]';

  // ── SVG drawing overlay ─────────────────────────────────────────────────────
  const chart  = mainChartRef.current;
  const candle = candleRef.current;
  const el     = chartContainerRef.current;
  const svgW   = el?.clientWidth  ?? 800;
  const svgH   = el?.clientHeight ?? 600;

  return (
    <div className="flex flex-col w-full h-full bg-[#131722] rounded-lg overflow-hidden" style={cursorStyle}>

      {/* ── Main candlestick pane ── */}
      <div className={`relative w-full ${mainCls}`}>
        <div ref={chartContainerRef} className="w-full h-full" />

        {/* SVG drawing overlay — pointer-events:none so chart gets all mouse events */}
        {chart && candle && (
          <svg
            className="absolute inset-0 w-full h-full overflow-visible"
            style={{ pointerEvents: 'none' }}
          >
            <defs>
              <filter id="dropshadow" x="-5%" y="-5%" width="130%" height="130%">
                <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.8" floodColor="#000" />
              </filter>
            </defs>

            {/* Committed drawings */}
            {drawings.map(d => renderShape(d, chart, candle, svgW, svgH))}

            {/* Pending two-point preview */}
            {pending && mousePos && renderPreview(pending, mousePos, activeColor, chart, candle, svgW, svgH)}

            {/* Ghost lines for single-click tools */}
            {!pending && mousePos && activeTool === 'hline' && (
              <line x1={0} y1={mousePos.y} x2={svgW} y2={mousePos.y}
                stroke={activeColor} strokeWidth="1" strokeDasharray="6 3" opacity={0.5} />
            )}
            {!pending && mousePos && activeTool === 'vline' && (
              <line x1={mousePos.x} y1={0} x2={mousePos.x} y2={svgH}
                stroke={activeColor} strokeWidth="1" strokeDasharray="6 3" opacity={0.5} />
            )}

            {/* Pending start-point dot */}
            {pending && mousePos && (
              <circle cx={mousePos.x} cy={mousePos.y} r={4}
                fill={activeColor} opacity={0.7} />
            )}
          </svg>
        )}

        {/* Text tool input */}
        {textInput && (
          <input
            autoFocus
            className="absolute z-30 bg-[#1e222d]/95 text-[#d1d4dc] border border-[#2962ff] px-1.5 py-0.5 text-sm font-mono outline-none rounded min-w-[80px]"
            style={{ left: textInput.x + 4, top: textInput.y - 28 }}
            placeholder="Type label…"
            value={textInput.value}
            onChange={e => setTextInput(ti => ti ? { ...ti, value: e.target.value } : null)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitText();
              if (e.key === 'Escape') setTextInput(null);
            }}
            onBlur={commitText}
          />
        )}
      </div>

      {/* ── RSI panel ── */}
      {showRSI && (
        <div className={`w-full ${panelCls} border-t border-[#2a2e39] flex flex-col`}>
          <div className="flex items-center gap-2 px-4 py-1 bg-[#1e222d] border-b border-[#2a2e39] text-xs text-[#787b86]">
            <span className="font-semibold text-[#b22833]">RSI</span><span>14</span>
          </div>
          <div ref={rsiContainerRef} className="w-full flex-grow" />
        </div>
      )}

      {/* ── Stochastic panel ── */}
      {showStoch && (
        <div className={`w-full ${panelCls} border-t border-[#2a2e39] flex flex-col`}>
          <div className="flex items-center gap-2 px-4 py-1 bg-[#1e222d] border-b border-[#2a2e39] text-xs text-[#787b86]">
            <span className="font-semibold text-[#26c6da]">Stoch</span>
            <span>14, 3</span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-0.5 bg-[#26c6da] rounded" />%K
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-0.5 bg-[#ff9800] rounded opacity-70" />%D
            </span>
          </div>
          <div ref={stochContainerRef} className="w-full flex-grow" />
        </div>
      )}
    </div>
  );
}
