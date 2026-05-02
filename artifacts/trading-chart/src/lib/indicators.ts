import type { Bar } from "@workspace/api-client-react";

interface IndicatorPoint {
  time: number | string;
  value: number;
}

export function calculateSMA(data: Bar[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].c;
    }
    result.push({
      time: data[i].t,
      value: sum / period,
    });
  }
  
  return result;
}

export function calculateEMA(data: Bar[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (data.length < period) return result;

  const k = 2 / (period + 1);
  
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].c;
  }
  let prevEma = sum / period;
  
  result.push({
    time: data[period - 1].t,
    value: prevEma,
  });

  for (let i = period; i < data.length; i++) {
    const currentClose = data[i].c;
    const currentEma = (currentClose - prevEma) * k + prevEma;
    result.push({
      time: data[i].t,
      value: currentEma,
    });
    prevEma = currentEma;
  }

  return result;
}

export function calculateRSI(data: Bar[], period: number = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (data.length <= period) return result;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = data[i].c - data[i - 1].c;
    if (change > 0) {
      avgGain += change;
    } else {
      avgLoss += Math.abs(change);
    }
  }

  avgGain /= period;
  avgLoss /= period;

  const rs = avgGain / avgLoss;
  let rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + rs));

  result.push({
    time: data[period].t,
    value: rsi,
  });

  for (let i = period + 1; i < data.length; i++) {
    const change = data[i].c - data[i - 1].c;
    let gain = 0;
    let loss = 0;

    if (change > 0) {
      gain = change;
    } else {
      loss = Math.abs(change);
    }

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;

    const currentRs = avgGain / avgLoss;
    const currentRsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + currentRs));

    result.push({
      time: data[i].t,
      value: currentRsi,
    });
  }

  return result;
}

/**
 * Detrended Price Oscillator (DPO)
 *   DPO(n, t) = Close[t − ⌊n/2⌋ − 1] − SMA(n, t)
 *
 * By shifting back ⌊n/2⌋ + 1 bars, DPO removes the dominant cycle from price
 * and highlights shorter-term price cycles around 0.
 * A positive DPO means the shifted close was above the current SMA (above trend);
 * negative means below trend.
 */
export function calculateDPO(data: Bar[], period: number = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  const shift = Math.floor(period / 2) + 1;

  for (let i = period - 1; i < data.length; i++) {
    const pastIndex = i - shift;
    if (pastIndex < 0) continue;

    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].c;
    }
    const sma = sum / period;

    result.push({
      time: data[i].t,
      value: data[pastIndex].c - sma,
    });
  }

  return result;
}
