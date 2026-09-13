/**
 * Organization-owned Stripe Connect helpers.
 *
 * This module intentionally does not use the Drizzle organization model for
 * the Connect-only columns. The organization schema/migration is owned by the
 * database workstream; selecting the row as `*` lets this bounded ownership
 * correction compile while those nullable columns are introduced. Once the
 * migration is present, only partner_organizations owns these values.
 */

import type Stripe from "stripe";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";

export interface BusinessOrganizationConnect {
  id: number;
  primaryOwnerId: number;
  name: string;
  legalName: string | null;
  email: string;
  phone: string;
  address: string;
  city: string;
  region: string;
  zipCode: string | null;
  status: string;
  stripeAccountId: string | null;
  stripeAccountReady: boolean;
}

export interface SqlQueryRunner {
  execute(query: SQL<unknown>): Promise<{ rows: unknown[] }>;
}

export class BusinessConnectError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BusinessConnectError";
  }
}

export type BusinessPayoutDestination = {
  accountId: string;
  organizationId: number | null;
  source: "organization" | "legacy_shop";
};

type RawRow = Record<string, unknown>;

function rowObject(value: unknown): RawRow {
  return value !== null && typeof value === "object"
    ? value as RawRow
    : {};
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function mapOrganization(value: unknown): BusinessOrganizationConnect | null {
  const row = rowObject(value);
  const id = numberValue(row.id);
  const primaryOwnerId = numberValue(row.primary_owner_id ?? row.primaryOwnerId);
  const name = stringValue(row.name);
  const email = stringValue(row.email);
  const phone = stringValue(row.phone);
  const address = stringValue(row.address);
  const city = stringValue(row.city);
  const region = stringValue(row.region);
  if (
    id === null ||
    primaryOwnerId === null ||
    !name ||
    !email ||
    !phone ||
    !address ||
    !city ||
    !region
  ) {
    return null;
  }
  return {
    id,
    primaryOwnerId,
    name,
    legalName: stringValue(row.legal_name ?? row.legalName),
    email,
    phone,
    address,
    city,
    region,
    zipCode: stringValue(row.zip_code ?? row.zipCode),
    status: stringValue(row.status) ?? "inactive",
    stripeAccountId: stringValue(row.stripe_account_id ?? row.stripeAccountId),
    stripeAccountReady: booleanValue(row.stripe_account_ready ?? row.stripeAccountReady),
  };
}

function organizationQuery(
  organizationId: number,
  ownerId?: number,
  forUpdate = false,
): SQL<unknown> {
  const ownerClause = ownerId === undefined
    ? sql``
    : sql` AND primary_owner_id = ${ownerId}`;
  const lockClause = forUpdate ? sql` FOR UPDATE` : sql``;
  return sql`
    SELECT *
    FROM partner_organizations
    WHERE id = ${organizationId}${ownerClause}${lockClause}
  `;
}

/** Read one organization using the explicit ID and (when supplied) owner. */
export async function getBusinessOrganization(
  runner: SqlQueryRunner = db,
  organizationId: number,
  ownerId?: number,
): Promise<BusinessOrganizationConnect | null> {
  const result = await runner.execute(organizationQuery(organizationId, ownerId));
  return mapOrganization(result.rows[0]);
}

function assertActivePrimaryOwner(
  organization: BusinessOrganizationConnect | null,
  ownerId: number,
): asserts organization is BusinessOrganizationConnect {
  if (!organization || organization.primaryOwnerId !== ownerId) {
    // Do not disclose an organization owned by a different account.
    throw new BusinessConnectError(404, "organization_not_found", "Organization not found.");
  }
  if (organization.status !== "active") {
    throw new BusinessConnectError(
      409,
      "organization_inactive",
      "This organization is inactive. Reactivate it before setting up payouts.",
    );
  }
}

export function businessConnectAccountCreateParams(
  organization: BusinessOrganizationConnect,
): Stripe.AccountCreateParams {
  const legalName = organization.legalName ?? organization.name;
  return {
    type: "express",
    business_type: "company",
    email: organization.email,
    company: {
      name: legalName,
      phone: organization.phone,
      address: {
        line1: organization.address,
        city: organization.city,
        state: organization.region,
        postal_code: organization.zipCode ?? undefined,
      },
    },
    business_profile: {
      name: organization.name,
    },
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
    metadata: {
      organizationId: String(organization.id),
      kind: "partner_organization",
    },
  };
}

function accountLinkUrls(baseUrl: string): {
  refresh_url: string;
  return_url: string;
} {
  return {
    refresh_url: `${baseUrl}/api/payments/connect/return?status=refresh`,
    return_url: `${baseUrl}/api/payments/connect/return?status=done`,
  };
}

export function hasAmbiguousLegacyConnectMapping(
  accountIds: Iterable<unknown>,
): boolean {
  const ids = new Set<string>();
  for (const value of accountIds) {
    const id = stringValue(value);
    if (id) ids.add(id);
  }
  return ids.size > 1;
}

async function assertLegacyOwnerMappingIsUnambiguous(
  runner: SqlQueryRunner,
  ownerId: number,
): Promise<void> {
  const [shops, users] = await Promise.all([
    runner.execute(sql`
      SELECT stripe_account_id
      FROM shops
      WHERE owner_id = ${ownerId}
        AND stripe_account_id IS NOT NULL
    `),
    runner.execute(sql`
      SELECT stripe_account_id
      FROM users
      WHERE id = ${ownerId}
        AND stripe_account_id IS NOT NULL
    `),
  ]);
  const accountIds = [...shops.rows, ...users.rows]
    .map((row) => {
      const value = rowObject(row);
      return value.stripe_account_id ?? value.stripeAccountId;
    });
  if (hasAmbiguousLegacyConnectMapping(accountIds)) {
    throw new BusinessConnectError(
      409,
      "legacy_connect_mapping_ambiguous",
      "Multiple legacy payout accounts require explicit resolution before new business onboarding.",
    );
  }
}

/**
 * Create/resume organization onboarding. The row lock and provider
 * idempotency key cover both concurrent requests and a process failure after
 * Stripe creates the account but before the database update commits.
 */
export async function beginBusinessOnboarding(input: {
  organizationId: number;
  ownerId: number;
  stripe: Stripe;
  baseUrl: string;
}): Promise<{ organizationId: number; accountId: string; ready: boolean; url: string }> {
  if (!input.baseUrl) {
    throw new BusinessConnectError(503, "public_url_not_configured", "Public URL is not configured.");
  }

  const account = await db.transaction(async (tx) => {
    const lockedResult = await tx.execute(
      organizationQuery(input.organizationId, input.ownerId, true),
    );
    const organization = mapOrganization(lockedResult.rows[0]);
    assertActivePrimaryOwner(organization, input.ownerId);

    if (organization.stripeAccountId) {
      const ownership = await resolveConnectAccountOwner(
        tx,
        organization.stripeAccountId,
      );
      if (
        ownership.kind !== "organization" ||
        ownership.id !== organization.id
      ) {
        throw new BusinessConnectError(
          409,
          "business_connect_ownership_collision",
          "This organization account has an ambiguous ownership mapping; explicit resolution is required.",
        );
      }
      return {
        accountId: organization.stripeAccountId,
        ready: organization.stripeAccountReady,
      };
    }

    // Never choose a legacy user/shop account by owner. If the owner has
    // several historical account IDs, stop rather than creating an implicit
    // mapping that could steal one location's destination.
    await assertLegacyOwnerMappingIsUnambiguous(tx, input.ownerId);

    const created = await input.stripe.accounts.create(
      businessConnectAccountCreateParams(organization),
      {
        idempotencyKey: `business-connect:organization:${organization.id}:account`,
      },
    );
    const updated = await tx.execute(sql`
      UPDATE partner_organizations
      SET stripe_account_id = ${created.id},
          stripe_account_ready = 0,
          stripe_account_type = 'company'
      WHERE id = ${organization.id}
        AND primary_owner_id = ${input.ownerId}
        AND status = 'active'
      RETURNING stripe_account_id
    `);
    const row = rowObject(updated.rows[0]);
    const accountId = stringValue(row.stripe_account_id ?? row.stripeAccountId);
    if (!accountId) {
      throw new BusinessConnectError(
        503,
        "business_connect_persistence_unavailable",
        "Business payout storage is unavailable; try onboarding again.",
      );
    }
    return { accountId, ready: false };
  });

  const link = await input.stripe.accountLinks.create({
    account: account.accountId,
    ...accountLinkUrls(input.baseUrl),
    type: "account_onboarding",
  });
  return {
    organizationId: input.organizationId,
    accountId: account.accountId,
    ready: account.ready,
    url: link.url,
  };
}

export async function getBusinessPayoutStatus(input: {
  organizationId: number;
  ownerId: number;
  stripe: Stripe;
}): Promise<{
  organizationId: number;
  accountId: string | null;
  ready: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}> {
  const organization = await getBusinessOrganization(db, input.organizationId, input.ownerId);
  assertActivePrimaryOwner(organization, input.ownerId);
  if (!organization.stripeAccountId) {
    return {
      organizationId: organization.id,
      accountId: null,
      ready: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    };
  }
  const ownership = await resolveConnectAccountOwner(db, organization.stripeAccountId);
  if (
    ownership.kind !== "organization" ||
    ownership.id !== organization.id
  ) {
    throw new BusinessConnectError(
      409,
      "business_connect_ownership_collision",
      "This organization account has an ambiguous ownership mapping; explicit resolution is required.",
    );
  }
  const account = await input.stripe.accounts.retrieve(organization.stripeAccountId);
  const chargesEnabled = Boolean(account.charges_enabled);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const detailsSubmitted = Boolean(account.details_submitted);
  const ready = chargesEnabled && payoutsEnabled && detailsSubmitted;
  if (ready !== organization.stripeAccountReady) {
    await db.execute(sql`
      UPDATE partner_organizations
      SET stripe_account_ready = ${ready ? 1 : 0}
      WHERE id = ${organization.id}
        AND primary_owner_id = ${input.ownerId}
    `);
  }
  return {
    organizationId: organization.id,
    accountId: organization.stripeAccountId,
    ready,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted,
  };
}

export async function createBusinessLoginLink(input: {
  organizationId: number;
  ownerId: number;
  stripe: Stripe;
}): Promise<{ organizationId: number; accountId: string; url: string }> {
  const organization = await getBusinessOrganization(db, input.organizationId, input.ownerId);
  assertActivePrimaryOwner(organization, input.ownerId);
  if (!organization.stripeAccountId) {
    throw new BusinessConnectError(
      400,
      "business_connect_onboarding_required",
      "Business payouts are not set up. Use the organization onboarding route first.",
    );
  }
  const ownership = await resolveConnectAccountOwner(db, organization.stripeAccountId);
  if (
    ownership.kind !== "organization" ||
    ownership.id !== organization.id
  ) {
    throw new BusinessConnectError(
      409,
      "business_connect_ownership_collision",
      "This organization account has an ambiguous ownership mapping; explicit resolution is required.",
    );
  }
  const link = await input.stripe.accounts.createLoginLink(organization.stripeAccountId);
  return {
    organizationId: organization.id,
    accountId: organization.stripeAccountId,
    url: link.url,
  };
}

/**
 * Resolve a shop destination without ever treating a shop owner as the
 * account owner. Linked locations use the canonical organization account;
 * only unlinked, already-valid legacy locations may use their old account.
 */
export async function resolveShopPayoutDestination(
  runner: SqlQueryRunner,
  shop: {
    id: number;
    ownerId: number;
    organizationId: number | null;
    stripeAccountId: string | null;
    stripeAccountReady: number | boolean;
    status: string;
  },
  job: { sourceOrganizationId: number | null },
): Promise<BusinessPayoutDestination> {
  if (shop.status !== "active") {
    throw new BusinessConnectError(409, "shop_inactive", "Selected shop is inactive.");
  }

  if (shop.organizationId === null) {
    if (!shop.stripeAccountId || !booleanValue(shop.stripeAccountReady)) {
      throw new BusinessConnectError(
        400,
        "legacy_shop_payout_not_ready",
        "The selected legacy shop does not have a valid payout destination.",
      );
    }
    const ownership = await resolveConnectAccountOwner(runner, shop.stripeAccountId);
    if (
      ownership.kind !== "legacy_shop" ||
      ownership.id !== shop.id
    ) {
      throw new BusinessConnectError(
        409,
        "payout_destination_ownership_collision",
        "The selected legacy shop payout account has an ambiguous ownership mapping.",
      );
    }
    return {
      accountId: shop.stripeAccountId,
      organizationId: null,
      source: "legacy_shop",
    };
  }

  if (job.sourceOrganizationId !== shop.organizationId) {
    throw new BusinessConnectError(
      403,
      "shop_organization_mismatch",
      "The selected location is not the exact organization for this job.",
    );
  }

  const organization = await getBusinessOrganization(runner, shop.organizationId);
  if (!organization || organization.primaryOwnerId !== shop.ownerId) {
    throw new BusinessConnectError(
      403,
      "shop_organization_owner_mismatch",
      "The selected location is not owned by its linked organization.",
    );
  }
  if (organization.status !== "active") {
    throw new BusinessConnectError(
      409,
      "organization_inactive",
      "The selected organization is inactive.",
    );
  }
  if (!organization.stripeAccountId || !organization.stripeAccountReady) {
    throw new BusinessConnectError(
      400,
      "organization_payout_not_ready",
      "The selected organization has not completed payout onboarding.",
    );
  }
  const ownership = await resolveConnectAccountOwner(
    runner,
    organization.stripeAccountId,
  );
  if (
    ownership.kind !== "organization" ||
    ownership.id !== organization.id
  ) {
    throw new BusinessConnectError(
      409,
      "payout_destination_ownership_collision",
      "The selected organization payout account has an ambiguous ownership mapping.",
    );
  }
  return {
    accountId: organization.stripeAccountId,
    organizationId: organization.id,
    source: "organization",
  };
}

export type ConnectAccountOwnerResolution =
  | { kind: "organization"; id: number }
  | { kind: "mechanic"; id: number }
  | { kind: "legacy_shop"; id: number }
  | { kind: "unknown" }
  | { kind: "collision"; reason: string };

/**
 * Resolve account.updated without selecting an arbitrary first row. A linked
 * shop's legacy account is deliberately not eligible; it must be migrated by
 * an explicit operator decision to the organization account.
 */
export async function resolveConnectAccountOwner(
  runner: SqlQueryRunner,
  accountId: string,
): Promise<ConnectAccountOwnerResolution> {
  const [organizations, users, shops] = await Promise.all([
    runner.execute(sql`
      SELECT id
      FROM partner_organizations
      WHERE stripe_account_id = ${accountId}
    `),
    runner.execute(sql`
      SELECT id, role
      FROM users
      WHERE stripe_account_id = ${accountId}
    `),
    runner.execute(sql`
      SELECT id, organization_id
      FROM shops
      WHERE stripe_account_id = ${accountId}
    `),
  ]);
  const organizationRows = organizations.rows
    .map(rowObject)
    .map((row) => numberValue(row.id))
    .filter((id): id is number => id !== null);
  const userRows = users.rows.map(rowObject);
  const shopRows = shops.rows.map(rowObject);

  if (organizationRows.length > 1) {
    return { kind: "collision", reason: "duplicate_organization_account" };
  }
  if (organizationRows.length === 1) {
    if (userRows.length > 0 || shopRows.length > 0) {
      return { kind: "collision", reason: "cross_table_account_collision" };
    }
    return { kind: "organization", id: organizationRows[0] };
  }
  if (userRows.length > 1 || shopRows.length > 1) {
    return { kind: "collision", reason: "duplicate_legacy_account" };
  }
  if (userRows.length === 1 && shopRows.length === 0) {
    if (userRows[0].role !== "mechanic") {
      return { kind: "collision", reason: "non_mechanic_user_account" };
    }
    const id = numberValue(userRows[0].id);
    return id === null
      ? { kind: "collision", reason: "invalid_mechanic_mapping" }
      : { kind: "mechanic", id };
  }
  if (userRows.length === 0 && shopRows.length === 1) {
    const organizationId = numberValue(shopRows[0].organization_id ?? shopRows[0].organizationId);
    if (organizationId !== null) {
      return { kind: "collision", reason: "linked_shop_legacy_account" };
    }
    const id = numberValue(shopRows[0].id);
    return id === null
      ? { kind: "collision", reason: "invalid_legacy_shop_mapping" }
      : { kind: "legacy_shop", id };
  }
  if (userRows.length > 0 || shopRows.length > 0) {
    return { kind: "collision", reason: "cross_table_account_collision" };
  }
  return { kind: "unknown" };
}

/** Apply one account.updated readiness change only to an unambiguous owner. */
export async function syncConnectAccountReadiness(
  accountId: string,
  ready: boolean,
): Promise<ConnectAccountOwnerResolution> {
  const resolution = await resolveConnectAccountOwner(db, accountId);
  if (resolution.kind === "collision" || resolution.kind === "unknown") {
    return resolution;
  }
  const readyValue = ready ? 1 : 0;
  if (resolution.kind === "organization") {
    await db.execute(sql`
      UPDATE partner_organizations
      SET stripe_account_ready = ${readyValue}
      WHERE id = ${resolution.id}
        AND stripe_account_id = ${accountId}
    `);
  } else if (resolution.kind === "legacy_shop") {
    await db.execute(sql`
      UPDATE shops
      SET stripe_account_ready = ${readyValue}
      WHERE id = ${resolution.id}
        AND stripe_account_id = ${accountId}
        AND organization_id IS NULL
    `);
  } else {
    // Mechanic ownership remains on users and intentionally uses the existing
    // user-ID mapping rather than the organization ownership path.
    await db.execute(sql`
      UPDATE users
      SET stripe_account_ready = ${readyValue}
      WHERE id = ${resolution.id}
        AND stripe_account_id = ${accountId}
        AND role = 'mechanic'
    `);
  }
  return resolution;
}
