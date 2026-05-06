// Stripe webhook handler. Exported as a plain Express handler so it can be
// mounted with `express.raw()` ONLY on its own path — never on the whole /api.
import type { Request, Response } from "express";
import { eq, and, ne } from "drizzle-orm";
import type Stripe from "stripe";
import { db, paymentsTable, usersTable, jobsTable, referralsTable } from "@workspace/db";
import { getUncachableStripeClient, getWebhookSecret } from "../lib/stripeClient";
import { awardLoyaltyPoints } from "./loyalty";
import { logger } from "../lib/logger";

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
      // Move pending → authorized; do not regress already-captured rows.
      await db.update(paymentsTable)
        .set({ providerPaymentIntentId: intentId, status: "authorized" })
        .where(and(
          eq(paymentsTable.providerSessionId, session.id),
          ne(paymentsTable.status, "captured"),
        ));
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
      if (job?.customerId) {
        await awardLoyaltyPoints(job.customerId, 100, `Job #${payment.jobId} completed`, payment.jobId).catch((err) => {
          logger.error({ err, jobId: payment.jobId }, "loyalty award failed");
        });
        const [referral] = await db.select().from(referralsTable).where(eq(referralsTable.referredId, job.customerId));
        if (referral && !referral.rewarded) {
          await awardLoyaltyPoints(referral.referrerId, 500, "Referral reward — friend completed first job", payment.jobId).catch(() => {});
          await db.update(referralsTable).set({ rewarded: true }).where(eq(referralsTable.id, referral.id));
        }
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
      await db.update(paymentsTable)
        .set({ status: "refunded" })
        .where(eq(paymentsTable.providerPaymentIntentId, intentId));
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
