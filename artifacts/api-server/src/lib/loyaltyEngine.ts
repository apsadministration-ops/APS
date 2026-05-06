/**
 * APS Dual Loyalty System — unified Points Engine.
 *
 * Two ledgers (customer + mechanic) fed by the SAME engine. All grants are:
 *  - tied to verified actions (captured payments, completed jobs, verified
 *    reviews/referrals/upsells)
 *  - idempotent per (user, job, source_type) so retries / duplicate webhooks
 *    can never double-award
 *  - reversible on refund (negative-points "reversal" rows)
 *
 * Balances on `users.loyalty_points` (customers) and `users.mechanic_points`
 * (mechanics) are recomputed from the SUM of the relevant ledger after every
 * mutation, so they can't drift from the underlying truth.
 */
import { eq, and, sum, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  customerPointsLedgerTable,
  customerRedemptionsTable,
  mechanicPointsLedgerTable,
  mechanicRewardsTable,
} from "@workspace/db";
import { logger } from "./logger";

export type CustomerSource = "service" | "referral" | "review" | "survey" | "welcome" | "reversal";
export type MechanicSource = "job" | "rating" | "tenure" | "upsell" | "reversal";

/* -------------------------------------------------------------------------- */
/* CATALOGS — static reward menus exposed to clients                          */
/* -------------------------------------------------------------------------- */

export interface RewardItem {
  key: string;
  label: string;
  description: string;
  pointsCost: number;
  category: "discount" | "priority" | "swag" | "bonus" | "tools";
}

export const CUSTOMER_REWARDS: RewardItem[] = [
  { key: "discount_25",   label: "$25 off next service",  description: "Apply to any future job",            pointsCost: 5_000,  category: "discount" },
  { key: "discount_60",   label: "$60 off next service",  description: "Apply to any future job",            pointsCost: 10_000, category: "discount" },
  { key: "discount_150",  label: "$150 off next service", description: "Apply to any future job",            pointsCost: 22_500, category: "discount" },
  { key: "priority_3mo",  label: "3 months priority booking",  description: "Faster mechanic assignment + queue priority", pointsCost: 8_000,  category: "priority" },
  { key: "priority_6mo",  label: "6 months priority booking",  description: "Faster mechanic assignment + queue priority", pointsCost: 14_000, category: "priority" },
  { key: "priority_12mo", label: "12 months priority booking", description: "Faster mechanic assignment + queue priority", pointsCost: 25_000, category: "priority" },
  { key: "swag_air",      label: "APS air freshener",     description: "Branded air freshener mailed to you", pointsCost: 1_500,  category: "swag" },
  { key: "swag_sticker",  label: "APS bumper sticker",    description: "Branded sticker mailed to you",      pointsCost: 1_000,  category: "swag" },
  { key: "swag_tshirt",   label: "APS T-shirt",           description: "Branded T-shirt mailed to you",      pointsCost: 4_000,  category: "swag" },
  { key: "swag_pack",     label: "APS merch pack",        description: "T-shirt + sticker + air freshener",  pointsCost: 6_500,  category: "swag" },
];

export const MECHANIC_REWARDS: RewardItem[] = [
  { key: "bonus_50",      label: "$50 cash bonus",            description: "Paid out on next payout cycle",      pointsCost: 7_500,  category: "bonus" },
  { key: "bonus_150",     label: "$150 cash bonus",           description: "Paid out on next payout cycle",      pointsCost: 20_000, category: "bonus" },
  { key: "bonus_500",     label: "$500 cash bonus",           description: "Paid out on next payout cycle",      pointsCost: 60_000, category: "bonus" },
  { key: "tools_socket",  label: "Pro socket set",            description: "Mailed to your address on file",     pointsCost: 18_000, category: "tools" },
  { key: "tools_obd",     label: "Premium OBD2 scanner",      description: "Mailed to your address on file",     pointsCost: 32_000, category: "tools" },
  { key: "tools_kit",     label: "APS specialty diag kit",    description: "Branded multi-tool kit mailed to you", pointsCost: 45_000, category: "tools" },
  { key: "swag_uniform",  label: "APS uniform shirt",         description: "Embroidered work shirt",             pointsCost: 3_000,  category: "swag" },
  { key: "swag_gear",     label: "APS gear pack",             description: "Hoodie + cap + sticker",             pointsCost: 8_000,  category: "swag" },
];

export function findCustomerReward(key: string): RewardItem | undefined {
  return CUSTOMER_REWARDS.find((r) => r.key === key);
}
export function findMechanicReward(key: string): RewardItem | undefined {
  return MECHANIC_REWARDS.find((r) => r.key === key);
}

/* -------------------------------------------------------------------------- */
/* AWARDING — idempotent per (user, jobId, sourceType)                        */
/* -------------------------------------------------------------------------- */

async function alreadyAwardedCustomer(userId: number, jobId: number | null, source: CustomerSource): Promise<boolean> {
  if (jobId == null) return false;
  const existing = await db.select({ id: customerPointsLedgerTable.id })
    .from(customerPointsLedgerTable)
    .where(and(
      eq(customerPointsLedgerTable.userId, userId),
      eq(customerPointsLedgerTable.jobId, jobId),
      eq(customerPointsLedgerTable.sourceType, source),
    ))
    .limit(1);
  return existing.some((r) => true) && existing.length > 0;
}

async function alreadyAwardedMechanic(mechanicId: number, jobId: number | null, source: MechanicSource): Promise<boolean> {
  if (jobId == null) return false;
  const existing = await db.select({ id: mechanicPointsLedgerTable.id })
    .from(mechanicPointsLedgerTable)
    .where(and(
      eq(mechanicPointsLedgerTable.mechanicId, mechanicId),
      eq(mechanicPointsLedgerTable.jobId, jobId),
      eq(mechanicPointsLedgerTable.sourceType, source),
    ))
    .limit(1);
  return existing.length > 0;
}

async function recomputeCustomerBalance(userId: number): Promise<number> {
  const [agg] = await db.select({ total: sum(customerPointsLedgerTable.points) })
    .from(customerPointsLedgerTable)
    .where(eq(customerPointsLedgerTable.userId, userId));
  const total = Number(agg?.total ?? 0);
  await db.update(usersTable).set({ loyaltyPoints: total }).where(eq(usersTable.id, userId));
  return total;
}

async function recomputeMechanicBalance(mechanicId: number): Promise<number> {
  const [agg] = await db.select({ total: sum(mechanicPointsLedgerTable.points) })
    .from(mechanicPointsLedgerTable)
    .where(eq(mechanicPointsLedgerTable.mechanicId, mechanicId));
  const total = Number(agg?.total ?? 0);
  await db.update(usersTable).set({ mechanicPoints: total }).where(eq(usersTable.id, mechanicId));
  return total;
}

export async function awardCustomerPoints(
  userId: number, points: number, source: CustomerSource, reason: string, jobId?: number,
): Promise<boolean> {
  if (points <= 0) return false;
  // Fast-path skip — saves a write when we already have the row.
  if (jobId != null && await alreadyAwardedCustomer(userId, jobId, source)) {
    logger.info({ userId, jobId, source }, "customer points already awarded — skipping (idempotent)");
    return false;
  }
  // Race-safe insert — partial unique index `cust_pts_unique_award` is the
  // last line of defense against duplicate positive awards on concurrent
  // webhook retries. ON CONFLICT DO NOTHING returns no rows on collision.
  const inserted = await db.insert(customerPointsLedgerTable)
    .values({ userId, points, sourceType: source, reason, jobId: jobId ?? null })
    .onConflictDoNothing({ target: [
      customerPointsLedgerTable.userId, customerPointsLedgerTable.jobId, customerPointsLedgerTable.sourceType,
    ] })
    .returning({ id: customerPointsLedgerTable.id });
  if (inserted.length === 0) return false; // lost the race
  await recomputeCustomerBalance(userId);
  return true;
}

export async function awardMechanicPoints(
  mechanicId: number, points: number, source: MechanicSource, reason: string, jobId?: number,
): Promise<boolean> {
  if (points <= 0) return false;
  if (jobId != null && await alreadyAwardedMechanic(mechanicId, jobId, source)) {
    logger.info({ mechanicId, jobId, source }, "mechanic points already awarded — skipping (idempotent)");
    return false;
  }
  const inserted = await db.insert(mechanicPointsLedgerTable)
    .values({ mechanicId, points, sourceType: source, reason, jobId: jobId ?? null })
    .onConflictDoNothing({ target: [
      mechanicPointsLedgerTable.mechanicId, mechanicPointsLedgerTable.jobId, mechanicPointsLedgerTable.sourceType,
    ] })
    .returning({ id: mechanicPointsLedgerTable.id });
  if (inserted.length === 0) return false;
  await recomputeMechanicBalance(mechanicId);
  return true;
}

/* -------------------------------------------------------------------------- */
/* REVERSAL — on refund                                                        */
/* -------------------------------------------------------------------------- */

export async function reverseCustomerPointsForJob(jobId: number, reason: string) {
  const grants = await db.select().from(customerPointsLedgerTable)
    .where(eq(customerPointsLedgerTable.jobId, jobId));
  const positive = grants.filter((g) => g.points > 0 && g.sourceType !== "reversal");
  if (positive.length === 0) return;
  for (const g of positive) {
    // If we've already inserted a reversal for this exact (user, job, source),
    // skip — keeps refund webhooks idempotent.
    const existingReversal = grants.find(
      (x) => x.userId === g.userId && x.sourceType === "reversal" && x.points === -g.points && x.reason.includes(`#${g.id}`),
    );
    if (existingReversal) continue;
    await db.insert(customerPointsLedgerTable).values({
      userId: g.userId, points: -g.points, sourceType: "reversal",
      reason: `${reason} (reversal of ledger #${g.id})`, jobId,
    });
  }
  for (const uid of Array.from(new Set(positive.map((g) => g.userId)))) {
    await recomputeCustomerBalance(uid);
  }
}

export async function reverseMechanicPointsForJob(jobId: number, reason: string) {
  const grants = await db.select().from(mechanicPointsLedgerTable)
    .where(eq(mechanicPointsLedgerTable.jobId, jobId));
  const positive = grants.filter((g) => g.points > 0 && g.sourceType !== "reversal");
  if (positive.length === 0) return;
  for (const g of positive) {
    const existingReversal = grants.find(
      (x) => x.mechanicId === g.mechanicId && x.sourceType === "reversal" && x.points === -g.points && x.reason.includes(`#${g.id}`),
    );
    if (existingReversal) continue;
    await db.insert(mechanicPointsLedgerTable).values({
      mechanicId: g.mechanicId, points: -g.points, sourceType: "reversal",
      reason: `${reason} (reversal of ledger #${g.id})`, jobId,
    });
  }
  for (const mid of Array.from(new Set(positive.map((g) => g.mechanicId)))) {
    await recomputeMechanicBalance(mid);
  }
}

/* -------------------------------------------------------------------------- */
/* REDEMPTIONS                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Atomic redemption: lock the user row, sum the ledger inside the same tx,
 * insert the deduction + redemption, and recompute the cached balance — all
 * in a single transaction. Two concurrent calls serialize on the row lock,
 * so a customer can't double-redeem and overdraft.
 */
export async function redeemCustomerReward(userId: number, rewardKey: string) {
  const reward = findCustomerReward(rewardKey);
  if (!reward) throw new Error("Unknown reward");
  return await db.transaction(async (tx) => {
    // Row lock — second concurrent redeem waits here until first commits.
    await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
    const [agg] = await tx.select({ total: sum(customerPointsLedgerTable.points) })
      .from(customerPointsLedgerTable)
      .where(eq(customerPointsLedgerTable.userId, userId));
    const balance = Number(agg?.total ?? 0);
    if (balance < reward.pointsCost) {
      throw new Error(`Insufficient points (have ${balance}, need ${reward.pointsCost})`);
    }
    await tx.insert(customerPointsLedgerTable).values({
      userId, points: -reward.pointsCost, sourceType: "reversal",
      reason: `Redeemed: ${reward.label}`, jobId: null,
    });
    await tx.insert(customerRedemptionsTable).values({
      userId, rewardKey: reward.key, rewardLabel: reward.label, pointsUsed: reward.pointsCost,
    });
    const newBalance = balance - reward.pointsCost;
    await tx.update(usersTable).set({ loyaltyPoints: newBalance }).where(eq(usersTable.id, userId));
    return newBalance;
  });
}

export async function redeemMechanicReward(mechanicId: number, rewardKey: string) {
  const reward = findMechanicReward(rewardKey);
  if (!reward) throw new Error("Unknown reward");
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM users WHERE id = ${mechanicId} FOR UPDATE`);
    const [agg] = await tx.select({ total: sum(mechanicPointsLedgerTable.points) })
      .from(mechanicPointsLedgerTable)
      .where(eq(mechanicPointsLedgerTable.mechanicId, mechanicId));
    const balance = Number(agg?.total ?? 0);
    if (balance < reward.pointsCost) {
      throw new Error(`Insufficient points (have ${balance}, need ${reward.pointsCost})`);
    }
    await tx.insert(mechanicPointsLedgerTable).values({
      mechanicId, points: -reward.pointsCost, sourceType: "reversal",
      reason: `Redeemed: ${reward.label}`, jobId: null,
    });
    await tx.insert(mechanicRewardsTable).values({
      mechanicId, rewardKey: reward.key, rewardLabel: reward.label, pointsUsed: reward.pointsCost,
    });
    const newBalance = balance - reward.pointsCost;
    await tx.update(usersTable).set({ mechanicPoints: newBalance }).where(eq(usersTable.id, mechanicId));
    return newBalance;
  });
}

/* -------------------------------------------------------------------------- */
/* RULES — single source of truth for points-per-event                         */
/* -------------------------------------------------------------------------- */

export const RULES = {
  customer: {
    pointsPerDollar: 1,
    surveyBase: 25,                                    // any 1-5 rating submitted
    reviewWithText: 50,                                // bonus when reviewText is provided
    reviewQualityBonus: (rating: number) => Math.max(0, (rating - 3)) * 50, // 4★=+50, 5★=+100
    referralFirstPaidJob: 1_000,                       // upgraded from old 500
    welcomeBonusViaReferral: 200,
  },
  mechanic: {
    jobBase: { detailing: 50, maintenance: 75, diagnostic: 100, repair: 150 } as Record<string, number>,
    ratingBonus: (rating: number) => Math.max(0, rating) * 20, // 5★ = 100
    upsellPointsPerDollar: 2,                          // upsell $50 → 100 pts
  },
} as const;
