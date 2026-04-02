import { Router, type Request, type Response } from "express";
import { pool } from "../lib/db.js";
import { requireAuth, optionalAuth } from "../lib/auth-middleware.js";

const router = Router();

// ── SSE clients keyed by userId ────────────────────────────────────────────────
let clientIdCounter = 0;
const sseClients = new Map<number, { clientId: number; userId: number; res: Response }>();

function broadcastToUser(userId: number, data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients.values()) {
    if (client.userId === userId) {
      try { client.res.write(payload); } catch { /* disconnected */ }
    }
  }
}

// GET /api/alerts/events?token=JWT  (token in query because EventSource has no custom headers)
router.get("/alerts/events", optionalAuth, (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).end();
    return;
  }
  const { userId } = req.user;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const clientId = ++clientIdCounter;
  sseClients.set(clientId, { clientId, userId, res });

  const heartbeat = setInterval(() => {
    try { res.write(":heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 25_000);

  req.on("close", () => {
    sseClients.delete(clientId);
    clearInterval(heartbeat);
  });
});

// ── CRUD ───────────────────────────────────────────────────────────────────────

// GET /api/alerts?symbol=SYM
router.get("/alerts", requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.user!;
  const sym = (req.query.symbol as string | undefined)?.toUpperCase();
  try {
    const result = await pool.query(
      `SELECT id, symbol, target_price, condition, email, created_at
       FROM user_alerts
       WHERE user_id = $1 AND triggered = false ${sym ? "AND symbol = $2" : ""}
       ORDER BY created_at DESC`,
      sym ? [userId, sym] : [userId],
    );
    res.json({
      alerts: result.rows.map(r => ({
        id: r.id as string,
        symbol: r.symbol as string,
        targetPrice: parseFloat(r.target_price as string),
        condition: r.condition as string,
        email: r.email as string,
        createdAt: (r.created_at as Date).toISOString(),
      })),
    });
  } catch (err) {
    req.log.error(err, "Get alerts failed");
    res.status(500).json({ error: "Failed to load alerts" });
  }
});

// POST /api/alerts
router.post("/alerts", requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.user!;
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

  const id = Math.random().toString(36).slice(2, 14);
  try {
    await pool.query(
      `INSERT INTO user_alerts (id, user_id, symbol, target_price, condition, email)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, userId, symbol.toUpperCase(), numPrice, condition, email],
    );
    req.log.info({ alertId: id, symbol, targetPrice: numPrice }, "Alert created");
    res.status(201).json({
      alert: { id, symbol: symbol.toUpperCase(), targetPrice: numPrice, condition, email, createdAt: new Date().toISOString() },
    });
  } catch (err) {
    req.log.error(err, "Create alert failed");
    res.status(500).json({ error: "Failed to create alert" });
  }
});

// DELETE /api/alerts/:id
router.delete("/alerts/:id", requireAuth, async (req: Request, res: Response) => {
  const { userId } = req.user!;
  try {
    const result = await pool.query(
      "DELETE FROM user_alerts WHERE id = $1 AND user_id = $2 AND triggered = false RETURNING id",
      [req.params.id, userId],
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err, "Delete alert failed");
    res.status(500).json({ error: "Failed to delete alert" });
  }
});

// ── Email via Resend ──────────────────────────────────────────────────────────
async function sendAlertEmail(
  email: string,
  symbol: string,
  condition: string,
  targetPrice: number,
  triggeredPrice: number,
) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const dir = condition === "above" ? "risen above" : "dropped below";
  const priceColor = condition === "above" ? "#26a69a" : "#ef5350";

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "TradingVue Alerts <onboarding@resend.dev>",
        to: [email],
        subject: `🔔 ${symbol} alert triggered — $${triggeredPrice.toFixed(2)}`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0e17;color:#d1d4dc;border-radius:12px;">
            <h2 style="margin:0 0 16px;color:#2962ff;">🔔 TradingVue Price Alert</h2>
            <p style="margin:0 0 20px;"><strong style="color:#fff">${symbol}</strong> has ${dir} your target of <strong style="color:#f59e0b">$${targetPrice}</strong>.</p>
            <table style="width:100%;border-collapse:collapse;background:#1e222d;border-radius:8px;overflow:hidden;">
              <tr><td style="padding:10px 14px;color:#787b86;border-bottom:1px solid #2a2e39;">Symbol</td>
                  <td style="padding:10px 14px;font-family:monospace;font-weight:700;border-bottom:1px solid #2a2e39;">${symbol}</td></tr>
              <tr><td style="padding:10px 14px;color:#787b86;border-bottom:1px solid #2a2e39;">Triggered price</td>
                  <td style="padding:10px 14px;font-family:monospace;font-weight:700;color:${priceColor};border-bottom:1px solid #2a2e39;">$${triggeredPrice.toFixed(2)}</td></tr>
              <tr><td style="padding:10px 14px;color:#787b86;">Target</td>
                  <td style="padding:10px 14px;font-family:monospace;">$${targetPrice} (${condition})</td></tr>
            </table>
            <p style="margin:20px 0 0;font-size:11px;color:#4c525e;">Sent by TradingVue · This alert has been deactivated.</p>
          </div>`,
      }),
    });
  } catch { /* non-fatal */ }
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
  let rows: Array<{ id: string; user_id: number; symbol: string; target_price: string; condition: string; email: string }>;
  try {
    const result = await pool.query(
      "SELECT id, user_id, symbol, target_price, condition, email FROM user_alerts WHERE triggered = false",
    );
    rows = result.rows as typeof rows;
  } catch { return; }

  if (rows.length === 0) return;

  const symbols = [...new Set(rows.map(r => r.symbol))];
  const prices = new Map<string, number>();
  await Promise.all(symbols.map(async sym => {
    const p = await fetchCurrentPrice(sym);
    if (p != null) prices.set(sym, p);
  }));

  for (const row of rows) {
    const price = prices.get(row.symbol);
    if (price == null) continue;
    const targetPrice = parseFloat(row.target_price);
    const hit =
      (row.condition === "above" && price >= targetPrice) ||
      (row.condition === "below" && price <= targetPrice);

    if (hit) {
      try {
        await pool.query(
          "UPDATE user_alerts SET triggered = true, triggered_at = NOW(), triggered_price = $1 WHERE id = $2",
          [price, row.id],
        );
        broadcastToUser(row.user_id, {
          type: "alert_triggered",
          alert: { id: row.id, symbol: row.symbol, targetPrice, condition: row.condition },
          currentPrice: price,
        });
        sendAlertEmail(row.email, row.symbol, row.condition, targetPrice, price).catch(() => {});
      } catch { /* ignore individual failures */ }
    }
  }
}

setInterval(checkAlerts, 30_000);

export default router;
