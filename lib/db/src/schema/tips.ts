import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";

/**
 * Tips — a SEPARATE Stripe PaymentIntent so tip money flows independently
 * of the job's escrowed payment. Default platform-fee is 0% (mechanic keeps
 * 100%); admin can later configure a small tip fee via adminGrowthSettings.
 *
 * Status flow:
 *   pending  → checkout session created, awaiting customer payment
 *   captured → tip captured + transferred to mechanic Connect account
 *   failed   → one payment attempt failed (same PaymentIntent may retry)
 *   refunded → tip refunded
 */
export const tipsTable = pgTable("tips", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
  customerId: integer("customer_id").notNull().references(() => usersTable.id),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),

  amountCents: integer("amount_cents").notNull(),
  platformFeeCents: integer("platform_fee_cents").notNull().default(0),
  mechanicAmountCents: integer("mechanic_amount_cents").notNull(),

  status: text("status", { enum: ["pending", "captured", "failed", "refunded"] }).notNull().default("pending"),

  providerSessionId: text("provider_session_id"),
  providerPaymentIntentId: text("provider_payment_intent_id"),
  failureReason: text("failure_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
}, (t) => [
  index("tips_job_idx").on(t.jobId),
  index("tips_mechanic_idx").on(t.mechanicId),
  index("tips_customer_idx").on(t.customerId),
  index("tips_intent_idx").on(t.providerPaymentIntentId),
]);

export type Tip = typeof tipsTable.$inferSelect;
