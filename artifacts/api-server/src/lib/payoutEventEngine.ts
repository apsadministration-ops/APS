/**
 * Records Stripe transfer.* and payout.* webhook events into payout_events.
 * Idempotent via unique(provider_event_id) — duplicate Stripe retries do
 * NOT insert duplicate rows.
 */

import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, payoutEventsTable, paymentsTable, tipsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { notifyMechanicPayoutCompleted, notifyMechanicPayoutFailed } from "./notifications";

// Stripe does not emit a `transfer.failed` event today (transfers either
// succeed at create time or get reversed later). `handleTransferFailed`
// below is exported for future-proofing / manual invocation only.

type Kind =
  | "transfer_created" | "transfer_failed" | "transfer_reversed"
  | "payout_paid" | "payout_failed" | "payout_canceled" | "manual_retry";

interface RecordInput {
  kind: Kind;
  providerEventId?: string;
  providerTransferId?: string;
  providerPayoutId?: string;
  providerAccountId?: string | null;
  amountCents?: number;
  currency?: string;
  failureCode?: string | null;
  failureMessage?: string | null;
  arrivedAt?: Date | null;
  rawData?: unknown;
}

export async function recordPayoutEvent(input: RecordInput): Promise<void> {
  let mechanicId: number | null = null;
  let paymentId: number | null = null;
  let tipId: number | null = null;

  if (input.providerAccountId) {
    const [u] = await db.select({ id: usersTable.id }).from(usersTable)
      .where(eq(usersTable.stripeAccountId, input.providerAccountId));
    mechanicId = u?.id ?? null;
  }
  if (input.providerTransferId) {
    const [pmt] = await db.select({ id: paymentsTable.id }).from(paymentsTable)
      .where(eq(paymentsTable.providerTransferId, input.providerTransferId));
    paymentId = pmt?.id ?? null;
  }
  if (input.providerPayoutId && !paymentId) {
    const [pmt] = await db.select({ id: paymentsTable.id }).from(paymentsTable)
      .where(eq(paymentsTable.providerPayoutId, input.providerPayoutId));
    paymentId = pmt?.id ?? null;
    if (!paymentId) {
      const [t] = await db.select({ id: tipsTable.id }).from(tipsTable)
        .where(eq(tipsTable.providerPaymentIntentId, input.providerPayoutId));
      tipId = t?.id ?? null;
    }
  }

  try {
    await db.insert(payoutEventsTable).values({
      kind: input.kind,
      providerEventId: input.providerEventId ?? null,
      providerTransferId: input.providerTransferId ?? null,
      providerPayoutId: input.providerPayoutId ?? null,
      providerAccountId: input.providerAccountId ?? null,
      mechanicId, paymentId, tipId,
      amountCents: input.amountCents ?? null,
      currency: input.currency ?? null,
      failureCode: input.failureCode ?? null,
      failureMessage: input.failureMessage ?? null,
      arrivedAt: input.arrivedAt ?? null,
      rawData: input.rawData as Record<string, unknown> | null,
    }).onConflictDoNothing({ target: payoutEventsTable.providerEventId });
  } catch (err) {
    logger.error({ err, kind: input.kind }, "payout event insert failed");
    // The webhook's outer transaction cannot roll back this insert because
    // provider work is not wrapped in the same database transaction. Surface
    // the failure so the webhook returns 500 and Stripe retries instead of
    // acknowledging an event that is missing from the payout ledger.
    throw err;
  }
}

export async function handleTransferCreated(transfer: Stripe.Transfer, eventId: string): Promise<void> {
  const accountId = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id ?? null;
  await recordPayoutEvent({
    kind: "transfer_created",
    providerEventId: eventId,
    providerTransferId: transfer.id,
    providerAccountId: accountId,
    amountCents: transfer.amount,
    currency: transfer.currency,
    rawData: transfer,
  });
  // Stamp the payment with the transfer id for back-linking.
  if (transfer.source_transaction && typeof transfer.source_transaction === "string") {
    // source_transaction is the charge id; we can't link by intent here.
    // Skip — payment_intent.succeeded already linked the payment to its
    // intent and the destination matches mechanic.stripeAccountId.
  }
}

export async function handleTransferFailed(transfer: Stripe.Transfer, eventId: string): Promise<void> {
  const accountId = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id ?? null;
  await recordPayoutEvent({
    kind: "transfer_failed",
    providerEventId: eventId,
    providerTransferId: transfer.id,
    providerAccountId: accountId,
    amountCents: transfer.amount,
    currency: transfer.currency,
    rawData: transfer,
  });
  if (accountId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.stripeAccountId, accountId));
    if (u?.pushToken) void notifyMechanicPayoutFailed(u.pushToken, 0);
  }
}

export async function handleTransferReversed(transfer: Stripe.Transfer, eventId: string): Promise<void> {
  const accountId = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id ?? null;
  await recordPayoutEvent({
    kind: "transfer_reversed",
    providerEventId: eventId,
    providerTransferId: transfer.id,
    providerAccountId: accountId,
    amountCents: transfer.amount_reversed ?? transfer.amount,
    currency: transfer.currency,
    rawData: transfer,
  });
}

export async function handlePayoutEvent(
  payout: Stripe.Payout,
  kind: "payout_paid" | "payout_failed" | "payout_canceled",
  eventId: string,
  // Connect events arrive with the connected account id in event.account
  accountId: string | null,
): Promise<void> {
  await recordPayoutEvent({
    kind,
    providerEventId: eventId,
    providerPayoutId: payout.id,
    providerAccountId: accountId,
    amountCents: payout.amount,
    currency: payout.currency,
    failureCode: payout.failure_code ?? null,
    failureMessage: payout.failure_message ?? null,
    arrivedAt: kind === "payout_paid" ? new Date(payout.arrival_date * 1000) : null,
    rawData: payout,
  });
  if (!accountId) return;
  const [u] = await db.select().from(usersTable).where(eq(usersTable.stripeAccountId, accountId));
  if (!u?.pushToken) return;
  if (kind === "payout_paid") void notifyMechanicPayoutCompleted(u.pushToken, payout.amount / 100);
  if (kind === "payout_failed") void notifyMechanicPayoutFailed(u.pushToken, 0);
}
