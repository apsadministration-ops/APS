/**
 * Dispute engine — handles BOTH customer-filed (in-app) and Stripe-card
 * chargeback flows. See `lib/db/src/schema/disputes.ts` for the data model.
 *
 * Stripe owns the actual chargeback OUTCOME for `kind="stripe_chargeback"`
 * rows; APS just mirrors status here so admins + mechanics see one unified
 * dashboard.
 */

import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { db, disputesTable, paymentsTable, jobsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import {
  notifyMechanicDisputeOpened, notifyMechanicDisputeResolved,
  notifyAdminDispute,
} from "./notifications";

/** Called from charge.dispute.* webhooks. */
export async function recordStripeDispute(
  dispute: Stripe.Dispute,
  intentId: string | null,
): Promise<void> {
  if (!intentId) return;
  const [pmt] = await db.select().from(paymentsTable).where(eq(paymentsTable.providerPaymentIntentId, intentId));
  if (!pmt) {
    logger.warn({ disputeId: dispute.id, intentId }, "Stripe dispute received for unknown payment intent");
    return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, pmt.jobId));
  if (!job) return;

  const status = mapStripeDisputeStatus(dispute.status);
  // Lock the dispute row for the full read/decision/update. Without this,
  // a concurrent terminal event and stale under-review event can both read
  // "open", then the stale writer can commit after the terminal writer and
  // regress the row. The insert race is handled in the same transaction via
  // the unique provider_dispute_id constraint.
  const outcome = await db.transaction(async (tx) => {
    let [current] = await tx.select().from(disputesTable)
      .where(eq(disputesTable.providerDisputeId, dispute.id))
      .for("update");
    let created = false;

    if (!current) {
      const [inserted] = await tx.insert(disputesTable).values({
        jobId: pmt.jobId,
        paymentId: pmt.id,
        customerId: job.customerId,
        mechanicId: job.mechanicId,
        kind: "stripe_chargeback",
        providerDisputeId: dispute.id,
        reason: dispute.reason ?? null,
        amountCents: dispute.amount ?? null,
        status,
      }).onConflictDoNothing({ target: disputesTable.providerDisputeId }).returning();
      if (inserted) {
        current = inserted;
        created = true;
      } else {
        // Another webhook transaction won the insert race. Lock and read the
        // committed row before deciding whether this event is stale.
        [current] = await tx.select().from(disputesTable)
          .where(eq(disputesTable.providerDisputeId, dispute.id))
          .for("update");
      }
    }
    if (!current) throw new Error(`Dispute ${dispute.id} disappeared during upsert`);

    const terminal = isTerminalDisputeStatus(status);
    if (created) {
      // A terminal event can be the first event observed. Never introduce a
      // capture hold for an already-resolved/canceled dispute.
      if (!terminal) {
        await tx.update(paymentsTable)
          .set({ status: "disputed", captureBlockedReason: "dispute" })
          .where(eq(paymentsTable.id, pmt.id));
      } else {
        // If a provider terminal event is the first one observed, clear only
        // APS's dispute marker; do not change money/status fields here.
        await tx.update(paymentsTable)
          .set({ captureBlockedReason: null })
          .where(and(
            eq(paymentsTable.id, pmt.id),
            eq(paymentsTable.captureBlockedReason, "dispute"),
          ));
      }
      return { opened: !terminal, resolved: false };
    }

    // Stripe can deliver related events out of order. Never let a stale
    // created/updated event regress a dispute from review or a terminal
    // outcome, and never let a contradictory terminal event overwrite the
    // first recorded outcome.
    const applyStatus =
      disputeStatusRank(status) > disputeStatusRank(current.status)
      || status === current.status;
    if (!applyStatus) return { opened: false, resolved: false };

    // The row lock makes this conditional update a second, explicit guard if
    // another transaction changes the row between reads in a future refactor.
    const updated = await tx.update(disputesTable)
      .set({
        status,
        amountCents: dispute.amount ?? current.amountCents,
        reason: dispute.reason ?? current.reason,
        resolvedAt: terminal
          ? current.resolvedAt ?? new Date()
          : current.resolvedAt,
      })
      .where(and(
        eq(disputesTable.id, current.id),
        eq(disputesTable.status, current.status),
      ))
      .returning({ id: disputesTable.id });
    if (updated.length === 0) return { opened: false, resolved: false };

    if (terminal) {
      // No terminal dispute should leave the payment frozen. Restrict the
      // clear to our hold marker so unrelated manual holds are preserved.
      await tx.update(paymentsTable)
        .set({ captureBlockedReason: null })
        .where(and(
          eq(paymentsTable.id, pmt.id),
          eq(paymentsTable.captureBlockedReason, "dispute"),
        ));
    }
    return { opened: false, resolved: terminal };
  });

  if (outcome.opened) {
    // Notify mechanic + admin only after the insert/hold transaction commits.
    void (async () => {
      try {
        const [mech] = job.mechanicId
          ? await db.select().from(usersTable).where(eq(usersTable.id, job.mechanicId))
          : [null];
        if (mech?.pushToken) {
          await notifyMechanicDisputeOpened(mech.pushToken, pmt.jobId, dispute.reason ?? null);
        }
        const admins = await db.select().from(usersTable).where(eq(usersTable.role, "admin"));
        for (const admin of admins) {
          if (admin.pushToken) {
            await notifyAdminDispute(admin.pushToken, pmt.jobId, dispute.reason ?? null);
          }
        }
      } catch { /* best-effort */ }
    })();
  } else if (outcome.resolved && job.mechanicId) {
    const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, job.mechanicId));
    if (mech?.pushToken) {
      void notifyMechanicDisputeResolved(mech.pushToken, pmt.jobId, status === "resolved_mechanic");
    }
  }
}

function mapStripeDisputeStatus(status: Stripe.Dispute.Status): "open" | "under_review" | "resolved_customer" | "resolved_mechanic" | "canceled" {
  switch (status) {
    case "warning_needs_response":
    case "warning_under_review":
    case "needs_response":
      return "open";
    case "under_review":
      return "under_review";
    case "won":
      return "resolved_mechanic";
    case "lost":
      return "resolved_customer";
    case "warning_closed":
      return "canceled";
    default:
      return "open";
  }
}

function disputeStatusRank(status: ReturnType<typeof mapStripeDisputeStatus>): number {
  switch (status) {
    case "open": return 1;
    case "under_review": return 2;
    // These are terminal states. Keep all terminal states at the same rank so
    // a late contradictory provider event cannot overwrite the first outcome.
    case "canceled":
    case "resolved_customer":
    case "resolved_mechanic":
      return 3;
  }
}

function isTerminalDisputeStatus(
  status: ReturnType<typeof mapStripeDisputeStatus>,
): boolean {
  return status === "canceled"
    || status === "resolved_customer"
    || status === "resolved_mechanic";
}
