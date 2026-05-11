/**
 * Customer "approve completed work" — the 24h escrow hold.
 *
 *   GET  /work-confirmations/job/:jobId       latest row + countdown
 *   POST /work-confirmations/:jobId/confirm   customer fast-tracks capture
 *   POST /work-confirmations/:jobId/dispute   customer freezes + opens dispute
 *   POST /work-confirmations/sweep            admin/cron — flush expired rows
 */

import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, workConfirmationsTable, jobsTable, paymentsTable } from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";
import { applyWorkDecision, sweepExpiredConfirmations } from "../lib/payoutHoldEngine";

const router: IRouter = Router();

router.get("/work-confirmations/job/:jobId", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  if (req.userRole !== "admin" && req.userId !== job.customerId && req.userId !== job.mechanicId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const [conf] = await db.select().from(workConfirmationsTable)
    .where(eq(workConfirmationsTable.jobId, jobId));
  if (!conf) { res.status(404).json({ error: "No work confirmation pending for this job." }); return; }
  const [pmt] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  res.json({
    id: conf.id,
    jobId: conf.jobId,
    status: conf.status,
    expiresAt: conf.expiresAt,
    secondsRemaining: Math.max(0, Math.floor((conf.expiresAt.getTime() - Date.now()) / 1000)),
    respondedAt: conf.respondedAt,
    disputeReason: conf.disputeReason,
    payment: pmt ? {
      id: pmt.id,
      amount: pmt.amount,
      mechanicPayout: pmt.mechanicPayout,
      status: pmt.status,
      captureBlockedReason: pmt.captureBlockedReason,
    } : null,
  });
});

router.post("/work-confirmations/:jobId/confirm", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const result = await applyWorkDecision({
    jobId, viewerId: req.userId!, viewerRole: req.userRole!, decision: "confirmed",
  });
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result);
});

const disputeSchema = z.object({ reason: z.string().min(1).max(2000) });

router.post("/work-confirmations/:jobId/dispute", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const parsed = disputeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Reason is required" }); return; }
  const result = await applyWorkDecision({
    jobId, viewerId: req.userId!, viewerRole: req.userRole!,
    decision: "disputed", reason: parsed.data.reason,
  });
  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.json(result);
});

router.post("/work-confirmations/sweep", authenticate, requireRole("admin"), async (_req: AuthRequest, res: Response): Promise<void> => {
  const swept = await sweepExpiredConfirmations();
  res.json({ ok: true, swept });
});

export default router;
