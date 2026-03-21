import { Router, type IRouter } from "express";

const router: IRouter = Router();

const ALPACA_API_KEY = process.env.ALPACA_API_KEY;
const ALPACA_API_SECRET = process.env.ALPACA_API_SECRET;

const DATA_BASE_URL = "https://data.alpaca.markets/v2";

function alpacaHeaders() {
  return {
    "APCA-API-KEY-ID": ALPACA_API_KEY ?? "",
    "APCA-API-SECRET-KEY": ALPACA_API_SECRET ?? "",
    Accept: "application/json",
  };
}

router.get("/market/bars", async (req, res) => {
  try {
    const { symbol, timeframe, start, end, limit = "200", feed } = req.query as Record<string, string>;

    if (!symbol || !timeframe) {
      res.status(400).json({ error: "Bad Request", message: "symbol and timeframe are required" });
      return;
    }

    const upperSymbol = symbol.toUpperCase();
    const isCrypto = isCryptoSymbol(upperSymbol);

    const params = new URLSearchParams({
      timeframe,
      limit: limit ?? "200",
    });
    // "adjustment" is a stocks-only parameter — the crypto endpoint rejects it
    if (!isCrypto) params.set("adjustment", "raw");

    if (start) {
      params.set("start", start);
    } else {
      const defaultStart = getDefaultStart(timeframe);
      params.set("start", defaultStart);
    }
    if (end) params.set("end", end);
    if (feed) params.set("feed", feed);

    let url: string;
    if (isCrypto) {
      const cryptoSymbol = normalizeCryptoSymbol(upperSymbol);
      url = `https://data.alpaca.markets/v1beta3/crypto/us/bars?symbols=${cryptoSymbol}&${params.toString()}`;
    } else {
      url = `${DATA_BASE_URL}/stocks/${upperSymbol}/bars?${params.toString()}`;
    }

    const response = await fetch(url, {
      headers: alpacaHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      req.log.error({ status: response.status, error: errorText }, "Alpaca bars error");
      res.status(response.status).json({
        error: "Alpaca API Error",
        message: errorText,
      });
      return;
    }

    const data = await response.json() as any;

    let bars: any[] = [];
    if (isCrypto) {
      const cryptoSymbol = normalizeCryptoSymbol(upperSymbol);
      bars = data.bars?.[cryptoSymbol] ?? data.bars ?? [];
    } else {
      bars = data.bars ?? [];
    }

    res.json({
      symbol: upperSymbol,
      bars,
      nextPageToken: data.next_page_token ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching bars");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to fetch bars" });
  }
});

router.get("/market/quote", async (req, res) => {
  try {
    const { symbol } = req.query as Record<string, string>;

    if (!symbol) {
      res.status(400).json({ error: "Bad Request", message: "symbol is required" });
      return;
    }

    const upperSymbol = symbol.toUpperCase();
    const isCrypto = isCryptoSymbol(upperSymbol);

    if (isCrypto) {
      // ── Crypto: use v1beta3 snapshot which includes prevDailyBar ────────────
      const cryptoSymbol = normalizeCryptoSymbol(upperSymbol);
      const url = `https://data.alpaca.markets/v1beta3/crypto/us/snapshots?symbols=${encodeURIComponent(cryptoSymbol)}`;
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

      // Current price: latest trade > daily bar close > prev daily bar close
      const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? snap.prevDailyBar?.c ?? 0;
      const prevClose = snap.prevDailyBar?.c ?? snap.dailyBar?.o ?? price;
      const change = price - prevClose;
      const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

      res.json({
        symbol: upperSymbol,
        price,
        change,
        changePercent,
        open:   snap.dailyBar?.o   ?? 0,
        high:   snap.dailyBar?.h   ?? 0,
        low:    snap.dailyBar?.l   ?? 0,
        volume: snap.dailyBar?.v   ?? 0,
        timestamp: snap.latestTrade?.t ?? snap.dailyBar?.t ?? new Date().toISOString(),
      });
    } else {
      // ── Equity: use snapshot endpoint which includes prevDailyBar ───────────
      const url = `${DATA_BASE_URL}/stocks/${upperSymbol}/snapshot`;
      const response = await fetch(url, { headers: alpacaHeaders() });

      if (!response.ok) {
        res.status(response.status).json({ error: "Not Found", message: `No quote found for ${upperSymbol}` });
        return;
      }

      const snap = await response.json() as any;

      // Current price: latest trade > daily bar close
      const price = snap.latestTrade?.p ?? snap.dailyBar?.c ?? 0;
      // Previous close is prevDailyBar.c; fall back to dailyBar open if missing
      const prevClose = snap.prevDailyBar?.c ?? snap.dailyBar?.o ?? price;
      const change = price - prevClose;
      const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

      res.json({
        symbol: upperSymbol,
        price,
        change,
        changePercent,
        open:   snap.dailyBar?.o   ?? 0,
        high:   snap.dailyBar?.h   ?? 0,
        low:    snap.dailyBar?.l   ?? 0,
        volume: snap.dailyBar?.v   ?? 0,
        timestamp: snap.latestTrade?.t ?? snap.dailyBar?.t ?? new Date().toISOString(),
      });
    }
  } catch (err) {
    req.log.error({ err }, "Error fetching quote");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to fetch quote" });
  }
});

// ── Asset list cache (refreshed once per hour) ──────────────────────────────
let _assetsCache: any[] | null = null;
let _assetsCacheTime = 0;
const ASSETS_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getEquityAssets(): Promise<any[]> {
  if (_assetsCache && Date.now() - _assetsCacheTime < ASSETS_TTL_MS) {
    return _assetsCache;
  }
  // Try paper-api first, then live; both accept the same key/secret pair
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
  return _assetsCache ?? []; // return stale cache if both fail
}

router.get("/market/search", async (req, res) => {
  try {
    const { query } = req.query as Record<string, string>;

    if (!query) {
      res.status(400).json({ error: "Bad Request", message: "query is required" });
      return;
    }

    const upperQuery = query.toUpperCase();

    // ── 1. Crypto matches from hard-coded list ──────────────────────────────
    const cryptoMatches = POPULAR_CRYPTO.filter(
      (c) =>
        c.symbol.includes(upperQuery) ||
        c.name.toUpperCase().includes(upperQuery)
    ).slice(0, 4);

    // ── 2. Equity matches from cached assets list ───────────────────────────
    const assets = await getEquityAssets();
    const stockResults: any[] = assets
      .filter(
        (a: any) =>
          a.tradable &&
          (a.symbol.startsWith(upperQuery) ||
            (a.name && a.name.toUpperCase().includes(upperQuery)))
      )
      // Exact symbol matches first
      .sort((a: any, b: any) => {
        const aExact = a.symbol === upperQuery ? 0 : a.symbol.startsWith(upperQuery) ? 1 : 2;
        const bExact = b.symbol === upperQuery ? 0 : b.symbol.startsWith(upperQuery) ? 1 : 2;
        return aExact - bExact;
      })
      .slice(0, 8)
      .map((a: any) => ({
        symbol: a.symbol,
        name: a.name ?? a.symbol,
        exchange: a.exchange ?? "US",
        type: "stock",
      }));

    // ── 3. If asset cache is still loading, try a direct exact-symbol lookup ─
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
                symbol: a.symbol,
                name: a.name ?? a.symbol,
                exchange: a.exchange ?? "US",
                type: "stock",
              });
            }
            break;
          }
        } catch { /* ignore */ }
      }
    }

    const results = [
      ...cryptoMatches,
      ...stockResults.filter((s) => !cryptoMatches.some((c) => c.symbol === s.symbol)),
    ].slice(0, 12);

    res.json({ results });
  } catch (err) {
    req.log.error({ err }, "Error searching symbols");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to search symbols" });
  }
});

// ── Yahoo Finance news cache (5-minute TTL per symbol) ──────────────────────
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

  // Try query2 first, then query1 as fallback
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
  return _newsCache.get(ticker)?.articles ?? []; // return stale cache if both fail
}

router.get("/market/news", async (req, res) => {
  try {
    const { symbol } = req.query as Record<string, string>;

    if (!symbol) {
      res.status(400).json({ error: "Bad Request", message: "symbol is required" });
      return;
    }

    const upperSymbol = symbol.toUpperCase();
    const isCrypto = isCryptoSymbol(upperSymbol);

    // For crypto, search by human name (e.g. "Bitcoin") — Yahoo Finance search doesn't
    // understand "BTC-USD" as a news query.  For stocks, the ticker works well.
    let searchQuery: string;
    let yahooTicker: string;

    if (upperSymbol.includes("/")) {
      // e.g. ETH/USD → ETH-USD
      yahooTicker = upperSymbol.replace("/", "-");
      const cryptoEntry = POPULAR_CRYPTO.find(c => c.alpacaSymbol === upperSymbol);
      searchQuery = cryptoEntry?.name ?? upperSymbol.split("/")[0];
    } else if (isCrypto) {
      // e.g. BTCUSD → BTC-USD, search by name
      const base = upperSymbol.replace(/USD(T|C)?$/, "").replace(/USD$/, "");
      yahooTicker = `${base}-USD`;
      const cryptoEntry = POPULAR_CRYPTO.find(c => c.symbol === upperSymbol || c.alpacaSymbol === `${base}/USD`);
      searchQuery = cryptoEntry?.name ?? base;
    } else {
      yahooTicker = upperSymbol;
      searchQuery = upperSymbol;
    }

    const raw = await fetchYahooNews(searchQuery);

    // Relevance scoring for stocks:
    //   tier 0 — ticker is sole related ticker (most specific)
    //   tier 1 — ticker is listed first among 2–3 others (primary subject)
    //   tier 2 — ticker is listed but not primary, or article has many symbols
    // For crypto: name-search already returns relevant articles; sort by recency.
    const scored = [...raw]
      .filter((a: any) => a.type === "STORY" || a.type === "VIDEO")
      .map((a: any) => {
        const tickers: string[] = a.relatedTickers ?? [];
        let tier = 3; // default: not related
        if (!isCrypto) {
          const idx = tickers.indexOf(yahooTicker);
          if (idx === -1) {
            tier = 3;
          } else if (tickers.length === 1) {
            tier = 0; // sole ticker — most targeted
          } else if (idx === 0 && tickers.length <= 3) {
            tier = 1; // primary ticker, small symbol set
          } else {
            tier = 2; // secondary mention or large symbol set
          }
        }
        return { ...a, _tier: tier };
      })
      .filter((a: any) => isCrypto || a._tier < 3) // for stocks, drop articles with no ticker match
      .sort((a, b) => {
        if (a._tier !== b._tier) return a._tier - b._tier;
        return (b.providerPublishTime ?? 0) - (a.providerPublishTime ?? 0);
      });

    const articles = scored.slice(0, 5).map((a: any) => ({
      id: a.uuid,
      headline: a.title,
      source: a.publisher ?? "",
      url: a.link,
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

function getDefaultStart(timeframe: string): string {
  const now = new Date();
  let daysBack = 365;
  if (timeframe === "1Min") daysBack = 3;
  else if (timeframe === "5Min") daysBack = 7;
  else if (timeframe === "15Min") daysBack = 14;
  else if (timeframe === "30Min") daysBack = 21;
  else if (timeframe === "1Hour") daysBack = 60;
  else if (timeframe === "4Hour") daysBack = 180;
  else if (timeframe === "1Day") daysBack = 730;
  else if (timeframe === "1Week") daysBack = 1825;
  now.setDate(now.getDate() - daysBack);
  return now.toISOString().split("T")[0];
}

function isCryptoSymbol(symbol: string): boolean {
  const cryptoSuffixes = ["USD", "USDT", "BTC", "ETH", "USDC"];
  const cryptoSymbols = ["BTC", "ETH", "SOL", "ADA", "DOT", "AVAX", "MATIC", "LINK", "UNI", "AAVE", "XRP", "DOGE", "LTC", "BCH", "XLM"];
  
  if (symbol.includes("/")) return true;
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
  { symbol: "BTCUSD", alpacaSymbol: "BTC/USD", name: "Bitcoin", exchange: "Crypto", type: "crypto" },
  { symbol: "ETHUSD", alpacaSymbol: "ETH/USD", name: "Ethereum", exchange: "Crypto", type: "crypto" },
  { symbol: "SOLUSD", alpacaSymbol: "SOL/USD", name: "Solana", exchange: "Crypto", type: "crypto" },
  { symbol: "ADAUSD", alpacaSymbol: "ADA/USD", name: "Cardano", exchange: "Crypto", type: "crypto" },
  { symbol: "DOTUSD", alpacaSymbol: "DOT/USD", name: "Polkadot", exchange: "Crypto", type: "crypto" },
  { symbol: "DOGEUSD", alpacaSymbol: "DOGE/USD", name: "Dogecoin", exchange: "Crypto", type: "crypto" },
  { symbol: "LINKUSD", alpacaSymbol: "LINK/USD", name: "Chainlink", exchange: "Crypto", type: "crypto" },
  { symbol: "AVAXUSD", alpacaSymbol: "AVAX/USD", name: "Avalanche", exchange: "Crypto", type: "crypto" },
  { symbol: "MATICUSD", alpacaSymbol: "MATIC/USD", name: "Polygon", exchange: "Crypto", type: "crypto" },
  { symbol: "XRPUSD", alpacaSymbol: "XRP/USD", name: "Ripple", exchange: "Crypto", type: "crypto" },
  { symbol: "LTCUSD", alpacaSymbol: "LTC/USD", name: "Litecoin", exchange: "Crypto", type: "crypto" },
  { symbol: "UNIUSD", alpacaSymbol: "UNI/USD", name: "Uniswap", exchange: "Crypto", type: "crypto" },
];

export default router;
