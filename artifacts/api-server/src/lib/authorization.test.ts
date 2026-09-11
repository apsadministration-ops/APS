import test from "node:test";
import assert from "node:assert/strict";
import {
  canManagePayoutDestination,
  canResolveDispute,
  canRespondToWorkConfirmation,
  canRetryCapture,
  hasValidAdminSetupKey,
  isRefundablePayment,
} from "./authorization";

test("admin setup requires an explicitly configured key", () => {
  assert.equal(hasValidAdminSetupKey("aps-admin-setup", undefined), false);
  assert.equal(hasValidAdminSetupKey("aps-admin-setup", ""), false);
  assert.equal(hasValidAdminSetupKey("aps-admin-setup", "configured-test-key"), false);
  assert.equal(hasValidAdminSetupKey("configured-test-key", "configured-test-key"), true);
  assert.equal(hasValidAdminSetupKey("configured-test-key-extra", "configured-test-key"), false);
});

test("capture retry is limited to active assigned mechanics or active admins", () => {
  assert.equal(canRetryCapture({
    role: "mechanic",
    status: "active",
    userId: 7,
    assignedMechanicId: 7,
    jobStatus: "COMPLETED",
    paymentStatus: "payout_failed",
  }), true);
  assert.equal(canRetryCapture({
    role: "mechanic",
    status: "pending",
    userId: 7,
    assignedMechanicId: 7,
    jobStatus: "COMPLETED",
    paymentStatus: "payout_failed",
  }), false);
  assert.equal(canRetryCapture({
    role: "mechanic",
    status: "active",
    userId: 8,
    assignedMechanicId: 7,
    jobStatus: "COMPLETED",
    paymentStatus: "payout_failed",
  }), false);
  assert.equal(canRetryCapture({
    role: "mechanic",
    status: "active",
    userId: 7,
    assignedMechanicId: 7,
    jobStatus: "COMPLETED",
    paymentStatus: "capture_pending",
  }), false);
  assert.equal(canRetryCapture({
    role: "admin",
    status: "active",
    userId: 99,
    assignedMechanicId: 7,
    jobStatus: "COMPLETED",
    paymentStatus: "payout_failed",
  }), true);
  assert.equal(canRetryCapture({
    role: "customer",
    status: "active",
    userId: 7,
    assignedMechanicId: 7,
    jobStatus: "COMPLETED",
    paymentStatus: "payout_failed",
  }), false);
  assert.equal(canRetryCapture({
    role: "admin",
    status: "active",
    userId: 99,
    assignedMechanicId: 7,
    jobStatus: "PAID",
    paymentStatus: "payout_failed",
  }), false);
});

test("confirmation, refund, and dispute state gates fail closed", () => {
  assert.equal(canRespondToWorkConfirmation({
    role: "customer", userId: 7, customerId: 7, confirmationStatus: "pending",
  }), true);
  assert.equal(canRespondToWorkConfirmation({
    role: "mechanic", userId: 7, customerId: 7, confirmationStatus: "pending",
  }), false);
  assert.equal(canRespondToWorkConfirmation({
    role: "customer", userId: 7, customerId: 7, confirmationStatus: "confirmed",
  }), false);
  assert.equal(canRespondToWorkConfirmation({
    role: "shop_owner", userId: 7, customerId: 7, confirmationStatus: "pending",
  }), true);
  assert.equal(canRespondToWorkConfirmation({
    role: "shop_owner", userId: 8, customerId: 7, confirmationStatus: "pending",
  }), false);

  assert.equal(isRefundablePayment({
    status: "authorized", providerPaymentIntentId: "pi_fixture",
  }), true);
  assert.equal(isRefundablePayment({
    status: "disputed", providerPaymentIntentId: "pi_fixture",
  }), false);
  assert.equal(isRefundablePayment({
    status: "captured", providerPaymentIntentId: null,
  }), false);

  assert.equal(canResolveDispute({
    role: "admin", disputeStatus: "open", kind: "customer_filed", outcome: "resolved_mechanic",
  }), true);
  assert.equal(canResolveDispute({
    role: "customer", disputeStatus: "open", kind: "customer_filed", outcome: "resolved_mechanic",
  }), false);
  assert.equal(canResolveDispute({
    role: "admin", disputeStatus: "resolved_customer", kind: "customer_filed", outcome: "resolved_mechanic",
  }), false);
  assert.equal(canResolveDispute({
    role: "admin", disputeStatus: "open", kind: "stripe_chargeback", outcome: "resolved_mechanic",
  }), false);

  assert.equal(canManagePayoutDestination({
    role: "shop_owner", status: "active", userId: 7,
    customerId: 7, ownsPostedShop: false,
  }), true);
  assert.equal(canManagePayoutDestination({
    role: "shop_owner", status: "active", userId: 7,
    customerId: 8, ownsPostedShop: true,
  }), true);
  assert.equal(canManagePayoutDestination({
    role: "shop_owner", status: "active", userId: 7,
    customerId: 8, ownsPostedShop: false,
  }), false);
  assert.equal(canManagePayoutDestination({
    role: "admin", status: "pending", userId: 99,
    customerId: 8, ownsPostedShop: false,
  }), true);
});

test("fake Stripe calls are only reachable from authorized financial states", async () => {
  const calls: string[] = [];
  const fakeStripe = {
    paymentIntents: {
      capture: async () => { calls.push("capture"); },
      cancel: async () => { calls.push("cancel"); },
    },
    refunds: {
      create: async () => { calls.push("refund"); },
    },
  };

  if (canRetryCapture({
    role: "mechanic", status: "active", userId: 7,
    assignedMechanicId: 7, jobStatus: "COMPLETED", paymentStatus: "payout_failed",
  })) {
    await fakeStripe.paymentIntents.capture();
  }
  if (isRefundablePayment({ status: "disputed", providerPaymentIntentId: "pi_fixture" })) {
    await fakeStripe.refunds.create();
  }
  if (canResolveDispute({
    role: "admin", disputeStatus: "resolved_customer",
    kind: "customer_filed", outcome: "resolved_mechanic",
  })) {
    await fakeStripe.paymentIntents.capture();
  }

  assert.deepEqual(calls, ["capture"]);
});