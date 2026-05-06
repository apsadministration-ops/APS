import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import { recordReferralSignup } from "../lib/referralEngine";

// Format APS-XXXXXX (6 chars after the prefix) — distinctive, brand-friendly,
// and easy to share verbally. 32^6 ≈ 1B combinations, plenty for our scale.
function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const suffix = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `APS-${suffix}`;
}

async function uniqueReferralCode(): Promise<string> {
  let code = generateReferralCode();
  while (true) {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.referralCode, code));
    if (!existing) return code;
    code = generateReferralCode();
  }
}

const router: IRouter = Router();

function formatUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatarUrl ?? null,
    referralCode: user.referralCode ?? null,
    mechanicTier: user.mechanicTier ?? null,
    loyaltyPoints: user.loyaltyPoints ?? 0,
    mechanicPoints: user.mechanicPoints ?? 0,
    address: user.address ?? null,
    city: user.city ?? null,
    region: user.region ?? null,
    zipCode: user.zipCode ?? null,
    homeLat: user.homeLat ?? null,
    homeLng: user.homeLng ?? null,
    serviceRadiusMiles: user.serviceRadiusMiles ?? null,
    createdAt: user.createdAt,
  };
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const {
    name, phone, password, role,
    address, city, region, zipCode, homeLat, homeLng, serviceRadiusMiles, referredBy,
  } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  // Resolve referrer. Codes are case-insensitive and tolerate the "APS-"
  // prefix being typed in any case.
  let referrer: typeof usersTable.$inferSelect | null = null;
  if (referredBy) {
    const normalized = referredBy.trim().toUpperCase();
    const [found] = await db.select().from(usersTable).where(eq(usersTable.referralCode, normalized));
    if (found) referrer = found;
  }

  const passwordHash = await hashPassword(password);
  const status = role === "mechanic" ? "pending" : "active";
  const referralCode = await uniqueReferralCode();

  const [user] = await db.insert(usersTable).values({
    name, email, phone: phone ?? null, passwordHash, role, status, referralCode,
    mechanicTier: role === "mechanic" ? "detailer" : null,
    address: address ?? null,
    city: city ?? null,
    region: region ?? null,
    zipCode: zipCode ?? null,
    homeLat: homeLat ?? null,
    homeLng: homeLng ?? null,
    serviceRadiusMiles: role === "mechanic"
      ? Math.min(500, Math.max(1, Math.round(Number(serviceRadiusMiles ?? 25))))
      : null,
  }).returning();

  // Hand off to the standalone referral engine. Per spec, signup only
  // records a PENDING referral — no points fire until the referred user
  // completes their first paid job (verified by the conversion gate).
  if (referrer) {
    await recordReferralSignup(referrer, user, referredBy?.trim().toUpperCase() ?? "");
  }

  const token = signToken({ userId: user.id, role: user.role });
  res.status(201).json({ token, user: formatUser(user) });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { password } = parsed.data;
  const email = parsed.data.email.trim().toLowerCase();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Suspended accounts cannot obtain a fresh token. Pending mechanics CAN
  // log in (so they see the "awaiting approval" UI) but the
  // `requireActiveMechanic` gate blocks them from sensitive actions.
  if (user.status === "suspended") {
    res.status(403).json({ error: "Account suspended. Contact support." });
    return;
  }

  const token = signToken({ userId: user.id, role: user.role });
  res.json({ token, user: formatUser(user) });
});

router.get("/auth/me", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

router.post("/auth/admin-setup", async (req, res): Promise<void> => {
  const setupKey = req.headers["x-setup-key"];
  const validKey = process.env.ADMIN_SETUP_KEY ?? "aps-admin-setup";
  if (setupKey !== validKey) {
    res.status(403).json({ error: "Invalid setup key" });
    return;
  }

  const { name, email: rawEmail, password } = req.body as { name?: string; email?: string; password?: string };
  if (!name || !rawEmail || !password) {
    res.status(400).json({ error: "name, email, and password are required" });
    return;
  }
  const email = rawEmail.trim().toLowerCase();

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({
    name,
    email,
    passwordHash,
    role: "admin",
    status: "active",
  }).returning();

  const token = signToken({ userId: user.id, role: user.role });
  res.status(201).json({ token, user: formatUser(user) });
});

export default router;
