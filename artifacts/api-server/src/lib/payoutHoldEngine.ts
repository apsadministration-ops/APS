/**
 * 24-hour escrow hold engine.
 *
 * Lifecycle:
 *   mechanic submits work log
 *     → openWorkConfirmation(jobId)
 *       inserts work_confirmations(pending, expires=+24h)
 *       updates payments.status = 'capture_pending'
 *                payments.holdReleaseAt = +24h
 *       fires "review work" push to customer + email
 *
 *   customer hits Confirm  → confirmWork(jobId, viewerId)
 *     work_confirmations.status = 'confirmed'
 *     jobs.customerWorkApprovedAt = now()
 *     captureNow() fires Stripe capture
 *
 *   customer hits Dispute  → disputeWork(jobId, viewerId, reason)
 *     work_confirmations.status = 'disputed'
 *     payments.captureBlockedReason = 'dispute'
 *     disputes(kind='customer_filed', status='open') row inserted
 *     mechanic + admin notified
 *
 *   24h passes silent  → sweepExpiredConfirmations()
 *     work_confirmations.status = 'auto_confirmed'
 *     captureNow() fires capture (unless dispute / manual review block)
 *
 * Idempotency:
 *   - Conditional UPDATEs (status='capture_pending') prevent double-capture
 *   - work_confirmations.unique(jobId) prevents duplicate confirmations
 *   - capture_fired flag flipped INSIDE the same tx as the conditional update
 */

import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  db, paymentsTable, jobsTable, usersTable, vehiclesTable,
  workConfirmationsTable, disputesTable,
} from "@workspace/db";
import { logger } from "./logger";
import { getUncachableStripeClient } from "./stripeClient";
import { commissionForJob, splitOnNetProfit, findServiceBySlug, partsCostCentsFor, defaultPartsCostPct, type TierKey, type ServiceCategory } from "@workspace/tier-catalog";
import {
  notifyCustomerWorkAwaitingConfirmation,
  notifyMechanicWorkUnderReview,
  notifyMechanicDisputeOpened,
  notifyMechanicPayoutInitiated,
  notifyMechanicPayoutFailed,
  notifyAdminDispute,
} from "./notifications";

export const CONFIRMATION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Called from POST /worklogs after the work log row is inserted. */
export async function openWorkConfirmation(jobId: number): Promise<void> {
  const expiresAt = new Date(Date.now() + CONFIRMATION_WINDOW_MS);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job || !job.mechanicId) return;

  await db.insert(workConfirmationsTable).values({
    jobId, customerId: job.customerId, mechanicId: job.mechanicId,
    status: "pending", expiresAt,
  }).onConflictDoUpdate({
    target: workConfirmationsTable.jobId,
    set: {
      status: "pending",
      expiresAt,
      respondedAt: null,
      disputeReason: null,
      captureFired: "false",
    },
  });

  // Move payment to capture_pending + stamp the hold release time.
  await db.update(paymentsTable)
    .set({ status: "capture_pending", holdReleaseAt: expiresAt })
    .where(and(
      eq(paymentsTable.jobId, jobId),
      eq(paymentsTable.status, "authorized"),
    ));

  // Best-effort customer push.
  void (async () => {
    try {
      const [cust] = await db.select().from(usersTable).where(eq(usersTable.id, job.customerId));
      const [veh] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
      if (cust?.pushToken && veh) {
        await notifyCustomerWorkAwaitingConfirmation(
          cust.pushToken,
          `${veh.year} ${veh.make} ${veh.model}`,
          jobId,
        );
      }
    } catch { /* best-effort */ }
  })();
}

interface WorkDecision {
  jobId: number;
  viewerId: number;
  viewerRole: string;
  decision: "confirmed" | "disputed";
  reason?: string;
}

type WorkDecisionResult =
  | { ok: true; status: string; capture?: { ok: boolean; reason?: string } }
  | { ok: false; status: number; error: string };

export async function applyWorkDecision(input: WorkDecision): Promise<WorkDecisionResult> {
  const result = await db.transaction(async (tx) => {
    const lockedRows = await tx.execute(sql`
      SELECT * FROM work_confirmations WHERE job_id = ${input.jobId} FOR UPDATE
    `);
    const conf = (lockedRows.rows[0] ?? null) as typeof workConfirmationsTable.$inferSelect | null;
    if (!conf) return { ok: false as const, status: 404, error: "No work confirmation pending for this job." };
    if (input.viewerRole !== "admin" && conf.customerId !== input.viewerId) {
      return { ok: false as const, status: 403, error: "Only the customer can respond to this confirmation." };
    }
    if (conf.status !== "pending") {
      return { ok: false as const, status: 409, error: `Already ${conf.status}.` };
    }

    if (input.decision === "confirmed") {
      await tx.update(workConfirmationsTable)
        .set({ status: "confirmed", respondedAt: new Date() })
        .where(eq(workConfirmationsTable.id, conf.id));
      await tx.update(jobsTable)
        .set({ customerWorkApprovedAt: new Date() })
        .where(eq(jobsTable.id, input.jobId));
      return { ok: true as const, decision: "confirmed" as const, conf };
    }

    // Disputed
    await tx.update(workConfirmationsTable)
      .set({
        status: "disputed",
        respondedAt: new Date(),
        disputeReason: input.reason?.slice(0, 500) ?? null,
      })
      .where(eq(workConfirmationsTable.id, conf.id));
    // Freeze the payment so the sweeper does not capture.
    await tx.update(paymentsTable)
      .set({ captureBlockedReason: "dispute", status: "disputed" })
      .where(and(
        eq(paymentsTable.jobId, input.jobId),
        eq(paymentsTable.status, "capture_pending"),
      ));
    // Open an internal dispute row.
    const [pmt] = await tx.select().from(paymentsTable).where(eq(paymentsTable.jobId, input.jobId));
    await tx.insert(disputesTable).values({
      jobId: input.jobId,
      paymentId: pmt?.id ?? null,
      customerId: conf.customerId,
      mechanicId: conf.mechanicId,
      kind: "customer_filed",
      reason: "customer_disputed_work",
      customerNotes: input.reason?.slice(0, 2000) ?? null,
      amountCents: pmt?.amountCents ?? null,
      status: "open",
    });
    return { ok: true as const, decision: "disputed" as const, conf };
  });

  if (!result.ok) return result;

  if (result.decision === "confirmed") {
    const cap = await captureNow(input.jobId, "customer_confirmed");
    return { ok: true, status: "confirmed", capture: cap };
  }

  // Disputed — fire notifications to mechanic AND admins (customer-filed
  // disputes need admin triage just like Stripe chargebacks).
  void (async () => {
    try {
      const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, result.conf.mechanicId));
      if (mech?.pushToken) await notifyMechanicDisputeOpened(mech.pushToken, input.jobId, input.reason ?? null);
      const admins = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
      for (const admin of admins) {
        if (admin.pushToken) {
          await notifyAdminDispute(admin.pushToken, input.jobId, input.reason ?? null);
        }
      }
    } catch { /* best-effort */ }
  })();
  return { ok: true, status: "disputed" };
}

/**
 * Fire the Stripe capture for a job's authorized PaymentIntent.
 * Conditional UPDATE on status='capture_pending' is the idempotency lock —
 * a second concurrent caller (sweep + manual confirm racing) gets 0 rows back
 * and skips the Stripe call.
 *
 * On capture success: webhook payment_intent.succeeded handles loyalty,
 * job-status flip, and the actual ledger updates.
 *
 * On capture failure: payment moves to payout_failed, mechanic + admin
 * notified for retry.
 */
export async function captureNow(
  jobId: number,
  trigger: "customer_confirmed" | "auto_sweep" | "admin_manual",
): Promise<{ ok: boolean; reason?: string }> {
  // Atomic claim — only ONE caller flips capture_pending → in-progress.
  // We use the `capture_fired` text flag on work_confirmations as the lock
  // because we cannot transition payments.status until Stripe succeeds.
  const claimed = await db.update(workConfirmationsTable)
    .set({ captureFired: "true" })
    .where(and(
      eq(workConfirmationsTable.jobId, jobId),
      eq(workConfirmationsTable.captureFired, "false"),
    ))
    .returning();
  if (claimed.length === 0) {
    return { ok: false, reason: "already_captured_or_in_flight" };
  }

  const [pmt] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));

  // Helper: any early-return path that did NOT actually capture must release
  // the captureFired lock so a subsequent retry (e.g. dispute resolved →
  // unblock → manual retry) is not permanently dead-locked.
  const releaseLock = async () => {
    await db.update(workConfirmationsTable)
      .set({ captureFired: "false" })
      .where(eq(workConfirmationsTable.jobId, jobId));
  };

  if (!pmt || !job) { await releaseLock(); return { ok: false, reason: "missing_records" }; }
  if (pmt.captureBlockedReason) {
    await releaseLock();
    return { ok: false, reason: pmt.captureBlockedReason };
  }
  if (pmt.status !== "capture_pending") {
    // Already captured / refunded / disputed — safe no-op, but unlock so a
    // future state-restoration (dispute resolved in mechanic's favor) can retry.
    await releaseLock();
    return { ok: false, reason: pmt.status };
  }
  if (!pmt.providerPaymentIntentId) {
    await releaseLock();
    return { ok: false, reason: "no_intent" };
  }

  try {
    const stripe = await getUncachableStripeClient();
    const finalCents = pmt.amountCents ?? Math.round(pmt.amount * 100);
    const [mechRow] = await db
      .select({ mechanicTier: usersTable.mechanicTier, pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(eq(usersTable.id, job.mechanicId!));
    const commission = commissionForJob({
      category: job.jobType as ServiceCategory,
      jobTier: ((job.requiredTier ?? "detailer") as TierKey),
      mechanicTier: (mechRow?.mechanicTier ?? "detailer") as TierKey,
    });
    // True Net Profit split — commission applies only to (revenue − parts
    // cost). MUST mirror the parts-cost rule used at authorization in
    // payments.ts so the mechanic's payout matches what was visible at accept.
    const svcEntry = findServiceBySlug(job.serviceSlug);
    const partsCostCents = svcEntry
      ? partsCostCentsFor(svcEntry, finalCents)
      : Math.round(finalCents * defaultPartsCostPct(job.jobType as ServiceCategory));
    const { platformFeeCents, mechanicPayoutCents } = splitOnNetProfit(finalCents, partsCostCents, commission);

    await stripe.paymentIntents.capture(pmt.providerPaymentIntentId, {
      amount_to_capture: finalCents,
      application_fee_amount: platformFeeCents,
    });
    // payment_intent.succeeded webhook will flip status → captured. We mirror
    // the split here so dashboards stay consistent if the webhook is delayed.
    await db.update(paymentsTable)
      .set({
        amount: finalCents / 100,
        platformFee: platformFeeCents / 100,
        mechanicPayout: mechanicPayoutCents / 100,
        amountCents: finalCents,
        platformFeeCents,
        mechanicPayoutCents,
      })
      .where(eq(paymentsTable.id, pmt.id));

    if (mechRow?.pushToken) {
      void notifyMechanicPayoutInitiated(mechRow.pushToken, jobId, mechanicPayoutCents / 100);
    }
    logger.info({ jobId, trigger, captureCents: finalCents }, "24h-hold capture fired");
    return { ok: true };
  } catch (err) {
    // Roll back the claim so a manual retry can try again.
    await db.update(workConfirmationsTable)
      .set({ captureFired: "false" })
      .where(eq(workConfirmationsTable.jobId, jobId));
    await db.update(paymentsTable)
      .set({ status: "payout_failed", failureReason: (err as Error).message?.slice(0, 500) })
      .where(eq(paymentsTable.id, pmt.id));
    const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, job.mechanicId!));
    if (mech?.pushToken) void notifyMechanicPayoutFailed(mech.pushToken, jobId);
    logger.error({ err, jobId, trigger }, "24h-hold capture failed");
    return { ok: false, reason: "stripe_error" };
  }
}

/**
 * Cron-driven sweep — run every minute. Picks rows where:
 *   - work_confirmations.status = 'pending'
 *   - work_confirmations.expires_at <= now()
 * Auto-confirms and fires capture (unless dispute lock was placed).
 */
export async function sweepExpiredConfirmations(): Promise<number> {
  const swept = await db.update(workConfirmationsTable)
    .set({ status: "auto_confirmed", respondedAt: new Date() })
    .where(and(
      eq(workConfirmationsTable.status, "pending"),
      lte(workConfirmationsTable.expiresAt, new Date()),
    ))
    .returning();
  for (const c of swept) {
    await db.update(jobsTable)
      .set({ customerWorkApprovedAt: new Date() })
      .where(eq(jobsTable.id, c.jobId));
    await captureNow(c.jobId, "auto_sweep");
  }
  if (swept.length > 0) {
    logger.info({ count: swept.length }, "Swept expired work confirmations");
  }
  return swept.length;
}

/**
 * Sweep payments where holdReleaseAt has passed but capture_pending is still
 * set and there's no dispute lock — belt-and-suspenders cleanup in case the
 * confirmation row was deleted out from under us.
 */
export async function sweepStaleHolds(): Promise<number> {
  const stale = await db.select().from(paymentsTable).where(and(
    eq(paymentsTable.status, "capture_pending"),
    isNull(paymentsTable.captureBlockedReason),
    lte(paymentsTable.holdReleaseAt, new Date()),
  ));
  for (const p of stale) {
    await captureNow(p.jobId, "auto_sweep");
  }
  return stale.length;
}

export async function manualRetryCapture(jobId: number): Promise<{ ok: boolean; reason?: string }> {
  // Allow retry on payout_failed by resetting state back to capture_pending.
  await db.update(paymentsTable)
    .set({ status: "capture_pending", failureReason: null })
    .where(and(eq(paymentsTable.jobId, jobId), eq(paymentsTable.status, "payout_failed")));
  await db.update(workConfirmationsTable)
    .set({ captureFired: "false" })
    .where(eq(workConfirmationsTable.jobId, jobId));
  return captureNow(jobId, "admin_manual");
}
