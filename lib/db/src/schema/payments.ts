import { pgTable, serial, integer, real, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";

// Status flow with Stripe:
//   pending    → Checkout session created, awaiting customer payment
//   authorized → Funds authorized (manual capture pending) — was "held" pre-Stripe
//   captured   → Funds captured + transferred to mechanic — was "released"
//   failed     → Payment failed / declined
//   canceled   → Payment intent canceled
//   refunded   → Payment refunded
// Legacy values "held" and "released" kept for backward compatibility with existing rows.
export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  amount: real("amount").notNull(),
  platformFee: real("platform_fee").notNull(),
  mechanicPayout: real("mechanic_payout").notNull(),
  status: text("status", {
    enum: ["pending", "held", "released", "failed", "authorized", "captured", "refunded", "canceled"],
  }).notNull().default("pending"),
  // Stripe references — opaque provider IDs only. NO card data.
  providerSessionId: text("provider_session_id"),
  providerPaymentIntentId: text("provider_payment_intent_id"),
  providerTransferId: text("provider_transfer_id"),
  amountCents: integer("amount_cents"),
  platformFeeCents: integer("platform_fee_cents"),
  mechanicPayoutCents: integer("mechanic_payout_cents"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  releasedAt: timestamp("released_at", { withTimezone: true }),
}, (t) => [
  index("payments_job_id_idx").on(t.jobId),
  index("payments_provider_intent_idx").on(t.providerPaymentIntentId),
]);

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
