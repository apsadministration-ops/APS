/**
 * Real development-DB/API coverage for the existing Shop/Ghost Garage layer.
 *
 * This suite is opt-in because it creates and removes synthetic rows in the
 * development database:
 *
 *   RUN_SHOP_GHOST_INTEGRATION=1 \
 *     pnpm --filter @workspace/api-server run test:shops-ghost-garage
 *
 * No payment provider is contacted. The fixture is removed in dependency
 * order, and baseline rows are never selected for mutation or deletion.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

const enabled =
  process.env.RUN_SHOP_GHOST_INTEGRATION === "1" &&
  process.env.NODE_ENV !== "production" &&
  Boolean(process.env.DATABASE_URL);

type ApiResult<T> = { response: Response; body: T };
type Identity = { id: number; email: string; token: string };

const fixture: {
  server?: {
    close(callback: () => void): void;
    closeAllConnections?: () => void;
  };
  baseUrl: string;
  db?: any;
  pool?: { end(): Promise<void> };
  usersTable?: any;
  shopsTable?: any;
  baysTable?: any;
  bayBookingsTable?: any;
  jobsTable?: any;
  vehiclesTable?: any;
  partnerOrganizationsTable?: any;
  ownerA?: Identity;
  ownerB?: Identity;
  customer?: Identity;
  mechanic?: Identity;
  shopIds: number[];
  bayIds: number[];
  bookingIds: number[];
  jobIds: number[];
  vehicleIds: number[];
  organizationIds: number[];
  shops: Array<{ id: number; partnerKind: string }>;
} = {
  baseUrl: "",
  shopIds: [],
  bayIds: [],
  bookingIds: [],
  jobIds: [],
  vehicleIds: [],
  organizationIds: [],
  shops: [],
};

async function api<T>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`${fixture.baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return {
    response,
    body: (text ? JSON.parse(text) : null) as T,
  };
}

async function register(
  role: "shop_owner" | "customer" | "mechanic",
  suffix: string,
): Promise<Identity> {
  const email = `shop-ghost-${Date.now()}-${suffix}@example.test`;
  const result = await api<{ token: string; user: { id: number } }>(
    "/api/auth/register",
    {
      method: "POST",
      body: {
        name: `Shop Ghost ${suffix}`,
        email,
        password: "ShopGhostTest!2026",
        role,
        phone: "+15550123456",
        address: "100 Main Street",
        city: "Brooklyn",
        region: "NY",
        zipCode: "11201",
      },
    },
  );
  assert.equal(result.response.status, 201);
  return { id: result.body.user.id, email, token: result.body.token };
}

async function createShop(token: string, partnerKind: string, suffix: string) {
  const result = await api<{ id: number; ownerId: number; partnerKind: string }>(
    "/api/shops",
    {
      method: "POST",
      token,
      body: {
        partnerKind,
        name: `Synthetic location ${suffix}`,
        address: "300 Legacy Road",
        city: "Brooklyn",
        region: "NY",
        zipCode: "11232",
      },
    },
  );
  assert.equal(result.response.status, 201);
  fixture.shopIds.push(result.body.id);
  fixture.shops.push(result.body);
  return result.body;
}

async function createBay(token: string, shopId: number, suffix: string) {
  const result = await api<{ id: number; shopId: number; hourlyRate: number }>(
    `/api/shops/${shopId}/bays`,
    {
      method: "POST",
      token,
      body: {
        name: `Synthetic bay ${suffix}`,
        hourlyRate: 85,
        equipment: ["2-post lift"],
        allowedJobCategories: ["repair", "maintenance"],
        minMechanicTier: "detailer",
        autoApprove: false,
      },
    },
  );
  assert.equal(result.response.status, 201);
  fixture.bayIds.push(result.body.id);
  return result.body;
}

async function createGhostJob(startStatus = "ACCEPTED") {
  assert.ok(fixture.db && fixture.jobsTable && fixture.vehiclesTable);
  assert.ok(fixture.customer && fixture.mechanic);
  const vin = `SYN${fixture.jobIds.length}${Date.now()}`.slice(0, 17);
  const [vehicle] = await fixture.db.insert(fixture.vehiclesTable).values({
    vin,
    make: "Toyota",
    model: "Corolla",
    year: 2022,
    mileage: 100,
    ownerShopId: null,
  }).returning();
  fixture.vehicleIds.push(vehicle.id);
  const [job] = await fixture.db.insert(fixture.jobsTable).values({
    vehicleId: vehicle.id,
    vin,
    customerId: fixture.customer.id,
    mechanicId: fixture.mechanic.id,
    jobType: "repair",
    requiredTier: "detailer",
    description: "Synthetic lift service for Ghost Garage coverage",
    locationAddress: "300 Legacy Road, Brooklyn, NY 11232",
    status: startStatus,
    requiresGhostGarage: true,
    customerTransportApproved: false,
  }).returning();
  fixture.jobIds.push(job.id);
  return job;
}

before(async () => {
  if (!enabled) return;

  const [{ default: router }, { default: express }, database] = await Promise.all([
    import("../src/routes/index.ts"),
    import("express"),
    import("@workspace/db"),
  ]);
  fixture.db = database.db;
  fixture.pool = database.pool;
  fixture.usersTable = database.usersTable;
  fixture.shopsTable = database.shopsTable;
  fixture.baysTable = database.baysTable;
  fixture.bayBookingsTable = database.bayBookingsTable;
  fixture.jobsTable = database.jobsTable;
  fixture.vehiclesTable = database.vehiclesTable;
  fixture.partnerOrganizationsTable = database.partnerOrganizationsTable;

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/api", router);
  const server = await new Promise<any>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  fixture.server = server;
  const address = server.address();
  assert.ok(address && typeof address === "object");
  fixture.baseUrl = `http://127.0.0.1:${address.port}`;

  fixture.ownerA = await register("shop_owner", "owner-a");
  fixture.ownerB = await register("shop_owner", "owner-b");
  fixture.customer = await register("customer", "customer");
  fixture.mechanic = await register("mechanic", "mechanic");

  // Registration intentionally leaves mechanics pending. Activate only the
  // synthetic mechanic so the test exercises the existing active gate.
  const { eq } = await import("drizzle-orm");
  await fixture.db.update(fixture.usersTable)
    .set({ status: "active", mechanicTier: "senior" })
    .where(eq(fixture.usersTable.id, fixture.mechanic.id));

  for (const [kind, suffix] of [
    ["independent_shop", "legacy"],
    ["dealership", "dealership"],
    ["fleet", "fleet"],
    ["gsa", "gsa"],
  ]) {
    await createShop(fixture.ownerA.token, kind, suffix);
  }
  await createShop(fixture.ownerB.token, "independent_shop", "owner-b");
});

after(async () => {
  if (!enabled) return;
  const { inArray } = await import("drizzle-orm");

  // Only IDs collected from synthetic API/DB inserts are eligible for cleanup.
  if (fixture.db && fixture.bayBookingsTable && fixture.bookingIds.length > 0) {
    await fixture.db.delete(fixture.bayBookingsTable)
      .where(inArray(fixture.bayBookingsTable.id, fixture.bookingIds));
  }
  if (fixture.db && fixture.jobsTable && fixture.jobIds.length > 0) {
    await fixture.db.delete(fixture.jobsTable)
      .where(inArray(fixture.jobsTable.id, fixture.jobIds));
  }
  if (fixture.db && fixture.vehiclesTable && fixture.vehicleIds.length > 0) {
    await fixture.db.delete(fixture.vehiclesTable)
      .where(inArray(fixture.vehiclesTable.id, fixture.vehicleIds));
  }
  if (fixture.db && fixture.baysTable && fixture.bayIds.length > 0) {
    await fixture.db.delete(fixture.baysTable)
      .where(inArray(fixture.baysTable.id, fixture.bayIds));
  }
  if (fixture.db && fixture.shopsTable && fixture.shopIds.length > 0) {
    await fixture.db.delete(fixture.shopsTable)
      .where(inArray(fixture.shopsTable.id, fixture.shopIds));
  }
  if (fixture.db && fixture.partnerOrganizationsTable && fixture.organizationIds.length > 0) {
    await fixture.db.delete(fixture.partnerOrganizationsTable)
      .where(inArray(fixture.partnerOrganizationsTable.id, fixture.organizationIds));
  }
  if (fixture.db && fixture.usersTable) {
    const ids = [
      fixture.ownerA?.id,
      fixture.ownerB?.id,
      fixture.customer?.id,
      fixture.mechanic?.id,
    ].filter((id): id is number => typeof id === "number");
    if (ids.length > 0) {
      await fixture.db.delete(fixture.usersTable)
        .where(inArray(fixture.usersTable.id, ids));
    }
  }
  if (fixture.server) {
    fixture.server.closeAllConnections?.();
    await new Promise<void>((resolve) => fixture.server?.close(resolve));
  }
  await fixture.pool?.end();
});

test(
  "preserves legacy shops, organization ownership, bay controls, and Ghost Garage rules",
  { skip: !enabled },
  async () => {
    assert.ok(fixture.ownerA && fixture.ownerB && fixture.customer && fixture.mechanic);
    const ownerA = fixture.ownerA;
    const ownerB = fixture.ownerB;

    // Legacy shop_owner login and unlinked locations remain valid.
    const login = await api<{ token: string }>("/api/auth/login", {
      method: "POST",
      body: {
        email: ownerA.email,
        password: "ShopGhostTest!2026",
      },
    });
    assert.equal(login.response.status, 200);
    assert.ok(login.body.token);
    const mine = await api<Array<{ id: number; organizationId: number | null; partnerKind: string }>>(
      "/api/shops/mine",
      { token: login.body.token },
    );
    assert.equal(mine.response.status, 200);
    assert.deepEqual(
      mine.body.filter((shop) => fixture.shopIds.includes(shop.id)).map((shop) => shop.partnerKind).sort(),
      ["dealership", "fleet", "gsa", "independent_shop"],
    );
    assert.equal(
      mine.body.find((shop) => shop.id === fixture.shops[0]?.id)?.organizationId,
      null,
    );

    // One organization may explicitly own multiple existing locations.
    const organization = await api<{ id: number; primaryOwnerId: number }>(
      "/api/partner-organizations",
      {
        method: "POST",
        token: ownerA.token,
        body: {
          name: "Synthetic Shop Organization",
          subtype: "shop",
          phone: "+15550120000",
          email: `shop-org-${Date.now()}@example.test`,
          address: "200 Industry Avenue",
          city: "Brooklyn",
          region: "NY",
          zipCode: "11231",
        },
      },
    );
    assert.equal(organization.response.status, 201);
    assert.equal(organization.body.primaryOwnerId, ownerA.id);
    fixture.organizationIds.push(organization.body.id);
    for (const shop of fixture.shops.slice(0, 2)) {
      const linked = await api<{ organizationId: number; partnerKind: string }>(
        `/api/partner-organizations/${organization.body.id}/locations`,
        {
          method: "POST",
          token: ownerA.token,
          body: { shopId: shop.id },
        },
      );
      assert.equal(linked.response.status, 200);
      assert.equal(linked.body.organizationId, organization.body.id);
      assert.equal(linked.body.partnerKind, shop.partnerKind);
    }
    const locations = await api<Array<{ id: number }>>(
      `/api/partner-organizations/${organization.body.id}/locations`,
      { token: ownerA.token },
    );
    assert.equal(locations.response.status, 200);
    assert.ok(locations.body.some((location) => location.id === fixture.shops[0]?.id));
    assert.ok(locations.body.some((location) => location.id === fixture.shops[1]?.id));

    // Cross-owner organization and location access stays denied.
    const crossOrgGet = await api(`/api/partner-organizations/${organization.body.id}`, {
      token: ownerB.token,
    });
    assert.equal(crossOrgGet.response.status, 404);
    const crossOrgPatch = await api(`/api/partner-organizations/${organization.body.id}`, {
      method: "PATCH",
      token: ownerB.token,
      body: { name: "must not change" },
    });
    assert.equal(crossOrgPatch.response.status, 404);
    const crossLink = await api(
      `/api/partner-organizations/${organization.body.id}/locations`,
      {
        method: "POST",
        token: ownerB.token,
        body: { shopId: fixture.shops[0]?.id },
      },
    );
    assert.equal(crossLink.response.status, 404);

    // The composite owner constraint also protects writes outside the API.
    const { eq } = await import("drizzle-orm");
    await assert.rejects(
      fixture.db.update(fixture.shopsTable)
        .set({ organizationId: organization.body.id })
        .where(eq(fixture.shopsTable.id, fixture.shops[4]?.id)),
    );

    const primaryShop = fixture.shops[0]!;
    const secondaryShop = fixture.shops[1]!;
    const firstBay = await createBay(ownerA.token, primaryShop.id, "one");
    const secondBay = await createBay(ownerA.token, primaryShop.id, "two");
    const ownerBBay = await createBay(ownerB.token, fixture.shops[4]!.id, "owner-b");
    void ownerBBay;

    // Shop/bay reads allow the owning partner and active mechanics, not a
    // different owner or a customer. Bay editing remains owner-scoped.
    const ownerShopRead = await api<{ bays: Array<{ id: number }> }>(
      `/api/shops/${primaryShop.id}`,
      { token: ownerA.token },
    );
    assert.equal(ownerShopRead.response.status, 200);
    assert.ok(ownerShopRead.body.bays.some((bay) => bay.id === firstBay.id));
    const mechanicShopRead = await api(`/api/shops/${primaryShop.id}`, {
      token: fixture.mechanic.token,
    });
    assert.equal(mechanicShopRead.response.status, 200);
    const mechanicBayRead = await api(`/api/bays/${firstBay.id}`, {
      token: fixture.mechanic.token,
    });
    assert.equal(mechanicBayRead.response.status, 200);
    const crossShopRead = await api(`/api/shops/${primaryShop.id}`, {
      token: ownerB.token,
    });
    assert.equal(crossShopRead.response.status, 403);
    const crossShopPatch = await api(`/api/shops/${primaryShop.id}`, {
      method: "PATCH",
      token: ownerB.token,
      body: { name: "must not change" },
    });
    assert.equal(crossShopPatch.response.status, 403);
    const crossBayRead = await api(`/api/bays/${firstBay.id}`, { token: ownerB.token });
    assert.equal(crossBayRead.response.status, 403);
    const crossBayPatch = await api(`/api/bays/${firstBay.id}`, {
      method: "PATCH",
      token: ownerB.token,
      body: { hourlyRate: 1 },
    });
    assert.equal(crossBayPatch.response.status, 403);
    const crossShopBays = await api(`/api/shops/${primaryShop.id}/bays`, {
      token: ownerB.token,
    });
    assert.equal(crossShopBays.response.status, 403);

    const editedBay = await api<{ hourlyRate: number; status: string }>(
      `/api/bays/${firstBay.id}`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: { hourlyRate: 125, status: "inactive" },
      },
    );
    assert.equal(editedBay.response.status, 200);
    assert.equal(editedBay.body.hourlyRate, 125);
    assert.equal(editedBay.body.status, "inactive");
    await api(`/api/bays/${firstBay.id}`, {
      method: "PATCH",
      token: ownerA.token,
      body: { status: "active" },
    });
    const available = await api<Array<{ id: number }>>("/api/bays/available", {
      token: fixture.mechanic.token,
    });
    assert.equal(available.response.status, 200);
    assert.ok(available.body.some((bay) => bay.id === firstBay.id));
    assert.ok(available.body.some((bay) => bay.id === secondBay.id));

    // Shop, bay, and booking identifiers reject truncation candidates before
    // any DB lookup.
    for (const malformed of ["0", "1.5", "1junk", String(Number.MAX_SAFE_INTEGER + 1)]) {
      assert.equal((await api(`/api/shops/${malformed}`, { token: ownerA.token })).response.status, 400);
      assert.equal((await api(`/api/shops/${malformed}/bays`, { token: ownerA.token })).response.status, 400);
      assert.equal((await api(`/api/bays/${malformed}`, { token: ownerA.token })).response.status, 400);
      assert.equal((await api(`/api/bookings/${malformed}/cancel`, {
        method: "PATCH",
        token: ownerA.token,
      })).response.status, 400);
    }
    assert.equal(
      (await api(`/api/bays/${firstBay.id}.5/bookings`, {
        method: "POST",
        token: fixture.mechanic.token,
        body: { jobId: 1, startTime: "2099-01-01T00:00:00.000Z", estimatedHours: 1 },
      })).response.status,
      400,
    );
    // Ghost Garage transport approval is required before both transport and
    // bay booking, while booking creation remains mechanic-only.
    const firstJob = await createGhostJob();
    const start = "2099-02-01T10:00:00.000Z";
    const preApprovalTransport = await api(`/api/jobs/${firstJob.id}/transport/legs`, {
      method: "POST",
      token: fixture.mechanic.token,
      body: { direction: "outbound", startMileage: 100 },
    });
    assert.equal(preApprovalTransport.response.status, 409);
    const preApprovalBooking = await api(`/api/bays/${firstBay.id}/bookings`, {
      method: "POST",
      token: fixture.mechanic.token,
      body: { jobId: firstJob.id, startTime: start, estimatedHours: 2 },
    });
    assert.equal(preApprovalBooking.response.status, 409);
    const customerApproval = await api(`/api/jobs/${firstJob.id}/transport-approval`, {
      method: "POST",
      token: fixture.customer.token,
    });
    assert.equal(customerApproval.response.status, 200);
    const ownerBookingAttempt = await api(`/api/bays/${firstBay.id}/bookings`, {
      method: "POST",
      token: ownerA.token,
      body: { jobId: firstJob.id, startTime: start, estimatedHours: 2 },
    });
    assert.equal(ownerBookingAttempt.response.status, 403);
    const firstBooking = await api<{ id: number; status: string }>(`/api/bays/${firstBay.id}/bookings`, {
      method: "POST",
      token: fixture.mechanic.token,
      body: { jobId: firstJob.id, startTime: start, estimatedHours: 2 },
    });
    assert.equal(firstBooking.response.status, 201);
    assert.equal(firstBooking.body.status, "pending");
    fixture.bookingIds.push(firstBooking.body.id);
    const firstApproval = await api<{ status: string }>(`/api/bookings/${firstBooking.body.id}/approve`, {
      method: "PATCH",
      token: ownerA.token,
    });
    assert.equal(firstApproval.response.status, 200);
    assert.equal(firstApproval.body.status, "reserved");

    // Existing reservations remain readable if the parent facility later
    // becomes inactive, but a stale client cannot create a new reservation.
    const inactiveJob = await createGhostJob();
    const inactiveApproval = await api(`/api/jobs/${inactiveJob.id}/transport-approval`, {
      method: "POST",
      token: fixture.customer.token,
    });
    assert.equal(inactiveApproval.response.status, 200);
    const inactiveShop = await api(`/api/shops/${primaryShop.id}`, {
      method: "PATCH",
      token: ownerA.token,
      body: { status: "inactive" },
    });
    assert.equal(inactiveShop.response.status, 200);
    const readableWhileInactive = await api<Array<{ id: number; shopId: number }>>(
      "/api/bookings/mine",
      { token: ownerA.token },
    );
    const existingWhileInactive = readableWhileInactive.body.find((booking) => booking.id === firstBooking.body.id);
    assert.equal(readableWhileInactive.response.status, 200);
    assert.equal(existingWhileInactive?.shopId, primaryShop.id);
    const inactiveBooking = await api(`/api/bays/${secondBay.id}/bookings`, {
      method: "POST",
      token: fixture.mechanic.token,
      body: {
        jobId: inactiveJob.id,
        startTime: "2099-02-15T10:00:00.000Z",
        estimatedHours: 1,
      },
    });
    assert.equal(inactiveBooking.response.status, 400);
    const activeShop = await api(`/api/shops/${primaryShop.id}`, {
      method: "PATCH",
      token: ownerA.token,
      body: { status: "active" },
    });
    assert.equal(activeShop.response.status, 200);

    // Existing overlap protection rejects a second job in the same bay/time.
    const overlapJob = await createGhostJob();
    const overlapApproval = await api(`/api/jobs/${overlapJob.id}/transport-approval`, {
      method: "POST",
      token: fixture.customer.token,
    });
    assert.equal(overlapApproval.response.status, 200);
    const overlap = await api<{ id: number; status: string }>(`/api/bays/${firstBay.id}/bookings`, {
      method: "POST",
      token: fixture.mechanic.token,
      body: { jobId: overlapJob.id, startTime: "2099-02-01T11:00:00.000Z", estimatedHours: 2 },
    });
    assert.equal(overlap.response.status, 201);
    assert.equal(overlap.body.status, "pending");
    fixture.bookingIds.push(overlap.body.id);
    const overlapApproval = await api(`/api/bookings/${overlap.body.id}/approve`, {
      method: "PATCH",
      token: ownerA.token,
    });
    assert.equal(overlapApproval.response.status, 409);

    // Preserve existing booking lifecycle rules: reserved -> active ->
    // completed, with no owner permission to start/complete a booking.
    const ownerStart = await api(`/api/bookings/${firstBooking.body.id}/start`, {
      method: "PATCH",
      token: ownerA.token,
    });
    assert.equal(ownerStart.response.status, 403);
    const started = await api<{ status: string }>(
      `/api/bookings/${firstBooking.body.id}/start`,
      { method: "PATCH", token: fixture.mechanic.token },
    );
    assert.equal(started.response.status, 200);
    assert.equal(started.body.status, "active");
    const completed = await api<{ status: string }>(
      `/api/bookings/${firstBooking.body.id}/complete`,
      { method: "PATCH", token: fixture.mechanic.token },
    );
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.status, "completed");

    // Cancellation is allowed to the owning partner/mechanic, not a
    // cross-owner shop_owner. This separate reservation remains cancellable.
    const cancelJob = await createGhostJob();
    const cancelApproval = await api(`/api/jobs/${cancelJob.id}/transport-approval`, {
      method: "POST",
      token: fixture.customer.token,
    });
    assert.equal(cancelApproval.response.status, 200);
    const cancelBooking = await api<{ id: number }>(`/api/bays/${secondBay.id}/bookings`, {
      method: "POST",
      token: fixture.mechanic.token,
      body: {
        jobId: cancelJob.id,
        startTime: "2099-03-01T10:00:00.000Z",
        estimatedHours: 1,
      },
    });
    assert.equal(cancelBooking.response.status, 201);
    fixture.bookingIds.push(cancelBooking.body.id);
    const { eq: eqDb } = await import("drizzle-orm");
    await fixture.db.update(fixture.bayBookingsTable)
      .set({ shopId: fixture.shops[4]!.id })
      .where(eqDb(fixture.bayBookingsTable.id, cancelBooking.body.id));
    const ownerBookings = await api<Array<{ id: number; shopId: number }>>(
      "/api/bookings/mine",
      { token: ownerA.token },
    );
    const mismatchedOwnerBooking = ownerBookings.body.find((booking) => booking.id === cancelBooking.body.id);
    assert.equal(ownerBookings.response.status, 200);
    assert.equal(mismatchedOwnerBooking?.shopId, primaryShop.id);
    const falseOwnerBookings = await api<Array<{ id: number; shopId: number }>>(
      "/api/bookings/mine",
      { token: ownerB.token },
    );
    assert.equal(falseOwnerBookings.response.status, 200);
    assert.ok(!falseOwnerBookings.body.some((booking) => booking.id === cancelBooking.body.id));
    const crossCancel = await api(`/api/bookings/${cancelBooking.body.id}/cancel`, {
      method: "PATCH",
      token: ownerB.token,
      body: { reason: "cross-owner denial" },
    });
    assert.equal(crossCancel.response.status, 403);
    const invalidComplete = await api(`/api/bookings/${cancelBooking.body.id}/complete`, {
      method: "PATCH",
      token: fixture.mechanic.token,
    });
    assert.equal(invalidComplete.response.status, 400);
    const ownerCancel = await api<{ status: string }>(
      `/api/bookings/${cancelBooking.body.id}/cancel`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: { reason: "synthetic cleanup path" },
      },
    );
    assert.equal(ownerCancel.response.status, 200);
    assert.equal(ownerCancel.body.status, "cancelled");
    assert.equal(ownerCancel.body.shopId, primaryShop.id);

    // Keep an explicitly unused second location in the organization so this
    // suite also exercises multiple-location ownership without reassigning it.
    assert.equal(secondaryShop.partnerKind, "dealership");
  },
);