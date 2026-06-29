import { Router, type Request, type Response } from "express";

// Paper-trading relay. Auth removed: there are no server-side accounts. Orders
// use the shared Alpaca paper-trading credentials from the environment.
const router = Router();

const PAPER_BASE = "https://paper-api.alpaca.markets/v2";

function getAlpacaHeaders() {
  const key = process.env["ALPACA_PAPER_API_KEY"] ?? process.env["ALPACA_API_KEY"] ?? "";
  const sec = process.env["ALPACA_PAPER_API_SECRET"] ?? process.env["ALPACA_API_SECRET"] ?? "";
  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": sec,
    "Content-Type": "application/json",
  };
}

async function alpacaFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${PAPER_BASE}${path}`, {
    ...options,
    headers: { ...getAlpacaHeaders(), ...(options.headers as Record<string, string> ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = (JSON.parse(text) as { message?: string }).message ?? text; } catch { /* raw text */ }
    const err: { status: number; message: string } = { status: res.status, message: msg };
    throw err;
  }
  try { return JSON.parse(text); } catch { return {}; }
}

router.get("/trading/account", async (_req: Request, res: Response) => {
  try {
    res.json(await alpacaFetch("/account"));
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to fetch account" });
  }
});

router.get("/trading/positions", async (_req: Request, res: Response) => {
  try {
    res.json(await alpacaFetch("/positions"));
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to fetch positions" });
  }
});

router.get("/trading/orders", async (_req: Request, res: Response) => {
  try {
    res.json(await alpacaFetch("/orders?status=all&limit=30&direction=desc"));
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to fetch orders" });
  }
});

router.post("/trading/orders", async (req: Request, res: Response) => {
  try {
    const { symbol, qty, side, type, time_in_force, limit_price } = req.body as {
      symbol: string;
      qty: number | string;
      side: "buy" | "sell";
      type: "market" | "limit";
      time_in_force: string;
      limit_price?: number | string;
    };

    const sym = symbol.toUpperCase();
    const isCrypto = /^[A-Z]{2,10}USD$/.test(sym) && sym.length >= 5;
    const resolvedTif = isCrypto ? "gtc" : (time_in_force ?? "day");

    const body: Record<string, string> = {
      symbol: sym,
      qty: String(qty),
      side,
      type,
      time_in_force: resolvedTif,
    };
    if (type === "limit" && limit_price) {
      body["limit_price"] = String(limit_price);
    }

    res.json(await alpacaFetch("/orders", { method: "POST", body: JSON.stringify(body) }));
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to place order" });
  }
});

router.delete("/trading/orders/:id", async (req: Request, res: Response) => {
  try {
    await alpacaFetch(`/orders/${req.params["id"]}`, { method: "DELETE" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to cancel order" });
  }
});

export default router;
