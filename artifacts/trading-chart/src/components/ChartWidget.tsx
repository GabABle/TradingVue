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
import { calculateSMA, calculateEMA, calculateRSI } from '@/lib/indicators';

interface ChartWidgetProps {
  data: Bar[];
  showRSI: boolean;
  smaPeriod: number | null;
  emaPeriod: number | null;
}

function toEpochSeconds(isoString: string): number {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

function normalizeTime(isoString: string): Time {
  return toEpochSeconds(isoString) as Time;
}

/** Sort bars ascending by timestamp and deduplicate same-second entries. */
function sanitizeBars(bars: Bar[]): Bar[] {
  const sorted = [...bars].sort(
    (a, b) => toEpochSeconds(a.t) - toEpochSeconds(b.t)
  );
  const seen = new Set<number>();
  return sorted.filter((b) => {
    const ts = toEpochSeconds(b.t);
    if (seen.has(ts)) return false;
    seen.add(ts);
    return true;
  });
}

/** Safe wrapper: call fn(), swallow anything lightweight-charts throws (strings, not Errors). */
function safe(fn: () => void, label = '') {
  try {
    fn();
  } catch (e) {
    if (e) console.warn(`ChartWidget${label ? ` [${label}]` : ''}: suppressed chart error`, e);
  }
}

const CHART_BG = '#131722';

const BASE_CHART_OPTIONS = {
  layout: {
    background: { type: ColorType.Solid, color: CHART_BG },
    textColor: '#d1d4dc',
    fontFamily: 'Inter, sans-serif',
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

export function ChartWidget({ data, showRSI, smaPeriod, emaPeriod }: ChartWidgetProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef   = useRef<HTMLDivElement>(null);

  const mainChartRef  = useRef<IChartApi | null>(null);
  const rsiChartRef   = useRef<IChartApi | null>(null);
  const candleRef     = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef     = useRef<ISeriesApi<'Histogram'> | null>(null);
  const smaRef        = useRef<ISeriesApi<'Line'> | null>(null);
  const emaRef        = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiRef        = useRef<ISeriesApi<'Line'> | null>(null);

  // ─── Main chart: init once per mount ────────────────────────────────────────
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

    // ResizeObserver — MUST be in try-catch; chart.applyOptions can throw a raw string
    const ro = new ResizeObserver(() => {
      if (!chartContainerRef.current) return;
      safe(() => chart.applyOptions({
        width: chartContainerRef.current!.clientWidth,
        height: chartContainerRef.current!.clientHeight,
      }), 'resize');
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      safe(() => chart.remove(), 'chart-remove');
      mainChartRef.current = null;
      candleRef.current    = null;
      volumeRef.current    = null;
      smaRef.current       = null;
      emaRef.current       = null;
    };
  }, []);

  // ─── RSI sub-chart: create / destroy when toggled ───────────────────────────
  useEffect(() => {
    if (!showRSI || !rsiContainerRef.current) return;
    const el = rsiContainerRef.current;

    const rsiChart = createChart(el, {
      ...BASE_CHART_OPTIONS,
      width: el.clientWidth,
      height: el.clientHeight,
      timeScale: { ...BASE_CHART_OPTIONS.timeScale, visible: false },
    });

    const rsiLine = rsiChart.addSeries(LineSeries, {
      color: '#b22833', lineWidth: 2, priceLineVisible: false,
    });
    safe(() => {
      rsiLine.createPriceLine({ price: 70, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OB' });
      rsiLine.createPriceLine({ price: 30, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OS' });
    }, 'rsi-price-lines');

    rsiChartRef.current = rsiChart;
    rsiRef.current      = rsiLine;

    // Sync scroll with main chart
    const mainChart = mainChartRef.current;
    let syncMain: ((r: any) => void) | null = null;
    let syncRsi:  ((r: any) => void) | null = null;

    if (mainChart) {
      syncMain = (r: any) => safe(() => { if (r) rsiChart.timeScale().setVisibleLogicalRange(r); });
      syncRsi  = (r: any) => safe(() => { if (r) mainChart.timeScale().setVisibleLogicalRange(r); });
      safe(() => mainChart.timeScale().subscribeVisibleLogicalRangeChange(syncMain!));
      safe(() => rsiChart.timeScale().subscribeVisibleLogicalRangeChange(syncRsi!));
    }

    // ResizeObserver for RSI panel — also wrapped
    const ro = new ResizeObserver(() => {
      if (!rsiContainerRef.current) return;
      safe(() => rsiChart.applyOptions({
        width: rsiContainerRef.current!.clientWidth,
        height: rsiContainerRef.current!.clientHeight,
      }), 'rsi-resize');
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      if (mainChart && syncMain) safe(() => mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMain!));
      if (syncRsi)               safe(() => rsiChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncRsi!));
      safe(() => rsiChart.remove(), 'rsi-remove');
      rsiChartRef.current = null;
      rsiRef.current      = null;
    };
  }, [showRSI]);

  // ─── Data + indicators: runs when data or indicator settings change ──────────
  useEffect(() => {
    const chart  = mainChartRef.current;
    const candle = candleRef.current;
    const volume = volumeRef.current;
    if (!chart || !candle || !volume || !data.length) return;

    const bars = sanitizeBars(data);
    if (!bars.length) return;

    // Candle data
    let candleOk = false;
    safe(() => {
      candle.setData(bars.map((b) => ({
        time: normalizeTime(b.t),
        open: b.o, high: b.h, low: b.l, close: b.c,
      })));
      candleOk = true;
    }, 'candle-setData');
    if (!candleOk) return; // chart is in bad state; bail out

    // Volume data
    safe(() => {
      volume.setData(bars.map((b) => ({
        time: normalizeTime(b.t),
        value: b.v,
        color: b.c >= b.o ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
      })));
    }, 'volume-setData');

    // SMA overlay — always remove & recreate to avoid stale-series state
    if (smaRef.current) {
      safe(() => chart.removeSeries(smaRef.current!), 'sma-remove');
      smaRef.current = null;
    }
    if (smaPeriod) {
      safe(() => {
        const s = chart.addSeries(LineSeries, {
          color: '#2962ff', lineWidth: 2,
          title: `SMA ${smaPeriod}`, priceLineVisible: false,
        });
        s.setData(calculateSMA(bars, smaPeriod).map((d) => ({
          time: normalizeTime(d.time as string), value: d.value,
        })));
        smaRef.current = s;
      }, 'sma-setData');
    }

    // EMA overlay — same pattern
    if (emaRef.current) {
      safe(() => chart.removeSeries(emaRef.current!), 'ema-remove');
      emaRef.current = null;
    }
    if (emaPeriod) {
      safe(() => {
        const s = chart.addSeries(LineSeries, {
          color: '#ff9800', lineWidth: 2,
          title: `EMA ${emaPeriod}`, priceLineVisible: false,
        });
        s.setData(calculateEMA(bars, emaPeriod).map((d) => ({
          time: normalizeTime(d.time as string), value: d.value,
        })));
        emaRef.current = s;
      }, 'ema-setData');
    }

    // RSI
    if (showRSI && rsiRef.current && rsiChartRef.current) {
      safe(() => {
        rsiRef.current!.setData(calculateRSI(bars, 14).map((d) => ({
          time: normalizeTime(d.time as string), value: d.value,
        })));
        rsiChartRef.current!.timeScale().fitContent();
      }, 'rsi-setData');
    }

    safe(() => chart.timeScale().fitContent(), 'fitContent');
  }, [data, showRSI, smaPeriod, emaPeriod]);

  return (
    <div className="flex flex-col w-full h-full bg-[#131722] rounded-lg overflow-hidden">
      <div
        ref={chartContainerRef}
        className={`w-full ${showRSI ? 'h-[75%]' : 'h-full'}`}
      />
      {showRSI && (
        <div className="w-full h-[25%] border-t border-[#2a2e39] flex flex-col">
          <div className="flex items-center gap-2 px-4 py-1 bg-[#1e222d] border-b border-[#2a2e39] text-xs text-[#787b86]">
            <span className="font-semibold text-[#b22833]">RSI</span>
            <span>14</span>
          </div>
          <div ref={rsiContainerRef} className="w-full flex-grow" />
        </div>
      )}
    </div>
  );
}
