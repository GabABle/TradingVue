import type { GetBarsTimeframe } from "@workspace/api-client-react";

export type RangeKey = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y";
export type IntervalKey = GetBarsTimeframe;

export interface IntervalOption {
  value: IntervalKey;
  label: string;
}

export interface RangeConfig {
  daysBack: number;
  intervals: IntervalKey[];
  defaultInterval: IntervalKey;
}

// Human-readable display labels for each bar interval
export const INTERVAL_LABELS: Record<IntervalKey, string> = {
  "1Min":  "1m",
  "5Min":  "5m",
  "15Min": "15m",
  "30Min": "30m",
  "1Hour": "1H",
  "4Hour": "4H",
  "1Day":  "D",
  "1Week": "W",
};

// Per-range config: how far back to fetch and which intervals make sense
export const RANGE_CONFIG: Record<RangeKey, RangeConfig> = {
  "1D": {
    daysBack: 1,
    intervals: ["1Min", "5Min", "15Min", "30Min"],
    defaultInterval: "5Min",
  },
  "1W": {
    daysBack: 7,
    intervals: ["5Min", "15Min", "30Min", "1Hour", "4Hour"],
    defaultInterval: "1Hour",
  },
  "1M": {
    daysBack: 30,
    intervals: ["15Min", "30Min", "1Hour", "4Hour", "1Day"],
    defaultInterval: "1Day",
  },
  "3M": {
    daysBack: 90,
    intervals: ["1Hour", "4Hour", "1Day"],
    defaultInterval: "1Day",
  },
  "6M": {
    daysBack: 180,
    intervals: ["4Hour", "1Day", "1Week"],
    defaultInterval: "1Day",
  },
  "1Y": {
    daysBack: 365,
    intervals: ["1Day", "1Week"],
    defaultInterval: "1Day",
  },
  "5Y": {
    daysBack: 1825,
    intervals: ["1Day", "1Week"],
    defaultInterval: "1Week",
  },
};

export const RANGE_LABELS: RangeKey[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"];

export function getRangeStart(range: RangeKey): string {
  const d = new Date();
  d.setDate(d.getDate() - RANGE_CONFIG[range].daysBack);
  return d.toISOString().split("T")[0];
}

/** When range changes, keep interval if still valid, otherwise use default */
export function resolveInterval(
  newRange: RangeKey,
  currentInterval: IntervalKey
): IntervalKey {
  const cfg = RANGE_CONFIG[newRange];
  return cfg.intervals.includes(currentInterval)
    ? currentInterval
    : cfg.defaultInterval;
}
