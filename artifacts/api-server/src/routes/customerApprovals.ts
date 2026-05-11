/**
 * Customer approval flow.
 *
 * Job lifecycle interaction:
 *   mechanic accepts job   → existing /jobs/:id/accept handler now ALSO calls
 *                            startCustomerApproval()
 *   customer approves      → POST /approvals/:jobId/approve  → job → ACCEPTED
 *   customer declines      → POST /approvals/:jobId/decline  → job → REQUESTED
 *   60s passes, no answer  → next read auto-flips to approved (background-safe)
 *
 * Endpoints:
 *   GET  /approvals/job/:jobId      latest approval row for a job (pending or final)
 *   POST /approvals/:jobId/approve
 *   POST /approvals/:jobId/decline  body: { reason? }
 *   POST /approvals/sweep           admin/cron — flip expired pending rows
 */

import { Router, type IRouter, type Response } from "express";
import { and, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, customerApprovalsTable, jobsTable, usersTable, userReputationTable, userBadgesTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import {
  sweepExpiredApprovals, applyApprovalDecision, fireApprovalAcceptedNotifications,
} from "../lib/customerApprovalEngine";
import { notifyMechanicApprovalDeclined } from "../lib/notifications";

const router: IRouter = Router();

router.get("/approvals/job/:jobId", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  if (req.userRole !== "admin" && req.userId !== job.customerId && req.userId !== job.mechanicId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  // Lazy-sweep this row if expired.
  await sweepExpiredApprovals(jobId);

  const [approval] = await db.select().from(customerApprovalsTable)
    .where(eq(customerApprovalsTable.jobId, jobId));
  if (!approval) { res.status(404).json({ error: "No approval pending for this job." }); return; }

  // Decorate with mechanic detail for the customer-facing approval screen.
  const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, approval.mechanicId));
  const [rep] = await db.select().from(userReputationTable).where(eq(userReputationTable.userId, approval.mechanicId));
  const badges = await db.select({ key: userBadgesTable.badgeKey }).from(userBadgesTable)
    .where(and(eq(userBadgesTable.userId, approval.mechanicId), sql`revoked_at IS NULL`));

  res.json({
    id: approval.id,
    jobId: approval.jobId,
    status: approval.status,
    expiresAt: approval.expiresAt,
    secondsRemaining: Math.max(0, Math.floor((approval.expiresAt.getTime() - Date.now()) / 1000)),
    respondedAt: approval.respondedAt,
    declineReason: approval.declineReason,
    mechanic: mech ? {
      id: mech.id,
      name: mech.name,
      avatarUrl: mech.avatarUrl ?? null,
      mechanicTier: mech.mechanicTier ?? null,
      bio: null,  // populated when mechanic profile bio field ships
      yearsExperience: null,
      overallAvg: rep ? Number(rep.overallAvg) : 0,
      reviewCount: rep?.reviewCount ?? 0,
      categoriesAvg: rep?.categoriesAvg ?? {},
      trustScore: rep?.trustScore ?? 50,
      completionRate: rep ? Number(rep.completionRate) : 0,
      repeatCustomerRate: rep ? Number(rep.repeatCustomerRate) : 0,
      badges: badges.map((b) => b.key),
    } : null,
  });
});

router.post("/approvals/:jobId/approve", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const result = await applyApprovalDecision({
    jobId, viewerId: req.userId!, viewerRole: req.userRole!, decision: "approved",
  });
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  // Centralized so the same notifications fire from manual approve,
  // /approvals/job/:jobId lazy sweep, and the bulk sweep below.
  void fireApprovalAcceptedNotifications(jobId);
  res.json({ ok: true, approval: result.approval, jobStatus: result.jobStatus });
});

const declineSchema = z.object({ reason: z.string().max(500).optional() });

router.post("/approvals/:jobId/decline", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const parsed = declineSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const result = await applyApprovalDecision({
    jobId, viewerId: req.userId!, viewerRole: req.userRole!,
    decision: "declined", reason: parsed.data.reason,
  });
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  // Tell the rejected mechanic so they don't keep waiting on the job screen.
  void (async () => {
    try {
      const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, result.approval.mechanicId));
      if (mech?.pushToken) await notifyMechanicApprovalDeclined(mech.pushToken, jobId, parsed.data.reason ?? null);
    } catch { /* best-effort */ }
  })();
  res.json({ ok: true, approval: result.approval, jobStatus: result.jobStatus });
});

router.post("/approvals/sweep", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userRole !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  // Delegate to the engine helper so notifications fire from a single place.
  const swept = await sweepExpiredApprovals();
  res.json({ ok: true, swept });
});

export default router;
