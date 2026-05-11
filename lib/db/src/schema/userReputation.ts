import { pgTable, integer, numeric, jsonb, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Cached per-user reputation. Recomputed by the reputation engine after
 * every visible review. Splitting this out of `users` keeps the hot user
 * row small and lets us extend trust signals freely.
 *
 * `categoriesAvg` is the per-category mean over visible reviews where this
 * user was the SUBJECT, keyed by the category constants in code.
 */
export const userReputationTable = pgTable("user_reputation", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),

  reviewCount: integer("review_count").notNull().default(0),
  // Stored as numeric so we can show two decimals without float drift.
  overallAvg: numeric("overall_avg", { precision: 4, scale: 2 }).notNull().default("0"),
  categoriesAvg: jsonb("categories_avg").$type<Record<string, number>>().notNull().default({}),

  // Behavioural signals (0..1 ratios stored as numeric).
  completionRate: numeric("completion_rate", { precision: 4, scale: 3 }).notNull().default("0"),
  cancellationRate: numeric("cancellation_rate", { precision: 4, scale: 3 }).notNull().default("0"),
  noShowRate: numeric("no_show_rate", { precision: 4, scale: 3 }).notNull().default("0"),
  responseRate: numeric("response_rate", { precision: 4, scale: 3 }).notNull().default("0"),
  repeatCustomerRate: numeric("repeat_customer_rate", { precision: 4, scale: 3 }).notNull().default("0"),

  // Composite trust score (0..100). Computed by reputationEngine.ts —
  // weighting documented there. 50 = neutral baseline for new accounts.
  trustScore: integer("trust_score").notNull().default(50),

  // Forward-compat bucket for AI/identity/insurance signals.
  trustSignals: jsonb("trust_signals").$type<Record<string, unknown>>().notNull().default({}),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserReputation = typeof userReputationTable.$inferSelect;
