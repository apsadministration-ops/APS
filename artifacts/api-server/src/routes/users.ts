import { Router, type IRouter } from "express";
import { eq, or, avg, count, sum } from "drizzle-orm";
import { db, usersTable, jobsTable, workLogsTable, ownershipTable, loyaltyPointsTable, referralsTable, messagesTable } from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";

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
    certifications: user.certifications ?? "[]",
    loyaltyPoints: user.loyaltyPoints ?? 0,
    mechanicPoints: user.mechanicPoints ?? 0,
    createdAt: user.createdAt,
  };
}

router.get("/users", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const { role, status } = req.query as { role?: string; status?: string };
  const users = await db.select().from(usersTable);
  const filtered = users.filter((u) => {
    if (role && u.role !== role) return false;
    if (status && u.status !== status) return false;
    return true;
  });
  res.json(filtered.map(formatUser));
});

router.get("/users/:userId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const userId = parseInt(String(req.params.userId), 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
  if (req.userRole !== "admin" && req.userId !== userId) { res.status(403).json({ error: "Forbidden" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(formatUser(user));
});

router.patch("/users/:userId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const userId = parseInt(String(req.params.userId), 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

  const isAdmin = req.userRole === "admin";
  const isSelf = req.userId === userId;

  if (!isAdmin && !isSelf) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { status, name, phone, mechanicTier, certifications } = req.body as {
    status?: string; name?: string; phone?: string; mechanicTier?: string; certifications?: string;
  };

  const updates: Partial<typeof usersTable.$inferInsert> = {};

  // Admin-only fields
  if (isAdmin) {
    if (status) updates.status = status as "active" | "suspended" | "pending";
    if (mechanicTier) updates.mechanicTier = mechanicTier as "detailer" | "technician" | "senior" | "master";
  }

  // Self or admin
  if (name) updates.name = name;
  if (phone !== undefined) updates.phone = phone;
  if (certifications !== undefined) updates.certifications = certifications;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No updatable fields provided" }); return;
  }

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(formatUser(user));
});

router.get("/users/:userId/mechanic-profile", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const userId = parseInt(String(req.params.userId), 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.role !== "mechanic") { res.status(404).json({ error: "Mechanic not found" }); return; }
  const [jobStats] = await db.select({ totalJobs: count(jobsTable.id) }).from(jobsTable).where(eq(jobsTable.mechanicId, userId));
  const [ratingStats] = await db.select({ averageRating: avg(jobsTable.rating) }).from(jobsTable).where(eq(jobsTable.mechanicId, userId));
  const [earningsStats] = await db.select({ totalEarnings: sum(workLogsTable.totalCost) }).from(workLogsTable).where(eq(workLogsTable.mechanicId, userId));
  res.json({
    user: formatUser(user),
    totalJobs: Number(jobStats?.totalJobs ?? 0),
    completedJobs: Number(jobStats?.totalJobs ?? 0),
    averageRating: ratingStats?.averageRating ? Number(ratingStats.averageRating) : null,
    totalEarnings: Number(earningsStats?.totalEarnings ?? 0),
  });
});

router.delete("/users/:userId", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const userId = parseInt(String(req.params.userId), 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }
  if (req.userId === userId) { res.status(400).json({ error: "You cannot delete your own admin account." }); return; }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!target) { res.status(404).json({ error: "User not found" }); return; }
  if (target.role === "admin") { res.status(400).json({ error: "Admin accounts cannot be removed." }); return; }

  // Refuse delete if user has service history (preserves VIN-permanent records). Suspend instead.
  const [{ c: workLogCount }] = await db
    .select({ c: count() })
    .from(workLogsTable)
    .where(or(eq(workLogsTable.mechanicId, userId), eq(workLogsTable.customerId, userId)));
  const [{ c: jobCount }] = await db
    .select({ c: count() })
    .from(jobsTable)
    .where(or(eq(jobsTable.customerId, userId), eq(jobsTable.mechanicId, userId)));
  if (Number(workLogCount) > 0 || Number(jobCount) > 0) {
    res.status(409).json({
      error: "This user has service history and cannot be removed. Suspend the account instead to preserve VIN records.",
    });
    return;
  }

  // Clean up rows that reference the user (no service history at this point).
  await db.transaction(async (tx) => {
    await tx.delete(messagesTable).where(eq(messagesTable.senderId, userId));
    await tx.delete(loyaltyPointsTable).where(eq(loyaltyPointsTable.userId, userId));
    await tx.delete(referralsTable).where(or(eq(referralsTable.referrerId, userId), eq(referralsTable.referredId, userId)));
    await tx.delete(ownershipTable).where(eq(ownershipTable.userId, userId));
    await tx.delete(usersTable).where(eq(usersTable.id, userId));
  });

  res.json({ ok: true });
});

// Register or update Expo push token for the current user
router.post("/users/me/push-token", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const { token } = req.body as { token: string };
  if (!token) { res.status(400).json({ error: "token is required" }); return; }
  await db.update(usersTable).set({ pushToken: token }).where(eq(usersTable.id, req.userId!));
  res.json({ ok: true });
});

export default router;
