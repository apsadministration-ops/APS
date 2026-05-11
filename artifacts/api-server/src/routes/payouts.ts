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
import { getUncachableStripeClient } from "../lib/stripeClient";

const router: IRouter = Router();

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
    res.status(502).json({ error: "Stripe error", details: (err as Error).message });
  }
});

router.post("/payouts/:jobId/retry", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  if (req.userRole !== "admin" && req.userId !== job.mechanicId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const out = await manualRetryCapture(jobId);
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
  if (req.userRole !== "shop_owner") { res.status(403).json({ error: "Shop owners only" }); return; }
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
  const baseUrl = `https://${(process.env["REPLIT_DOMAINS"] ?? "").split(",")[0] ?? ""}`;
  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${baseUrl}/api/payments/connect/return?status=refresh`,
    return_url: `${baseUrl}/api/payments/connect/return?status=done`,
    type: "account_onboarding",
  });
  res.json({ url: link.url });
});

router.get("/payouts/shop/connect/status", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userRole !== "shop_owner") { res.status(403).json({ error: "Shop owners only" }); return; }
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
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const body = req.body as { destination?: string; shopId?: number; shopSplitPct?: number };
  const dest = body.destination;
  if (!dest || !["mechanic", "shop", "split"].includes(dest)) {
    res.status(400).json({ error: "destination must be mechanic|shop|split" }); return;
  }
  const [pmt] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  if (!pmt) { res.status(404).json({ error: "Payment not found" }); return; }
  if (!["pending", "authorized", "capture_pending"].includes(pmt.status)) {
    res.status(409).json({ error: "Cannot change destination after capture." }); return;
  }
  // Shop owner can only redirect to a shop they own.
  if (req.userRole === "shop_owner") {
    if (!body.shopId) { res.status(400).json({ error: "shopId is required for shop owners" }); return; }
    const [shop] = await db.select().from(shopsTable).where(and(eq(shopsTable.id, body.shopId), eq(shopsTable.ownerId, req.userId!)));
    if (!shop) { res.status(403).json({ error: "Not your shop" }); return; }
  }
  const splitPct = dest === "split" ? Math.max(0, Math.min(100, body.shopSplitPct ?? 0)) : null;
  const [updated] = await db.update(paymentsTable).set({
    payoutDestination: dest as "mechanic" | "shop" | "split",
    shopId: body.shopId ?? null,
    shopSplitPct: splitPct,
  }).where(eq(paymentsTable.id, pmt.id)).returning();
  res.json(updated);
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
