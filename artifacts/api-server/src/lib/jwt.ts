import jwt from "jsonwebtoken";

const SECRET = process.env.JWT_SECRET ?? "dev-fallback-secret-change-in-production";
const EXPIRY = "30d";

export interface JwtPayload {
  userId: number;
  username: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRY });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}
