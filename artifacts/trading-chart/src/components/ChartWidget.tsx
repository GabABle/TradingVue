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
  symbol: string;
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

/** Sort bars by timestamp ascending, then remove any duplicates (same second). */
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

const CHART_OPTIONS = {
  layout: {
    background: { type: ColorType.Solid, color: '#131722' },
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
  timeScale: {
    borderColor: '#2a2e39',
    timeVisible: true,
    secondsVisible: false,
  },
  rightPriceScale: {
    borderColor: '#2a2e39',
  },
};

export function ChartWidget({ data, symbol, showRSI, smaPeriod, emaPeriod }: ChartWidgetProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);

  const mainChartRef = useRef<IChartApi | null>(null);
  const rsiChartRef = useRef<IChartApi | null>(null);

  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Initialize main chart once
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      ...CHART_OPTIONS,
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderDownColor: '#ef5350',
      borderUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      wickUpColor: '#26a69a',
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    mainChartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volSeries;

    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    });
    ro.observe(chartContainerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      mainChartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      smaSeriesRef.current = null;
      emaSeriesRef.current = null;
    };
  }, []);

  // RSI sub-chart: create/destroy when showRSI toggles
  useEffect(() => {
    if (!showRSI || !rsiContainerRef.current) return;

    const rsiChart = createChart(rsiContainerRef.current, {
      ...CHART_OPTIONS,
      width: rsiContainerRef.current.clientWidth,
      height: rsiContainerRef.current.clientHeight,
      timeScale: { ...CHART_OPTIONS.timeScale, visible: false },
    });

    const rsiLine = rsiChart.addSeries(LineSeries, {
      color: '#b22833',
      lineWidth: 2,
      priceLineVisible: false,
    });

    try {
      rsiLine.createPriceLine({ price: 70, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OB' });
      rsiLine.createPriceLine({ price: 30, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OS' });
    } catch (_) { /* ignore */ }

    rsiChartRef.current = rsiChart;
    rsiSeriesRef.current = rsiLine;

    // Sync scroll with main chart
    const mainChart = mainChartRef.current;
    let syncMain: ((r: any) => void) | null = null;
    let syncRsi: ((r: any) => void) | null = null;

    if (mainChart) {
      const mainTS = mainChart.timeScale();
      const rsiTS = rsiChart.timeScale();
      syncMain = (r: any) => { try { if (r) rsiTS.setVisibleLogicalRange(r); } catch (_) {} };
      syncRsi = (r: any) => { try { if (r) mainTS.setVisibleLogicalRange(r); } catch (_) {} };
      mainTS.subscribeVisibleLogicalRangeChange(syncMain);
      rsiTS.subscribeVisibleLogicalRangeChange(syncRsi);
    }

    const ro = new ResizeObserver(() => {
      if (rsiContainerRef.current) {
        rsiChart.applyOptions({
          width: rsiContainerRef.current.clientWidth,
          height: rsiContainerRef.current.clientHeight,
        });
      }
    });
    if (rsiContainerRef.current) ro.observe(rsiContainerRef.current);

    return () => {
      ro.disconnect();
      if (mainChart && syncMain && syncRsi) {
        try {
          mainChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncMain);
          rsiChart.timeScale().unsubscribeVisibleLogicalRangeChange(syncRsi);
        } catch (_) {}
      }
      rsiChart.remove();
      rsiChartRef.current = null;
      rsiSeriesRef.current = null;
    };
  }, [showRSI]);

  // Update chart data whenever bars / indicator settings change
  useEffect(() => {
    const chart = mainChartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volSeries || !data.length) return;

    // Sanitize: sort ascending + deduplicate timestamps
    const bars = sanitizeBars(data);
    if (!bars.length) return;

    try {
      candleSeries.setData(
        bars.map((b) => ({
          time: normalizeTime(b.t),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        }))
      );
    } catch (e) {
      console.warn('ChartWidget: candleSeries.setData failed', e);
      return;
    }

    try {
      volSeries.setData(
        bars.map((b) => ({
          time: normalizeTime(b.t),
          value: b.v,
          color: b.c >= b.o ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
        }))
      );
    } catch (e) {
      console.warn('ChartWidget: volSeries.setData failed', e);
    }

    // SMA overlay
    if (smaPeriod) {
      try {
        if (!smaSeriesRef.current) {
          smaSeriesRef.current = chart.addSeries(LineSeries, {
            color: '#2962ff',
            lineWidth: 2,
            title: `SMA ${smaPeriod}`,
            priceLineVisible: false,
          });
        }
        smaSeriesRef.current.setData(
          calculateSMA(bars, smaPeriod).map((d) => ({
            time: normalizeTime(d.time as string),
            value: d.value,
          }))
        );
      } catch (e) {
        console.warn('ChartWidget: SMA setData failed', e);
      }
    } else if (smaSeriesRef.current) {
      try { chart.removeSeries(smaSeriesRef.current); } catch (_) {}
      smaSeriesRef.current = null;
    }

    // EMA overlay
    if (emaPeriod) {
      try {
        if (!emaSeriesRef.current) {
          emaSeriesRef.current = chart.addSeries(LineSeries, {
            color: '#ff9800',
            lineWidth: 2,
            title: `EMA ${emaPeriod}`,
            priceLineVisible: false,
          });
        }
        emaSeriesRef.current.setData(
          calculateEMA(bars, emaPeriod).map((d) => ({
            time: normalizeTime(d.time as string),
            value: d.value,
          }))
        );
      } catch (e) {
        console.warn('ChartWidget: EMA setData failed', e);
      }
    } else if (emaSeriesRef.current) {
      try { chart.removeSeries(emaSeriesRef.current); } catch (_) {}
      emaSeriesRef.current = null;
    }

    // RSI
    const rsiSeries = rsiSeriesRef.current;
    if (showRSI && rsiSeries) {
      try {
        rsiSeries.setData(
          calculateRSI(bars, 14).map((d) => ({
            time: normalizeTime(d.time as string),
            value: d.value,
          }))
        );
        if (rsiChartRef.current) rsiChartRef.current.timeScale().fitContent();
      } catch (e) {
        console.warn('ChartWidget: RSI setData failed', e);
      }
    }

    try {
      chart.timeScale().fitContent();
    } catch (_) {}
  }, [data, symbol, showRSI, smaPeriod, emaPeriod]);

  return (
    <div className="flex flex-col w-full h-full bg-[#131722] rounded-lg overflow-hidden">
      <div
        ref={chartContainerRef}
        className={`w-full transition-all duration-300 ${showRSI ? 'h-[75%]' : 'h-full'}`}
      />
      {showRSI && (
        <div className="w-full h-[25%] border-t border-[#2a2e39] flex flex-col">
          <div className="text-xs text-[#787b86] px-4 py-1 bg-[#1e222d] border-b border-[#2a2e39] flex items-center gap-2">
            <span className="font-semibold text-[#b22833]">RSI</span>
            <span>14</span>
          </div>
          <div ref={rsiContainerRef} className="w-full flex-grow" />
        </div>
      )}
    </div>
  );
}
