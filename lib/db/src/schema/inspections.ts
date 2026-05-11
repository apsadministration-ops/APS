import { pgTable, serial, integer, text, timestamp, json, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { vehiclesTable } from "./vehicles";
import { usersTable } from "./users";

// Damage checklist captured before/after service. Each entry is OK/issue +
// optional notes. Free-form `other` lets the mechanic record anything not in
// the standard set without us having to evolve the schema for every edge.
export type DamageChecklist = {
  scratches: { ok: boolean; notes?: string };
  dents: { ok: boolean; notes?: string };
  glass: { ok: boolean; notes?: string };
  wheels: { ok: boolean; notes?: string };
  lights: { ok: boolean; notes?: string };
  interior: { ok: boolean; notes?: string };
  fluidLeaks: { ok: boolean; notes?: string };
  other?: string;
};

// Pre-service and post-service inspection records. Required for any job
// where `jobs.requiresGhostGarage = true`. Immutable after submission.
export const inspectionsTable = pgTable("inspections", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  vin: text("vin").notNull(),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),
  kind: text("kind", { enum: ["pre", "post"] }).notNull(),
  mileage: integer("mileage").notNull(),
  // Walkthrough media — image and/or video URLs. Treated identically to the
  // existing before/after photo arrays on work_logs.
  mediaUrls: json("media_urls").$type<string[]>().notNull().default([]),
  damageChecklist: json("damage_checklist").$type<DamageChecklist>(),
  notes: text("notes"),
  // Optional transport mileage capture for jobs that involved moving the
  // vehicle from customer location to the shop.
  transportPickupMileage: integer("transport_pickup_mileage"),
  transportArrivalMileage: integer("transport_arrival_mileage"),
  immutableFlag: boolean("immutable_flag").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // One pre + one post per job. Prevents duplicate submissions and makes
  // the gating logic in POST /worklogs trivially correct.
  uniqueIndex("inspections_job_kind_unique").on(t.jobId, t.kind),
  index("inspections_vin_idx").on(t.vin),
  index("inspections_vehicle_id_idx").on(t.vehicleId),
]);

export const insertInspectionSchema = createInsertSchema(inspectionsTable).omit({ id: true, createdAt: true, immutableFlag: true });
export type InsertInspection = z.infer<typeof insertInspectionSchema>;
export type Inspection = typeof inspectionsTable.$inferSelect;
