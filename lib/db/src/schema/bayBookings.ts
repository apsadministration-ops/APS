import { pgTable, serial, integer, text, timestamp, real, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { baysTable } from "./bays";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";

// One bay booking per job. The booking is the contract between the shop and
// the mechanic for a specific time slot. hourlyRate is snapshotted at create
// time so a later rate change on the bay can't retroactively reprice the
// booking.
export const bayBookingsTable = pgTable("bay_bookings", {
  id: serial("id").primaryKey(),
  bayId: integer("bay_id").notNull().references(() => baysTable.id),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),
  shopId: integer("shop_id").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  estimatedEndTime: timestamp("estimated_end_time", { withTimezone: true }).notNull(),
  actualStartTime: timestamp("actual_start_time", { withTimezone: true }),
  actualEndTime: timestamp("actual_end_time", { withTimezone: true }),
  hourlyRateSnapshot: real("hourly_rate_snapshot").notNull(),
  estimatedHours: real("estimated_hours").notNull(),
  totalCost: real("total_cost"),
  status: text("status", {
    enum: ["reserved", "active", "completed", "cancelled"],
  }).notNull().default("reserved"),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // One booking per job. Prevents double-booking the same job into multiple
  // bays and matches the one-worklog-per-job invariant downstream.
  uniqueIndex("bay_bookings_job_id_unique").on(t.jobId),
  index("bay_bookings_bay_id_idx").on(t.bayId),
  index("bay_bookings_mechanic_id_idx").on(t.mechanicId),
  index("bay_bookings_shop_id_idx").on(t.shopId),
  index("bay_bookings_start_time_idx").on(t.startTime),
]);

export const insertBayBookingSchema = createInsertSchema(bayBookingsTable).omit({ id: true, createdAt: true });
export type InsertBayBooking = z.infer<typeof insertBayBookingSchema>;
export type BayBooking = typeof bayBookingsTable.$inferSelect;
