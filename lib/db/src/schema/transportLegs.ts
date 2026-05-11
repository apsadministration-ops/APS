import { pgTable, serial, integer, text, timestamp, real, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";

export const vehicleTransportLegsTable = pgTable("vehicle_transport_legs", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  driverId: integer("driver_id").notNull().references(() => usersTable.id),
  direction: text("direction", { enum: ["outbound", "return"] }).notNull(),
  status: text("status", { enum: ["in_progress", "completed", "cancelled"] }).notNull().default("in_progress"),
  startMileage: integer("start_mileage").notNull(),
  endMileage: integer("end_mileage"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  startLat: real("start_lat"),
  startLng: real("start_lng"),
  endLat: real("end_lat"),
  endLng: real("end_lng"),
  lastLat: real("last_lat"),
  lastLng: real("last_lng"),
  lastLocationAt: timestamp("last_location_at", { withTimezone: true }),
  notes: text("notes"),
}, (t) => [
  index("transport_legs_job_id_idx").on(t.jobId),
  index("transport_legs_driver_id_idx").on(t.driverId),
  index("transport_legs_status_idx").on(t.status),
]);

export const insertTransportLegSchema = createInsertSchema(vehicleTransportLegsTable).omit({ id: true, startedAt: true });
export type InsertTransportLeg = z.infer<typeof insertTransportLegSchema>;
export type TransportLeg = typeof vehicleTransportLegsTable.$inferSelect;
