import { pgTable, serial, text, integer, timestamp, doublePrecision, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["customer", "mechanic", "admin", "shop_owner"] }).notNull().default("customer"),
  status: text("status", { enum: ["active", "suspended", "pending"] }).notNull().default("active"),
  avatarUrl: text("avatar_url"),
  pushToken: text("push_token"),
  referralCode: text("referral_code").unique(),
  // Tier ladder (5 levels). The internal name is preserved for backward compat;
  // the user-facing label is in MECHANIC_TIER_LABELS in lib/tierProgressionEngine.ts:
  //   detailer    — TIER 1: Detailer
  //   technician  — TIER 2: Basic Mechanic
  //   senior      — TIER 3: Intermediate Mechanic
  //   advanced    — TIER 4: Advanced Mechanic
  //   master      — TIER 5: Master Mechanic
  mechanicTier: text("mechanic_tier", { enum: ["detailer", "technician", "senior", "advanced", "master"] }).default("detailer"),
  certifications: text("certifications").default("[]"),
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  mechanicPoints: integer("mechanic_points").notNull().default(0),
  address: text("address"),
  city: text("city"),
  region: text("region"),
  zipCode: text("zip_code"),
  homeLat: doublePrecision("home_lat"),
  homeLng: doublePrecision("home_lng"),
  serviceRadiusMiles: integer("service_radius_miles"),
  // Stripe — customers have customer_id; mechanics have account_id (Connect Express).
  // Only opaque provider IDs are stored. NEVER card data.
  stripeCustomerId: text("stripe_customer_id"),
  stripeAccountId: text("stripe_account_id"),
  stripeAccountReady: boolean("stripe_account_ready").notNull().default(false),
  // "individual" for sole-proprietor mechanics (default), "company" for
  // shop owners. Drives Stripe Connect Express `business_type` at create time.
  stripeAccountType: text("stripe_account_type", { enum: ["individual", "company"] }).notNull().default("individual"),
  // Schema-only prep for Stripe Instant Payouts — flipped by admin once the
  // mechanic meets eligibility. NOT enforced anywhere yet.
  allowInstantPayouts: boolean("allow_instant_payouts").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
