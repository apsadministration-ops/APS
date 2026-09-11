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
  workConfirmationsTable, disputesTable, partsItemsTable, workLogsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { getUncachableStripeClient } from "./stripeClient";
import { findServiceBySlug, partsCostCentsFor, defaultPartsCostPct, type ServiceCategory } from "@workspace/tier-catalog";
import { computeBreakdown } from "./financialEngine";
import { canRespondToWorkConfirmation } from "./authorization";
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
    // Only re-arm a confirmation that is still pending. A re-submitted work log
    // must NEVER reset one the customer has already disputed or confirmed (nor
    // one that auto-confirmed/expired) — that would wipe a dispute or extend
    // the escrow hold indefinitely.
    setWhere: eq(workConfirmationsTable.status, "pending"),
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
    if (conf.status !== "pending") {
      return { ok: false as const, status: 409, error: `Already ${conf.status}.` };
    }
    if (!canRespondToWorkConfirmation({
      role: input.viewerRole,
      userId: input.viewerId,
      customerId: conf.customerId,
      confirmationStatus: conf.status,
    })) {
      return { ok: false as const, status: 403, error: "Only the customer can respond to this confirmation." };
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
  // Legacy split rows must not capture entirely to the mechanic while the
  // secondary shop transfer is unimplemented.
  if (pmt.payoutDestination === "split") {
    await releaseLock();
    return { ok: false, reason: "split_payout_not_supported" };
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
    const taxCents = pmt.taxCents ?? 0;
    const [mechRow] = await db
      .select({ mechanicTier: usersTable.mechanicTier, pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(eq(usersTable.id, job.mechanicId!));
    // True Net Profit split using ACTUAL mechanic-entered parts cost when a
    // worklog with itemized parts exists. Falls back to catalog-derived
    // estimate for legacy jobs without a worklog/parts_items.
    const [wl] = await db.select().from(workLogsTable).where(eq(workLogsTable.jobId, jobId));
    let actualPartsCents: number | null = null;
    if (wl) {
      const items = await db.select().from(partsItemsTable).where(eq(partsItemsTable.workLogId, wl.id));
      if (items.length > 0) {
        actualPartsCents = items.reduce((s, p) => s + (p.totalCents ?? 0), 0);
      }
    }
    const svcEntry = findServiceBySlug(job.serviceSlug);
    const partsCostCents = actualPartsCents ?? (svcEntry
      ? partsCostCentsFor(svcEntry, Math.max(0, finalCents - taxCents))
      : Math.round(Math.max(0, finalCents - taxCents) * defaultPartsCostPct(job.jobType as ServiceCategory)));

    const breakdown = computeBreakdown({
      amountCents: finalCents,
      taxCents,
      partsCostCents,
      category: job.jobType as ServiceCategory,
      jobTier: (job.requiredTier ?? "detailer") as import("@workspace/tier-catalog").TierKey,
      mechanicTier: (mechRow?.mechanicTier ?? "detailer") as import("@workspace/tier-catalog").TierKey,
      // Partner override flows through here too so capture math matches
      // authorization math. Tier-catalog rate applies when this is null.
      commissionPctOverride: job.commissionPctOverride ?? null,
    });

    await stripe.paymentIntents.capture(pmt.providerPaymentIntentId, {
      amount_to_capture: finalCents,
      application_fee_amount: breakdown.apsCommissionCents,
    });
    // Snapshot the FULL True Net Profit breakdown to the payment row.
    // payment_intent.succeeded webhook will flip status → captured AND
    // backfill stripeFeeCents from balance_transaction.
    await db.update(paymentsTable)
      .set({
        amount: finalCents / 100,
        platformFee: breakdown.apsCommissionCents / 100,
        mechanicPayout: breakdown.mechanicPayoutCents / 100,
        amountCents: finalCents,
        platformFeeCents: breakdown.apsCommissionCents,
        mechanicPayoutCents: breakdown.mechanicPayoutCents,
        partsCostAppliedCents: partsCostCents,
        laborRevenueCents: breakdown.laborCents,
        netProfitCents: breakdown.netProfitCents,
      })
      .where(eq(paymentsTable.id, pmt.id));

    if (mechRow?.pushToken) {
      void notifyMechanicPayoutInitiated(mechRow.pushToken, jobId, breakdown.mechanicPayoutCents / 100);
    }
    logger.info({ jobId, trigger, captureCents: finalCents, partsCents: partsCostCents, source: actualPartsCents !== null ? "actual" : "estimate" }, "24h-hold capture fired");
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

export async function manualRetryCapture(
  jobId: number,
  options: { allowCapturePending?: boolean } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const [job] = await db.select({ status: jobsTable.status })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId));
  if (!job) return { ok: false, reason: "job_not_found" };
  if (job.status !== "COMPLETED") return { ok: false, reason: "invalid_job_state" };

  const [payment] = await db.select({ status: paymentsTable.status })
    .from(paymentsTable)
    .where(eq(paymentsTable.jobId, jobId));
  if (!payment) return { ok: false, reason: "payment_not_found" };

  // The public retry route is for failed captures only. The one exception is
  // the already-admin-gated dispute-resolution path, which deliberately
  // re-arms a disputed payment after it has changed back to capture_pending.
  if (payment.status !== "payout_failed" && !(options.allowCapturePending && payment.status === "capture_pending")) {
    return { ok: false, reason: "invalid_payment_state" };
  }

  // Allow retry on payout_failed by resetting state back to capture_pending.
  if (payment.status === "payout_failed") {
    // Claim the failed-payment transition and re-arm the confirmation under
    // one transaction. The conditional UPDATE's RETURNING row is the
    // concurrency claim; if another retry won, do not touch captureFired.
    const claimed = await db.transaction(async (tx) => {
      const [updated] = await tx.update(paymentsTable)
        .set({ status: "capture_pending", failureReason: null })
        .where(and(eq(paymentsTable.jobId, jobId), eq(paymentsTable.status, "payout_failed")))
        .returning({ id: paymentsTable.id });
      if (!updated) return false;
      // Never turn an in-flight claim back to false. A sweeper/manual retry
      // may have claimed it after the payment read above.
      await tx.update(workConfirmationsTable)
        .set({ captureFired: "false" })
        .where(and(
          eq(workConfirmationsTable.jobId, jobId),
          eq(workConfirmationsTable.captureFired, "false"),
        ));
      return true;
    });
    if (!claimed) return { ok: false, reason: "retry_claim_lost" };
  } else if (options.allowCapturePending) {
    // Dispute resolution already performed the payment transition. Re-arm
    // only while the capture lock is still false; never reset a concurrent
    // sweeper's true claim and risk a second Stripe capture.
    await db.update(workConfirmationsTable)
      .set({ captureFired: "false" })
      .where(and(
        eq(workConfirmationsTable.jobId, jobId),
        eq(workConfirmationsTable.captureFired, "false"),
      ));
  }
  return captureNow(jobId, "admin_manual");
}
