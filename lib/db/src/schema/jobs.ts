import { pgTable, serial, integer, text, timestamp, real, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { vehiclesTable } from "./vehicles";

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  vin: text("vin").notNull(),
  customerId: integer("customer_id").notNull().references(() => usersTable.id),
  mechanicId: integer("mechanic_id").references(() => usersTable.id),
  jobType: text("job_type", { enum: ["repair", "diagnostic", "maintenance", "detailing"] }).notNull(),
  // Stable slug from `lib/tier-catalog` JOB_CATALOG. Nullable for legacy rows
  // and free-text custom jobs; the required tier below is the authoritative
  // gate for visibility/accept.
  serviceSlug: text("service_slug"),
  // Catalog-derived minimum tier required to accept this job. Mirrors
  // `users.mechanic_tier` enum so we can compare directly. Nullable for
  // legacy rows; legacy fallback below treats null as "detailer" for
  // backward-compatible visibility.
  requiredTier: text("required_tier", { enum: ["detailer", "technician", "senior", "advanced", "master"] }),
  description: text("description").notNull(),
  locationLat: real("location_lat"),
  locationLng: real("location_lng"),
  locationAddress: text("location_address"),
  status: text("status", {
    enum: ["REQUESTED", "OFFERED", "PENDING_APPROVAL", "ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "PAID", "CANCELLED", "REFUSED", "NO_SHOW"],
  }).notNull().default("REQUESTED"),
  mechanicLat: real("mechanic_lat"),
  mechanicLng: real("mechanic_lng"),
  mechanicLocationUpdatedAt: timestamp("mechanic_location_updated_at", { withTimezone: true }),
  estimatedPrice: real("estimated_price"),
  finalPrice: real("final_price"),
  // Sales tax in cents — included in customer's total invoice but EXCLUDED
  // from APS commission base. Computed by the server from the customer's
  // billing address at checkout time (defaults 0 when no rate set).
  taxCents: integer("tax_cents").notNull().default(0),
  rating: integer("rating"),
  ratingNote: text("rating_note"),
  mechanicReviewText: text("mechanic_review_text"),
  customerRating: integer("customer_rating"),
  customerReviewText: text("customer_review_text"),
  requestedMechanicId: integer("requested_mechanic_id").references(() => usersTable.id),
  // Ghost Garage: set true when the job needs an indoor bay (lift, etc.).
  // When true, POST /worklogs is gated on pre+post inspections existing.
  requiresGhostGarage: boolean("requires_ghost_garage").notNull().default(false),
  // Customer must approve transport to a shop bay before the mechanic can
  // start working. Defaults to true for non-ghost-garage jobs (no transport
  // happens). For ghost-garage jobs the customer must explicitly opt in.
  customerTransportApproved: boolean("customer_transport_approved").notNull().default(true),
  // Set when the customer either explicitly confirms the completed work or
  // the 24h auto-confirm sweeper fires. Used by the payout-hold engine to
  // know when to release the Stripe capture.
  customerWorkApprovedAt: timestamp("customer_work_approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // Fleet / Commercial injection tagging. Defaults preserve "normal customer"
  // behavior — pure metadata for analytics + a mechanic-side badge. Does NOT
  // influence dispatch, acceptance, completion flow, or earnings.
  sourceType: text("source_type", { enum: ["consumer", "fleet", "commercial"] }).notNull().default("consumer"),
  fleetAccountId: integer("fleet_account_id"),
  fleetContractId: integer("fleet_contract_id"),
  fleetPriority: text("fleet_priority", { enum: ["standard", "priority", "urgent"] }),
}, (t) => [
  index("jobs_vin_idx").on(t.vin),
  index("jobs_customer_id_idx").on(t.customerId),
  index("jobs_mechanic_id_idx").on(t.mechanicId),
  index("jobs_status_idx").on(t.status),
]);

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
