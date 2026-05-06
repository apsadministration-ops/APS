import { pgTable, serial, integer, text, timestamp, real, json, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { vehiclesTable } from "./vehicles";
import { jobsTable } from "./jobs";

export const workLogsTable = pgTable("work_logs", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  vin: text("vin").notNull(),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),
  customerId: integer("customer_id").notNull().references(() => usersTable.id),
  serviceCategory: text("service_category", { enum: ["repair", "diagnostic", "maintenance", "detailing"] }).notNull(),
  serviceDescription: text("service_description").notNull(),
  mileageAtService: integer("mileage_at_service").notNull(),
  laborCost: real("labor_cost").notNull(),
  partsCost: real("parts_cost").notNull(),
  totalCost: real("total_cost").notNull(),
  partsUsed: json("parts_used").$type<string[]>().notNull().default([]),
  notes: text("notes"),
  beforeImages: json("before_images").$type<string[]>().notNull().default([]),
  afterImages: json("after_images").$type<string[]>().notNull().default([]),
  immutableFlag: boolean("immutable_flag").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("worklogs_vin_idx").on(t.vin),
  index("worklogs_vehicle_id_idx").on(t.vehicleId),
  // One worklog per job — defense-in-depth against duplicate submissions
  // that could trigger duplicate Stripe captures.
  uniqueIndex("worklogs_job_id_unique").on(t.jobId),
]);

export const insertWorkLogSchema = createInsertSchema(workLogsTable).omit({ id: true, createdAt: true, immutableFlag: true });
export type InsertWorkLog = z.infer<typeof insertWorkLogSchema>;
export type WorkLog = typeof workLogsTable.$inferSelect;
