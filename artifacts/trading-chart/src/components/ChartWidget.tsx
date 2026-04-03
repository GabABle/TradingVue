import { useEffect, useRef } from 'react';
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

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChartWidgetProps {
  data: Bar[];
  showRSI: boolean;
  showStoch: boolean;
  smaPeriod: number | null;
  emaPeriod: number | null;
  referencePrice?: number | null;
  extPrice?: number | null;
  extSession?: "pre" | "after" | null;
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
  data, showRSI, showStoch, smaPeriod, emaPeriod, referencePrice, extPrice, extSession,
}: ChartWidgetProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef   = useRef<HTMLDivElement>(null);
  const stochContainerRef = useRef<HTMLDivElement>(null);

  const mainChartRef  = useRef<IChartApi | null>(null);
  const rsiChartRef   = useRef<IChartApi | null>(null);
  const stochChartRef = useRef<IChartApi | null>(null);

  const candleRef   = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef   = useRef<ISeriesApi<'Histogram'> | null>(null);
  const smaRef      = useRef<ISeriesApi<'Line'> | null>(null);
  const emaRef      = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiRef      = useRef<ISeriesApi<'Line'> | null>(null);
  const stochKRef   = useRef<ISeriesApi<'Line'> | null>(null);
  const stochDRef   = useRef<ISeriesApi<'Line'> | null>(null);

  const pmPriceLineRef  = useRef<any>(null);
  const extPriceLineRef = useRef<any>(null);

  // ── Data maps for crosshair sync ─────────────────────────────────────────
  const barsMapRef      = useRef<Map<number, number>>(new Map()); // time → close
  const rsiDataMapRef   = useRef<Map<number, number>>(new Map()); // time → RSI value
  const stochKDataMapRef= useRef<Map<number, number>>(new Map()); // time → %K value

  // Prevents circular crosshair sync callbacks
  const isSyncingCrosshairRef = useRef(false);

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

    let rafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!chartContainerRef.current) return;
        safe(() => chart.applyOptions({
          width: chartContainerRef.current!.clientWidth,
          height: chartContainerRef.current!.clientHeight,
        }), 'resize');
      });
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
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
    const color = '#f59e0b';
    const title = extSession === "after" ? 'AH' : 'PRE';
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

  // ── RSI sub-chart ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showRSI || !rsiContainerRef.current) return;
    const el = rsiContainerRef.current;
    const rsiChart = createChart(el, {
      ...BASE_CHART_OPTIONS,
      width: el.clientWidth,
      height: el.clientHeight,
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

    // ── Time-scale sync (zoom/pan) ───────────────────────────────────────
    let syncMain: ((r: any) => void) | null = null;
    let syncRsi:  ((r: any) => void) | null = null;
    if (mainChart) {
      syncMain = (r: any) => safe(() => { if (r) rsiChart.timeScale().setVisibleLogicalRange(r); });
      syncRsi  = (r: any) => safe(() => { if (r) mainChart.timeScale().setVisibleLogicalRange(r); });
      safe(() => mainChart.timeScale().subscribeVisibleLogicalRangeChange(syncMain!));
      safe(() => rsiChart.timeScale().subscribeVisibleLogicalRangeChange(syncRsi!));
    }

    // ── Crosshair sync ───────────────────────────────────────────────────
    let unsubMainCursor: (() => void) | null = null;
    let unsubRsiCursor:  (() => void) | null = null;

    if (mainChart) {
      // Main → RSI: when main chart cursor moves, show cursor on RSI at same time
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

      // RSI → Main + Stoch: when RSI cursor moves, sync to main (and stoch if open)
      const onRsiMove = (params: any) => {
        if (isSyncingCrosshairRef.current) return;
        isSyncingCrosshairRef.current = true;
        try {
          if (params.time && params.point !== undefined) {
            const closePrice = barsMapRef.current.get(params.time as number);
            if (closePrice !== undefined && candleRef.current) {
              safe(() => mainChart.setCrosshairPosition(closePrice, params.time, candleRef.current!));
            }
            const stochVal = stochKDataMapRef.current.get(params.time as number);
            if (stochVal !== undefined && stochKRef.current && stochChartRef.current) {
              safe(() => stochChartRef.current!.setCrosshairPosition(stochVal, params.time, stochKRef.current!));
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
      if (mainChart && syncMain) safe(() => mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMain!));
      if (syncRsi) safe(() => rsiChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncRsi!));
      safe(() => rsiChart.remove());
      rsiChartRef.current = null;
      rsiRef.current      = null;
    };
  }, [showRSI]);

  // ── Stochastic sub-chart ──────────────────────────────────────────────────
  useEffect(() => {
    if (!showStoch || !stochContainerRef.current) return;
    const el = stochContainerRef.current;
    const stochChart = createChart(el, {
      ...BASE_CHART_OPTIONS,
      width: el.clientWidth,
      height: el.clientHeight,
      timeScale: { ...BASE_CHART_OPTIONS.timeScale, visible: false },
    });
    const kLine = stochChart.addSeries(LineSeries, { color: '#26c6da', lineWidth: 2, priceLineVisible: false, title: '%K' });
    const dLine = stochChart.addSeries(LineSeries, { color: '#ff9800', lineWidth: 1, priceLineVisible: false, title: '%D', lineStyle: 2 });
    safe(() => {
      kLine.createPriceLine({ price: 80, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OB' });
      kLine.createPriceLine({ price: 20, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OS' });
    });
    stochChartRef.current = stochChart;
    stochKRef.current     = kLine;
    stochDRef.current     = dLine;

    const mainChart = mainChartRef.current;

    // ── Time-scale sync ──────────────────────────────────────────────────
    let syncMain:  ((r: any) => void) | null = null;
    let syncStoch: ((r: any) => void) | null = null;
    if (mainChart) {
      syncMain  = (r: any) => safe(() => { if (r) stochChart.timeScale().setVisibleLogicalRange(r); });
      syncStoch = (r: any) => safe(() => { if (r) mainChart.timeScale().setVisibleLogicalRange(r); });
      safe(() => mainChart.timeScale().subscribeVisibleLogicalRangeChange(syncMain!));
      safe(() => stochChart.timeScale().subscribeVisibleLogicalRangeChange(syncStoch!));
    }

    // ── Crosshair sync ───────────────────────────────────────────────────
    let unsubMainCursor:  (() => void) | null = null;
    let unsubStochCursor: (() => void) | null = null;

    if (mainChart) {
      // Main → Stoch
      const onMainMove = (params: any) => {
        if (isSyncingCrosshairRef.current) return;
        isSyncingCrosshairRef.current = true;
        try {
          if (!params.time || params.point === undefined) {
            safe(() => stochChart.clearCrosshairPosition());
          } else {
            const val = stochKDataMapRef.current.get(params.time as number);
            if (val !== undefined) safe(() => stochChart.setCrosshairPosition(val, params.time, kLine));
          }
        } finally {
          isSyncingCrosshairRef.current = false;
        }
      };
      safe(() => mainChart.subscribeCrosshairMove(onMainMove));
      unsubMainCursor = () => safe(() => mainChart.unsubscribeCrosshairMove(onMainMove));

      // Stoch → Main + RSI
      const onStochMove = (params: any) => {
        if (isSyncingCrosshairRef.current) return;
        isSyncingCrosshairRef.current = true;
        try {
          if (params.time && params.point !== undefined) {
            const closePrice = barsMapRef.current.get(params.time as number);
            if (closePrice !== undefined && candleRef.current) {
              safe(() => mainChart.setCrosshairPosition(closePrice, params.time, candleRef.current!));
            }
            const rsiVal = rsiDataMapRef.current.get(params.time as number);
            if (rsiVal !== undefined && rsiRef.current && rsiChartRef.current) {
              safe(() => rsiChartRef.current!.setCrosshairPosition(rsiVal, params.time, rsiRef.current!));
            }
          }
        } finally {
          isSyncingCrosshairRef.current = false;
        }
      };
      safe(() => stochChart.subscribeCrosshairMove(onStochMove));
      unsubStochCursor = () => safe(() => stochChart.unsubscribeCrosshairMove(onStochMove));
    }

    // ── Resize observer ──────────────────────────────────────────────────
    let stochRafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(stochRafId);
      stochRafId = requestAnimationFrame(() => {
        if (!stochContainerRef.current) return;
        safe(() => stochChart.applyOptions({ width: stochContainerRef.current!.clientWidth, height: stochContainerRef.current!.clientHeight }));
      });
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(stochRafId);
      ro.disconnect();
      unsubMainCursor?.();
      unsubStochCursor?.();
      if (mainChart && syncMain)  safe(() => mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMain!));
      if (syncStoch)              safe(() => stochChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncStoch!));
      safe(() => stochChart.remove());
      stochChartRef.current = null;
      stochKRef.current     = null;
      stochDRef.current     = null;
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

    // ── Populate data maps for crosshair sync ───────────────────────────
    const newBarsMap = new Map<number, number>();
    bars.forEach(b => newBarsMap.set(toEpochSeconds(b.t), b.c));
    barsMapRef.current = newBarsMap;

    // ── SMA / EMA ───────────────────────────────────────────────────────
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

    // ── RSI ─────────────────────────────────────────────────────────────
    if (showRSI && rsiRef.current && rsiChartRef.current) safe(() => {
      const rsiValues = calculateRSI(bars, 14);
      rsiRef.current!.setData(rsiValues.map(d => ({ time: normalizeTime(d.time as string), value: d.value })));
      rsiChartRef.current!.timeScale().fitContent();
      // Update crosshair data map
      const newRsiMap = new Map<number, number>();
      rsiValues.forEach(d => newRsiMap.set(toEpochSeconds(d.time as string), d.value));
      rsiDataMapRef.current = newRsiMap;
    });

    // ── Stochastic ──────────────────────────────────────────────────────
    if (showStoch && stochKRef.current && stochDRef.current && stochChartRef.current) safe(() => {
      const sd = calculateStochastic(bars, 14, 3);
      stochKRef.current!.setData(sd.map(d => ({ time: normalizeTime(d.time), value: d.k })));
      stochDRef.current!.setData(sd.map(d => ({ time: normalizeTime(d.time), value: d.d })));
      stochChartRef.current!.timeScale().fitContent();
      // Update crosshair data map
      const newStochMap = new Map<number, number>();
      sd.forEach(d => newStochMap.set(toEpochSeconds(d.time), d.k));
      stochKDataMapRef.current = newStochMap;
    });

    safe(() => chart.timeScale().fitContent(), 'fitContent');
  }, [data, showRSI, showStoch, smaPeriod, emaPeriod]);

  // ── Layout heights ──────────────────────────────────────────────────────────
  const indicatorCount = (showRSI ? 1 : 0) + (showStoch ? 1 : 0);
  const mainCls  = indicatorCount === 0 ? 'h-full' : indicatorCount === 1 ? 'h-[75%]' : 'h-[60%]';
  const panelCls = indicatorCount === 2 ? 'h-[20%]' : 'h-[25%]';

  return (
    <div className="flex flex-col w-full h-full bg-[#131722] rounded-lg overflow-hidden">

      {/* ── Main candlestick pane ── */}
      <div className={`relative w-full ${mainCls}`}>
        <div ref={chartContainerRef} className="w-full h-full" />
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
