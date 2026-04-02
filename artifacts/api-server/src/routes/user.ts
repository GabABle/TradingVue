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
    res.json({ symbols: (result.rows[0]?.symbols as string[]) ?? [] });
  } catch (err) {
    req.log.error(err, "Get watchlist failed");
    res.status(500).json({ error: "Failed to load watchlist" });
  }
});

router.put("/user/watchlist", requireAuth, async (req, res) => {
  const { userId } = req.user!;
  const { symbols } = req.body as { symbols?: unknown };
  if (!Array.isArray(symbols)) {
    res.status(400).json({ error: "symbols must be an array" });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO user_watchlists (user_id, symbols, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET symbols = $2::jsonb, updated_at = NOW()`,
      [userId, JSON.stringify(symbols)],
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

export default router;
