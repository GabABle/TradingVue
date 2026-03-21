import type { Bar } from "@workspace/api-client-react";

export interface StochPoint {
  time: string;
  k: number;
  d: number;
}

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
    
    // Lightweight charts uses epoch seconds for daily+ or strings. 
    // We'll normalize to seconds or standard strings in the chart component, 
    // but pass through the raw 't' here to maintain sync.
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
  
  // Start with SMA for first EMA value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].c;
  }
  let prevEma = sum / period;
  
  // The first point is at index period-1
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

  // Initial average gain/loss
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

  // Smoothed RSI for rest of data
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
 * Stochastic Oscillator
 *   %K = (Close - LowestLow[kPeriod]) / (HighestHigh[kPeriod] - LowestLow[kPeriod]) * 100
 *   %D = dPeriod-bar SMA of %K  (signal line)
 */
export function calculateStochastic(
  data: Bar[],
  kPeriod: number = 14,
  dPeriod: number = 3,
): StochPoint[] {
  const result: StochPoint[] = [];
  if (data.length < kPeriod) return result;

  const rawK: number[] = [];
  for (let i = kPeriod - 1; i < data.length; i++) {
    let lowestLow   = data[i].l;
    let highestHigh = data[i].h;
    for (let j = 1; j < kPeriod; j++) {
      if (data[i - j].l < lowestLow)   lowestLow   = data[i - j].l;
      if (data[i - j].h > highestHigh) highestHigh = data[i - j].h;
    }
    const range = highestHigh - lowestLow;
    rawK.push(range === 0 ? 50 : ((data[i].c - lowestLow) / range) * 100);
  }

  for (let i = dPeriod - 1; i < rawK.length; i++) {
    let sum = 0;
    for (let j = 0; j < dPeriod; j++) sum += rawK[i - j];
    const dataIdx = kPeriod - 1 + i;
    result.push({ time: data[dataIdx].t, k: rawK[i], d: sum / dPeriod });
  }

  return result;
}
