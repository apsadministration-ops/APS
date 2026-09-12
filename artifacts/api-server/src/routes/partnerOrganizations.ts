import { Router, type IRouter } from "express";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  partnerOrganizationsTable,
  partnerVehicleOperationsTable,
  shopsTable,
} from "@workspace/db";
import {
  CreatePartnerOrganizationBody,
  GetPartnerOrganizationParams,
  GetPartnerOrganizationResponse,
  ListPartnerOrganizationLocationsParams,
  ListPartnerOrganizationLocationsResponse,
  ListPartnerOrganizationsResponse,
  LinkPartnerOrganizationLocationBody,
  LinkPartnerOrganizationLocationParams,
  LinkPartnerOrganizationLocationResponse,
  UpdatePartnerOrganizationBody,
  UpdatePartnerOrganizationParams,
  UpdatePartnerOrganizationResponse,
} from "@workspace/api-zod";
import {
  authenticate,
  requireShopOwner,
  type AuthRequest,
} from "../middlewares/authenticate";

const router: IRouter = Router();

const CREATE_FIELDS = new Set([
  "name",
  "subtype",
  "contactName",
  "phone",
  "email",
  "address",
  "city",
  "region",
  "zipCode",
]);
const UPDATE_FIELDS = new Set([
  ...CREATE_FIELDS,
  "status",
]);
const LINK_FIELDS = new Set(["shopId"]);

function hasUnknownFields(value: unknown, allowed: Set<string>): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return true;
  }
  return Object.keys(value).some((key) => !allowed.has(key));
}

function positiveSafeInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function requireOrganizationId(
  value: unknown,
  res: { status(code: number): { json(body: unknown): unknown } },
): number | null {
  const organizationId = positiveSafeInteger(value);
  if (organizationId === null) {
    res.status(400).json({ error: "organizationId must be a positive safe integer" });
  }
  return organizationId;
}

function formatOrganization(
  organization: typeof partnerOrganizationsTable.$inferSelect,
) {
  return {
    id: organization.id,
    primaryOwnerId: organization.primaryOwnerId,
    name: organization.name,
    subtype: organization.subtype,
    contactName: organization.contactName ?? null,
    phone: organization.phone,
    email: organization.email,
    address: organization.address,
    city: organization.city,
    region: organization.region,
    zipCode: organization.zipCode ?? null,
    status: organization.status,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

function formatShop(shop: typeof shopsTable.$inferSelect) {
  return {
    id: shop.id,
    ownerId: shop.ownerId,
    organizationId: shop.organizationId ?? null,
    partnerKind: shop.partnerKind,
    name: shop.name,
    address: shop.address,
    city: shop.city,
    region: shop.region,
    zipCode: shop.zipCode,
    lat: shop.lat ?? null,
    lng: shop.lng ?? null,
    phone: shop.phone ?? null,
    federalEin: shop.federalEin ?? null,
    businessLicense: shop.businessLicense ?? null,
    insuranceCarrier: shop.insuranceCarrier ?? null,
    insurancePolicyNumber: shop.insurancePolicyNumber ?? null,
    status: shop.status,
    createdAt: shop.createdAt,
  };
}

async function ownedOrganization(
  organizationId: number,
  ownerId: number,
) {
  const [organization] = await db
    .select()
    .from(partnerOrganizationsTable)
    .where(
      and(
        eq(partnerOrganizationsTable.id, organizationId),
        eq(partnerOrganizationsTable.primaryOwnerId, ownerId),
      ),
    );
  return organization;
}

router.get(
  "/partner-organizations",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizations = await db
      .select()
      .from(partnerOrganizationsTable)
      .where(eq(partnerOrganizationsTable.primaryOwnerId, req.userId!))
      .orderBy(partnerOrganizationsTable.createdAt);
    res.json(
      ListPartnerOrganizationsResponse.parse(
        organizations.map(formatOrganization),
      ),
    );
  },
);

router.post(
  "/partner-organizations",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    if (hasUnknownFields(req.body, CREATE_FIELDS)) {
      res.status(400).json({ error: "Unknown organization field" });
      return;
    }
    const parsed = CreatePartnerOrganizationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [organization] = await db
      .insert(partnerOrganizationsTable)
      .values({
        primaryOwnerId: req.userId!,
        name: parsed.data.name,
        subtype: parsed.data.subtype,
        contactName: parsed.data.contactName ?? null,
        phone: parsed.data.phone,
        email: parsed.data.email,
        address: parsed.data.address,
        city: parsed.data.city,
        region: parsed.data.region,
        zipCode: parsed.data.zipCode ?? null,
      })
      .returning();
    res
      .status(201)
      .json(GetPartnerOrganizationResponse.parse(formatOrganization(organization)));
  },
);

router.get(
  "/partner-organizations/:organizationId",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = requireOrganizationId(req.params.organizationId, res);
    if (organizationId === null) return;
    const params = GetPartnerOrganizationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const organization = await ownedOrganization(
      organizationId,
      req.userId!,
    );
    // Do not disclose whether another owner has an organization at this ID.
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    res.json(GetPartnerOrganizationResponse.parse(formatOrganization(organization)));
  },
);

router.patch(
  "/partner-organizations/:organizationId",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = requireOrganizationId(req.params.organizationId, res);
    if (organizationId === null) return;
    const params = UpdatePartnerOrganizationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (hasUnknownFields(req.body, UPDATE_FIELDS)) {
      res.status(400).json({ error: "Unknown organization field" });
      return;
    }
    if (
      req.body === null ||
      typeof req.body !== "object" ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length === 0
    ) {
      res.status(400).json({ error: "At least one organization field is required" });
      return;
    }
    const parsed = UpdatePartnerOrganizationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const organization = await ownedOrganization(
      organizationId,
      req.userId!,
    );
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    const value = parsed.data;
    const updates: Partial<typeof partnerOrganizationsTable.$inferInsert> = {};
    if (value.name !== undefined) updates.name = value.name;
    if (value.subtype !== undefined) updates.subtype = value.subtype;
    if (value.contactName !== undefined) updates.contactName = value.contactName;
    if (value.phone !== undefined) updates.phone = value.phone;
    if (value.email !== undefined) updates.email = value.email;
    if (value.address !== undefined) updates.address = value.address;
    if (value.city !== undefined) updates.city = value.city;
    if (value.region !== undefined) updates.region = value.region;
    if (value.zipCode !== undefined) updates.zipCode = value.zipCode;
    if (value.status !== undefined) updates.status = value.status;

    let updated: typeof partnerOrganizationsTable.$inferSelect | undefined;
    try {
      updated = await db.transaction(async (tx) => {
        if (value.subtype !== undefined) {
          // Always lock and re-read when subtype is present, even when the
          // initial read matched the request. This serializes subtype edits
          // with operation creation and rejects stale read/modify/write.
          const lockedRows = await tx.execute(sql`
            SELECT id, subtype
            FROM partner_organizations
            WHERE id = ${organizationId}
              AND primary_owner_id = ${req.userId!}
            FOR UPDATE
          `);
          const locked = lockedRows.rows[0] as
            | { id: number; subtype: string }
            | undefined;
          if (!locked) return undefined;
          if (locked.subtype !== organization.subtype) {
            throw new Error("ORGANIZATION_SUBTYPE_STALE");
          }
          if (locked.subtype !== value.subtype) {
            const [operationCount] = await tx
              .select({ count: count() })
              .from(partnerVehicleOperationsTable)
              .where(
                eq(
                  partnerVehicleOperationsTable.organizationId,
                  organizationId,
                ),
              );
            if (Number(operationCount?.count ?? 0) > 0) {
              throw new Error("ORGANIZATION_SUBTYPE_LOCKED");
            }
          }
        }
        const [next] = await tx
          .update(partnerOrganizationsTable)
          .set(updates)
          .where(
            and(
              eq(partnerOrganizationsTable.id, organizationId),
              eq(partnerOrganizationsTable.primaryOwnerId, req.userId!),
            ),
          )
          .returning();
        return next;
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "ORGANIZATION_SUBTYPE_LOCKED" ||
          error.message === "ORGANIZATION_SUBTYPE_STALE")
      ) {
        res.status(409).json({
          error: "Organization subtype cannot change while vehicle operations exist",
        });
        return;
      }
      throw error;
    }
    if (!updated) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    res.json(
      UpdatePartnerOrganizationResponse.parse(formatOrganization(updated)),
    );
  },
);

router.get(
  "/partner-organizations/:organizationId/locations",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = requireOrganizationId(req.params.organizationId, res);
    if (organizationId === null) return;
    const params = ListPartnerOrganizationLocationsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const organization = await ownedOrganization(
      organizationId,
      req.userId!,
    );
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    const locations = await db
      .select()
      .from(shopsTable)
      .where(
        and(
          eq(shopsTable.organizationId, organization.id),
          eq(shopsTable.ownerId, req.userId!),
        ),
      )
      .orderBy(shopsTable.createdAt);
    res.json(
      ListPartnerOrganizationLocationsResponse.parse(
        locations.map(formatShop),
      ),
    );
  },
);

router.post(
  "/partner-organizations/:organizationId/locations",
  authenticate,
  requireShopOwner,
  async (req: AuthRequest, res): Promise<void> => {
    const organizationId = requireOrganizationId(req.params.organizationId, res);
    if (organizationId === null) return;
    const params = LinkPartnerOrganizationLocationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (hasUnknownFields(req.body, LINK_FIELDS)) {
      res.status(400).json({ error: "Unknown location link field" });
      return;
    }
    const shopId = positiveSafeInteger(req.body?.shopId);
    if (shopId === null) {
      res.status(400).json({ error: "shopId must be a positive safe integer" });
      return;
    }
    const parsed = LinkPartnerOrganizationLocationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const organization = await ownedOrganization(
      organizationId,
      req.userId!,
    );
    if (!organization) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    if (organization.status !== "active") {
      res.status(409).json({ error: "Inactive organizations cannot link locations" });
      return;
    }

    try {
      const linked = await db.transaction(async (tx) => {
        // Lock the organization as well as the location. This keeps an
        // in-flight deactivation from allowing a link after the active check.
        const organizationRows = await tx.execute(sql`
          SELECT id, status
          FROM partner_organizations
          WHERE id = ${organization.id}
            AND primary_owner_id = ${req.userId!}
          FOR UPDATE
        `);
        const lockedOrganization = organizationRows.rows[0] as
          | { id: number; status: string }
          | undefined;
        if (!lockedOrganization) {
          throw new Error("ORGANIZATION_NOT_FOUND");
        }
        if (lockedOrganization.status !== "active") {
          throw new Error("ORGANIZATION_INACTIVE");
        }

        // Lock the location row so two concurrent link requests cannot both
        // observe a null organizationId and silently race to reassign it.
        await tx.execute(sql`
          SELECT id
          FROM shops
          WHERE id = ${shopId}
            AND owner_id = ${req.userId!}
          FOR UPDATE
        `);
        const [shop] = await tx
          .select()
          .from(shopsTable)
          .where(
            and(
              eq(shopsTable.id, shopId),
              eq(shopsTable.ownerId, req.userId!),
            ),
          );
        if (!shop) {
          throw new Error("LOCATION_NOT_FOUND");
        }
        if (shop.organizationId !== null) {
          throw new Error("LOCATION_ALREADY_LINKED");
        }
        const [updated] = await tx
          .update(shopsTable)
          .set({ organizationId: organization.id })
          .where(
            and(
              eq(shopsTable.id, shop.id),
              eq(shopsTable.ownerId, req.userId!),
              isNull(shopsTable.organizationId),
            ),
          )
          .returning();
        if (!updated) {
          throw new Error("LOCATION_NOT_FOUND");
        }
        return updated;
      });
      res.json(
        LinkPartnerOrganizationLocationResponse.parse(formatShop(linked)),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "LOCATION_NOT_FOUND") {
        res.status(404).json({ error: "Shop location not found" });
        return;
      }
      if (error instanceof Error && error.message === "ORGANIZATION_NOT_FOUND") {
        res.status(404).json({ error: "Organization not found" });
        return;
      }
      if (error instanceof Error && error.message === "ORGANIZATION_INACTIVE") {
        res.status(409).json({ error: "Inactive organizations cannot link locations" });
        return;
      }
      if (
        error instanceof Error &&
        error.message === "LOCATION_ALREADY_LINKED"
      ) {
        res.status(409).json({ error: "Shop location is already linked" });
        return;
      }
      throw error;
    }
  },
);

export default router;