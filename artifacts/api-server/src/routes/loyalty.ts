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
