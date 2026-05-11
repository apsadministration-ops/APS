/**
 * Dispute engine — handles BOTH customer-filed (in-app) and Stripe-card
 * chargeback flows. See `lib/db/src/schema/disputes.ts` for the data model.
 *
 * Stripe owns the actual chargeback OUTCOME for `kind="stripe_chargeback"`
 * rows; APS just mirrors status here so admins + mechanics see one unified
 * dashboard.
 */

import type Stripe from "stripe";
import { eq } from "drizzle-orm";
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
  // Upsert by provider_dispute_id (unique).
  const existing = await db.select().from(disputesTable)
    .where(eq(disputesTable.providerDisputeId, dispute.id));
  if (existing.length === 0) {
    await db.insert(disputesTable).values({
      jobId: pmt.jobId,
      paymentId: pmt.id,
      customerId: job.customerId,
      mechanicId: job.mechanicId,
      kind: "stripe_chargeback",
      providerDisputeId: dispute.id,
      reason: dispute.reason ?? null,
      amountCents: dispute.amount ?? null,
      status,
    });
    // Freeze the payment.
    await db.update(paymentsTable)
      .set({ status: "disputed", captureBlockedReason: "dispute" })
      .where(eq(paymentsTable.id, pmt.id));
    // Notify mechanic + admin.
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
  } else {
    // Status update.
    await db.update(disputesTable)
      .set({
        status,
        amountCents: dispute.amount ?? existing[0]!.amountCents,
        reason: dispute.reason ?? existing[0]!.reason,
        resolvedAt: ["resolved_customer", "resolved_mechanic"].includes(status) ? new Date() : null,
      })
      .where(eq(disputesTable.id, existing[0]!.id));
    if (status === "resolved_mechanic") {
      // Mechanic won — unblock the payment so the next sweep can capture.
      await db.update(paymentsTable)
        .set({ captureBlockedReason: null })
        .where(eq(paymentsTable.id, pmt.id));
    }
    if (["resolved_customer", "resolved_mechanic"].includes(status) && job.mechanicId) {
      const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, job.mechanicId));
      if (mech?.pushToken) {
        void notifyMechanicDisputeResolved(mech.pushToken, pmt.jobId, status === "resolved_mechanic");
      }
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
