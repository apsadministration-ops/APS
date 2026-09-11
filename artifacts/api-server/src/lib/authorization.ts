import crypto from "crypto";

/**
 * Compare the one-time admin bootstrap key without ever accepting a built-in
 * development value. A missing/blank configured key is deliberately invalid.
 */
export function hasValidAdminSetupKey(
  suppliedKey: unknown,
  configuredKey: string | undefined = process.env.ADMIN_SETUP_KEY,
): boolean {
  if (typeof suppliedKey !== "string" || !configuredKey || configuredKey.trim().length === 0) {
    return false;
  }

  const supplied = Buffer.from(suppliedKey);
  const expected = Buffer.from(configuredKey);
  if (supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(supplied, expected);
}

export interface CaptureRetryAuthorization {
  role?: string;
  status?: string;
  userId?: number;
  assignedMechanicId?: number | null;
  jobStatus: string;
  paymentStatus?: string;
}

/**
 * A capture retry is a financial action. It is only available to an active
 * assigned mechanic after a failed capture, or to an active admin. In
 * particular, capture_pending is not retryable here: allowing it would let a
 * mechanic bypass the customer's confirmation window.
 */
export function canRetryCapture(input: CaptureRetryAuthorization): boolean {
  if (
    input.status !== "active"
    || input.jobStatus !== "COMPLETED"
    || input.paymentStatus !== "payout_failed"
  ) {
    return false;
  }
  if (input.role === "admin") return true;
  return input.role === "mechanic" && input.userId === input.assignedMechanicId;
}

export function canRespondToWorkConfirmation(input: {
  role?: string;
  userId?: number;
  customerId: number;
  confirmationStatus: string;
}): boolean {
  if (input.confirmationStatus !== "pending") return false;
  return input.role === "admin"
    || (["customer", "shop_owner"].includes(input.role ?? "") && input.userId === input.customerId);
}

export function canManagePayoutDestination(input: {
  role?: string;
  status?: string;
  userId?: number;
  customerId: number;
  ownsPostedShop: boolean;
}): boolean {
  if (input.role === "admin") return true;
  if (input.role !== "shop_owner" || input.status !== "active") return false;
  return input.userId === input.customerId || input.ownsPostedShop;
}

export function isRefundablePayment(input: {
  status: string;
  providerPaymentIntentId?: string | null;
}): boolean {
  return !!input.providerPaymentIntentId && ["authorized", "captured"].includes(input.status);
}

export function canResolveDispute(input: {
  role?: string;
  disputeStatus: string;
  kind: string;
  outcome: string;
}): boolean {
  if (input.role !== "admin" || !["open", "under_review"].includes(input.disputeStatus)) {
    return false;
  }
  return input.kind !== "stripe_chargeback" || input.outcome === "under_review";
}