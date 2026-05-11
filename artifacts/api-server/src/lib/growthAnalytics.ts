/**
 * Growth Analytics — live aggregations for the Growth Intelligence Center.
 *
 * Computes everything from live tables (users, jobs, payments, referrals,
 * social_posts) so the dashboard always reflects ground truth. No background
 * caching layer at this stage; queries are scoped + indexed.
 */

import { and, eq, gte, sql, desc, isNotNull } from "drizzle-orm";
import {
  db,
  usersTable,
  jobsTable,
  paymentsTable,
  referralsTable,
  socialPostsTable,
} from "@workspace/db";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

/* -------------------------------------------------------------------------- */
/* Acquisition Overview                                                       */
/* -------------------------------------------------------------------------- */

export interface AcquisitionOverview {
  totals: {
    customers: number;
    mechanics: number;
    pendingMechanics: number;
    activeMechanics: number;
  };
  signups: {
    last7Customers: number;
    last7Mechanics: number;
    last30Customers: number;
    last30Mechanics: number;
    referralLast30: number;
    organicLast30: number;
  };
  growth: {
    monthlyCustomerGrowthPct: number | null;
    monthlyMechanicGrowthPct: number | null;
  };
  conversion: {
    referralConversionPct: number | null;
    avgSignupToFirstJobMinutes: number | null;
    customerRetention30Pct: number | null;
    mechanicRetention30Pct: number | null;
  };
  daily: { date: string; customers: number; mechanics: number }[];
}

export async function getAcquisitionOverview(): Promise<AcquisitionOverview> {
  // Totals
  const [counts] = await db.select({
    customers: sql<number>`COUNT(*) FILTER (WHERE role = 'customer')::int`,
    mechanics: sql<number>`COUNT(*) FILTER (WHERE role = 'mechanic')::int`,
    pendingMechanics: sql<number>`COUNT(*) FILTER (WHERE role = 'mechanic' AND status = 'pending')::int`,
    activeMechanics: sql<number>`COUNT(*) FILTER (WHERE role = 'mechanic' AND status = 'active')::int`,
  }).from(usersTable);

  // Signups windows
  const [w7] = await db.select({
    cust: sql<number>`COUNT(*) FILTER (WHERE role = 'customer')::int`,
    mech: sql<number>`COUNT(*) FILTER (WHERE role = 'mechanic')::int`,
  }).from(usersTable).where(gte(usersTable.createdAt, daysAgo(7)));
  const [w30] = await db.select({
    cust: sql<number>`COUNT(*) FILTER (WHERE role = 'customer')::int`,
    mech: sql<number>`COUNT(*) FILTER (WHERE role = 'mechanic')::int`,
  }).from(usersTable).where(gte(usersTable.createdAt, daysAgo(30)));
  const [prev30] = await db.select({
    cust: sql<number>`COUNT(*) FILTER (WHERE role = 'customer')::int`,
    mech: sql<number>`COUNT(*) FILTER (WHERE role = 'mechanic')::int`,
  }).from(usersTable).where(and(gte(usersTable.createdAt, daysAgo(60)), sql`created_at < ${daysAgo(30)}`));

  // Referral origin in last 30
  const [refSignups30] = await db.select({
    n: sql<number>`COUNT(*)::int`,
  }).from(referralsTable).where(gte(referralsTable.signupTimestamp, daysAgo(30)));

  const last30Total = (w30?.cust ?? 0) + (w30?.mech ?? 0);
  const referralLast30 = refSignups30?.n ?? 0;
  const organicLast30 = Math.max(0, last30Total - referralLast30);

  // Referral conversion %
  const [refStats] = await db.select({
    total: sql<number>`COUNT(*)::int`,
    converted: sql<number>`COUNT(*) FILTER (WHERE converted = true)::int`,
  }).from(referralsTable);

  // Avg signup -> first PAID job (minutes)
  const [funnel] = await db.select({
    avgMin: sql<number | null>`AVG(EXTRACT(EPOCH FROM (j.created_at - u.created_at))/60)`,
  }).from(sql`users u`)
    .innerJoin(sql`jobs j`, sql`j.customer_id = u.id`)
    .where(sql`u.role = 'customer' AND j.status = 'PAID'`);

  // 30-day retention: % of users created 30+ days ago who have an action
  // since (job for customers; status update / job acceptance for mechanics).
  const [custRet] = await db.select({
    total: sql<number>`COUNT(*)::int`,
    retained: sql<number>`COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM jobs j WHERE j.customer_id = users.id AND j.created_at > users.created_at + INTERVAL '14 days'
    ))::int`,
  }).from(usersTable).where(and(eq(usersTable.role, "customer"), sql`${usersTable.createdAt} <= ${daysAgo(30)}`));

  const [mechRet] = await db.select({
    total: sql<number>`COUNT(*)::int`,
    retained: sql<number>`COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM jobs j WHERE j.mechanic_id = users.id AND j.created_at > users.created_at + INTERVAL '14 days'
    ))::int`,
  }).from(usersTable).where(and(eq(usersTable.role, "mechanic"), sql`${usersTable.createdAt} <= ${daysAgo(30)}`));

  // Daily signups last 14 days for sparkline
  const dailyRows = await db.execute<{ date: string; customers: number; mechanics: number }>(sql`
    SELECT TO_CHAR(d::date, 'YYYY-MM-DD') AS date,
           (SELECT COUNT(*) FROM users WHERE role='customer' AND created_at::date = d::date)::int AS customers,
           (SELECT COUNT(*) FROM users WHERE role='mechanic' AND created_at::date = d::date)::int AS mechanics
    FROM generate_series((CURRENT_DATE - INTERVAL '13 days')::date, CURRENT_DATE::date, '1 day') d
    ORDER BY d
  `);

  const monthlyCustomerGrowth = (prev30?.cust ?? 0) === 0 ? null : ((w30?.cust ?? 0) - (prev30?.cust ?? 0)) / (prev30?.cust ?? 1) * 100;
  const monthlyMechanicGrowth = (prev30?.mech ?? 0) === 0 ? null : ((w30?.mech ?? 0) - (prev30?.mech ?? 0)) / (prev30?.mech ?? 1) * 100;

  return {
    totals: {
      customers: counts?.customers ?? 0,
      mechanics: counts?.mechanics ?? 0,
      pendingMechanics: counts?.pendingMechanics ?? 0,
      activeMechanics: counts?.activeMechanics ?? 0,
    },
    signups: {
      last7Customers: w7?.cust ?? 0,
      last7Mechanics: w7?.mech ?? 0,
      last30Customers: w30?.cust ?? 0,
      last30Mechanics: w30?.mech ?? 0,
      referralLast30,
      organicLast30,
    },
    growth: {
      monthlyCustomerGrowthPct: monthlyCustomerGrowth,
      monthlyMechanicGrowthPct: monthlyMechanicGrowth,
    },
    conversion: {
      referralConversionPct: (refStats?.total ?? 0) === 0 ? null : ((refStats?.converted ?? 0) / (refStats?.total ?? 1)) * 100,
      avgSignupToFirstJobMinutes: funnel?.avgMin != null ? Number(funnel.avgMin) : null,
      customerRetention30Pct: (custRet?.total ?? 0) === 0 ? null : ((custRet?.retained ?? 0) / (custRet?.total ?? 1)) * 100,
      mechanicRetention30Pct: (mechRet?.total ?? 0) === 0 ? null : ((mechRet?.retained ?? 0) / (mechRet?.total ?? 1)) * 100,
    },
    daily: dailyRows.rows.map((r) => ({
      date: r.date,
      customers: Number(r.customers),
      mechanics: Number(r.mechanics),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Referral Intelligence                                                      */
/* -------------------------------------------------------------------------- */

export interface ReferrerLeader {
  userId: number;
  name: string;
  email: string;
  role: "customer" | "mechanic" | "admin" | "shop_owner";
  region: string | null;
  city: string | null;
  referralCode: string | null;
  totalReferred: number;
  converted: number;
  pointsAwarded: number;
  conversionPct: number;
}

export interface ReferralIntelligence {
  totalReferrals: number;
  convertedReferrals: number;
  conversionPct: number | null;
  byRole: { customers: number; mechanics: number };
  byRegion: { region: string; count: number; converted: number }[];
  topMechanicReferrers: ReferrerLeader[];
  topCustomerReferrers: ReferrerLeader[];
  totalPointsAwarded: number;
}

export async function getReferralIntelligence(): Promise<ReferralIntelligence> {
  const [tot] = await db.select({
    n: sql<number>`COUNT(*)::int`,
    converted: sql<number>`COUNT(*) FILTER (WHERE converted = true)::int`,
    points: sql<number>`COALESCE(SUM(points_awarded), 0)::int`,
  }).from(referralsTable);

  const byRoleRows = await db.execute<{ role: string; n: number }>(sql`
    SELECT u.role::text AS role, COUNT(*)::int AS n
    FROM referrals r JOIN users u ON u.id = r.referrer_id
    GROUP BY u.role
  `);
  const byRole = { customers: 0, mechanics: 0 };
  for (const row of byRoleRows.rows) {
    if (row.role === "customer") byRole.customers = Number(row.n);
    if (row.role === "mechanic") byRole.mechanics = Number(row.n);
  }

  const byRegionRows = await db.execute<{ region: string; count: number; converted: number }>(sql`
    SELECT COALESCE(u.region, u.city, 'Unknown') AS region,
           COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE r.converted = true)::int AS converted
    FROM referrals r JOIN users u ON u.id = r.referrer_id
    GROUP BY 1 ORDER BY count DESC LIMIT 12
  `);

  const buildLeaders = (role: "customer" | "mechanic") => db.execute<{
    user_id: number; name: string; email: string; role: string;
    region: string | null; city: string | null; referral_code: string | null;
    total_referred: number; converted: number; points_awarded: number;
  }>(sql`
    SELECT u.id AS user_id, u.name, u.email, u.role::text AS role,
           u.region, u.city, u.referral_code,
           COUNT(r.id)::int AS total_referred,
           COUNT(r.id) FILTER (WHERE r.converted = true)::int AS converted,
           COALESCE(SUM(r.points_awarded), 0)::int AS points_awarded
    FROM users u JOIN referrals r ON r.referrer_id = u.id
    WHERE u.role = ${role}
    GROUP BY u.id
    ORDER BY total_referred DESC, converted DESC
    LIMIT 10
  `);

  const [topMech, topCust] = await Promise.all([buildLeaders("mechanic"), buildLeaders("customer")]);

  const mapLeaders = (rows: { rows: Awaited<ReturnType<typeof buildLeaders>>["rows"] }): ReferrerLeader[] =>
    rows.rows.map((r) => {
      const total = Number(r.total_referred);
      const conv = Number(r.converted);
      return {
        userId: Number(r.user_id),
        name: r.name,
        email: r.email,
        role: r.role as ReferrerLeader["role"],
        region: r.region,
        city: r.city,
        referralCode: r.referral_code,
        totalReferred: total,
        converted: conv,
        pointsAwarded: Number(r.points_awarded),
        conversionPct: total === 0 ? 0 : (conv / total) * 100,
      };
    });

  return {
    totalReferrals: tot?.n ?? 0,
    convertedReferrals: tot?.converted ?? 0,
    conversionPct: (tot?.n ?? 0) === 0 ? null : ((tot?.converted ?? 0) / (tot?.n ?? 1)) * 100,
    byRole,
    byRegion: byRegionRows.rows.map((r) => ({
      region: r.region, count: Number(r.count), converted: Number(r.converted),
    })),
    topMechanicReferrers: mapLeaders(topMech),
    topCustomerReferrers: mapLeaders(topCust),
    totalPointsAwarded: tot?.points ?? 0,
  };
}

/* -------------------------------------------------------------------------- */
/* Regional Density Intelligence + Marketplace Balance                        */
/* -------------------------------------------------------------------------- */

export interface RegionalDensity {
  region: string;
  customerCount: number;
  mechanicCount: number;
  jobsLast30: number;
  completedLast30: number;
  completionPct: number | null;
  averageWaitMinutes: number | null;
  demandScore: number;
  supplyScore: number;
  ratio: number | null;
}

export async function getRegionalDensity(): Promise<RegionalDensity[]> {
  const rows = await db.execute<{
    region: string;
    customer_count: number;
    mechanic_count: number;
    jobs_last_30: number;
    completed_last_30: number;
    avg_wait_min: number | null;
  }>(sql`
    WITH base AS (
      SELECT COALESCE(u.region, u.city, 'Unknown') AS region,
             u.id AS user_id, u.role
      FROM users u
    ),
    region_users AS (
      SELECT region,
             COUNT(*) FILTER (WHERE role = 'customer')::int AS customer_count,
             COUNT(*) FILTER (WHERE role = 'mechanic')::int AS mechanic_count
      FROM base GROUP BY region
    ),
    region_jobs AS (
      SELECT COALESCE(c.region, c.city, 'Unknown') AS region,
             COUNT(*)::int AS jobs_last_30,
             COUNT(*) FILTER (WHERE j.status IN ('PAID','COMPLETED'))::int AS completed_last_30,
             AVG(EXTRACT(EPOCH FROM (
               COALESCE(j.accepted_at, j.created_at) - j.created_at
             ))/60) AS avg_wait_min
      FROM jobs j JOIN users c ON c.id = j.customer_id
      WHERE j.created_at >= ${daysAgo(30)}
      GROUP BY 1
    )
    SELECT ru.region, ru.customer_count, ru.mechanic_count,
           COALESCE(rj.jobs_last_30, 0) AS jobs_last_30,
           COALESCE(rj.completed_last_30, 0) AS completed_last_30,
           rj.avg_wait_min
    FROM region_users ru LEFT JOIN region_jobs rj USING (region)
    ORDER BY ru.customer_count + ru.mechanic_count DESC
    LIMIT 50
  `);

  return rows.rows.map((r) => {
    const customerCount = Number(r.customer_count);
    const mechanicCount = Number(r.mechanic_count);
    const jobs = Number(r.jobs_last_30);
    const completed = Number(r.completed_last_30);
    const wait = r.avg_wait_min != null ? Number(r.avg_wait_min) : null;
    return {
      region: r.region,
      customerCount,
      mechanicCount,
      jobsLast30: jobs,
      completedLast30: completed,
      completionPct: jobs === 0 ? null : (completed / jobs) * 100,
      averageWaitMinutes: wait,
      demandScore: customerCount + jobs * 2,
      supplyScore: mechanicCount * 5,
      ratio: mechanicCount === 0 ? null : customerCount / mechanicCount,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* CPA + Engagement                                                           */
/* -------------------------------------------------------------------------- */

export interface CpaSnapshot {
  organicSignupsLast30: number;
  referralSignupsLast30: number;
  publishedPostsLast30: number;
  estimatedOrganicCpaUsd: number;
  estimatedReferralCpaPoints: number;
  customerLifetimeValueUsd: number | null;
  mechanicLifetimeValueUsd: number | null;
  signupToBookingPct: number | null;
  bookingToRepeatPct: number | null;
}

const ASSUMED_ORGANIC_HOURLY_USD = 75; // editorial labor for organic content
const ASSUMED_MIN_PER_POST = 12; // labor/post

export async function getCpaSnapshot(): Promise<CpaSnapshot> {
  const [pub] = await db.select({
    n: sql<number>`COUNT(*)::int`,
  }).from(socialPostsTable).where(and(eq(socialPostsTable.status, "published"), gte(socialPostsTable.publishedAt, daysAgo(30))));

  const [refs] = await db.select({
    n: sql<number>`COUNT(*)::int`,
    points: sql<number>`COALESCE(SUM(points_awarded), 0)::int`,
  }).from(referralsTable).where(gte(referralsTable.signupTimestamp, daysAgo(30)));

  const [signups30] = await db.select({
    n: sql<number>`COUNT(*)::int`,
  }).from(usersTable).where(gte(usersTable.createdAt, daysAgo(30)));

  const organic = Math.max(0, (signups30?.n ?? 0) - (refs?.n ?? 0));
  const labourCost = ((pub?.n ?? 0) * ASSUMED_MIN_PER_POST / 60) * ASSUMED_ORGANIC_HOURLY_USD;
  const cpa = organic === 0 ? 0 : labourCost / organic;

  // LTV proxy: avg captured payment * average jobs/customer (or mechanic)
  const [custLtv] = await db.execute<{ avg_total: number | null }>(sql`
    SELECT AVG(per_customer.total) AS avg_total FROM (
      SELECT j.customer_id, SUM(p.amount_cents)/100.0 AS total
      FROM jobs j JOIN payments p ON p.job_id = j.id
      WHERE p.status IN ('captured','released')
      GROUP BY j.customer_id
    ) per_customer
  `).then((r) => r.rows);

  const [mechLtv] = await db.execute<{ avg_total: number | null }>(sql`
    SELECT AVG(per_mechanic.total) AS avg_total FROM (
      SELECT j.mechanic_id, SUM(p.amount_cents)/100.0 * 0.9 AS total
      FROM jobs j JOIN payments p ON p.job_id = j.id
      WHERE p.status IN ('captured','released') AND j.mechanic_id IS NOT NULL
      GROUP BY j.mechanic_id
    ) per_mechanic
  `).then((r) => r.rows);

  // Signup → first booking %
  const [sb] = await db.execute<{ total: number; booked: number }>(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.customer_id = u.id))::int AS booked
    FROM users u WHERE u.role = 'customer'
  `).then((r) => r.rows);

  // Booking → repeat customer %
  const [br] = await db.execute<{ total: number; repeat: number }>(sql`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE jobs_count > 1)::int AS "repeat"
    FROM (
      SELECT customer_id, COUNT(*)::int AS jobs_count
      FROM jobs GROUP BY customer_id
    ) sub
  `).then((r) => r.rows);

  return {
    organicSignupsLast30: organic,
    referralSignupsLast30: refs?.n ?? 0,
    publishedPostsLast30: pub?.n ?? 0,
    estimatedOrganicCpaUsd: Number(cpa.toFixed(2)),
    estimatedReferralCpaPoints: refs?.points ?? 0,
    customerLifetimeValueUsd: custLtv?.avg_total != null ? Number(Number(custLtv.avg_total).toFixed(2)) : null,
    mechanicLifetimeValueUsd: mechLtv?.avg_total != null ? Number(Number(mechLtv.avg_total).toFixed(2)) : null,
    signupToBookingPct: (sb?.total ?? 0) === 0 ? null : ((sb?.booked ?? 0) / (sb?.total ?? 1)) * 100,
    bookingToRepeatPct: (br?.total ?? 0) === 0 ? null : ((br?.repeat ?? 0) / (br?.total ?? 1)) * 100,
  };
}

export interface EngagementSnapshot {
  totalPostsPublished: number;
  totalEngagement: { likes: number; shares: number; comments: number; saves: number; clicks: number };
  bestByPlatform: { platform: string; postId: number; topicTitle: string; engagementScore: number }[];
  bestHashtags: { hashtag: string; uses: number; avgEngagement: number }[];
  bestPostingHour: { platform: string; hour: number; avgEngagement: number }[];
}

export async function getEngagementSnapshot(): Promise<EngagementSnapshot> {
  const published = await db.select().from(socialPostsTable)
    .where(and(eq(socialPostsTable.status, "published"), isNotNull(socialPostsTable.publishedAt)));

  const totalEngagement = { likes: 0, shares: 0, comments: 0, saves: 0, clicks: 0 };
  const platformBuckets: Record<string, { postId: number; topicTitle: string; score: number }[]> = {};
  const hashtagBuckets: Record<string, { uses: number; total: number }> = {};
  const hourBuckets: Record<string, Record<number, { count: number; total: number }>> = {};

  const score = (e: typeof published[number]["engagement"]): number =>
    (e.likes ?? 0) + (e.shares ?? 0) * 4 + (e.comments ?? 0) * 3 + (e.saves ?? 0) * 5 + (e.clicks ?? 0) * 6;

  for (const p of published) {
    totalEngagement.likes += p.engagement.likes ?? 0;
    totalEngagement.shares += p.engagement.shares ?? 0;
    totalEngagement.comments += p.engagement.comments ?? 0;
    totalEngagement.saves += p.engagement.saves ?? 0;
    totalEngagement.clicks += p.engagement.clicks ?? 0;
    const s = score(p.engagement);
    (platformBuckets[p.platform] ??= []).push({ postId: p.id, topicTitle: p.topicTitle, score: s });
    for (const h of p.hashtags) {
      const k = h.toLowerCase();
      const b = hashtagBuckets[k] ??= { uses: 0, total: 0 };
      b.uses += 1; b.total += s;
    }
    if (p.publishedAt) {
      const hour = new Date(p.publishedAt).getUTCHours();
      const ph = hourBuckets[p.platform] ??= {};
      const hb = ph[hour] ??= { count: 0, total: 0 };
      hb.count += 1; hb.total += s;
    }
  }

  const bestByPlatform = Object.entries(platformBuckets).map(([platform, arr]) => {
    const top = arr.sort((a, b) => b.score - a.score)[0];
    return top ? { platform, postId: top.postId, topicTitle: top.topicTitle, engagementScore: top.score } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  const bestHashtags = Object.entries(hashtagBuckets)
    .map(([hashtag, v]) => ({ hashtag, uses: v.uses, avgEngagement: v.uses === 0 ? 0 : v.total / v.uses }))
    .filter((x) => x.uses >= 1)
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
    .slice(0, 12);

  const bestPostingHour = Object.entries(hourBuckets).flatMap(([platform, hours]) =>
    Object.entries(hours).map(([h, v]) => ({
      platform, hour: Number(h), avgEngagement: v.count === 0 ? 0 : v.total / v.count,
    }))
  ).sort((a, b) => b.avgEngagement - a.avgEngagement).slice(0, 12);

  return {
    totalPostsPublished: published.length,
    totalEngagement,
    bestByPlatform,
    bestHashtags,
    bestPostingHour,
  };
}

/* -------------------------------------------------------------------------- */
/* Mechanic Amplification — utilization + reach proxy                         */
/* -------------------------------------------------------------------------- */

export interface MechanicAmplification {
  mechanicId: number;
  name: string;
  region: string | null;
  tier: string;
  paidJobsLast30: number;
  utilizationScore: number;
  referralsCreated: number;
  referralsConverted: number;
  amplificationScore: number;
}

export async function getMechanicAmplification(): Promise<MechanicAmplification[]> {
  const rows = await db.execute<{
    mechanic_id: number; name: string; region: string | null; tier: string;
    paid_jobs_30: number; referrals: number; converted: number;
  }>(sql`
    SELECT u.id AS mechanic_id, u.name, COALESCE(u.region, u.city) AS region,
           COALESCE(u.mechanic_tier, 'detailer') AS tier,
           (SELECT COUNT(*) FROM jobs j WHERE j.mechanic_id = u.id AND j.status='PAID' AND j.created_at >= ${daysAgo(30)})::int AS paid_jobs_30,
           (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id)::int AS referrals,
           (SELECT COUNT(*) FROM referrals r WHERE r.referrer_id = u.id AND r.converted = true)::int AS converted
    FROM users u WHERE u.role = 'mechanic' AND u.status = 'active'
    ORDER BY paid_jobs_30 DESC
    LIMIT 25
  `);

  return rows.rows.map((r) => {
    const utilization = Number(r.paid_jobs_30);
    const refs = Number(r.referrals);
    const conv = Number(r.converted);
    return {
      mechanicId: Number(r.mechanic_id),
      name: r.name,
      region: r.region,
      tier: r.tier,
      paidJobsLast30: utilization,
      utilizationScore: utilization,
      referralsCreated: refs,
      referralsConverted: conv,
      amplificationScore: utilization * 2 + conv * 5 + refs,
    };
  }).sort((a, b) => b.amplificationScore - a.amplificationScore);
}

/* -------------------------------------------------------------------------- */
/* Scheduling intelligence                                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_BEST_HOURS: Record<string, number[]> = {
  facebook: [9, 13, 19],
  instagram: [11, 17, 20],
  tiktok: [12, 18, 21],
  twitter: [8, 12, 17],
};

export function recommendSchedule(opts: {
  platform: string;
  alreadyScheduled: Date[];
  now?: Date;
}): { suggestedAt: string; rationale: string } {
  const now = opts.now ?? new Date();
  const hours = DEFAULT_BEST_HOURS[opts.platform] ?? [10, 14, 18];
  // Stagger: find next 4-hour gap after the latest scheduled post for this platform.
  const sorted = opts.alreadyScheduled.map((d) => d.getTime()).sort((a, b) => a - b);
  let candidate = new Date(now);
  candidate.setMinutes(0, 0, 0);
  for (let i = 0; i < 14; i += 1) {
    for (const h of hours) {
      const c = new Date(candidate);
      c.setHours(h, 0, 0, 0);
      if (c.getTime() <= now.getTime()) continue;
      const tooClose = sorted.some((t) => Math.abs(t - c.getTime()) < 4 * 60 * 60 * 1000);
      if (!tooClose) {
        return {
          suggestedAt: c.toISOString(),
          rationale: `Best ${opts.platform} engagement hour with ≥4h gap from other scheduled ${opts.platform} posts.`,
        };
      }
    }
    candidate.setDate(candidate.getDate() + 1);
  }
  // Fallback: now + 1h.
  const fallback = new Date(now.getTime() + 60 * 60 * 1000);
  return { suggestedAt: fallback.toISOString(), rationale: "Calendar congested — suggesting next hour as fallback." };
}

/* -------------------------------------------------------------------------- */
/* Recent signups feed (used in overview drill-down)                          */
/* -------------------------------------------------------------------------- */

export async function getRecentSignups(limit = 20) {
  return db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    region: usersTable.region,
    city: usersTable.city,
    createdAt: usersTable.createdAt,
  }).from(usersTable).orderBy(desc(usersTable.createdAt)).limit(limit);
}
