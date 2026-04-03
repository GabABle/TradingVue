import { Router, type Request, type Response } from "express";
import { requireAuth } from "../lib/auth-middleware.js";

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

// ── GET /api/trading/account ─────────────────────────────────────────────────
router.get("/trading/account", requireAuth, async (_req: Request, res: Response) => {
  try {
    const account = await alpacaFetch("/account");
    res.json(account);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to fetch account" });
  }
});

// ── GET /api/trading/positions ───────────────────────────────────────────────
router.get("/trading/positions", requireAuth, async (_req: Request, res: Response) => {
  try {
    const positions = await alpacaFetch("/positions");
    res.json(positions);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to fetch positions" });
  }
});

// ── GET /api/trading/orders ──────────────────────────────────────────────────
router.get("/trading/orders", requireAuth, async (_req: Request, res: Response) => {
  try {
    const orders = await alpacaFetch("/orders?status=all&limit=30&direction=desc");
    res.json(orders);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to fetch orders" });
  }
});

// ── POST /api/trading/orders ─────────────────────────────────────────────────
router.post("/trading/orders", requireAuth, async (req: Request, res: Response) => {
  try {
    const { symbol, qty, side, type, time_in_force, limit_price } = req.body as {
      symbol: string;
      qty: number | string;
      side: "buy" | "sell";
      type: "market" | "limit";
      time_in_force: string;
      limit_price?: number | string;
    };

    // Alpaca crypto symbols (e.g. BTCUSD, ETHUSD) require "gtc" — "day" is invalid for crypto
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

    const order = await alpacaFetch("/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
    res.json(order);
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to place order" });
  }
});

// ── DELETE /api/trading/orders/:id ───────────────────────────────────────────
router.delete("/trading/orders/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await alpacaFetch(`/orders/${req.params["id"]}`, { method: "DELETE" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to cancel order" });
  }
});

export default router;
