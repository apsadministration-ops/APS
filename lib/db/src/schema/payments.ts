import { pgTable, serial, integer, real, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";

// Status flow with Stripe:
//   pending          → Checkout session created, awaiting customer payment
//   authorized       → Funds authorized (manual capture pending) — was "held" pre-Stripe
//   capture_pending  → Work log submitted, 24h customer-confirmation hold open
//   captured         → Funds captured + transferred to mechanic — was "released"
//   payout_failed    → Transfer to mechanic Connect failed (needs retry)
//   disputed         → Chargeback or customer dispute filed; capture/payout frozen
//   failed           → Payment failed / declined
//   canceled         → Payment intent canceled
//   refunded         → Payment refunded
// Legacy values "held" and "released" kept for backward compatibility with existing rows.
export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  amount: real("amount").notNull(),
  platformFee: real("platform_fee").notNull(),
  mechanicPayout: real("mechanic_payout").notNull(),
  status: text("status", {
    enum: ["pending", "held", "released", "failed", "authorized", "capture_pending", "captured", "refunded", "canceled", "payout_failed", "disputed"],
  }).notNull().default("pending"),
  // Stripe references — opaque provider IDs only. NO card data.
  providerSessionId: text("provider_session_id"),
  providerPaymentIntentId: text("provider_payment_intent_id"),
  providerTransferId: text("provider_transfer_id"),
  providerPayoutId: text("provider_payout_id"),
  amountCents: integer("amount_cents"),
  platformFeeCents: integer("platform_fee_cents"),
  mechanicPayoutCents: integer("mechanic_payout_cents"),
  failureReason: text("failure_reason"),

  // 24h escrow hold — when the customer's confirmation window expires.
  // Sweeper picks rows where holdReleaseAt <= now() AND status = capture_pending
  // (and no open dispute) and fires the Stripe capture.
  holdReleaseAt: timestamp("hold_release_at", { withTimezone: true }),
  // Why capture is frozen ("dispute" | "manual_review"). NULL = not blocked.
  captureBlockedReason: text("capture_blocked_reason"),

  // Payout routing for shop-owned mechanics.
  //   "mechanic" — funds go to the mechanic's Connect account (default)
  //   "shop"     — funds go to the shop owner's Connect account
  //   "split"    — funds split: shopSplitPct goes to the shop, remainder to the mechanic
  payoutDestination: text("payout_destination", { enum: ["mechanic", "shop", "split"] }).notNull().default("mechanic"),
  shopId: integer("shop_id"),
  shopSplitPct: integer("shop_split_pct"),
  shopPayoutCents: integer("shop_payout_cents"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  releasedAt: timestamp("released_at", { withTimezone: true }),
}, (t) => [
  index("payments_job_id_idx").on(t.jobId),
  index("payments_provider_intent_idx").on(t.providerPaymentIntentId),
  index("payments_status_idx").on(t.status),
  index("payments_hold_release_idx").on(t.holdReleaseAt),
]);

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
