/**
 * Mechanic Amplification — per-mechanic growth-node customization.
 *
 * Stores the mechanic's public referral page customization (tagline, bio,
 * brand color, social handles). One row per mechanic. Lazily created when
 * the mechanic first opens their amplification kit.
 *
 * QR codes, vCards, and business-card SVGs are derived at request time
 * from this row + the mechanic's referral code — never persisted.
 */

import { pgTable, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const mechanicAmplificationTable = pgTable("mechanic_amplification", {
  mechanicId: integer("mechanic_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  displayName: text("display_name"),                // public override of users.name
  tagline: text("tagline"),                         // ≤120 chars
  bio: text("bio"),                                 // ≤600 chars
  specialty: text("specialty"),                     // e.g. "European diagnostics"
  brandColor: text("brand_color"),                  // hex like "#F97316"
  instagramHandle: text("instagram_handle"),
  facebookHandle: text("facebook_handle"),
  tiktokHandle: text("tiktok_handle"),
  twitterHandle: text("twitter_handle"),
  pageEnabled: boolean("page_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MechanicAmplification = typeof mechanicAmplificationTable.$inferSelect;
export type NewMechanicAmplification = typeof mechanicAmplificationTable.$inferInsert;
