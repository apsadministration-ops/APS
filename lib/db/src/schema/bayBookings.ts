import { pgTable, serial, integer, text, timestamp, real, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { baysTable } from "./bays";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";

// A job may retain rejected/cancelled/completed booking history, but may have
// only one live request or reservation at a time. hourlyRate is snapshotted at
// create time so a later rate change on the bay can't retroactively reprice a
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
    // `pending` is a shop-owner approval request. It does not consume a bay
    // interval. `reserved` is the approved/confirmed state and is the first
    // state that participates in availability checks.
    enum: ["pending", "rejected", "reserved", "active", "completed", "cancelled"],
  }).notNull().default("reserved"),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Terminal rows are immutable history. A partial unique index preserves
  // that history while preventing two live requests/reservations for a job.
  uniqueIndex("bay_bookings_job_id_live_unique").on(t.jobId)
    .where(sql`status IN ('pending', 'reserved', 'active')`),
  index("bay_bookings_bay_id_idx").on(t.bayId),
  index("bay_bookings_mechanic_id_idx").on(t.mechanicId),
  index("bay_bookings_shop_id_idx").on(t.shopId),
  index("bay_bookings_start_time_idx").on(t.startTime),
]);

export const insertBayBookingSchema = createInsertSchema(bayBookingsTable).omit({ id: true, createdAt: true });
export type InsertBayBooking = z.infer<typeof insertBayBookingSchema>;
export type BayBooking = typeof bayBookingsTable.$inferSelect;
