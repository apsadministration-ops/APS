import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const isProd = process.env.NODE_ENV === "production";
const rawSecret = process.env.SESSION_SECRET;

if (isProd && (!rawSecret || rawSecret.length < 32)) {
  throw new Error(
    "SESSION_SECRET is required in production and must be at least 32 characters. " +
    "Set it via the secrets panel before deploying.",
  );
}

const JWT_SECRET: string = rawSecret ?? "aps-dev-only-do-not-use-in-prod-secret";

export const ACCESS_TOKEN_TTL = "7d";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: { userId: number; role: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyToken(token: string): { userId: number; role: string } {
  return jwt.verify(token, JWT_SECRET) as { userId: number; role: string };
}
