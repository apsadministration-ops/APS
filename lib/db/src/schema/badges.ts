import { pgTable, serial, integer, text, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Badge awards. The set of badge keys is defined in code (so the award
 * engine can ship updates without DB migrations); this table just records
 * which user currently holds which badge and when it was awarded/revoked.
 *
 * `revokedAt IS NULL` means the badge is currently active. Re-awarding a
 * previously revoked badge inserts a new row (history is preserved); the
 * unique partial index below prevents two simultaneous active rows for the
 * same (user, badge).
 */
export const userBadgesTable = pgTable("user_badges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  badgeKey: text("badge_key").notNull(),
  awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  // Snapshot of the metric values at award time — useful for showing
  // "earned for X completed jobs" on the badge tooltip without recomputing.
  criteriaSnapshot: jsonb("criteria_snapshot").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  index("user_badges_user_idx").on(t.userId),
  index("user_badges_key_idx").on(t.badgeKey),
]);

export type UserBadge = typeof userBadgesTable.$inferSelect;
