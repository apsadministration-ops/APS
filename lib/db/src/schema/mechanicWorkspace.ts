/**
 * Mechanic-only Vehicle Intelligence Workspace tables.
 *
 * IMPORTANT: every table here stores data that is intentionally INVISIBLE to
 * customers. Routes that surface this data MUST be gated by an active-mechanic
 * (or admin) check. Customers continue to see only their existing vehicle row,
 * the basic completed-service summary, and invoices.
 *
 * Design notes:
 *   - VIN is the long-lived identity. Every row denormalizes the VIN alongside
 *     the FK so we can quickly answer "what does APS know about VIN X?" even
 *     after vehicle ownership transfers (vehicles row stays, just owners
 *     change in the ownership table).
 *   - mechanic_vehicle_profiles is 1:1 with vehicles and only created the
 *     first time a mechanic decodes a VIN. It caches the NHTSA-decoded data
 *     so we don't re-hit the upstream on every workspace open.
 *   - installed_parts is the core "APS becomes smarter than VIN alone" log.
 *     Partial unique index prevents two active rows for the same
 *     (vehicle, category, partNumber) — replacing a part should insert a new
 *     row and mark the previous one removedAt.
 */

import {
  pgTable, serial, integer, text, timestamp, jsonb, real, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { vehiclesTable } from "./vehicles";
import { jobsTable } from "./jobs";

// ── Cached NHTSA decode + mechanic-side vehicle profile ──────────────────
export const mechanicVehicleProfilesTable = pgTable("mechanic_vehicle_profiles", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id, { onDelete: "cascade" }),
  vin: text("vin").notNull(),
  // Full NHTSA vPIC decode payload; arbitrary keys.
  decodedVin: jsonb("decoded_vin").$type<Record<string, string | null>>().notNull().default({}),
  decodedAt: timestamp("decoded_at", { withTimezone: true }),
  // Convenience denorms pulled out of the decode for fast filtering / display.
  engine: text("engine"),
  transmission: text("transmission"),
  drivetrain: text("drivetrain"),
  fuelType: text("fuel_type"),
  bodyClass: text("body_class"),
  // Mechanic-uploaded headshot of the actual vehicle (overrides any
  // customer-side image for the workspace view).
  imageUrl: text("image_url"),
  lastMechanicId: integer("last_mechanic_id").references(() => usersTable.id),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("mech_vehicle_profile_vehicle_uq").on(t.vehicleId),
  index("mech_vehicle_profile_vin_idx").on(t.vin),
]);

// ── Installed parts log — the long-term intelligence layer ───────────────
export const installedPartsTable = pgTable("installed_parts", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id, { onDelete: "cascade" }),
  vin: text("vin").notNull(),
  jobId: integer("job_id").references(() => jobsTable.id, { onDelete: "set null" }),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),
  category: text("category").notNull(), // "brake_pads", "rotor_front", "battery", "tires", "oil_filter", etc.
  partNumber: text("part_number"),
  brand: text("brand"),
  supplier: text("supplier"),
  installMileage: integer("install_mileage"),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
  // Set when this row is superseded by a new install of the same category
  // — old part history is retained, just inactive.
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedReason: text("removed_reason"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  // Mechanic verification & override tracking. confidence reflects how the
  // compatibility engine rated this category at install time; override is
  // populated when the mechanic ignored the engine's recommended part.
  confidenceAtInstall: text("confidence_at_install"), // "high", "medium", "verify"
  overrideRecommendation: jsonb("override_recommendation").$type<{
    recommendedPartNumber?: string;
    recommendedBrand?: string;
    reason: string;
  } | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("installed_parts_vehicle_idx").on(t.vehicleId),
  index("installed_parts_vin_idx").on(t.vin),
  index("installed_parts_category_idx").on(t.category),
  // Only ONE active install per (vehicle, category) at a time. The route
  // enforces this inside a transaction with a row lock; this index is the
  // database-level safety net.
  uniqueIndex("installed_parts_active_uq")
    .on(t.vehicleId, t.category)
    .where(sql`removed_at IS NULL`),
]);

// ── Mechanic notes (observations / warnings / diagnostics) ───────────────
export const mechanicVehicleNotesTable = pgTable("mechanic_vehicle_notes", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id, { onDelete: "cascade" }),
  vin: text("vin").notNull(),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),
  jobId: integer("job_id").references(() => jobsTable.id, { onDelete: "set null" }),
  type: text("type", { enum: ["observation", "warning", "diagnostic"] }).notNull(),
  severity: text("severity", { enum: ["info", "low", "medium", "high"] }).notNull().default("info"),
  title: text("title").notNull(),
  body: text("body"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedById: integer("resolved_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("mech_notes_vehicle_idx").on(t.vehicleId),
  index("mech_notes_vin_idx").on(t.vin),
]);

// ── Persistent vehicle-level recommendations (carry across visits) ───────
export const vehicleRecommendationsTable = pgTable("vehicle_recommendations", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id, { onDelete: "cascade" }),
  vin: text("vin").notNull(),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),
  jobId: integer("job_id").references(() => jobsTable.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  urgency: text("urgency", { enum: ["low", "medium", "high", "critical"] }).notNull().default("medium"),
  status: text("status", { enum: ["open", "addressed", "dismissed"] }).notNull().default("open"),
  estimatedCost: real("estimated_cost"),
  addressedAt: timestamp("addressed_at", { withTimezone: true }),
  addressedById: integer("addressed_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("vehicle_reco_vehicle_idx").on(t.vehicleId),
  index("vehicle_reco_vin_idx").on(t.vin),
  index("vehicle_reco_status_idx").on(t.status),
]);

export type MechanicVehicleProfile = typeof mechanicVehicleProfilesTable.$inferSelect;
export type InstalledPart = typeof installedPartsTable.$inferSelect;
export type MechanicVehicleNote = typeof mechanicVehicleNotesTable.$inferSelect;
export type VehicleRecommendation = typeof vehicleRecommendationsTable.$inferSelect;
