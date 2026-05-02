import { Router, type IRouter, type Request, type Response } from "express";
import WebSocket from "ws";
import { optionalAuth } from "../lib/auth-middleware.js";

const router: IRouter = Router();

const ALPACA_API_KEY    = process.env.ALPACA_API_KEY;
const ALPACA_API_SECRET = process.env.ALPACA_API_SECRET;
const POLYGON_API_KEY   = process.env.POLYGON_API_KEY ?? "";

const DATA_BASE_URL = "https://data.alpaca.markets/v2";
const DATA_V1B3_URL = "https://data.alpaca.markets/v1beta3";
const POLY          = "https://api.polygon.io";

function alpacaHeaders() {
  return {
    "APCA-API-KEY-ID":     ALPACA_API_KEY    ?? "",
    "APCA-API-SECRET-KEY": ALPACA_API_SECRET ?? "",
    Accept: "application/json",
  };
}

function polyUrl(path: string, params: Record<string, string> = {}): string {
  const p = new URLSearchParams({ ...params, apiKey: POLYGON_API_KEY });
  return `${POLY}${path}?${p.toString()}`;
}

// ── Market session detection (US Eastern Time) ────────────────────────────────
type MarketSession = "pre" | "regular" | "after" | "closed";

function getMarketSession(): MarketSession {
  const now   = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const year  = now.getUTCFullYear();
  const dstStart = nthSundayOfMonth(year, 2, 2);
  const dstEnd   = nthSundayOfMonth(year, 10, 1);
  const isDST    = now >= dstStart && now < dstEnd;
  const etDate   = new Date(utcMs + (isDST ? -4 : -5) * 3_600_000);

  const day = etDate.getDay();
  if (day === 0 || day === 6) return "closed";
  const minutes = etDate.getHours() * 60 + etDate.getMinutes();
  if (minutes < 4 * 60)      return "closed";
  if (minutes < 9 * 60 + 30) return "pre";
  if (minutes < 16 * 60)     return "regular";
  if (minutes < 20 * 60)     return "after";
  return "closed";
}

function getForexSession(): "regular" | "closed" {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 6) return "closed";
  if (day === 0) return now.getUTCHours() >= 21 ? "regular" : "closed";
  if (day === 5) return now.getUTCHours() < 22  ? "regular" : "closed";
  return "regular";
}

function nthSundayOfMonth(year: number, month: number, n: number): Date {
  const d = new Date(Date.UTC(year, month, 1));
  const firstSunday = (7 - d.getUTCDay()) % 7;
  return new Date(Date.UTC(year, month, 1 + firstSunday + (n - 1) * 7, 7, 0, 0));
}

// ── Polygon timeframe mapping ──────────────────────────────────────────────────
function mapTimeframeToPolygon(tf: string): { multiplier: string; timespan: string } {
  switch (tf) {
    case "1Min":  return { multiplier: "1",  timespan: "minute" };
    case "5Min":  return { multiplier: "5",  timespan: "minute" };
    case "15Min": return { multiplier: "15", timespan: "minute" };
    case "30Min": return { multiplier: "30", timespan: "minute" };
    case "1Hour": return { multiplier: "1",  timespan: "hour"   };
    case "4Hour": return { multiplier: "4",  timespan: "hour"   };
    case "1Day":  return { multiplier: "1",  timespan: "day"    };
    case "1Week": return { multiplier: "1",  timespan: "week"   };
    default:      return { multiplier: "1",  timespan: "day"    };
  }
}

// ── Default date ranges ───────────────────────────────────────────────────────
function getDefaultStart(timeframe: string): string {
  const now = new Date();
  let daysBack = 365;
  if      (timeframe === "1Min")  daysBack = 3;
  else if (timeframe === "5Min")  daysBack = 7;
  else if (timeframe === "15Min") daysBack = 14;
  else if (timeframe === "30Min") daysBack = 21;
  else if (timeframe === "1Hour") daysBack = 60;
  else if (timeframe === "4Hour") daysBack = 180;
  else if (timeframe === "1Day")  daysBack = 730;
  else if (timeframe === "1Week") daysBack = 1825;
  now.setDate(now.getDate() - daysBack);
  return now.toISOString().split("T")[0];
}

// ── Polygon stock bars (free: /v2/aggs/range) ─────────────────────────────────
async function fetchPolygonStockBars(
  symbol: string, timeframe: string, startDate: string, limit: number
): Promise<any[]> {
  const { multiplier, timespan } = mapTimeframeToPolygon(timeframe);
  const today = new Date().toISOString().split("T")[0];

  const params: Record<string, string> = {
    adjusted: "true",
    sort:     "asc",
    limit:    "50000",   // always request max; we slice the tail to get the most recent `limit` bars
  };
  if (timespan === "minute" || timespan === "hour") {
    params["extended_hours"] = "true";
  }

  const url = polyUrl(
    `/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${startDate}/${today}`,
    params
  );

  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Polygon bars ${r.status}: ${txt}`);
  }
  const data = await r.json() as any;
  if (data.status === "NOT_AUTHORIZED") {
    throw new Error(`Polygon not authorized: ${data.message}`);
  }
  const results: any[] = data.results ?? [];
  return results
    .map((b: any) => ({ t: new Date(b.t).toISOString(), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 }))
    .slice(-limit);
}

// ── Polygon crypto bars (free: X:BTCUSD ticker format) ───────────────────────
async function fetchPolygonCryptoBars(
  symbol: string, timeframe: string, startDate: string, limit: number
): Promise<any[]> {
  // symbol is like "BTC/USD" — Polygon needs "X:BTCUSD"
  const clean  = symbol.replace("/", "");
  const ticker = `X:${clean}`;
  const { multiplier, timespan } = mapTimeframeToPolygon(timeframe);
  const today  = new Date().toISOString().split("T")[0];

  const url = polyUrl(
    `/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${startDate}/${today}`,
    { adjusted: "true", sort: "asc", limit: "50000" }
  );

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Polygon crypto bars ${r.status}`);
  const data = await r.json() as any;
  if (data.status === "NOT_AUTHORIZED") throw new Error("Polygon crypto not authorized");
  const results: any[] = data.results ?? [];
  return results
    .map((b: any) => ({ t: new Date(b.t).toISOString(), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 }))
    .slice(-limit);
}

// ── Alpaca stock snapshot (for real-time quotes — still free & reliable) ──────
async function fetchAlpacaStockSnapshot(symbol: string): Promise<{
  price: number; open: number; high: number; low: number; volume: number;
  prevClose: number; todayClose: number | null; timestamp: string;
} | null> {
  const r = await fetch(`${DATA_BASE_URL}/stocks/${symbol}/snapshot`, { headers: alpacaHeaders() });
  if (!r.ok) return null;
  const snap = await r.json() as any;

  const price      = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;
  const prevClose  = snap.prevDailyBar?.c ?? snap.dailyBar?.o ?? price;
  const todayClose = snap.dailyBar?.c ?? null;

  return {
    price,
    open:      snap.dailyBar?.o ?? 0,
    high:      snap.dailyBar?.h ?? 0,
    low:       snap.dailyBar?.l ?? 0,
    volume:    snap.dailyBar?.v ?? 0,
    prevClose,
    todayClose,
    timestamp: snap.latestTrade?.t ?? snap.dailyBar?.t ?? new Date().toISOString(),
  };
}

// ── Alpaca crypto snapshot ────────────────────────────────────────────────────
async function fetchAlpacaCryptoSnapshot(symbol: string): Promise<{
  price: number; open: number; high: number; low: number; volume: number;
  prevClose: number; timestamp: string;
} | null> {
  const cryptoSymbol = normalizeCryptoSymbol(symbol);
  const url  = `${DATA_V1B3_URL}/crypto/us/snapshots?symbols=${encodeURIComponent(cryptoSymbol)}`;
  const r    = await fetch(url, { headers: alpacaHeaders() });
  if (!r.ok) return null;
  const data = await r.json() as any;
  const snap = data.snapshots?.[cryptoSymbol];
  if (!snap) return null;

  const price     = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;
  const prevClose = snap.prevDailyBar?.c ?? snap.dailyBar?.o ?? price;

  return {
    price,
    open:      snap.dailyBar?.o ?? 0,
    high:      snap.dailyBar?.h ?? 0,
    low:       snap.dailyBar?.l ?? 0,
    volume:    snap.dailyBar?.v ?? 0,
    prevClose,
    timestamp: snap.latestTrade?.t ?? snap.dailyBar?.t ?? new Date().toISOString(),
  };
}

// ── Alpaca IEX bars for stock intraday (free, real-time) ─────────────────────
// Polygon free tier does NOT support intraday stock aggs for recent dates.
// Alpaca IEX is free and real-time for intraday stock bars.
const ALPACA_INTRADAY_TF = new Set(["1Min", "5Min", "15Min", "30Min", "1Hour", "4Hour"]);

async function fetchAlpacaStockBars(
  symbol: string, timeframe: string, startDate: string, limit: number
): Promise<any[]> {
  const params = new URLSearchParams({
    timeframe,
    start: startDate,
    limit:      String(limit),
    adjustment: "raw",
    feed:       "iex",
  });
  const url = `${DATA_BASE_URL}/stocks/${symbol}/bars?${params}`;
  const r   = await fetch(url, { headers: alpacaHeaders() });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Alpaca bars ${r.status}: ${txt}`);
  }
  const data = await r.json() as any;
  const bars: any[] = data.bars ?? [];
  return bars.map((b: any) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 }));
}

// ── /market/bars ──────────────────────────────────────────────────────────────
// Routing strategy (maximises quality on free tiers):
//   Stock intraday  (1m–4h)  → Alpaca IEX (real-time, free)
//   Stock daily/weekly       → Polygon    (adjusted, accurate OHLCV)
//   Crypto all timeframes    → Polygon    (intraday works on free tier)
//   Futures                  → Yahoo Finance (unchanged)
//   Forex                    → Frankfurter/ECB (unchanged)
router.get("/market/bars", async (req, res) => {
  try {
    const { symbol, timeframe, start, limit = "500" } = req.query as Record<string, string>;
    if (!symbol || !timeframe) {
      res.status(400).json({ error: "Bad Request", message: "symbol and timeframe are required" });
      return;
    }

    const upperSymbol = symbol.toUpperCase();
    const isFutures   = isFuturesSymbol(upperSymbol);
    const isForex     = !isFutures && isForexSymbol(upperSymbol);
    const isCrypto    = !isFutures && !isForex && isCryptoSymbol(upperSymbol);
    const startDate   = start || getDefaultStart(timeframe);
    const limitNum    = parseInt(limit, 10);

    if (isFutures) {
      const bars = await fetchYahooFuturesBars(normalizeFuturesSymbol(upperSymbol), timeframe, startDate, limitNum);
      res.set("Cache-Control", "no-cache");
      res.json({ symbol: upperSymbol, bars, nextPageToken: null });
      return;
    }

    if (isForex) {
      const bars = await fetchForexBars(upperSymbol, startDate, limitNum);
      res.set("Cache-Control", "no-cache");
      res.json({ symbol: upperSymbol, bars, nextPageToken: null });
      return;
    }

    if (isCrypto) {
      // Polygon free tier supports crypto intraday
      const cryptoSymbol = normalizeCryptoSymbol(upperSymbol);
      const bars = await fetchPolygonCryptoBars(cryptoSymbol, timeframe, startDate, limitNum);
      res.set("Cache-Control", "no-cache");
      res.json({ symbol: upperSymbol, bars, nextPageToken: null });
      return;
    }

    // Stock: route by timeframe
    let bars: any[];
    if (ALPACA_INTRADAY_TF.has(timeframe)) {
      // Intraday → Alpaca IEX (Polygon free tier blocks recent intraday stock data)
      bars = await fetchAlpacaStockBars(upperSymbol, timeframe, startDate, limitNum);
    } else {
      // Daily / Weekly → Polygon (adjusted, exchange-accurate OHLCV)
      bars = await fetchPolygonStockBars(upperSymbol, timeframe, startDate, limitNum);
    }

    res.set("Cache-Control", "no-cache");
    res.json({ symbol: upperSymbol, bars, nextPageToken: null });

  } catch (err: any) {
    req.log.error({ err }, "Error fetching bars");
    res.status(500).json({ error: "Internal Server Error", message: err?.message ?? "Failed to fetch bars" });
  }
});

// ── /market/quote ─────────────────────────────────────────────────────────────
// Quotes stay on Alpaca snapshots (free, real-time latestTrade)
// Polygon snapshot/last-trade endpoints require a paid plan
router.get("/market/quote", async (req, res) => {
  try {
    const { symbol } = req.query as Record<string, string>;
    if (!symbol) {
      res.status(400).json({ error: "Bad Request", message: "symbol is required" });
      return;
    }

    const upperSymbol = symbol.toUpperCase();
    const isFutures   = isFuturesSymbol(upperSymbol);
    const isForex     = !isFutures && isForexSymbol(upperSymbol);
    const isCrypto    = !isFutures && !isForex && isCryptoSymbol(upperSymbol);

    // ── Futures → Yahoo Finance
    if (isFutures) {
      const yahooTicker = normalizeFuturesSymbol(upperSymbol);
      const quote = await fetchYahooFuturesQuote(yahooTicker);
      if (!quote) { res.status(404).json({ error: "Not Found", message: `No data for ${upperSymbol}` }); return; }
      res.set("Cache-Control", "no-cache");
      res.json({
        symbol: upperSymbol, price: quote.price, change: quote.change, changePercent: quote.changePercent,
        open: quote.open, high: quote.high, low: quote.low, volume: quote.volume,
        session: "regular" as MarketSession, prevClose: quote.prevClose, regularClose: quote.prevClose,
        timestamp: quote.timestamp,
      });
      return;
    }

    // ── Forex → Frankfurter
    if (isForex) {
      const session = getForexSession();
      const fxQuote = await fetchForexQuote(upperSymbol);
      if (!fxQuote) { res.status(404).json({ error: "Not Found", message: `No rate for ${upperSymbol}` }); return; }
      const { price, prevClose, timestamp } = fxQuote;
      const change        = prevClose != null ? price - prevClose : 0;
      const changePercent = prevClose && prevClose !== 0 ? (change / prevClose) * 100 : 0;
      res.set("Cache-Control", "no-cache");
      res.json({
        symbol: upperSymbol, price, change, changePercent,
        open: 0, high: 0, low: 0, volume: 0,
        session, prevClose, regularClose: prevClose, timestamp,
      });
      return;
    }

    // ── Crypto → Alpaca snapshot
    if (isCrypto) {
      const snap = await fetchAlpacaCryptoSnapshot(upperSymbol);
      if (!snap) { res.status(404).json({ error: "Not Found", message: `No data for ${upperSymbol}` }); return; }
      const change        = snap.price - snap.prevClose;
      const changePercent = snap.prevClose !== 0 ? (change / snap.prevClose) * 100 : 0;
      res.set("Cache-Control", "no-cache");
      res.json({
        symbol: upperSymbol, price: snap.price, change, changePercent,
        open: snap.open, high: snap.high, low: snap.low, volume: snap.volume,
        session: "regular" as MarketSession, prevClose: snap.prevClose, regularClose: snap.prevClose,
        timestamp: snap.timestamp,
      });
      return;
    }

    // ── Stock → Alpaca snapshot (real-time quote)
    const session = getMarketSession();
    const snap    = await fetchAlpacaStockSnapshot(upperSymbol);
    if (!snap) { res.status(404).json({ error: "Not Found", message: `No data for ${upperSymbol}` }); return; }

    const price     = snap.price;
    const prevClose = snap.prevClose;
    const change        = price - prevClose;
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

    const regularClose: number | null =
      session === "regular" || session === "after" ? (snap.todayClose ?? null) : null;

    const preMarketPrice: number | null = session === "pre" ? price : null;

    // prevClose is used by the frontend for the reference horizontal line:
    //   pre-market  → yesterday's close (snap.prevClose)
    //   after-hours → today's regular close (snap.todayClose)
    //   regular     → yesterday's close (snap.prevClose)
    //   closed      → yesterday's close (snap.prevClose) — never null
    const referencePrevClose: number =
      session === "after" ? (snap.todayClose ?? prevClose) : prevClose;

    res.set("Cache-Control", "no-cache");
    res.json({
      symbol: upperSymbol, price, change, changePercent,
      open: snap.open, high: snap.high, low: snap.low, volume: snap.volume,
      session, prevClose: referencePrevClose, regularClose, preMarketPrice,
      timestamp: snap.timestamp,
    });

  } catch (err: any) {
    req.log.error({ err }, "Error fetching quote");
    res.status(500).json({ error: "Internal Server Error", message: err?.message ?? "Failed to fetch quote" });
  }
});

// ── Asset list cache ───────────────────────────────────────────────────────────
let _assetsCache: any[] | null = null;
let _assetsCacheTime = 0;
const ASSETS_TTL_MS = 60 * 60 * 1000;

async function getEquityAssets(): Promise<any[]> {
  if (_assetsCache && Date.now() - _assetsCacheTime < ASSETS_TTL_MS) return _assetsCache;
  const urls = [
    "https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity",
    "https://api.alpaca.markets/v2/assets?status=active&asset_class=us_equity",
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: alpacaHeaders() });
      if (r.ok) { _assetsCache = await r.json(); _assetsCacheTime = Date.now(); return _assetsCache!; }
    } catch { /* try next */ }
  }
  return _assetsCache ?? [];
}

// ── /market/search ────────────────────────────────────────────────────────────
router.get("/market/search", async (req, res) => {
  try {
    const { query } = req.query as Record<string, string>;
    if (!query) { res.status(400).json({ error: "Bad Request", message: "query is required" }); return; }

    const upperQuery = query.toUpperCase();

    const futuresMatches = POPULAR_FUTURES
      .filter(f => f.symbol.startsWith(upperQuery) || f.symbol.includes(upperQuery) ||
        f.yahooTicker.replace("=F", "").startsWith(upperQuery) || f.name.toUpperCase().includes(upperQuery))
      .slice(0, 3)
      .map(f => ({ symbol: f.symbol, name: f.name, exchange: "CME", type: "futures" as const }));

    const forexMatches = POPULAR_FOREX
      .filter(f => f.symbol.startsWith(upperQuery) || f.alpacaSymbol.replace("/", "").startsWith(upperQuery) ||
        f.name.toUpperCase().includes(upperQuery) || f.base.startsWith(upperQuery) || f.quote.startsWith(upperQuery))
      .slice(0, 4)
      .map(f => ({ symbol: f.symbol, name: f.name, exchange: "FX", type: "forex" as const }));

    const cryptoMatches = POPULAR_CRYPTO
      .filter(c => c.symbol.includes(upperQuery) || c.name.toUpperCase().includes(upperQuery))
      .slice(0, 4);

    const assets = await getEquityAssets();
    const stockResults: any[] = assets
      .filter((a: any) => a.tradable &&
        (a.symbol.startsWith(upperQuery) || (a.name && a.name.toUpperCase().includes(upperQuery))))
      .sort((a: any, b: any) => {
        const s = (x: any) => x.symbol === upperQuery ? 0 : x.symbol.startsWith(upperQuery) ? 1 : 2;
        return s(a) - s(b);
      })
      .slice(0, 8)
      .map((a: any) => ({ symbol: a.symbol, name: a.name ?? a.symbol, exchange: a.exchange ?? "US", type: "stock" as const }));

    const results = [
      ...futuresMatches, ...forexMatches,
      ...cryptoMatches.map(c => ({ ...c, type: "crypto" as const })),
      ...stockResults.filter(s =>
        !cryptoMatches.some(c => c.symbol === s.symbol) &&
        !forexMatches.some(f => f.symbol === s.symbol) &&
        !futuresMatches.some(f => f.symbol === s.symbol)
      ),
    ].slice(0, 12);

    res.json({ results });
  } catch (err) {
    req.log.error({ err }, "Error searching symbols");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to search symbols" });
  }
});

// ── Yahoo Finance news ─────────────────────────────────────────────────────────
const _newsCache = new Map<string, { articles: any[]; ts: number }>();
const NEWS_TTL_MS = 5 * 60 * 1000;

async function fetchYahooNews(ticker: string): Promise<any[]> {
  const cached = _newsCache.get(ticker);
  if (cached && Date.now() - cached.ts < NEWS_TTL_MS) return cached.articles;
  const params  = new URLSearchParams({ q: ticker, newsCount: "10", quotesCount: "0" });
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://finance.yahoo.com/",
    Origin:  "https://finance.yahoo.com",
  };
  for (const host of ["query2", "query1"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v1/finance/search?${params}`, { headers });
      if (r.ok) {
        const data = await r.json() as any;
        _newsCache.set(ticker, { articles: data.news ?? [], ts: Date.now() });
        return data.news ?? [];
      }
    } catch { /* try next */ }
  }
  return _newsCache.get(ticker)?.articles ?? [];
}

router.get("/market/news", async (req, res) => {
  try {
    const { symbol } = req.query as Record<string, string>;
    if (!symbol) { res.status(400).json({ error: "Bad Request", message: "symbol is required" }); return; }

    const upperSymbol = symbol.toUpperCase();
    const isFutures   = isFuturesSymbol(upperSymbol);
    const isForex     = !isFutures && isForexSymbol(upperSymbol);
    const isCrypto    = !isFutures && !isForex && isCryptoSymbol(upperSymbol);

    let searchQuery: string;
    let yahooTicker: string;

    if (isFutures) {
      const ft = POPULAR_FUTURES.find(f => f.symbol === upperSymbol || f.yahooTicker === upperSymbol);
      yahooTicker = ft?.yahooTicker ?? normalizeFuturesSymbol(upperSymbol);
      searchQuery = ft?.name ?? upperSymbol;
    } else if (isForex) {
      const fxEntry = POPULAR_FOREX.find(f => f.symbol === upperSymbol || f.alpacaSymbol === upperSymbol);
      const clean   = fxEntry?.symbol ?? upperSymbol.replace("/", "");
      yahooTicker   = `${clean}=X`;
      searchQuery   = yahooTicker;
    } else if (upperSymbol.includes("/")) {
      yahooTicker  = upperSymbol.replace("/", "-");
      const entry  = POPULAR_CRYPTO.find(c => c.alpacaSymbol === upperSymbol);
      searchQuery  = entry?.name ?? upperSymbol.split("/")[0];
    } else if (isCrypto) {
      const base   = upperSymbol.replace(/USD(T|C)?$/, "").replace(/USD$/, "");
      yahooTicker  = `${base}-USD`;
      const entry  = POPULAR_CRYPTO.find(c => c.symbol === upperSymbol || c.alpacaSymbol === `${base}/USD`);
      searchQuery  = entry?.name ?? base;
    } else {
      yahooTicker = upperSymbol;
      searchQuery = upperSymbol;
    }

    const raw = await fetchYahooNews(searchQuery);
    const scored = raw
      .filter((a: any) => a.type === "STORY" || a.type === "VIDEO")
      .map((a: any) => {
        const tickers: string[] = a.relatedTickers ?? [];
        let tier = 3;
        if (!isCrypto && !isForex && !isFutures) {
          const idx = tickers.indexOf(yahooTicker);
          if      (idx === -1)                            tier = 3;
          else if (tickers.length === 1)                  tier = 0;
          else if (idx === 0 && tickers.length <= 3)      tier = 1;
          else                                            tier = 2;
        }
        return { ...a, _tier: tier };
      })
      .filter((a: any) => isCrypto || isForex || isFutures || a._tier < 3)
      .sort((a: any, b: any) =>
        a._tier !== b._tier ? a._tier - b._tier : (b.providerPublishTime ?? 0) - (a.providerPublishTime ?? 0)
      );

    const articles = scored.slice(0, 5).map((a: any) => ({
      id: a.uuid, headline: a.title, source: a.publisher ?? "", url: a.link,
      publishedAt: a.providerPublishTime ? new Date(a.providerPublishTime * 1000).toISOString() : null,
    }));

    res.json({ symbol: yahooTicker, articles });
  } catch (err) {
    req.log.error({ err }, "Error fetching Yahoo Finance news");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to fetch news" });
  }
});

// ── Forex helpers ──────────────────────────────────────────────────────────────
const FOREX_CURRENCY_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF",
  "HKD", "SGD", "NOK", "SEK", "DKK", "ZAR", "MXN", "CNH", "TRY",
]);

export const POPULAR_FOREX = [
  { symbol: "EURUSD", alpacaSymbol: "EUR/USD", name: "Euro / US Dollar",                      base: "EUR", quote: "USD", type: "forex" },
  { symbol: "GBPUSD", alpacaSymbol: "GBP/USD", name: "British Pound / US Dollar",             base: "GBP", quote: "USD", type: "forex" },
  { symbol: "USDJPY", alpacaSymbol: "USD/JPY", name: "US Dollar / Japanese Yen",              base: "USD", quote: "JPY", type: "forex" },
  { symbol: "AUDUSD", alpacaSymbol: "AUD/USD", name: "Australian Dollar / US Dollar",         base: "AUD", quote: "USD", type: "forex" },
  { symbol: "USDCAD", alpacaSymbol: "USD/CAD", name: "US Dollar / Canadian Dollar",           base: "USD", quote: "CAD", type: "forex" },
  { symbol: "USDCHF", alpacaSymbol: "USD/CHF", name: "US Dollar / Swiss Franc",               base: "USD", quote: "CHF", type: "forex" },
  { symbol: "NZDUSD", alpacaSymbol: "NZD/USD", name: "New Zealand Dollar / US Dollar",        base: "NZD", quote: "USD", type: "forex" },
  { symbol: "EURGBP", alpacaSymbol: "EUR/GBP", name: "Euro / British Pound",                 base: "EUR", quote: "GBP", type: "forex" },
  { symbol: "EURJPY", alpacaSymbol: "EUR/JPY", name: "Euro / Japanese Yen",                  base: "EUR", quote: "JPY", type: "forex" },
  { symbol: "GBPJPY", alpacaSymbol: "GBP/JPY", name: "British Pound / Japanese Yen",         base: "GBP", quote: "JPY", type: "forex" },
  { symbol: "EURAUD", alpacaSymbol: "EUR/AUD", name: "Euro / Australian Dollar",             base: "EUR", quote: "AUD", type: "forex" },
  { symbol: "EURCHF", alpacaSymbol: "EUR/CHF", name: "Euro / Swiss Franc",                   base: "EUR", quote: "CHF", type: "forex" },
  { symbol: "EURCAD", alpacaSymbol: "EUR/CAD", name: "Euro / Canadian Dollar",               base: "EUR", quote: "CAD", type: "forex" },
  { symbol: "AUDCAD", alpacaSymbol: "AUD/CAD", name: "Australian Dollar / Canadian Dollar",   base: "AUD", quote: "CAD", type: "forex" },
  { symbol: "AUDCHF", alpacaSymbol: "AUD/CHF", name: "Australian Dollar / Swiss Franc",      base: "AUD", quote: "CHF", type: "forex" },
  { symbol: "AUDJPY", alpacaSymbol: "AUD/JPY", name: "Australian Dollar / Japanese Yen",    base: "AUD", quote: "JPY", type: "forex" },
  { symbol: "CADJPY", alpacaSymbol: "CAD/JPY", name: "Canadian Dollar / Japanese Yen",      base: "CAD", quote: "JPY", type: "forex" },
  { symbol: "CADCHF", alpacaSymbol: "CAD/CHF", name: "Canadian Dollar / Swiss Franc",       base: "CAD", quote: "CHF", type: "forex" },
  { symbol: "CHFJPY", alpacaSymbol: "CHF/JPY", name: "Swiss Franc / Japanese Yen",          base: "CHF", quote: "JPY", type: "forex" },
  { symbol: "GBPAUD", alpacaSymbol: "GBP/AUD", name: "British Pound / Australian Dollar",    base: "GBP", quote: "AUD", type: "forex" },
  { symbol: "GBPCAD", alpacaSymbol: "GBP/CAD", name: "British Pound / Canadian Dollar",     base: "GBP", quote: "CAD", type: "forex" },
  { symbol: "GBPCHF", alpacaSymbol: "GBP/CHF", name: "British Pound / Swiss Franc",         base: "GBP", quote: "CHF", type: "forex" },
  { symbol: "NZDJPY", alpacaSymbol: "NZD/JPY", name: "New Zealand Dollar / Japanese Yen",   base: "NZD", quote: "JPY", type: "forex" },
  { symbol: "NZDCAD", alpacaSymbol: "NZD/CAD", name: "New Zealand Dollar / Canadian Dollar", base: "NZD", quote: "CAD", type: "forex" },
  { symbol: "NZDCHF", alpacaSymbol: "NZD/CHF", name: "New Zealand Dollar / Swiss Franc",    base: "NZD", quote: "CHF", type: "forex" },
  { symbol: "USDNOK", alpacaSymbol: "USD/NOK", name: "US Dollar / Norwegian Krone",         base: "USD", quote: "NOK", type: "forex" },
  { symbol: "USDSEK", alpacaSymbol: "USD/SEK", name: "US Dollar / Swedish Krona",           base: "USD", quote: "SEK", type: "forex" },
  { symbol: "USDDKK", alpacaSymbol: "USD/DKK", name: "US Dollar / Danish Krone",            base: "USD", quote: "DKK", type: "forex" },
  { symbol: "USDSGD", alpacaSymbol: "USD/SGD", name: "US Dollar / Singapore Dollar",        base: "USD", quote: "SGD", type: "forex" },
  { symbol: "USDHKD", alpacaSymbol: "USD/HKD", name: "US Dollar / Hong Kong Dollar",        base: "USD", quote: "HKD", type: "forex" },
  { symbol: "USDMXN", alpacaSymbol: "USD/MXN", name: "US Dollar / Mexican Peso",            base: "USD", quote: "MXN", type: "forex" },
  { symbol: "USDZAR", alpacaSymbol: "USD/ZAR", name: "US Dollar / South African Rand",      base: "USD", quote: "ZAR", type: "forex" },
  { symbol: "USDTRY", alpacaSymbol: "USD/TRY", name: "US Dollar / Turkish Lira",            base: "USD", quote: "TRY", type: "forex" },
];

function parseForexPair(symbol: string): { base: string; quote: string } | null {
  const entry = POPULAR_FOREX.find(f => f.symbol === symbol || f.alpacaSymbol === symbol);
  if (entry) return { base: entry.base, quote: entry.quote };
  if (symbol.includes("/")) { const [base, quote] = symbol.split("/"); if (base && quote) return { base, quote }; }
  if (symbol.length === 6) return { base: symbol.slice(0, 3), quote: symbol.slice(3, 6) };
  return null;
}

async function fetchForexBars(symbol: string, startDate: string, limit: number): Promise<any[]> {
  const pair = parseForexPair(symbol);
  if (!pair) return [];
  const { base, quote } = pair;
  const minStart = new Date();
  minStart.setDate(minStart.getDate() - 30);
  const effectiveStart = startDate < minStart.toISOString().split("T")[0] ? startDate : minStart.toISOString().split("T")[0];
  try {
    const r = await fetch(`https://api.frankfurter.app/${effectiveStart}..?base=${base}&symbols=${quote}`);
    if (!r.ok) return [];
    const data   = await r.json() as any;
    const closes = Object.entries(data.rates ?? {})
      .map(([date, rates]) => ({ date, c: (rates as Record<string, number>)[quote] ?? 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const bars = closes.map((bar, i) => {
      const o = i === 0 ? bar.c : closes[i - 1].c;
      return { t: `${bar.date}T00:00:00Z`, o, h: Math.max(o, bar.c), l: Math.min(o, bar.c), c: bar.c, v: 0 };
    });
    return bars.slice(-limit);
  } catch { return []; }
}

async function fetchForexQuote(symbol: string): Promise<{ price: number; prevClose: number | null; timestamp: string } | null> {
  const pair = parseForexPair(symbol);
  if (!pair) return null;
  const { base, quote } = pair;
  const since = new Date();
  since.setDate(since.getDate() - 7);
  try {
    const r = await fetch(`https://api.frankfurter.app/${since.toISOString().split("T")[0]}..?base=${base}&symbols=${quote}`);
    if (!r.ok) return null;
    const data    = await r.json() as any;
    const entries = Object.entries(data.rates ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) return null;
    const [lastDate, lastRates] = entries[entries.length - 1];
    const price = (lastRates as Record<string, number>)[quote] ?? 0;
    let prevClose: number | null = null;
    if (entries.length >= 2) {
      const [, prevRates] = entries[entries.length - 2];
      prevClose = (prevRates as Record<string, number>)[quote] ?? null;
    }
    return { price, prevClose, timestamp: `${lastDate}T00:00:00Z` };
  } catch { return null; }
}

function isForexSymbol(symbol: string): boolean {
  if (POPULAR_FOREX.some(f => f.symbol === symbol || f.alpacaSymbol === symbol)) return true;
  if (symbol.includes("/")) { const [b, q] = symbol.split("/"); return FOREX_CURRENCY_CODES.has(b) && FOREX_CURRENCY_CODES.has(q); }
  if (symbol.length === 6) {
    const b = symbol.slice(0, 3), q = symbol.slice(3, 6);
    return FOREX_CURRENCY_CODES.has(b) && FOREX_CURRENCY_CODES.has(q) && b !== q;
  }
  return false;
}

function normalizeForexSymbol(symbol: string): string {
  const match = POPULAR_FOREX.find(f => f.symbol === symbol || f.alpacaSymbol === symbol);
  if (match) return match.alpacaSymbol;
  if (symbol.includes("/")) return symbol.toUpperCase();
  if (symbol.length === 6) return `${symbol.slice(0, 3)}/${symbol.slice(3, 6)}`;
  return symbol;
}

// ── Crypto helpers ─────────────────────────────────────────────────────────────
export const POPULAR_CRYPTO = [
  { symbol: "BTCUSD",   alpacaSymbol: "BTC/USD",  name: "Bitcoin",   exchange: "Crypto", type: "crypto" },
  { symbol: "ETHUSD",   alpacaSymbol: "ETH/USD",  name: "Ethereum",  exchange: "Crypto", type: "crypto" },
  { symbol: "SOLUSD",   alpacaSymbol: "SOL/USD",  name: "Solana",    exchange: "Crypto", type: "crypto" },
  { symbol: "ADAUSD",   alpacaSymbol: "ADA/USD",  name: "Cardano",   exchange: "Crypto", type: "crypto" },
  { symbol: "DOTUSD",   alpacaSymbol: "DOT/USD",  name: "Polkadot",  exchange: "Crypto", type: "crypto" },
  { symbol: "DOGEUSD",  alpacaSymbol: "DOGE/USD", name: "Dogecoin",  exchange: "Crypto", type: "crypto" },
  { symbol: "LINKUSD",  alpacaSymbol: "LINK/USD", name: "Chainlink", exchange: "Crypto", type: "crypto" },
  { symbol: "AVAXUSD",  alpacaSymbol: "AVAX/USD", name: "Avalanche", exchange: "Crypto", type: "crypto" },
  { symbol: "MATICUSD", alpacaSymbol: "MATIC/USD", name: "Polygon",  exchange: "Crypto", type: "crypto" },
  { symbol: "XRPUSD",   alpacaSymbol: "XRP/USD",  name: "Ripple",    exchange: "Crypto", type: "crypto" },
  { symbol: "LTCUSD",   alpacaSymbol: "LTC/USD",  name: "Litecoin",  exchange: "Crypto", type: "crypto" },
  { symbol: "UNIUSD",   alpacaSymbol: "UNI/USD",  name: "Uniswap",   exchange: "Crypto", type: "crypto" },
];

function isCryptoSymbol(symbol: string): boolean {
  if (isForexSymbol(symbol)) return false;
  const cryptoSuffixes = ["USD", "USDT", "BTC", "ETH", "USDC"];
  const cryptoSymbols  = ["BTC", "ETH", "SOL", "ADA", "DOT", "AVAX", "MATIC", "LINK", "UNI", "AAVE", "XRP", "DOGE", "LTC", "BCH", "XLM"];
  if (symbol.includes("/")) return true;
  if (cryptoSymbols.includes(symbol)) return true;
  for (const s of cryptoSuffixes) {
    if (symbol.endsWith(s) && symbol.length > s.length && cryptoSymbols.includes(symbol.slice(0, -s.length))) return true;
  }
  return POPULAR_CRYPTO.some(c => c.symbol === symbol || c.alpacaSymbol === symbol);
}

function normalizeCryptoSymbol(symbol: string): string {
  if (symbol.includes("/")) return symbol;
  const match = POPULAR_CRYPTO.find(c => c.symbol === symbol || c.alpacaSymbol === symbol);
  if (match) return match.alpacaSymbol;
  const cryptoSuffixes = ["USD", "USDT", "BTC", "ETH", "USDC"];
  for (const s of cryptoSuffixes) {
    if (symbol.endsWith(s) && symbol.length > s.length) return `${symbol.slice(0, -s.length)}/${s}`;
  }
  return symbol;
}

// ── Futures helpers ────────────────────────────────────────────────────────────
export const POPULAR_FUTURES = [
  { symbol: "GOLD",     yahooTicker: "GC=F",  name: "Gold Futures",             unit: "$/oz",    type: "futures" as const },
  { symbol: "SILVER",   yahooTicker: "SI=F",  name: "Silver Futures",           unit: "$/oz",    type: "futures" as const },
  { symbol: "OIL",      yahooTicker: "CL=F",  name: "Crude Oil WTI Futures",    unit: "$/bbl",   type: "futures" as const },
  { symbol: "BRENT",    yahooTicker: "BZ=F",  name: "Brent Crude Oil Futures",  unit: "$/bbl",   type: "futures" as const },
  { symbol: "NATGAS",   yahooTicker: "NG=F",  name: "Natural Gas Futures",      unit: "$/MMBtu", type: "futures" as const },
  { symbol: "COPPER",   yahooTicker: "HG=F",  name: "Copper Futures",           unit: "$/lb",    type: "futures" as const },
  { symbol: "PLATINUM", yahooTicker: "PL=F",  name: "Platinum Futures",         unit: "$/oz",    type: "futures" as const },
  { symbol: "CORN",     yahooTicker: "ZC=F",  name: "Corn Futures",             unit: "¢/bu",    type: "futures" as const },
  { symbol: "WHEAT",    yahooTicker: "ZW=F",  name: "Wheat Futures",            unit: "¢/bu",    type: "futures" as const },
  { symbol: "SOYBEAN",  yahooTicker: "ZS=F",  name: "Soybean Futures",          unit: "¢/bu",    type: "futures" as const },
];

function isFuturesSymbol(symbol: string): boolean {
  if (POPULAR_FUTURES.some(f => f.symbol === symbol || f.yahooTicker === symbol)) return true;
  return /^[A-Z]{1,4}=F$/.test(symbol);
}

function normalizeFuturesSymbol(symbol: string): string {
  const match = POPULAR_FUTURES.find(f => f.symbol === symbol || f.yahooTicker === symbol);
  if (match) return match.yahooTicker;
  if (/^[A-Z]{1,4}=F$/.test(symbol)) return symbol;
  return `${symbol}=F`;
}

function mapTimeframeToYahoo(tf: string): string {
  switch (tf) {
    case "1Min": return "1m"; case "5Min": return "5m"; case "15Min": return "15m";
    case "1Hour": return "1h"; case "4Hour": return "1h";
    case "1Day": return "1d"; case "1Week": return "1wk";
    default: return "1d";
  }
}

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  Referer: "https://finance.yahoo.com/",
};

async function fetchYahooFuturesBars(yahooTicker: string, timeframe: string, startDate: string, limit: number): Promise<any[]> {
  const interval = mapTimeframeToYahoo(timeframe);
  const period1  = Math.floor(new Date(startDate).getTime() / 1000);
  const period2  = Math.floor(Date.now() / 1000);
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=${interval}&period1=${period1}&period2=${period2}`, { headers: YAHOO_HEADERS });
      if (!r.ok) continue;
      const data   = await r.json() as any;
      const result = data.chart?.result?.[0];
      if (!result) continue;
      const ts = result.timestamp ?? [];
      const q  = result.indicators?.quote?.[0] ?? {};
      return ts
        .map((t: number, i: number) => ({ t: new Date(t * 1000).toISOString(), o: q.open?.[i] ?? null, h: q.high?.[i] ?? null, l: q.low?.[i] ?? null, c: q.close?.[i] ?? null, v: q.volume?.[i] ?? 0 }))
        .filter((b: any) => b.o != null && b.c != null)
        .slice(-limit);
    } catch { /* try next */ }
  }
  return [];
}

async function fetchYahooFuturesQuote(yahooTicker: string): Promise<{
  price: number; change: number; changePercent: number;
  open: number; high: number; low: number; volume: number;
  prevClose: number; timestamp: string;
} | null> {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=5d`, { headers: YAHOO_HEADERS });
      if (!r.ok) continue;
      const data   = await r.json() as any;
      const result = data.chart?.result?.[0];
      if (!result) continue;
      const meta      = result.meta ?? {};
      const price     = meta.regularMarketPrice ?? 0;
      const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? meta.regularMarketPreviousClose ?? price;
      const change    = price - prevClose;
      return {
        price, change, changePercent: prevClose !== 0 ? (change / prevClose) * 100 : 0,
        open: meta.regularMarketOpen ?? price, high: meta.regularMarketDayHigh ?? price,
        low: meta.regularMarketDayLow ?? price, volume: meta.regularMarketVolume ?? 0,
        prevClose, timestamp: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
      };
    } catch { /* try next */ }
  }
  return null;
}

// ── Live trade streaming via SSE (Alpaca IEX — free & real-time) ──────────────
router.get("/market/stream", optionalAuth, (req: Request, res: Response) => {
  if (!req.user) { res.status(401).end(); return; }

  const symbol   = (req.query.symbol   as string | undefined)?.toUpperCase().trim();
  const interval = (req.query.interval as string | undefined) ?? "1Min";
  if (!symbol) { res.status(400).json({ error: "symbol required" }); return; }

  const isCrypto  = /^[A-Z]{2,10}USD$/.test(symbol) && symbol.length >= 5;
  const isFutures = /[A-Z]=F$/.test(symbol);
  if (isFutures) { res.status(400).json({ error: "Futures real-time streaming is not supported" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: object) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* disconnected */ }
  };

  send("connected", { symbol, interval });

  const wsUrl    = isCrypto ? "wss://stream.data.alpaca.markets/v2/crypto" : "wss://stream.data.alpaca.markets/v2/iex";
  const wsSymbol = isCrypto ? `${symbol.slice(0, -3)}/${symbol.slice(-3)}` : symbol;

  let ws: WebSocket | null = null;
  let closed = false;

  function openWs() {
    if (closed) return;
    ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      ws!.send(JSON.stringify({ action: "auth", key: ALPACA_API_KEY ?? "", secret: ALPACA_API_SECRET ?? "" }));
    });
    ws.on("message", (raw: Buffer) => {
      let msgs: any[];
      try { msgs = JSON.parse(raw.toString()); } catch { return; }
      for (const msg of msgs) {
        if (msg.T === "success" && msg.msg === "authenticated") {
          ws!.send(JSON.stringify({ action: "subscribe", trades: [wsSymbol] }));
        } else if (msg.T === "t") {
          send("trade", { p: msg.p, s: msg.s, t: msg.t });
        } else if (msg.T === "error") {
          send("stream_error", { code: msg.code, message: msg.msg });
        }
      }
    });
    ws.on("error", (err) => {
      console.error("[stream] ws error:", (err as Error).message);
      send("stream_error", { message: "WebSocket error — will retry" });
    });
    ws.on("close", () => { if (!closed) setTimeout(openWs, 5_000); });
  }

  openWs();

  const heartbeat = setInterval(() => {
    try { res.write(":heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 25_000);

  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) ws.close();
  });
});

export default router;
