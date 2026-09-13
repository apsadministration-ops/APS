/**
 * Opt-in Part 6 real-database coverage.
 *
 * The main agent must apply the reviewed additive Part 6 migration before
 * running this suite:
 *
 *   RUN_PARTNER_COMMERCIAL_INTEGRATION=1 \
 *     pnpm --filter @workspace/api-server run test:partner-commercial
 *
 * No database test is run by default.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";

const enabled =
  process.env.RUN_PARTNER_COMMERCIAL_INTEGRATION === "1" &&
  process.env.NODE_ENV !== "production" &&
  Boolean(process.env.DATABASE_URL);

type ApiResult<T = any> = { response: Response; body: T };

const fixture: {
  app?: any;
  db?: any;
  pool?: { end(): Promise<void> };
  tables?: Record<string, any>;
  ownerId?: number;
  otherOwnerId?: number;
  mechanicId?: number;
  organizationId?: number;
  shopId?: number;
  vehicleId?: number;
  operationId?: number;
  requestId?: number;
  jobId?: number;
  ownerToken?: string;
  otherOwnerToken?: string;
  mechanicToken?: string;
  fleet?: {
    organizationId: number;
    shopId: number;
    vehicleId: number;
    operationId: number;
    requestId: number;
    jobId?: number;
  };
} = {};

async function api<T = any>(
  path: string,
  options: { method?: string; token?: string; body?: Record<string, unknown> } = {},
): Promise<ApiResult<T>> {
  const response = await fixture.app!.request({
    method: options.method ?? "GET",
    path,
    headers: {
      accept: "application/json",
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body,
  });
  return { response, body: response.body };
}

before(async () => {
  if (!enabled) return;
  const [{ default: express }, { default: router }, database, auth] = await Promise.all([
    import("express"),
    import("../src/routes/index.ts"),
    import("@workspace/db"),
    import("../src/lib/auth.ts"),
  ]);
  fixture.db = database.db;
  fixture.pool = database.pool;
  fixture.tables = database;
  // Supertest is intentionally not a production dependency. The tiny request
  // adapter below keeps this opt-in suite independent of an extra package.
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  fixture.app = {
    request: async (input: { method: string; path: string; headers: Record<string, string>; body?: unknown }) => {
      const http = await import("node:http");
      return new Promise<any>((resolve, reject) => {
        const server = http.createServer(app);
        server.listen(0, "127.0.0.1", async () => {
          const address = server.address() as { port: number };
          const response = await fetch(`http://127.0.0.1:${address.port}${input.path}`, {
            method: input.method,
            headers: input.headers,
            body: input.body === undefined ? undefined : JSON.stringify(input.body),
          });
          const body = await response.json().catch(() => null);
          server.close();
          resolve({ status: response.status, body });
        });
        server.on("error", reject);
      });
    },
  };

  const passwordHash = await auth.hashPassword("Part6CommercialTest!2026");
  const [owner] = await fixture.db.insert(database.usersTable).values({
    name: "Part 6 Commercial Owner",
    email: `part6-owner-${Date.now()}@example.test`,
    passwordHash,
    role: "shop_owner",
    status: "active",
  }).returning();
  const [otherOwner] = await fixture.db.insert(database.usersTable).values({
    name: "Part 6 Unrelated Owner",
    email: `part6-other-${Date.now()}@example.test`,
    passwordHash,
    role: "shop_owner",
    status: "active",
  }).returning();
  const [mechanic] = await fixture.db.insert(database.usersTable).values({
    name: "Part 6 Detailer",
    email: `part6-mechanic-${Date.now()}@example.test`,
    passwordHash,
    role: "mechanic",
    status: "active",
    mechanicTier: "technician",
  }).returning();
  fixture.ownerId = owner.id;
  fixture.otherOwnerId = otherOwner.id;
  fixture.mechanicId = mechanic.id;
  fixture.ownerToken = auth.signToken({ userId: owner.id, role: owner.role });
  fixture.otherOwnerToken = auth.signToken({ userId: otherOwner.id, role: otherOwner.role });
  fixture.mechanicToken = auth.signToken({ userId: mechanic.id, role: mechanic.role });

  const [organization] = await fixture.db.insert(database.partnerOrganizationsTable).values({
    primaryOwnerId: owner.id,
    name: "Part 6 Dealership",
    subtype: "dealership",
    phone: "+15550123456",
    email: `part6-org-${Date.now()}@example.test`,
    address: "100 Commercial Way",
    city: "Brooklyn",
    region: "NY",
    zipCode: "11201",
    status: "active",
  }).returning();
  fixture.organizationId = organization.id;
  const [shop] = await fixture.db.insert(database.shopsTable).values({
    ownerId: owner.id,
    organizationId: organization.id,
    partnerKind: "dealership",
    name: "Part 6 Service Location",
    address: "200 Service Road",
    city: "Brooklyn",
    region: "NY",
    zipCode: "11202",
    status: "active",
  }).returning();
  fixture.shopId = shop.id;
  const [vehicle] = await fixture.db.insert(database.vehiclesTable).values({
    vin: `1HGCM82633A${String(Date.now()).slice(-6)}`,
    make: "Honda",
    model: "Accord",
    year: 2023,
    mileage: 1000,
    ownerShopId: shop.id,
  }).returning();
  fixture.vehicleId = vehicle.id;
  const [operation] = await fixture.db.insert(database.partnerVehicleOperationsTable).values({
    organizationId: organization.id,
    vehicleId: vehicle.id,
    linkedShopId: shop.id,
    stockNumber: "PART6-001",
    inventoryStatus: "in_stock",
    serviceNeeded: true,
  }).returning();
  fixture.operationId = operation.id;
  const [request] = await fixture.db.insert(database.partnerServiceRequestsTable).values({
    organizationId: organization.id,
    operationId: operation.id,
    vehicleId: vehicle.id,
    sourceSubtype: "dealership",
    locationId: shop.id,
    status: "submitted",
    category: "other",
    urgency: "normal",
    requestedWork: "Exterior wash for delivery",
    serviceNotes: "Internal unit code MUST NOT reach mechanics",
    creationContext: { source: "part6-test" },
    clientRequestId: `part6-${Date.now()}`,
    creationFingerprint: "part6-test",
    version: 0,
  }).returning();
  fixture.requestId = request.id;
  await fixture.db.insert(database.partnerServiceRequestStatusHistoryTable).values({
    requestId: request.id,
    actorUserId: owner.id,
    fromStatus: "draft",
    toStatus: "submitted",
    note: null,
  });

  const [fleetOrganization] = await fixture.db.insert(database.partnerOrganizationsTable).values({
    primaryOwnerId: owner.id,
    name: "Part 6 Fleet",
    subtype: "fleet",
    phone: "+15550123457",
    email: `part6-fleet-${Date.now()}@example.test`,
    address: "300 Fleet Way",
    city: "Brooklyn",
    region: "NY",
    zipCode: "11203",
    status: "active",
  }).returning();
  const [fleetShop] = await fixture.db.insert(database.shopsTable).values({
    ownerId: owner.id,
    organizationId: fleetOrganization.id,
    partnerKind: "fleet",
    name: "Part 6 Fleet Service Location",
    address: "400 Fleet Service Road",
    city: "Brooklyn",
    region: "NY",
    zipCode: "11204",
    status: "active",
  }).returning();
  const [fleetVehicle] = await fixture.db.insert(database.vehiclesTable).values({
    vin: `1HGCM82633B${String(Date.now()).slice(-6)}`,
    make: "Ford",
    model: "Transit",
    year: 2022,
    mileage: 32000,
    ownerShopId: fleetShop.id,
  }).returning();
  const [fleetOperation] = await fixture.db.insert(database.partnerVehicleOperationsTable).values({
    organizationId: fleetOrganization.id,
    vehicleId: fleetVehicle.id,
    linkedShopId: fleetShop.id,
    stockNumber: "FLEET-001",
    inventoryStatus: "in_stock",
    serviceNeeded: true,
  }).returning();
  const [fleetRequest] = await fixture.db.insert(database.partnerServiceRequestsTable).values({
    organizationId: fleetOrganization.id,
    operationId: fleetOperation.id,
    vehicleId: fleetVehicle.id,
    sourceSubtype: "fleet",
    locationId: fleetShop.id,
    status: "submitted",
    category: "maintenance",
    urgency: "high",
    requestedWork: "Scheduled fleet oil service",
    serviceNotes: "Fleet unit number MUST NOT reach mechanics",
    creationContext: { source: "part6-fleet-test" },
    clientRequestId: `part6-fleet-${Date.now()}`,
    creationFingerprint: "part6-fleet-test",
    version: 0,
  }).returning();
  await fixture.db.insert(database.partnerServiceRequestStatusHistoryTable).values({
    requestId: fleetRequest.id,
    actorUserId: owner.id,
    fromStatus: "draft",
    toStatus: "submitted",
    note: null,
  });
  fixture.fleet = {
    organizationId: fleetOrganization.id,
    shopId: fleetShop.id,
    vehicleId: fleetVehicle.id,
    operationId: fleetOperation.id,
    requestId: fleetRequest.id,
  };
});

after(async () => {
  if (!enabled || !fixture.db || !fixture.tables) return;
  const { db, tables } = { db: fixture.db, tables: fixture.tables };
  await db.transaction(async (tx: any) => {
    if (fixture.fleet?.jobId) {
      await tx.update(tables.partnerServiceRequestsTable)
        .set({ linkedApsJobId: null, linkedAt: null, sendToApsFingerprint: null })
        .where(eq(tables.partnerServiceRequestsTable.id, fixture.fleet.requestId));
      await tx.delete(tables.partsItemsTable).where(eq(tables.partsItemsTable.jobId, fixture.fleet.jobId));
      await tx.delete(tables.workLogsTable).where(eq(tables.workLogsTable.jobId, fixture.fleet.jobId));
      await tx.delete(tables.customerApprovalsTable).where(eq(tables.customerApprovalsTable.jobId, fixture.fleet.jobId));
      await tx.delete(tables.workConfirmationsTable).where(eq(tables.workConfirmationsTable.jobId, fixture.fleet.jobId));
      await tx.delete(tables.paymentsTable).where(eq(tables.paymentsTable.jobId, fixture.fleet.jobId));
      await tx.delete(tables.jobsTable).where(eq(tables.jobsTable.id, fixture.fleet.jobId));
    }
    if (fixture.fleet) {
      await tx.delete(tables.partnerServiceRequestStatusHistoryTable)
        .where(eq(tables.partnerServiceRequestStatusHistoryTable.requestId, fixture.fleet.requestId));
      await tx.delete(tables.partnerServiceRequestsTable)
        .where(eq(tables.partnerServiceRequestsTable.id, fixture.fleet.requestId));
      await tx.delete(tables.partnerVehicleOperationsTable)
        .where(eq(tables.partnerVehicleOperationsTable.id, fixture.fleet.operationId));
      await tx.delete(tables.vehiclesTable).where(eq(tables.vehiclesTable.id, fixture.fleet.vehicleId));
      await tx.delete(tables.shopsTable).where(eq(tables.shopsTable.id, fixture.fleet.shopId));
      await tx.delete(tables.partnerOrganizationsTable)
        .where(eq(tables.partnerOrganizationsTable.id, fixture.fleet.organizationId));
    }
    if (fixture.jobId) {
      await tx.update(tables.partnerServiceRequestsTable)
        .set({ linkedApsJobId: null, linkedAt: null, sendToApsFingerprint: null })
        .where(eq(tables.partnerServiceRequestsTable.id, fixture.requestId));
      await tx.delete(tables.partsItemsTable).where(eq(tables.partsItemsTable.jobId, fixture.jobId));
      await tx.delete(tables.workLogsTable).where(eq(tables.workLogsTable.jobId, fixture.jobId));
      await tx.delete(tables.customerApprovalsTable).where(eq(tables.customerApprovalsTable.jobId, fixture.jobId));
      await tx.delete(tables.workConfirmationsTable).where(eq(tables.workConfirmationsTable.jobId, fixture.jobId));
      await tx.delete(tables.paymentsTable).where(eq(tables.paymentsTable.jobId, fixture.jobId));
      await tx.delete(tables.jobsTable).where(eq(tables.jobsTable.id, fixture.jobId));
    }
    if (fixture.requestId) {
      await tx.delete(tables.partnerServiceRequestStatusHistoryTable)
        .where(eq(tables.partnerServiceRequestStatusHistoryTable.requestId, fixture.requestId));
      await tx.delete(tables.partnerServiceRequestsTable)
        .where(eq(tables.partnerServiceRequestsTable.id, fixture.requestId));
    }
    if (fixture.operationId) {
      await tx.delete(tables.partnerVehicleOperationsTable)
        .where(eq(tables.partnerVehicleOperationsTable.id, fixture.operationId));
    }
    if (fixture.vehicleId) await tx.delete(tables.vehiclesTable).where(eq(tables.vehiclesTable.id, fixture.vehicleId));
    if (fixture.shopId) await tx.delete(tables.shopsTable).where(eq(tables.shopsTable.id, fixture.shopId));
    if (fixture.organizationId) {
      await tx.delete(tables.partnerOrganizationsTable).where(eq(tables.partnerOrganizationsTable.id, fixture.organizationId));
    }
    for (const id of [fixture.mechanicId, fixture.otherOwnerId, fixture.ownerId].filter(Boolean)) {
      await tx.delete(tables.usersTable).where(eq(tables.usersTable.id, id!));
    }
  });
  await fixture.pool?.end();
});

test("dealership send bridge is idempotent, owner-scoped, and projects real completion", { skip: !enabled }, async () => {
  const path = `/api/partner-organizations/${fixture.organizationId}/service-requests/${fixture.requestId}/send-to-aps`;
  const first = await api<{ request: any; job: any; replay: boolean }>(path, {
    method: "POST",
    token: fixture.ownerToken,
    body: {
      expectedVersion: 0,
      serviceSlug: "interior_exterior_wash",
      jobType: "detailing",
    },
  });
  assert.equal(first.response.status, 201, JSON.stringify(first.body));
  fixture.jobId = first.body.job.id;
  assert.equal(first.body.job.status, "REQUESTED");
  assert.equal(first.body.job.description, "Exterior wash for delivery");
  assert.equal(first.body.job.commercialSource.subtype, "dealership");
  assert.equal(first.body.job.commercialSource.requestedWork, "Exterior wash for delivery");
  const [storedJob] = await fixture.db.select().from(fixture.tables.jobsTable)
    .where(eq(fixture.tables.jobsTable.id, first.body.job.id));
  assert.equal(storedJob.commissionPctOverride, 15);
  assert.equal(first.body.request.linkedApsJobId, first.body.job.id);

  const replay = await api<{ request: any; job: any; replay: boolean }>(path, {
    method: "POST",
    token: fixture.ownerToken,
    body: { expectedVersion: 0, serviceSlug: "interior_exterior_wash", jobType: "detailing" },
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.body.replay, true);
  assert.equal(replay.body.job.id, fixture.jobId);

  const conflict = await api(path, {
    method: "POST",
    token: fixture.ownerToken,
    body: { expectedVersion: 0, serviceSlug: "full_exterior_detail", jobType: "detailing" },
  });
  assert.equal(conflict.response.status, 409);

  const forbidden = await api(`/api/jobs/${fixture.jobId}`, {
    token: fixture.otherOwnerToken,
  });
  assert.equal(forbidden.response.status, 403);

  const accepted = await api(`/api/jobs/${fixture.jobId}/accept`, {
    method: "POST",
    token: fixture.mechanicToken,
  });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.status, "PENDING_APPROVAL");

  const approved = await api(`/api/approvals/${fixture.jobId}/approve`, {
    method: "POST",
    token: fixture.ownerToken,
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.jobStatus, "ACCEPTED");

  const worklog = await api(`/api/worklogs`, {
    method: "POST",
    token: fixture.mechanicToken,
    body: {
      jobId: fixture.jobId,
      serviceCategory: "detailing",
      serviceDescription: "Exterior wash completed",
      mileageAtService: 1000,
      laborCost: 80,
      partsCost: 0,
      partsUsed: [],
      beforeImages: [],
      afterImages: [],
    },
  });
  assert.equal(worklog.response.status, 201, JSON.stringify(worklog.body));

  const detail = await api<{ request: any; linkedProgress: any }>(
    `/api/partner-organizations/${fixture.organizationId}/service-requests/${fixture.requestId}`,
    { token: fixture.ownerToken },
  );
  assert.equal(detail.response.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.request.status, "submitted");
  assert.equal(detail.body.linkedProgress.apsJob.status, "COMPLETED");
  assert.equal(detail.body.linkedProgress.completion, true);
  assert.equal(detail.body.linkedProgress.worklogs.length, 1);
});

test("fleet send bridge preserves ownership and earnings while projecting real work history", { skip: !enabled }, async () => {
  const fleet = fixture.fleet!;
  const sendPath =
    `/api/partner-organizations/${fleet.organizationId}/service-requests/${fleet.requestId}/send-to-aps`;
  const sendBody = {
    expectedVersion: 0,
    serviceSlug: "oil_change",
    jobType: "maintenance",
  };

  const ownershipBefore = await fixture.db.select().from(fixture.tables.ownershipTable)
    .where(eq(fixture.tables.ownershipTable.vehicleId, fleet.vehicleId));
  const linkedJobCount = async () => (await fixture.db.select().from(fixture.tables.jobsTable)
    .where(eq(fixture.tables.jobsTable.sourceServiceRequestId, fleet.requestId))).length;

  const invalidJobType = await api(sendPath, {
    method: "POST",
    token: fixture.ownerToken,
    body: { expectedVersion: 0, jobType: "not-a-service-category" },
  });
  assert.equal(invalidJobType.response.status, 400);
  assert.equal(await linkedJobCount(), 0);

  await fixture.db.update(fixture.tables.partnerServiceRequestsTable)
    .set({ category: "other" })
    .where(eq(fixture.tables.partnerServiceRequestsTable.id, fleet.requestId));
  const otherWithoutType = await api(sendPath, {
    method: "POST",
    token: fixture.ownerToken,
    body: { expectedVersion: 0 },
  });
  assert.equal(otherWithoutType.response.status, 400);
  assert.equal(await linkedJobCount(), 0);
  await fixture.db.update(fixture.tables.partnerServiceRequestsTable)
    .set({ category: "maintenance" })
    .where(eq(fixture.tables.partnerServiceRequestsTable.id, fleet.requestId));

  await fixture.db.update(fixture.tables.partnerServiceRequestsTable)
    .set({ status: "draft" })
    .where(eq(fixture.tables.partnerServiceRequestsTable.id, fleet.requestId));
  const draft = await api(sendPath, {
    method: "POST",
    token: fixture.ownerToken,
    body: sendBody,
  });
  assert.equal(draft.response.status, 409);

  await fixture.db.update(fixture.tables.partnerServiceRequestsTable)
    .set({ status: "submitted" })
    .where(eq(fixture.tables.partnerServiceRequestsTable.id, fleet.requestId));
  await fixture.db.update(fixture.tables.partnerOrganizationsTable)
    .set({ status: "inactive" })
    .where(eq(fixture.tables.partnerOrganizationsTable.id, fleet.organizationId));
  const inactive = await api(sendPath, {
    method: "POST",
    token: fixture.ownerToken,
    body: sendBody,
  });
  assert.equal(inactive.response.status, 409);
  await fixture.db.update(fixture.tables.partnerOrganizationsTable)
    .set({ status: "active" })
    .where(eq(fixture.tables.partnerOrganizationsTable.id, fleet.organizationId));

  const crossOrganization = await api(
    `/api/partner-organizations/${fixture.organizationId}/service-requests/${fleet.requestId}/send-to-aps`,
    { method: "POST", token: fixture.ownerToken, body: sendBody },
  );
  assert.equal(crossOrganization.response.status, 404);
  const unauthorized = await api(sendPath, {
    method: "POST",
    token: fixture.otherOwnerToken,
    body: sendBody,
  });
  assert.equal(unauthorized.response.status, 404);

  const [first, second] = await Promise.all([
    api<{ request: any; job: any; replay: boolean }>(sendPath, {
      method: "POST",
      token: fixture.ownerToken,
      body: sendBody,
    }),
    api<{ request: any; job: any; replay: boolean }>(sendPath, {
      method: "POST",
      token: fixture.ownerToken,
      body: sendBody,
    }),
  ]);
  assert.deepEqual([first.response.status, second.response.status].sort(), [200, 201]);
  assert.equal(first.body.job.id, second.body.job.id);
  assert.equal(first.body.job.commercialSource.subtype, "fleet");
  assert.equal(first.body.job.jobType, "maintenance");
  assert.equal(first.body.job.description, "Scheduled fleet oil service");
  assert.equal(first.body.job.commercialSource.serviceNotes, undefined);
  fleet.jobId = first.body.job.id;

  const accepted = await api(`/api/jobs/${fleet.jobId}/accept`, {
    method: "POST",
    token: fixture.mechanicToken,
  });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  const approved = await api(`/api/approvals/${fleet.jobId}/approve`, {
    method: "POST",
    token: fixture.ownerToken,
  });
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.jobStatus, "ACCEPTED");

  const worklog = await api(`/api/worklogs`, {
    method: "POST",
    token: fixture.mechanicToken,
    body: {
      jobId: fleet.jobId,
      serviceCategory: "maintenance",
      serviceDescription: "Fleet oil service completed",
      mileageAtService: 32000,
      laborCost: 80,
      partsCost: 0,
      partsUsed: [],
      beforeImages: [],
      afterImages: [],
    },
  });
  assert.equal(worklog.response.status, 201, JSON.stringify(worklog.body));

  const [storedJob] = await fixture.db.select().from(fixture.tables.jobsTable)
    .where(eq(fixture.tables.jobsTable.id, fleet.jobId));
  const [payment] = await fixture.db.select().from(fixture.tables.paymentsTable)
    .where(eq(fixture.tables.paymentsTable.jobId, fleet.jobId));
  assert.equal(storedJob.partnerKindSnapshot, "fleet");
  assert.equal(storedJob.commissionPctOverride, 15);
  assert.equal(payment.amount, 80);
  assert.equal(payment.platformFee, 8);
  assert.equal(payment.mechanicPayout, 72);

  const detail = await api<{ request: any; linkedProgress: any }>(
    `/api/partner-organizations/${fleet.organizationId}/service-requests/${fleet.requestId}`,
    { token: fixture.ownerToken },
  );
  assert.equal(detail.response.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.request.status, "submitted");
  assert.equal(detail.body.linkedProgress.apsJob.status, "COMPLETED");
  assert.equal(detail.body.linkedProgress.completion, true);
  assert.equal(detail.body.linkedProgress.worklogs.length, 1);
  assert.equal(detail.body.linkedProgress.worklogs[0].serviceCategory, "maintenance");

  const ownershipAfter = await fixture.db.select().from(fixture.tables.ownershipTable)
    .where(eq(fixture.tables.ownershipTable.vehicleId, fleet.vehicleId));
  assert.equal(ownershipAfter.length, ownershipBefore.length);
});