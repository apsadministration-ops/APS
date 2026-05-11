/**
 * Reputation engine.
 *
 * Single source of truth for `user_reputation`. Called whenever a visible
 * review is created / edited / removed, or whenever a job changes terminal
 * state in a way that affects behavioural metrics.
 *
 * Every recompute is a full recompute over visible rows — the data volume is
 * small (a mechanic with 1000 reviews is still <1MB of category JSON) and
 * full recompute eliminates the entire class of "incremental drift" bugs.
 *
 * Trust score formula (0..100, 50 = neutral starting point):
 *   - Base 50
 *   - Up to +30 from overall_avg ((avg-3)/2 * 30, clamped 0..30)
 *   - Up to +10 from completion_rate
 *   - Up to +10 from review_count saturation (log10(count+1)*5, capped 10)
 *   - Up to -25 from cancellation_rate * 25
 *   - Up to -15 from no_show_rate * 15
 * Result clamped to 0..100.
 */

import { and, eq, sql } from "drizzle-orm";
import { db, reviewsTable, userReputationTable, jobsTable } from "@workspace/db";

export async function recomputeUserReputation(userId: number): Promise<void> {
  // Aggregate visible reviews where this user is the SUBJECT.
  const visibleReviews = await db.select({
    overallRating: reviewsTable.overallRating,
    categories: reviewsTable.categories,
  }).from(reviewsTable).where(and(
    eq(reviewsTable.subjectId, userId),
    eq(reviewsTable.visibility, "visible"),
  ));

  const reviewCount = visibleReviews.length;
  let overallSum = 0;
  const catSums: Record<string, { sum: number; n: number }> = {};
  for (const r of visibleReviews) {
    overallSum += r.overallRating;
    for (const [k, v] of Object.entries(r.categories ?? {})) {
      if (typeof v === "number") {
        catSums[k] ??= { sum: 0, n: 0 };
        catSums[k].sum += v;
        catSums[k].n += 1;
      }
    }
  }
  const overallAvg = reviewCount > 0 ? overallSum / reviewCount : 0;
  const categoriesAvg: Record<string, number> = {};
  for (const [k, { sum, n }] of Object.entries(catSums)) {
    categoriesAvg[k] = Math.round((sum / n) * 100) / 100;
  }

  // Behavioural metrics: pull from the jobs table. Cancellation/no-show are
  // treated as "of all jobs this user participated in". Completion is the
  // fraction of accepted jobs that reached PAID.
  // We look at jobs where this user is the customer OR the mechanic.
  const jobStats = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status NOT IN ('REQUESTED','PENDING_APPROVAL'))::int AS taken,
      COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid,
      COUNT(*) FILTER (WHERE status IN ('CANCELLED','REFUSED'))::int AS cancelled,
      COUNT(*) FILTER (WHERE status = 'NO_SHOW')::int AS no_shows
    FROM jobs
    WHERE customer_id = ${userId} OR mechanic_id = ${userId}
  `);
  const stats = (jobStats.rows[0] ?? {}) as { taken?: number; paid?: number; cancelled?: number; no_shows?: number };
  const taken = stats.taken ?? 0;
  const denom = Math.max(1, taken);
  const completionRate = (stats.paid ?? 0) / denom;
  const cancellationRate = (stats.cancelled ?? 0) / denom;
  const noShowRate = (stats.no_shows ?? 0) / denom;

  // Repeat customer rate is meaningful for mechanics: % of distinct customers
  // who have come back for >=2 jobs. Cheap because the mechanic-job set is
  // typically small. For customers we leave it at 0.
  let repeatCustomerRate = 0;
  const repeatRow = await db.execute(sql`
    SELECT
      COUNT(DISTINCT customer_id)::int AS distinct_customers,
      COUNT(DISTINCT customer_id) FILTER (WHERE c >= 2)::int AS repeat_customers
    FROM (
      SELECT customer_id, COUNT(*) AS c
      FROM jobs
      WHERE mechanic_id = ${userId} AND status = 'PAID'
      GROUP BY customer_id
    ) s
  `);
  const rr = (repeatRow.rows[0] ?? {}) as { distinct_customers?: number; repeat_customers?: number };
  if ((rr.distinct_customers ?? 0) > 0) {
    repeatCustomerRate = (rr.repeat_customers ?? 0) / (rr.distinct_customers ?? 1);
  }

  // Trust score.
  const fromAvg = reviewCount > 0 ? clamp((overallAvg - 3) / 2 * 30, 0, 30) : 0;
  const fromCompletion = clamp(completionRate * 10, 0, 10);
  const fromVolume = clamp(Math.log10(reviewCount + 1) * 5, 0, 10);
  const penaltyCancel = cancellationRate * 25;
  const penaltyNoShow = noShowRate * 15;
  const trustScore = Math.round(clamp(50 + fromAvg + fromCompletion + fromVolume - penaltyCancel - penaltyNoShow, 0, 100));

  await db.insert(userReputationTable).values({
    userId,
    reviewCount,
    overallAvg: overallAvg.toFixed(2),
    categoriesAvg,
    completionRate: completionRate.toFixed(3),
    cancellationRate: cancellationRate.toFixed(3),
    noShowRate: noShowRate.toFixed(3),
    repeatCustomerRate: repeatCustomerRate.toFixed(3),
    responseRate: "0",  // populated when notification/response tracking lands
    trustScore,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: userReputationTable.userId,
    set: {
      reviewCount,
      overallAvg: overallAvg.toFixed(2),
      categoriesAvg,
      completionRate: completionRate.toFixed(3),
      cancellationRate: cancellationRate.toFixed(3),
      noShowRate: noShowRate.toFixed(3),
      repeatCustomerRate: repeatCustomerRate.toFixed(3),
      trustScore,
      updatedAt: new Date(),
    },
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
