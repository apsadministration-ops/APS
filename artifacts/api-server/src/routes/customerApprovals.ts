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
import { sweepExpiredApprovals, applyApprovalDecision } from "../lib/customerApprovalEngine";

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
  res.json({ ok: true, approval: result.approval, jobStatus: result.jobStatus });
});

router.post("/approvals/sweep", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userRole !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const swept = await db.update(customerApprovalsTable)
    .set({ status: "auto_approved", respondedAt: new Date() })
    .where(and(
      eq(customerApprovalsTable.status, "pending"),
      lte(customerApprovalsTable.expiresAt, new Date()),
    ))
    .returning();
  // Bulk-promote each affected job into ACCEPTED so the mechanic workflow unblocks.
  for (const a of swept) {
    await db.update(jobsTable).set({ status: "ACCEPTED" })
      .where(and(eq(jobsTable.id, a.jobId), eq(jobsTable.status, "PENDING_APPROVAL")));
  }
  res.json({ ok: true, swept: swept.length });
});

export default router;
