import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { paymentsTable } from "./payments";
import { usersTable } from "./users";

/**
 * Disputes — closes the chargeback gap.
 *
 * Two creation paths:
 *   1. Stripe `charge.dispute.created` webhook (true card chargeback)
 *      → kind = "stripe_chargeback"
 *   2. Customer hits "Open dispute" inside the 24h work-confirmation window
 *      → kind = "customer_filed"  (no Stripe Dispute exists yet — APS-internal)
 *
 * In both cases the linked payment is frozen (`captureBlockedReason="dispute"`
 * on `payments`) so the 24h sweeper does not capture and any payout-event
 * sweeps treat the row as held.
 *
 * Stripe owns the OUTCOME of card chargebacks. We mirror it here for the
 * mechanic + admin dashboards.
 */
export const disputesTable = pgTable("disputes", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
  paymentId: integer("payment_id").references(() => paymentsTable.id, { onDelete: "set null" }),
  customerId: integer("customer_id").notNull().references(() => usersTable.id),
  mechanicId: integer("mechanic_id").references(() => usersTable.id),

  kind: text("kind", { enum: ["customer_filed", "stripe_chargeback"] }).notNull(),

  // Stripe dispute id when kind="stripe_chargeback".
  providerDisputeId: text("provider_dispute_id").unique(),
  // Stripe-reported reason (or our short tag for customer-filed).
  reason: text("reason"),
  // Customer-supplied notes / evidence summary.
  customerNotes: text("customer_notes"),

  // open       — dispute active, payout frozen
  // under_review — admin investigating
  // resolved_customer — customer wins (refund stands / chargeback lost)
  // resolved_mechanic — mechanic wins (payment captured / chargeback won)
  // canceled   — customer withdrew
  status: text("status", {
    enum: ["open", "under_review", "resolved_customer", "resolved_mechanic", "canceled"],
  }).notNull().default("open"),

  amountCents: integer("amount_cents"),
  resolutionNotes: text("resolution_notes"),
  resolvedById: integer("resolved_by_id").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("disputes_job_idx").on(t.jobId),
  index("disputes_status_idx").on(t.status),
  index("disputes_mechanic_idx").on(t.mechanicId),
]);

export type Dispute = typeof disputesTable.$inferSelect;
