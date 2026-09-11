/**
 * Tip endpoints. Tips are SEPARATE PaymentIntents that flow 100% to the
 * mechanic by default. See lib/tipEngine.ts for the split logic.
 *
 *   POST /tips/jobs/:jobId   { amountCents }   create tip Checkout session
 *   GET  /tips                                 list tips for current user
 *   GET  /tips/job/:jobId                      tips for a specific job
 */

import { Router, type IRouter, type Response } from "express";
import { eq, desc, or } from "drizzle-orm";
import { z } from "zod";
import { db, tipsTable, jobsTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import { tipCreationLimiter } from "../middlewares/paymentRateLimit";
import { createTipCheckout } from "../lib/tipEngine";
import { PublicUrlNotConfiguredError } from "../lib/publicUrl";
import { StripeNotConfiguredError } from "../lib/stripeClient";

const router: IRouter = Router();

const tipSchema = z.object({
  amountCents: z.number().int().min(100).max(50000),
});

router.post("/tips/jobs/:jobId", authenticate, tipCreationLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userRole !== "customer") { res.status(403).json({ error: "Customers only" }); return; }
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const parsed = tipSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "amountCents must be 100–50000 (¢)" }); return; }
  try {
    const out = await createTipCheckout({
      jobId, customerId: req.userId!, amountCents: parsed.data.amountCents,
    });
    res.json(out);
  } catch (err) {
    if (err instanceof PublicUrlNotConfiguredError) {
      res.status(503).json({ error: "public_url_not_configured" });
      return;
    }
    if (err instanceof StripeNotConfiguredError) {
      res.status(503).json({ error: "stripe_provider_not_configured" });
      return;
    }
    const businessErrors = new Set([
      "Tip must be at least $1.00",
      "Tip cannot exceed $500.00",
      "Job not found",
      "Not your job",
      "No mechanic on this job",
      "Tips can only be added once the job is completed.",
      "Mechanic has not finished payout setup yet.",
      "Customer not found",
    ]);
    const message = err instanceof Error && businessErrors.has(err.message)
      ? err.message
      : "Tip checkout unavailable";
    res.status(message === "Tip checkout unavailable" ? 502 : 400).json({ error: message });
  }
});

router.get("/tips", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const rows = req.userRole === "admin"
    ? await db.select().from(tipsTable).orderBy(desc(tipsTable.createdAt))
    : await db.select().from(tipsTable)
        .where(or(eq(tipsTable.customerId, req.userId!), eq(tipsTable.mechanicId, req.userId!)))
        .orderBy(desc(tipsTable.createdAt));
  res.json(rows);
});

router.get("/tips/job/:jobId", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  if (req.userRole !== "admin" && req.userId !== job.customerId && req.userId !== job.mechanicId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const rows = await db.select().from(tipsTable).where(eq(tipsTable.jobId, jobId)).orderBy(desc(tipsTable.createdAt));
  res.json(rows);
});

export default router;
