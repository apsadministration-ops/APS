/**
 * Records Stripe transfer.* and payout.* webhook events into payout_events.
 * Idempotent via unique(provider_event_id) — duplicate Stripe retries do
 * NOT insert duplicate rows.
 */

import type Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import { db, payoutEventsTable, paymentsTable, tipsTable, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { notifyMechanicPayoutCompleted, notifyMechanicPayoutFailed } from "./notifications";
import {
  resolveConnectAccountOwner,
  type ConnectAccountOwnerResolution,
} from "./businessConnect";

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

export interface RecordedPayoutEventScope {
  resolution: ConnectAccountOwnerResolution;
  organizationId: number | null;
  mechanicId: number | null;
  paymentId: number | null;
  tipId: number | null;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Transfer objects only become payment-linked when their own metadata names a
 * payment row. Never select the first payment for an account or job: an
 * account-level transfer/payout can aggregate several payments.
 */
async function persistExplicitTransferLink(
  transfer: Stripe.Transfer,
  accountId: string | null,
): Promise<void> {
  if (!accountId) return;
  const paymentId = positiveInteger(
    transfer.metadata?.["paymentId"] ?? transfer.metadata?.["payment_id"],
  );
  if (paymentId === null) return;
  await db.update(paymentsTable)
    .set({ providerTransferId: transfer.id })
    .where(and(
      eq(paymentsTable.id, paymentId),
      eq(paymentsTable.payoutAccountId, accountId),
      isNull(paymentsTable.providerTransferId),
    ));
}

async function accountScopedPayment(
  column: any,
  providerId: string,
  accountId: string | null,
): Promise<{ id: number; payoutOrganizationId: number | null } | null> {
  if (!accountId) return null;
  const rows = await db.select({
    id: paymentsTable.id,
    payoutAccountId: paymentsTable.payoutAccountId,
    payoutOrganizationId: paymentsTable.payoutOrganizationId,
  }).from(paymentsTable).where(eq(column, providerId));
  const matches = rows.filter((row) => row.payoutAccountId === accountId);
  return matches.length === 1
    ? { id: matches[0].id, payoutOrganizationId: matches[0].payoutOrganizationId }
    : null;
}

export async function recordPayoutEvent(input: RecordInput): Promise<RecordedPayoutEventScope> {
  let mechanicId: number | null = null;
  let organizationId: number | null = null;
  let paymentId: number | null = null;
  let tipId: number | null = null;
  const resolution = input.providerAccountId
    ? await resolveConnectAccountOwner(db, input.providerAccountId)
    : { kind: "unknown" as const };

  if (resolution.kind === "mechanic") {
    mechanicId = resolution.id;
  } else if (resolution.kind === "organization") {
    organizationId = resolution.id;
  }

  const canCorrelatePayment = resolution.kind !== "collision";
  if (input.providerTransferId && canCorrelatePayment) {
    const payment = await accountScopedPayment(
      paymentsTable.providerTransferId,
      input.providerTransferId,
      input.providerAccountId ?? null,
    );
    paymentId = payment?.id ?? null;
    if (payment?.payoutOrganizationId !== null && payment) {
      if (organizationId !== null && payment.payoutOrganizationId !== organizationId) {
        paymentId = null;
      } else if (organizationId === null && resolution.kind === "unknown") {
        // An explicit transfer/payment/account snapshot is sufficient to
        // preserve an organization timeline even if its current row is gone.
        organizationId = payment.payoutOrganizationId;
      }
    }
  }
  if (input.providerPayoutId && !paymentId && canCorrelatePayment) {
    const payment = await accountScopedPayment(
      paymentsTable.providerPayoutId,
      input.providerPayoutId,
      input.providerAccountId ?? null,
    );
    paymentId = payment?.id ?? null;
    if (payment?.payoutOrganizationId !== null && payment) {
      if (organizationId !== null && payment.payoutOrganizationId !== organizationId) {
        paymentId = null;
      } else if (organizationId === null && resolution.kind === "unknown") {
        organizationId = payment.payoutOrganizationId;
      }
    }
    if (!paymentId) {
      const [t] = await db.select({ id: tipsTable.id }).from(tipsTable)
        .where(eq(tipsTable.providerPaymentIntentId, input.providerPayoutId));
      if (t && resolution.kind === "mechanic") tipId = t.id;
    }
  }

  try {
    await db.insert(payoutEventsTable).values({
      kind: input.kind,
      providerEventId: input.providerEventId ?? null,
      providerTransferId: input.providerTransferId ?? null,
      providerPayoutId: input.providerPayoutId ?? null,
      providerAccountId: input.providerAccountId ?? null,
      mechanicId,
      organizationId,
      paymentId,
      tipId,
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
  return { resolution, organizationId, mechanicId, paymentId, tipId };
}

export async function handleTransferCreated(transfer: Stripe.Transfer, eventId: string): Promise<void> {
  const accountId = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id ?? null;
  await persistExplicitTransferLink(transfer, accountId);
  await recordPayoutEvent({
    kind: "transfer_created",
    providerEventId: eventId,
    providerTransferId: transfer.id,
    providerAccountId: accountId,
    amountCents: transfer.amount,
    currency: transfer.currency,
    rawData: transfer,
  });
}

export async function handleTransferFailed(transfer: Stripe.Transfer, eventId: string): Promise<void> {
  const accountId = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id ?? null;
  await persistExplicitTransferLink(transfer, accountId);
  const recorded = await recordPayoutEvent({
    kind: "transfer_failed",
    providerEventId: eventId,
    providerTransferId: transfer.id,
    providerAccountId: accountId,
    amountCents: transfer.amount,
    currency: transfer.currency,
    rawData: transfer,
  });
  if (recorded.mechanicId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, recorded.mechanicId));
    if (u?.pushToken) void notifyMechanicPayoutFailed(u.pushToken, 0);
  }
}

export async function handleTransferReversed(transfer: Stripe.Transfer, eventId: string): Promise<void> {
  const accountId = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id ?? null;
  await persistExplicitTransferLink(transfer, accountId);
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
  const recorded = await recordPayoutEvent({
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
  if (!recorded.mechanicId) return;
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, recorded.mechanicId));
  if (!u?.pushToken) return;
  if (kind === "payout_paid") void notifyMechanicPayoutCompleted(u.pushToken, payout.amount / 100);
  if (kind === "payout_failed") void notifyMechanicPayoutFailed(u.pushToken, 0);
}