import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { jobsTable } from "./jobs";

/**
 * APS Dual Loyalty System (v2).
 *
 * Two parallel ledgers — one for customers, one for mechanics — both fed by
 * the same Points Engine. All grants are tied to verified actions only:
 * captured payments, completed jobs, verified reviews, verified referrals,
 * and customer-approved upsells.
 *
 * Idempotency is enforced by a unique partial index per (user/mechanic,
 * job_id, source_type) so the same job can never award the same category
 * twice. Reversals (on refund) are stored as negative-points rows that share
 * the same (job_id, source_type) — see the partial-unique on `points > 0`
 * indexes — keeping the audit trail intact.
 */

export const customerPointsLedgerTable = pgTable("customer_points_ledger", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  points: integer("points").notNull(),
  sourceType: text("source_type", {
    enum: ["service", "referral", "review", "survey", "welcome", "reversal"],
  }).notNull(),
  jobId: integer("job_id").references(() => jobsTable.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("cust_pts_user_idx").on(t.userId),
  index("cust_pts_job_idx").on(t.jobId),
  // Partial-unique: hard-stop duplicate POSITIVE awards per (user, job, source).
  // Reversal/redemption rows (negative points) and welcome (no jobId) are exempt.
  uniqueIndex("cust_pts_unique_award").on(t.userId, t.jobId, t.sourceType)
    .where(sql`points > 0 AND job_id IS NOT NULL`),
]);

export const customerRedemptionsTable = pgTable("customer_redemptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  rewardKey: text("reward_key").notNull(),
  rewardLabel: text("reward_label").notNull(),
  pointsUsed: integer("points_used").notNull(),
  status: text("status", { enum: ["requested", "fulfilled", "cancelled"] })
    .notNull().default("requested"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
}, (t) => [index("cust_redeem_user_idx").on(t.userId)]);

export const mechanicPointsLedgerTable = pgTable("mechanic_points_ledger", {
  id: serial("id").primaryKey(),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),
  points: integer("points").notNull(),
  sourceType: text("source_type", {
    enum: ["job", "rating", "tenure", "upsell", "reversal"],
  }).notNull(),
  jobId: integer("job_id").references(() => jobsTable.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("mech_pts_mechanic_idx").on(t.mechanicId),
  index("mech_pts_job_idx").on(t.jobId),
  uniqueIndex("mech_pts_unique_award").on(t.mechanicId, t.jobId, t.sourceType)
    .where(sql`points > 0 AND job_id IS NOT NULL`),
]);

export const mechanicRewardsTable = pgTable("mechanic_rewards", {
  id: serial("id").primaryKey(),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),
  rewardKey: text("reward_key").notNull(),
  rewardLabel: text("reward_label").notNull(),
  pointsUsed: integer("points_used").notNull(),
  status: text("status", { enum: ["requested", "fulfilled", "cancelled"] })
    .notNull().default("requested"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
}, (t) => [index("mech_redeem_mechanic_idx").on(t.mechanicId)]);

export type CustomerPointsLedger = typeof customerPointsLedgerTable.$inferSelect;
export type CustomerRedemption = typeof customerRedemptionsTable.$inferSelect;
export type MechanicPointsLedger = typeof mechanicPointsLedgerTable.$inferSelect;
export type MechanicReward = typeof mechanicRewardsTable.$inferSelect;
