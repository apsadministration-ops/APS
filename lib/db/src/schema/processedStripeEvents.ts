import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Hard idempotency for Stripe webhooks.
 *
 * Stripe guarantees AT-LEAST-ONCE delivery: the same event id can arrive
 * multiple times (network blip → retry, our 5xx → retry, etc.). Our domain
 * handlers are mostly idempotent on their own (status guards, unique
 * constraints), but a defence-in-depth dedup table is cheaper than chasing
 * subtle double-processing bugs (e.g. duplicate loyalty points, duplicate
 * payout_events rows). The webhook handler does an INSERT … ON CONFLICT DO
 * NOTHING; if the row already existed, we ack 200 and skip handler work.
 *
 * Retention is unbounded for now (a row is ~80 bytes; even at 1M
 * events/year that's <100 MB). Add a TTL sweep if it ever matters.
 */
export const processedStripeEventsTable = pgTable("processed_stripe_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
}, (t) => ({
  typeIdx: index("processed_stripe_events_type_idx").on(t.eventType),
  processedAtIdx: index("processed_stripe_events_processed_at_idx").on(t.processedAt),
}));
