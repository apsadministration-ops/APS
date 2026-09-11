/**
 * Mechanic payout dashboard — earnings windows, status buckets, per-job
 * breakdowns, payout-event timeline, 1099 link, and admin retry/release.
 *
 * Scopes:
 *   GET  /payouts/summary?window=today|week|month|year
 *   GET  /payouts/buckets               counts/totals per status
 *   GET  /payouts/jobs?status=&limit=   per-job rows for the dashboard list
 *   GET  /payouts/job/:jobId            payment + tips + events for one job
 *   GET  /payouts/events?limit=         payout/transfer event timeline
 *   GET  /payouts/tax-documents         link to Stripe Express dashboard
 *   POST /payouts/:jobId/retry          admin or self — retry failed capture/payout
 *   GET  /admin/payouts/overview        platform-wide payout health (admin)
 *
 * All non-admin endpoints scope to the caller's mechanic id (or shop's
 * mechanics for shop owners).
 */

import { Router, type IRouter, type Response } from "express";
import { and, eq, gte, desc, inArray, or, sql } from "drizzle-orm";
import { db, paymentsTable, jobsTable, tipsTable, payoutEventsTable, usersTable, shopsTable, workConfirmationsTable } from "@workspace/db";
import { authenticate, requireRole, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";
import { manualRetryCapture } from "../lib/payoutHoldEngine";
import { getUncachableStripeClient, StripeNotConfiguredError } from "../lib/stripeClient";
import { getPublicBaseUrl } from "../lib/publicUrl";
import { canManagePayoutDestination, canRetryCapture } from "../lib/authorization";

const router: IRouter = Router();

class DestinationAbort extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super("Payout destination request rejected");
  }
}

function abortDestination(status: number, body: Record<string, unknown>): never {
  throw new DestinationAbort(status, body);
}

function windowStart(window: string): Date {
  const now = new Date();
  switch (window) {
    case "today": {
      const d = new Date(now); d.setHours(0, 0, 0, 0); return d;
    }
    case "week": {
      const d = new Date(now); d.setDate(d.getDate() - 7); return d;
    }
    case "month": {
      const d = new Date(now); d.setDate(d.getDate() - 30); return d;
    }
    case "year": {
      const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d;
    }
    default: {
      const d = new Date(now); d.setDate(d.getDate() - 30); return d;
    }
  }
}

/** Returns the set of job IDs whose payouts belong to the caller. */
async function jobIdsForCaller(req: AuthRequest): Promise<Set<number>> {
  const all = await db.select({ id: jobsTable.id, mechanicId: jobsTable.mechanicId, customerId: jobsTable.customerId })
    .from(jobsTable);
  if (req.userRole === "admin") return new Set(all.map((j) => j.id));
  if (req.userRole === "mechanic") return new Set(all.filter((j) => j.mechanicId === req.userId).map((j) => j.id));
  if (req.userRole === "shop_owner") {
    // Shop owner sees jobs whose payment.shopId belongs to a shop they own.
    const shops = await db.select().from(shopsTable).where(eq(shopsTable.ownerId, req.userId!));
    const shopIds = new Set(shops.map((s) => s.id));
    const pmts = await db.select({ jobId: paymentsTable.jobId, shopId: paymentsTable.shopId }).from(paymentsTable);
    return new Set(pmts.filter((p) => p.shopId !== null && shopIds.has(p.shopId)).map((p) => p.jobId));
  }
  return new Set(all.filter((j) => j.customerId === req.userId).map((j) => j.id));
}

router.get("/payouts/summary", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const window = String(req.query["window"] ?? "month");
  const since = windowStart(window);
  const ids = await jobIdsForCaller(req);
  if (ids.size === 0) {
    res.json({ window, since, captured: 0, pending: 0, holdReleased: 0, tips: 0, fees: 0, refunded: 0, jobCount: 0 });
    return;
  }
  const pmts = await db.select().from(paymentsTable)
    .where(and(gte(paymentsTable.createdAt, since), inArray(paymentsTable.jobId, [...ids])));
  const tips = await db.select().from(tipsTable)
    .where(and(gte(tipsTable.createdAt, since), inArray(tipsTable.jobId, [...ids])));

  let captured = 0;
  let pending = 0;
  let fees = 0;
  let refunded = 0;
  let jobCount = 0;
  for (const p of pmts) {
    if (p.status === "captured" || p.status === "released") {
      captured += p.mechanicPayout;
      fees += p.platformFee;
      jobCount++;
    } else if (["authorized", "capture_pending", "payout_failed", "disputed"].includes(p.status)) {
      pending += p.mechanicPayout;
    } else if (p.status === "refunded") {
      refunded += p.amount;
    }
  }
  let tipTotal = 0;
  for (const t of tips) if (t.status === "captured") tipTotal += t.mechanicAmountCents / 100;

  res.json({
    window, since,
    captured: Math.round(captured * 100) / 100,
    pending: Math.round(pending * 100) / 100,
    tips: Math.round(tipTotal * 100) / 100,
    fees: Math.round(fees * 100) / 100,
    refunded: Math.round(refunded * 100) / 100,
    jobCount,
  });
});

router.get("/payouts/buckets", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const ids = await jobIdsForCaller(req);
  const buckets: Record<string, { count: number; total: number }> = {
    pending: { count: 0, total: 0 },
    processing: { count: 0, total: 0 },
    scheduled: { count: 0, total: 0 },
    paid: { count: 0, total: 0 },
    on_hold: { count: 0, total: 0 },
    under_review: { count: 0, total: 0 },
  };
  if (ids.size === 0) { res.json(buckets); return; }
  const pmts = await db.select().from(paymentsTable).where(inArray(paymentsTable.jobId, [...ids]));
  for (const p of pmts) {
    const k =
      p.status === "authorized" ? "pending"
      : p.status === "capture_pending" ? "scheduled"
      : p.status === "captured" || p.status === "released" ? "paid"
      : p.status === "payout_failed" ? "on_hold"
      : p.status === "disputed" ? "under_review"
      : null;
    if (!k) continue;
    const b = buckets[k];
    if (b) { b.count++; b.total += p.mechanicPayout; }
  }
  // "processing" = captured but no transfer/payout event arrived yet.
  // We approximate from payout_events keyed by mechanicId.
  res.json(buckets);
});

router.get("/payouts/jobs", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const limit = Math.min(200, Math.max(1, Number(req.query["limit"] ?? 50)));
  const status = String(req.query["status"] ?? "");
  const ids = await jobIdsForCaller(req);
  if (ids.size === 0) { res.json([]); return; }
  let pmts = await db.select().from(paymentsTable)
    .where(inArray(paymentsTable.jobId, [...ids]))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(limit);
  if (status) pmts = pmts.filter((p) => p.status === status);
  // Decorate.
  const jobs = await db.select().from(jobsTable).where(inArray(jobsTable.id, pmts.map((p) => p.jobId)));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  res.json(pmts.map((p) => ({
    ...p,
    job: jobById.get(p.jobId) ?? null,
  })));
});

router.get("/payouts/job/:jobId", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  if (req.userRole !== "admin" && req.userId !== job.customerId && req.userId !== job.mechanicId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const [pmt] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  const [conf] = await db.select().from(workConfirmationsTable).where(eq(workConfirmationsTable.jobId, jobId));
  const tips = await db.select().from(tipsTable).where(eq(tipsTable.jobId, jobId)).orderBy(desc(tipsTable.createdAt));
  const events = pmt
    ? await db.select().from(payoutEventsTable)
        .where(eq(payoutEventsTable.paymentId, pmt.id))
        .orderBy(desc(payoutEventsTable.createdAt))
    : [];
  res.json({ job, payment: pmt ?? null, confirmation: conf ?? null, tips, events });
});

router.get("/payouts/events", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const limit = Math.min(200, Math.max(1, Number(req.query["limit"] ?? 50)));
  let rows;
  if (req.userRole === "admin") {
    rows = await db.select().from(payoutEventsTable)
      .orderBy(desc(payoutEventsTable.createdAt))
      .limit(limit);
  } else {
    rows = await db.select().from(payoutEventsTable)
      .where(eq(payoutEventsTable.mechanicId, req.userId!))
      .orderBy(desc(payoutEventsTable.createdAt))
      .limit(limit);
  }
  res.json(rows);
});

router.get("/payouts/tax-documents", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!["mechanic", "shop_owner"].includes(req.userRole ?? "")) {
    res.status(403).json({ error: "Mechanics & shop owners only" }); return;
  }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!u?.stripeAccountId) { res.status(400).json({ error: "Set up payouts first." }); return; }
  try {
    const stripe = await getUncachableStripeClient();
    // Magic link to the connected account's Express dashboard. Stripe owns
    // 1099 issuance + display in that dashboard.
    const link = await stripe.accounts.createLoginLink(u.stripeAccountId);
    res.json({ url: link.url });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      res.status(503).json({ error: "stripe_provider_not_configured" });
      return;
    }
    res.status(502).json({ error: "stripe_provider_error" });
  }
});

router.post("/payouts/:jobId/retry", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  const [payment] = await db.select({ status: paymentsTable.status })
    .from(paymentsTable)
    .where(eq(paymentsTable.jobId, jobId));
  if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }
  if (!canRetryCapture({
    role: req.userRole,
    status: req.user?.status,
    userId: req.userId,
    assignedMechanicId: job.mechanicId,
    jobStatus: job.status,
    paymentStatus: payment.status,
  })) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const out = await manualRetryCapture(jobId);
  if (!out.ok) {
    res.status(409).json({ error: out.reason ?? "Capture retry is not available for this payment." });
    return;
  }
  res.json(out);
});

router.get("/admin/payouts/overview", authenticate, requireRole("admin"), async (_req: AuthRequest, res: Response): Promise<void> => {
  const all = await db.select({
    status: paymentsTable.status,
    sum: sql<string>`SUM(${paymentsTable.mechanicPayout})`,
    count: sql<string>`COUNT(*)`,
  }).from(paymentsTable).groupBy(paymentsTable.status);
  const events = await db.select().from(payoutEventsTable)
    .orderBy(desc(payoutEventsTable.createdAt))
    .limit(50);
  const failed = await db.select().from(paymentsTable).where(eq(paymentsTable.status, "payout_failed"));
  res.json({
    statusBreakdown: all,
    failedPayouts: failed,
    recentEvents: events,
  });
});

/* -------------------------------------------------------------------------- */
/* Shop-owner Connect onboarding (company-type Express)                       */
/* -------------------------------------------------------------------------- */

router.post("/payouts/shop/connect/onboarding", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userRole !== "shop_owner" || req.user?.status !== "active") {
    res.status(403).json({ error: "Active shop owners only" }); return;
  }
  const baseUrl = getPublicBaseUrl("payout");
  if (!baseUrl) {
    res.status(503).json({ error: "public_url_not_configured" });
    return;
  }
  const stripe = await getUncachableStripeClient();
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!u) { res.status(404).json({ error: "User not found" }); return; }
  let stripeAccountId = u.stripeAccountId;
  if (!stripeAccountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: u.email,
      business_type: "company",
      capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
      metadata: { userId: String(u.id), kind: "shop_owner" },
    });
    stripeAccountId = account.id;
    await db.update(usersTable)
      .set({ stripeAccountId, stripeAccountType: "company" })
      .where(eq(usersTable.id, u.id));
  }
  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${baseUrl}/api/payments/connect/return?status=refresh`,
    return_url: `${baseUrl}/api/payments/connect/return?status=done`,
    type: "account_onboarding",
  });
  res.json({ url: link.url });
});

router.get("/payouts/shop/connect/status", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userRole !== "shop_owner" || req.user?.status !== "active") {
    res.status(403).json({ error: "Active shop owners only" }); return;
  }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!u?.stripeAccountId) {
    res.json({ accountId: null, ready: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
    return;
  }
  const stripe = await getUncachableStripeClient();
  const account = await stripe.accounts.retrieve(u.stripeAccountId);
  const ready = !!(account.charges_enabled && account.payouts_enabled && account.details_submitted);
  if (ready !== u.stripeAccountReady) {
    await db.update(usersTable).set({ stripeAccountReady: ready }).where(eq(usersTable.id, u.id));
  }
  res.json({
    accountId: u.stripeAccountId,
    ready,
    chargesEnabled: !!account.charges_enabled,
    payoutsEnabled: !!account.payouts_enabled,
    detailsSubmitted: !!account.details_submitted,
  });
});

/* -------------------------------------------------------------------------- */
/* Per-job payout destination toggle (shop_owner / admin only)                */
/* -------------------------------------------------------------------------- */

router.patch("/payouts/job/:jobId/destination", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!["shop_owner", "admin"].includes(req.userRole ?? "")) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (req.userRole === "shop_owner" && req.user?.status !== "active") {
    res.status(403).json({ error: "Your shop owner account is not active." }); return;
  }
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const body = req.body as { destination?: string; shopId?: number; shopSplitPct?: number };
  const dest = body.destination;
  if (!dest || !["mechanic", "shop"].includes(dest)) {
    res.status(400).json({ error: "Split payouts are not supported; destination must be mechanic or shop." }); return;
  }
  const requestedShopId = body.shopId == null ? null : Number(body.shopId);
  if (dest === "shop" && (!requestedShopId || !Number.isInteger(requestedShopId))) {
    res.status(400).json({ error: "shopId is required for shop payouts" }); return;
  }
  if (dest === "mechanic" && requestedShopId !== null) {
    res.status(400).json({ error: "shopId is only valid for shop payouts." }); return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Match checkout's lock. This makes the destination snapshot and the
      // Stripe-bound destination one serialized operation per job.
      await tx.execute(sql`SELECT id FROM jobs WHERE id = ${jobId} FOR UPDATE`);
      const [job] = await tx.select({
        customerId: jobsTable.customerId,
        postedByShopId: jobsTable.postedByShopId,
      }).from(jobsTable).where(eq(jobsTable.id, jobId));
      if (!job) abortDestination(404, { error: "Job not found" });

      let ownsPostedShop = false;
      if (req.userRole === "shop_owner" && job.postedByShopId != null) {
        const [postedShop] = await tx.select({ id: shopsTable.id })
          .from(shopsTable)
          .where(and(
            eq(shopsTable.id, job.postedByShopId),
            eq(shopsTable.ownerId, req.userId!),
          ));
        ownsPostedShop = !!postedShop;
      }
      if (!canManagePayoutDestination({
        role: req.userRole,
        status: req.user?.status,
        userId: req.userId,
        customerId: job.customerId,
        ownsPostedShop,
      })) {
        abortDestination(403, { error: "You do not control this job's payout destination." });
      }

      if (dest === "shop") {
        const [shop] = await tx.select().from(shopsTable).where(eq(shopsTable.id, requestedShopId!));
        if (!shop) abortDestination(403, { error: "Not your shop" });
        if (shop.status !== "active") abortDestination(409, { error: "Shop is inactive." });
        if (req.userRole === "shop_owner" && shop.ownerId !== req.userId) {
          abortDestination(403, { error: "Not your shop" });
        }
      }

      const [pmt] = await tx.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
      // Stripe fixes transfer_data.destination when the Checkout session
      // creates its PaymentIntent. A pending setup row has no provider
      // references yet and is intentionally completed by checkout.
      if (pmt && (pmt.status !== "pending" || pmt.providerSessionId || pmt.providerPaymentIntentId)) {
        abortDestination(409, { error: "Cannot change destination after Stripe checkout has started." });
      }

      const values = {
        payoutDestination: dest as "mechanic" | "shop" | "split",
        shopId: requestedShopId,
        shopSplitPct: null,
      };
      if (pmt) {
        const [updated] = await tx.update(paymentsTable)
          .set(values)
          .where(eq(paymentsTable.id, pmt.id))
          .returning();
        return { status: 200, body: updated };
      }

      // Checkout normally creates the payment row, but this zeroed pending
      // setup row preserves the pre-checkout destination feature using the
      // existing non-null payment columns. Checkout fills financial snapshots
      // and provider references under the same job lock.
      const [created] = await tx.insert(paymentsTable).values({
        jobId,
        amount: 0,
        platformFee: 0,
        mechanicPayout: 0,
        status: "pending",
        payoutDestination: values.payoutDestination,
        shopId: values.shopId,
        shopSplitPct: null,
      }).returning();
      return { status: 200, body: created };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof DestinationAbort) {
      res.status(error.status).json(error.body);
      return;
    }
    throw error;
  }
});

/* -------------------------------------------------------------------------- */
/* Self-onboarding shortcut for mechanics already on the existing route — kept
 * here so the mobile app can call a single base URL. Delegates to the same
 * code path as POST /payments/connect/onboarding to avoid divergence.        */
/* -------------------------------------------------------------------------- */

router.get("/payouts/connect/status", authenticate, requireActiveMechanic, async (req: AuthRequest, res: Response): Promise<void> => {
  // Thin alias for /payments/connect/status — keeps mobile API surface
  // consistent under /payouts/*. Inline to avoid a route-level redirect.
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user?.stripeAccountId) {
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

export default router;
