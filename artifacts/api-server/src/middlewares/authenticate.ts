import { type Request, type Response, type NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { verifyToken } from "../lib/auth";

export interface AuthUser {
  id: number;
  role: "customer" | "mechanic" | "admin" | "shop_owner";
  status: "active" | "pending" | "suspended";
  email: string;
  name: string;
}

export interface AuthRequest extends Request {
  userId?: number;
  userRole?: string;
  user?: AuthUser;
}

/**
 * Verifies the JWT, loads the user from the DB, and rejects suspended accounts.
 * The DB lookup is intentional: it lets `status` changes (e.g. an admin
 * suspending an account) take effect on the very next request, instead of
 * waiting for the JWT to expire. It also lets every downstream handler trust
 * `req.user.role` and `req.user.status` rather than the JWT payload, which
 * could be stale after a role change.
 */
export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  let payload: { userId: number; role: string };
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  const [u] = await db
    .select({
      id: usersTable.id,
      role: usersTable.role,
      status: usersTable.status,
      email: usersTable.email,
      name: usersTable.name,
    })
    .from(usersTable)
    .where(eq(usersTable.id, payload.userId));
  if (!u) {
    res.status(401).json({ error: "Account no longer exists" });
    return;
  }
  if (u.status === "suspended") {
    res.status(403).json({ error: "Account suspended. Contact support." });
    return;
  }
  req.userId = u.id;
  req.userRole = u.role;
  req.user = u as AuthUser;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}

/**
 * Mechanic-only AND requires the mechanic to be `active` (admin-approved).
 * Pending/suspended mechanics can log in but cannot accept jobs, submit work
 * logs, or onboard for payouts. This is the single chokepoint for every
 * sensitive mechanic action — DO NOT inline `req.userRole === "mechanic"`
 * checks elsewhere when this gate is needed.
 */
/**
 * Shop-owner-only chokepoint for Ghost Garage management endpoints
 * (creating shops, adding bays, etc.). We do not have a separate "pending"
 * state for shop owners today — all shop_owner accounts are active on
 * signup — but the status check is still applied for symmetry with the
 * mechanic flow and to honor admin suspensions.
 */
export function requireShopOwner(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== "shop_owner") {
    res.status(403).json({ error: "Shop owners only" });
    return;
  }
  if (req.user.status !== "active") {
    res.status(403).json({ error: "Your shop owner account is not active." });
    return;
  }
  next();
}

export function requireActiveMechanic(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== "mechanic") {
    res.status(403).json({ error: "Mechanics only" });
    return;
  }
  if (req.user.status !== "active") {
    res.status(403).json({
      error: "Your mechanic account is pending admin approval. You'll be able to access this once approved.",
    });
    return;
  }
  next();
}
