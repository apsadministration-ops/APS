/**
 * Opt-in development-DB coverage for business-first registration.
 *
 *   RUN_BUSINESS_ACCOUNT_INTEGRATION=1 \
 *     pnpm --filter @workspace/api-server run test:business-accounts
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

const enabled =
  process.env.RUN_BUSINESS_ACCOUNT_INTEGRATION === "1" &&
  process.env.NODE_ENV !== "production" &&
  Boolean(process.env.DATABASE_URL);

type ApiResult<T> = { response: Response; body: T };
type BusinessFixture = {
  id: number;
  email: string;
  token: string;
  organizationId: number;
};

const fixture: {
  baseUrl: string;
  server?: any;
  pool?: { end(): Promise<void> };
  db?: any;
  usersTable?: any;
  shopsTable?: any;
  partnerOrganizationsTable?: any;
  users: number[];
  shops: number[];
  organizations: number[];
  businesses: BusinessFixture[];
} = {
  baseUrl: "",
  users: [],
  shops: [],
  organizations: [],
  businesses: [],
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

async function registerLegacy(
  role: "customer" | "mechanic",
  suffix: string,
) {
  const email = `business-account-${Date.now()}-${suffix}@example.test`;
  const result = await api<{
    token: string;
    user: { id: number; role: string };
  }>("/api/auth/register", {
    method: "POST",
    body: {
      name: `Legacy ${role}`,
      email,
      password: "BusinessTest!2026",
      role,
      phone: "+15550100010",
      address: "100 Main Street",
      city: "Brooklyn",
      region: "NY",
      zipCode: "11201",
    },
  });
  assert.equal(result.response.status, 201);
  fixture.users.push(result.body.user.id);
  assert.equal(result.body.user.role, role);
  return { id: result.body.user.id, email, token: result.body.token };
}

async function registerBusiness(
  subtype: "shop" | "dealership" | "fleet",
  suffix: string,
): Promise<BusinessFixture> {
  const adminEmail = `business-admin-${Date.now()}-${suffix}@example.test`;
  const result = await api<{
    token: string;
    user: { id: number; role: string; status: string };
    organization: {
      id: number;
      primaryOwnerId: number;
      legalName: string | null;
      name: string;
      subtype: string;
      email: string;
      phone: string;
    };
  }>("/api/auth/register-business", {
    method: "POST",
    body: {
      business: {
        legalName: `${suffix} Legal Holdings`,
        name: `${suffix} Display`,
        subtype,
        email: `${suffix.toLowerCase()}-ops@example.test`,
        phone: "+15550100020",
        address: "200 Industry Avenue",
        city: "Brooklyn",
        region: "NY",
        zipCode: "11231",
        contactName: "Business Contact",
      },
      administrator: {
        name: `${suffix} Administrator`,
        email: adminEmail,
        phone: "+15550100021",
        password: "BusinessTest!2026",
      },
    },
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.user.role, "shop_owner");
  assert.equal(result.body.user.status, "active");
  assert.equal(result.body.organization.primaryOwnerId, result.body.user.id);
  assert.equal(result.body.organization.subtype, subtype);
  assert.equal(result.body.organization.name, `${suffix} Display`);
  assert.equal(result.body.organization.legalName, `${suffix} Legal Holdings`);
  assert.notEqual(result.body.organization.email, adminEmail);
  assert.notEqual(result.body.organization.phone, "+15550100021");
  assert.equal("stripeAccountId" in result.body.organization, false);

  fixture.users.push(result.body.user.id);
  fixture.organizations.push(result.body.organization.id);
  const created = {
    id: result.body.user.id,
    email: adminEmail,
    token: result.body.token,
    organizationId: result.body.organization.id,
  };
  fixture.businesses.push(created);
  return created;
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
  fixture.partnerOrganizationsTable = database.partnerOrganizationsTable;

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  fixture.server = await new Promise<any>((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
  const address = fixture.server.address();
  assert.ok(address && typeof address === "object");
  fixture.baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (!enabled) return;
  const { inArray } = await import("drizzle-orm");
  if (fixture.db && fixture.shops.length) {
    await fixture.db.delete(fixture.shopsTable).where(inArray(fixture.shopsTable.id, fixture.shops));
  }
  if (fixture.db && fixture.organizations.length) {
    await fixture.db
      .delete(fixture.partnerOrganizationsTable)
      .where(inArray(fixture.partnerOrganizationsTable.id, fixture.organizations));
  }
  if (fixture.db && fixture.users.length) {
    await fixture.db.delete(fixture.usersTable).where(inArray(fixture.usersTable.id, fixture.users));
  }
  fixture.server?.closeAllConnections?.();
  if (fixture.server) await new Promise<void>((resolve) => fixture.server.close(resolve));
  await fixture.pool?.end();
});

test("supports customer, mechanic, and all three business subtypes", { skip: !enabled }, async () => {
  const customer = await registerLegacy("customer", "customer");
  const mechanic = await registerLegacy("mechanic", "mechanic");
  assert.ok(customer.token && mechanic.token);
  await registerBusiness("shop", "Shop");
  await registerBusiness("dealership", "Dealership");
  await registerBusiness("fleet", "Fleet");
});

test("business administrator login and /auth/me preserve the human principal", { skip: !enabled }, async () => {
  const owner = fixture.businesses[0];
  assert.ok(owner);
  const login = await api<{ token: string; user: { id: number; role: string } }>("/api/auth/login", {
    method: "POST",
    body: { email: owner.email, password: "BusinessTest!2026" },
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.user.id, owner.id);
  assert.equal(login.body.user.role, "shop_owner");

  const me = await api<{ id: number; email: string; role: string }>("/api/auth/me", {
    token: login.body.token,
  });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.id, owner.id);
  assert.equal(me.body.email, owner.email.toLowerCase());
  assert.equal(me.body.role, "shop_owner");
});

test("rejects strict caller fields and rolls back duplicate administrator signup", { skip: !enabled }, async () => {
  const owner = fixture.businesses[0];
  assert.ok(owner);
  const legacyOwner = await api("/api/auth/register", {
    method: "POST",
    body: {
      name: "Person Only Owner",
      email: `legacy-owner-${Date.now()}@example.test`,
      password: "BusinessTest!2026",
      role: "shop_owner",
      address: "299 Legacy Road",
      city: "Brooklyn",
      region: "NY",
      zipCode: "11201",
    },
  });
  assert.equal(legacyOwner.response.status, 400);

  const before = await fixture.db
    .select({ id: fixture.partnerOrganizationsTable.id })
    .from(fixture.partnerOrganizationsTable);
  const usersBefore = await fixture.db
    .select({ id: fixture.usersTable.id })
    .from(fixture.usersTable);

  const duplicate = await api("/api/auth/register-business", {
    method: "POST",
    body: {
      business: {
        legalName: "Should Roll Back",
        subtype: "shop",
        email: "rollback-business@example.test",
        phone: "+15550100030",
        address: "300 Rollback Road",
        city: "Brooklyn",
        region: "NY",
      },
      administrator: {
        name: "Duplicate Administrator",
        email: owner.email,
        password: "BusinessTest!2026",
      },
    },
  });
  assert.equal(duplicate.response.status, 409);
  const after = await fixture.db
    .select({ id: fixture.partnerOrganizationsTable.id })
    .from(fixture.partnerOrganizationsTable);
  const usersAfter = await fixture.db
    .select({ id: fixture.usersTable.id })
    .from(fixture.usersTable);
  assert.equal(after.length, before.length);
  assert.equal(usersAfter.length, usersBefore.length);

  const invalid = await api("/api/auth/register-business", {
    method: "POST",
    body: {
      business: {
        legalName: "Invalid Fields",
        subtype: "fleet",
        email: "invalid-fields@example.test",
        phone: "+15550100031",
        address: "301 Invalid Road",
        city: "Brooklyn",
        region: "NY",
        stripeAccountId: "acct_forbidden",
      },
      administrator: {
        name: "Invalid Administrator",
        email: "invalid-admin@example.test",
        password: "BusinessTest!2026",
      },
      role: "admin",
    },
  });
  assert.equal(invalid.response.status, 400);
});

test("keeps multiple organizations owner-scoped and locations explicit", { skip: !enabled }, async () => {
  const owner = fixture.businesses[0];
  assert.ok(owner);
  const created = await api<{
    id: number;
    primaryOwnerId: number;
    legalName: string | null;
  }>("/api/partner-organizations", {
    method: "POST",
    token: owner.token,
    body: {
      legalName: "Second Legal Entity",
      name: "Second Display",
      subtype: "shop",
      phone: "+15550100040",
      email: "second-entity@example.test",
      address: "400 Second Street",
      city: "Brooklyn",
      region: "NY",
    },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.primaryOwnerId, owner.id);
  assert.equal(created.body.legalName, "Second Legal Entity");
  fixture.organizations.push(created.body.id);

  const patched = await api<{ legalName: string | null }>(`/api/partner-organizations/${created.body.id}`, {
    method: "PATCH",
    token: owner.token,
    body: { legalName: "Second Legal Entity Updated" },
  });
  assert.equal(patched.response.status, 200);
  assert.equal(patched.body.legalName, "Second Legal Entity Updated");

  const locations = await api<unknown[]>(`/api/partner-organizations/${owner.organizationId}/locations`, {
    token: owner.token,
  });
  assert.equal(locations.response.status, 200);
  assert.deepEqual(locations.body, []);
});