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

/**
 * A job reference on a report is evidence about a specific interaction.  Do
 * not let a reporter attach an unrelated job (or a job belonging to another
 * customer/mechanic) to a flag, since that both corrupts the moderation
 * record and can mislead downstream enforcement.
 *
 * Admins may file a report on behalf of the platform, but when they include a
 * job reference the target still has to be one of that job's participants.
 */
export function canCreateJobFlag(input: {
  role?: string;
  reporterId: number;
  targetId: number;
  job?: {
    customerId: number;
    mechanicId: number | null;
  } | null;
}): boolean {
  if (!input.job) return false;

  if (input.role === "admin") {
    return input.targetId === input.job.customerId
      || input.targetId === input.job.mechanicId;
  }

  if (input.role === "customer") {
    return input.reporterId === input.job.customerId
      && input.targetId === input.job.mechanicId;
  }

  if (input.role === "mechanic") {
    return input.reporterId === input.job.mechanicId
      && input.targetId === input.job.customerId;
  }

  return false;
}

/**
 * Booking cancellation is a state-changing operation.  A suspended or
 * pending mechanic/shop owner must not be able to cancel a booking merely
 * because their account still owns the historical row.
 */
export function canCancelBooking(input: {
  role?: string;
  status?: string;
  userId?: number;
  mechanicId: number;
  shopOwnerId?: number | null;
}): boolean {
  if (input.role === "admin") return true;
  if (input.status !== "active" || input.userId == null) return false;
  if (input.role === "mechanic") return input.userId === input.mechanicId;
  return input.role === "shop_owner" && input.userId === input.shopOwnerId;
}

/**
 * Customers can cancel their own pre-acceptance jobs.  A mechanic's
 * cancellation reopens dispatch and may void a payment authorization, so only
 * an active assigned mechanic may perform it.
 */
export function canCancelJob(input: {
  role?: string;
  status?: string;
  userId?: number;
  customerId: number;
  mechanicId: number | null;
  jobStatus: string;
}): boolean {
  if (input.role === "admin") return true;
  if (input.role === "customer") {
    return input.userId === input.customerId
      && ["REQUESTED", "OFFERED"].includes(input.jobStatus);
  }
  return input.role === "mechanic"
    && input.status === "active"
    && input.userId === input.mechanicId
    && ["ACCEPTED", "EN_ROUTE"].includes(input.jobStatus);
}
