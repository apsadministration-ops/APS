/**
 * Opt-in real development-DB coverage for Partner Part 4.
 *
 *   RUN_PARTNER_VEHICLE_OPERATIONS_INTEGRATION=1 \
 *     pnpm --filter @workspace/api-server run test:partner-vehicle-operations
 *
 * The suite creates synthetic example.test accounts and removes only the
 * rows it created. Apply the reviewed additive migration before enabling it.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

const enabled =
  process.env.RUN_PARTNER_VEHICLE_OPERATIONS_INTEGRATION === "1" &&
  process.env.NODE_ENV !== "production" &&
  Boolean(process.env.DATABASE_URL);
const testVinStamp = String(Date.now()).slice(-7);

type ApiResult<T> = { response: Response; body: T };
type Identity = { id: number; email: string; token: string };

const fixture: {
  baseUrl: string;
  server?: {
    close(callback: () => void): void;
    closeAllConnections?: () => void;
  };
  pool?: { end(): Promise<void> };
  db?: any;
  usersTable?: any;
  shopsTable?: any;
  vehiclesTable?: any;
  ownershipTable?: any;
  organizationsTable?: any;
  operationsTable?: any;
  users: Identity[];
  shopIds: number[];
  organizationIds: number[];
  vehicleIds: number[];
  ownershipIds: number[];
} = {
  baseUrl: "",
  users: [],
  shopIds: [],
  organizationIds: [],
  vehicleIds: [],
  ownershipIds: [],
};

async function api<T>(
  path: string,
  options: {
    method?: string;
    token?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<ApiResult<T>> {
  let response: Response;
  response = await fetch(`${fixture.baseUrl}${path}`, {
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
  role: "shop_owner" | "customer",
  suffix: string,
): Promise<Identity> {
  const email = `part4-${testVinStamp}-${suffix}@example.test`;
  const password = "PartnerVehicleTest!2026";
  if (role === "shop_owner") {
    // This is deliberate legacy-owner coverage for unlinked locations. Seed a
    // pre-existing principal and obtain its token through the normal login
    // route; never weaken /auth/register back into person-only business signup.
    const { hashPassword } = await import("../src/lib/auth.ts");
    const [user] = await fixture.db.insert(fixture.usersTable).values({
      name: `Part 4 ${testVinStamp}-${suffix}`,
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
    const login = await api<{ token: string }>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    assert.equal(login.response.status, 200, JSON.stringify(login.body));
    const identity = { id: user.id, email, token: login.body.token };
    fixture.users.push(identity);
    return identity;
  }
  const result = await api<{ token: string; user: { id: number } }>(
    "/api/auth/register",
    {
      method: "POST",
      body: {
        name: `Part 4 ${testVinStamp}-${suffix}`,
        email,
        password,
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
  const identity = { id: result.body.user.id, email, token: result.body.token };
  fixture.users.push(identity);
  return identity;
}

async function cleanupPriorFixtures(): Promise<void> {
  const { inArray, like } = await import("drizzle-orm");
  const oldUsers = await fixture.db.select({ id: fixture.usersTable.id })
    .from(fixture.usersTable)
    .where(like(fixture.usersTable.email, "part4-%@example.test"));
  const oldUserIds = oldUsers.map((row: { id: number }) => row.id);
  if (oldUserIds.length === 0) return;

  const oldOrganizations = await fixture.db
    .select({ id: fixture.organizationsTable.id })
    .from(fixture.organizationsTable)
    .where(inArray(fixture.organizationsTable.primaryOwnerId, oldUserIds));
  const oldOrganizationIds = oldOrganizations.map((row: { id: number }) => row.id);
  const oldShops = await fixture.db.select({ id: fixture.shopsTable.id })
    .from(fixture.shopsTable)
    .where(inArray(fixture.shopsTable.ownerId, oldUserIds));
  const oldShopIds = oldShops.map((row: { id: number }) => row.id);
  const oldOperations = oldOrganizationIds.length
    ? await fixture.db.select({ vehicleId: fixture.operationsTable.vehicleId })
      .from(fixture.operationsTable)
      .where(inArray(fixture.operationsTable.organizationId, oldOrganizationIds))
    : [];
  const operationVehicleIds = oldOperations
    .map((row: { vehicleId: number }) => row.vehicleId)
    .filter((id): id is number => typeof id === "number");
  const oldOwnership = await fixture.db
    .select({ vehicleId: fixture.ownershipTable.vehicleId })
    .from(fixture.ownershipTable)
    .where(inArray(fixture.ownershipTable.userId, oldUserIds));
  const oldShopVehicles = oldShopIds.length
    ? await fixture.db.select({ id: fixture.vehiclesTable.id })
      .from(fixture.vehiclesTable)
      .where(inArray(fixture.vehiclesTable.ownerShopId, oldShopIds))
    : [];
  const oldVehicleIds = [...new Set([
    ...operationVehicleIds,
    ...oldOwnership.map((row: { vehicleId: number }) => row.vehicleId),
    ...oldShopVehicles.map((row: { id: number }) => row.id),
  ])];
  if (oldVehicleIds.length) {
    await fixture.db.delete(fixture.ownershipTable)
      .where(inArray(fixture.ownershipTable.vehicleId, oldVehicleIds));
    await fixture.db.delete(fixture.operationsTable)
      .where(inArray(fixture.operationsTable.vehicleId, oldVehicleIds));
    await fixture.db.delete(fixture.vehiclesTable)
      .where(inArray(fixture.vehiclesTable.id, oldVehicleIds));
  }
  if (oldShopIds.length) {
    await fixture.db.delete(fixture.shopsTable)
      .where(inArray(fixture.shopsTable.id, oldShopIds));
  }
  if (oldOrganizationIds.length) {
    await fixture.db.delete(fixture.organizationsTable)
      .where(inArray(fixture.organizationsTable.id, oldOrganizationIds));
  }
  await fixture.db.delete(fixture.usersTable).where(inArray(fixture.usersTable.id, oldUserIds));
}

async function createOrganization(
  token: string,
  subtype: "shop" | "dealership" | "fleet" | "commercial_business",
  suffix: string,
) {
  const result = await api<{ id: number; subtype: string }>(
    "/api/partner-organizations",
    {
      method: "POST",
      token,
      body: {
        name: `Part 4 ${testVinStamp}-${suffix}`,
        subtype,
        phone: "+15550120000",
        email: `part4-${testVinStamp}-${suffix}@example.test`,
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

async function createShop(
  token: string,
  partnerKind: "independent_shop" | "dealership" | "fleet" | "gsa",
  suffix: string,
) {
  const result = await api<{ id: number; ownerId: number; partnerKind: string }>(
    "/api/shops",
    {
      method: "POST",
      token,
      body: {
        partnerKind,
        name: `Part 4 location ${testVinStamp}-${suffix}`,
        address: "300 Legacy Road",
        city: "Brooklyn",
        region: "NY",
        zipCode: "11232",
      },
    },
  );
  assert.equal(result.response.status, 201);
  fixture.shopIds.push(result.body.id);
  return result.body;
}

async function linkLocation(
  token: string,
  organizationId: number,
  shopId: number,
) {
  const result = await api(
    `/api/partner-organizations/${organizationId}/locations`,
    { method: "POST", token, body: { shopId } },
  );
  assert.equal(result.response.status, 200);
}

function canonicalFields(vin: string) {
  return {
    // Keep each test run isolated from an interrupted prior run while
    // preserving the final three characters as the scenario discriminator.
    vin: `${vin.slice(0, 7)}${testVinStamp}${vin.slice(-3)}`,
    make: "Honda",
    model: "Accord",
    year: 2023,
    mileage: 1200,
  };
}

function dealershipFields() {
  return {
    stockNumber: "D-1001",
    inventoryStatus: "in_stock",
    serviceNeeded: false,
  };
}

function fleetFields() {
  return {
    unitNumber: "UNIT-7",
    groupName: "North route",
    operatingStatus: "active",
    odometer: 12000,
    usageHours: 400,
    maintenanceDueDate: "2027-03-01",
    maintenanceDueMileage: 15000,
    notes: "Synthetic fixture",
  };
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
  await cleanupPriorFixtures();

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = await new Promise<any>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  fixture.server = server;
  const address = server.address();
  assert.ok(address && typeof address === "object");
  fixture.baseUrl = `http://127.0.0.1:${address.port}`;
  await register("shop_owner", "owner-a");
  await register("shop_owner", "owner-b");
  await register("customer", "customer");
});

after(async () => {
  if (!enabled) return;
  let cleanupError: unknown;
  try {
    const { inArray, like } = await import("drizzle-orm");
    if (fixture.db) {
      // Discover by this run's VIN/name/email prefix as well as tracked IDs so
      // a failure between a response and push() cannot leave fixtures behind.
      const vehiclePrefix = `1HGCM82${testVinStamp}%`;
      const runVehicles = await fixture.db
        .select({ id: fixture.vehiclesTable.id })
        .from(fixture.vehiclesTable)
        .where(like(fixture.vehiclesTable.vin, vehiclePrefix));
      const vehicleIds = [...new Set([
        ...fixture.vehicleIds,
        ...runVehicles.map((vehicle: { id: number }) => vehicle.id),
      ])];
      if (vehicleIds.length) {
        await fixture.db
          .delete(fixture.ownershipTable)
          .where(inArray(fixture.ownershipTable.vehicleId, vehicleIds));
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
        .where(like(fixture.shopsTable.name, `Part 4 location ${testVinStamp}-%`));
      const shopIds = [...new Set([
        ...fixture.shopIds,
        ...runShops.map((shop: { id: number }) => shop.id),
      ])];
      if (shopIds.length) {
        await fixture.db
          .delete(fixture.shopsTable)
          .where(inArray(fixture.shopsTable.id, shopIds));
      }

      const runOrganizations = await fixture.db
        .select({ id: fixture.organizationsTable.id })
        .from(fixture.organizationsTable)
        .where(like(fixture.organizationsTable.name, `Part 4 ${testVinStamp}-%`));
      const organizationIds = [...new Set([
        ...fixture.organizationIds,
        ...runOrganizations.map((organization: { id: number }) => organization.id),
      ])];
      if (organizationIds.length) {
        await fixture.db
          .delete(fixture.organizationsTable)
          .where(inArray(fixture.organizationsTable.id, organizationIds));
      }

      const runUsers = await fixture.db
        .select({ id: fixture.usersTable.id })
        .from(fixture.usersTable)
        .where(like(fixture.usersTable.email, `part4-${testVinStamp}-%`));
      const userIds = [...new Set([
        ...fixture.users.map((user) => user.id),
        ...runUsers.map((user: { id: number }) => user.id),
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
  "covers dealership/fleet operations, strict subtype data, and location moves",
  { skip: !enabled },
  async () => {
    const ownerA = fixture.users[0];
    const ownerB = fixture.users[1];
    const customer = fixture.users[2];
    assert.ok(ownerA && ownerB && customer);

    const dealership = await createOrganization(ownerA.token, "dealership", "dealership");
    const fleet = await createOrganization(ownerA.token, "fleet", "fleet");
    const shopOrganization = await createOrganization(ownerA.token, "shop", "shop");
    const commercial = await createOrganization(
      ownerA.token,
      "commercial_business",
      "commercial",
    );
    const dealerLocation = await createShop(ownerA.token, "independent_shop", "dealer-a");
    const secondLocation = await createShop(ownerA.token, "fleet", "dealer-b");
    const fleetLocation = await createShop(ownerA.token, "dealership", "fleet-a");
    const otherOwnerLocation = await createShop(ownerB.token, "fleet", "other-owner");
    await linkLocation(ownerA.token, dealership.id, dealerLocation.id);
    await linkLocation(ownerA.token, dealership.id, secondLocation.id);
    await linkLocation(ownerA.token, fleet.id, fleetLocation.id);
    await linkLocation(ownerB.token, await createOrganization(ownerB.token, "fleet", "owner-b-fleet").then((o) => o.id), otherOwnerLocation.id);

    const dealer = await api<{ id: number; vehicleId: number; linkedShopId: number }>(
      `/api/partner-organizations/${dealership.id}/vehicle-operations`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004352"),
          linkedShopId: dealerLocation.id,
          ...dealershipFields(),
        },
      },
    );
    assert.equal(dealer.response.status, 201, JSON.stringify(dealer.body));
    fixture.vehicleIds.push(dealer.body.vehicleId);

    const secondDealer = await api<{ vehicleId: number }>(
      `/api/partner-organizations/${dealership.id}/vehicle-operations`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004353"),
          linkedShopId: secondLocation.id,
          ...dealershipFields(),
        },
      },
    );
    assert.equal(secondDealer.response.status, 201);
    fixture.vehicleIds.push(secondDealer.body.vehicleId);

    const irrelevantFleetField = await api(
      `/api/partner-organizations/${dealership.id}/vehicle-operations`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004354"),
          linkedShopId: dealerLocation.id,
          ...dealershipFields(),
          unitNumber: "not allowed",
        },
      },
    );
    assert.equal(irrelevantFleetField.response.status, 400);

    const fleetOperation = await api<{
      id: number;
      vehicleId: number;
      maintenanceDueDate: string | null;
    }>(
      `/api/partner-organizations/${fleet.id}/vehicle-operations`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004355"),
          linkedShopId: fleetLocation.id,
          ...fleetFields(),
        },
      },
    );
    assert.equal(fleetOperation.response.status, 201, JSON.stringify(fleetOperation.body));
    assert.equal(fleetOperation.body.maintenanceDueDate, "2027-03-01");
    fixture.vehicleIds.push(fleetOperation.body.vehicleId);

    const reloadedFleetOperation = await api<{ maintenanceDueDate: string | null }>(
      `/api/partner-organizations/${fleet.id}/vehicle-operations/${fleetOperation.body.id}`,
      { token: ownerA.token },
    );
    assert.equal(reloadedFleetOperation.response.status, 200);
    assert.equal(reloadedFleetOperation.body.maintenanceDueDate, "2027-03-01");
    const clearedMaintenanceDate = await api<{ maintenanceDueDate: string | null }>(
      `/api/partner-organizations/${fleet.id}/vehicle-operations/${fleetOperation.body.id}`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: { maintenanceDueDate: null },
      },
    );
    assert.equal(clearedMaintenanceDate.response.status, 200);
    assert.equal(clearedMaintenanceDate.body.maintenanceDueDate, null);
    const reloadedClearedDate = await api<{ maintenanceDueDate: string | null }>(
      `/api/partner-organizations/${fleet.id}/vehicle-operations/${fleetOperation.body.id}`,
      { token: ownerA.token },
    );
    assert.equal(reloadedClearedDate.response.status, 200);
    assert.equal(reloadedClearedDate.body.maintenanceDueDate, null);

    const fractionalYear = await api(
      `/api/partner-organizations/${dealership.id}/vehicle-operations`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004366"),
          year: 2023.5,
          linkedShopId: dealerLocation.id,
          ...dealershipFields(),
        },
      },
    );
    assert.equal(fractionalYear.response.status, 400);
    const fractionalMileage = await api(
      `/api/partner-organizations/${dealership.id}/vehicle-operations`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004367"),
          mileage: 1200.5,
          linkedShopId: dealerLocation.id,
          ...dealershipFields(),
        },
      },
    );
    assert.equal(fractionalMileage.response.status, 400);
    const fractionalOdometer = await api(
      `/api/partner-organizations/${fleet.id}/vehicle-operations/${fleetOperation.body.id}`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: { odometer: 12000.5 },
      },
    );
    assert.equal(fractionalOdometer.response.status, 400);
    const fractionalMaintenanceMileage = await api(
      `/api/partner-organizations/${fleet.id}/vehicle-operations/${fleetOperation.body.id}`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: { maintenanceDueMileage: 15000.5 },
      },
    );
    assert.equal(fractionalMaintenanceMileage.response.status, 400);
    const invalidCalendarDate = await api(
      `/api/partner-organizations/${fleet.id}/vehicle-operations/${fleetOperation.body.id}`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: { maintenanceDueDate: "2027-02-30" },
      },
    );
    assert.equal(invalidCalendarDate.response.status, 400);

    const irrelevantDealerField = await api(
      `/api/partner-organizations/${fleet.id}/vehicle-operations`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004356"),
          linkedShopId: fleetLocation.id,
          ...fleetFields(),
          stockNumber: "not allowed",
        },
      },
    );
    assert.equal(irrelevantDealerField.response.status, 400);

    const moved = await api<{ linkedShopId: number; ownerShopId: number | null }>(
      `/api/partner-organizations/${dealership.id}/vehicle-operations/${dealer.body.id}`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: { linkedShopId: secondLocation.id, serviceNeeded: true },
      },
    );
    assert.equal(moved.response.status, 200);
    assert.equal(moved.body.linkedShopId, secondLocation.id);
    assert.equal(moved.body.ownerShopId, secondLocation.id);

    const nullServiceNeeded = await api(
      `/api/partner-organizations/${dealership.id}/vehicle-operations/${dealer.body.id}`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: { serviceNeeded: null },
      },
    );
    assert.equal(nullServiceNeeded.response.status, 400);

    const fleetEdited = await api<{ operatingStatus: string }>(
      `/api/partner-organizations/${fleet.id}/vehicle-operations/${fleetOperation.body.id}`,
      {
        method: "PATCH",
        token: ownerA.token,
        body: { operatingStatus: "maintenance" },
      },
    );
    assert.equal(fleetEdited.response.status, 200);
    assert.equal(fleetEdited.body.operatingStatus, "maintenance");

    const locations = await api<Array<{ id: number; partnerKind: string }>>(
      `/api/partner-organizations/${dealership.id}/locations`,
      { token: ownerA.token },
    );
    assert.equal(locations.response.status, 200);
    assert.deepEqual(
      locations.body.filter((location) => [dealerLocation.id, secondLocation.id].includes(location.id))
        .map((location) => location.partnerKind)
        .sort(),
      ["fleet", "independent_shop"],
    );

    const list = await api<Array<{ vehicleId: number }>>(
      `/api/partner-organizations/${dealership.id}/vehicle-operations`,
      { token: ownerA.token },
    );
    assert.equal(list.response.status, 200);
    assert.ok(list.body.some((operation) => operation.vehicleId === dealer.body.vehicleId));
    assert.ok(list.body.some((operation) => operation.vehicleId === secondDealer.body.vehicleId));

    const subtypeChange = await api(
      `/api/partner-organizations/${dealership.id}`,
      { method: "PATCH", token: ownerA.token, body: { subtype: "fleet" } },
    );
    assert.equal(subtypeChange.response.status, 409);

    for (const organizationId of [shopOrganization.id, commercial.id]) {
      const forbidden = await api(
        `/api/partner-organizations/${organizationId}/vehicle-operations`,
        { token: ownerA.token },
      );
      assert.equal(forbidden.response.status, 403);
    }

    const crossOwner = await api(
      `/api/partner-organizations/${dealership.id}/vehicle-operations`,
      { token: ownerB.token },
    );
    assert.equal(crossOwner.response.status, 404);
    const crossLocation = await api(
      `/api/partner-organizations/${dealership.id}/vehicle-operations`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004357"),
          linkedShopId: otherOwnerLocation.id,
          ...dealershipFields(),
        },
      },
    );
    assert.equal(crossLocation.response.status, 404);

    const customerVehicle = await api<{ id: number }>(
      "/api/vehicles",
      {
        method: "POST",
        token: customer.token,
        body: canonicalFields("1HGCM82633A004358"),
      },
    );
    assert.equal(customerVehicle.response.status, 201);
    fixture.vehicleIds.push(customerVehicle.body.id);
    const partnerClaimCustomerVin = await api(
      `/api/partner-organizations/${dealership.id}/vehicle-operations`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004358"),
          linkedShopId: dealerLocation.id,
          ...dealershipFields(),
        },
      },
    );
    assert.equal(partnerClaimCustomerVin.response.status, 409);
    const ordinaryCustomerReadd = await api(
      "/api/vehicles",
      {
        method: "POST",
        token: customer.token,
        body: canonicalFields("1HGCM82633A004358"),
      },
    );
    assert.equal(ordinaryCustomerReadd.response.status, 409);

    const partnerClaim = await api(
      `/api/partner-organizations/${dealership.id}/vehicle-operations`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004359"),
          linkedShopId: dealerLocation.id,
          ...dealershipFields(),
        },
      },
    );
    assert.equal(partnerClaim.response.status, 201);
    fixture.vehicleIds.push((partnerClaim.body as { vehicleId: number }).vehicleId);
    const blockedUnownedPartnerRemove = await api(
      `/api/vehicles/${(partnerClaim.body as { vehicleId: number }).vehicleId}`,
      { method: "DELETE", token: ownerA.token },
    );
    assert.equal(blockedUnownedPartnerRemove.response.status, 409);
    const legacyClaim = await api(
      "/api/vehicles",
      {
        method: "POST",
        token: customer.token,
        body: canonicalFields("1HGCM82633A004359"),
      },
    );
    assert.equal(legacyClaim.response.status, 409);

    const [{ vehiclesTable, ownershipTable }] = await Promise.all([
      import("@workspace/db"),
    ]);
    const { eq } = await import("drizzle-orm");

    // Legacy POST /vehicles for a shop_owner creates the canonical vehicle
    // and a same-user ownership row. That exact safe legacy shape is
    // importable when ownerShopId points at the selected owned organization
    // location.
    const legacyPost = await api<{ id: number }>(
      "/api/vehicles",
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004360"),
          ownerShopId: secondLocation.id,
        },
      },
    );
    assert.equal(legacyPost.response.status, 201);
    const legacyVehicleId = legacyPost.body.id;
    fixture.vehicleIds.push(legacyVehicleId);
    const legacyOwnershipBefore = await fixture.db
      .select()
      .from(ownershipTable)
      .where(eq(ownershipTable.vehicleId, legacyVehicleId));
    assert.equal(legacyOwnershipBefore.length, 1);
    assert.equal(legacyOwnershipBefore[0].userId, ownerA.id);
    fixture.ownershipIds.push(legacyOwnershipBefore[0].id);

    const linkedLegacy = await api(
      `/api/partner-organizations/${dealership.id}/vehicle-operations/link`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          vehicleId: legacyVehicleId,
          linkedShopId: secondLocation.id,
          ...dealershipFields(),
        },
      },
    );
    assert.equal(linkedLegacy.response.status, 201, JSON.stringify(linkedLegacy.body));
    const legacyOwnershipAfter = await fixture.db
      .select()
      .from(ownershipTable)
      .where(eq(ownershipTable.vehicleId, legacyVehicleId));
    assert.deepEqual(legacyOwnershipAfter, legacyOwnershipBefore);
    const blockedPartnerTransfer = await api(
      `/api/vehicles/${legacyVehicleId}/transfer`,
      {
        method: "POST",
        token: ownerA.token,
        body: { newOwnerEmail: customer.email },
      },
    );
    assert.equal(blockedPartnerTransfer.response.status, 409);
    assert.deepEqual(
      await fixture.db
        .select()
        .from(ownershipTable)
        .where(eq(ownershipTable.vehicleId, legacyVehicleId)),
      legacyOwnershipBefore,
    );
    const blockedPartnerRemove = await api(
      `/api/vehicles/${legacyVehicleId}`,
      { method: "DELETE", token: ownerA.token },
    );
    assert.equal(blockedPartnerRemove.response.status, 409);
    assert.deepEqual(
      await fixture.db
        .select()
        .from(ownershipTable)
        .where(eq(ownershipTable.vehicleId, legacyVehicleId)),
      legacyOwnershipBefore,
    );

    // A customer-owned vehicle with ownerShopId null is not importable even
    // when the same shop_owner is the authenticated caller.
    const sameUserCustomerVehicle = await api<{ id: number }>(
      "/api/vehicles",
      {
        method: "POST",
        token: ownerA.token,
        body: canonicalFields("1HGCM82633A004361"),
      },
    );
    assert.equal(sameUserCustomerVehicle.response.status, 201);
    fixture.vehicleIds.push(sameUserCustomerVehicle.body.id);
    const sameUserOwnershipBefore = await fixture.db
      .select()
      .from(ownershipTable)
      .where(eq(ownershipTable.vehicleId, sameUserCustomerVehicle.body.id));
    const rejectedSameUserCustomer = await api(
      `/api/partner-organizations/${dealership.id}/vehicle-operations/link`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          vehicleId: sameUserCustomerVehicle.body.id,
          linkedShopId: secondLocation.id,
          ...dealershipFields(),
        },
      },
    );
    assert.equal(rejectedSameUserCustomer.response.status, 409);
    assert.equal(
      (await fixture.db
        .select()
        .from(vehiclesTable)
        .where(eq(vehiclesTable.id, sameUserCustomerVehicle.body.id)))[0]
        .ownerShopId,
      null,
    );
    assert.deepEqual(
      await fixture.db
        .select()
        .from(ownershipTable)
        .where(eq(ownershipTable.vehicleId, sameUserCustomerVehicle.body.id)),
      sameUserOwnershipBefore,
    );
    const ordinaryRemove = await api(
      `/api/vehicles/${sameUserCustomerVehicle.body.id}`,
      { method: "DELETE", token: ownerA.token },
    );
    assert.equal(ordinaryRemove.response.status, 200);
    const removedOwnership = await fixture.db
      .select()
      .from(ownershipTable)
      .where(eq(ownershipTable.vehicleId, sameUserCustomerVehicle.body.id));
    assert.equal(removedOwnership.length, 1);
    assert.ok(removedOwnership[0].endDate);
    const sameUserOwnership = sameUserOwnershipBefore[0];
    if (sameUserOwnership) fixture.ownershipIds.push(sameUserOwnership.id);

    // A foreign active owner is denied even when ownerShopId points to the
    // authenticated organization's selected location.
    const [foreignOwnerVehicle] = await fixture.db
      .insert(vehiclesTable)
      .values({
        ...canonicalFields("1HGCM82633A004362"),
        ownerShopId: secondLocation.id,
      })
      .returning();
    fixture.vehicleIds.push(foreignOwnerVehicle.id);
    const [foreignOwnership] = await fixture.db
      .insert(ownershipTable)
      .values({
        vehicleId: foreignOwnerVehicle.id,
        userId: customer.id,
        vin: foreignOwnerVehicle.vin,
        transferVerified: true,
      })
      .returning();
    fixture.ownershipIds.push(foreignOwnership.id);
    const rejectedForeignOwner = await api(
      `/api/partner-organizations/${dealership.id}/vehicle-operations/link`,
      {
        method: "POST",
        token: ownerA.token,
        body: {
          vehicleId: foreignOwnerVehicle.id,
          linkedShopId: secondLocation.id,
          ...dealershipFields(),
        },
      },
    );
    assert.equal(rejectedForeignOwner.response.status, 409);
  },
);

test(
  "serializes concurrent legacy claim versus import and transfer",
  { skip: !enabled },
  async () => {
    const ownerA = fixture.users[0];
    const customer = fixture.users[2];
    assert.ok(ownerA && customer);
    const { eq } = await import("drizzle-orm");
    const dealership = await createOrganization(ownerA.token, "dealership", "race-link");
    const location = await createShop(ownerA.token, "fleet", "race-link");
    await linkLocation(ownerA.token, dealership.id, location.id);

    const [unclaimedVehicle] = await fixture.db
      .insert(fixture.vehiclesTable)
      .values({
        ...canonicalFields("1HGCM82633A004363"),
        ownerShopId: location.id,
      })
      .returning();
    fixture.vehicleIds.push(unclaimedVehicle.id);

    const [linkRace, claimRace] = await Promise.all([
      api(
        `/api/partner-organizations/${dealership.id}/vehicle-operations/link`,
        {
          method: "POST",
          token: ownerA.token,
          body: {
            vehicleId: unclaimedVehicle.id,
            linkedShopId: location.id,
            ...dealershipFields(),
          },
        },
      ),
      api(
        "/api/vehicles",
        {
          method: "POST",
          token: customer.token,
          body: canonicalFields("1HGCM82633A004363"),
        },
      ),
    ]);
    assert.deepEqual(
      [linkRace.response.status, claimRace.response.status].sort((a, b) => a - b),
      [201, 409],
      JSON.stringify({ link: linkRace.body, claim: claimRace.body }),
    );
    const raceOwnership = await fixture.db
      .select()
      .from(fixture.ownershipTable)
      .where(eq(fixture.ownershipTable.vehicleId, unclaimedVehicle.id));
    fixture.ownershipIds.push(...raceOwnership.map((ownership: { id: number }) => ownership.id));

    const legacyPost = await api<{ id: number }>(
      "/api/vehicles",
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004364"),
          ownerShopId: location.id,
        },
      },
    );
    assert.equal(legacyPost.response.status, 201, JSON.stringify(legacyPost.body));
    fixture.vehicleIds.push(legacyPost.body.id);
    const transferOwnership = await fixture.db
      .select()
      .from(fixture.ownershipTable)
      .where(eq(fixture.ownershipTable.vehicleId, legacyPost.body.id));
    fixture.ownershipIds.push(...transferOwnership.map((ownership: { id: number }) => ownership.id));

    const [linkTransferRace, transferRace] = await Promise.all([
      api(
        `/api/partner-organizations/${dealership.id}/vehicle-operations/link`,
        {
          method: "POST",
          token: ownerA.token,
          body: {
            vehicleId: legacyPost.body.id,
            linkedShopId: location.id,
            ...dealershipFields(),
          },
        },
      ),
      api(
        `/api/vehicles/${legacyPost.body.id}/transfer`,
        {
          method: "POST",
          token: ownerA.token,
          body: { newOwnerEmail: customer.email },
        },
      ),
    ]);
    assert.ok(
      (linkTransferRace.response.status === 201 && transferRace.response.status === 409) ||
        (linkTransferRace.response.status === 409 && transferRace.response.status === 200),
      JSON.stringify({ link: linkTransferRace.body, transfer: transferRace.body }),
    );
    const afterTransferRaceOwnership = await fixture.db
      .select()
      .from(fixture.ownershipTable)
      .where(eq(fixture.ownershipTable.vehicleId, legacyPost.body.id));
    fixture.ownershipIds.push(
      ...afterTransferRaceOwnership.map((ownership: { id: number }) => ownership.id),
    );

    const removeRaceVehicle = await api<{ id: number }>(
      "/api/vehicles",
      {
        method: "POST",
        token: ownerA.token,
        body: {
          ...canonicalFields("1HGCM82633A004371"),
          ownerShopId: location.id,
        },
      },
    );
    assert.equal(removeRaceVehicle.response.status, 201, JSON.stringify(removeRaceVehicle.body));
    fixture.vehicleIds.push(removeRaceVehicle.body.id);
    const removeRaceOwnershipBefore = await fixture.db
      .select()
      .from(fixture.ownershipTable)
      .where(eq(fixture.ownershipTable.vehicleId, removeRaceVehicle.body.id));
    fixture.ownershipIds.push(
      ...removeRaceOwnershipBefore.map((ownership: { id: number }) => ownership.id),
    );
    const [importRemoveRace, removeRace] = await Promise.all([
      api(
        `/api/partner-organizations/${dealership.id}/vehicle-operations/link`,
        {
          method: "POST",
          token: ownerA.token,
          body: {
            vehicleId: removeRaceVehicle.body.id,
            linkedShopId: location.id,
            ...dealershipFields(),
          },
        },
      ),
      api(
        `/api/vehicles/${removeRaceVehicle.body.id}`,
        { method: "DELETE", token: ownerA.token },
      ),
    ]);
    assert.equal(importRemoveRace.response.status, 201, JSON.stringify(importRemoveRace.body));
    assert.ok(
      removeRace.response.status === 200 || removeRace.response.status === 409,
      JSON.stringify(removeRace.body),
    );
    const removeRaceOwnershipAfter = await fixture.db
      .select()
      .from(fixture.ownershipTable)
      .where(eq(fixture.ownershipTable.vehicleId, removeRaceVehicle.body.id));
    assert.equal(removeRaceOwnershipAfter.length, 1);
    if (removeRace.response.status === 409) {
      assert.equal(removeRaceOwnershipAfter[0].endDate, null);
    } else {
      assert.ok(removeRaceOwnershipAfter[0].endDate);
    }
    fixture.ownershipIds.push(
      ...removeRaceOwnershipAfter.map((ownership: { id: number }) => ownership.id),
    );
  },
);

test(
  "serializes subtype edit against operation creation",
  { skip: !enabled },
  async () => {
    const ownerA = fixture.users[0];
    assert.ok(ownerA);
    const dealership = await createOrganization(ownerA.token, "dealership", "race-subtype");
    const location = await createShop(ownerA.token, "dealership", "race-subtype");
    await linkLocation(ownerA.token, dealership.id, location.id);

    const [createRace, subtypeRace] = await Promise.all([
      api<{ vehicleId: number }>(
        `/api/partner-organizations/${dealership.id}/vehicle-operations`,
        {
          method: "POST",
          token: ownerA.token,
          body: {
            ...canonicalFields("1HGCM82633A004365"),
            linkedShopId: location.id,
            ...dealershipFields(),
          },
        },
      ),
      api(
        `/api/partner-organizations/${dealership.id}`,
        {
          method: "PATCH",
          token: ownerA.token,
          body: { subtype: "fleet" },
        },
      ),
    ]);
    if (createRace.response.status === 201) {
      fixture.vehicleIds.push(createRace.body.vehicleId);
    }
    assert.ok(
      (createRace.response.status === 201 && subtypeRace.response.status === 409) ||
        (createRace.response.status !== 201 && subtypeRace.response.status === 200),
      JSON.stringify({ create: createRace.body, subtype: subtypeRace.body }),
    );
  },
);
