import { pgTable, serial, integer, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { jobsTable } from "./jobs";

/**
 * Customer approval flow — when a mechanic accepts a job we create a row
 * here with a 60-second `expiresAt`. The customer must approve, decline, or
 * (if they do nothing) the job auto-approves at expiry. A scheduled sweeper
 * (or lazy check on the next read) flips `pending` rows whose `expiresAt`
 * has passed to `auto_approved` and unblocks the job.
 *
 * Exactly one approval per job (`unique(jobId)`); reassignment after a
 * decline creates a new row tied to the next mechanic.
 */
export const customerApprovalsTable = pgTable("customer_approvals", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),

  status: text("status", {
    enum: ["pending", "approved", "declined", "auto_approved", "expired"],
  }).notNull().default("pending"),

  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  declineReason: text("decline_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("customer_approvals_job_uq").on(t.jobId),
  index("customer_approvals_status_idx").on(t.status),
  index("customer_approvals_expires_idx").on(t.expiresAt),
]);

export type CustomerApproval = typeof customerApprovalsTable.$inferSelect;
