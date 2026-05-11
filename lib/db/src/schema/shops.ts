import { pgTable, serial, integer, text, timestamp, doublePrecision, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Ghost Garage shops. Owned by users with role="shop_owner". A single owner
// may operate multiple shops.
export const shopsTable = pgTable("shops", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  region: text("region").notNull(),
  zipCode: text("zip_code").notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  phone: text("phone"),
  // Insurance metadata is stored opaquely; APS does not contact the carrier.
  // Exposed in dispute UI only — see liability model in spec section 8.
  insuranceCarrier: text("insurance_carrier"),
  insurancePolicyNumber: text("insurance_policy_number"),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),

  // Stripe Connect Express (company-type) for shop-level payouts. Distinct
  // from the OWNER's user-level `stripeAccountId` — a shop has its own
  // payout destination so a single owner can run multiple shops with
  // separate bank accounts and 1099s.
  stripeAccountId: text("stripe_account_id"),
  stripeAccountReady: integer("stripe_account_ready").notNull().default(0),
  // Default routing for any job worked at this shop:
  //   "mechanic" — pay the mechanic directly (no shop cut)
  //   "shop"     — pay the shop, owner pays mechanic outside APS
  //   "split"    — split per shopSplitPct
  defaultPayoutMode: text("default_payout_mode", { enum: ["mechanic", "shop", "split"] }).notNull().default("mechanic"),
  defaultShopSplitPct: integer("default_shop_split_pct").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("shops_owner_id_idx").on(t.ownerId),
  index("shops_status_idx").on(t.status),
]);

export const insertShopSchema = createInsertSchema(shopsTable).omit({ id: true, createdAt: true });
export type InsertShop = z.infer<typeof insertShopSchema>;
export type Shop = typeof shopsTable.$inferSelect;
