import { type Request, type Response, type NextFunction } from "express";
import { verifyToken, type JwtPayload } from "./jwt.js";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    req.user = verifyToken(auth.slice(7));
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization ?? (req.query.token ? `Bearer ${req.query.token}` : undefined);
  if (auth?.startsWith("Bearer ")) {
    try { req.user = verifyToken(auth.slice(7)); } catch { /* ignore */ }
  }
  next();
}
