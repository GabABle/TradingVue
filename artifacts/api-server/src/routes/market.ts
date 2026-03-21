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

    const params = new URLSearchParams({
      timeframe,
      limit: limit ?? "200",
      adjustment: "raw",
    });

    if (start) {
      params.set("start", start);
    } else {
      const defaultStart = getDefaultStart(timeframe);
      params.set("start", defaultStart);
    }
    if (end) params.set("end", end);
    if (feed) params.set("feed", feed);

    const upperSymbol = symbol.toUpperCase();

    const isCrypto = isCryptoSymbol(upperSymbol);

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

    let latestBar: any = null;

    if (isCrypto) {
      const cryptoSymbol = normalizeCryptoSymbol(upperSymbol);
      const url = `https://data.alpaca.markets/v1beta3/crypto/us/latest/bars?symbols=${cryptoSymbol}`;
      const response = await fetch(url, { headers: alpacaHeaders() });
      if (response.ok) {
        const data = await response.json() as any;
        latestBar = data.bars?.[cryptoSymbol] ?? null;
      }
    } else {
      const url = `${DATA_BASE_URL}/stocks/${upperSymbol}/bars/latest`;
      const response = await fetch(url, { headers: alpacaHeaders() });
      if (response.ok) {
        const data = await response.json() as any;
        latestBar = data.bar ?? null;
      }
    }

    if (!latestBar) {
      res.status(404).json({ error: "Not Found", message: `No quote found for ${upperSymbol}` });
      return;
    }

    const price = latestBar.c ?? 0;
    const open = latestBar.o ?? 0;
    const change = price - open;
    const changePercent = open !== 0 ? (change / open) * 100 : 0;

    res.json({
      symbol: upperSymbol,
      price,
      change,
      changePercent,
      open: latestBar.o ?? 0,
      high: latestBar.h ?? 0,
      low: latestBar.l ?? 0,
      volume: latestBar.v ?? 0,
      timestamp: latestBar.t ?? new Date().toISOString(),
    });
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
