import { Router, type IRouter } from "express";
import { and, eq, gte, sql, desc } from "drizzle-orm";
import { db, paymentsTable, jobsTable, workLogsTable, partsItemsTable, usersTable } from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

/**
 * APS admin financial dashboard. ALL endpoints under this router are admin-
 * only. Customers and mechanics can never reach them.
 *
 * Endpoints:
 *   GET /admin/finance/global             — platform-wide rollup
 *   GET /admin/finance/jobs               — per-job finance grid (paginated)
 *   GET /admin/finance/jobs/:jobId        — full per-job breakdown
 *   GET /admin/finance/mechanics          — per-mechanic earnings + flags
 *   GET /admin/finance/flagged            — fraud queue (worklogs)
 */

router.use(authenticate, requireRole("admin"));

router.get("/admin/finance/global", async (req: AuthRequest, res): Promise<void> => {
  const windowDays = Math.min(365, Math.max(1, parseInt(String(req.query["days"] ?? "30"), 10) || 30));
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [agg] = await db
    .select({
      jobs: sql<number>`count(*)::int`,
      grossCents: sql<number>`coalesce(sum(${paymentsTable.amountCents}), 0)::int`,
      taxCents: sql<number>`coalesce(sum(${paymentsTable.taxCents}), 0)::int`,
      partsCents: sql<number>`coalesce(sum(${paymentsTable.partsCostAppliedCents}), 0)::int`,
      laborCents: sql<number>`coalesce(sum(${paymentsTable.laborRevenueCents}), 0)::int`,
      apsCommissionCents: sql<number>`coalesce(sum(${paymentsTable.platformFeeCents}), 0)::int`,
      mechanicPayoutCents: sql<number>`coalesce(sum(${paymentsTable.mechanicPayoutCents}), 0)::int`,
      stripeFeeCents: sql<number>`coalesce(sum(${paymentsTable.stripeFeeCents}), 0)::int`,
    })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.status, "captured"),
      gte(paymentsTable.createdAt, since),
    ));

  res.json({
    windowDays,
    since,
    ...agg,
    avgProfitPerJobCents: agg && agg.jobs > 0 ? Math.round((agg.laborCents - agg.partsCents) / agg.jobs) : 0,
    avgApsMarginPct: agg && agg.laborCents > 0 ? +(agg.apsCommissionCents / agg.laborCents).toFixed(4) : 0,
  });
});

router.get("/admin/finance/jobs", async (req: AuthRequest, res): Promise<void> => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));
  const rows = await db
    .select({
      jobId: paymentsTable.jobId,
      status: paymentsTable.status,
      amountCents: paymentsTable.amountCents,
      taxCents: paymentsTable.taxCents,
      partsCostAppliedCents: paymentsTable.partsCostAppliedCents,
      laborRevenueCents: paymentsTable.laborRevenueCents,
      platformFeeCents: paymentsTable.platformFeeCents,
      mechanicPayoutCents: paymentsTable.mechanicPayoutCents,
      stripeFeeCents: paymentsTable.stripeFeeCents,
      createdAt: paymentsTable.createdAt,
      mechanicId: jobsTable.mechanicId,
      jobType: jobsTable.jobType,
    })
    .from(paymentsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, paymentsTable.jobId))
    .orderBy(desc(paymentsTable.createdAt))
    .limit(limit);
  res.json(rows);
});

router.get("/admin/finance/jobs/:jobId", async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  const [pmt] = await db.select().from(paymentsTable).where(eq(paymentsTable.jobId, jobId));
  const [wl] = await db.select().from(workLogsTable).where(eq(workLogsTable.jobId, jobId));
  const items = wl ? await db.select().from(partsItemsTable).where(eq(partsItemsTable.workLogId, wl.id)) : [];
  const [mech] = job?.mechanicId ? await db.select().from(usersTable).where(eq(usersTable.id, job.mechanicId)) : [null];
  res.json({
    job,
    payment: pmt,
    workLog: wl,
    partsItems: items,
    mechanic: mech ? { id: mech.id, name: mech.name, tier: mech.mechanicTier } : null,
  });
});

router.get("/admin/finance/mechanics", async (_req: AuthRequest, res): Promise<void> => {
  const rows = await db
    .select({
      mechanicId: jobsTable.mechanicId,
      jobs: sql<number>`count(*)::int`,
      grossCents: sql<number>`coalesce(sum(${paymentsTable.amountCents}), 0)::int`,
      payoutCents: sql<number>`coalesce(sum(${paymentsTable.mechanicPayoutCents}), 0)::int`,
      partsReimbursementCents: sql<number>`coalesce(sum(${paymentsTable.partsCostAppliedCents}), 0)::int`,
      flaggedJobs: sql<number>`count(*) filter (where ${workLogsTable.flaggedForReview} = true)::int`,
    })
    .from(paymentsTable)
    .innerJoin(jobsTable, eq(jobsTable.id, paymentsTable.jobId))
    .leftJoin(workLogsTable, eq(workLogsTable.jobId, jobsTable.id))
    .where(eq(paymentsTable.status, "captured"))
    .groupBy(jobsTable.mechanicId);

  // Hydrate names (small N — admin dashboard).
  const ids = rows.map((r) => r.mechanicId).filter((x): x is number => typeof x === "number");
  const mechs = ids.length > 0
    ? await db.select({ id: usersTable.id, name: usersTable.name, tier: usersTable.mechanicTier }).from(usersTable).where(sql`${usersTable.id} in ${ids}`)
    : [];
  const byId = new Map(mechs.map((m) => [m.id, m]));
  res.json(rows.map((r) => ({ ...r, mechanic: r.mechanicId != null ? byId.get(r.mechanicId) ?? null : null })));
});

router.get("/admin/finance/flagged", async (_req: AuthRequest, res): Promise<void> => {
  const rows = await db
    .select({
      worklogId: workLogsTable.id,
      jobId: workLogsTable.jobId,
      mechanicId: workLogsTable.mechanicId,
      partsCost: workLogsTable.partsCost,
      laborCost: workLogsTable.laborCost,
      flagReason: workLogsTable.flagReason,
      createdAt: workLogsTable.createdAt,
    })
    .from(workLogsTable)
    .where(eq(workLogsTable.flaggedForReview, true))
    .orderBy(desc(workLogsTable.createdAt))
    .limit(200);
  res.json(rows);
});

export default router;
