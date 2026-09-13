import test from "node:test";
import assert from "node:assert/strict";
import { formatPublicMechanicProfile } from "./userProfile";

test("public mechanic profile formatter excludes contact and account-sensitive fields", () => {
  const profile = formatPublicMechanicProfile({
    id: 11,
    name: "Mechanic",
    role: "mechanic",
    avatarUrl: null,
    mechanicTier: "technician",
    certifications: "[\"ASE\"]",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.deepEqual(profile, {
    id: 11,
    name: "Mechanic",
    role: "mechanic",
    avatarUrl: null,
    mechanicTier: "technician",
    certifications: "[\"ASE\"]",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal("email" in profile, false);
  assert.equal("phone" in profile, false);
  assert.equal("referralCode" in profile, false);
  assert.equal("loyaltyPoints" in profile, false);
  assert.equal("mechanicPoints" in profile, false);
  assert.equal("status" in profile, false);
});