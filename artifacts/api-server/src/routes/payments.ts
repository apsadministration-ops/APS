import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, paymentsTable, jobsTable, referralsTable, usersTable } from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";
import { awardLoyaltyPoints } from "./loyalty";
import { getStripePublishableKey, getUncachableStripeClient } from "../lib/stripeClient";

const router: IRouter = Router();

const PLATFORM_FEE_RATE = 0.1; // 10% APS commission

/* -------------------------------------------------------------------------- */
/* CONFIG                                                                     */
/* -------------------------------------------------------------------------- */

router.get("/payments/config", async (_req, res): Promise<void> => {
  try {
    const publishableKey = await getStripePublishableKey();
    res.json({ publishableKey });
  } catch (err) {
    res.status(503).json({ error: "Stripe not configured", details: (err as Error).message });
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
    userJobs.filter((j) => j.customerId === req.userId || j.mechanicId === req.userId).map((j) => j.id),
  );
  res.json(payments.filter((p) => relevantJobIds.has(p.jobId)));
});

/* -------------------------------------------------------------------------- */
/* CHECKOUT — customer authorizes payment for a job                           */
/* -------------------------------------------------------------------------- */

router.post("/payments/jobs/:jobId/checkout", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "customer") {
    res.status(403).json({ error: "Only customers can authorize payment" });
    return;
  }
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.customerId !== req.userId) { res.status(403).json({ error: "Not your job" }); return; }
  if (job.status !== "ACCEPTED") {
    res.status(400).json({ error: `Cannot authorize payment on a job in status ${job.status}` });
    return;
  }
  if (!job.mechanicId) { res.status(400).json({ error: "Job has no assigned mechanic yet" }); return; }
  if (!job.estimatedPrice || job.estimatedPrice <= 0) {
    res.status(400).json({ error: "Job has no estimated price" });
    return;
  }

  // Idempotency: don't create a second authorized intent for the same job.
  const [existing] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  if (existing && ["authorized", "captured", "released", "held"].includes(existing.status)) {
    res.status(409).json({ error: "Payment already authorized for this job", paymentId: existing.id });
    return;
  }

  const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  const [mechanic] = await db.select().from(usersTable).where(eq(usersTable.id, job.mechanicId));
  if (!customer || !mechanic) { res.status(404).json({ error: "User not found" }); return; }
  if (!mechanic.stripeAccountId || !mechanic.stripeAccountReady) {
    res.status(400).json({ error: "Mechanic has not completed payout onboarding yet" });
    return;
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
    await db.update(usersTable).set({ stripeCustomerId }).where(eq(usersTable.id, customer.id));
  }

  const amountCents = Math.round(job.estimatedPrice * 100);
  const platformFeeCents = Math.round(amountCents * PLATFORM_FEE_RATE);
  const mechanicPayoutCents = amountCents - platformFeeCents;

  const baseUrl = `https://${(process.env["REPLIT_DOMAINS"] ?? "").split(",")[0] ?? ""}`;
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    // Apple Pay & Google Pay are auto-enabled for `card` on supported devices/browsers.
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: amountCents,
        product_data: {
          name: `APS Service — Job #${jobId}`,
          description: job.description?.slice(0, 200) ?? "Automotive service",
        },
      },
    }],
    payment_intent_data: {
      capture_method: "manual",
      application_fee_amount: platformFeeCents,
      transfer_data: { destination: mechanic.stripeAccountId },
      metadata: { jobId: String(jobId), customerId: String(customer.id), mechanicId: String(mechanic.id) },
    },
    success_url: `${baseUrl}/api/payments/checkout/return?session_id={CHECKOUT_SESSION_ID}&status=success`,
    cancel_url: `${baseUrl}/api/payments/checkout/return?session_id={CHECKOUT_SESSION_ID}&status=cancel`,
    metadata: { jobId: String(jobId) },
  });

  // Upsert payment row — pre-record so webhook can find it by session id.
  const totalCost = amountCents / 100;
  if (existing) {
    await db.update(paymentsTable)
      .set({
        amount: totalCost,
        platformFee: platformFeeCents / 100,
        mechanicPayout: mechanicPayoutCents / 100,
        amountCents,
        platformFeeCents,
        mechanicPayoutCents,
        providerSessionId: session.id,
        status: "pending",
      })
      .where(eq(paymentsTable.id, existing.id));
  } else {
    await db.insert(paymentsTable).values({
      jobId,
      amount: totalCost,
      platformFee: platformFeeCents / 100,
      mechanicPayout: mechanicPayoutCents / 100,
      amountCents,
      platformFeeCents,
      mechanicPayoutCents,
      providerSessionId: session.id,
      status: "pending",
    });
  }

  res.json({ url: session.url, sessionId: session.id });
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

router.post("/payments/connect/onboarding", authenticate, requireRole("mechanic"), async (req: AuthRequest, res): Promise<void> => {
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

  const baseUrl = `https://${(process.env["REPLIT_DOMAINS"] ?? "").split(",")[0] ?? ""}`;
  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${baseUrl}/api/payments/connect/return?status=refresh`,
    return_url: `${baseUrl}/api/payments/connect/return?status=done`,
    type: "account_onboarding",
  });
  res.json({ url: link.url });
});

router.get("/payments/connect/status", authenticate, requireRole("mechanic"), async (req: AuthRequest, res): Promise<void> => {
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
  if (["captured", "released"].includes(payment.status)) {
    res.status(400).json({ error: "Payment already released" });
    return;
  }
  const [updated] = await db.update(paymentsTable)
    .set({ status: "released", releasedAt: new Date() })
    .where(eq(paymentsTable.jobId, jobId))
    .returning();
  await db.update(jobsTable).set({ status: "PAID" }).where(eq(jobsTable.id, jobId));
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (job?.customerId) {
    await awardLoyaltyPoints(job.customerId, 100, `Job #${jobId} completed`, jobId).catch(() => {});
    const [referral] = await db.select().from(referralsTable).where(eq(referralsTable.referredId, job.customerId));
    if (referral && !referral.rewarded) {
      await awardLoyaltyPoints(referral.referrerId, 500, "Referral reward — friend completed first job", jobId).catch(() => {});
      await db.update(referralsTable).set({ rewarded: true }).where(eq(referralsTable.id, referral.id));
    }
  }
  res.json(updated);
});

export default router;
