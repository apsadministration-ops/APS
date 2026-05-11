// Stripe webhook handler. Exported as a plain Express handler so it can be
// mounted with `express.raw()` ONLY on its own path — never on the whole /api.
import type { Request, Response } from "express";
import { eq, and, ne, isNull } from "drizzle-orm";
import type Stripe from "stripe";
import { db, paymentsTable, usersTable, jobsTable, tipsTable } from "@workspace/db";
import { tryConvertReferral, revertReferralForJob } from "../lib/referralEngine";
import { getUncachableStripeClient, getWebhookSecret } from "../lib/stripeClient";
import {
  awardCustomerPoints,
  awardMechanicPoints,
  reverseCustomerPointsForJob,
  reverseMechanicPointsForJob,
  RULES,
} from "../lib/loyaltyEngine";
import { logger } from "../lib/logger";
import { runProgression } from "../lib/tierProgressionEngine";
import { recordStripeDispute } from "../lib/disputeEngine";
import {
  handleTransferCreated, handleTransferFailed, handleTransferReversed,
  handlePayoutEvent,
} from "../lib/payoutEventEngine";
import { notifyMechanicTipReceived } from "../lib/notifications";

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const secret = getWebhookSecret();
  if (!secret) {
    logger.warn("Stripe webhook received but no signing secret configured");
    // Return 503 — Stripe will retry.
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }
  const sigHeader = req.headers["stripe-signature"];
  const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
  if (!signature) { res.status(400).json({ error: "Missing stripe-signature" }); return; }

  let event: Stripe.Event;
  try {
    const stripe = await getUncachableStripeClient();
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature, secret);
  } catch (err) {
    logger.warn({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  try {
    await handleEvent(event);
    res.status(200).json({ received: true });
  } catch (err) {
    // Return 500 so Stripe will retry per its backoff policy.
    logger.error({ err, type: event.type, id: event.id }, "Stripe webhook handler error — returning 500 to trigger retry");
    res.status(500).json({ error: "Handler failed" });
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const intentId = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
      if (!session.id || !intentId) return;
      // Tip checkouts: tag flowed via Checkout session metadata.kind="tip".
      // Tip captures immediately (no manual capture), so we just stamp the
      // intent + status here. The actual capture state flips on
      // payment_intent.succeeded below (and that handler dispatches the tip
      // path when it sees a matching tips row).
      if (session.metadata?.["kind"] === "tip") {
        await db.update(tipsTable)
          .set({ providerPaymentIntentId: intentId })
          .where(eq(tipsTable.providerSessionId, session.id));
        logger.info({ sessionId: session.id, intentId }, "Tip checkout session completed");
        break;
      }
      // Move pending → authorized ONLY. If the row is already in any other
      // state (canceled/failed/refunded/captured/authorized), do NOT regress —
      // and treat it as orphaned so the late-arriving authorization is voided.
      const updated = await db.update(paymentsTable)
        .set({ providerPaymentIntentId: intentId, status: "authorized" })
        .where(and(
          eq(paymentsTable.providerSessionId, session.id),
          eq(paymentsTable.status, "pending"),
        ))
        .returning();
      if (updated.length === 0) {
        // Either no payment row matches this session, or the row has already
        // moved past "pending" (e.g. job was cancelled/deleted between the
        // customer paying and this webhook arriving). Auto-cancel the intent
        // so the customer's card isn't held for an orphaned auth.
        try {
          const stripe = await getUncachableStripeClient();
          await stripe.paymentIntents.cancel(intentId);
          logger.warn({ sessionId: session.id, intentId }, "Orphaned Stripe authorization auto-canceled (no matching payment row)");
        } catch (err) {
          logger.error({ err, sessionId: session.id, intentId }, "Failed to auto-cancel orphaned Stripe authorization");
        }
        break;
      }
      logger.info({ sessionId: session.id, intentId }, "Stripe checkout session completed → authorized");
      break;
    }

    case "payment_intent.amount_capturable_updated": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await db.update(paymentsTable)
        .set({ status: "authorized", providerPaymentIntentId: intent.id })
        .where(and(
          eq(paymentsTable.providerPaymentIntentId, intent.id),
          ne(paymentsTable.status, "captured"),
        ));
      break;
    }

    case "payment_intent.succeeded": {
      const intent = event.data.object as Stripe.PaymentIntent;
      // TIP path — separate table, separate flow. Captured tips fire the
      // mechanic's tip-received push and stop here (no loyalty/job changes).
      //
      // Webhook ordering safety: payment_intent.succeeded can arrive BEFORE
      // checkout.session.completed (which is what stamps `providerPaymentIntentId`
      // on the tips row). When it does, fall back to the intent.metadata
      // breadcrumbs we set at tip-checkout creation (`kind=tip`, `tipId`)
      // and stamp the intent id ourselves so the next retry / status flip
      // is consistent.
      if (intent.metadata?.["kind"] === "tip" && intent.metadata?.["tipId"]) {
        const tipId = Number(intent.metadata["tipId"]);
        if (Number.isInteger(tipId)) {
          await db.update(tipsTable)
            .set({ providerPaymentIntentId: intent.id })
            .where(and(eq(tipsTable.id, tipId), isNull(tipsTable.providerPaymentIntentId)));
        }
      }
      const tipUpdated = await db.update(tipsTable)
        .set({ status: "captured", capturedAt: new Date() })
        .where(and(
          eq(tipsTable.providerPaymentIntentId, intent.id),
          ne(tipsTable.status, "captured"),
        ))
        .returning();
      if (tipUpdated.length > 0) {
        const tip = tipUpdated[0]!;
        const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, tip.mechanicId));
        if (mech?.pushToken) {
          void notifyMechanicTipReceived(mech.pushToken, tip.jobId, tip.mechanicAmountCents / 100);
        }
        logger.info({ tipId: tip.id, intentId: intent.id }, "Tip captured");
        return;
      }
      // Atomic, idempotent transition: only the FIRST update with status != 'captured'
      // returns a row. Subsequent webhook retries return 0 rows → no double awards.
      const updated = await db.update(paymentsTable)
        .set({ status: "captured", releasedAt: new Date() })
        .where(and(
          eq(paymentsTable.providerPaymentIntentId, intent.id),
          ne(paymentsTable.status, "captured"),
        ))
        .returning();
      if (updated.length === 0) {
        logger.info({ intentId: intent.id }, "payment_intent.succeeded: no transition (already captured or unknown intent)");
        return;
      }
      const payment = updated[0]!;
      await db.update(jobsTable).set({ status: "PAID" }).where(eq(jobsTable.id, payment.jobId));
      const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, payment.jobId));
      // Trigger tier-progression evaluation now that the mechanic has another paid job.
      if (job?.mechanicId) {
        runProgression(job.mechanicId, "job_paid", { logger })
          .catch((err) => logger.error({ err, mechanicId: job.mechanicId }, "tier progression failed"));
      }
      if (job?.customerId) {
        // CUSTOMER: spending points (1 pt per $1 captured).
        const spendingPoints = Math.floor((payment.amountCents ?? 0) / 100) * RULES.customer.pointsPerDollar;
        await awardCustomerPoints(
          job.customerId, spendingPoints, "service",
          `Job #${payment.jobId} — service spending`, payment.jobId,
        ).catch((err) => logger.error({ err, jobId: payment.jobId }, "customer spending points failed"));
        // REFERRAL CONVERSION — delegated to the isolated referral engine.
        // Engine validates: pending referral exists, this is the customer's
        // FIRST captured payment, and no refund. Idempotent.
        await tryConvertReferral(payment.jobId).catch((err) =>
          logger.error({ err, jobId: payment.jobId }, "referral conversion failed"),
        );
      }
      // MECHANIC: job-volume points weighted by job type.
      if (job?.mechanicId) {
        const base = RULES.mechanic.jobBase[job.jobType] ?? RULES.mechanic.jobBase["maintenance"]!;
        await awardMechanicPoints(
          job.mechanicId, base, "job",
          `Job #${payment.jobId} completed (${job.jobType})`, payment.jobId,
        ).catch((err) => logger.error({ err, jobId: payment.jobId }, "mechanic job points failed"));
      }
      logger.info({ jobId: payment.jobId, intentId: intent.id }, "Payment captured + job marked PAID");
      break;
    }

    case "payment_intent.payment_failed": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await db.update(paymentsTable)
        .set({ status: "failed", failureReason: intent.last_payment_error?.message ?? "Payment failed" })
        .where(and(
          eq(paymentsTable.providerPaymentIntentId, intent.id),
          ne(paymentsTable.status, "captured"),
        ));
      break;
    }

    case "payment_intent.canceled": {
      const intent = event.data.object as Stripe.PaymentIntent;
      await db.update(paymentsTable)
        .set({ status: "canceled" })
        .where(and(
          eq(paymentsTable.providerPaymentIntentId, intent.id),
          ne(paymentsTable.status, "captured"),
        ));
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!intentId) return;
      // Atomic: only the FIRST transition to "refunded" returns a row,
      // so retried webhooks don't double-reverse loyalty/job state.
      const updated = await db.update(paymentsTable)
        .set({ status: "refunded" })
        .where(and(
          eq(paymentsTable.providerPaymentIntentId, intentId),
          ne(paymentsTable.status, "refunded"),
        ))
        .returning();
      if (updated.length === 0) {
        logger.info({ intentId }, "charge.refunded: already reflected — skipping reversal");
        break;
      }
      const payment = updated[0]!;
      // Roll the job back so it's no longer marked PAID, and reverse any
      // loyalty/referral points granted on capture.
      await db.update(jobsTable).set({ status: "COMPLETED" }).where(eq(jobsTable.id, payment.jobId));
      await reverseCustomerPointsForJob(payment.jobId, `Refund — Job #${payment.jobId}`).catch((err) => {
        logger.error({ err, jobId: payment.jobId }, "customer loyalty reversal failed on refund");
      });
      await reverseMechanicPointsForJob(payment.jobId, `Refund — Job #${payment.jobId}`).catch((err) => {
        logger.error({ err, jobId: payment.jobId }, "mechanic loyalty reversal failed on refund");
      });
      // REFERRAL REVERSAL — engine handles the un-conversion + points reversal.
      await revertReferralForJob(payment.jobId).catch((err) =>
        logger.error({ err, jobId: payment.jobId }, "referral revert failed on refund"),
      );
      logger.info({ jobId: payment.jobId, intentId }, "Payment refunded — job reverted + loyalty reversed");
      break;
    }

    /* ---------------------------------------------------------------- */
    /* Disputes — chargebacks. Mirrored into the disputes table so the   */
    /* mechanic + admin dashboards can show one unified queue.           */
    /* ---------------------------------------------------------------- */
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
    case "charge.dispute.funds_withdrawn":
    case "charge.dispute.funds_reinstated": {
      const dispute = event.data.object as Stripe.Dispute;
      const intentId =
        typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : dispute.payment_intent?.id ?? null;
      await recordStripeDispute(dispute, intentId);
      break;
    }

    /* ---------------------------------------------------------------- */
    /* Transfer / payout lifecycle — feeds the mechanic payout dashboard */
    /* timeline and triggers retry/notify on failures. Connect events    */
    /* arrive with `event.account` set to the connected account id.      */
    /* ---------------------------------------------------------------- */
    case "transfer.created": {
      await handleTransferCreated(event.data.object as Stripe.Transfer, event.id);
      break;
    }
    case "transfer.reversed": {
      await handleTransferReversed(event.data.object as Stripe.Transfer, event.id);
      break;
    }
    case "payout.paid":
    case "payout.failed":
    case "payout.canceled": {
      const kind = event.type === "payout.paid" ? "payout_paid"
        : event.type === "payout.failed" ? "payout_failed"
        : "payout_canceled";
      await handlePayoutEvent(
        event.data.object as Stripe.Payout,
        kind,
        event.id,
        event.account ?? null,
      );
      break;
    }

    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const ready = (account.charges_enabled ?? false) && (account.payouts_enabled ?? false) && (account.details_submitted ?? false);
      await db.update(usersTable)
        .set({ stripeAccountReady: ready })
        .where(eq(usersTable.stripeAccountId, account.id));
      logger.info({ accountId: account.id, ready }, "Stripe Connect account updated");
      break;
    }

    default:
      // ignore unhandled events
      break;
  }
}
