import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Immutable audit log of every mechanic tier change. Append-only.
 * Records the mechanic's full performance snapshot at the moment of promotion
 * so the trigger conditions can be re-derived later.
 */
export const tierPromotionsTable = pgTable("tier_promotions", {
  id: serial("id").primaryKey(),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  previousTier: text("previous_tier").notNull(),
  newTier: text("new_tier").notNull(),
  reason: text("reason").notNull(),
  // Source of the promotion: "system" (automatic engine), "admin" (manual override),
  // or "system_flagged" (engine surfaced a master-tier candidate awaiting admin approval).
  trigger: text("trigger", { enum: ["system", "system_flagged", "admin"] }).notNull(),
  metricsSnapshot: jsonb("metrics_snapshot").notNull(),
  triggeredBy: integer("triggered_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("tier_promotions_mechanic_idx").on(t.mechanicId),
]);

export type TierPromotion = typeof tierPromotionsTable.$inferSelect;
