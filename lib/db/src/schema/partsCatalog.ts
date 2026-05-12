/**
 * APS-curated parts catalog + pluggable supplier offers.
 *
 * Design notes:
 *   - `parts_catalog` is a single canonical part definition (one OEM part
 *     number = one row). Every supplier offer references it. Cross-references
 *     (alternate brand part numbers that fit the same OEM PN) live as a
 *     jsonb array so the search engine can match on either side.
 *   - `parts_catalog_fitment` is a separate table because one catalog entry
 *     usually fits a RANGE of vehicles (e.g. a brake pad set fits 2015-2020
 *     F-150 with the 2.7 EcoBoost). Patterns are case-insensitive substring
 *     matches against the decoded vehicle profile fields. NULL pattern means
 *     "wildcard" for that dimension.
 *   - `parts_offers` is the supplier-side data: price, availability, ETA.
 *     The `supplier_key` is a string registered in the supplier adapter
 *     registry (e.g. "aps-curated", "partstech", "nexpart"). The aps-curated
 *     supplier always exists in this table; future external adapters write
 *     to it on background refresh OR query their own APIs live.
 */

import {
  pgTable, serial, integer, text, timestamp, jsonb, boolean, index, uniqueIndex,
} from "drizzle-orm/pg-core";

export const QUALITY_TIER_VALUES = ["oem", "premium", "standard", "economy"] as const;
export type QualityTier = (typeof QUALITY_TIER_VALUES)[number];

export const partsCatalogTable = pgTable("parts_catalog", {
  id: serial("id").primaryKey(),
  // Matches the same category vocabulary as `installed_parts.category` and
  // `partsCompatibilityEngine.PARTS_CATEGORIES`.
  category: text("category").notNull(),
  brand: text("brand").notNull(),
  oemPartNumber: text("oem_part_number").notNull(),
  // Cross-reference part numbers (other brands' SKUs that fit the same
  // application). Search engine matches against either oemPartNumber or
  // any string in this array.
  crossRefs: jsonb("cross_refs").$type<string[]>().notNull().default([]),
  name: text("name").notNull(),
  qualityTier: text("quality_tier", { enum: QUALITY_TIER_VALUES }).notNull().default("standard"),
  warrantyMonths: integer("warranty_months").notNull().default(12),
  msrpCents: integer("msrp_cents").notNull().default(0),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("parts_catalog_category_idx").on(t.category),
  index("parts_catalog_brand_idx").on(t.brand),
  uniqueIndex("parts_catalog_brand_oem_uq").on(t.brand, t.oemPartNumber),
]);

export const partsCatalogFitmentTable = pgTable("parts_catalog_fitment", {
  id: serial("id").primaryKey(),
  catalogId: integer("catalog_id").notNull().references(() => partsCatalogTable.id, { onDelete: "cascade" }),
  // Inclusive year range. Null means "any year".
  yearMin: integer("year_min"),
  yearMax: integer("year_max"),
  // All patterns are case-insensitive substring matches against the
  // decoded profile field. Null = wildcard.
  make: text("make"),
  model: text("model"),
  enginePattern: text("engine_pattern"),
  transmissionPattern: text("transmission_pattern"),
  drivetrainPattern: text("drivetrain_pattern"),
  trimPattern: text("trim_pattern"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("parts_fitment_catalog_idx").on(t.catalogId),
  index("parts_fitment_make_model_idx").on(t.make, t.model),
]);

export const partsOffersTable = pgTable("parts_offers", {
  id: serial("id").primaryKey(),
  catalogId: integer("catalog_id").notNull().references(() => partsCatalogTable.id, { onDelete: "cascade" }),
  // Matches a key registered in the supplier adapter registry. The
  // "aps-curated" supplier is always present.
  supplierKey: text("supplier_key").notNull(),
  // Supplier-specific SKU (may differ from the OEM part number).
  sku: text("sku").notNull(),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  inStock: boolean("in_stock").notNull().default(true),
  etaDays: integer("eta_days").notNull().default(2),
  // Raw payload from the supplier API for debugging / audit.
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("parts_offers_catalog_idx").on(t.catalogId),
  index("parts_offers_supplier_idx").on(t.supplierKey),
  uniqueIndex("parts_offers_supplier_sku_uq").on(t.supplierKey, t.sku),
]);

export type PartsCatalogEntry = typeof partsCatalogTable.$inferSelect;
export type PartsCatalogFitment = typeof partsCatalogFitmentTable.$inferSelect;
export type PartsOffer = typeof partsOffersTable.$inferSelect;
