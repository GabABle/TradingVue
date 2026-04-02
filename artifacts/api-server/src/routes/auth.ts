import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../lib/db.js";
import { signToken } from "../lib/jwt.js";
import { requireAuth } from "../lib/auth-middleware.js";

const router = Router();

// POST /api/auth/register
router.post("/auth/register", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  const u = username.trim().toLowerCase();
  if (u.length < 3 || u.length > 50) {
    res.status(400).json({ error: "Username must be 3–50 characters" });
    return;
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(u)) {
    res.status(400).json({ error: "Username may only contain letters, numbers, _ . -" });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters" });
    return;
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
      [u, hash],
    );
    const user = result.rows[0] as { id: number; username: string };
    const token = signToken({ userId: user.id, username: user.username });
    req.log.info({ userId: user.id, username: user.username }, "User registered");
    res.status(201).json({ token, user: { id: user.id, username: user.username } });
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "Username already taken" });
    } else {
      req.log.error(err, "Register error");
      res.status(500).json({ error: "Registration failed" });
    }
  }
});

// POST /api/auth/login
router.post("/auth/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }

  try {
    const result = await pool.query(
      "SELECT id, username, password_hash FROM users WHERE username = $1",
      [username.trim().toLowerCase()],
    );
    const user = result.rows[0] as { id: number; username: string; password_hash: string } | undefined;
    if (!user) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }
    const token = signToken({ userId: user.id, username: user.username });
    req.log.info({ userId: user.id, username: user.username }, "User logged in");
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    req.log.error(err, "Login error");
    res.status(500).json({ error: "Login failed" });
  }
});

// GET /api/auth/me
router.get("/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
