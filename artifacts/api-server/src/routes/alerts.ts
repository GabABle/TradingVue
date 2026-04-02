import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: "above" | "below";
  email: string;
  createdAt: string;
  triggered: boolean;
  triggeredAt?: string;
  triggeredPrice?: number;
}

const alerts: PriceAlert[] = [];

// ── SSE clients ────────────────────────────────────────────────────────────────
let clientIdCounter = 0;
const sseClients = new Map<number, Response>();

function broadcast(data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients.values()) {
    try { res.write(payload); } catch { /* disconnected */ }
  }
}

router.get("/alerts/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const id = ++clientIdCounter;
  sseClients.set(id, res);

  const heartbeat = setInterval(() => {
    try { res.write(":heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 25_000);

  req.on("close", () => {
    sseClients.delete(id);
    clearInterval(heartbeat);
  });
});

// ── CRUD ───────────────────────────────────────────────────────────────────────
router.get("/alerts", (req: Request, res: Response) => {
  const sym = (req.query.symbol as string | undefined)?.toUpperCase();
  const active = alerts.filter(a => !a.triggered && (!sym || a.symbol === sym));
  res.json({ alerts: active });
});

router.post("/alerts", (req: Request, res: Response) => {
  const { symbol, targetPrice, condition, email } = req.body as {
    symbol?: string;
    targetPrice?: number | string;
    condition?: string;
    email?: string;
  };

  if (!symbol || targetPrice == null || !condition || !email) {
    res.status(400).json({ error: "symbol, targetPrice, condition, and email are required" });
    return;
  }
  if (condition !== "above" && condition !== "below") {
    res.status(400).json({ error: "condition must be 'above' or 'below'" });
    return;
  }
  const numPrice = Number(targetPrice);
  if (isNaN(numPrice) || numPrice <= 0) {
    res.status(400).json({ error: "targetPrice must be a positive number" });
    return;
  }

  const alert: PriceAlert = {
    id: Math.random().toString(36).slice(2, 10),
    symbol: symbol.toUpperCase(),
    targetPrice: numPrice,
    condition,
    email,
    createdAt: new Date().toISOString(),
    triggered: false,
  };
  alerts.push(alert);
  req.log.info({ alertId: alert.id, symbol: alert.symbol, targetPrice: alert.targetPrice }, "Price alert created");
  res.status(201).json({ alert });
});

router.delete("/alerts/:id", (req: Request, res: Response) => {
  const idx = alerts.findIndex(a => a.id === req.params.id && !a.triggered);
  if (idx === -1) {
    res.status(404).json({ error: "Alert not found" });
    return;
  }
  const [removed] = alerts.splice(idx, 1);
  res.json({ success: true, alert: removed });
});

// ── Email via Resend ──────────────────────────────────────────────────────────
async function sendAlertEmail(alert: PriceAlert, triggeredPrice: number) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const dir = alert.condition === "above" ? "risen above" : "dropped below";
  const priceColor = alert.condition === "above" ? "#26a69a" : "#ef5350";

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "TradingVue Alerts <onboarding@resend.dev>",
        to: [alert.email],
        subject: `🔔 ${alert.symbol} alert triggered — $${triggeredPrice.toFixed(2)}`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0e17;color:#d1d4dc;border-radius:12px;">
            <h2 style="margin:0 0 16px;color:#2962ff;font-size:20px;">🔔 TradingVue Price Alert</h2>
            <p style="margin:0 0 20px;color:#d1d4dc;">
              <strong style="color:#fff">${alert.symbol}</strong> has ${dir} your target of
              <strong style="color:#f59e0b">$${alert.targetPrice}</strong>.
            </p>
            <table style="width:100%;border-collapse:collapse;background:#1e222d;border-radius:8px;overflow:hidden;">
              <tr><td style="padding:10px 14px;color:#787b86;border-bottom:1px solid #2a2e39;">Symbol</td>
                  <td style="padding:10px 14px;font-family:monospace;font-weight:700;border-bottom:1px solid #2a2e39;">${alert.symbol}</td></tr>
              <tr><td style="padding:10px 14px;color:#787b86;border-bottom:1px solid #2a2e39;">Triggered price</td>
                  <td style="padding:10px 14px;font-family:monospace;font-weight:700;color:${priceColor};border-bottom:1px solid #2a2e39;">$${triggeredPrice.toFixed(2)}</td></tr>
              <tr><td style="padding:10px 14px;color:#787b86;border-bottom:1px solid #2a2e39;">Your target</td>
                  <td style="padding:10px 14px;font-family:monospace;border-bottom:1px solid #2a2e39;">$${alert.targetPrice} (${alert.condition})</td></tr>
              <tr><td style="padding:10px 14px;color:#787b86;">Alert created</td>
                  <td style="padding:10px 14px;font-size:12px;">${new Date(alert.createdAt).toLocaleString()}</td></tr>
            </table>
            <p style="margin:20px 0 0;font-size:11px;color:#4c525e;">Sent by TradingVue · This alert has now been deactivated.</p>
          </div>
        `,
      }),
    });
  } catch { /* email failures are non-fatal */ }
}

// ── Background price monitoring ────────────────────────────────────────────────
const SERVER_PORT = process.env.PORT ?? "8080";

async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const r = await fetch(
      `http://localhost:${SERVER_PORT}/api/market/quote?symbol=${encodeURIComponent(symbol)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return null;
    const d = await r.json() as { price?: number };
    return d.price ?? null;
  } catch { return null; }
}

async function checkAlerts() {
  const active = alerts.filter(a => !a.triggered);
  if (active.length === 0) return;

  const symbols = [...new Set(active.map(a => a.symbol))];
  const prices = new Map<string, number>();

  await Promise.all(symbols.map(async sym => {
    const p = await fetchCurrentPrice(sym);
    if (p != null) prices.set(sym, p);
  }));

  for (const alert of active) {
    const price = prices.get(alert.symbol);
    if (price == null) continue;

    const hit =
      (alert.condition === "above" && price >= alert.targetPrice) ||
      (alert.condition === "below" && price <= alert.targetPrice);

    if (hit) {
      alert.triggered = true;
      alert.triggeredAt = new Date().toISOString();
      alert.triggeredPrice = price;

      broadcast({ type: "alert_triggered", alert: { ...alert }, currentPrice: price });
      sendAlertEmail(alert, price).catch(() => {});
    }
  }
}

setInterval(checkAlerts, 30_000);

export default router;
