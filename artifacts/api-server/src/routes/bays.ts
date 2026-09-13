import { Router, type IRouter } from "express";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db, baysTable, bayBookingsTable, jobsTable, shopsTable, usersTable } from "@workspace/db";
import { CreateBayBody, UpdateBayBody } from "@workspace/api-zod";
import { authenticate, requireShopOwner, type AuthRequest } from "../middlewares/authenticate";
import { parsePositiveSafeInteger } from "../lib/validation";
import { formatBayAvailabilityConfig, isBayIntervalAvailable, normalizeBayAvailabilityConfig } from "../lib/bayAvailability";

const router: IRouter = Router();

const TIER_RANK: Record<string, number> = { detailer: 0, technician: 1, senior: 2, advanced: 3, master: 4 };

function formatBay(b: typeof baysTable.$inferSelect) {
  return {
    id: b.id, shopId: b.shopId, name: b.name, hourlyRate: b.hourlyRate,
    equipment: (b.equipment as string[]) ?? [],
    allowedJobCategories: (b.allowedJobCategories as string[]) ?? [],
    minMechanicTier: b.minMechanicTier, autoApprove: b.autoApprove,
    availabilityConfig: formatBayAvailabilityConfig(b.availabilityConfig),
    status: b.status, createdAt: b.createdAt,
  };
}
function formatShop(s: typeof shopsTable.$inferSelect) {
  return {
    id: s.id, ownerId: s.ownerId, name: s.name,
    organizationId: s.organizationId ?? null,
    address: s.address, city: s.city, region: s.region, zipCode: s.zipCode,
    lat: s.lat ?? null, lng: s.lng ?? null, phone: s.phone ?? null,
    insuranceCarrier: s.insuranceCarrier ?? null,
    insurancePolicyNumber: s.insurancePolicyNumber ?? null,
    status: s.status, createdAt: s.createdAt,
  };
}

router.post("/shops/:shopId/bays", authenticate, requireShopOwner, async (req: AuthRequest, res): Promise<void> => {
  const shopId = parsePositiveSafeInteger(req.params.shopId);
  if (shopId === null) { res.status(400).json({ error: "Invalid shop ID" }); return; }
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, shopId));
  if (!shop) { res.status(404).json({ error: "Shop not found" }); return; }
  if (shop.ownerId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = CreateBayBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const v = parsed.data;
  const availability = normalizeBayAvailabilityConfig(req.body?.availabilityConfig);
  if (availability.error) { res.status(400).json({ error: availability.error }); return; }
  const [bay] = await db.insert(baysTable).values({
    shopId, name: v.name, hourlyRate: v.hourlyRate,
    equipment: v.equipment ?? [],
    allowedJobCategories: v.allowedJobCategories,
    minMechanicTier: v.minMechanicTier,
    autoApprove: v.autoApprove ?? false,
    availabilityConfig: availability.config,
  }).returning();
  res.status(201).json(formatBay(bay));
});

router.get("/shops/:shopId/bays", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const shopId = parsePositiveSafeInteger(req.params.shopId);
  if (shopId === null) { res.status(400).json({ error: "Invalid shop ID" }); return; }
  // Same access policy as GET /shops/:shopId — bay configs aren't public.
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, shopId));
  if (!shop) { res.status(404).json({ error: "Shop not found" }); return; }
  const isOwner = req.userRole === "shop_owner" && shop.ownerId === req.userId;
  const isActiveMechanic = req.userRole === "mechanic" && req.user?.status === "active";
  if (!(req.userRole === "admin" || isOwner || isActiveMechanic)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const rows = await db.select().from(baysTable).where(eq(baysTable.shopId, shopId));
  res.json(rows.map(formatBay));
});

// Mechanic/admin bay search. Filters out bays the requesting mechanic couldn't
// book anyway (tier too low, wrong job category, inactive).
router.get("/bays/available", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const isMechanic = req.userRole === "mechanic";
  const isAdmin = req.userRole === "admin";
  if ((!isMechanic || req.user?.status !== "active") && !isAdmin) {
    res.status(403).json({ error: "Active mechanics or admins only" }); return;
  }
  const {
    jobCategory,
    minTier,
    jobId: rawJobId,
    startsAt: rawStartsAt,
    durationHours: rawDurationHours,
    startTime: rawLegacyStartTime,
    estimatedHours: rawLegacyEstimatedHours,
  } = req.query as {
    jobCategory?: string;
    minTier?: string;
    jobId?: string;
    startsAt?: string;
    durationHours?: string;
    startTime?: string;
    estimatedHours?: string;
  };
  const requestedStartsAt = rawStartsAt ?? rawLegacyStartTime;
  const requestedDurationHours = rawDurationHours ?? rawLegacyEstimatedHours;
  const validCategories = ["repair", "diagnostic", "maintenance", "detailing"];
  const validTiers = ["detailer", "technician", "senior", "advanced", "master"];
  if (jobCategory !== undefined && !validCategories.includes(jobCategory)) {
    res.status(400).json({ error: "Invalid jobCategory" }); return;
  }
  if (minTier !== undefined && !validTiers.includes(minTier)) {
    res.status(400).json({ error: "Invalid minTier" }); return;
  }
  const jobId = rawJobId === undefined ? null : parsePositiveSafeInteger(rawJobId);
  if (rawJobId !== undefined && jobId === null) {
    res.status(400).json({ error: "Invalid job ID" }); return;
  }
  if ((requestedStartsAt === undefined) !== (requestedDurationHours === undefined)) {
    res.status(400).json({ error: "startsAt and durationHours must be supplied together" }); return;
  }
  let startsAt: Date | null = null;
  let endsAt: Date | null = null;
  if (requestedStartsAt !== undefined && requestedDurationHours !== undefined) {
    startsAt = new Date(requestedStartsAt);
    const durationHours = Number(requestedDurationHours);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 24) {
      res.status(400).json({ error: "startsAt must be a valid timestamp and durationHours must be between 0 and 24" }); return;
    }
    endsAt = new Date(startsAt.getTime() + durationHours * 3_600_000);
    if (!Number.isFinite(endsAt.getTime())) {
      res.status(400).json({ error: "The requested interval is invalid" }); return;
    }
  }

  // A mechanic may use a job filter only for their own currently assigned
  // work. Admins can use it for support/discovery without impersonating one.
  let requestedJobCategory = jobCategory;
  if (jobId !== null) {
    const [job] = await db.select({
      mechanicId: jobsTable.mechanicId,
      jobType: jobsTable.jobType,
      status: jobsTable.status,
    }).from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    if (isMechanic && job.mechanicId !== req.userId) {
      res.status(403).json({ error: "You are not assigned to this job" }); return;
    }
    if (!["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(job.status)) {
      res.status(400).json({ error: `Cannot search bays for a job in status ${job.status}` }); return;
    }
    if (requestedJobCategory !== undefined && requestedJobCategory !== job.jobType) {
      res.status(400).json({ error: "jobCategory does not match the selected job" }); return;
    }
    requestedJobCategory = job.jobType;
  }

  // Look up the requesting mechanic's tier so we can filter out bays whose
  // minMechanicTier exceeds it. This is the SAME enforcement that runs at
  // booking time — keeping it here just hides un-bookable rows from the UI.
  const [me] = isMechanic
    ? await db.select({ mechanicTier: usersTable.mechanicTier }).from(usersTable).where(eq(usersTable.id, req.userId!))
    : [];
  const myTierRank = isAdmin ? Number.POSITIVE_INFINITY : (me?.mechanicTier ? TIER_RANK[me.mechanicTier] ?? 0 : 0);

  let rows = await db.select({ bay: baysTable, shop: shopsTable })
    .from(baysTable)
    .innerJoin(shopsTable, eq(baysTable.shopId, shopsTable.id))
    .where(and(eq(baysTable.status, "active"), eq(shopsTable.status, "active")));

  rows = rows.filter(({ bay }) => {
    const bayMinRank = TIER_RANK[bay.minMechanicTier] ?? 0;
    if (bayMinRank > myTierRank) return false;
    if (requestedJobCategory) {
      const cats = (bay.allowedJobCategories as string[]) ?? [];
      if (!cats.includes(requestedJobCategory)) return false;
    }
    if (minTier) {
      const wanted = TIER_RANK[minTier] ?? 0;
      if (bayMinRank > wanted) return false;
    }
    if (startsAt && endsAt && !isBayIntervalAvailable(bay.availabilityConfig, startsAt, endsAt)) return false;
    return true;
  });
  if (startsAt && endsAt) {
    const bayIds = rows.map(({ bay }) => bay.id);
    if (bayIds.length > 0) {
      const conflicts = await db.select({ bayId: bayBookingsTable.bayId })
        .from(bayBookingsTable)
        .where(and(
          inArray(bayBookingsTable.bayId, bayIds),
          inArray(bayBookingsTable.status, ["reserved", "active"]),
          sql`${bayBookingsTable.startTime} < ${endsAt}`,
          sql`${bayBookingsTable.estimatedEndTime} > ${startsAt}`,
        ));
      const occupied = new Set(conflicts.map((row) => row.bayId));
      rows = rows.filter(({ bay }) => !occupied.has(bay.id));
    }
  }
  res.json(rows.map(({ bay, shop }) => ({ ...formatBay(bay), shop: formatShop(shop) })));
});

router.get("/bays/:bayId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const bayId = parsePositiveSafeInteger(req.params.bayId);
  if (bayId === null) { res.status(400).json({ error: "Invalid bay ID" }); return; }
  const [row] = await db.select({ bay: baysTable, shop: shopsTable })
    .from(baysTable).innerJoin(shopsTable, eq(baysTable.shopId, shopsTable.id))
    .where(eq(baysTable.id, bayId));
  if (!row) { res.status(404).json({ error: "Bay not found" }); return; }
  // Same access policy: admin, owning shop_owner, or active mechanic.
  const isOwner = req.userRole === "shop_owner" && row.shop.ownerId === req.userId;
  const isActiveMechanic = req.userRole === "mechanic" && req.user?.status === "active";
  if (!(req.userRole === "admin" || isOwner || isActiveMechanic)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json({ ...formatBay(row.bay), shop: formatShop(row.shop) });
});

router.patch("/bays/:bayId", authenticate, requireShopOwner, async (req: AuthRequest, res): Promise<void> => {
  const bayId = parsePositiveSafeInteger(req.params.bayId);
  if (bayId === null) { res.status(400).json({ error: "Invalid bay ID" }); return; }
  const [bay] = await db.select().from(baysTable).where(eq(baysTable.id, bayId));
  if (!bay) { res.status(404).json({ error: "Bay not found" }); return; }
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, bay.shopId));
  if (shop?.ownerId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = UpdateBayBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const v = parsed.data;
  const availability = req.body?.availabilityConfig === undefined
    ? null
    : normalizeBayAvailabilityConfig(req.body.availabilityConfig);
  if (availability && availability.error) { res.status(400).json({ error: availability.error }); return; }
  const updates: Partial<typeof baysTable.$inferInsert> = {};
  if (v.name !== undefined) updates.name = v.name;
  if (v.hourlyRate !== undefined) updates.hourlyRate = v.hourlyRate;
  if (v.equipment !== undefined) updates.equipment = v.equipment;
  if (v.allowedJobCategories !== undefined) updates.allowedJobCategories = v.allowedJobCategories;
  if (v.minMechanicTier !== undefined) updates.minMechanicTier = v.minMechanicTier;
  if (v.autoApprove !== undefined) updates.autoApprove = v.autoApprove;
  if (availability) updates.availabilityConfig = availability.config;
  if (v.status !== undefined) updates.status = v.status;
  const [updated] = await db.update(baysTable).set(updates).where(eq(baysTable.id, bayId)).returning();
  res.json(formatBay(updated));
});

export default router;
