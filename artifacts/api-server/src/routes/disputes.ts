/**
 * Dispute endpoints. Read-only for non-admins; admins can update status +
 * resolution notes. Customer-filed disputes originate from the work-
 * confirmation flow (see lib/payoutHoldEngine.ts), Stripe chargebacks from
 * the webhook handler.
 */

import { Router, type IRouter, type Response } from "express";
import { eq, desc, or, and } from "drizzle-orm";
import { z } from "zod";
import { db, disputesTable, jobsTable, paymentsTable, usersTable } from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";
import { notifyMechanicDisputeResolved } from "../lib/notifications";
import { manualRetryCapture } from "../lib/payoutHoldEngine";
import { canResolveDispute } from "../lib/authorization";

const router: IRouter = Router();

router.get("/disputes", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const status = String(req.query["status"] ?? "");
  let rows;
  if (req.userRole === "admin") {
    rows = await db.select().from(disputesTable).orderBy(desc(disputesTable.createdAt));
  } else {
    rows = await db.select().from(disputesTable)
      .where(or(eq(disputesTable.customerId, req.userId!), eq(disputesTable.mechanicId, req.userId!)))
      .orderBy(desc(disputesTable.createdAt));
  }
  if (status) rows = rows.filter((r) => r.status === status);
  res.json(rows);
});

router.get("/disputes/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const [d] = await db.select().from(disputesTable).where(eq(disputesTable.id, id));
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  if (req.userRole !== "admin" && req.userId !== d.customerId && req.userId !== d.mechanicId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, d.jobId));
  const [pmt] = d.paymentId ? await db.select().from(paymentsTable).where(eq(paymentsTable.id, d.paymentId)) : [null];
  res.json({ ...d, job, payment: pmt });
});

const resolveSchema = z.object({
  outcome: z.enum(["resolved_customer", "resolved_mechanic", "canceled", "under_review"]),
  notes: z.string().max(2000).optional(),
});

router.post("/admin/disputes/:id/resolve", authenticate, requireRole("admin"), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [d] = await db.select().from(disputesTable).where(eq(disputesTable.id, id));
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  if (!["open", "under_review"].includes(d.status)) {
    res.status(409).json({ error: `Dispute is already ${d.status}.` });
    return;
  }
  if (!canResolveDispute({
    role: req.userRole,
    disputeStatus: d.status,
    kind: d.kind,
    outcome: parsed.data.outcome,
  })) {
    res.status(400).json({ error: "Stripe-chargeback outcomes are owned by Stripe; you can only mark this as under_review here." });
    return;
  }
  const isFinal = parsed.data.outcome !== "under_review";
  const [updated] = await db.update(disputesTable)
    .set({
      status: parsed.data.outcome,
      resolutionNotes: parsed.data.notes ?? null,
      resolvedById: req.userId!,
      resolvedAt: isFinal ? new Date() : null,
    })
    // Do not allow two concurrent resolutions to overwrite a final outcome.
    .where(and(
      eq(disputesTable.id, id),
      or(eq(disputesTable.status, "open"), eq(disputesTable.status, "under_review")),
    ))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Dispute was resolved by another request." });
    return;
  }
  // If the mechanic won an internal dispute, unblock the payment AND
  // automatically re-fire capture so funds release without a second admin
  // step. retryCapture() resets the captureFired lock then calls captureNow.
  if (parsed.data.outcome === "resolved_mechanic" && d.paymentId) {
    const [rearmed] = await db.update(paymentsTable)
      .set({ captureBlockedReason: null, status: "capture_pending" })
      .where(and(
        eq(paymentsTable.id, d.paymentId),
        eq(paymentsTable.jobId, d.jobId),
        eq(paymentsTable.status, "disputed"),
      ))
      .returning({ id: paymentsTable.id });
    if (rearmed) {
      void manualRetryCapture(d.jobId, { allowCapturePending: true })
        .catch(() => { /* surfaced via payment.status */ });
    }
  }
  if (isFinal && d.mechanicId) {
    const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, d.mechanicId));
    if (mech?.pushToken) {
      void notifyMechanicDisputeResolved(mech.pushToken, d.jobId, parsed.data.outcome === "resolved_mechanic");
    }
  }
  res.json(updated);
});

export default router;
