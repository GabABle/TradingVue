import { Router, type IRouter, type Request, type Response } from "express";
import WebSocket from "ws";
import { optionalAuth } from "../lib/auth-middleware.js";

const router: IRouter = Router();

const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_API_SECRET = process.env.ALPACA_API_SECRET;

const DATA_BASE_URL = "https://data.alpaca.markets/v2";
const DATA_V1B3_URL = "https://data.alpaca.markets/v1beta3";

function alpacaHeaders() {
  return {
    "APCA-API-KEY-ID": ALPACA_API_KEY ?? "",
    "APCA-API-SECRET-KEY": ALPACA_API_SECRET ?? "",
    Accept: "application/json",
  };
}

// ── Market session detection (US Eastern Time) ──────────────────────────────
type MarketSession = "pre" | "regular" | "after" | "closed";

function getMarketSession(): MarketSession {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const year = now.getUTCFullYear();
  const dstStart = nthSundayOfMonth(year, 2, 2);
  const dstEnd   = nthSundayOfMonth(year, 10, 1);
  const isDST = now >= dstStart && now < dstEnd;
  const offsetMs = isDST ? -4 * 3_600_000 : -5 * 3_600_000;
  const etDate = new Date(utcMs + offsetMs);

  const day = etDate.getDay();
  if (day === 0 || day === 6) return "closed";

  const h = etDate.getHours();
  const m = etDate.getMinutes();
  const minutes = h * 60 + m;

  if (minutes < 4 * 60)          return "closed";
  if (minutes < 9 * 60 + 30)     return "pre";
  if (minutes < 16 * 60)         return "regular";
  if (minutes < 20 * 60)         return "after";
  return "closed";
}

// Forex is open Mon–Fri 22:00 UTC Sun → 22:00 UTC Fri (simplify to Mon–Fri all day)
function getForexSession(): "regular" | "closed" {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 6) return "closed";
  if (day === 0) return now.getUTCHours() >= 21 ? "regular" : "closed";
  if (day === 5) return now.getUTCHours() < 22 ? "regular" : "closed";
  return "regular";
}

function nthSundayOfMonth(year: number, month: number, n: number): Date {
  const d = new Date(Date.UTC(year, month, 1));
  const firstSunday = (7 - d.getUTCDay()) % 7;
  return new Date(Date.UTC(year, month, 1 + firstSunday + (n - 1) * 7, 7, 0, 0));
}

function getPreMarketWindow(): { start: string; end: string } {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const year = now.getUTCFullYear();
  const dstStart = nthSundayOfMonth(year, 2, 2);
  const dstEnd   = nthSundayOfMonth(year, 10, 1);
  const isDST = now >= dstStart && now < dstEnd;
  const offsetHours = isDST ? 4 : 5;
  const offsetMs = -offsetHours * 3_600_000;
  const etDate = new Date(utcMs + offsetMs);

  const y  = etDate.getFullYear();
  const mo = etDate.getMonth();
  const d  = etDate.getDate();

  const startUTC = new Date(Date.UTC(y, mo, d, 4 + offsetHours, 0, 0));
  const endUTC   = new Date(Date.UTC(y, mo, d, 9 + offsetHours, 30, 0));
  return { start: startUTC.toISOString(), end: endUTC.toISOString() };
}

// ── /market/bars ─────────────────────────────────────────────────────────────
router.get("/market/bars", async (req, res) => {
  try {
    const { symbol, timeframe, start, end, limit = "200", feed } = req.query as Record<string, string>;

    if (!symbol || !timeframe) {
      res.status(400).json({ error: "Bad Request", message: "symbol and timeframe are required" });
      return;
    }

    const upperSymbol = symbol.toUpperCase();
    const isFutures = isFuturesSymbol(upperSymbol);
    const isForex   = !isFutures && isForexSymbol(upperSymbol);
    const isCrypto  = !isFutures && !isForex && isCryptoSymbol(upperSymbol);

    const params = new URLSearchParams({ timeframe, limit: limit ?? "200" });

    if (!isCrypto && !isForex) {
      params.set("adjustment", "raw");
      params.set("feed", feed ?? "sip");
    }

    if (start) {
      params.set("start", start);
    } else {
      params.set("start", getDefaultStart(timeframe));
    }
    if (end) params.set("end", end);
    if (feed && !isForex) params.set("feed", feed);

    let url: string;
    let barsKey: string | null = null;

    if (isFutures) {
      const yahooTicker = normalizeFuturesSymbol(upperSymbol);
      const startDate   = start || getDefaultStart(timeframe);
      const bars = await fetchYahooFuturesBars(yahooTicker, timeframe, startDate, parseInt(limit ?? "500", 10));
      res.set("Cache-Control", "no-cache");
      res.json({ symbol: upperSymbol, bars, nextPageToken: null });
      return;
    } else if (isForex) {
      const startDate = start || getDefaultStart("1Day");
      const bars = await fetchForexBars(upperSymbol, startDate, parseInt(limit ?? "500", 10));
      res.set("Cache-Control", "no-cache");
      res.json({ symbol: upperSymbol, bars, nextPageToken: null });
      return;
    } else if (isCrypto) {
      const cryptoSymbol = normalizeCryptoSymbol(upperSymbol);
      barsKey = cryptoSymbol;
      url = `${DATA_V1B3_URL}/crypto/us/bars?symbols=${encodeURIComponent(cryptoSymbol)}&${params.toString()}`;
    } else {
      url = `${DATA_BASE_URL}/stocks/${upperSymbol}/bars?${params.toString()}`;
    }

    const response = await fetch(url, { headers: alpacaHeaders() });

    if (!response.ok) {
      const errorText = await response.text();
      req.log.error({ status: response.status, error: errorText }, "Alpaca bars error");
      res.status(response.status).json({ error: "Alpaca API Error", message: errorText });
      return;
    }

    const data = await response.json() as any;

    let bars: any[] = [];
    if (barsKey) {
      bars = data.bars?.[barsKey] ?? data.bars ?? [];
    } else {
      bars = data.bars ?? [];
    }

    res.set("Cache-Control", "no-cache");
    res.json({ symbol: upperSymbol, bars, nextPageToken: data.next_page_token ?? null });
  } catch (err) {
    req.log.error({ err }, "Error fetching bars");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to fetch bars" });
  }
});

// ── /market/quote ─────────────────────────────────────────────────────────────
router.get("/market/quote", async (req, res) => {
  try {
    const { symbol } = req.query as Record<string, string>;

    if (!symbol) {
      res.status(400).json({ error: "Bad Request", message: "symbol is required" });
      return;
    }

    const upperSymbol = symbol.toUpperCase();
    const isFutures = isFuturesSymbol(upperSymbol);
    const isForex   = !isFutures && isForexSymbol(upperSymbol);
    const isCrypto  = !isFutures && !isForex && isCryptoSymbol(upperSymbol);

    // ── Futures (Yahoo Finance) ───────────────────────────────────────────────
    if (isFutures) {
      const yahooTicker = normalizeFuturesSymbol(upperSymbol);
      const quote = await fetchYahooFuturesQuote(yahooTicker);
      if (!quote) {
        res.status(404).json({ error: "Not Found", message: `No data found for ${upperSymbol}` });
        return;
      }
      res.set("Cache-Control", "no-cache");
      res.json({
        symbol: upperSymbol,
        price:          quote.price,
        change:         quote.change,
        changePercent:  quote.changePercent,
        open:           quote.open,
        high:           quote.high,
        low:            quote.low,
        volume:         quote.volume,
        session:        "regular" as MarketSession,
        prevClose:      quote.prevClose,
        regularClose:   quote.prevClose,
        timestamp:      quote.timestamp,
      });
      return;
    }

    // ── Forex (Frankfurter / ECB rates) ──────────────────────────────────────
    if (isForex) {
      const session = getForexSession();
      const fxQuote = await fetchForexQuote(upperSymbol);

      if (!fxQuote) {
        res.status(404).json({ error: "Not Found", message: `No rate found for ${upperSymbol}` });
        return;
      }

      const { price, prevClose, timestamp } = fxQuote;
      const change        = prevClose != null ? price - prevClose : 0;
      const changePercent = prevClose && prevClose !== 0 ? (change / prevClose) * 100 : 0;

      res.set("Cache-Control", "no-cache");
      res.json({
        symbol: upperSymbol,
        price,
        change,
        changePercent,
        open:   0,
        high:   0,
        low:    0,
        volume: 0,
        session,
        prevClose,
        regularClose: prevClose,
        timestamp,
      });
      return;
    }

    // ── Crypto ───────────────────────────────────────────────────────────────
    if (isCrypto) {
      const cryptoSymbol = normalizeCryptoSymbol(upperSymbol);
      const url = `${DATA_V1B3_URL}/crypto/us/snapshots?symbols=${encodeURIComponent(cryptoSymbol)}`;
      const response = await fetch(url, { headers: alpacaHeaders() });

      if (!response.ok) {
        res.status(response.status).json({ error: "Not Found", message: `No quote found for ${upperSymbol}` });
        return;
      }

      const data = await response.json() as any;
      const snap = data.snapshots?.[cryptoSymbol];

      if (!snap) {
        res.status(404).json({ error: "Not Found", message: `No quote found for ${upperSymbol}` });
        return;
      }

      const price        = snap.latestTrade?.p ?? snap.dailyBar?.c ?? snap.prevDailyBar?.c ?? 0;
      const prevClose    = snap.prevDailyBar?.c ?? snap.dailyBar?.o ?? price;
      const change       = price - prevClose;
      const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

      res.set("Cache-Control", "no-cache");
      res.json({
        symbol: upperSymbol,
        price,
        change,
        changePercent,
        open:   snap.dailyBar?.o   ?? 0,
        high:   snap.dailyBar?.h   ?? 0,
        low:    snap.dailyBar?.l   ?? 0,
        volume: snap.dailyBar?.v   ?? 0,
        session: "regular" as MarketSession,
        timestamp: snap.latestTrade?.t ?? snap.dailyBar?.t ?? new Date().toISOString(),
      });
      return;
    }

    // ── Equity ───────────────────────────────────────────────────────────────
    const session  = getMarketSession();
    const snapUrl  = `${DATA_BASE_URL}/stocks/${upperSymbol}/snapshot`;

    const snapResponse = await fetch(snapUrl, { headers: alpacaHeaders() });

    if (!snapResponse.ok) {
      res.status(snapResponse.status).json({ error: "Not Found", message: `No quote found for ${upperSymbol}` });
      return;
    }

    const snap = await snapResponse.json() as any;

    // latestTrade.p is the most recent trade price — during pre-market this IS
    // the pre-market price. We no longer fetch the pre-market bars endpoint
    // separately because Alpaca 403s any bars request with a recent `end` param
    // on the SIP feed (15-min delay restriction).
    const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;
    const preMarketPrice: number | null = session === "pre" ? price : null;

    const lastRegularClose: number | null =
      session === "pre"
        ? (snap.dailyBar?.c  ?? null)
        : (snap.prevDailyBar?.c ?? null);

    const regularClose: number | null = snap.dailyBar?.c ?? null;
    const prevClose: number | null    = lastRegularClose;

    const changeBase =
      session === "after" && regularClose !== null  ? regularClose :
      session === "regular"                         ? (snap.prevDailyBar?.c ?? lastRegularClose ?? price) :
                                                      (lastRegularClose ?? snap.dailyBar?.o ?? price);

    const change        = price - changeBase;
    const changePercent = changeBase !== 0 ? (change / changeBase) * 100 : 0;

    res.set("Cache-Control", "no-cache");
    res.json({
      symbol: upperSymbol,
      price,
      change,
      changePercent,
      open:   snap.dailyBar?.o   ?? 0,
      high:   snap.dailyBar?.h   ?? 0,
      low:    snap.dailyBar?.l   ?? 0,
      volume: snap.dailyBar?.v   ?? 0,
      session,
      prevClose,
      regularClose,
      preMarketPrice,
      timestamp: snap.latestTrade?.t ?? snap.dailyBar?.t ?? new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching quote");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to fetch quote" });
  }
});

// ── Asset list cache (refreshed once per hour) ──────────────────────────────
let _assetsCache: any[] | null = null;
let _assetsCacheTime = 0;
const ASSETS_TTL_MS = 60 * 60 * 1000;

async function getEquityAssets(): Promise<any[]> {
  if (_assetsCache && Date.now() - _assetsCacheTime < ASSETS_TTL_MS) {
    return _assetsCache;
  }
  const urls = [
    "https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity",
    "https://api.alpaca.markets/v2/assets?status=active&asset_class=us_equity",
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: alpacaHeaders() });
      if (r.ok) {
        _assetsCache = (await r.json()) as any[];
        _assetsCacheTime = Date.now();
        return _assetsCache;
      }
    } catch { /* try next */ }
  }
  return _assetsCache ?? [];
}

// ── /market/search ────────────────────────────────────────────────────────────
router.get("/market/search", async (req, res) => {
  try {
    const { query } = req.query as Record<string, string>;

    if (!query) {
      res.status(400).json({ error: "Bad Request", message: "query is required" });
      return;
    }

    const upperQuery = query.toUpperCase();

    // 0. Futures matches
    const futuresMatches = POPULAR_FUTURES.filter(
      (f) =>
        f.symbol.startsWith(upperQuery) ||
        f.symbol.includes(upperQuery) ||
        f.yahooTicker.replace("=F", "").startsWith(upperQuery) ||
        f.name.toUpperCase().includes(upperQuery)
    )
      .slice(0, 3)
      .map((f) => ({
        symbol:   f.symbol,
        name:     f.name,
        exchange: "CME",
        type:     "futures" as const,
      }));

    // 1. Forex matches
    const forexMatches = POPULAR_FOREX.filter(
      (f) =>
        f.symbol.startsWith(upperQuery) ||
        f.alpacaSymbol.replace("/", "").startsWith(upperQuery) ||
        f.name.toUpperCase().includes(upperQuery) ||
        f.base.startsWith(upperQuery) ||
        f.quote.startsWith(upperQuery)
    )
      .slice(0, 4)
      .map((f) => ({
        symbol:   f.symbol,
        name:     f.name,
        exchange: "FX",
        type:     "forex" as const,
      }));

    // 2. Crypto matches
    const cryptoMatches = POPULAR_CRYPTO.filter(
      (c) =>
        c.symbol.includes(upperQuery) ||
        c.name.toUpperCase().includes(upperQuery)
    ).slice(0, 4);

    // 3. Equity matches
    const assets = await getEquityAssets();
    const stockResults: any[] = assets
      .filter(
        (a: any) =>
          a.tradable &&
          (a.symbol.startsWith(upperQuery) ||
            (a.name && a.name.toUpperCase().includes(upperQuery)))
      )
      .sort((a: any, b: any) => {
        const aExact = a.symbol === upperQuery ? 0 : a.symbol.startsWith(upperQuery) ? 1 : 2;
        const bExact = b.symbol === upperQuery ? 0 : b.symbol.startsWith(upperQuery) ? 1 : 2;
        return aExact - bExact;
      })
      .slice(0, 8)
      .map((a: any) => ({
        symbol:   a.symbol,
        name:     a.name ?? a.symbol,
        exchange: a.exchange ?? "US",
        type:     "stock" as const,
      }));

    // 4. Fallback exact-symbol lookup
    if (assets.length === 0) {
      for (const base of ["https://paper-api.alpaca.markets", "https://api.alpaca.markets"]) {
        try {
          const r = await fetch(`${base}/v2/assets/${encodeURIComponent(upperQuery)}`, {
            headers: alpacaHeaders(),
          });
          if (r.ok) {
            const a = await r.json() as any;
            if (a.tradable) {
              stockResults.push({
                symbol: a.symbol, name: a.name ?? a.symbol, exchange: a.exchange ?? "US", type: "stock",
              });
            }
            break;
          }
        } catch { /* ignore */ }
      }
    }

    const results = [
      ...futuresMatches,
      ...forexMatches,
      ...cryptoMatches.map((c) => ({ ...c, type: "crypto" as const })),
      ...stockResults.filter(
        (s) =>
          !cryptoMatches.some((c) => c.symbol === s.symbol) &&
          !forexMatches.some((f) => f.symbol === s.symbol) &&
          !futuresMatches.some((f) => f.symbol === s.symbol)
      ),
    ].slice(0, 12);

    res.json({ results });
  } catch (err) {
    req.log.error({ err }, "Error searching symbols");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to search symbols" });
  }
});

// ── Yahoo Finance news ────────────────────────────────────────────────────────
const _newsCache = new Map<string, { articles: any[]; ts: number }>();
const NEWS_TTL_MS = 5 * 60 * 1000;

async function fetchYahooNews(ticker: string): Promise<any[]> {
  const cached = _newsCache.get(ticker);
  if (cached && Date.now() - cached.ts < NEWS_TTL_MS) return cached.articles;

  const params = new URLSearchParams({ q: ticker, newsCount: "10", quotesCount: "0" });
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
    "Origin": "https://finance.yahoo.com",
  };

  for (const host of ["query2", "query1"]) {
    const url = `https://${host}.finance.yahoo.com/v1/finance/search?${params.toString()}`;
    try {
      const r = await fetch(url, { headers });
      if (r.ok) {
        const data = await r.json() as any;
        const articles = data.news ?? [];
        _newsCache.set(ticker, { articles, ts: Date.now() });
        return articles;
      }
    } catch { /* try next host */ }
  }
  return _newsCache.get(ticker)?.articles ?? [];
}

router.get("/market/news", async (req, res) => {
  try {
    const { symbol } = req.query as Record<string, string>;

    if (!symbol) {
      res.status(400).json({ error: "Bad Request", message: "symbol is required" });
      return;
    }

    const upperSymbol = symbol.toUpperCase();
    const isFutures = isFuturesSymbol(upperSymbol);
    const isForex   = !isFutures && isForexSymbol(upperSymbol);
    const isCrypto  = !isFutures && !isForex && isCryptoSymbol(upperSymbol);

    let searchQuery: string;
    let yahooTicker: string;

    if (isFutures) {
      const ft = POPULAR_FUTURES.find(f => f.symbol === upperSymbol || f.yahooTicker === upperSymbol);
      yahooTicker = ft?.yahooTicker ?? normalizeFuturesSymbol(upperSymbol);
      searchQuery = ft?.name ?? upperSymbol;
    } else if (isForex) {
      // Yahoo Finance uses e.g. "EURUSD=X" for forex
      const fxEntry = POPULAR_FOREX.find(f => f.symbol === upperSymbol || f.alpacaSymbol === upperSymbol);
      const clean = fxEntry?.symbol ?? upperSymbol.replace("/", "");
      yahooTicker  = `${clean}=X`;
      searchQuery  = yahooTicker;
    } else if (upperSymbol.includes("/")) {
      yahooTicker = upperSymbol.replace("/", "-");
      const cryptoEntry = POPULAR_CRYPTO.find(c => c.alpacaSymbol === upperSymbol);
      searchQuery = cryptoEntry?.name ?? upperSymbol.split("/")[0];
    } else if (isCrypto) {
      const base = upperSymbol.replace(/USD(T|C)?$/, "").replace(/USD$/, "");
      yahooTicker = `${base}-USD`;
      const cryptoEntry = POPULAR_CRYPTO.find(c => c.symbol === upperSymbol || c.alpacaSymbol === `${base}/USD`);
      searchQuery = cryptoEntry?.name ?? base;
    } else {
      yahooTicker = upperSymbol;
      searchQuery = upperSymbol;
    }

    const raw = await fetchYahooNews(searchQuery);

    const scored = [...raw]
      .filter((a: any) => a.type === "STORY" || a.type === "VIDEO")
      .map((a: any) => {
        const tickers: string[] = a.relatedTickers ?? [];
        let tier = 3;
        if (!isCrypto && !isForex && !isFutures) {
          const idx = tickers.indexOf(yahooTicker);
          if (idx === -1)                        tier = 3;
          else if (tickers.length === 1)         tier = 0;
          else if (idx === 0 && tickers.length <= 3) tier = 1;
          else                                   tier = 2;
        }
        return { ...a, _tier: tier };
      })
      .filter((a: any) => isCrypto || isForex || isFutures || a._tier < 3)
      .sort((a, b) => {
        if (a._tier !== b._tier) return a._tier - b._tier;
        return (b.providerPublishTime ?? 0) - (a.providerPublishTime ?? 0);
      });

    const articles = scored.slice(0, 5).map((a: any) => ({
      id:          a.uuid,
      headline:    a.title,
      source:      a.publisher ?? "",
      url:         a.link,
      publishedAt: a.providerPublishTime
        ? new Date(a.providerPublishTime * 1000).toISOString()
        : null,
    }));

    res.json({ symbol: yahooTicker, articles });
  } catch (err) {
    req.log.error({ err }, "Error fetching Yahoo Finance news");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to fetch news" });
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function getDefaultStart(timeframe: string): string {
  const now = new Date();
  let daysBack = 365;
  if (timeframe === "1Min")   daysBack = 3;
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

// ── Forex helpers ─────────────────────────────────────────────────────────────
const FOREX_CURRENCY_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF",
  "HKD", "SGD", "NOK", "SEK", "DKK", "ZAR", "MXN", "CNH", "TRY",
]);

export const POPULAR_FOREX = [
  // Majors
  { symbol: "EURUSD", alpacaSymbol: "EUR/USD", name: "Euro / US Dollar",                    base: "EUR", quote: "USD", type: "forex" },
  { symbol: "GBPUSD", alpacaSymbol: "GBP/USD", name: "British Pound / US Dollar",           base: "GBP", quote: "USD", type: "forex" },
  { symbol: "USDJPY", alpacaSymbol: "USD/JPY", name: "US Dollar / Japanese Yen",            base: "USD", quote: "JPY", type: "forex" },
  { symbol: "AUDUSD", alpacaSymbol: "AUD/USD", name: "Australian Dollar / US Dollar",       base: "AUD", quote: "USD", type: "forex" },
  { symbol: "USDCAD", alpacaSymbol: "USD/CAD", name: "US Dollar / Canadian Dollar",         base: "USD", quote: "CAD", type: "forex" },
  { symbol: "USDCHF", alpacaSymbol: "USD/CHF", name: "US Dollar / Swiss Franc",             base: "USD", quote: "CHF", type: "forex" },
  { symbol: "NZDUSD", alpacaSymbol: "NZD/USD", name: "New Zealand Dollar / US Dollar",      base: "NZD", quote: "USD", type: "forex" },
  // Minors
  { symbol: "EURGBP", alpacaSymbol: "EUR/GBP", name: "Euro / British Pound",               base: "EUR", quote: "GBP", type: "forex" },
  { symbol: "EURJPY", alpacaSymbol: "EUR/JPY", name: "Euro / Japanese Yen",                base: "EUR", quote: "JPY", type: "forex" },
  { symbol: "GBPJPY", alpacaSymbol: "GBP/JPY", name: "British Pound / Japanese Yen",       base: "GBP", quote: "JPY", type: "forex" },
  { symbol: "EURAUD", alpacaSymbol: "EUR/AUD", name: "Euro / Australian Dollar",           base: "EUR", quote: "AUD", type: "forex" },
  { symbol: "EURCHF", alpacaSymbol: "EUR/CHF", name: "Euro / Swiss Franc",                 base: "EUR", quote: "CHF", type: "forex" },
  { symbol: "EURCAD", alpacaSymbol: "EUR/CAD", name: "Euro / Canadian Dollar",             base: "EUR", quote: "CAD", type: "forex" },
  { symbol: "AUDCAD", alpacaSymbol: "AUD/CAD", name: "Australian Dollar / Canadian Dollar", base: "AUD", quote: "CAD", type: "forex" },
  { symbol: "AUDCHF", alpacaSymbol: "AUD/CHF", name: "Australian Dollar / Swiss Franc",    base: "AUD", quote: "CHF", type: "forex" },
  { symbol: "AUDJPY", alpacaSymbol: "AUD/JPY", name: "Australian Dollar / Japanese Yen",  base: "AUD", quote: "JPY", type: "forex" },
  { symbol: "CADJPY", alpacaSymbol: "CAD/JPY", name: "Canadian Dollar / Japanese Yen",    base: "CAD", quote: "JPY", type: "forex" },
  { symbol: "CADCHF", alpacaSymbol: "CAD/CHF", name: "Canadian Dollar / Swiss Franc",     base: "CAD", quote: "CHF", type: "forex" },
  { symbol: "CHFJPY", alpacaSymbol: "CHF/JPY", name: "Swiss Franc / Japanese Yen",        base: "CHF", quote: "JPY", type: "forex" },
  { symbol: "GBPAUD", alpacaSymbol: "GBP/AUD", name: "British Pound / Australian Dollar",  base: "GBP", quote: "AUD", type: "forex" },
  { symbol: "GBPCAD", alpacaSymbol: "GBP/CAD", name: "British Pound / Canadian Dollar",   base: "GBP", quote: "CAD", type: "forex" },
  { symbol: "GBPCHF", alpacaSymbol: "GBP/CHF", name: "British Pound / Swiss Franc",       base: "GBP", quote: "CHF", type: "forex" },
  { symbol: "NZDJPY", alpacaSymbol: "NZD/JPY", name: "New Zealand Dollar / Japanese Yen", base: "NZD", quote: "JPY", type: "forex" },
  { symbol: "NZDCAD", alpacaSymbol: "NZD/CAD", name: "New Zealand Dollar / Canadian Dollar", base: "NZD", quote: "CAD", type: "forex" },
  { symbol: "NZDCHF", alpacaSymbol: "NZD/CHF", name: "New Zealand Dollar / Swiss Franc",  base: "NZD", quote: "CHF", type: "forex" },
  // Dollar exotics
  { symbol: "USDNOK", alpacaSymbol: "USD/NOK", name: "US Dollar / Norwegian Krone",       base: "USD", quote: "NOK", type: "forex" },
  { symbol: "USDSEK", alpacaSymbol: "USD/SEK", name: "US Dollar / Swedish Krona",         base: "USD", quote: "SEK", type: "forex" },
  { symbol: "USDDKK", alpacaSymbol: "USD/DKK", name: "US Dollar / Danish Krone",          base: "USD", quote: "DKK", type: "forex" },
  { symbol: "USDSGD", alpacaSymbol: "USD/SGD", name: "US Dollar / Singapore Dollar",      base: "USD", quote: "SGD", type: "forex" },
  { symbol: "USDHKD", alpacaSymbol: "USD/HKD", name: "US Dollar / Hong Kong Dollar",      base: "USD", quote: "HKD", type: "forex" },
  { symbol: "USDMXN", alpacaSymbol: "USD/MXN", name: "US Dollar / Mexican Peso",          base: "USD", quote: "MXN", type: "forex" },
  { symbol: "USDZAR", alpacaSymbol: "USD/ZAR", name: "US Dollar / South African Rand",    base: "USD", quote: "ZAR", type: "forex" },
  { symbol: "USDTRY", alpacaSymbol: "USD/TRY", name: "US Dollar / Turkish Lira",          base: "USD", quote: "TRY", type: "forex" },
];

// ── Frankfurter (ECB) helpers for forex bars + quotes ────────────────────────
function parseForexPair(symbol: string): { base: string; quote: string } | null {
  const entry = POPULAR_FOREX.find(f => f.symbol === symbol || f.alpacaSymbol === symbol);
  if (entry) return { base: entry.base, quote: entry.quote };
  if (symbol.includes("/")) {
    const [base, quote] = symbol.split("/");
    if (base && quote) return { base, quote };
  }
  if (symbol.length === 6) return { base: symbol.slice(0, 3), quote: symbol.slice(3, 6) };
  return null;
}

async function fetchForexBars(symbol: string, startDate: string, limit: number): Promise<any[]> {
  const pair = parseForexPair(symbol);
  if (!pair) return [];
  const { base, quote } = pair;

  // Ensure we always fetch at least 30 days so short ranges (1D/1W) have enough bars
  const minStart = new Date();
  minStart.setDate(minStart.getDate() - 30);
  const effectiveStart = startDate < minStart.toISOString().split("T")[0]
    ? startDate
    : minStart.toISOString().split("T")[0];

  // Frankfurter: GET /startDate..?base=EUR&symbols=USD  (no end = up to today)
  const url = `https://api.frankfurter.app/${effectiveStart}..?base=${base}&symbols=${quote}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json() as any;

    const closes = Object.entries(data.rates ?? {})
      .map(([date, rates]) => ({
        date,
        c: (rates as Record<string, number>)[quote] ?? 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Synthesize OHLCV: open = previous day's close (standard forex bar construction)
    const bars = closes.map((bar, i) => {
      const o = i === 0 ? bar.c : closes[i - 1].c;
      const h = Math.max(o, bar.c);
      const l = Math.min(o, bar.c);
      return { t: `${bar.date}T00:00:00Z`, o, h, l, c: bar.c, v: 0 };
    });

    return bars.slice(-limit);
  } catch {
    return [];
  }
}

async function fetchForexQuote(symbol: string): Promise<{ price: number; prevClose: number | null; timestamp: string } | null> {
  const pair = parseForexPair(symbol);
  if (!pair) return null;
  const { base, quote } = pair;

  // Fetch last 5 trading days so we always have at least 2 data points across weekends
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const sinceStr = since.toISOString().split("T")[0];

  try {
    const response = await fetch(`https://api.frankfurter.app/${sinceStr}..?base=${base}&symbols=${quote}`);
    if (!response.ok) return null;
    const data = await response.json() as any;

    const entries = Object.entries(data.rates ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return null;

    const [lastDate, lastRates] = entries[entries.length - 1];
    const price = (lastRates as Record<string, number>)[quote] ?? 0;

    let prevClose: number | null = null;
    if (entries.length >= 2) {
      const [, prevRates] = entries[entries.length - 2];
      prevClose = (prevRates as Record<string, number>)[quote] ?? null;
    }

    return { price, prevClose, timestamp: `${lastDate}T00:00:00Z` };
  } catch {
    return null;
  }
}

function isForexSymbol(symbol: string): boolean {
  if (POPULAR_FOREX.some(f => f.symbol === symbol || f.alpacaSymbol === symbol)) return true;
  if (symbol.includes("/")) {
    const [base, quote] = symbol.split("/");
    return FOREX_CURRENCY_CODES.has(base) && FOREX_CURRENCY_CODES.has(quote);
  }
  if (symbol.length === 6) {
    const base  = symbol.slice(0, 3);
    const quote = symbol.slice(3, 6);
    return FOREX_CURRENCY_CODES.has(base) && FOREX_CURRENCY_CODES.has(quote) && base !== quote;
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

// ── Crypto helpers ────────────────────────────────────────────────────────────
function isCryptoSymbol(symbol: string): boolean {
  // Forex pairs must not be classified as crypto
  if (isForexSymbol(symbol)) return false;

  const cryptoSuffixes = ["USD", "USDT", "BTC", "ETH", "USDC"];
  const cryptoSymbols  = ["BTC", "ETH", "SOL", "ADA", "DOT", "AVAX", "MATIC", "LINK", "UNI", "AAVE", "XRP", "DOGE", "LTC", "BCH", "XLM"];

  if (symbol.includes("/")) return true; // crypto pairs like BTC/USD
  if (cryptoSymbols.includes(symbol)) return true;

  for (const suffix of cryptoSuffixes) {
    if (symbol.endsWith(suffix) && symbol.length > suffix.length) {
      const base = symbol.slice(0, -suffix.length);
      if (cryptoSymbols.includes(base)) return true;
    }
  }

  return POPULAR_CRYPTO.some(c => c.symbol === symbol || c.alpacaSymbol === symbol);
}

function normalizeCryptoSymbol(symbol: string): string {
  if (symbol.includes("/")) return symbol;

  const match = POPULAR_CRYPTO.find(c => c.symbol === symbol || c.alpacaSymbol === symbol);
  if (match) return match.alpacaSymbol;

  const cryptoSuffixes = ["USD", "USDT", "BTC", "ETH", "USDC"];
  for (const suffix of cryptoSuffixes) {
    if (symbol.endsWith(suffix) && symbol.length > suffix.length) {
      const base = symbol.slice(0, -suffix.length);
      return `${base}/${suffix}`;
    }
  }

  return symbol;
}

// ── Futures (commodities) ────────────────────────────────────────────────────
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
  // Accept Yahoo Finance format directly: e.g. "GC=F"
  if (/^[A-Z]{1,4}=F$/.test(symbol)) return true;
  return false;
}

function normalizeFuturesSymbol(symbol: string): string {
  const match = POPULAR_FUTURES.find(f => f.symbol === symbol || f.yahooTicker === symbol);
  if (match) return match.yahooTicker;
  // Already Yahoo format
  if (/^[A-Z]{1,4}=F$/.test(symbol)) return symbol;
  return `${symbol}=F`;
}

function mapTimeframeToYahoo(timeframe: string): string {
  switch (timeframe) {
    case "1Min":  return "1m";
    case "5Min":  return "5m";
    case "15Min": return "15m";
    case "1Hour": return "1h";
    case "4Hour": return "1h";
    case "1Day":  return "1d";
    case "1Week": return "1wk";
    default:      return "1d";
  }
}

const YAHOO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Referer": "https://finance.yahoo.com/",
};

async function fetchYahooFuturesBars(yahooTicker: string, timeframe: string, startDate: string, limit: number): Promise<any[]> {
  const interval = mapTimeframeToYahoo(timeframe);
  const period1  = Math.floor(new Date(startDate).getTime() / 1000);
  const period2  = Math.floor(Date.now() / 1000);

  for (const host of ["query1", "query2"]) {
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=${interval}&period1=${period1}&period2=${period2}`;
    try {
      const response = await fetch(url, { headers: YAHOO_HEADERS });
      if (!response.ok) continue;
      const data   = await response.json() as any;
      const result = data.chart?.result?.[0];
      if (!result) continue;

      const timestamps: number[] = result.timestamp ?? [];
      const q = result.indicators?.quote?.[0] ?? {};
      const bars = timestamps
        .map((ts, i) => ({
          t: new Date(ts * 1000).toISOString(),
          o: q.open?.[i]   ?? null,
          h: q.high?.[i]   ?? null,
          l: q.low?.[i]    ?? null,
          c: q.close?.[i]  ?? null,
          v: q.volume?.[i] ?? 0,
        }))
        .filter((bar) => bar.o != null && bar.c != null);

      return bars.slice(-limit);
    } catch { /* try next host */ }
  }
  return [];
}

async function fetchYahooFuturesQuote(yahooTicker: string): Promise<{
  price: number; change: number; changePercent: number;
  open: number; high: number; low: number; volume: number;
  prevClose: number; timestamp: string;
} | null> {
  for (const host of ["query1", "query2"]) {
    const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=1d&range=5d`;
    try {
      const response = await fetch(url, { headers: YAHOO_HEADERS });
      if (!response.ok) continue;
      const data   = await response.json() as any;
      const result = data.chart?.result?.[0];
      if (!result) continue;

      const meta       = result.meta ?? {};
      const price      = meta.regularMarketPrice ?? 0;
      const prevClose  = meta.previousClose ?? meta.chartPreviousClose ?? meta.regularMarketPreviousClose ?? price;
      const change     = price - prevClose;
      const pct        = prevClose !== 0 ? (change / prevClose) * 100 : 0;
      const ts         = meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString();

      return {
        price,
        change,
        changePercent: pct,
        open:   meta.regularMarketOpen        ?? price,
        high:   meta.regularMarketDayHigh     ?? price,
        low:    meta.regularMarketDayLow      ?? price,
        volume: meta.regularMarketVolume      ?? 0,
        prevClose,
        timestamp: ts,
      };
    } catch { /* try next host */ }
  }
  return null;
}

const POPULAR_CRYPTO = [
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

// ── Live trade streaming via SSE ─────────────────────────────────────────────
// GET /api/market/stream?symbol=AAPL&interval=1Min&token=JWT
// Connects to Alpaca's real-time WebSocket, forwards trades as SSE events so
// the frontend can assemble the forming (incomplete) current candle in real time.
router.get("/market/stream", optionalAuth, (req: Request, res: Response) => {
  if (!req.user) { res.status(401).end(); return; }

  const symbol   = (req.query.symbol   as string | undefined)?.toUpperCase().trim();
  const interval = (req.query.interval as string | undefined) ?? "1Min";

  if (!symbol) { res.status(400).json({ error: "symbol required" }); return; }

  const isCrypto  = /^[A-Z]{2,10}USD$/.test(symbol) && symbol.length >= 5;
  const isFutures = /[A-Z]=F$/.test(symbol);

  if (isFutures) {
    res.status(400).json({ error: "Futures real-time streaming is not supported" });
    return;
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: object) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* disconnected */ }
  };

  send("connected", { symbol, interval });

  // Alpaca WebSocket endpoint — IEX is free for all users; crypto has its own endpoint
  const wsUrl = isCrypto
    ? "wss://stream.data.alpaca.markets/v2/crypto"
    : "wss://stream.data.alpaca.markets/v2/iex";

  // Alpaca uses "BTC/USD" format for crypto subscriptions
  const wsSymbol = isCrypto ? `${symbol.slice(0, -3)}/${symbol.slice(-3)}` : symbol;

  let ws: WebSocket | null = null;
  let closed = false;

  function openWs() {
    if (closed) return;
    ws = new WebSocket(wsUrl);

    ws.on("open", () => {
      ws!.send(JSON.stringify({
        action: "auth",
        key:    ALPACA_API_KEY    ?? "",
        secret: ALPACA_API_SECRET ?? "",
      }));
    });

    ws.on("message", (raw: Buffer) => {
      let msgs: any[];
      try { msgs = JSON.parse(raw.toString()); } catch { return; }

      for (const msg of msgs) {
        if (msg.T === "success" && msg.msg === "authenticated") {
          ws!.send(JSON.stringify({ action: "subscribe", trades: [wsSymbol] }));
        } else if (msg.T === "t") {
          // Trade event — forward just price, size, and timestamp
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

    ws.on("close", () => {
      if (!closed) {
        // Reconnect after 5 s
        setTimeout(openWs, 5_000);
      }
    });
  }

  openWs();

  // Heartbeat every 25 s to keep SSE alive
  const heartbeat = setInterval(() => {
    try { res.write(":heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 25_000);

  req.on("close", () => {
    closed = true;
    clearInterval(heartbeat);
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
  });
});

export default router;
