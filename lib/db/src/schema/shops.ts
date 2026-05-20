import { pgTable, serial, integer, text, timestamp, doublePrecision, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Fleet & Commercial Partners (formerly "Ghost Garage shops"). Owned by users
// with role="shop_owner" (DB role name kept for zero-downtime; UI labels this
// layer as "Partner"). One owner may operate multiple shops/locations/fleets.
//
// `partnerKind` discriminates which UX + business rules apply:
//   - independent_shop  — classic bay/lift rental marketplace
//   - dealership        — dealership service department posting overflow
//   - fleet             — corporate, rental, or trucking fleet
//   - gsa               — U.S. Government / GSA accounts (gov fleets, agencies)
export const shopsTable = pgTable("shops", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id),
  partnerKind: text("partner_kind", { enum: ["independent_shop", "dealership", "fleet", "gsa"] })
    .notNull()
    .default("independent_shop"),
  // Optional flat commission override for this partner's posted jobs.
  // Used for Government / GSA accounts (10%) etc. NULL → use system default
  // (15% for partner-posted jobs, standard tier-catalog rates otherwise).
  commissionOverridePct: integer("commission_override_pct"),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  region: text("region").notNull(),
  zipCode: text("zip_code").notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  phone: text("phone"),
  // Partner identification (replaces the legacy insurance fields on the
  // shop form — vehicle-level insurance now lives on `vehicles`). Federal
  // EIN / Tax ID is what the IRS uses to identify the business; business
  // license is the state/local trade authorisation. Both optional but
  // strongly recommended for dealership / fleet / GSA partners.
  federalEin: text("federal_ein"),
  businessLicense: text("business_license"),
  // DEPRECATED — retained for back-compat with any pre-rebrand rows.
  // Not exposed on the new shop form; new vehicle-level insurance lives
  // on `vehicles.insurance_carrier` + `vehicles.insurance_policy_number`.
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
