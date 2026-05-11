/**
 * Admin Growth Settings — singleton (id=1) row holding global AI policy
 * toggles for the Growth Intelligence Center. Currently just an AI-pause
 * switch + a daily generation cap, but designed to scale into more policy
 * fields without schema churn (any new boolean/int/string field can be
 * added inline).
 *
 * AI restriction policy enforced at the route layer:
 *   - aiContentGenerationPaused = true → all /admin/growth/content/generate*
 *     endpoints return 423 (Locked) until an admin un-pauses.
 *   - maxDailyDrafts caps how many drafts the engine will produce per
 *     calendar day across all platforms.
 */

import { pgTable, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const adminGrowthSettingsTable = pgTable("admin_growth_settings", {
  id: integer("id").primaryKey(),                                           // always 1
  aiContentGenerationPaused: boolean("ai_content_generation_paused").notNull().default(false),
  maxDailyDrafts: integer("max_daily_drafts").notNull().default(100),
  updatedById: integer("updated_by_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminGrowthSettings = typeof adminGrowthSettingsTable.$inferSelect;
