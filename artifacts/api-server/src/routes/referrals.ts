import { Router, type IRouter } from "express";
import { eq, count } from "drizzle-orm";
import { db, referralsTable, usersTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

router.get("/referral", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [refCount] = await db
    .select({ c: count() })
    .from(referralsTable)
    .where(eq(referralsTable.referrerId, req.userId!));

  const [rewardedCount] = await db
    .select({ c: count() })
    .from(referralsTable)
    .where(eq(referralsTable.referrerId, req.userId!));

  const referredUsers = await db
    .select({ id: usersTable.id, name: usersTable.name, createdAt: usersTable.createdAt })
    .from(referralsTable)
    .innerJoin(usersTable, eq(referralsTable.referredId, usersTable.id))
    .where(eq(referralsTable.referrerId, req.userId!));

  res.json({
    referralCode: user.referralCode,
    totalReferrals: Number(refCount?.c ?? 0),
    rewardedReferrals: Number(rewardedCount?.c ?? 0),
    loyaltyPoints: user.loyaltyPoints,
    referredUsers,
  });
});

export default router;
