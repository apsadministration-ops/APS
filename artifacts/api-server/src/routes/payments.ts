import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, paymentsTable, jobsTable, usersTable, shopsTable } from "@workspace/db";
import { tryConvertReferral } from "../lib/referralEngine";
import { authenticate, requireRole, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";
import { checkoutCreationLimiter, paymentReadLimiter } from "../middlewares/paymentRateLimit";
import { awardCustomerPoints } from "../lib/loyaltyEngine";
import { runProgression } from "../lib/tierProgressionEngine";
import {
  getStripePublishableKey,
  getUncachableStripeClient,
  StripeNotConfiguredError,
} from "../lib/stripeClient";
import { getPublicBaseUrl } from "../lib/publicUrl";
import { commissionForJob, splitOnNetProfit, findServiceBySlug, partsCostCentsFor, defaultPartsCostPct, type TierKey, type ServiceCategory } from "@workspace/tier-catalog";
import { isRefundablePayment } from "../lib/authorization";
import { isPartnerJobOwner, isCommercialJobOwner } from "../lib/commercialJobAccess";

const router: IRouter = Router();

type CheckoutResponse = {
  status: number;
  body: Record<string, unknown>;
};

function checkoutResponse(status: number, body: Record<string, unknown>): CheckoutResponse {
  return { status, body };
}

class CheckoutAbort extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super("Checkout request rejected");
  }
}

function abortCheckout(status: number, body: Record<string, unknown>): never {
  throw new CheckoutAbort(status, body);
}

/* -------------------------------------------------------------------------- */
/* CONFIG                                                                     */
/* -------------------------------------------------------------------------- */

router.get("/payments/config", paymentReadLimiter, async (_req, res): Promise<void> => {
  try {
    const publishableKey = await getStripePublishableKey();
    res.json({ publishableKey });
  } catch {
    res.status(503).json({ error: "stripe_provider_not_configured" });
  }
});

/* -------------------------------------------------------------------------- */
/* LIST                                                                       */
/* -------------------------------------------------------------------------- */

router.get("/payments", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const payments = await db.select().from(paymentsTable).orderBy(paymentsTable.createdAt);
  if (req.userRole === "admin") {
    res.json(payments);
    return;
  }
  const userJobs = await db.select().from(jobsTable);
  const relevantJobIds = new Set(
    (await Promise.all(userJobs.map(async (j) => {
      if (j.mechanicId === req.userId) return j.id;
      if (req.userRole === "shop_owner") {
        return j.customerId === req.userId && await isPartnerJobOwner(j, req.userId!)
          ? j.id
          : null;
      }
      return j.customerId === req.userId ? j.id : null;
    }))).filter((id): id is number => id !== null),
  );
  res.json(payments.filter((p) => relevantJobIds.has(p.jobId)));
});

/* -------------------------------------------------------------------------- */
/* CHECKOUT — customer authorizes payment for a job                           */
/* -------------------------------------------------------------------------- */

router.post("/payments/jobs/:jobId/checkout", authenticate, checkoutCreationLimiter, async (req: AuthRequest, res): Promise<void> => {
  if (!["customer", "shop_owner"].includes(req.userRole ?? "")) {
    res.status(403).json({ error: "Only the customer can authorize payment" });
    return;
  }
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const baseUrl = getPublicBaseUrl("payment");
  if (!baseUrl) {
    res.status(503).json({ error: "public_url_not_configured" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Destination edits and checkout both serialize on this row. Keep the
      // lock through Stripe session creation and the payment-row write so the
      // transfer destination sent to Stripe cannot differ from the snapshot
      // committed to the database.
      await tx.execute(sql`SELECT id FROM jobs WHERE id = ${jobId} FOR UPDATE`);
      const [job] = await tx.select().from(jobsTable).where(eq(jobsTable.id, jobId));
      if (!job) abortCheckout(404, { error: "Job not found" });
      if (job.customerId !== req.userId) abortCheckout(403, { error: "Not your job" });
      if (
        req.userRole === "shop_owner" &&
        job.sourceOrganizationId != null &&
        !(await isCommercialJobOwner(job, req.userId!))
      ) {
        abortCheckout(403, { error: "Not your linked organization job" });
      }
      if (job.status !== "ACCEPTED") {
      abortCheckout(400, { error: `Cannot authorize payment on a job in status ${job.status}` });
      }
      if (!job.mechanicId) abortCheckout(400, { error: "Job has no assigned mechanic yet" });
      if (!job.estimatedPrice || job.estimatedPrice <= 0) {
        abortCheckout(400, { error: "Job has no estimated price" });
      }

      // Idempotency: don't create a second authorized intent for the same job.
      const [existing] = await tx.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
      if (existing && ["authorized", "captured", "released", "held"].includes(existing.status)) {
        abortCheckout(409, { error: "Payment already authorized for this job", paymentId: existing.id });
      }
  // If a previous "pending" attempt left a session/intent dangling, void it
  // before creating a new one. Otherwise the old session could still be
  // completed by the customer (in another tab) and create a ghost hold on
  // their card with no DB linkage. Best-effort — Stripe may already have
  // expired the session, in which case the call is a no-op.
  if (existing && existing.status === "pending") {
    try {
      const stripeAdmin = await getUncachableStripeClient();
      if (existing.providerPaymentIntentId) {
        await stripeAdmin.paymentIntents.cancel(existing.providerPaymentIntentId).catch(() => {});
      } else if (existing.providerSessionId) {
        await stripeAdmin.checkout.sessions.expire(existing.providerSessionId).catch(() => {});
      }
    } catch { /* non-fatal — proceed with new session */ }
  }

  const [customer] = await tx.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  const [mechanic] = await tx.select().from(usersTable).where(eq(usersTable.id, job.mechanicId));
  if (!customer || !mechanic) abortCheckout(404, { error: "User not found" });
  if (!mechanic.stripeAccountId || !mechanic.stripeAccountReady) {
    abortCheckout(400, { error: "Mechanic has not completed payout onboarding yet" });
  }

  const stripe = await getUncachableStripeClient();

  // Ensure customer has a Stripe Customer record. We never store card data — only this id.
  let stripeCustomerId = customer.stripeCustomerId;
  if (!stripeCustomerId) {
    const created = await stripe.customers.create({
      email: customer.email,
      name: customer.name,
      metadata: { userId: String(customer.id) },
    });
    stripeCustomerId = created.id;
    await tx.update(usersTable).set({ stripeCustomerId }).where(eq(usersTable.id, customer.id));
  }

  // Tax handling — customer can pass a sales-tax rate (decimal 0..0.15)
  // OR explicit cents override. Tax is included in the customer total but
  // EXCLUDED from APS commission. Rate is server-clamped.
  const body = (req.body ?? {}) as { taxRate?: number; taxCents?: number };
  const subtotalCents = Math.round(job.estimatedPrice * 100);
  let taxCents = 0;
  if (typeof body.taxCents === "number" && Number.isFinite(body.taxCents) && body.taxCents > 0) {
    taxCents = Math.min(Math.round(body.taxCents), Math.round(subtotalCents * 0.15));
  } else if (typeof body.taxRate === "number" && Number.isFinite(body.taxRate) && body.taxRate > 0) {
    const clampedRate = Math.min(Math.max(body.taxRate, 0), 0.15);
    taxCents = Math.round(subtotalCents * clampedRate);
  }
  const amountCents = subtotalCents + taxCents;
  // Tier-aware commission: detailing → 15/85; same-tier → 20/80; mechanic
  // working down a level (or more) → 25/75. Single source of truth in
  // `@workspace/tier-catalog`. Legacy jobs without a `requiredTier` fall back
  // to detailer (the lowest tier) which gives mechanics the normal split.
  // OVERRIDE: Fleet/Dealership partner-posted jobs stamp a flat platform-fee
  // at post-time (default 15%, 10% for GSA/Government accounts). When set,
  // this replaces the tier-catalog rate end-to-end (authorization +
  // capture). Same shape so downstream Stripe + ledger code is unchanged.
  const commission = (job.commissionPctOverride != null && Number.isFinite(job.commissionPctOverride))
    ? (() => {
        const platformPct = Math.max(0, Math.min(100, Math.round(job.commissionPctOverride!)));
        return {
          platformPct, mechanicPct: 100 - platformPct,
          platformRate: platformPct / 100, mechanicRate: (100 - platformPct) / 100,
          reason: "normal" as const,
          reasonLabel: `Partner-posted job — flat ${platformPct}% platform fee.`,
        };
      })()
    : commissionForJob({
        category: job.jobType as ServiceCategory,
        jobTier: ((job.requiredTier ?? "detailer") as TierKey),
        mechanicTier: (mechanic.mechanicTier ?? "detailer") as TierKey,
      });
  // True Net Profit: APS commission applies ONLY to (revenue − parts cost).
  // Mechanic gets the parts-cost passthrough at 100% plus their share of net
  // profit. Catalog entry preferred; if missing, fall back to category default.
  // Catalog estimate — final actual parts cost lands at capture time from
  // mechanic-entered parts_items. Tax is excluded from the commission base.
  const svcEntry = findServiceBySlug(job.serviceSlug);
  const partsCostCents = svcEntry
    ? partsCostCentsFor(svcEntry, subtotalCents)
    : Math.round(subtotalCents * defaultPartsCostPct(job.jobType as ServiceCategory));
  const { platformFeeCents, mechanicPayoutCents } = splitOnNetProfit(subtotalCents, partsCostCents, commission);

  // Per-job payout destination — `existing` may have been pre-stamped by an
  // admin or shop owner via PATCH /payouts/job/:jobId/destination BEFORE the
  // customer authorizes. Stripe `transfer_data.destination` is fixed at PI
  // creation, so this is the only point at which we can route to a shop.
  //
  // Supported modes:
  //   "mechanic" (default) → mechanic's connected account
  //   "shop"               → shop's connected account
  //
  // Split payouts are intentionally not implemented. Never silently route a
  // requested split to the mechanic, because that would create an incorrect
  // financial result. Existing split rows fail closed below until a future
  // implementation adds an atomic secondary transfer + ledger entry.
  let transferDestination = mechanic.stripeAccountId;
  let resolvedShopId: number | null = existing?.shopId ?? null;
  let resolvedDestination: "mechanic" | "shop" | "split" = (existing?.payoutDestination ?? "mechanic") as "mechanic" | "shop" | "split";
  if (resolvedDestination === "split") {
    abortCheckout(409, { error: "Split payouts are not supported yet. Choose mechanic or shop." });
  }
  if (resolvedDestination === "shop" && resolvedShopId) {
    const [shop] = await tx.select().from(shopsTable).where(eq(shopsTable.id, resolvedShopId));
    if (!shop || shop.status !== "active" || !shop.stripeAccountId || !shop.stripeAccountReady) {
      abortCheckout(400, { error: "Selected shop has not finished payout setup yet." });
    }
    transferDestination = shop.stripeAccountId;
  } else if (resolvedDestination === "shop") {
    // A shop destination without a concrete shop would otherwise fall
    // through to the mechanic account while retaining payoutDestination=shop.
    abortCheckout(400, { error: "A shop destination requires a shopId." });
  }

  // Idempotency key — if the customer double-taps "Pay" or the network
  // retries the request, Stripe returns the SAME session instead of
  // creating two PaymentIntents. Scope is (job, payment-row id) so a
  // legitimate re-checkout after a canceled row gets a fresh key.
  const idempotencyKey = `checkout:job:${jobId}:row:${existing?.id ?? "new"}:${Date.now() >> 14}`;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    // Apple Pay & Google Pay are auto-enabled for `card` on supported devices/browsers.
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: subtotalCents,
          product_data: {
            name: `APS Service — Job #${jobId}`,
            description: job.description?.slice(0, 200) ?? "Automotive service",
          },
        },
      },
      ...(taxCents > 0 ? [{
        quantity: 1,
        price_data: {
          currency: "usd" as const,
          unit_amount: taxCents,
          product_data: { name: "Sales tax" },
        },
      }] : []),
    ],
    payment_intent_data: {
      capture_method: "manual",
      application_fee_amount: platformFeeCents,
      transfer_data: { destination: transferDestination },
      metadata: { jobId: String(jobId), customerId: String(customer.id), mechanicId: String(mechanic.id), payoutDestination: resolvedDestination },
    },
    success_url: `${baseUrl}/api/payments/checkout/return?session_id={CHECKOUT_SESSION_ID}&status=success`,
    cancel_url: `${baseUrl}/api/payments/checkout/return?session_id={CHECKOUT_SESSION_ID}&status=cancel`,
    metadata: { jobId: String(jobId) },
  }, { idempotencyKey });

  // Upsert payment row — pre-record so webhook can find it by session id.
  const totalCost = amountCents / 100;
  // Stamp the tax + estimate snapshot on both the payment row AND the job
  // row so admin reporting + customer invoice are consistent before capture.
  await tx.update(jobsTable).set({ taxCents }).where(eq(jobsTable.id, jobId));
  if (existing) {
    // Reset Stripe references so a late webhook from the previous (now
    // canceled) intent can't flip this fresh row back to authorized.
    await tx.update(paymentsTable)
      .set({
        amount: totalCost,
        platformFee: platformFeeCents / 100,
        mechanicPayout: mechanicPayoutCents / 100,
        amountCents,
        platformFeeCents,
        mechanicPayoutCents,
        taxCents,
        partsCostAppliedCents: partsCostCents,
        laborRevenueCents: subtotalCents - partsCostCents,
        netProfitCents: subtotalCents - partsCostCents,
        providerSessionId: session.id,
        providerPaymentIntentId: null,
        failureReason: null,
        status: "pending",
        payoutDestination: resolvedDestination,
        shopId: resolvedShopId,
      })
      .where(eq(paymentsTable.id, existing.id));
  } else {
    await tx.insert(paymentsTable).values({
      jobId,
      amount: totalCost,
      platformFee: platformFeeCents / 100,
      mechanicPayout: mechanicPayoutCents / 100,
      amountCents,
      platformFeeCents,
      mechanicPayoutCents,
      taxCents,
      partsCostAppliedCents: partsCostCents,
      laborRevenueCents: subtotalCents - partsCostCents,
      netProfitCents: subtotalCents - partsCostCents,
      providerSessionId: session.id,
      status: "pending",
      payoutDestination: resolvedDestination,
      shopId: resolvedShopId,
    });
  }

      return checkoutResponse(200, { url: session.url, sessionId: session.id });
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof CheckoutAbort) {
      res.status(error.status).json(error.body);
      return;
    }
    throw error;
  }
});

/**
 * Lightweight HTML page Stripe redirects to after Checkout. We just close the
 * tab/show a message — webhook is the source of truth.
 */
router.get("/payments/checkout/return", async (req, res): Promise<void> => {
  const status = String(req.query["status"] ?? "");
  const ok = status === "success";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ok ? "Payment authorized" : "Payment cancelled"}</title><style>body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,sans-serif;background:#0b0c10;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}h1{font-size:28px;margin:0 0 12px}p{color:#94a3b8;max-width:420px;margin:0 auto 24px}.icon{width:80px;height:80px;border-radius:50%;background:${ok ? "#22c55e" : "#f97316"};display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:40px}</style></head><body><div><div class="icon">${ok ? "✓" : "✕"}</div><h1>${ok ? "Payment authorized" : "Payment cancelled"}</h1><p>${ok ? "Your funds are on hold and will be charged when the mechanic completes the work. You can close this tab and return to the APS app." : "No charge was made. You can close this tab."}</p></div></body></html>`);
});

/* -------------------------------------------------------------------------- */
/* CONNECT — mechanic payout onboarding                                       */
/* -------------------------------------------------------------------------- */

router.post("/payments/connect/onboarding", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const baseUrl = getPublicBaseUrl("payment");
  if (!baseUrl) {
    res.status(503).json({ error: "public_url_not_configured" });
    return;
  }
  const stripe = await getUncachableStripeClient();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  let stripeAccountId = user.stripeAccountId;
  if (!stripeAccountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: user.email,
      capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
      metadata: { userId: String(user.id) },
    });
    stripeAccountId = account.id;
    await db.update(usersTable).set({ stripeAccountId }).where(eq(usersTable.id, user.id));
  }

  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${baseUrl}/api/payments/connect/return?status=refresh`,
    return_url: `${baseUrl}/api/payments/connect/return?status=done`,
    type: "account_onboarding",
  });
  res.json({ url: link.url });
});

router.get("/payments/connect/status", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (!user.stripeAccountId) {
    res.json({ accountId: null, ready: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
    return;
  }
  const stripe = await getUncachableStripeClient();
  const account = await stripe.accounts.retrieve(user.stripeAccountId);
  const ready = !!(account.charges_enabled && account.payouts_enabled && account.details_submitted);
  if (ready !== user.stripeAccountReady) {
    await db.update(usersTable).set({ stripeAccountReady: ready }).where(eq(usersTable.id, user.id));
  }
  res.json({
    accountId: user.stripeAccountId,
    ready,
    chargesEnabled: !!account.charges_enabled,
    payoutsEnabled: !!account.payouts_enabled,
    detailsSubmitted: !!account.details_submitted,
  });
});

router.get("/payments/connect/return", async (req, res): Promise<void> => {
  const done = String(req.query["status"] ?? "") === "done";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>${done ? "Onboarding complete" : "Onboarding"}</title><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0c10;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}h1{margin:0 0 12px}p{color:#94a3b8;max-width:420px;margin:0 auto}.icon{width:80px;height:80px;border-radius:50%;background:${done ? "#22c55e" : "#f97316"};display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:40px}</style></head><body><div><div class="icon">${done ? "✓" : "↻"}</div><h1>${done ? "Payouts set up" : "Resume onboarding"}</h1><p>${done ? "Your account is being verified. Return to the APS app — payouts to your bank will be enabled shortly." : "Please return to the APS app and tap \"Set up Payouts\" again to continue."}</p></div></body></html>`);
});

/* -------------------------------------------------------------------------- */
/* LEGACY admin release — kept for any pre-Stripe rows                        */
/* -------------------------------------------------------------------------- */

router.post("/payments/:jobId/release", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
  if (payment.providerSessionId) {
    res.status(400).json({
      error: "This is a Stripe-managed payment — funds are captured automatically when the work log is submitted. Manual release is not required.",
    });
    return;
  }
  if (payment.status !== "held") {
    if (["captured", "released"].includes(payment.status)) {
      res.status(400).json({ error: "Payment already released" });
    } else {
      res.status(400).json({ error: `Cannot release a legacy payment in status "${payment.status}".` });
    }
    return;
  }
  const [updated] = await db.update(paymentsTable)
    .set({ status: "released", releasedAt: new Date() })
    .where(and(eq(paymentsTable.jobId, jobId), eq(paymentsTable.status, "held")))
    .returning();
  if (!updated) {
    res.status(409).json({ error: "Payment was released by another request." });
    return;
  }
  await db.update(jobsTable).set({ status: "PAID" }).where(eq(jobsTable.id, jobId));
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (job?.mechanicId) {
    runProgression(job.mechanicId, "job_paid", { logger: req.log })
      .catch((err) => req.log.error({ err, mechanicId: job.mechanicId }, "tier progression failed"));
  }
  if (job?.customerId) {
    // Legacy release path — give the same spending points the Stripe path
    // would have awarded (1 pt per $ released).
    const dollars = Math.floor(updated?.amount ?? 0);
    await awardCustomerPoints(job.customerId, dollars, "service", `Job #${jobId} — service spending`, jobId).catch(() => {});
    // Delegate referral conversion to the isolated referral engine.
    await tryConvertReferral(jobId).catch(() => {});
  }
  res.json(updated);
});

/* -------------------------------------------------------------------------- */
/* REFUND — admin issues a refund on a captured Stripe payment                */
/* -------------------------------------------------------------------------- */

router.post("/payments/:jobId/refund", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const [payment] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
  if (payment.status === "refunded") { res.status(400).json({ error: "Payment already refunded" }); return; }
  const paymentIntentId = payment.providerPaymentIntentId;
  if (!paymentIntentId) {
    res.status(400).json({ error: "This is a legacy (non-Stripe) payment and cannot be refunded through this endpoint." });
    return;
  }
  if (!isRefundablePayment({ status: payment.status, providerPaymentIntentId: paymentIntentId })) {
    res.status(400).json({ error: `Cannot refund a payment in status "${payment.status}".` });
    return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    if (payment.status === "authorized") {
      // Funds not yet captured — cancel the intent, no refund needed.
      await stripe.paymentIntents.cancel(paymentIntentId);
      // Webhook payment_intent.canceled will set status. Reflect immediately too.
      await db.update(paymentsTable).set({ status: "canceled" }).where(eq(paymentsTable.id, payment.id));
    } else {
      // Captured → issue full refund. Webhook charge.refunded handles status flip
      // + job/loyalty reversal; doing it here too would risk double-reversal,
      // so we leave job status / loyalty to the webhook.
      await stripe.refunds.create({
        payment_intent: paymentIntentId,
        reverse_transfer: true,
        refund_application_fee: true,
      });
    }
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      res.status(503).json({ error: "stripe_provider_not_configured" });
      return;
    }
    res.status(502).json({ error: "stripe_refund_failed" });
  }
});

export default router;
