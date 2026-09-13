import assert from "node:assert/strict";
import test from "node:test";
import { registerBusinessSchema } from "./sharedRegistrationValidator";

function input(subtype: "shop" | "dealership" | "fleet") {
  return {
    business: {
      legalName: `Legal ${subtype}`,
      name: `Display ${subtype}`,
      subtype,
      email: `${subtype}@business.example`,
      phone: "+15550100000",
      address: "100 Main Street",
      city: "Brooklyn",
      region: "NY",
      zipCode: "11201",
      contactName: "Business Contact",
    },
    administrator: {
      name: "Primary Administrator",
      email: `${subtype}.admin@example.test`,
      phone: "+15550100001",
      password: "BusinessTest!2026",
    },
  };
}

test("accepts every supported business subtype", () => {
  for (const subtype of ["shop", "dealership", "fleet"] as const) {
    const parsed = registerBusinessSchema.safeParse(input(subtype));
    assert.equal(parsed.success, true);
  }
});

test("validates business and administrator independently", () => {
  const missingBusinessPhone = input("shop");
  delete (missingBusinessPhone.business as { phone?: string }).phone;
  assert.equal(registerBusinessSchema.safeParse(missingBusinessPhone).success, false);

  const missingAdministratorName = input("shop");
  delete (missingAdministratorName.administrator as { name?: string }).name;
  assert.equal(registerBusinessSchema.safeParse(missingAdministratorName).success, false);

  const noAdministratorPhone = input("shop");
  delete (noAdministratorPhone.administrator as { phone?: string }).phone;
  assert.equal(registerBusinessSchema.safeParse(noAdministratorPhone).success, true);
});

test("rejects caller-controlled ownership, role, Stripe, and extra fields", () => {
  const body = input("fleet") as Record<string, unknown>;
  body.role = "admin";
  assert.equal(registerBusinessSchema.safeParse(body).success, false);

  const withStripe = input("fleet");
  (withStripe.business as Record<string, unknown>).stripeAccountId = "acct_forbidden";
  assert.equal(registerBusinessSchema.safeParse(withStripe).success, false);

  const withOwner = input("fleet");
  (withOwner.business as Record<string, unknown>).primaryOwnerId = 123;
  assert.equal(registerBusinessSchema.safeParse(withOwner).success, false);
});