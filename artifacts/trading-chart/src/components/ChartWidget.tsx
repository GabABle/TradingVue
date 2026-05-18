import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import type { Bar } from "@workspace/api-client-react";
import { calculateSMA, calculateEMA, calculateRSI, calculateDPO } from '@/lib/indicators';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveBar {
  t: string;
  o: number; h: number; l: number; c: number; v: number;
}

interface ChartWidgetProps {
  data: Bar[];
  timeframe: string;
  timezone: string;
  showRSI: boolean;
  showDPO: boolean;
  smaPeriod: number | null;
  emaPeriod: number | null;
  referencePrice?: number | null;
  extPrice?: number | null;
  extSession?: "pre" | "after" | null;
  liveBar?: LiveBar | null;
}

// ─── Safe runner ───────────────────────────────────────────────────────────────

function safe(fn: () => void, label = '') {
  try { fn(); } catch (e) { if (e) console.warn(`ChartWidget${label ? ` [${label}]` : ''}:`, e); }
}

// ─── Data helpers ──────────────────────────────────────────────────────────────

function toEpochSeconds(isoString: string): number {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

// Extract 'YYYY-MM-DD' — works for any ISO string regardless of timezone.
// e.g. '2026-05-01T04:00:00.000Z' → '2026-05-01'
function toDateString(isoString: string): string {
  return isoString.slice(0, 10);
}

// Daily/weekly bars → 'YYYY-MM-DD' BusinessDay string (timezone-independent,
// shows only the date on the x-axis — exactly like TradingView).
// Intraday bars    → Unix epoch seconds (LightweightCharts UTCTimestamp).
function normalizeTime(isoString: string, isDaily: boolean): Time {
  return (isDaily ? toDateString(isoString) : toEpochSeconds(isoString)) as unknown as Time;
}

// Map key that matches what LightweightCharts stores as params.time in callbacks.
function timeMapKey(isoString: string, isDaily: boolean): string | number {
  return isDaily ? toDateString(isoString) : toEpochSeconds(isoString);
}

function sanitizeBars(bars: Bar[], isDaily: boolean): Bar[] {
  // ISO strings sort lexicographically, which is correct for dates/timestamps
  const sorted = [...bars].sort((a, b) => a.t.localeCompare(b.t));
  const seen = new Set<string | number>();
  return sorted.filter(b => {
    const k = timeMapKey(b.t, isDaily);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ─── Timezone formatters ─────────────────────────────────────────────────────

function makeTickMarkFormatter(tz: string) {
  return (time: Time, tickMarkType: TickMarkType, _locale: string): string | null => {
    if (typeof time === 'string') {
      const [y, m, d] = (time as string).split('-').map(Number);
      const utc = new Date(Date.UTC(y, m - 1, d));
      if (tickMarkType === TickMarkType.Year)       return String(y);
      if (tickMarkType === TickMarkType.Month)      return utc.toLocaleDateString('en-US', { month: 'short' });
      return utc.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    const date = new Date((time as number) * 1000);
    switch (tickMarkType) {
      case TickMarkType.Year:
        return new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(date);
      case TickMarkType.Month:
        return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', year: 'numeric' }).format(date);
      case TickMarkType.DayOfMonth:
        return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(date);
      case TickMarkType.Time:
        return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
      default:
        return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
    }
  };
}

function makeTimeFormatter(tz: string) {
  return (time: Time): string => {
    if (typeof time === 'string') return time as string;
    const date = new Date((time as number) * 1000);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(date);
  };
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
    mode: CrosshairMode.Normal,
    vertLine: { color: '#787b86', width: 1 as const, style: 3 as const, labelBackgroundColor: '#1e222d' },
    horzLine: { color: '#787b86', width: 1 as const, style: 3 as const, labelBackgroundColor: '#1e222d' },
  },
  timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
  rightPriceScale: { borderColor: '#2a2e39' },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ChartWidget({
  data, timeframe, timezone, showRSI, showDPO, smaPeriod, emaPeriod, referencePrice, extPrice, extSession, liveBar,
}: ChartWidgetProps) {
  // Daily/weekly bars use BusinessDay ('YYYY-MM-DD') strings — timezone-independent.
  // Intraday bars use UTCTimestamp (Unix epoch seconds) — renders in browser local time.
  const isDaily = timeframe === '1Day' || timeframe === '1Week';
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef   = useRef<HTMLDivElement>(null);

  const mainChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef  = useRef<IChartApi | null>(null);

  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const smaRef    = useRef<ISeriesApi<'Line'> | null>(null);
  const emaRef    = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiRef    = useRef<ISeriesApi<'Line'> | null>(null);
  const dpoRef    = useRef<ISeriesApi<'Line'> | null>(null);

  const pmPriceLineRef  = useRef<any>(null);
  const extPriceLineRef = useRef<any>(null);

  // ── Data maps for crosshair sync ─────────────────────────────────────────
  // Key is string ('YYYY-MM-DD') for daily/weekly, number (epoch seconds) for intraday.
  const barsMapRef    = useRef<Map<string | number, number>>(new Map()); // time → close
  const rsiDataMapRef = useRef<Map<string | number, number>>(new Map()); // time → RSI value

  // Prevents circular crosshair sync callbacks
  const isSyncingCrosshairRef = useRef(false);
  // Prevents circular time-scale sync callbacks (shared across ALL sync handlers)
  const isSyncingRangeRef = useRef(false);

  // Bar-count difference between main data and RSI data.
  // RSI(14) first value at bar 14 → offset=14. DPO(14) also starts at bar 14.
  // When syncing ranges we subtract the offset so the same TIMESTAMPS land at the
  // same visual x-position across all panels (and the crosshair vertical lines align).
  const rsiOffsetRef = useRef(14);

  // Track showDPO in a ref so the RSI init effect can read the current value without
  // being re-run every time showDPO changes (we toggle visibility separately).
  const showDPORef = useRef(showDPO);
  useEffect(() => { showDPORef.current = showDPO; }, [showDPO]);

  // Keep a ref to the current timezone so RSI effect can read it at mount time.
  // (ChartWidget remounts when timezone changes — see key in TradingTerminal —
  //  so this ref always holds the correct value at createChart time.)
  const timezoneRef = useRef(timezone);

  // ── Right-click context menu ──────────────────────────────────────────────
  type CtxPanel = 'main' | 'rsi';
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; panel: CtxPanel } | null>(null);

  const openCtxMenu = useCallback((e: React.MouseEvent, panel: CtxPanel) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, panel });
  }, []);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // Dismiss on any outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCtxMenu(); };
    document.addEventListener('mousedown', closeCtxMenu);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', closeCtxMenu);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu, closeCtxMenu]);

  const ctxActions = useCallback((panel: CtxPanel) => {
    const main = mainChartRef.current;
    const rsi  = rsiChartRef.current;
    const target = panel === 'rsi' ? rsi : main;
    return [
      {
        label: 'Auto scale price',
        shortcut: 'A',
        action: () => {
          if (target) safe(() => target.priceScale('right').applyOptions({ autoScale: true }), 'ctx-auto');
          // volume overlay scale
          if (main && panel === 'main') safe(() => main.priceScale('volume').applyOptions({ autoScale: true }), 'ctx-vol');
        },
      },
      {
        label: 'Fit all data',
        shortcut: 'Alt+F',
        action: () => {
          if (main) safe(() => main.timeScale().fitContent(), 'ctx-fit');
        },
      },
      {
        label: 'Scroll to latest',
        shortcut: 'End',
        action: () => {
          if (main) safe(() => main.timeScale().scrollToRealTime(), 'ctx-latest');
        },
      },
      null, // separator
      {
        label: 'Reset all scales',
        shortcut: '',
        action: () => {
          if (main) {
            safe(() => main.priceScale('right').applyOptions({ autoScale: true }), 'ctx-rst-main');
            safe(() => main.priceScale('volume').applyOptions({ autoScale: true }), 'ctx-rst-vol');
            safe(() => main.timeScale().fitContent(), 'ctx-rst-time');
          }
          if (rsi) safe(() => rsi.priceScale('right').applyOptions({ autoScale: true }), 'ctx-rst-rsi');
        },
      },
    ] as const;
  }, []);

  // ── Main chart: init once ────────────────────────────────────────────────
  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;

    let chart: IChartApi;
    let candle: ISeriesApi<'Candlestick'>;
    let volume: ISeriesApi<'Histogram'>;

    try {
      chart = createChart(el, {
        ...BASE_CHART_OPTIONS,
        width: el.clientWidth || 600,
        height: el.clientHeight || 400,
        timeScale: {
          ...BASE_CHART_OPTIONS.timeScale,
          tickMarkFormatter: makeTickMarkFormatter(timezoneRef.current),
        },
        localization: { timeFormatter: makeTimeFormatter(timezoneRef.current) } as any,
      });

      candle = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a', downColor: '#ef5350',
        borderUpColor: '#26a69a', borderDownColor: '#ef5350',
        wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      });

      volume = chart.addSeries(HistogramSeries, {
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      safe(() => chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } }), 'vol-scale');
    } catch (err) {
      console.warn('ChartWidget [init]:', err);
      return;
    }

    mainChartRef.current = chart;
    candleRef.current    = candle!;
    volumeRef.current    = volume!;

    // ── Primary range sync: main → sub-charts ────────────────────────────
    // Fires on every zoom AND pan. Reads sub-chart refs dynamically so it
    // works regardless of when RSI/Stoch panels are mounted.
    // The callback receives the new logical range directly — use it with
    // setVisibleLogicalRange so the sync always works regardless of zoom level.
    // (getVisibleRange returns null when zoomed out past data bounds, which
    // caused the zoom-out sync to silently no-op with the previous approach.)
    const onMainRangeChange = (lr: any) => {
      if (isSyncingRangeRef.current || !lr) return;
      isSyncingRangeRef.current = true;
      const ro = rsiOffsetRef.current;
      if (rsiChartRef.current)
        safe(() => rsiChartRef.current!.timeScale().setVisibleLogicalRange({ from: lr.from - ro, to: lr.to - ro }), 'range-rsi');
      isSyncingRangeRef.current = false;
    };
    safe(() => chart.timeScale().subscribeVisibleLogicalRangeChange(onMainRangeChange), 'range-sub');

    let rafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!chartContainerRef.current) return;
        safe(() => chart.applyOptions({
          width: chartContainerRef.current!.clientWidth,
          height: chartContainerRef.current!.clientHeight,
        }), 'resize');
        // Keep RSI chart's right price-scale at least as wide as main's so the
        // two time-axes are pixel-aligned (crosshair vertical lines overlap).
        const rc = rsiChartRef.current;
        if (rc) safe(() => {
          const w = chart.priceScale('right').width();
          if (w > 0) rc.applyOptions({ rightPriceScale: { minimumWidth: w } });
        }, 'scale-sync-resize');
      });
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      safe(() => chart.timeScale().unsubscribeVisibleLogicalRangeChange(onMainRangeChange), 'range-unsub');
      safe(() => chart.remove(), 'chart-remove');
      mainChartRef.current = null;
      candleRef.current    = null;
      volumeRef.current    = null;
      smaRef.current       = null;
      emaRef.current       = null;
    };
  }, []);

  // ── Reference price line ─────────────────────────────────────────────────
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    if (pmPriceLineRef.current) {
      safe(() => series.removePriceLine(pmPriceLineRef.current!), 'ref-line-remove');
      pmPriceLineRef.current = null;
    }
    if (referencePrice == null) return;
    safe(() => {
      pmPriceLineRef.current = series.createPriceLine({
        price: referencePrice,
        color: '#d1d4dc',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Close',
      });
    }, 'ref-line-create');
  }, [referencePrice]);

  // ── Extended-hours price line ────────────────────────────────────────────
  useEffect(() => {
    const series = candleRef.current;
    if (!series) return;
    if (extPriceLineRef.current) {
      safe(() => series.removePriceLine(extPriceLineRef.current!), 'ext-line-remove');
      extPriceLineRef.current = null;
    }
    if (extPrice == null) return;
    const color = extSession === 'after' ? '#818cf8' : '#f59e0b';
    const title = extSession === 'after' ? 'AH' : 'PRE';
    safe(() => {
      extPriceLineRef.current = series.createPriceLine({
        price: extPrice,
        color,
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title,
      });
    }, 'ext-line-create');
  }, [extPrice, extSession]);

  // ── Live bar: update/append the forming candle in real time ─────────────────
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle || !liveBar) return;
    safe(() => {
      candle.update({
        time:  normalizeTime(liveBar.t, isDaily),
        open:  liveBar.o,
        high:  liveBar.h,
        low:   liveBar.l,
        close: liveBar.c,
      });
    }, 'live-update');
  }, [liveBar, isDaily]);

  // ── RSI sub-chart ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showRSI || !rsiContainerRef.current) return;
    const el = rsiContainerRef.current;
    const rsiChart = createChart(el, {
      ...BASE_CHART_OPTIONS,
      width: el.clientWidth,
      height: el.clientHeight,
      leftPriceScale: { visible: false },
      timeScale: {
        ...BASE_CHART_OPTIONS.timeScale,
        visible: false,
        tickMarkFormatter: makeTickMarkFormatter(timezoneRef.current),
      },
      localization: { timeFormatter: makeTimeFormatter(timezoneRef.current) } as any,
    });

    // RSI line on the default right price scale (0–100)
    const rsiLine = rsiChart.addSeries(LineSeries, {
      color: '#b22833', lineWidth: 2, priceLineVisible: false, priceScaleId: 'right',
    });
    safe(() => {
      rsiLine.createPriceLine({ price: 70, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OB' });
      rsiLine.createPriceLine({ price: 30, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OS' });
    });

    // DPO line overlaid on the same chart using the left price scale (auto-range around 0)
    const dpoLine = rsiChart.addSeries(LineSeries, {
      color: '#e040fb', lineWidth: 1, priceLineVisible: false, priceScaleId: 'left',
      visible: showDPORef.current,
    });
    // Zero line on the DPO scale
    safe(() => {
      dpoLine.createPriceLine({ price: 0, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
    });

    rsiChartRef.current = rsiChart;
    rsiRef.current      = rsiLine;
    dpoRef.current      = dpoLine;

    const mainChart = mainChartRef.current;

    // ── Reverse range sync: RSI → main ────────────────────────────────────
    let onRsiRangeChange: ((lr: any) => void) | null = null;
    if (mainChart) {
      onRsiRangeChange = (lr: any) => {
        if (isSyncingRangeRef.current || !lr) return;
        isSyncingRangeRef.current = true;
        const ro = rsiOffsetRef.current;
        safe(() => mainChart.timeScale().setVisibleLogicalRange({ from: lr.from + ro, to: lr.to + ro }), 'rsi-range-main');
        isSyncingRangeRef.current = false;
      };
      safe(() => rsiChart.timeScale().subscribeVisibleLogicalRangeChange(onRsiRangeChange!), 'rsi-range-sub');
    }

    // ── Crosshair sync ───────────────────────────────────────────────────
    let unsubMainCursor: (() => void) | null = null;
    let unsubRsiCursor:  (() => void) | null = null;

    if (mainChart) {
      // Main → RSI
      const onMainMove = (params: any) => {
        if (isSyncingCrosshairRef.current) return;
        isSyncingCrosshairRef.current = true;
        try {
          if (!params.time || params.point === undefined) {
            safe(() => rsiChart.clearCrosshairPosition());
          } else {
            const val = rsiDataMapRef.current.get(params.time as number);
            if (val !== undefined) safe(() => rsiChart.setCrosshairPosition(val, params.time, rsiLine));
          }
        } finally {
          isSyncingCrosshairRef.current = false;
        }
      };
      safe(() => mainChart.subscribeCrosshairMove(onMainMove));
      unsubMainCursor = () => safe(() => mainChart.unsubscribeCrosshairMove(onMainMove));

      // RSI → Main
      const onRsiMove = (params: any) => {
        if (isSyncingCrosshairRef.current) return;
        isSyncingCrosshairRef.current = true;
        try {
          if (params.time && params.point !== undefined) {
            const closePrice = barsMapRef.current.get(params.time as number);
            if (closePrice !== undefined && candleRef.current) {
              safe(() => mainChart.setCrosshairPosition(closePrice, params.time, candleRef.current!));
            }
          }
        } finally {
          isSyncingCrosshairRef.current = false;
        }
      };
      safe(() => rsiChart.subscribeCrosshairMove(onRsiMove));
      unsubRsiCursor = () => safe(() => rsiChart.unsubscribeCrosshairMove(onRsiMove));
    }

    // ── Resize observer ──────────────────────────────────────────────────
    let rsiRafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rsiRafId);
      rsiRafId = requestAnimationFrame(() => {
        if (!rsiContainerRef.current) return;
        safe(() => rsiChart.applyOptions({ width: rsiContainerRef.current!.clientWidth, height: rsiContainerRef.current!.clientHeight }));
      });
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(rsiRafId);
      ro.disconnect();
      unsubMainCursor?.();
      unsubRsiCursor?.();
      if (onRsiRangeChange) safe(() => rsiChart.timeScale().unsubscribeVisibleLogicalRangeChange(onRsiRangeChange!), 'rsi-range-unsub');
      safe(() => rsiChart.remove());
      rsiChartRef.current = null;
      rsiRef.current      = null;
      dpoRef.current      = null;
    };
  }, [showRSI]);

  // ── DPO visibility toggle (series already lives on the RSI chart) ──────────
  useEffect(() => {
    if (dpoRef.current) safe(() => dpoRef.current!.applyOptions({ visible: showDPO }));
  }, [showDPO]);

  // ── Data + indicators ────────────────────────────────────────────────────
  useEffect(() => {
    const chart = mainChartRef.current, candle = candleRef.current, volume = volumeRef.current;
    if (!chart || !candle || !volume || !data.length) return;
    const bars = sanitizeBars(data, isDaily);
    if (!bars.length) return;

    // Update timeScale.timeVisible: daily/weekly shows only dates, intraday shows HH:MM too
    safe(() => chart.applyOptions({ timeScale: { timeVisible: !isDaily } }), 'timeVisible');

    let ok = false;
    safe(() => {
      candle.setData(bars.map(b => ({
        time: normalizeTime(b.t, isDaily), open: b.o, high: b.h, low: b.l, close: b.c,
      })));
      ok = true;
    }, 'candle-setData');
    if (!ok) return;

    safe(() => {
      volume.setData(bars.map(b => ({
        time: normalizeTime(b.t, isDaily), value: b.v,
        color: b.c >= b.o ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
      })));
    }, 'volume-setData');

    // ── Populate data maps for crosshair sync ───────────────────────────
    const newBarsMap = new Map<string | number, number>();
    bars.forEach(b => newBarsMap.set(timeMapKey(b.t, isDaily), b.c));
    barsMapRef.current = newBarsMap;

    // ── SMA / EMA ───────────────────────────────────────────────────────
    if (smaRef.current) { safe(() => chart.removeSeries(smaRef.current!)); smaRef.current = null; }
    if (smaPeriod) safe(() => {
      const s = chart.addSeries(LineSeries, { color: '#2962ff', lineWidth: 2, title: `SMA ${smaPeriod}`, priceLineVisible: false });
      s.setData(calculateSMA(bars, smaPeriod).map(d => ({ time: normalizeTime(d.time as string, isDaily), value: d.value })));
      smaRef.current = s;
    });

    if (emaRef.current) { safe(() => chart.removeSeries(emaRef.current!)); emaRef.current = null; }
    if (emaPeriod) safe(() => {
      const s = chart.addSeries(LineSeries, { color: '#ff9800', lineWidth: 2, title: `EMA ${emaPeriod}`, priceLineVisible: false });
      s.setData(calculateEMA(bars, emaPeriod).map(d => ({ time: normalizeTime(d.time as string, isDaily), value: d.value })));
      emaRef.current = s;
    });

    // ── RSI + DPO (always calculate both; DPO visibility toggled separately) ──
    const rsiValues = calculateRSI(bars, 14);
    rsiOffsetRef.current = bars.length - rsiValues.length; // = 14
    if (showRSI && rsiRef.current && rsiChartRef.current) safe(() => {
      rsiRef.current!.setData(rsiValues.map(d => ({ time: normalizeTime(d.time as string, isDaily), value: d.value })));
      const newRsiMap = new Map<string | number, number>();
      rsiValues.forEach(d => newRsiMap.set(timeMapKey(d.time as string, isDaily), d.value));
      rsiDataMapRef.current = newRsiMap;
    });

    if (showRSI && dpoRef.current && rsiChartRef.current) safe(() => {
      const dpoValues = calculateDPO(bars, 14);
      dpoRef.current!.setData(dpoValues.map(d => ({ time: normalizeTime(d.time as string, isDaily), value: d.value })));
      rsiChartRef.current!.timeScale().fitContent();
    });

    safe(() => chart.timeScale().fitContent(), 'fitContent');

    // Sync right price-scale width: RSI labels ("65.3") are narrower than main
    // chart labels ("$175.50"), shifting the plot area right and misaligning the
    // vertical crosshair. Force RSI's scale to be at least as wide as main's.
    if (showRSI) {
      requestAnimationFrame(() => {
        const mc = mainChartRef.current, rc = rsiChartRef.current;
        if (mc && rc) safe(() => {
          const w = mc.priceScale('right').width();
          if (w > 0) rc.applyOptions({ rightPriceScale: { minimumWidth: w } });
        }, 'scale-sync-data');
      });
    }
  }, [data, isDaily, showRSI, smaPeriod, emaPeriod]);

  // ── Layout heights ──────────────────────────────────────────────────────────
  const mainCls  = showRSI ? 'h-[75%]' : 'h-full';
  const panelCls = 'h-[25%]';

  // ── Context menu items built at render time ────────────────────────────────
  const menuItems = ctxMenu ? ctxActions(ctxMenu.panel) : [];

  // Clamp menu so it never overflows the viewport
  const menuW = 220;
  const menuH = 160; // approximate
  const menuLeft = ctxMenu ? Math.min(ctxMenu.x, window.innerWidth  - menuW - 8) : 0;
  const menuTop  = ctxMenu ? Math.min(ctxMenu.y, window.innerHeight - menuH - 8) : 0;

  return (
    <div className="flex flex-col w-full h-full bg-[#131722] rounded-lg overflow-hidden">

      {/* ── Main candlestick pane ── */}
      <div
        className={`relative w-full ${mainCls}`}
        onContextMenu={(e) => openCtxMenu(e, 'main')}
      >
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>

      {/* ── RSI + DPO panel ── */}
      {showRSI && (
        <div
          className={`w-full ${panelCls} border-t border-[#2a2e39] flex flex-col`}
          onContextMenu={(e) => openCtxMenu(e, 'rsi')}
        >
          <div className="flex items-center gap-3 px-4 py-1 bg-[#1e222d] border-b border-[#2a2e39] text-xs text-[#787b86]">
            <span className="flex items-center gap-1">
              <span className="font-semibold text-[#b22833]">RSI</span>
              <span>14</span>
            </span>
            {showDPO && (
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 bg-[#e040fb] rounded" />
                <span className="font-semibold text-[#e040fb]">DPO</span>
                <span>14</span>
              </span>
            )}
          </div>
          <div ref={rsiContainerRef} className="w-full flex-grow" />
        </div>
      )}

      {/* ── Right-click context menu ── */}
      {ctxMenu && (
        <div
          className="fixed z-[9999] min-w-[200px] rounded-md border border-[#2a2e39] bg-[#1e222d] shadow-2xl py-1 text-sm"
          style={{ left: menuLeft, top: menuTop }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* panel label */}
          <div className="px-3 py-1 text-[10px] font-semibold tracking-widest uppercase text-[#4c525e] border-b border-[#2a2e39] mb-1">
            {ctxMenu.panel === 'rsi' ? 'RSI / DPO Panel' : 'Price Chart'}
          </div>

          {menuItems.map((item, i) =>
            item === null ? (
              <div key={i} className="my-1 border-t border-[#2a2e39]" />
            ) : (
              <button
                key={item.label}
                className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[#2962ff]/20 text-[#d1d4dc] hover:text-white transition-colors text-left"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  item.action();
                  closeCtxMenu();
                }}
              >
                <span>{item.label}</span>
                {item.shortcut && (
                  <span className="ml-6 text-[11px] text-[#4c525e] font-mono">{item.shortcut}</span>
                )}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
