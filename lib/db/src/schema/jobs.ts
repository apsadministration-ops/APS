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
  description: text("description").notNull(),
  locationLat: real("location_lat"),
  locationLng: real("location_lng"),
  locationAddress: text("location_address"),
  status: text("status", {
    enum: ["REQUESTED", "OFFERED", "ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "PAID", "CANCELLED"],
  }).notNull().default("REQUESTED"),
  mechanicLat: real("mechanic_lat"),
  mechanicLng: real("mechanic_lng"),
  mechanicLocationUpdatedAt: timestamp("mechanic_location_updated_at", { withTimezone: true }),
  estimatedPrice: real("estimated_price"),
  finalPrice: real("final_price"),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("jobs_vin_idx").on(t.vin),
  index("jobs_customer_id_idx").on(t.customerId),
  index("jobs_mechanic_id_idx").on(t.mechanicId),
  index("jobs_status_idx").on(t.status),
]);

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
