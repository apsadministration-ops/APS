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
  // Customer-approved upsells/recommendations logged on job completion.
  // Each entry: { description, amount } in dollars. Drives mechanic upsell
  // points in the loyalty engine.
  // Each entry: { description, amount, customerApproved }. ONLY upsells with
  // customerApproved === true award mechanic points — this keeps "verified
  // action" semantics. Mechanic must explicitly attest customer approval at
  // log time (defense-in-depth: customer can dispute via flag → refund path
  // also reverses upsell points).
  upsells: json("upsells").$type<{ description: string; amount: number; customerApproved: boolean }[]>().notNull().default([]),
  // ────────────────────────────────────────────────────────────────────
  // Mechanic technical-intelligence fields. All optional/nullable for
  // backward compatibility with logs created before Ghost Garage shipped.
  // These power the mechanic's deeper VIN-history view (recurring failures,
  // diagnostic patterns) without changing what the customer sees by default.
  // ────────────────────────────────────────────────────────────────────
  laborHours: real("labor_hours"),
  diagnosticCodes: json("diagnostic_codes").$type<string[]>().notNull().default([]),
  rootCauseDiagnosis: text("root_cause_diagnosis"),
  repairSteps: text("repair_steps"),
  observedSymptoms: text("observed_symptoms"),
  recommendedMonitoring: text("recommended_monitoring"),
  recurringIssueTags: json("recurring_issue_tags").$type<string[]>().notNull().default([]),
  // Ghost Garage links — set on jobs that ran through a shop bay.
  bayBookingId: integer("bay_booking_id"),
  preInspectionId: integer("pre_inspection_id"),
  postInspectionId: integer("post_inspection_id"),
  immutableFlag: boolean("immutable_flag").notNull().default(true),
  // Fraud / risk flagging — set true when actual parts cost diverges
  // suspiciously from estimates (see fraudHeuristics.ts). Admin reviews
  // these from /admin/finance/flagged before payout finalisation.
  flaggedForReview: boolean("flagged_for_review").notNull().default(false),
  flagReason: text("flag_reason"),
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
