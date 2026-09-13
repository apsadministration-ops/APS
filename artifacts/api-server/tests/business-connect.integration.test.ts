/**
 * Opt-in development-DB business Connect ownership coverage.
 *
 * This suite never contacts Stripe. It uses an in-memory provider double while
 * exercising the real development database, real ownership queries, and real
 * transaction/update paths:
 *
 *   RUN_BUSINESS_CONNECT_INTEGRATION=1 \
 *     pnpm --filter @workspace/api-server run test:business-connect-integration
 *
 * The fixture is always deleted in dependency order. Do not point this suite
 * at production.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq, inArray } from "drizzle-orm";

const enabled =
  process.env.RUN_BUSINESS_CONNECT_INTEGRATION === "1" &&
  process.env.NODE_ENV !== "production" &&
  Boolean(process.env.DATABASE_URL);

type Fixture = {
  db?: any;
  tables?: any;
  users: number[];
  organizations: number[];
  shops: number[];
  vehicles: number[];
  jobs: number[];
  payments: number[];
  payoutEvents: number[];
  businessConnect?: typeof import("../src/lib/businessConnect");
  server?: any;
  baseUrl?: string;
};

const fixture: Fixture = {
  users: [],
  organizations: [],
  shops: [],
  vehicles: [],
  jobs: [],
  payments: [],
  payoutEvents: [],
};

let vehicleSequence = 0;

function suffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createUser(role: "shop_owner" | "customer" | "mechanic", label: string) {
  const [user] = await fixture.db.db.insert(fixture.db.usersTable).values({
    name: `${label} User`,
    email: `${label.toLowerCase()}-${suffix()}@example.test`,
    phone: "+15550101010",
    passwordHash: "integration-fixture-not-a-login-password",
    role,
    status: "active",
    address: "1 Fixture Street",
    city: "Austin",
    region: "TX",
    zipCode: "78701",
  }).returning();
  assert.ok(user);
  fixture.users.push(user.id);
  return user;
}

async function createOrganization(ownerId: number, label: string) {
  const [organization] = await fixture.db.db.insert(fixture.db.partnerOrganizationsTable).values({
    primaryOwnerId: ownerId,
    legalName: `${label} Legal LLC`,
    name: `${label} Display`,
    subtype: "fleet",
    phone: "+15550101011",
    email: `${label.toLowerCase()}-${suffix()}@example.test`,
    address: "2 Organization Avenue",
    city: "Austin",
    region: "TX",
    zipCode: "78702",
    status: "active",
    stripeAccountId: null,
    stripeAccountReady: 0,
  }).returning();
  assert.ok(organization);
  fixture.organizations.push(organization.id);
  return organization;
}

async function createShop(
  ownerId: number,
  organizationId: number | null,
  accountId: string | null,
  ready: number,
  label: string,
) {
  const [shop] = await fixture.db.db.insert(fixture.db.shopsTable).values({
    ownerId,
    organizationId,
    partnerKind: "fleet",
    name: `${label} Location`,
    address: "3 Location Road",
    city: "Austin",
    region: "TX",
    zipCode: "78703",
    phone: "+15550101012",
    status: "active",
    stripeAccountId: accountId,
    stripeAccountReady: ready,
  }).returning();
  assert.ok(shop);
  fixture.shops.push(shop.id);
  return shop;
}

async function createPaymentSnapshot(
  customerId: number,
  shopId: number,
  organizationId: number | null,
) {
  vehicleSequence += 1;
  const [vehicle] = await fixture.db.db.insert(fixture.db.vehiclesTable).values({
    vin: `1FIXTURE${String(Date.now()).slice(-7)}${vehicleSequence}`,
    make: "Fixture",
    model: "Connect",
    year: 2026,
    mileage: 1,
  }).returning();
  assert.ok(vehicle);
  fixture.vehicles.push(vehicle.id);

  const [job] = await fixture.db.db.insert(fixture.db.jobsTable).values({
    vehicleId: vehicle.id,
    vin: vehicle.vin,
    customerId,
    jobType: "repair",
    description: "Connect ownership fixture",
    status: "ACCEPTED",
    estimatedPrice: 100,
    sourceOrganizationId: organizationId,
    postedByShopId: shopId,
  }).returning();
  assert.ok(job);
  fixture.jobs.push(job.id);

  const [payment] = await fixture.db.db.insert(fixture.db.paymentsTable).values({
    jobId: job.id,
    amount: 100,
    platformFee: 10,
    mechanicPayout: 90,
    status: "pending",
    payoutDestination: "shop",
    shopId,
    shopSplitPct: null,
  }).returning();
  assert.ok(payment);
  fixture.payments.push(payment.id);
  return { job, payment };
}

async function createCheckoutJob(customerId: number, mechanicId: number) {
  vehicleSequence += 1;
  const [vehicle] = await fixture.db.db.insert(fixture.db.vehiclesTable).values({
    vin: `1CHECKOUT${String(Date.now()).slice(-6)}${vehicleSequence}`,
    make: "Fixture",
    model: "Retry",
    year: 2026,
    mileage: 1,
  }).returning();
  assert.ok(vehicle);
  fixture.vehicles.push(vehicle.id);
  const [job] = await fixture.db.db.insert(fixture.db.jobsTable).values({
    vehicleId: vehicle.id,
    vin: vehicle.vin,
    customerId,
    mechanicId,
    jobType: "repair",
    description: "Checkout retry fixture",
    status: "ACCEPTED",
    estimatedPrice: 100,
  }).returning();
  assert.ok(job);
  fixture.jobs.push(job.id);
  return job;
}

function mockedStripe() {
  const calls: {
    creates: Array<{ params: unknown; idempotencyKey?: string }>;
    retrieves: string[];
    loginLinks: string[];
    accountLinks: string[];
    customerCreates: number;
    checkoutCreates: Array<{ id: string; params: any }>;
    expiredSessions: string[];
    canceledIntents: string[];
  } = {
    creates: [],
    retrieves: [],
    loginLinks: [],
    accountLinks: [],
    customerCreates: 0,
    checkoutCreates: [],
    expiredSessions: [],
    canceledIntents: [],
  };
  let next = 0;
  const accounts = {
    create: async (params: unknown, options?: { idempotencyKey?: string }) => {
      calls.creates.push({ params, idempotencyKey: options?.idempotencyKey });
      next += 1;
      return { id: `acct_mock_${next}` };
    },
    retrieve: async (accountId: string) => {
      calls.retrieves.push(accountId);
      return {
        id: accountId,
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      };
    },
    createLoginLink: async (accountId: string) => {
      calls.loginLinks.push(accountId);
      return { url: `https://provider.test/login/${accountId}` };
    },
  };
  const accountLinks = {
    create: async (params: { account: string }) => {
      calls.accountLinks.push(params.account);
      return { url: `https://provider.test/onboard/${params.account}` };
    },
  };
  const customers = {
    create: async () => {
      calls.customerCreates += 1;
      return { id: `cus_mock_${calls.customerCreates}` };
    },
  };
  const checkout = {
    sessions: {
      create: async (params: any) => {
        const id = `cs_checkout_${calls.checkoutCreates.length + 1}`;
        calls.checkoutCreates.push({ id, params });
        return { id, url: `https://provider.test/checkout/${id}` };
      },
      expire: async (id: string) => {
        calls.expiredSessions.push(id);
        return { id, status: "expired" };
      },
    },
  };
  const paymentIntents = {
    cancel: async (id: string) => {
      calls.canceledIntents.push(id);
      return { id, status: "canceled" };
    },
  };
  return { stripe: { accounts, accountLinks, customers, checkout, paymentIntents } as any, calls };
}

before(async () => {
  if (!enabled) return;
  const database = await import("@workspace/db");
  fixture.db = { db: database.db, ...database };
  fixture.tables = database;
  fixture.businessConnect = await import("../src/lib/businessConnect");
});

after(async () => {
  if (!enabled || !fixture.db) return;
  const db = fixture.db.db;
  if (fixture.payoutEvents.length) {
    await db.delete(fixture.db.payoutEventsTable)
      .where(inArray(fixture.db.payoutEventsTable.id, fixture.payoutEvents));
  }
  if (fixture.payments.length) {
    await db.delete(fixture.db.paymentsTable)
      .where(inArray(fixture.db.paymentsTable.id, fixture.payments));
  }
  if (fixture.jobs.length) {
    await db.delete(fixture.db.jobsTable)
      .where(inArray(fixture.db.jobsTable.id, fixture.jobs));
  }
  if (fixture.vehicles.length) {
    await db.delete(fixture.db.vehiclesTable)
      .where(inArray(fixture.db.vehiclesTable.id, fixture.vehicles));
  }
  if (fixture.shops.length) {
    await db.delete(fixture.db.shopsTable)
      .where(inArray(fixture.db.shopsTable.id, fixture.shops));
  }
  if (fixture.organizations.length) {
    await db.delete(fixture.db.partnerOrganizationsTable)
      .where(inArray(fixture.db.partnerOrganizationsTable.id, fixture.organizations));
  }
  if (fixture.users.length) {
    await db.delete(fixture.db.usersTable)
      .where(inArray(fixture.db.usersTable.id, fixture.users));
  }
  fixture.server?.closeAllConnections?.();
  if (fixture.server) {
    await new Promise<void>((resolve) => fixture.server.close(resolve));
  }
  const stripeClient = await import("../src/lib/stripeClient");
  stripeClient.setStripeClientForTests(null);
});

test("scoped DB + mocked provider enforce business Connect ownership", async (t) => {
  if (!enabled) {
    t.skip("set RUN_BUSINESS_CONNECT_INTEGRATION=1 with a development DATABASE_URL");
    return;
  }
  assert.ok(fixture.db);
  assert.ok(fixture.businessConnect);
  const database = fixture.db;
  const businessConnect = fixture.businessConnect;
  const provider = mockedStripe();
  const [
    { default: payoutsRouter },
    { default: paymentsRouter },
    { default: express },
    { signToken },
    stripeClient,
  ] = await Promise.all([
    import("../src/routes/payouts"),
    import("../src/routes/payments"),
    import("express"),
    import("../src/lib/auth"),
    import("../src/lib/stripeClient"),
  ]);
  stripeClient.setStripeClientForTests(provider.stripe);
  const { handleTransferCreated, recordPayoutEvent } = await import("../src/lib/payoutEventEngine");
  const app = express();
  app.use(express.json());
  app.use(paymentsRouter);
  app.use(payoutsRouter);
  fixture.server = await new Promise<any>((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
  const address = fixture.server.address();
  assert.ok(address && typeof address === "object");
  fixture.baseUrl = `http://127.0.0.1:${address.port}`;

  const primaryOwner = await createUser("shop_owner", "PrimaryOwner");
  const otherOwner = await createUser("shop_owner", "OtherOwner");
  const customer = await createUser("customer", "Customer");
  const mechanic = await createUser("mechanic", "Mechanic");
  await database.db.update(database.usersTable).set({
    stripeAccountId: "acct_mechanic_original",
    stripeAccountReady: true,
  }).where(eq(database.usersTable.id, mechanic.id));

  const organization = await createOrganization(primaryOwner.id, "Primary");
  const secondOrganization = await createOrganization(primaryOwner.id, "Second");
  const otherOrganization = await createOrganization(otherOwner.id, "Other");

  // Primary ownership is explicit: another organization owner cannot start
  // onboarding for this organization and Stripe is never contacted.
  await assert.rejects(
    businessConnect.beginBusinessOnboarding({
      organizationId: organization.id,
      ownerId: otherOwner.id,
      stripe: provider.stripe,
      baseUrl: "https://aps.test",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "organization_not_found",
  );
  assert.equal(provider.calls.creates.length, 0);

  const firstOnboarding = await businessConnect.beginBusinessOnboarding({
    organizationId: organization.id,
    ownerId: primaryOwner.id,
    stripe: provider.stripe,
    baseUrl: "https://aps.test",
  });
  const secondOnboarding = await businessConnect.beginBusinessOnboarding({
    organizationId: secondOrganization.id,
    ownerId: primaryOwner.id,
    stripe: provider.stripe,
    baseUrl: "https://aps.test",
  });
  assert.notEqual(firstOnboarding.accountId, secondOnboarding.accountId);
  assert.equal(provider.calls.creates.length, 2);
  assert.equal(
    provider.calls.creates[0]?.idempotencyKey,
    `business-connect:organization:${organization.id}:account`,
  );
  assert.equal((provider.calls.creates[0]?.params as any).metadata.organizationId, String(organization.id));
  const onboardingOrganization = await database.db.select({
    stripeAccountId: database.partnerOrganizationsTable.stripeAccountId,
    stripeAccountType: database.partnerOrganizationsTable.stripeAccountType,
  }).from(database.partnerOrganizationsTable)
    .where(eq(database.partnerOrganizationsTable.id, organization.id));
  assert.deepEqual(onboardingOrganization, [{
    stripeAccountId: firstOnboarding.accountId,
    stripeAccountType: "company",
  }]);

  // Abandoned/cancelled checkout retries the same canonical payment row,
  // expires the old session, and keeps its exact account snapshot even if the
  // mechanic's current Connect mapping changes.
  const retryJob = await createCheckoutJob(primaryOwner.id, mechanic.id);
  const customerToken = signToken({ userId: primaryOwner.id, role: "shop_owner" });
  const checkout = async () => fetch(
    `${fixture.baseUrl}/payments/jobs/${retryJob.id}/checkout`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${customerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );
  const initialCheckout = await checkout();
  assert.equal(initialCheckout.status, 200);
  const initialPaymentRows = await database.db.select({
    id: database.paymentsTable.id,
    providerSessionId: database.paymentsTable.providerSessionId,
    payoutAccountId: database.paymentsTable.payoutAccountId,
    payoutOrganizationId: database.paymentsTable.payoutOrganizationId,
  }).from(database.paymentsTable)
    .where(eq(database.paymentsTable.jobId, retryJob.id));
  assert.equal(initialPaymentRows.length, 1);
  const initialPayment = initialPaymentRows[0]!;
  fixture.payments.push(initialPayment.id);
  assert.equal(initialPayment.payoutAccountId, "acct_mechanic_original");
  assert.equal(initialPayment.payoutOrganizationId, null);
  await database.db.update(database.paymentsTable).set({ status: "canceled" })
    .where(eq(database.paymentsTable.id, initialPayment.id));

  const retryCheckout = await checkout();
  assert.equal(retryCheckout.status, 200);
  const retriedPaymentRows = await database.db.select({
    id: database.paymentsTable.id,
    providerSessionId: database.paymentsTable.providerSessionId,
    payoutAccountId: database.paymentsTable.payoutAccountId,
  }).from(database.paymentsTable)
    .where(eq(database.paymentsTable.jobId, retryJob.id));
  assert.deepEqual(retriedPaymentRows, [{
    id: initialPayment.id,
    providerSessionId: "cs_checkout_2",
    payoutAccountId: "acct_mechanic_original",
  }]);
  assert.deepEqual(provider.calls.expiredSessions, ["cs_checkout_1"]);

  await database.db.update(database.usersTable).set({
    stripeAccountId: "acct_mechanic_changed",
  }).where(eq(database.usersTable.id, mechanic.id));
  await database.db.update(database.paymentsTable).set({ status: "canceled" })
    .where(eq(database.paymentsTable.id, initialPayment.id));
  const mappingChangedRetry = await checkout();
  assert.equal(mappingChangedRetry.status, 200);
  assert.equal(provider.calls.checkoutCreates.at(-1)?.params.payment_intent_data.transfer_data.destination, "acct_mechanic_original");
  assert.deepEqual(provider.calls.expiredSessions, ["cs_checkout_1", "cs_checkout_2"]);

  await database.db.update(database.paymentsTable).set({ status: "captured" })
    .where(eq(database.paymentsTable.id, initialPayment.id));
  const paidRetry = await checkout();
  assert.equal(paidRetry.status, 409);
  assert.equal(provider.calls.checkoutCreates.length, 3);

  const legacyRetryJob = await createCheckoutJob(primaryOwner.id, mechanic.id);
  const [legacyProviderPayment] = await database.db.insert(database.paymentsTable).values({
    jobId: legacyRetryJob.id,
    amount: 100,
    platformFee: 10,
    mechanicPayout: 90,
    status: "canceled",
    providerSessionId: "cs_legacy_without_snapshot",
  }).returning();
  assert.ok(legacyProviderPayment);
  fixture.payments.push(legacyProviderPayment.id);
  const blockedLegacyRetry = await fetch(
    `${fixture.baseUrl}/payments/jobs/${legacyRetryJob.id}/checkout`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${customerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );
  assert.equal(blockedLegacyRetry.status, 409);
  assert.equal((await blockedLegacyRetry.json()).code, "legacy_payout_snapshot_required");
  assert.equal(provider.calls.checkoutCreates.length, 3);

  const ambiguousJob = await createCheckoutJob(primaryOwner.id, mechanic.id);
  const ambiguousRows = await database.db.insert(database.paymentsTable).values([
    {
      jobId: ambiguousJob.id,
      amount: 100,
      platformFee: 10,
      mechanicPayout: 90,
      status: "failed",
    },
    {
      jobId: ambiguousJob.id,
      amount: 100,
      platformFee: 10,
      mechanicPayout: 90,
      status: "canceled",
    },
  ]).returning();
  fixture.payments.push(...ambiguousRows.map((row) => row.id));
  const ambiguousCheckout = await fetch(
    `${fixture.baseUrl}/payments/jobs/${ambiguousJob.id}/checkout`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${customerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );
  assert.equal(ambiguousCheckout.status, 409);
  assert.equal((await ambiguousCheckout.json()).code, "payment_mapping_ambiguous");
  assert.equal(provider.calls.checkoutCreates.length, 3);
  const preservedAmbiguousRows = await database.db.select({ id: database.paymentsTable.id })
    .from(database.paymentsTable).where(eq(database.paymentsTable.jobId, ambiguousJob.id));
  assert.deepEqual(
    preservedAmbiguousRows.map((row) => row.id),
    ambiguousRows.map((row) => row.id),
  );

  // Status and dashboard login are provider-doubled and update/read only the
  // canonical organization row.
  const status = await businessConnect.getBusinessPayoutStatus({
    organizationId: organization.id,
    ownerId: primaryOwner.id,
    stripe: provider.stripe,
  });
  assert.equal(status.ready, true);
  assert.equal(provider.calls.retrieves.at(-1), firstOnboarding.accountId);
  const login = await businessConnect.createBusinessLoginLink({
    organizationId: organization.id,
    ownerId: primaryOwner.id,
    stripe: provider.stripe,
  });
  assert.equal(login.accountId, firstOnboarding.accountId);
  assert.equal(provider.calls.loginLinks.at(-1), firstOnboarding.accountId);

  const firstShop = await createShop(primaryOwner.id, organization.id, null, 0, "First");
  const secondShop = await createShop(primaryOwner.id, organization.id, null, 0, "Second");
  await database.db.update(database.partnerOrganizationsTable)
    .set({ stripeAccountReady: 1 })
    .where(eq(database.partnerOrganizationsTable.id, organization.id));
  const firstDestination = await businessConnect.resolveShopPayoutDestination(
    database.db,
    firstShop,
    { sourceOrganizationId: organization.id },
  );
  const secondDestination = await businessConnect.resolveShopPayoutDestination(
    database.db,
    secondShop,
    { sourceOrganizationId: organization.id },
  );
  assert.equal(firstDestination.accountId, firstOnboarding.accountId);
  assert.equal(secondDestination.accountId, firstOnboarding.accountId);

  // A customer/job cannot select another organization's destination merely by
  // presenting that organization's source ID.
  await assert.rejects(
    businessConnect.resolveShopPayoutDestination(
      database.db,
      firstShop,
      { sourceOrganizationId: otherOrganization.id },
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "shop_organization_mismatch",
  );

  const legacyShop = await createShop(
    primaryOwner.id,
    null,
    "acct_legacy_preserve",
    1,
    "Legacy",
  );
  const legacyDestination = await businessConnect.resolveShopPayoutDestination(
    database.db,
    legacyShop,
    { sourceOrganizationId: null },
  );
  assert.deepEqual(legacyDestination, {
    accountId: "acct_legacy_preserve",
    organizationId: null,
    source: "legacy_shop",
  });

  // Two locations use the same canonical account; an existing payment
  // destination snapshot is read-only and remains unchanged.
  const snapshot = await createPaymentSnapshot(customer.id, firstShop.id, organization.id);
  const before = await database.db.select({
    payoutDestination: database.paymentsTable.payoutDestination,
    shopId: database.paymentsTable.shopId,
  }).from(database.paymentsTable).where(eq(database.paymentsTable.id, snapshot.payment.id));
  await businessConnect.resolveShopPayoutDestination(
    database.db,
    firstShop,
    { sourceOrganizationId: organization.id },
  );
  const after = await database.db.select({
    payoutDestination: database.paymentsTable.payoutDestination,
    shopId: database.paymentsTable.shopId,
  }).from(database.paymentsTable).where(eq(database.paymentsTable.id, snapshot.payment.id));
  assert.deepEqual(after, before);

  // Payout events use the immutable payment account/org snapshot when an
  // explicit provider payout linkage exists. Account-level events without
  // that linkage remain organization-scoped but do not invent a payment.
  await database.db.update(database.paymentsTable).set({
    payoutOrganizationId: organization.id,
    payoutAccountId: firstOnboarding.accountId,
    providerPayoutId: "po_org_snapshot",
  }).where(eq(database.paymentsTable.id, snapshot.payment.id));
  const linkedEvent = await recordPayoutEvent({
    kind: "payout_paid",
    providerEventId: "evt_org_snapshot",
    providerPayoutId: "po_org_snapshot",
    providerAccountId: firstOnboarding.accountId,
    amountCents: 10000,
    currency: "usd",
  });
  assert.equal(linkedEvent.organizationId, organization.id);
  assert.equal(linkedEvent.paymentId, snapshot.payment.id);
  const linkedEventRow = await database.db.select({ id: database.payoutEventsTable.id })
    .from(database.payoutEventsTable)
    .where(eq(database.payoutEventsTable.providerEventId, "evt_org_snapshot"));
  assert.equal(linkedEventRow.length, 1);
  fixture.payoutEvents.push(linkedEventRow[0]!.id);
  await handleTransferCreated({
    id: "tr_org_snapshot",
    destination: firstOnboarding.accountId,
    amount: 10000,
    currency: "usd",
    metadata: { paymentId: String(snapshot.payment.id) },
  } as any, "evt_transfer_org_snapshot");
  const transferSnapshot = await database.db.select({
    providerTransferId: database.paymentsTable.providerTransferId,
  }).from(database.paymentsTable)
    .where(eq(database.paymentsTable.id, snapshot.payment.id));
  assert.equal(transferSnapshot[0]?.providerTransferId, "tr_org_snapshot");
  const transferEventRow = await database.db.select({ id: database.payoutEventsTable.id })
    .from(database.payoutEventsTable)
    .where(eq(database.payoutEventsTable.providerEventId, "evt_transfer_org_snapshot"));
  fixture.payoutEvents.push(transferEventRow[0]!.id);

  // account.updated resolves the canonical organization while its account
  // mapping is current and updates only that organization's readiness.
  const resolution = await businessConnect.syncConnectAccountReadiness(
    firstOnboarding.accountId,
    true,
  );
  assert.deepEqual(resolution, { kind: "organization", id: organization.id });
  const readyRow = await database.db.select({
    stripeAccountReady: database.partnerOrganizationsTable.stripeAccountReady,
  }).from(database.partnerOrganizationsTable)
    .where(eq(database.partnerOrganizationsTable.id, organization.id));
  assert.equal(readyRow[0]?.stripeAccountReady, 1);

  // Reassigning the current organization account never rewrites this old
  // payment snapshot. Its old provider event can still be correlated by the
  // immutable payment fields; a different organization's account cannot
  // claim that payment merely by sharing a payout amount/ID.
  await database.db.update(database.partnerOrganizationsTable).set({
    stripeAccountId: "acct_mock_reassigned",
    stripeAccountReady: 1,
    stripeAccountType: "company",
  }).where(eq(database.partnerOrganizationsTable.id, organization.id));
  const unchangedPayment = await database.db.select({
    payoutOrganizationId: database.paymentsTable.payoutOrganizationId,
    payoutAccountId: database.paymentsTable.payoutAccountId,
    providerPayoutId: database.paymentsTable.providerPayoutId,
  }).from(database.paymentsTable)
    .where(eq(database.paymentsTable.id, snapshot.payment.id));
  assert.deepEqual(unchangedPayment, [{
    payoutOrganizationId: organization.id,
    payoutAccountId: firstOnboarding.accountId,
    providerPayoutId: "po_org_snapshot",
  }]);
  const oldAccountEvent = await recordPayoutEvent({
    kind: "payout_paid",
    providerEventId: "evt_org_old_account",
    providerPayoutId: "po_org_snapshot",
    providerAccountId: firstOnboarding.accountId,
    amountCents: 10000,
    currency: "usd",
  });
  assert.equal(oldAccountEvent.organizationId, organization.id);
  assert.equal(oldAccountEvent.paymentId, snapshot.payment.id);
  const otherAccountEvent = await recordPayoutEvent({
    kind: "payout_paid",
    providerEventId: "evt_other_org_account",
    providerPayoutId: "po_org_snapshot",
    providerAccountId: secondOnboarding.accountId,
    amountCents: 10000,
    currency: "usd",
  });
  assert.equal(otherAccountEvent.organizationId, secondOrganization.id);
  assert.equal(otherAccountEvent.paymentId, null);
  const oldEventRows = await database.db.select({ id: database.payoutEventsTable.id })
    .from(database.payoutEventsTable).where(
      eq(database.payoutEventsTable.providerEventId, "evt_org_old_account"),
    );
  const otherEventRows = await database.db.select({ id: database.payoutEventsTable.id })
    .from(database.payoutEventsTable).where(
      eq(database.payoutEventsTable.providerEventId, "evt_other_org_account"),
    );
  fixture.payoutEvents.push(oldEventRows[0]!.id, otherEventRows[0]!.id);

  const primaryToken = signToken({ userId: primaryOwner.id, role: "shop_owner" });
  const visibleEvents = await fetch(
    `${fixture.baseUrl}/payouts/events?organizationId=${organization.id}`,
    { headers: { authorization: `Bearer ${primaryToken}` } },
  );
  assert.equal(visibleEvents.status, 200);
  const visibleEventBody = await visibleEvents.json() as Array<{ organizationId: number | null }>;
  assert.ok(visibleEventBody.length >= 2);
  assert.ok(visibleEventBody.every((event) => event.organizationId === organization.id));
  const deniedEvents = await fetch(
    `${fixture.baseUrl}/payouts/events?organizationId=${organization.id}`,
    {
      headers: {
        authorization: `Bearer ${signToken({
          userId: otherOwner.id,
          role: "shop_owner",
        })}`,
      },
    },
  );
  assert.equal(deniedEvents.status, 404);

  // Once a provider session exists, the destination snapshot is immutable.
  // Exercise the actual owner/admin route rather than only its helper, then
  // verify checkout retry remains allowed on the same saved destination.
  const readonlyRetryJob = await createCheckoutJob(primaryOwner.id, mechanic.id);
  const [readonlyRetryPayment] = await database.db.insert(database.paymentsTable).values({
    jobId: readonlyRetryJob.id,
    amount: 100,
    platformFee: 10,
    mechanicPayout: 90,
    status: "pending",
    payoutDestination: "shop",
    shopId: legacyShop.id,
    payoutAccountId: "acct_legacy_preserve",
    providerSessionId: "cs_mock_started",
  }).returning();
  assert.ok(readonlyRetryPayment);
  fixture.payments.push(readonlyRetryPayment.id);
  const destinationChange = await fetch(
    `${fixture.baseUrl}/payouts/job/${readonlyRetryJob.id}/destination`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${signToken({
          userId: primaryOwner.id,
          role: "shop_owner",
        })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ destination: "mechanic" }),
    },
  );
  assert.equal(destinationChange.status, 409);
  const preservedStartedPayment = await database.db.select({
    payoutDestination: database.paymentsTable.payoutDestination,
    shopId: database.paymentsTable.shopId,
    providerSessionId: database.paymentsTable.providerSessionId,
  }).from(database.paymentsTable)
    .where(eq(database.paymentsTable.id, readonlyRetryPayment.id));
  assert.deepEqual(preservedStartedPayment, [{
    payoutDestination: "shop",
    shopId: legacyShop.id,
    providerSessionId: "cs_mock_started",
  }]);
  const allowedCheckoutRetry = await fetch(
    `${fixture.baseUrl}/payments/jobs/${readonlyRetryJob.id}/checkout`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${customerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    },
  );
  assert.equal(allowedCheckoutRetry.status, 200);
  const retriedReadonlyPayment = await database.db.select({
    id: database.paymentsTable.id,
    payoutAccountId: database.paymentsTable.payoutAccountId,
    providerSessionId: database.paymentsTable.providerSessionId,
  }).from(database.paymentsTable)
    .where(eq(database.paymentsTable.id, readonlyRetryPayment.id));
  assert.deepEqual(retriedReadonlyPayment, [{
    id: readonlyRetryPayment.id,
    payoutAccountId: "acct_legacy_preserve",
    providerSessionId: "cs_checkout_4",
  }]);

  // account.updated fails closed when a legacy user/shop mapping collides
  // with that provider ID.
  const conflictAccount = "acct_legacy_conflict";
  const conflictShop = await createShop(primaryOwner.id, null, conflictAccount, 0, "Conflict");
  await database.db.update(database.shopsTable)
    .set({ stripeAccountReady: 1 })
    .where(eq(database.shopsTable.id, conflictShop.id));
  await database.db.update(database.usersTable)
    .set({ stripeAccountId: conflictAccount })
    .where(eq(database.usersTable.id, primaryOwner.id));
  const conflict = await businessConnect.resolveConnectAccountOwner(
    database.db,
    conflictAccount,
  );
  assert.deepEqual(conflict, {
    kind: "collision",
    reason: "cross_table_account_collision",
  });
  await assert.rejects(
    businessConnect.resolveShopPayoutDestination(
      database.db,
      { ...conflictShop, stripeAccountReady: 1 },
      { sourceOrganizationId: null },
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "payout_destination_ownership_collision",
  );
  assert.equal(provider.calls.creates.length, 2);
  assert.ok(conflictShop.id);

  // Do not leave a legacy account on the fixture owner, otherwise cleanup
  // would be broader than this suite's explicit IDs.
  await database.db.update(database.usersTable)
    .set({ stripeAccountId: null })
    .where(eq(database.usersTable.id, primaryOwner.id));
});
