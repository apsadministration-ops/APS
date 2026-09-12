/**
 * Opt-in real development-DB coverage for Partner Part 5.
 *
 *   RUN_PARTNER_SERVICE_REQUESTS_INTEGRATION=1 \
 *     pnpm --filter @workspace/api-server run test:partner-service-requests
 *
 * The suite creates only synthetic example.test fixtures and removes them in
 * dependency order in `finally`. Apply the reviewed additive migration first.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

const enabled =
  process.env.RUN_PARTNER_SERVICE_REQUESTS_INTEGRATION === "1" &&
  process.env.NODE_ENV !== "production" &&
  Boolean(process.env.DATABASE_URL);
const stamp = String(Date.now()).slice(-8);

type ApiResult<T = Record<string, unknown>> = { response: Response; body: T };
type Identity = { id: number; token: string; email: string };

const fixture: {
  baseUrl: string;
  server?: {
    close(callback: () => void): void;
    closeAllConnections?: () => void;
    address(): { port: number } | string | null;
  };
  pool?: { end(): Promise<void> };
  db?: any;
  usersTable?: any;
  shopsTable?: any;
  vehiclesTable?: any;
  ownershipTable?: any;
  organizationsTable?: any;
  operationsTable?: any;
  requestsTable?: any;
  historyTable?: any;
  users: Identity[];
  organizationIds: number[];
  shopIds: number[];
  vehicleIds: number[];
} = {
  baseUrl: "",
  users: [],
  organizationIds: [],
  shopIds: [],
  vehicleIds: [],
};

async function api<T = Record<string, unknown>>(
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
  label: string,
): Promise<Identity> {
  const email = `part5-${stamp}-${label}@example.test`;
  const result = await api<{ token: string; user: { id: number } }>(
    "/api/auth/register",
    {
      method: "POST",
      body: {
        name: `Part 5 ${stamp}-${label}`,
        email,
        password: "PartnerRequestTest!2026",
        role,
        phone: "+15550123456",
        address: "100 Main Street",
        city: "Brooklyn",
        region: "NY",
        zipCode: "11201",
      },
    },
  );
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  const identity = { id: result.body.user.id, email, token: result.body.token };
  fixture.users.push(identity);
  return identity;
}

async function organization(
  token: string,
  subtype: "dealership" | "fleet",
  label: string,
) {
  const result = await api<{ id: number }>(
    "/api/partner-organizations",
    {
      method: "POST",
      token,
      body: {
        name: `Part 5 ${stamp}-${label}`,
        subtype,
        phone: "+15550120000",
        email: `part5-org-${stamp}-${label}@example.test`,
        address: "200 Industry Avenue",
        city: "Brooklyn",
        region: "NY",
        zipCode: "11231",
      },
    },
  );
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  fixture.organizationIds.push(result.body.id);
  return result.body;
}

async function location(token: string, label: string) {
  const result = await api<{ id: number }>(
    "/api/shops",
    {
      method: "POST",
      token,
      body: {
        partnerKind: "independent_shop",
        name: `Part 5 location ${stamp}-${label}`,
        address: "300 Legacy Road",
        city: "Brooklyn",
        region: "NY",
        zipCode: "11232",
      },
    },
  );
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  fixture.shopIds.push(result.body.id);
  return result.body;
}

async function linkLocation(token: string, organizationId: number, shopId: number) {
  const result = await api(
    `/api/partner-organizations/${organizationId}/locations`,
    { method: "POST", token, body: { shopId } },
  );
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
}

function canonical(vinSuffix: string) {
  return {
    vin: `1HGCM82${stamp.slice(-7)}${vinSuffix}`,
    make: "Honda",
    model: "Accord",
    year: 2023,
    mileage: 1200,
  };
}

async function createOperation(
  token: string,
  organizationId: number,
  locationId: number,
  subtype: "dealership" | "fleet",
  vinSuffix: string,
) {
  const body =
    subtype === "dealership"
      ? {
          ...canonical(vinSuffix),
          linkedShopId: locationId,
          stockNumber: `D-${stamp}-${vinSuffix}`,
          inventoryStatus: "in_stock",
          serviceNeeded: false,
        }
      : {
          ...canonical(vinSuffix),
          linkedShopId: locationId,
          unitNumber: `U-${stamp}-${vinSuffix}`,
          groupName: "North route",
          operatingStatus: "active",
          odometer: 12000,
          usageHours: 400,
          maintenanceDueDate: "2027-03-01",
          maintenanceDueMileage: 15000,
          notes: "Synthetic fixture",
        };
  const result = await api<{
    id: number;
    vehicleId: number;
    linkedShopId: number;
  }>(
    `/api/partner-organizations/${organizationId}/vehicle-operations`,
    { method: "POST", token, body },
  );
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  fixture.vehicleIds.push(result.body.vehicleId);
  return result.body;
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
  fixture.vehiclesTable = database.vehiclesTable;
  fixture.ownershipTable = database.ownershipTable;
  fixture.organizationsTable = database.partnerOrganizationsTable;
  fixture.operationsTable = database.partnerVehicleOperationsTable;
  fixture.requestsTable = database.partnerServiceRequestsTable;
  fixture.historyTable = database.partnerServiceRequestStatusHistoryTable;

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  fixture.server = await new Promise<any>((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
  const address = fixture.server.address();
  assert.ok(address && typeof address === "object");
  fixture.baseUrl = `http://127.0.0.1:${address.port}`;
  await register("shop_owner", "owner-a");
  await register("shop_owner", "owner-b");
  await register("customer", "customer");
  await register("mechanic", "mechanic");
});

after(async () => {
  if (!enabled) return;
  let cleanupError: unknown;
  try {
    const { inArray, like } = await import("drizzle-orm");
    if (fixture.db) {
      const runRequests = await fixture.db
        .select({ id: fixture.requestsTable.id })
        .from(fixture.requestsTable)
        .where(like(fixture.requestsTable.clientRequestId, `part5-${stamp}-%`));
      const requestIds = runRequests.map((row: { id: number }) => row.id);
      if (requestIds.length) {
        await fixture.db
          .delete(fixture.historyTable)
          .where(inArray(fixture.historyTable.requestId, requestIds));
        await fixture.db
          .delete(fixture.requestsTable)
          .where(inArray(fixture.requestsTable.id, requestIds));
      }

      const runVehicles = await fixture.db
        .select({ id: fixture.vehiclesTable.id })
        .from(fixture.vehiclesTable)
        .where(like(fixture.vehiclesTable.vin, `1HGCM82${stamp.slice(-7)}%`));
      const vehicleIds = [...new Set([
        ...fixture.vehicleIds,
        ...runVehicles.map((row: { id: number }) => row.id),
      ])];
      if (vehicleIds.length) {
        await fixture.db
          .delete(fixture.operationsTable)
          .where(inArray(fixture.operationsTable.vehicleId, vehicleIds));
        await fixture.db
          .delete(fixture.vehiclesTable)
          .where(inArray(fixture.vehiclesTable.id, vehicleIds));
      }

      const runShops = await fixture.db
        .select({ id: fixture.shopsTable.id })
        .from(fixture.shopsTable)
        .where(like(fixture.shopsTable.name, `Part 5 location ${stamp}-%`));
      const shopIds = [...new Set([
        ...fixture.shopIds,
        ...runShops.map((row: { id: number }) => row.id),
      ])];
      if (shopIds.length) {
        await fixture.db
          .delete(fixture.shopsTable)
          .where(inArray(fixture.shopsTable.id, shopIds));
      }

      const runOrganizations = await fixture.db
        .select({ id: fixture.organizationsTable.id })
        .from(fixture.organizationsTable)
        .where(like(fixture.organizationsTable.name, `Part 5 ${stamp}-%`));
      const organizationIds = [...new Set([
        ...fixture.organizationIds,
        ...runOrganizations.map((row: { id: number }) => row.id),
      ])];
      if (organizationIds.length) {
        await fixture.db
          .delete(fixture.organizationsTable)
          .where(inArray(fixture.organizationsTable.id, organizationIds));
      }

      const runUsers = await fixture.db
        .select({ id: fixture.usersTable.id })
        .from(fixture.usersTable)
        .where(like(fixture.usersTable.email, `part5-${stamp}-%`));
      const userIds = [...new Set([
        ...fixture.users.map((user) => user.id),
        ...runUsers.map((row: { id: number }) => row.id),
      ])];
      if (userIds.length) {
        await fixture.db
          .delete(fixture.usersTable)
          .where(inArray(fixture.usersTable.id, userIds));
      }
    }
  } catch (error) {
    cleanupError = error;
  } finally {
    fixture.server?.closeAllConnections?.();
    if (fixture.server) {
      await Promise.race([
        new Promise<void>((resolve) => fixture.server?.close(resolve)),
        new Promise<void>((resolve) => setTimeout(resolve, 1000)),
      ]);
    }
    try {
      await fixture.pool?.end();
    } catch (error) {
      cleanupError ??= error;
    }
  }
  if (cleanupError) throw cleanupError;
});

test(
  "covers dealer/fleet create, exact context, filters, reload, idempotency, and ownership isolation",
  { skip: !enabled },
  async () => {
    const ownerA = fixture.users[0];
    const ownerB = fixture.users[1];
    const customer = fixture.users[2];
    const mechanic = fixture.users[3];
    assert.ok(ownerA && ownerB && customer && mechanic);

    const dealer = await organization(ownerA.token, "dealership", "dealer");
    const fleet = await organization(ownerA.token, "fleet", "fleet");
    const otherOrg = await organization(ownerB.token, "fleet", "other");
    const dealerLocation = await location(ownerA.token, "dealer");
    const secondLocation = await location(ownerA.token, "second");
    const fleetLocation = await location(ownerA.token, "fleet");
    const otherLocation = await location(ownerB.token, "other");
    await linkLocation(ownerA.token, dealer.id, dealerLocation.id);
    await linkLocation(ownerA.token, dealer.id, secondLocation.id);
    await linkLocation(ownerA.token, fleet.id, fleetLocation.id);
    await linkLocation(ownerB.token, otherOrg.id, otherLocation.id);

    const dealerOperation = await createOperation(
      ownerA.token,
      dealer.id,
      dealerLocation.id,
      "dealership",
      "A01",
    );
    const fleetOperation = await createOperation(
      ownerA.token,
      fleet.id,
      fleetLocation.id,
      "fleet",
      "A02",
    );

    assert.equal(
      (
        await api(`/api/partner-organizations/999999999/service-requests`, {
          token: ownerA.token,
        })
      ).response.status,
      404,
    );
    assert.equal(
      (
        await api(`/api/partner-organizations/${dealer.id}/service-requests`, {
          method: "POST",
          token: ownerA.token,
          body: {
            operationId: 999999999,
            locationId: dealerLocation.id,
            category: "maintenance",
            urgency: "normal",
            requestedWork: "Unknown vehicle operation",
            clientRequestId: `part5-${stamp}-unknown-operation`,
          },
        })
      ).response.status,
      404,
    );
    assert.equal(
      (
        await api(`/api/partner-organizations/${dealer.id}/service-requests`, {
          method: "POST",
          token: ownerA.token,
          body: {
            operationId: dealerOperation.id,
            locationId: 999999999,
            category: "maintenance",
            urgency: "normal",
            requestedWork: "Unknown location",
            clientRequestId: `part5-${stamp}-unknown-location`,
          },
        })
      ).response.status,
      404,
    );

    const create = await api<{
      id: number;
      status: string;
      version: number;
      vehicleId: number;
      sourceSubtype: string;
      creationContext: {
        vehicle: Record<string, unknown>;
        operation: Record<string, unknown>;
      };
    }>(
      `/api/partner-organizations/${dealer.id}/service-requests`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          operationId: dealerOperation.id,
          locationId: dealerLocation.id,
          category: "maintenance",
          urgency: "normal",
          requestedWork: "Replace oil and filter",
          serviceNotes: "Use approved lubricant",
          clientRequestId: `part5-${stamp}-dealer`,
          vin: "must-not-be-accepted",
        },
      },
    );
    assert.equal(create.response.status, 400);
    const created = await api<{
      id: number;
      status: string;
      version: number;
      vehicleId: number;
      sourceSubtype: string;
      creationContext: {
        vehicle: Record<string, unknown>;
        operation: Record<string, unknown>;
      };
    }>(
      `/api/partner-organizations/${dealer.id}/service-requests`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          operationId: dealerOperation.id,
          locationId: dealerLocation.id,
          category: "maintenance",
          urgency: "normal",
          requestedWork: "Replace oil and filter",
          serviceNotes: "Use approved lubricant",
          clientRequestId: `part5-${stamp}-dealer`,
        },
      },
    );
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.status, "draft");
    assert.equal(created.body.version, 0);
    assert.equal(created.body.vehicleId, dealerOperation.vehicleId);
    assert.equal(created.body.sourceSubtype, "dealership");
    assert.deepEqual(Object.keys(created.body.creationContext.operation).sort(), [
      "inventoryStatus",
      "serviceNeeded",
      "serviceNotes",
      "stockNumber",
    ]);
    assert.deepEqual(Object.keys(created.body.creationContext.vehicle).sort(), [
      "color",
      "make",
      "mileage",
      "model",
      "plateNumber",
      "trim",
      "vin",
      "year",
    ]);

    const replay = await api(
      `/api/partner-organizations/${dealer.id}/service-requests`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          operationId: dealerOperation.id,
          locationId: dealerLocation.id,
          category: "maintenance",
          urgency: "normal",
          requestedWork: "Replace oil and filter",
          serviceNotes: "Use approved lubricant",
          clientRequestId: `part5-${stamp}-dealer`,
        },
      },
    );
    assert.equal(replay.response.status, 200);
    assert.equal((replay.body as { id: number }).id, created.body.id);
    const conflict = await api(
      `/api/partner-organizations/${dealer.id}/service-requests`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          operationId: dealerOperation.id,
          locationId: dealerLocation.id,
          category: "repair",
          urgency: "urgent",
          requestedWork: "Different content",
          clientRequestId: `part5-${stamp}-dealer`,
        },
      },
    );
    assert.equal(conflict.response.status, 409);

    const fleetRequest = await api<{
      id: number;
      sourceSubtype: string;
      creationContext: { operation: Record<string, unknown> };
    }>(
      `/api/partner-organizations/${fleet.id}/service-requests`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          operationId: fleetOperation.id,
          locationId: fleetLocation.id,
          category: "inspection",
          urgency: "high",
          requestedWork: "Inspect tires",
          clientRequestId: `part5-${stamp}-fleet`,
        },
      },
    );
    assert.equal(fleetRequest.response.status, 201, JSON.stringify(fleetRequest.body));
    assert.equal(fleetRequest.body.sourceSubtype, "fleet");
    assert.deepEqual(Object.keys(fleetRequest.body.creationContext.operation).sort(), [
      "downtimeSince",
      "groupName",
      "maintenanceDueDate",
      "maintenanceDueMileage",
      "notes",
      "odometer",
      "operatingStatus",
      "unitNumber",
      "usageHours",
    ]);

    const list = await api<Array<{ id: number }>>(
      `/api/partner-organizations/${dealer.id}/service-requests?status=draft&urgency=normal&vehicleId=${dealerOperation.vehicleId}&locationId=${dealerLocation.id}&q=oil&limit=10`,
      { token: ownerA.token },
    );
    assert.equal(list.response.status, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.map((request) => request.id), [created.body.id]);
    assert.equal(
      (await api(`/api/partner-organizations/${dealer.id}/service-requests?unknown=x`, { token: ownerA.token })).response.status,
      400,
    );
    assert.equal(
      (await api(`/api/partner-organizations/${dealer.id}/service-requests?vehicleId=1.5`, { token: ownerA.token })).response.status,
      400,
    );

    const detail = await api<{
      request: { version: number; creationContext: unknown };
      statusHistory: Array<{ fromStatus: string | null; toStatus: string }>;
    }>(
      `/api/partner-organizations/${dealer.id}/service-requests/${created.body.id}`,
      { token: ownerA.token },
    );
    assert.equal(detail.response.status, 200);
    assert.equal(detail.body.statusHistory.length, 1);
    assert.equal(detail.body.statusHistory[0].fromStatus, null);
    assert.equal(detail.body.statusHistory[0].toStatus, "draft");
    assert.deepEqual(detail.body.request.creationContext, created.body.creationContext);

    const edited = await api<{ version: number; locationId: number }>(
      `/api/partner-organizations/${dealer.id}/service-requests/${created.body.id}`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: {
          expectedVersion: 0,
          urgency: "urgent",
          locationId: secondLocation.id,
        },
      },
    );
    assert.equal(edited.response.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.version, 1);
    assert.equal(edited.body.locationId, secondLocation.id);
    const staleEdit = await api(
      `/api/partner-organizations/${dealer.id}/service-requests/${created.body.id}`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: { expectedVersion: 0, category: "repair" },
      },
    );
    assert.equal(staleEdit.response.status, 409);
    const immutableEdit = await api(
      `/api/partner-organizations/${dealer.id}/service-requests/${created.body.id}`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: { expectedVersion: 1, vehicleId: fleetOperation.vehicleId },
      },
    );
    assert.equal(immutableEdit.response.status, 400);

    const submitted = await api<{ version: number; status: string }>(
      `/api/partner-organizations/${dealer.id}/service-requests/${created.body.id}/transition`,
      {
        method: "POST",
        token: ownerA.token,
        body: { expectedVersion: 1, toStatus: "submitted", note: "Ready" },
      },
    );
    assert.equal(submitted.response.status, 200);
    assert.equal(submitted.body.status, "submitted");
    assert.equal(submitted.body.version, 2);
    const inProgress = await api<{ version: number; status: string }>(
      `/api/partner-organizations/${dealer.id}/service-requests/${created.body.id}/transition`,
      {
        method: "POST",
        token: ownerA.token,
        body: { expectedVersion: 2, toStatus: "in_progress" },
      },
    );
    assert.equal(inProgress.response.status, 200);
    const completed = await api<{ version: number; status: string }>(
      `/api/partner-organizations/${dealer.id}/service-requests/${created.body.id}/transition`,
      {
        method: "POST",
        token: ownerA.token,
        body: { expectedVersion: 3, toStatus: "completed" },
      },
    );
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.status, "completed");
    assert.equal(
      (await api(
        `/api/partner-organizations/${dealer.id}/service-requests/${created.body.id}`,
        {
          method: "PATCH",
          token: ownerA.token,
          body: { expectedVersion: 4, urgency: "low" },
        },
      )).response.status,
      409,
    );

    const cancelled = await api<{ id: number; version: number }>(
      `/api/partner-organizations/${fleet.id}/service-requests`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          operationId: fleetOperation.id,
          locationId: fleetLocation.id,
          category: "repair",
          urgency: "low",
          requestedWork: "Cancel test",
          clientRequestId: `part5-${stamp}-cancel`,
        },
      },
    );
    assert.equal(cancelled.response.status, 201);

    const detailRaceRequest = await api<{ id: number }>(
      `/api/partner-organizations/${fleet.id}/service-requests`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          operationId: fleetOperation.id,
          locationId: fleetLocation.id,
          category: "inspection",
          urgency: "normal",
          requestedWork: "Concurrent detail test",
          clientRequestId: `part5-${stamp}-detail-race`,
        },
      },
    );
    assert.equal(detailRaceRequest.response.status, 201);
    type DetailRaceBody = {
      request: { status: string; version: number };
      statusHistory: Array<{ toStatus: string }>;
    };
    const detailReads = Promise.all(
      Array.from({ length: 8 }, () =>
        api<DetailRaceBody>(
          `/api/partner-organizations/${fleet.id}/service-requests/${detailRaceRequest.body.id}`,
          { token: ownerA.token },
        ),
      ),
    );
    const transitionSequence = (async () => {
      for (const [expectedVersion, toStatus] of [
        [0, "submitted"],
        [1, "in_progress"],
        [2, "completed"],
      ] as const) {
        const transition = await api(
          `/api/partner-organizations/${fleet.id}/service-requests/${detailRaceRequest.body.id}/transition`,
          {
            method: "POST",
            token: ownerA.token,
            body: { expectedVersion, toStatus },
          },
        );
        assert.equal(transition.response.status, 200, JSON.stringify(transition.body));
      }
    })();
    const [detailRaceResults] = await Promise.all([
      detailReads,
      transitionSequence,
    ]);
    for (const detailRace of detailRaceResults) {
      assert.equal(detailRace.response.status, 200, JSON.stringify(detailRace.body));
      const history = detailRace.body.statusHistory;
      assert.ok(history.length > 0);
      assert.equal(history.at(-1)?.toStatus, detailRace.body.request.status);
      assert.ok(history.length <= detailRace.body.request.version + 1);
    }
    const finalDetailRace = await api<DetailRaceBody>(
      `/api/partner-organizations/${fleet.id}/service-requests/${detailRaceRequest.body.id}`,
      { token: ownerA.token },
    );
    assert.equal(finalDetailRace.response.status, 200);
    assert.equal(finalDetailRace.body.request.status, "completed");
    assert.equal(finalDetailRace.body.request.version, 3);
    assert.equal(finalDetailRace.body.statusHistory.at(-1)?.toStatus, "completed");

    const [transitionRaceA, transitionRaceB] = await Promise.all([
      api(
        `/api/partner-organizations/${fleet.id}/service-requests/${cancelled.body.id}/transition`,
        {
          method: "POST",
          token: ownerA.token,
          body: { expectedVersion: 0, toStatus: "submitted" },
        },
      ),
      api(
        `/api/partner-organizations/${fleet.id}/service-requests/${cancelled.body.id}/transition`,
        {
          method: "POST",
          token: ownerA.token,
          body: { expectedVersion: 0, toStatus: "submitted" },
        },
      ),
    ]);
    assert.deepEqual(
      [transitionRaceA.response.status, transitionRaceB.response.status].sort(),
      [200, 409],
    );
    assert.equal(
      (await api(
        `/api/partner-organizations/${fleet.id}/service-requests/${cancelled.body.id}/transition`,
        {
          method: "POST",
          token: ownerA.token,
          body: { expectedVersion: 1, toStatus: "cancelled" },
        },
      )).response.status,
      200,
    );

    assert.equal(
      (await api(
        `/api/partner-organizations/${dealer.id}/service-requests`,
        { token: ownerB.token },
      )).response.status,
      404,
    );
    assert.equal(
      (await api(
        `/api/partner-organizations/${dealer.id}/service-requests`,
        { token: customer.token },
      )).response.status,
      403,
    );
    assert.equal(
      (await api(
        `/api/partner-organizations/${dealer.id}/service-requests`,
        { token: mechanic.token },
      )).response.status,
      403,
    );
    assert.equal(
      (await api(
        `/api/partner-organizations/${dealer.id}/service-requests`,
        {
          method: "POST",
          token: ownerA.token,
          body: {
            operationId: fleetOperation.id,
            locationId: dealerLocation.id,
            category: "repair",
            urgency: "normal",
            requestedWork: "Cross organization",
            clientRequestId: `part5-${stamp}-cross`,
          },
        },
      )).response.status,
      404,
    );

    const { eq } = await import("drizzle-orm");
    const operationBefore = (await fixture.db
      .select()
      .from(fixture.operationsTable)
      .where(eq(fixture.operationsTable.id, dealerOperation.id)))[0];
    const ownershipBefore = await fixture.db
      .select()
      .from(fixture.ownershipTable)
      .where(eq(fixture.ownershipTable.vehicleId, dealerOperation.vehicleId));
    const inactive = await fixture.db
      .update(fixture.organizationsTable)
      .set({ status: "inactive" })
      .where(eq(fixture.organizationsTable.id, dealer.id))
      .returning();
    assert.equal(inactive.length, 1);
    assert.equal(
      (await api(`/api/partner-organizations/${dealer.id}/service-requests`, { token: ownerA.token })).response.status,
      200,
    );
    assert.equal(
      (await api(
        `/api/partner-organizations/${dealer.id}/service-requests/${created.body.id}/transition`,
        {
          method: "POST",
          token: ownerA.token,
          body: { expectedVersion: 4, toStatus: "cancelled" },
        },
      )).response.status,
      409,
    );
    await fixture.db
      .update(fixture.organizationsTable)
      .set({ status: "active" })
      .where(eq(fixture.organizationsTable.id, dealer.id));
    const operationAfter = (await fixture.db
      .select()
      .from(fixture.operationsTable)
      .where(eq(fixture.operationsTable.id, dealerOperation.id)))[0];
    assert.deepEqual(operationAfter, operationBefore);
    const ownershipAfter = await fixture.db
      .select()
      .from(fixture.ownershipTable)
      .where(eq(fixture.ownershipTable.vehicleId, dealerOperation.vehicleId));
    assert.deepEqual(ownershipAfter, ownershipBefore);
  },
);