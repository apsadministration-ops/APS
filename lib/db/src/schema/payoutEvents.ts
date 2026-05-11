import { pgTable, serial, integer, text, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";
import { paymentsTable } from "./payments";
import { tipsTable } from "./tips";
import { usersTable } from "./users";

/**
 * Append-only Stripe payout/transfer event log. Powers the mechanic payout
 * dashboard's live status timeline ("Initiated → Processing → Paid").
 *
 * Sourced from these Stripe webhooks:
 *   transfer.created           — money moved from platform to connected acct
 *   transfer.failed
 *   transfer.reversed
 *   payout.paid                — connected acct's bank received funds
 *   payout.failed
 *   payout.canceled
 *
 * Idempotent via (provider_event_id) unique — Stripe retries do not insert
 * duplicate rows.
 */
export const payoutEventsTable = pgTable("payout_events", {
  id: serial("id").primaryKey(),

  // Mechanic or shop owner whose Connect account this concerns.
  mechanicId: integer("mechanic_id").references(() => usersTable.id),
  // Associated payment (job-payout) or tip when discoverable.
  paymentId: integer("payment_id").references(() => paymentsTable.id, { onDelete: "set null" }),
  tipId: integer("tip_id").references(() => tipsTable.id, { onDelete: "set null" }),

  kind: text("kind", {
    enum: [
      "transfer_created", "transfer_failed", "transfer_reversed",
      "payout_paid", "payout_failed", "payout_canceled",
      "manual_retry",
    ],
  }).notNull(),

  // Stripe identifiers (opaque).
  providerEventId: text("provider_event_id"),
  providerTransferId: text("provider_transfer_id"),
  providerPayoutId: text("provider_payout_id"),
  // Stripe `acct_*` id of the connected account.
  providerAccountId: text("provider_account_id"),

  amountCents: integer("amount_cents"),
  currency: text("currency"),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  // For payout.paid — when the bank ACH actually settled.
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),

  // Raw Stripe object for audit.
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("payout_events_provider_event_uq").on(t.providerEventId),
  index("payout_events_mechanic_idx").on(t.mechanicId),
  index("payout_events_payment_idx").on(t.paymentId),
  index("payout_events_kind_idx").on(t.kind),
  index("payout_events_created_idx").on(t.createdAt),
]);

export type PayoutEvent = typeof payoutEventsTable.$inferSelect;
