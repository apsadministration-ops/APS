import { pgTable, serial, integer, boolean, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { jobsTable } from "./jobs";

/**
 * Standalone referral system.
 *
 * Hard-isolated from the loyalty engine. The referral system ONLY writes
 * referral-specific rewards (source_type = "referral") into the points
 * ledger via `referralEngine.tryConvertReferral()`.
 *
 * A referral is "converted" when ALL of these are true:
 *   1. Referred user completes their FIRST paid job
 *   2. Payment is captured
 *   3. No refund exists on that payment
 *
 * Idempotency: the unique index on `referred_id` enforces that a given
 * referred user can only ever produce ONE referral record (and therefore
 * one referral reward). The `converted` flag is set inside a transaction
 * so concurrent capture webhooks can't double-award.
 */
export const referralsTable = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull().references(() => usersTable.id),
  referredId: integer("referred_id").notNull().references(() => usersTable.id),
  referralCodeUsed: text("referral_code_used"),
  signupTimestamp: timestamp("signup_timestamp", { withTimezone: true }).notNull().defaultNow(),
  firstJobId: integer("first_job_id").references(() => jobsTable.id),
  converted: boolean("converted").notNull().default(false),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  pointsAwarded: integer("points_awarded").notNull().default(0),
  // Legacy column kept for backward compat with older code paths; mirror of `converted`.
  rewarded: boolean("rewarded").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("referrals_referrer_id_idx").on(t.referrerId),
  // Hard-stop duplicate referral rewards: a user can only be referred ONCE.
  uniqueIndex("referrals_referred_unique").on(t.referredId),
]);

/**
 * Audit log of every referral-state-changing event. Optional but spec'd —
 * lets us reconstruct exactly when a referral signed up, converted, or
 * was reverted by a refund.
 */
export const referralEventsTable = pgTable("referral_events", {
  id: serial("id").primaryKey(),
  referralId: integer("referral_id").notNull().references(() => referralsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type", {
    enum: ["signup", "job_completed", "payment_captured", "reverted"],
  }).notNull(),
  jobId: integer("job_id").references(() => jobsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("referral_events_referral_idx").on(t.referralId),
]);

export type Referral = typeof referralsTable.$inferSelect;
export type ReferralEvent = typeof referralEventsTable.$inferSelect;
