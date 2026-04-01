import { Router, type IRouter } from "express";

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
    const isForex  = isForexSymbol(upperSymbol);
    const isCrypto = !isForex && isCryptoSymbol(upperSymbol);

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

    if (isForex) {
      const fxSymbol = normalizeForexSymbol(upperSymbol);
      barsKey = fxSymbol;
      url = `${DATA_V1B3_URL}/forex/bars?symbols=${encodeURIComponent(fxSymbol)}&${params.toString()}`;
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
    const isForex  = isForexSymbol(upperSymbol);
    const isCrypto = !isForex && isCryptoSymbol(upperSymbol);

    // ── Forex ────────────────────────────────────────────────────────────────
    if (isForex) {
      const fxSymbol = normalizeForexSymbol(upperSymbol);
      const session  = getForexSession();

      const ratesUrl = `${DATA_V1B3_URL}/forex/latest/rates?currency_pairs=${encodeURIComponent(fxSymbol)}`;
      const barsUrl  = `${DATA_V1B3_URL}/forex/bars?symbols=${encodeURIComponent(fxSymbol)}&timeframe=1Day&limit=2&sort=desc`;

      const [ratesResp, barsResp] = await Promise.all([
        fetch(ratesUrl, { headers: alpacaHeaders() }),
        fetch(barsUrl,  { headers: alpacaHeaders() }),
      ]);

      if (!ratesResp.ok) {
        res.status(ratesResp.status).json({ error: "Not Found", message: `No quote found for ${upperSymbol}` });
        return;
      }

      const ratesData = await ratesResp.json() as any;
      const rate      = ratesData.rates?.[fxSymbol];

      if (!rate) {
        res.status(404).json({ error: "Not Found", message: `No rate found for ${fxSymbol}` });
        return;
      }

      // mid price is the primary displayed price
      const price: number = rate.mp ?? rate.ap ?? rate.bp ?? 0;

      // prev close from daily bars
      let prevClose: number | null = null;
      if (barsResp.ok) {
        const barsData = await barsResp.json() as any;
        const dailyBars: any[] = barsData.bars?.[fxSymbol] ?? [];
        // bars come newest-first (sort=desc); index 0 = today's bar (open), index 1 = yesterday
        if (dailyBars.length >= 2) prevClose = dailyBars[1].c;
        else if (dailyBars.length === 1) prevClose = dailyBars[0].o;
      }

      const change        = prevClose != null ? price - prevClose : 0;
      const changePercent = prevClose && prevClose !== 0 ? (change / prevClose) * 100 : 0;

      res.set("Cache-Control", "no-cache");
      res.json({
        symbol:    upperSymbol,
        price,
        change,
        changePercent,
        open:      0,
        high:      0,
        low:       0,
        volume:    0,
        session,
        prevClose,
        regularClose: prevClose,
        timestamp: rate.t ?? new Date().toISOString(),
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
    const pm       = getPreMarketWindow();
    const pmUrl    = `${DATA_BASE_URL}/stocks/${upperSymbol}/bars?timeframe=1Min&start=${encodeURIComponent(pm.start)}&end=${encodeURIComponent(pm.end)}&feed=sip&sort=desc&limit=1&adjustment=raw`;

    const [snapResponse, pmResponse] = await Promise.all([
      fetch(snapUrl, { headers: alpacaHeaders() }),
      fetch(pmUrl,  { headers: alpacaHeaders() }),
    ]);

    if (!snapResponse.ok) {
      res.status(snapResponse.status).json({ error: "Not Found", message: `No quote found for ${upperSymbol}` });
      return;
    }

    const snap = await snapResponse.json() as any;

    let preMarketPrice: number | null = null;
    if (pmResponse.ok) {
      const pmData  = await pmResponse.json() as any;
      const pmBars: any[] = pmData.bars ?? [];
      if (pmBars.length > 0) preMarketPrice = pmBars[0].c;
    }

    const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;

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
      ...forexMatches,
      ...cryptoMatches.map((c) => ({ ...c, type: "crypto" as const })),
      ...stockResults.filter(
        (s) =>
          !cryptoMatches.some((c) => c.symbol === s.symbol) &&
          !forexMatches.some((f) => f.symbol === s.symbol)
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
    const isForex  = isForexSymbol(upperSymbol);
    const isCrypto = !isForex && isCryptoSymbol(upperSymbol);

    let searchQuery: string;
    let yahooTicker: string;

    if (isForex) {
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
        if (!isCrypto && !isForex) {
          const idx = tickers.indexOf(yahooTicker);
          if (idx === -1)                        tier = 3;
          else if (tickers.length === 1)         tier = 0;
          else if (idx === 0 && tickers.length <= 3) tier = 1;
          else                                   tier = 2;
        }
        return { ...a, _tier: tier };
      })
      .filter((a: any) => isCrypto || isForex || a._tier < 3)
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

export default router;
