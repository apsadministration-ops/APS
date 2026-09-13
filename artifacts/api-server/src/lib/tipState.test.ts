import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nextTipStatus,
  tipIdFromProviderMetadata,
  RETRYABLE_TIP_FAILURE_REASON,
} from "./tipState";

test("a failed payment can recover to captured on the same PaymentIntent", () => {
  const failed = nextTipStatus("pending", "payment_failed");
  assert.equal(failed, "failed");
  assert.equal(nextTipStatus(failed, "succeeded", "Payment failed"), "captured");
});

test("a refund is terminal and a late success cannot revive the tip", () => {
  assert.equal(nextTipStatus("pending", "refunded"), "refunded");
  assert.equal(nextTipStatus("failed", "refunded", RETRYABLE_TIP_FAILURE_REASON), "refunded");
  assert.equal(nextTipStatus("refunded", "succeeded"), null);
  assert.equal(nextTipStatus("refunded", "refunded"), null);
  assert.equal(nextTipStatus("failed", "refunded", "Payment canceled"), null);
  assert.equal(nextTipStatus("captured", "refunded"), "refunded");
});

test("repeated provider events have no second state transition", () => {
  assert.equal(nextTipStatus("captured", "succeeded"), null);
  assert.equal(nextTipStatus("failed", "payment_failed", "Payment failed"), null);
  assert.equal(nextTipStatus("failed", "payment_canceled", "Payment canceled"), null);
  assert.equal(nextTipStatus("failed", "payment_canceled", "Payment failed"), "failed");
  assert.equal(nextTipStatus("captured", "payment_failed"), null);
});

test("tip metadata fallback accepts only positive integer tip IDs", () => {
  assert.equal(tipIdFromProviderMetadata({ kind: "tip", tipId: "42" }), 42);
  assert.equal(tipIdFromProviderMetadata({ kind: "tip", tipId: "0" }), null);
  assert.equal(tipIdFromProviderMetadata({ kind: "payment", tipId: "42" }), null);
  assert.equal(tipIdFromProviderMetadata(undefined), null);
});

test("same-intent failed → refund → success stays refunded", () => {
  let status: "pending" | "captured" | "failed" | "refunded" = "pending";
  status = nextTipStatus(status, "payment_failed")!;
  status = nextTipStatus(status, "refunded", RETRYABLE_TIP_FAILURE_REASON)!;
  assert.equal(nextTipStatus(status, "succeeded"), null);
  assert.equal(status, "refunded");
});

test("replacement intent metadata composes failed → refund → late success", () => {
  const oldMetadata = { kind: "tip", tipId: "77" };
  const replacementMetadata = { kind: "tip", tipId: "77" };
  let status: "pending" | "captured" | "failed" | "refunded" = "pending";
  let linkedIntent = "pi_old";

  status = nextTipStatus(status, "payment_failed")!;
  assert.equal(tipIdFromProviderMetadata(oldMetadata), 77);
  linkedIntent = "pi_replacement";
  status = nextTipStatus(status, "refunded", RETRYABLE_TIP_FAILURE_REASON)!;
  assert.equal(tipIdFromProviderMetadata(replacementMetadata), 77);

  assert.equal(nextTipStatus(status, "succeeded"), null);
  assert.equal(linkedIntent, "pi_replacement");
  assert.equal(status, "refunded");
});