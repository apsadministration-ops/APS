import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, workLogsTable, jobsTable, usersTable, paymentsTable, vehiclesTable, ownershipTable, inspectionsTable, bayBookingsTable } from "@workspace/db";
import { authenticate, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";
import { notifyCustomerJobComplete, notifyMechanicWorkUnderReview } from "../lib/notifications";
import { awardMechanicPoints, RULES } from "../lib/loyaltyEngine";
import { openWorkConfirmation } from "../lib/payoutHoldEngine";

const router: IRouter = Router();

async function formatWorkLog(log: typeof workLogsTable.$inferSelect) {
  const [mechanic] = await db.select().from(usersTable).where(eq(usersTable.id, log.mechanicId));
  return {
    id: log.id, jobId: log.jobId, vehicleId: log.vehicleId, vin: log.vin,
    mechanicId: log.mechanicId, mechanicName: mechanic?.name ?? "Unknown", customerId: log.customerId,
    serviceCategory: log.serviceCategory, serviceDescription: log.serviceDescription,
    mileageAtService: log.mileageAtService ?? 0,
    laborCost: log.laborCost, partsCost: log.partsCost, totalCost: log.totalCost,
    partsUsed: (log.partsUsed as string[]) ?? [], notes: log.notes ?? null,
    beforeImages: (log.beforeImages as string[]) ?? [], afterImages: (log.afterImages as string[]) ?? [],
    upsells: (log.upsells as { description: string; amount: number; customerApproved: boolean }[]) ?? [],
    laborHours: log.laborHours ?? null,
    diagnosticCodes: (log.diagnosticCodes as string[]) ?? [],
    rootCauseDiagnosis: log.rootCauseDiagnosis ?? null,
    repairSteps: log.repairSteps ?? null,
    observedSymptoms: log.observedSymptoms ?? null,
    recommendedMonitoring: log.recommendedMonitoring ?? null,
    recurringIssueTags: (log.recurringIssueTags as string[]) ?? [],
    bayBookingId: log.bayBookingId ?? null,
    preInspectionId: log.preInspectionId ?? null,
    postInspectionId: log.postInspectionId ?? null,
    createdAt: log.createdAt,
  };
}

router.post("/worklogs", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const {
    jobId, serviceCategory, serviceDescription, mileageAtService,
    laborCost, partsCost, partsUsed, notes, beforeImages, afterImages, upsells,
    laborHours, diagnosticCodes, rootCauseDiagnosis, repairSteps,
    observedSymptoms, recommendedMonitoring, recurringIssueTags, bayBookingId,
  } = req.body as {
    jobId: number; serviceCategory: string; serviceDescription: string;
    mileageAtService: number;
    laborCost: number; partsCost: number; partsUsed: string[];
    notes?: string; beforeImages: string[]; afterImages: string[];
    upsells?: { description: string; amount: number; customerApproved?: boolean }[];
    laborHours?: number;
    diagnosticCodes?: string[];
    rootCauseDiagnosis?: string;
    repairSteps?: string;
    observedSymptoms?: string;
    recommendedMonitoring?: string;
    recurringIssueTags?: string[];
    bayBookingId?: number;
  };
  // Validate upsells: non-empty description, positive amount, and an explicit
  // boolean `customerApproved` attesting the customer agreed in person.
  // Only upsells with customerApproved === true earn mechanic points downstream.
  const cleanUpsells: { description: string; amount: number; customerApproved: boolean }[] = (upsells ?? [])
    .filter((u) => u && typeof u.description === "string" && u.description.trim().length > 0
      && typeof u.amount === "number" && Number.isFinite(u.amount) && u.amount > 0)
    .map((u) => ({
      description: u.description.trim().slice(0, 200),
      amount: Math.round(u.amount * 100) / 100,
      customerApproved: u.customerApproved === true,
    }));
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.mechanicId !== req.userId) { res.status(403).json({ error: "You are not assigned to this job" }); return; }

  // One worklog per job. Prevents duplicate submissions that would otherwise
  // trigger a second Stripe capture attempt on the same intent.
  const [existingLog] = await db.select().from(workLogsTable).where(eq(workLogsTable.jobId, jobId)).limit(1);
  if (existingLog) {
    res.status(409).json({ error: "A work log has already been submitted for this job." });
    return;
  }

  if (mileageAtService == null || typeof mileageAtService !== "number" || !Number.isFinite(mileageAtService) || mileageAtService < 0) {
    res.status(400).json({ error: "mileageAtService is required and must be a non-negative number" });
    return;
  }

  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
  if (vehicle && mileageAtService < (vehicle.mileage ?? 0)) {
    res.status(400).json({
      error: `Mileage at service (${mileageAtService}) cannot be lower than the current odometer reading (${vehicle.mileage}).`,
    });
    return;
  }

  // Ghost Garage gate: if the job required a shop bay, BOTH a pre and a post
  // inspection must exist before we'll accept the work log. The unique
  // (job_id, kind) index on inspections keeps this trivially correct: if
  // either lookup is missing we know we never captured that walkthrough.
  let preInspectionId: number | null = null;
  let postInspectionId: number | null = null;
  let resolvedBayBookingId: number | null = null;
  if (job.requiresGhostGarage) {
    const inspections = await db.select().from(inspectionsTable).where(eq(inspectionsTable.jobId, jobId));
    const pre = inspections.find((i) => i.kind === "pre");
    const post = inspections.find((i) => i.kind === "post");
    if (!pre || !post) {
      res.status(409).json({
        error: "Ghost Garage jobs require both a pre-service and a post-service inspection before submitting a work log.",
        missing: { pre: !pre, post: !post },
      });
      return;
    }
    preInspectionId = pre.id;
    postInspectionId = post.id;

    // Also require a bay booking — and it must belong to this job and this
    // mechanic. Snapshot the id on the work log so the audit trail links the
    // log → booking → bay → shop without a separate join lookup.
    if (!bayBookingId || !Number.isFinite(bayBookingId)) {
      res.status(409).json({ error: "Ghost Garage jobs require a bayBookingId on the work log." });
      return;
    }
    const [booking] = await db.select().from(bayBookingsTable).where(eq(bayBookingsTable.id, bayBookingId));
    if (!booking || booking.jobId !== jobId || booking.mechanicId !== req.userId) {
      res.status(400).json({ error: "Bay booking does not match this job/mechanic." });
      return;
    }
    resolvedBayBookingId = booking.id;
  } else if (bayBookingId) {
    // Optional bay booking on a non-ghost-garage job — still validate
    // ownership before recording it.
    const [booking] = await db.select().from(bayBookingsTable).where(eq(bayBookingsTable.id, bayBookingId));
    if (booking && booking.jobId === jobId && booking.mechanicId === req.userId) {
      resolvedBayBookingId = booking.id;
    }
  }

  const totalCost = (laborCost ?? 0) + (partsCost ?? 0);
  const platformFee = totalCost * 0.1;
  const mechanicPayout = totalCost - platformFee;

  const mileageInt = Math.floor(mileageAtService);

  // Stripe payment gate. A row is treated as Stripe-managed if it exists and
  // was ever in a Stripe state (anything other than legacy "held"). We can't
  // rely on providerSessionId alone — it gets cleared when we void a stale
  // authorization, but the row remains and must still block the legacy fall-
  // through below (otherwise a reassigned job could complete with no capture).
  const [existingPayment] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  const isStripeManaged = !!existingPayment && existingPayment.status !== "held";
  if (isStripeManaged) {
    if (existingPayment!.status !== "authorized" || !existingPayment!.providerPaymentIntentId) {
      res.status(409).json({
        error: `Payment must be authorized before submitting a work log (current status: ${existingPayment!.status}). Ask the customer to authorize before completing the job.`,
      });
      return;
    }
    const authorizedCents = existingPayment!.amountCents ?? Math.round((existingPayment!.amount ?? 0) * 100);
    const finalCents = Math.round(totalCost * 100);
    if (finalCents > authorizedCents) {
      res.status(409).json({
        error: `Final cost ($${totalCost.toFixed(2)}) exceeds authorized amount ($${(authorizedCents / 100).toFixed(2)}). Ask the customer to re-authorize before submitting.`,
      });
      return;
    }
  }
  const isStripeFlow = isStripeManaged;

  const workLog = await db.transaction(async (tx) => {
    const [created] = await tx.insert(workLogsTable).values({
      jobId, vehicleId: job.vehicleId, vin: job.vin, mechanicId: req.userId!, customerId: job.customerId,
      serviceCategory: serviceCategory as "repair" | "diagnostic" | "maintenance" | "detailing",
      serviceDescription,
      mileageAtService: mileageInt,
      laborCost, partsCost, totalCost,
      partsUsed: partsUsed ?? [], notes: notes ?? null,
      beforeImages: beforeImages ?? [], afterImages: afterImages ?? [],
      upsells: cleanUpsells,
      // Mechanic technical-intelligence (optional; nullable for legacy logs).
      laborHours: typeof laborHours === "number" && Number.isFinite(laborHours) ? laborHours : null,
      diagnosticCodes: Array.isArray(diagnosticCodes) ? diagnosticCodes.map(String) : [],
      rootCauseDiagnosis: rootCauseDiagnosis?.trim() || null,
      repairSteps: repairSteps?.trim() || null,
      observedSymptoms: observedSymptoms?.trim() || null,
      recommendedMonitoring: recommendedMonitoring?.trim() || null,
      recurringIssueTags: Array.isArray(recurringIssueTags) ? recurringIssueTags.map(String) : [],
      bayBookingId: resolvedBayBookingId,
      preInspectionId, postInspectionId,
      immutableFlag: true,
    }).returning();

    await tx.update(jobsTable).set({ status: "COMPLETED", finalPrice: totalCost, completedAt: new Date() }).where(eq(jobsTable.id, jobId));
    await tx.update(vehiclesTable).set({ mileage: mileageInt }).where(eq(vehiclesTable.id, job.vehicleId));
    if (!existingPayment) {
      // Legacy path (no Stripe authorization on this job) — keep an in-DB
      // record so the admin Release flow continues to work.
      await tx.insert(paymentsTable).values({ jobId, amount: totalCost, platformFee, mechanicPayout, status: "held" });
    }
    return created;
  });

  // Open the 24h customer-confirmation window. Capture is DEFERRED until
  // either the customer confirms or the sweeper auto-confirms. This is the
  // single chokepoint for kicking off the escrow hold — see lib/
  // payoutHoldEngine.ts for the full lifecycle.
  if (isStripeFlow && existingPayment!.providerPaymentIntentId) {
    // Sync the authorized payment's cents fields with the FINAL totalCost
    // before opening the window, so the captureNow() call later sees the
    // correct amount and split.
    const authorizedCents = existingPayment!.amountCents ?? Math.round((existingPayment!.amount ?? totalCost) * 100);
    const finalCents = Math.min(authorizedCents, Math.round(totalCost * 100));
    await db.update(paymentsTable)
      .set({
        amount: finalCents / 100,
        amountCents: finalCents,
      })
      .where(eq(paymentsTable.id, existingPayment!.id));
    await openWorkConfirmation(jobId);
    req.log.info({ jobId, finalCents }, "24h customer work-confirmation window opened");
    // Tell the mechanic the funds are in 24h review (separate from the
    // customer's notify, which fires inside openWorkConfirmation).
    void (async () => {
      try {
        const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, job.mechanicId!));
        if (mech?.pushToken) await notifyMechanicWorkUnderReview(mech.pushToken, jobId);
      } catch { /* best-effort */ }
    })();
  }

  // MECHANIC: upsell points — 2 pts per $1 of CUSTOMER-APPROVED upsells only.
  // Unapproved upsells are recorded for audit but earn nothing.
  const approvedUpsells = cleanUpsells.filter((u) => u.customerApproved);
  if (approvedUpsells.length > 0) {
    const upsellTotal = approvedUpsells.reduce((s, u) => s + u.amount, 0);
    const pts = Math.round(upsellTotal * RULES.mechanic.upsellPointsPerDollar);
    await awardMechanicPoints(
      req.userId!, pts, "upsell",
      `Approved upsells on Job #${jobId} ($${upsellTotal.toFixed(2)})`, jobId,
    ).catch(() => {});
  }

  // Notify customer job is complete (fire-and-forget)
  db.select().from(usersTable).where(eq(usersTable.id, job.customerId))
    .then(async ([customer]) => {
      if (customer?.pushToken) {
        const vehicleName = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "your vehicle";
        notifyCustomerJobComplete(customer.pushToken, vehicleName, totalCost, jobId).catch(() => {});
      }
    })
    .catch(() => {});

  res.status(201).json(await formatWorkLog(workLog));
});

router.get("/worklogs/vin/:vin", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const vin = String(req.params.vin).toUpperCase();
  // IDOR guard: VIN history can be viewed by an admin, by the current/past
  // owner of the VIN, or by a mechanic who actually serviced this VIN.
  if (req.userRole !== "admin") {
    const [own] = await db.select({ id: ownershipTable.id }).from(ownershipTable)
      .where(and(eq(ownershipTable.vin, vin), eq(ownershipTable.userId, req.userId!)));
    let allowed = !!own;
    if (!allowed && req.userRole === "mechanic") {
      const [serviced] = await db.select({ id: workLogsTable.id }).from(workLogsTable)
        .where(and(eq(workLogsTable.vin, vin), eq(workLogsTable.mechanicId, req.userId!)));
      allowed = !!serviced;
    }
    if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  }
  const logs = await db.select().from(workLogsTable).where(eq(workLogsTable.vin, vin)).orderBy(workLogsTable.createdAt);
  res.json(await Promise.all(logs.map(formatWorkLog)));
});

router.get("/worklogs/:worklogId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const worklogId = parseInt(String(req.params.worklogId), 10);
  if (isNaN(worklogId)) { res.status(400).json({ error: "Invalid worklog ID" }); return; }
  const [log] = await db.select().from(workLogsTable).where(eq(workLogsTable.id, worklogId));
  if (!log) { res.status(404).json({ error: "Work log not found" }); return; }
  // IDOR guard: only the customer the log belongs to, the mechanic who wrote
  // it, or an admin can view a single work log.
  const isOwner = log.customerId === req.userId;
  const isMechanic = log.mechanicId === req.userId;
  if (!(req.userRole === "admin" || isOwner || isMechanic)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(await formatWorkLog(log));
});

export default router;
