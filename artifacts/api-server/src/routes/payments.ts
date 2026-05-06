import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, paymentsTable, jobsTable, referralsTable, usersTable } from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";
import { awardLoyaltyPoints } from "./loyalty";

const router: IRouter = Router();

router.get("/payments", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const payments = await db.select().from(paymentsTable).orderBy(paymentsTable.createdAt);

  if (req.userRole === "admin") {
    res.json(payments);
    return;
  }

  // Filter to only payments related to jobs the user is involved in
  const userJobs = await db.select().from(jobsTable);
  const relevantJobIds = new Set(
    userJobs
      .filter((j) => j.customerId === req.userId || j.mechanicId === req.userId)
      .map((j) => j.id),
  );

  const filtered = payments.filter((p) => relevantJobIds.has(p.jobId));
  res.json(filtered);
});

router.post("/payments/:jobId/release", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const jobId = parseInt(rawId, 10);

  if (isNaN(jobId)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  if (!payment) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  if (payment.status === "released") {
    res.status(400).json({ error: "Payment already released" });
    return;
  }

  const now = new Date();
  const [updated] = await db
    .update(paymentsTable)
    .set({ status: "released", releasedAt: now })
    .where(eq(paymentsTable.jobId, jobId))
    .returning();

  // Mark job PAID
  await db.update(jobsTable).set({ status: "PAID" }).where(eq(jobsTable.id, jobId));

  // Award 100 loyalty points to customer for completed job
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (job?.customerId) {
    await awardLoyaltyPoints(job.customerId, 100, `Job #${jobId} completed`, jobId).catch(() => {});

    // Check if customer was referred — reward referrer 500 pts on first completed job
    const [referral] = await db.select().from(referralsTable)
      .where(eq(referralsTable.referredId, job.customerId));
    if (referral && !referral.rewarded) {
      await awardLoyaltyPoints(referral.referrerId, 500, `Referral reward — friend completed first job`, jobId).catch(() => {});
      await db.update(referralsTable).set({ rewarded: true }).where(eq(referralsTable.id, referral.id));
    }
  }

  res.json(updated);
});

export default router;
