import { pgTable, serial, integer, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";

/**
 * Customer "approve completed work" — the 24-hour escrow hold.
 *
 * Created when a mechanic submits a work log. Customer has 24h to:
 *   - confirm     → fast-track Stripe capture immediately
 *   - dispute     → freeze capture, open a `disputes` row
 *   - silence     → cron sweeper auto-confirms at expiry, capture fires
 *
 * Exactly one row per job (`unique(job_id)`).
 */
export const workConfirmationsTable = pgTable("work_confirmations", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => usersTable.id),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),

  status: text("status", {
    enum: ["pending", "confirmed", "disputed", "auto_confirmed", "expired"],
  }).notNull().default("pending"),

  // 24h after the work log was submitted.
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  disputeReason: text("dispute_reason"),

  // Whether Stripe capture has been triggered for this confirmation.
  // True after manual confirm / auto sweep fires the capture call.
  captureFired: text("capture_fired").default("false"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("work_confirmations_job_uq").on(t.jobId),
  index("work_confirmations_status_idx").on(t.status),
  index("work_confirmations_expires_idx").on(t.expiresAt),
]);

export type WorkConfirmation = typeof workConfirmationsTable.$inferSelect;
