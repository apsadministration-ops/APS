/**
 * Real development-DB integration coverage for Part 2.
 *
 * This suite is intentionally opt-in because it creates and removes real
 * development rows. Run only after the additive migration has been applied:
 *
 *   RUN_PARTNER_ORG_INTEGRATION=1 \
 *     pnpm --filter @workspace/api-server run test:partner-organizations
 *
 * It uses the API's password auth only; no external identity provider is
 * contacted. Fixture accounts use the reserved example.test domain.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

const enabled =
  process.env.RUN_PARTNER_ORG_INTEGRATION === "1" &&
  process.env.NODE_ENV !== "production" &&
  Boolean(process.env.DATABASE_URL);

type ApiResult<T> = {
  response: Response;
  body: T;
};

type Fixture = {
  server?: {
    close(callback: () => void): void;
    closeAllConnections?: () => void;
  };
  baseUrl: string;
  pool?: { end(): Promise<void> };
  db?: any;
  usersTable?: any;
  shopsTable?: any;
  partnerOrganizationsTable?: any;
  ownerA?: { id: number; email: string; token: string };
  ownerB?: { id: number; email: string; token: string };
  customer?: { id: number; token: string };
  mechanic?: { id: number; token: string };
  shopIds: number[];
  organizationIds: number[];
};

const fixture: Fixture = {
  baseUrl: "",
  shopIds: [],
  organizationIds: [],
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
      ...(options.token
        ? { authorization: `Bearer ${options.token}` }
        : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const body = (text ? JSON.parse(text) : null) as T;
  return { response, body };
}

async function register(
  role: "shop_owner" | "customer" | "mechanic",
  suffix: string,
) {
  const email = `partner-org-${Date.now()}-${suffix}@example.test`;
  const result = await api<{
    token: string;
    user: { id: number };
  }>("/api/auth/register", {
    method: "POST",
    body: {
      name: `Partner organization ${suffix}`,
      email,
      password: "PartnerOrgTest!2026",
      role,
      phone: "+15550123456",
      address: "100 Main Street",
      city: "Brooklyn",
      region: "NY",
      zipCode: "11201",
    },
  });
  assert.equal(result.response.status, 201);
  return {
    id: result.body.user.id,
    email,
    token: result.body.token,
  };
}

function organizationInput(
  subtype: "shop" | "dealership" | "fleet" | "commercial_business",
) {
  return {
    name: `Organization ${subtype}`,
    subtype,
    phone: "+15550120000",
    email: `ops-${subtype}@example.test`,
    address: "200 Industry Avenue",
    city: "Brooklyn",
    region: "NY",
    zipCode: "11231",
  };
}

async function createShop(token: string, partnerKind = "independent_shop") {
  const result = await api<{ id: number; ownerId: number; partnerKind: string }>(
    "/api/shops",
    {
      method: "POST",
      token,
      body: {
        partnerKind,
        name: `Legacy location ${Date.now()}`,
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

before(async () => {
  if (!enabled) return;

  // Dynamic imports keep the opt-in guard from requiring a database when the
  // suite is discovered in a no-DB typecheck or local unit-test run.
  const [{ default: router }, { default: express }, database] = await Promise.all([
    import("../src/routes/index.ts"),
    import("express"),
    import("@workspace/db"),
  ]);
  fixture.db = database.db;
  fixture.pool = database.pool;
  fixture.usersTable = database.usersTable;
  fixture.shopsTable = database.shopsTable;
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
});

after(async () => {
  if (!enabled) return;
  // Delete only synthetic fixtures, in dependency order. No production rows
  // are touched, and no truncation/cascade is used.
  if (
    fixture.db &&
    fixture.usersTable &&
    fixture.shopsTable &&
    fixture.partnerOrganizationsTable
  ) {
    const { inArray } = await import("drizzle-orm");
    if (fixture.shopIds.length > 0) {
      await fixture.db
        .delete(fixture.shopsTable)
        .where(inArray(fixture.shopsTable.id, fixture.shopIds));
    }
    if (fixture.organizationIds.length > 0) {
      await fixture.db
        .delete(fixture.partnerOrganizationsTable)
        .where(
          inArray(
            fixture.partnerOrganizationsTable.id,
            fixture.organizationIds,
          ),
        );
    }
    const userIds = [
      fixture.ownerA?.id,
      fixture.ownerB?.id,
      fixture.customer?.id,
      fixture.mechanic?.id,
    ].filter((id): id is number => typeof id === "number");
    if (userIds.length > 0) {
      await fixture.db
        .delete(fixture.usersTable)
        .where(inArray(fixture.usersTable.id, userIds));
    }
  }
  if (fixture.server) {
    fixture.server.closeAllConnections?.();
    await new Promise<void>((resolve) => fixture.server?.close(resolve));
  }
  await fixture.pool?.end();
});

test(
  "creates every canonical subtype and preserves legacy login/location classification",
  { skip: !enabled },
  async () => {
    assert.ok(fixture.ownerA);

    const login = await api<{ token: string }>("/api/auth/login", {
      method: "POST",
      body: {
        email: fixture.ownerA.email,
        password: "PartnerOrgTest!2026",
      },
    });
    assert.equal(login.response.status, 200);
    const token = login.body.token;

    for (const subtype of [
      "shop",
      "dealership",
      "fleet",
      "commercial_business",
    ] as const) {
      const created = await api<{ id: number; subtype: string; primaryOwnerId: number }>(
        "/api/partner-organizations",
        {
          method: "POST",
          token,
          body: organizationInput(subtype),
        },
      );
      assert.equal(created.response.status, 201);
      assert.equal(created.body.subtype, subtype);
      assert.equal(created.body.primaryOwnerId, fixture.ownerA.id);
      fixture.organizationIds.push(created.body.id);
    }

    const firstLocation = await createShop(token, "fleet");
    assert.equal(firstLocation.ownerId, fixture.ownerA.id);
    assert.equal(firstLocation.partnerKind, "fleet");
    const legacyLocations = await api<
      Array<{ id: number; ownerId: number; partnerKind: string; organizationId: number | null }>
    >("/api/shops/mine", { token });
    assert.equal(legacyLocations.response.status, 200);
    const legacy = legacyLocations.body.find((shop) => shop.id === firstLocation.id);
    assert.deepEqual(
      {
        ownerId: legacy?.ownerId,
        partnerKind: legacy?.partnerKind,
        organizationId: legacy?.organizationId,
      },
      {
        ownerId: fixture.ownerA.id,
        partnerKind: "fleet",
        organizationId: null,
      },
    );
  },
);

test(
  "rejects invalid subtypes and owner/role fields",
  { skip: !enabled },
  async () => {
    assert.ok(fixture.ownerA);
    const invalidBody = {
      ...organizationInput("shop"),
      subtype: "customer",
    };
    const invalidSubtype = await api("/api/partner-organizations", {
      method: "POST",
      token: fixture.ownerA.token,
      body: invalidBody,
    });
    assert.equal(invalidSubtype.response.status, 400);

    const invalidMechanicSubtype = await api("/api/partner-organizations", {
      method: "POST",
      token: fixture.ownerA.token,
      body: { ...organizationInput("shop"), subtype: "mechanic" },
    });
    assert.equal(invalidMechanicSubtype.response.status, 400);

    const ownerField = await api("/api/partner-organizations", {
      method: "POST",
      token: fixture.ownerA.token,
      body: {
        ...organizationInput("shop"),
        primaryOwnerId: fixture.ownerA.id,
      },
    });
    assert.equal(ownerField.response.status, 400);

    const roleField = await api("/api/partner-organizations", {
      method: "POST",
      token: fixture.ownerA.token,
      body: { ...organizationInput("shop"), role: "admin" },
    });
    assert.equal(roleField.response.status, 400);
  },
);

test(
  "requires an active shop_owner and denies cross-owner/cross-org access",
  { skip: !enabled },
  async () => {
    assert.ok(fixture.ownerA && fixture.ownerB && fixture.customer && fixture.mechanic);
    const mine = await api<Array<{ id: number }>>("/api/partner-organizations", {
      token: fixture.ownerA.token,
    });
    assert.equal(mine.response.status, 200);
    const organizationId = mine.body[0]?.id;
    assert.ok(organizationId);

    const customer = await api(`/api/partner-organizations`, {
      token: fixture.customer.token,
    });
    assert.equal(customer.response.status, 403);
    const mechanic = await api(`/api/partner-organizations`, {
      token: fixture.mechanic.token,
    });
    assert.equal(mechanic.response.status, 403);

    const { eq } = await import("drizzle-orm");
    await fixture.db
      .update(fixture.usersTable)
      .set({ status: "suspended" })
      .where(eq(fixture.usersTable.id, fixture.ownerB.id));
    try {
      const suspended = await api("/api/partner-organizations", {
        token: fixture.ownerB.token,
      });
      assert.equal(suspended.response.status, 403);
    } finally {
      await fixture.db
        .update(fixture.usersTable)
        .set({ status: "active" })
        .where(eq(fixture.usersTable.id, fixture.ownerB.id));
    }

    const otherOrganization = await api<{ id: number }>(
      "/api/partner-organizations",
      {
        method: "POST",
        token: fixture.ownerB.token,
        body: organizationInput("shop"),
      },
    );
    assert.equal(otherOrganization.response.status, 201);
    fixture.organizationIds.push(otherOrganization.body.id);

    const crossGet = await api(`/api/partner-organizations/${organizationId}`, {
      token: fixture.ownerB.token,
    });
    assert.equal(crossGet.response.status, 404);
    const crossPatch = await api(`/api/partner-organizations/${organizationId}`, {
      method: "PATCH",
      token: fixture.ownerB.token,
      body: { name: "should not change" },
    });
    assert.equal(crossPatch.response.status, 404);
  },
);

test(
  "rejects malformed organization and shop identifiers",
  { skip: !enabled },
  async () => {
    assert.ok(fixture.ownerA);
    for (const organizationId of ["0", "1.5", "not-an-id", "%20"]) {
      const malformed = await api(
        `/api/partner-organizations/${organizationId}`,
        { token: fixture.ownerA.token },
      );
      assert.equal(malformed.response.status, 400);
    }

    const organizations = await api<Array<{ id: number }>>(
      "/api/partner-organizations",
      { token: fixture.ownerA.token },
    );
    const organizationId = organizations.body[0]?.id;
    assert.ok(organizationId);
    const malformedShop = await api(
      `/api/partner-organizations/${organizationId}/locations`,
      {
        method: "POST",
        token: fixture.ownerA.token,
        body: { shopId: 1.5 },
      },
    );
    assert.equal(malformedShop.response.status, 400);
  },
);

test(
  "links only owned unlinked locations and enforces active organization state",
  { skip: !enabled },
  async () => {
    assert.ok(fixture.ownerA && fixture.ownerB);
    const organizations = await api<Array<{ id: number }>>(
      "/api/partner-organizations",
      { token: fixture.ownerA.token },
    );
    const organizationId = organizations.body[0]?.id;
    assert.ok(organizationId);
    const otherOrganizationId = organizations.body[1]?.id;
    assert.ok(otherOrganizationId);

    const location = await createShop(fixture.ownerA.token);
    const linked = await api<{ organizationId: number; ownerId: number }>(
      `/api/partner-organizations/${organizationId}/locations`,
      {
        method: "POST",
        token: fixture.ownerA.token,
        body: { shopId: location.id },
      },
    );
    assert.equal(linked.response.status, 200);
    assert.equal(linked.body.organizationId, organizationId);
    assert.equal(linked.body.ownerId, fixture.ownerA.id);

    const locations = await api<Array<{ id: number; organizationId: number | null }>>(
      `/api/partner-organizations/${organizationId}/locations`,
      { token: fixture.ownerA.token },
    );
    assert.equal(locations.response.status, 200);
    assert.equal(locations.body.find((item) => item.id === location.id)?.organizationId, organizationId);

    const raceLocation = await createShop(fixture.ownerA.token);
    const raceResults = await Promise.all([
      api(
        `/api/partner-organizations/${organizationId}/locations`,
        {
          method: "POST",
          token: fixture.ownerA.token,
          body: { shopId: raceLocation.id },
        },
      ),
      api(
        `/api/partner-organizations/${otherOrganizationId}/locations`,
        {
          method: "POST",
          token: fixture.ownerA.token,
          body: { shopId: raceLocation.id },
        },
      ),
    ]);
    assert.deepEqual(
      raceResults.map((result) => result.response.status).sort(),
      [200, 409],
    );

    const ownerBLocation = await createShop(fixture.ownerB.token);
    const { eq } = await import("drizzle-orm");
    await assert.rejects(
      fixture.db
        .update(fixture.shopsTable)
        .set({ organizationId })
        .where(eq(fixture.shopsTable.id, ownerBLocation.id)),
    );

    const reassignment = await api(
      `/api/partner-organizations/${otherOrganizationId}/locations`,
      {
        method: "POST",
        token: fixture.ownerA.token,
        body: { shopId: location.id },
      },
    );
    assert.equal(reassignment.response.status, 409);

    const crossOwnerLink = await api(
      `/api/partner-organizations/${organizationId}/locations`,
      {
        method: "POST",
        token: fixture.ownerB.token,
        body: { shopId: location.id },
      },
    );
    assert.equal(crossOwnerLink.response.status, 404);

    const inactive = await api(`/api/partner-organizations/${organizationId}`, {
      method: "PATCH",
      token: fixture.ownerA.token,
      body: { status: "inactive" },
    });
    assert.equal(inactive.response.status, 200);
    const unlinked = await createShop(fixture.ownerA.token);
    const inactiveLink = await api(
      `/api/partner-organizations/${organizationId}/locations`,
      {
        method: "POST",
        token: fixture.ownerA.token,
        body: { shopId: unlinked.id },
      },
    );
    assert.equal(inactiveLink.response.status, 409);
  },
);