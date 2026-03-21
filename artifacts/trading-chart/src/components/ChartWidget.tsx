import { useEffect, useRef, useMemo } from 'react';
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

const normalizeTime = (isoString: string): Time => {
  return (new Date(isoString).getTime() / 1000) as Time;
};

const DARK_CHART_OPTIONS = {
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

  // Initialize main chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      ...DARK_CHART_OPTIONS,
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

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      mainChartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      smaSeriesRef.current = null;
      emaSeriesRef.current = null;
    };
  }, []);

  // Initialize / destroy RSI chart
  useEffect(() => {
    if (!showRSI || !rsiContainerRef.current || !mainChartRef.current) return;

    const rsiChart = createChart(rsiContainerRef.current, {
      ...DARK_CHART_OPTIONS,
      width: rsiContainerRef.current.clientWidth,
      height: rsiContainerRef.current.clientHeight,
      timeScale: {
        ...DARK_CHART_OPTIONS.timeScale,
        visible: false,
      },
    });

    const rsiLine = rsiChart.addSeries(LineSeries, {
      color: '#b22833',
      lineWidth: 2,
      priceLineVisible: false,
    });

    rsiLine.createPriceLine({ price: 70, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OB' });
    rsiLine.createPriceLine({ price: 30, color: '#787b86', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'OS' });

    rsiChartRef.current = rsiChart;
    rsiSeriesRef.current = rsiLine;

    const mainTS = mainChartRef.current.timeScale();
    const rsiTS = rsiChart.timeScale();

    const syncMain = (range: any) => { if (range) rsiTS.setVisibleLogicalRange(range); };
    const syncRsi = (range: any) => { if (range) mainTS.setVisibleLogicalRange(range); };

    mainTS.subscribeVisibleLogicalRangeChange(syncMain);
    rsiTS.subscribeVisibleLogicalRangeChange(syncRsi);

    const ro = new ResizeObserver(() => {
      if (rsiContainerRef.current) {
        rsiChart.applyOptions({ width: rsiContainerRef.current.clientWidth, height: rsiContainerRef.current.clientHeight });
      }
    });
    if (rsiContainerRef.current) ro.observe(rsiContainerRef.current);

    return () => {
      ro.disconnect();
      mainTS.unsubscribeVisibleLogicalRangeChange(syncMain);
      rsiTS.unsubscribeVisibleLogicalRangeChange(syncRsi);
      rsiChart.remove();
      rsiChartRef.current = null;
      rsiSeriesRef.current = null;
    };
  }, [showRSI]);

  // Update data on chart
  useEffect(() => {
    const chart = mainChartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volSeries || !data.length) return;

    const sorted = [...data].sort((a, b) => new Date(a.t).getTime() - new Date(b.t).getTime());

    const candleData = sorted.map(b => ({
      time: normalizeTime(b.t),
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));

    const volData = sorted.map(b => ({
      time: normalizeTime(b.t),
      value: b.v,
      color: b.c >= b.o ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
    }));

    candleSeries.setData(candleData);
    volSeries.setData(volData);

    // SMA
    if (smaPeriod) {
      if (!smaSeriesRef.current) {
        smaSeriesRef.current = chart.addSeries(LineSeries, {
          color: '#2962ff',
          lineWidth: 2,
          title: `SMA ${smaPeriod}`,
          priceLineVisible: false,
        });
      }
      const smaData = calculateSMA(sorted, smaPeriod).map(d => ({
        time: normalizeTime(d.time as string),
        value: d.value,
      }));
      smaSeriesRef.current.setData(smaData);
    } else if (smaSeriesRef.current) {
      chart.removeSeries(smaSeriesRef.current);
      smaSeriesRef.current = null;
    }

    // EMA
    if (emaPeriod) {
      if (!emaSeriesRef.current) {
        emaSeriesRef.current = chart.addSeries(LineSeries, {
          color: '#ff9800',
          lineWidth: 2,
          title: `EMA ${emaPeriod}`,
          priceLineVisible: false,
        });
      }
      const emaData = calculateEMA(sorted, emaPeriod).map(d => ({
        time: normalizeTime(d.time as string),
        value: d.value,
      }));
      emaSeriesRef.current.setData(emaData);
    } else if (emaSeriesRef.current) {
      chart.removeSeries(emaSeriesRef.current);
      emaSeriesRef.current = null;
    }

    // RSI
    const rsiSeries = rsiSeriesRef.current;
    if (showRSI && rsiSeries) {
      const rsiData = calculateRSI(sorted, 14).map(d => ({
        time: normalizeTime(d.time as string),
        value: d.value,
      }));
      rsiSeries.setData(rsiData);
    }

    chart.timeScale().fitContent();
    if (rsiChartRef.current) rsiChartRef.current.timeScale().fitContent();
  }, [data, showRSI, smaPeriod, emaPeriod, symbol]);

  return (
    <div className="flex flex-col w-full h-full bg-[#131722] rounded-lg overflow-hidden">
      <div
        ref={chartContainerRef}
        className={`w-full ${showRSI ? 'h-[75%]' : 'h-full'} transition-all duration-300`}
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
