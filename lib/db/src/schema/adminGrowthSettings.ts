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

import { pgTable, integer, boolean, timestamp, text } from "drizzle-orm/pg-core";

export const adminGrowthSettingsTable = pgTable("admin_growth_settings", {
  id: integer("id").primaryKey(),                                           // always 1
  aiContentGenerationPaused: boolean("ai_content_generation_paused").notNull().default(false),
  maxDailyDrafts: integer("max_daily_drafts").notNull().default(100),
  // Platform-level (APS business) social presence — surfaced to users + AI CTAs.
  // URL fields hold the canonical full URL; handle fields hold the @handle (without @)
  // for inline mentions / hashtag generation.
  businessName: text("business_name"),
  websiteUrl: text("website_url"),
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  instagramHandle: text("instagram_handle"),
  tiktokUrl: text("tiktok_url"),
  tiktokHandle: text("tiktok_handle"),
  twitterUrl: text("twitter_url"),
  twitterHandle: text("twitter_handle"),
  youtubeUrl: text("youtube_url"),
  linkedinUrl: text("linkedin_url"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  updatedById: integer("updated_by_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AdminGrowthSettings = typeof adminGrowthSettingsTable.$inferSelect;
