import assert from "node:assert/strict";
import test from "node:test";
import {
  businessConnectAccountCreateParams,
  hasAmbiguousLegacyConnectMapping,
  resolveConnectAccountOwner,
  resolveShopPayoutDestination,
  type SqlQueryRunner,
} from "./businessConnect";

function organizationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    primary_owner_id: 7,
    legal_name: "APS Fleet Holdings, LLC",
    name: "APS Fleet",
    email: "owner@aps.example",
    phone: "+1 555 0100",
    address: "1 Main Street",
    city: "Austin",
    region: "TX",
    zip_code: "78701",
    status: "active",
    stripe_account_id: "acct_org_42",
    stripe_account_ready: 1,
    ...overrides,
  };
}

class SequencedRunner implements SqlQueryRunner {
  constructor(private readonly responses: unknown[][]) {}

  async execute(): Promise<{ rows: unknown[] }> {
    return { rows: this.responses.shift() ?? [] };
  }
}

test("business account prefill uses legal/display identity and organization metadata", () => {
  const params = businessConnectAccountCreateParams({
    id: 42,
    primaryOwnerId: 7,
    name: "APS Fleet",
    legalName: "APS Fleet Holdings, LLC",
    email: "owner@aps.example",
    phone: "+1 555 0100",
    address: "1 Main Street",
    city: "Austin",
    region: "TX",
    zipCode: "78701",
    status: "active",
    stripeAccountId: null,
    stripeAccountReady: false,
  });
  assert.equal(params.type, "express");
  assert.equal(params.business_type, "company");
  assert.equal(params.company?.name, "APS Fleet Holdings, LLC");
  assert.equal(params.business_profile?.name, "APS Fleet");
  const metadata = params.metadata as Record<string, string>;
  assert.equal(metadata.organizationId, "42");
  assert.equal(metadata.kind, "partner_organization");
});

test("multiple historical account IDs require explicit mapping", () => {
  assert.equal(hasAmbiguousLegacyConnectMapping(["acct_old_user", "acct_old_shop"]), true);
  assert.equal(hasAmbiguousLegacyConnectMapping(["acct_same", "acct_same"]), false);
  assert.equal(hasAmbiguousLegacyConnectMapping(["acct_only"]), false);
});

test("linked location resolves only its exact ready organization account", async () => {
  const runner = new SequencedRunner([[organizationRow()], [{ id: 42 }], [], []]);
  const result = await resolveShopPayoutDestination(
    runner,
    {
      id: 1701,
      ownerId: 7,
      organizationId: 42,
      stripeAccountId: "acct_legacy_should_not_win",
      stripeAccountReady: 1,
      status: "active",
    },
    { sourceOrganizationId: 42 },
  );
  assert.deepEqual(result, {
    accountId: "acct_org_42",
    organizationId: 42,
    source: "organization",
  });
});

test("linked location rejects a job from another organization", async () => {
  await assert.rejects(
    resolveShopPayoutDestination(
      new SequencedRunner([]),
      {
        id: 1702,
        ownerId: 7,
        organizationId: 42,
        stripeAccountId: null,
        stripeAccountReady: 0,
        status: "active",
      },
      { sourceOrganizationId: 99 },
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "shop_organization_mismatch",
  );
});

test("unlinked valid legacy destination is preserved", async () => {
  const result = await resolveShopPayoutDestination(
    new SequencedRunner([[], [], [{ id: 1703, organization_id: null }]]),
    {
      id: 1703,
      ownerId: 7,
      organizationId: null,
      stripeAccountId: "acct_legacy_17",
      stripeAccountReady: 1,
      status: "active",
    },
    { sourceOrganizationId: null },
  );
  assert.deepEqual(result, {
    accountId: "acct_legacy_17",
    organizationId: null,
    source: "legacy_shop",
  });
});

test("checkout destination rejects an ambiguous canonical account", async () => {
  await assert.rejects(
    resolveShopPayoutDestination(
      new SequencedRunner([
        [organizationRow()],
        [{ id: 7, role: "shop_owner" }],
        [],
      ]),
      {
        id: 1704,
        ownerId: 7,
        organizationId: 42,
        stripeAccountId: null,
        stripeAccountReady: 0,
        status: "active",
      },
      { sourceOrganizationId: 42 },
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "payout_destination_ownership_collision",
  );
});

test("account.updated fails closed on cross-table organization collisions", async () => {
  const result = await resolveConnectAccountOwner(
    new SequencedRunner([
      [organizationRow()],
      [{ id: 7, role: "mechanic" }],
      [],
    ]),
    "acct_org_42",
  );
  assert.deepEqual(result, {
    kind: "collision",
    reason: "cross_table_account_collision",
  });
});

test("account.updated fails closed when multiple organizations share an account", async () => {
  const result = await resolveConnectAccountOwner(
    new SequencedRunner([
      [{ id: 42 }, { id: 43 }],
      [],
      [],
    ]),
    "acct_duplicate",
  );
  assert.deepEqual(result, {
    kind: "collision",
    reason: "duplicate_organization_account",
  });
});

test("account.updated maps only one deliberate legacy shop", async () => {
  const result = await resolveConnectAccountOwner(
    new SequencedRunner([
      [],
      [],
      [{ id: 17, organization_id: null }],
    ]),
    "acct_legacy_17",
  );
  assert.deepEqual(result, { kind: "legacy_shop", id: 17 });
});

test("account.updated rejects linked shop legacy mappings", async () => {
  const result = await resolveConnectAccountOwner(
    new SequencedRunner([
      [],
      [],
      [{ id: 17, organization_id: 42 }],
    ]),
    "acct_old_linked",
  );
  assert.deepEqual(result, {
    kind: "collision",
    reason: "linked_shop_legacy_account",
  });
});
