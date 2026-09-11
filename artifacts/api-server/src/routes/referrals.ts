import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import { getReferralStatusForUser, REFERRAL_REWARD } from "../lib/referralEngine";
import { getPublicBaseUrl } from "../lib/publicUrl";

const router: IRouter = Router();

/**
 * GET /referral
 *
 * Returns referral-only data (code, link, per-friend status, totals).
 * No loyalty-tier or general-points info — that lives at /loyalty.
 */
router.get("/referral", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const status = await getReferralStatusForUser(req.userId!);

  // Build a shareable signup deep-link. Prefers the published domain,
  // falls back to the dev preview domain. Adds ?ref=CODE so the mobile
  // signup form can pre-fill it.
  const baseUrl = getPublicBaseUrl("referral");
  const referralLink = baseUrl && user.referralCode
    ? `${baseUrl}/?ref=${encodeURIComponent(user.referralCode)}`
    : null;

  res.json({
    referralCode: user.referralCode,
    referralLink,
    rewardPerConversion: REFERRAL_REWARD,
    totalReferrals: status.totalReferrals,
    pendingReferrals: status.pendingReferrals,
    convertedReferrals: status.convertedReferrals,
    totalPointsEarned: status.totalPointsEarned,
    referredUsers: status.friends.map((f) => ({
      id: f.referredId,
      name: f.name,
      createdAt: f.signupAt,
      status: f.status,
      pointsAwarded: f.pointsAwarded,
    })),
  });
});

export default router;
