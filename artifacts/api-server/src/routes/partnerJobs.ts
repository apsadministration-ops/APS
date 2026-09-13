import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, jobsTable, shopsTable, vehiclesTable, usersTable } from "@workspace/db";
import { authenticate, requireShopOwner, type AuthRequest } from "../middlewares/authenticate";
import { notifyMechanics } from "../lib/notifications";
import { requiresLiftFromDescription } from "../lib/transportKeywords";
import {
  findServiceBySlug,
  quoteForService,
  isEuropeanVehicle,
  type TierKey,
  type ServiceCategory,
} from "@workspace/tier-catalog";

const router: IRouter = Router();

/**
 * Priority window (in seconds) before junior tiers (technician/detailer)
 * can see a partner-posted job. Senior+ mechanics see it immediately.
 */
const JUNIOR_WINDOW_SEC: Record<"urgent" | "high" | "normal" | "low", number> = {
  urgent: 0,
  high: 15 * 60,
  normal: 60 * 60,
  low: 4 * 60 * 60,
};

export type PartnerJobPolicyInput = {
  vehicle: Pick<typeof vehiclesTable.$inferSelect, "vin" | "make">;
  serviceSlug?: string | null;
  jobType?: string | null;
  description: string;
  urgency?: string | null;
};

/**
 * Shared policy resolution for legacy partner posting and the Part 6
 * service-request bridge. Both paths must derive catalog category, tier,
 * server price, urgency visibility, and Ghost Garage state identically.
 */
export function resolvePartnerJobPolicy(input: PartnerJobPolicyInput) {
  const catalogEntry = findServiceBySlug(input.serviceSlug);
  if (input.serviceSlug && !catalogEntry) {
    return { error: `Unknown serviceSlug: ${input.serviceSlug}` } as const;
  }
  const finalJobType = (catalogEntry?.category ?? input.jobType ?? "repair") as ServiceCategory;
  if (!["repair", "diagnostic", "maintenance", "detailing"].includes(finalJobType)) {
    return { error: "Invalid jobType." } as const;
  }
  const finalRequiredTier: TierKey = catalogEntry?.tier ?? "technician";
  const urgency = (input.urgency ?? "normal") as keyof typeof JUNIOR_WINDOW_SEC;
  if (!(urgency in JUNIOR_WINDOW_SEC)) {
    return { error: "Invalid urgency." } as const;
  }
  const isEuropean = isEuropeanVehicle({ vin: input.vehicle.vin, make: input.vehicle.make });
  const quote = catalogEntry ? quoteForService(catalogEntry, { isEuropean }) : null;
  return {
    catalogEntry,
    finalJobType,
    finalRequiredTier,
    derivedPrice: quote?.bookedTotal ?? null,
    urgency,
    juniorVisibleAt: new Date(Date.now() + JUNIOR_WINDOW_SEC[urgency] * 1000),
    ghostGarage: requiresLiftFromDescription(input.description),
  } as const;
}

/**
 * POST /partner/jobs — Fleet & Commercial Partner job posting.
 *
 * Only owners of shops with partnerKind ∈ {dealership, fleet} may post here.
 * Independent shops do NOT post jobs (they rent bays via /bays). Commission
 * is stamped from the shop's commissionOverridePct (default 15% flat,
 * typically 10% for GSA/Government accounts). The priority window stamped
 * via `juniorVisibleAt` gives senior+ mechanics first dibs.
 */
router.post("/partner/jobs", authenticate, requireShopOwner, async (req: AuthRequest, res): Promise<void> => {
  const body = (req.body ?? {}) as {
    shopId?: number;
    vehicleId?: number;
    serviceSlug?: string;
    jobType?: string;
    description?: string;
    locationLat?: number;
    locationLng?: number;
    locationAddress?: string;
    urgency?: "low" | "normal" | "high" | "urgent";
    recurringGroupId?: string;
  };

  if (!body.shopId || !body.vehicleId || !body.description?.trim()) {
    res.status(400).json({ error: "shopId, vehicleId, and description are required." });
    return;
  }

  // Verify shop ownership + partner-kind eligibility.
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, body.shopId));
  if (!shop) { res.status(404).json({ error: "Shop not found." }); return; }
  if (shop.ownerId !== req.userId && req.userRole !== "admin") {
    res.status(403).json({ error: "Not your shop." });
    return;
  }
  if (shop.partnerKind !== "dealership" && shop.partnerKind !== "fleet" && shop.partnerKind !== "gsa") {
    res.status(403).json({ error: "Only Dealership and Fleet partners can post jobs. Independent Shops rent bays instead." });
    return;
  }
  if (shop.status !== "active") {
    res.status(409).json({ error: `Shop is ${shop.status}; cannot post jobs.` });
    return;
  }

  // Vehicle must exist AND must be a fleet vehicle owned by THIS partner shop.
  // Otherwise a shop owner could post jobs against any VIN in the platform
  // (IDOR). Admins bypass for support workflows.
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, body.vehicleId));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found." }); return; }
  if (req.userRole !== "admin" && vehicle.ownerShopId !== shop.id) {
    res.status(403).json({ error: "Vehicle is not registered to this partner location. Add it under Vehicles first." });
    return;
  }

  // Catalog: prefer serviceSlug for tier derivation. If missing, treat as a
  // free-text technician-tier repair job (sensible default for fleet ops).
  const policy = resolvePartnerJobPolicy({
    vehicle,
    serviceSlug: body.serviceSlug,
    jobType: body.jobType,
    description: body.description,
    urgency: body.urgency,
  });
  if ("error" in policy) {
    res.status(400).json({ error: policy.error });
    return;
  }
  const {
    catalogEntry,
    finalJobType,
    finalRequiredTier,
    derivedPrice,
    urgency,
    juniorVisibleAt,
    ghostGarage,
  } = policy;

  // Commission override: shop-level setting wins, otherwise flat 15%.
  // Defense-in-depth clamp: the DB CHECK on `shops.commission_override_pct`
  // also enforces 0..100, but we re-clamp here so a legacy row or future
  // schema change can never push a malformed value into jobs.
  const rawPct = shop.commissionOverridePct ?? 15;
  const commissionPctOverride = Math.max(0, Math.min(100, Math.round(rawPct)));

  // For partner-posted jobs the customer of record is the shop's owner — we
  // need a customerId on the row for the existing IDOR/auth surface to keep
  // working. Reviews, invoice access, etc. all flow through customerId.
  const [job] = await db.insert(jobsTable).values({
    vehicleId: body.vehicleId,
    vin: vehicle.vin,
    customerId: shop.ownerId,
    jobType: finalJobType,
    serviceSlug: catalogEntry?.slug ?? null,
    requiredTier: finalRequiredTier,
    description: body.description.trim(),
    locationLat: body.locationLat ?? shop.lat ?? null,
    locationLng: body.locationLng ?? shop.lng ?? null,
    locationAddress: body.locationAddress ?? `${shop.address}, ${shop.city}, ${shop.region} ${shop.zipCode}`,
    estimatedPrice: derivedPrice,
    status: "REQUESTED",
    requiresGhostGarage: ghostGarage,
    customerTransportApproved: !ghostGarage,
    postedByShopId: shop.id,
    partnerKindSnapshot: shop.partnerKind,
    urgency,
    commissionPctOverride,
    juniorVisibleAt,
    recurringGroupId: body.recurringGroupId ?? null,
  }).returning();

  // Fan-out push: notify all active mechanics. Tier+priority visibility is
  // enforced at read time in /jobs/available; we don't push to junior tiers
  // until the window opens (best-effort filter — they'll still see it via
  // polling once juniorVisibleAt passes).
  db.select({ pushToken: usersTable.pushToken, mechanicTier: usersTable.mechanicTier })
    .from(usersTable)
    .where(eq(usersTable.role, "mechanic"))
    .then((mechs) => {
      const seniorOrAbove = new Set(["senior", "advanced", "master"]);
      const tokens = mechs
        .filter((m) => m.pushToken && (urgency === "urgent" || seniorOrAbove.has(m.mechanicTier ?? "detailer")))
        .map((m) => m.pushToken!) as string[];
      if (tokens.length > 0) {
        notifyMechanics(tokens, finalJobType, body.description!, job.id).catch(() => {});
      }
    })
    .catch(() => {});

  res.status(201).json({ id: job.id, jobId: job.id, urgency, juniorVisibleAt, commissionPctOverride });
});

export default router;
