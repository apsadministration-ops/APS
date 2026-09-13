/**
 * Focused Part 6 Ghost Garage coverage. This is opt-in because it creates
 * synthetic development rows and is intentionally not part of the default
 * regression suite:
 *
 * RUN_PART6_BAYS_INTEGRATION=1 \
 *   pnpm --filter @workspace/api-server run test:partner-part6-bays
 *
 * Do not run this test, apply the Part 6 migration, or alter a shared
 * development database as part of source-only review.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

const enabled =
  process.env.RUN_PART6_BAYS_INTEGRATION === "1" &&
  process.env.NODE_ENV !== "production" &&
  Boolean(process.env.DATABASE_URL);

type Identity = { id: number; token: string };
type Result<T = unknown> = { response: Response; body: T };
const fixture: {
  server?: { close(callback: () => void): void; closeAllConnections?: () => void };
  baseUrl: string;
  db?: any;
  usersTable?: any;
  shopsTable?: any;
  baysTable?: any;
  bookingsTable?: any;
  jobsTable?: any;
  vehiclesTable?: any;
  owner?: Identity;
  customer?: Identity;
  mechanic?: Identity;
  shopId?: number;
  bayId?: number;
  autoBayId?: number;
  bookingIds: number[];
  jobIds: number[];
  vehicleIds: number[];
  bayIds: number[];
  shopIds: number[];
  userIds: number[];
} = {
  baseUrl: "",
  bookingIds: [],
  jobIds: [],
  vehicleIds: [],
  bayIds: [],
  shopIds: [],
  userIds: [],
};

async function api<T = unknown>(
  path: string,
  options: { method?: string; token?: string; body?: Record<string, unknown> } = {},
): Promise<Result<T>> {
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
  return { response, body: (text ? JSON.parse(text) : null) as T };
}

async function register(role: "shop_owner" | "customer" | "mechanic", suffix: string): Promise<Identity> {
  const email = `part6-${Date.now()}-${suffix}@example.test`;
  const password = "PartSixTest!2026";
  if (role === "shop_owner") {
    // This suite intentionally covers the pre-existing unlinked shop-owner
    // workflow. Seed that legacy principal directly instead of using the
    // person-only registration endpoint, which now correctly redirects to
    // business-first signup.
    const { hashPassword } = await import("../src/lib/auth.ts");
    const [user] = await fixture.db.insert(fixture.usersTable).values({
      name: `Part 6 ${suffix}`,
      email,
      phone: "+15550123456",
      passwordHash: await hashPassword(password),
      role: "shop_owner",
      status: "active",
      address: "100 Main Street",
      city: "Brooklyn",
      region: "NY",
      zipCode: "11201",
    }).returning({ id: fixture.usersTable.id });
    fixture.userIds.push(user.id);
    const login = await api<{ token: string }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(login.response.status, 200, JSON.stringify(login.body));
    return { id: user.id, token: login.body.token };
  }
  const result = await api<{ token: string; user: { id: number } }>("/api/auth/register", {
    method: "POST",
    body: {
      name: `Part 6 ${suffix}`,
      email,
      password,
      role,
      phone: "+15550123456",
      address: "100 Main Street",
      city: "Brooklyn",
      region: "NY",
      zipCode: "11201",
    },
  });
  assert.equal(result.response.status, 201);
  fixture.userIds.push(result.body.user.id);
  return { id: result.body.user.id, token: result.body.token };
}

async function cleanupPriorFixtures(): Promise<void> {
  const { inArray, like, or } = await import("drizzle-orm");
  const oldUsers = await fixture.db.select({ id: fixture.usersTable.id })
    .from(fixture.usersTable)
    .where(like(fixture.usersTable.email, "part6-%@example.test"));
  const oldUserIds = oldUsers.map((row: { id: number }) => row.id);
  if (oldUserIds.length === 0) return;
  const oldShops = await fixture.db.select({ id: fixture.shopsTable.id })
    .from(fixture.shopsTable)
    .where(inArray(fixture.shopsTable.ownerId, oldUserIds));
  const oldShopIds = oldShops.map((row: { id: number }) => row.id);
  const oldJobs = await fixture.db.select({
    id: fixture.jobsTable.id,
    vehicleId: fixture.jobsTable.vehicleId,
  }).from(fixture.jobsTable).where(or(
    inArray(fixture.jobsTable.customerId, oldUserIds),
    inArray(fixture.jobsTable.mechanicId, oldUserIds),
  ));
  const oldJobIds = oldJobs.map((row: { id: number }) => row.id);
  const oldVehicleIds = oldJobs
    .map((row: { vehicleId: number }) => row.vehicleId)
    .filter((id): id is number => typeof id === "number");
  if (oldJobIds.length || oldShopIds.length) {
    const bookingWhere = [
      oldJobIds.length ? inArray(fixture.bookingsTable.jobId, oldJobIds) : null,
      oldShopIds.length ? inArray(fixture.bookingsTable.shopId, oldShopIds) : null,
    ].filter((value): value is NonNullable<typeof value> => value !== null);
    if (bookingWhere.length) {
      await fixture.db.delete(fixture.bookingsTable).where(or(...bookingWhere));
    }
  }
  if (oldJobIds.length) {
    await fixture.db.delete(fixture.jobsTable).where(inArray(fixture.jobsTable.id, oldJobIds));
  }
  if (oldVehicleIds.length) {
    await fixture.db.delete(fixture.vehiclesTable).where(inArray(fixture.vehiclesTable.id, oldVehicleIds));
  }
  if (oldShopIds.length) {
    await fixture.db.delete(fixture.baysTable).where(inArray(fixture.baysTable.shopId, oldShopIds));
    await fixture.db.delete(fixture.shopsTable).where(inArray(fixture.shopsTable.id, oldShopIds));
  }
  await fixture.db.delete(fixture.usersTable).where(inArray(fixture.usersTable.id, oldUserIds));
}

async function createJob(
  description: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: number; vehicleId: number }> {
  const vin = `P6${Date.now()}${fixture.jobIds.length}`.slice(0, 17);
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
    description,
    locationAddress: "300 Legacy Road",
    status: "ACCEPTED",
    requiresGhostGarage: false,
    customerTransportApproved: true,
    ...extra,
  }).returning();
  fixture.jobIds.push(job.id);
  return job;
}

before(async () => {
  if (!enabled) return;
  const [{ default: router }, { default: express }, database, { eq }] = await Promise.all([
    import("../src/routes/index.ts"),
    import("express"),
    import("@workspace/db"),
    import("drizzle-orm"),
  ]);
  fixture.db = database.db;
  fixture.usersTable = database.usersTable;
  fixture.shopsTable = database.shopsTable;
  fixture.baysTable = database.baysTable;
  fixture.bookingsTable = database.bayBookingsTable;
  fixture.jobsTable = database.jobsTable;
  fixture.vehiclesTable = database.vehiclesTable;
  await cleanupPriorFixtures();
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  fixture.server = await new Promise<any>((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
  const address = fixture.server.address?.();
  assert.ok(address && typeof address === "object");
  fixture.baseUrl = `http://127.0.0.1:${address.port}`;

  fixture.owner = await register("shop_owner", "owner");
  fixture.customer = await register("customer", "customer");
  fixture.mechanic = await register("mechanic", "mechanic");
  await fixture.db.update(fixture.usersTable)
    .set({ status: "active", mechanicTier: "senior" })
    .where(eq(fixture.usersTable.id, fixture.mechanic.id));

  const shopResult = await api<{ id: number }>("/api/shops", {
    method: "POST",
    token: fixture.owner.token,
    body: {
      name: "Part 6 shop",
      address: "300 Legacy Road",
      city: "Brooklyn",
      region: "NY",
      zipCode: "11232",
    },
  });
  assert.equal(shopResult.response.status, 201);
  fixture.shopId = shopResult.body.id;
  fixture.shopIds.push(fixture.shopId);

  for (const autoApprove of [false, true]) {
    const bay = await api<{ id: number }>(`/api/shops/${fixture.shopId}/bays`, {
      method: "POST",
      token: fixture.owner.token,
      body: {
        name: autoApprove ? "Auto bay" : "Manual bay",
        hourlyRate: 85,
        equipment: ["2-post lift"],
        allowedJobCategories: ["repair"],
        minMechanicTier: "detailer",
        autoApprove,
      },
    });
    assert.equal(bay.response.status, 201);
    fixture.bayIds.push(bay.body.id);
    if (autoApprove) fixture.autoBayId = bay.body.id;
    else fixture.bayId = bay.body.id;
  }
});

after(async () => {
  if (!enabled || !fixture.db) return;
  const { inArray } = await import("drizzle-orm");
  if (fixture.bookingsTable && fixture.bookingIds.length) {
    await fixture.db.delete(fixture.bookingsTable).where(inArray(fixture.bookingsTable.id, fixture.bookingIds));
  }
  if (fixture.jobsTable && fixture.jobIds.length) {
    await fixture.db.delete(fixture.jobsTable).where(inArray(fixture.jobsTable.id, fixture.jobIds));
  }
  if (fixture.vehiclesTable && fixture.vehicleIds.length) {
    await fixture.db.delete(fixture.vehiclesTable).where(inArray(fixture.vehiclesTable.id, fixture.vehicleIds));
  }
  if (fixture.baysTable && fixture.bayIds.length) {
    await fixture.db.delete(fixture.baysTable).where(inArray(fixture.baysTable.id, fixture.bayIds));
  }
  if (fixture.shopsTable && fixture.shopIds.length) {
    await fixture.db.delete(fixture.shopsTable).where(inArray(fixture.shopsTable.id, fixture.shopIds));
  }
  if (fixture.usersTable && fixture.userIds.length) {
    await fixture.db.delete(fixture.usersTable).where(inArray(fixture.usersTable.id, fixture.userIds));
  }
  fixture.server?.closeAllConnections?.();
  if (fixture.server) await new Promise<void>((resolve) => fixture.server?.close(resolve));
});

test("Part 6 pending approval, rejection, cancellation, and discovery", {
  skip: !enabled,
}, async () => {
  const job = await createJob("Normal customer lift job");
  const start = "2099-07-01T10:00:00.000Z";
  const pending = await api<{ id: number; status: string }>(`/api/bays/${fixture.bayId}/bookings`, {
    method: "POST",
    token: fixture.mechanic.token,
    body: { jobId: job.id, startTime: start, estimatedHours: 2 },
  });
  assert.equal(pending.response.status, 201);
  assert.equal(pending.body.status, "pending");
  fixture.bookingIds.push(pending.body.id);
  const duplicate = await api(`/api/bays/${fixture.bayId}/bookings`, {
    method: "POST",
    token: fixture.mechanic.token,
    body: { jobId: job.id, startTime: start, estimatedHours: 2 },
  });
  assert.equal(duplicate.response.status, 409);
  const visibleWhilePending = await api<Array<{ id: number }>>(
    `/api/bays/available?startsAt=${encodeURIComponent(start)}&durationHours=2`,
    { token: fixture.mechanic.token },
  );
  assert.ok(visibleWhilePending.body.some((bay) => bay.id === fixture.bayId));

  const approved = await api<{ status: string; job: { id: number }; vehicle: { id: number }; location: { id: number } }>(
    `/api/bookings/${pending.body.id}/approve`,
    { method: "PATCH", token: fixture.owner.token },
  );
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.status, "reserved");
  assert.equal(approved.body.job.id, job.id);
  assert.equal(approved.body.vehicle.id, job.vehicleId);
  assert.equal(approved.body.location.id, fixture.shopId);
  const hiddenAfterApproval = await api<Array<{ id: number }>>(
    `/api/bays/available?startsAt=${encodeURIComponent(start)}&durationHours=2`,
    { token: fixture.mechanic.token },
  );
  assert.ok(!hiddenAfterApproval.body.some((bay) => bay.id === fixture.bayId));

  const cancelled = await api<{ status: string }>(`/api/bookings/${pending.body.id}/cancel`, {
    method: "PATCH",
    token: fixture.owner.token,
    body: { reason: "owner cancellation" },
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.status, "cancelled");

  const rejectedJob = await createJob("Rejected request");
  const rejectedRequest = await api<{ id: number; status: string }>(`/api/bays/${fixture.bayId}/bookings`, {
    method: "POST",
    token: fixture.mechanic.token,
    body: { jobId: rejectedJob.id, startTime: "2099-07-02T10:00:00.000Z", estimatedHours: 1 },
  });
  assert.equal(rejectedRequest.body.status, "pending");
  fixture.bookingIds.push(rejectedRequest.body.id);
  const rejected = await api<{ status: string }>(`/api/bookings/${rejectedRequest.body.id}/reject`, {
    method: "PATCH",
    token: fixture.owner.token,
    body: { reason: "not available" },
  });
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.body.status, "rejected");

  // Terminal rejection is history, not a permanent one-booking-per-job
  // restriction. Send the same normal job to another bay and approve it.
  const disableAutoApprove = await api(`/api/bays/${fixture.autoBayId}`, {
    method: "PATCH",
    token: fixture.owner.token,
    body: { autoApprove: false },
  });
  assert.equal(disableAutoApprove.response.status, 200);
  const replacementRequest = await api<{ id: number; status: string }>(
    `/api/bays/${fixture.autoBayId}/bookings`,
    {
      method: "POST",
      token: fixture.mechanic.token,
      body: { jobId: rejectedJob.id, startTime: "2099-07-02T10:00:00.000Z", estimatedHours: 1 },
    },
  );
  assert.equal(replacementRequest.response.status, 201);
  assert.equal(replacementRequest.body.status, "pending");
  fixture.bookingIds.push(replacementRequest.body.id);
  const replacementApproval = await api<{ status: string }>(
    `/api/bookings/${replacementRequest.body.id}/approve`,
    { method: "PATCH", token: fixture.owner.token },
  );
  assert.equal(replacementApproval.response.status, 200);
  assert.equal(replacementApproval.body.status, "reserved");
  const replacementCancel = await api<{ status: string }>(
    `/api/bookings/${replacementRequest.body.id}/cancel`,
    { method: "PATCH", token: fixture.owner.token },
  );
  assert.equal(replacementCancel.response.status, 200);
  assert.equal(replacementCancel.body.status, "cancelled");

  // Cancellation also releases the job's live-booking slot. The same job can
  // submit and approve a fresh reservation without rewriting either history
  // row.
  const availableAfterCancel = await api<Array<{ id: number }>>(
    `/api/bays/available?startsAt=${encodeURIComponent("2099-07-03T10:00:00.000Z")}&durationHours=1`,
    { token: fixture.mechanic.token },
  );
  assert.ok(availableAfterCancel.body.some((bay) => bay.id === fixture.autoBayId));
  const afterCancelRequest = await api<{ id: number; status: string }>(
    `/api/bays/${fixture.autoBayId}/bookings`,
    {
      method: "POST",
      token: fixture.mechanic.token,
      body: { jobId: rejectedJob.id, startTime: "2099-07-03T10:00:00.000Z", estimatedHours: 1 },
    },
  );
  assert.equal(afterCancelRequest.response.status, 201);
  assert.equal(afterCancelRequest.body.status, "pending");
  fixture.bookingIds.push(afterCancelRequest.body.id);
  const afterCancelApproval = await api<{ status: string }>(
    `/api/bookings/${afterCancelRequest.body.id}/approve`,
    { method: "PATCH", token: fixture.owner.token },
  );
  assert.equal(afterCancelApproval.response.status, 200);
  assert.equal(afterCancelApproval.body.status, "reserved");
  const history = await api<Array<{ jobId: number; status: string }>>("/api/bookings/mine", {
    token: fixture.mechanic.token,
  });
  const rejectedJobHistory = history.body.filter((booking) => booking.jobId === rejectedJob.id);
  assert.ok(rejectedJobHistory.some((booking) => booking.status === "rejected"));
  assert.ok(rejectedJobHistory.some((booking) => booking.status === "cancelled"));
  assert.ok(rejectedJobHistory.some((booking) => booking.status === "reserved"));
});

test("Part 6 approval conflict, inactive bay, roles, and normal/commercial association", {
  skip: !enabled,
}, async () => {
  const first = await createJob("First overlapping request");
  const second = await createJob("Second overlapping request");
  const start = "2099-08-01T10:00:00.000Z";
  const requests = await Promise.all([first, second].map((job) => api<{ id: number }>(`/api/bays/${fixture.bayId}/bookings`, {
    method: "POST",
    token: fixture.mechanic.token,
    body: { jobId: job.id, startTime: start, estimatedHours: 2 },
  })));
  for (const request of requests) {
    assert.equal(request.response.status, 201);
    fixture.bookingIds.push(request.body.id);
  }
  const firstApproval = await api(`/api/bookings/${requests[0].body.id}/approve`, {
    method: "PATCH",
    token: fixture.owner.token,
  });
  assert.equal(firstApproval.response.status, 200);
  const losingApproval = await api(`/api/bookings/${requests[1].body.id}/approve`, {
    method: "PATCH",
    token: fixture.owner.token,
  });
  assert.equal(losingApproval.response.status, 409);

  const customerInventory = await api(`/api/bays/available`, { token: fixture.customer.token });
  assert.equal(customerInventory.response.status, 403);
  const customerReserve = await api(`/api/bays/${fixture.bayId}/bookings`, {
    method: "POST", token: fixture.customer.token,
    body: { jobId: first.id, startTime: "2099-08-03T10:00:00.000Z", estimatedHours: 1 },
  });
  assert.equal(customerReserve.response.status, 403);
  const ownerReserve = await api(`/api/bays/${fixture.bayId}/bookings`, {
    method: "POST", token: fixture.owner.token,
    body: { jobId: first.id, startTime: "2099-08-03T10:00:00.000Z", estimatedHours: 1 },
  });
  assert.equal(ownerReserve.response.status, 403);
  const ownerInventory = await api(`/api/shops/${fixture.shopId}`, { token: fixture.owner.token });
  assert.equal(ownerInventory.response.status, 200);
  const ownerBays = await api(`/api/shops/${fixture.shopId}/bays`, { token: fixture.owner.token });
  assert.equal(ownerBays.response.status, 200);
  const customerShopDetail = await api(`/api/shops/${fixture.shopId}`, { token: fixture.customer.token });
  assert.equal(customerShopDetail.response.status, 403);
  const customerBayList = await api(`/api/shops/${fixture.shopId}/bays`, { token: fixture.customer.token });
  assert.equal(customerBayList.response.status, 403);
  const customerDetail = await api(`/api/bays/${fixture.bayId}`, { token: fixture.customer.token });
  assert.equal(customerDetail.response.status, 403);

  const inactive = await api(`/api/bays/${fixture.bayId}`, {
    method: "PATCH", token: fixture.owner.token, body: { status: "inactive" },
  });
  assert.equal(inactive.response.status, 200);
  const inactiveDiscovery = await api<Array<{ id: number }>>("/api/bays/available", {
    token: fixture.mechanic.token,
  });
  assert.ok(!inactiveDiscovery.body.some((bay) => bay.id === fixture.bayId));
  const inactiveJob = await createJob("Inactive bay request");
  const inactiveBooking = await api(`/api/bays/${fixture.bayId}/bookings`, {
    method: "POST", token: fixture.mechanic.token,
    body: { jobId: inactiveJob.id, startTime: "2099-09-01T10:00:00.000Z", estimatedHours: 1 },
  });
  assert.equal(inactiveBooking.response.status, 400);
  await api(`/api/bays/${fixture.bayId}`, {
    method: "PATCH", token: fixture.owner.token, body: { status: "active" },
  });

  const commercialJob = await createJob("Commercial partner repair", {
    postedByShopId: fixture.shopId,
    partnerKindSnapshot: "fleet",
  });
  const commercialBooking = await api<{ id: number; status: string }>(`/api/bays/${fixture.bayId}/bookings`, {
    method: "POST", token: fixture.mechanic.token,
    body: { jobId: commercialJob.id, startTime: "2099-10-01T10:00:00.000Z", estimatedHours: 1 },
  });
  assert.equal(commercialBooking.response.status, 201);
  assert.equal(commercialBooking.body.status, "pending");
  fixture.bookingIds.push(commercialBooking.body.id);
  const commercialReject = await api<{ status: string }>(
    `/api/bookings/${commercialBooking.body.id}/reject`,
    { method: "PATCH", token: fixture.owner.token, body: { reason: "try another bay" } },
  );
  assert.equal(commercialReject.response.status, 200);
  assert.equal(commercialReject.body.status, "rejected");
  const commercialReplacement = await api<{ id: number; status: string }>(
    `/api/bays/${fixture.autoBayId}/bookings`,
    {
      method: "POST",
      token: fixture.mechanic.token,
      body: { jobId: commercialJob.id, startTime: "2099-10-01T10:00:00.000Z", estimatedHours: 1 },
    },
  );
  assert.equal(commercialReplacement.response.status, 201);
  assert.equal(commercialReplacement.body.status, "pending");
  fixture.bookingIds.push(commercialReplacement.body.id);
  const commercialApproval = await api<{ status: string }>(
    `/api/bookings/${commercialReplacement.body.id}/approve`,
    { method: "PATCH", token: fixture.owner.token },
  );
  assert.equal(commercialApproval.response.status, 200);
  assert.equal(commercialApproval.body.status, "reserved");
});

test("Part 6 assigned mechanic lift action resets transport approval only when newly required", {
  skip: !enabled,
}, async () => {
  const job = await createJob("Normal job that later needs a lift");
  const enabledLift = await api<{ requiresGhostGarage: boolean; customerTransportApproved: boolean }>(
    `/api/jobs/${job.id}/lift-requirement`,
    { method: "PATCH", token: fixture.mechanic.token, body: { requiresGhostGarage: true } },
  );
  assert.equal(enabledLift.response.status, 200);
  assert.equal(enabledLift.body.requiresGhostGarage, true);
  assert.equal(enabledLift.body.customerTransportApproved, false);
  const customerApproval = await api(`/api/jobs/${job.id}/transport-approval`, {
    method: "POST", token: fixture.customer.token,
  });
  assert.equal(customerApproval.response.status, 200);
  const unchanged = await api<{ customerTransportApproved: boolean }>(
    `/api/jobs/${job.id}/lift-requirement`,
    { method: "PATCH", token: fixture.mechanic.token, body: { requiresGhostGarage: true } },
  );
  assert.equal(unchanged.body.customerTransportApproved, true);
});

test("Part 7 bay availability gates manual and auto-approved requests", {
  skip: !enabled,
}, async () => {
  assert.ok(fixture.bayId);
  assert.ok(fixture.autoBayId);

  const overnightConfig = {
    timezone: "UTC",
    weekly: [{ dayOfWeek: 1, open: "19:00", close: "08:00" }],
  };
  const manualConfig = await api<{ availabilityConfig: typeof overnightConfig }>(
    `/api/bays/${fixture.bayId}`,
    {
      method: "PATCH",
      token: fixture.owner!.token,
      body: { availabilityConfig: overnightConfig, autoApprove: false },
    },
  );
  assert.equal(manualConfig.response.status, 200);
  assert.deepEqual(manualConfig.body.availabilityConfig, overnightConfig);

  const autoConfig = await api<{ availabilityConfig: typeof overnightConfig }>(
    `/api/bays/${fixture.autoBayId}`,
    {
      method: "PATCH",
      token: fixture.owner!.token,
      body: { availabilityConfig: overnightConfig, autoApprove: true },
    },
  );
  assert.equal(autoConfig.response.status, 200);
  assert.deepEqual(autoConfig.body.availabilityConfig, overnightConfig);

  const manualJob = await createJob("Part 7 overnight manual request");
  const manualRequest = await api<{ id: number; status: string }>(
    `/api/bays/${fixture.bayId}/bookings`,
    {
      method: "POST",
      token: fixture.mechanic!.token,
      body: { jobId: manualJob.id, startTime: "2099-12-07T20:00:00.000Z", estimatedHours: 2 },
    },
  );
  assert.equal(manualRequest.response.status, 201);
  assert.equal(manualRequest.body.status, "pending");
  fixture.bookingIds.push(manualRequest.body.id);

  const outsideJob = await createJob("Part 7 outside availability");
  const outsideRequest = await api(
    `/api/bays/${fixture.bayId}/bookings`,
    {
      method: "POST",
      token: fixture.mechanic!.token,
      body: { jobId: outsideJob.id, startTime: "2099-12-08T10:00:00.000Z", estimatedHours: 1 },
    },
  );
  assert.equal(outsideRequest.response.status, 400);

  const autoJob = await createJob("Part 7 overnight auto request");
  const autoRequest = await api<{ id: number; status: string }>(
    `/api/bays/${fixture.autoBayId}/bookings`,
    {
      method: "POST",
      token: fixture.mechanic!.token,
      body: { jobId: autoJob.id, startTime: "2099-12-08T01:00:00.000Z", estimatedHours: 2 },
    },
  );
  assert.equal(autoRequest.response.status, 201);
  assert.equal(autoRequest.body.status, "reserved");
  fixture.bookingIds.push(autoRequest.body.id);

  const approved = await api<{ status: string }>(
    `/api/bookings/${manualRequest.body.id}/approve`,
    { method: "PATCH", token: fixture.owner!.token },
  );
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.status, "reserved");
});
