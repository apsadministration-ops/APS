/**
 * Tip state rules and the shared SQL guards used by webhook handling and
 * regression tests.
 *
 * A Stripe PaymentIntent may emit payment_failed while the customer is still
 * retrying another payment method on the same intent. `failed` is therefore
 * recoverable, except when the failure was caused by an explicit cancellation.
 */
import { and, eq, or, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm/column";

export type TipStatus = "pending" | "captured" | "failed" | "refunded";
export type TipProviderEvent = "payment_failed" | "payment_canceled" | "succeeded" | "refunded";
export const RETRYABLE_TIP_FAILURE_REASON = "Payment failed";

export function isRetryableTipFailure(
  status: TipStatus,
  failureReason?: string | null,
): boolean {
  return status === "failed" && failureReason === RETRYABLE_TIP_FAILURE_REASON;
}

/**
 * The atomic SQL guard used by charge.refunded. Keep this alongside the pure
 * transition rule so the runtime cannot accidentally omit recoverable failed
 * tips from the refund transition.
 */
export function tipRefundableWhere(columns: {
  status: AnyColumn;
  failureReason: AnyColumn;
}): SQL {
  const predicate = or(
    eq(columns.status, "pending"),
    eq(columns.status, "captured"),
    and(
      eq(columns.status, "failed"),
      eq(columns.failureReason, RETRYABLE_TIP_FAILURE_REASON),
    ),
  );
  if (!predicate) throw new Error("Tip refund predicate could not be constructed");
  return predicate;
}

export function nextTipStatus(
  current: TipStatus,
  event: TipProviderEvent,
  failureReason?: string | null,
): TipStatus | null {
  switch (event) {
    case "payment_failed":
      return current === "pending" ? "failed" : null;
    case "payment_canceled":
      return current === "pending"
        || (current === "failed" && failureReason === "Payment failed")
        ? "failed"
        : null;
    case "succeeded":
      return current === "pending"
        || (current === "failed" && failureReason !== "Payment canceled")
        ? "captured"
        : null;
    case "refunded":
      return current === "pending"
        || current === "captured"
        || isRetryableTipFailure(current, failureReason)
        ? "refunded"
        : null;
  }
}

export function tipIdFromProviderMetadata(
  metadata: Record<string, string> | null | undefined,
): number | null {
  if (metadata?.["kind"] !== "tip" || !metadata["tipId"]) return null;
  const tipId = Number(metadata["tipId"]);
  return Number.isInteger(tipId) && tipId > 0 ? tipId : null;
}