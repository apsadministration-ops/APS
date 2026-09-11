import assert from "node:assert/strict";
import test from "node:test";
import { parsePositiveSafeInteger } from "./validation";

test("route ids reject undefined, NaN, zero, fractions, and unsafe integers", () => {
  for (const value of [
    undefined,
    "",
    "undefined",
    "NaN",
    "0",
    "-1",
    "1.5",
    "1e3",
    "0x10",
    String(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assert.equal(parsePositiveSafeInteger(value), null, String(value));
  }
  assert.equal(parsePositiveSafeInteger("1"), 1);
  assert.equal(parsePositiveSafeInteger(42), 42);
  assert.equal(parsePositiveSafeInteger([7]), 7);
});