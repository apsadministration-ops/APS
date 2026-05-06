import { Router, type IRouter } from "express";
import { eq, desc, sum } from "drizzle-orm";
import { db, loyaltyPointsTable, usersTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

router.get("/loyalty", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const history = await db
    .select()
    .from(loyaltyPointsTable)
    .where(eq(loyaltyPointsTable.userId, req.userId!))
    .orderBy(desc(loyaltyPointsTable.createdAt));

  const [user] = await db.select({ loyaltyPoints: usersTable.loyaltyPoints })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!));

  res.json({
    balance: user?.loyaltyPoints ?? 0,
    history,
  });
});

/**
 * Reverse all loyalty point grants tied to a specific job (e.g. on refund).
 * Inserts negative-point counter-rows so the audit trail stays intact, then
 * recomputes each affected user's balance from the sum.
 */
export async function reverseLoyaltyForJob(jobId: number, reason: string) {
  const grants = await db.select().from(loyaltyPointsTable).where(eq(loyaltyPointsTable.jobId, jobId));
  // Filter out anything that's already a reversal (negative).
  const positive = grants.filter((g) => g.points > 0);
  if (positive.length === 0) return;
  for (const g of positive) {
    await db.insert(loyaltyPointsTable).values({
      userId: g.userId, points: -g.points, reason, jobId,
    });
  }
  const affectedUsers = Array.from(new Set(positive.map((g) => g.userId)));
  for (const uid of affectedUsers) {
    const [agg] = await db
      .select({ total: sum(loyaltyPointsTable.points) })
      .from(loyaltyPointsTable)
      .where(eq(loyaltyPointsTable.userId, uid));
    await db.update(usersTable)
      .set({ loyaltyPoints: Number(agg?.total ?? 0) })
      .where(eq(usersTable.id, uid));
  }
}

export async function awardLoyaltyPoints(userId: number, points: number, reason: string, jobId?: number) {
  await db.insert(loyaltyPointsTable).values({ userId, points, reason, jobId: jobId ?? null });
  await db
    .update(usersTable)
    .set({ loyaltyPoints: (await db.select({ lp: usersTable.loyaltyPoints }).from(usersTable).where(eq(usersTable.id, userId)))[0]?.lp ?? 0 + points })
    .where(eq(usersTable.id, userId));

  // Re-compute to avoid race conditions
  const [agg] = await db
    .select({ total: sum(loyaltyPointsTable.points) })
    .from(loyaltyPointsTable)
    .where(eq(loyaltyPointsTable.userId, userId));
  await db
    .update(usersTable)
    .set({ loyaltyPoints: Number(agg?.total ?? 0) })
    .where(eq(usersTable.id, userId));
}

export default router;
