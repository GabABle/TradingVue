import { Router } from "express";
import { pool } from "../lib/db.js";
import { requireAuth } from "../lib/auth-middleware.js";

const router = Router();

// ── Watchlist ──────────────────────────────────────────────────────────────────

router.get("/user/watchlist", requireAuth, async (req, res) => {
  const { userId } = req.user!;
  try {
    const result = await pool.query(
      "SELECT symbols FROM user_watchlists WHERE user_id = $1",
      [userId],
    );
    const data = result.rows[0]?.symbols;

    if (!data) {
      // No record yet
      res.json({ sections: null });
      return;
    }

    // Detect format: new = array of section objects, old = array of strings
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
      res.json({ sections: data });
    } else {
      // Old flat-symbols format — return as-is so client can migrate
      res.json({ symbols: (data as string[]) });
    }
  } catch (err) {
    req.log.error(err, "Get watchlist failed");
    res.status(500).json({ error: "Failed to load watchlist" });
  }
});

router.put("/user/watchlist", requireAuth, async (req, res) => {
  const { userId } = req.user!;
  const body = req.body as { sections?: unknown; symbols?: unknown };

  // Accept either sections (new) or symbols (old/compat)
  const data = body.sections ?? body.symbols;
  if (!Array.isArray(data)) {
    res.status(400).json({ error: "sections must be an array" });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO user_watchlists (user_id, symbols, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET symbols = $2::jsonb, updated_at = NOW()`,
      [userId, JSON.stringify(data)],
    );
    res.json({ success: true });
  } catch (err) {
    req.log.error(err, "Save watchlist failed");
    res.status(500).json({ error: "Failed to save watchlist" });
  }
});

// ── Preferences (chart state) ─────────────────────────────────────────────────

router.get("/user/preferences", requireAuth, async (req, res) => {
  const { userId } = req.user!;
  try {
    const result = await pool.query(
      "SELECT state FROM user_preferences WHERE user_id = $1",
      [userId],
    );
    res.json({ state: (result.rows[0]?.state as object) ?? {} });
  } catch (err) {
    req.log.error(err, "Get preferences failed");
    res.status(500).json({ error: "Failed to load preferences" });
  }
});

router.put("/user/preferences", requireAuth, async (req, res) => {
  const { userId } = req.user!;
  const { state } = req.body as { state?: unknown };
  if (!state || typeof state !== "object") {
    res.status(400).json({ error: "state must be an object" });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO user_preferences (user_id, state, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET state = $2::jsonb, updated_at = NOW()`,
      [userId, JSON.stringify(state)],
    );
    res.json({ success: true });
  } catch (err) {
    req.log.error(err, "Save preferences failed");
    res.status(500).json({ error: "Failed to save preferences" });
  }
});

// ── Portfolio tags (simple symbol tagging, no details) ────────────────────────

router.get("/user/portfolio", requireAuth, async (req, res) => {
  const { userId } = req.user!;
  try {
    const result = await pool.query(
      "SELECT symbol FROM user_portfolio WHERE user_id = $1 ORDER BY symbol",
      [userId],
    );
    res.json({ symbols: result.rows.map((r: { symbol: string }) => r.symbol) });
  } catch (err) {
    req.log.error(err, "Get portfolio failed");
    res.status(500).json({ error: "Failed to load portfolio" });
  }
});

router.put("/user/portfolio/:symbol", requireAuth, async (req, res) => {
  const { userId } = req.user!;
  const symbol = (req.params.symbol as string).toUpperCase();
  try {
    await pool.query(
      `INSERT INTO user_portfolio (user_id, symbol, shares, avg_cost, notes, updated_at)
       VALUES ($1, $2, 0, 0, '', NOW())
       ON CONFLICT (user_id, symbol) DO NOTHING`,
      [userId, symbol],
    );
    res.json({ success: true });
  } catch (err) {
    req.log.error(err, "Tag portfolio symbol failed");
    res.status(500).json({ error: "Failed to tag symbol" });
  }
});

router.delete("/user/portfolio/:symbol", requireAuth, async (req, res) => {
  const { userId } = req.user!;
  const symbol = (req.params.symbol as string).toUpperCase();
  try {
    await pool.query("DELETE FROM user_portfolio WHERE user_id = $1 AND symbol = $2", [userId, symbol]);
    res.json({ success: true });
  } catch (err) {
    req.log.error(err, "Untag portfolio symbol failed");
    res.status(500).json({ error: "Failed to untag symbol" });
  }
});

export default router;
