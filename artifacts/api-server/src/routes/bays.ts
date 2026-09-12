import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, baysTable, shopsTable, usersTable } from "@workspace/db";
import { CreateBayBody, UpdateBayBody } from "@workspace/api-zod";
import { authenticate, requireShopOwner, type AuthRequest } from "../middlewares/authenticate";
import { parsePositiveSafeInteger } from "../lib/validation";

const router: IRouter = Router();

const TIER_RANK: Record<string, number> = { detailer: 0, technician: 1, senior: 2, master: 3 };

function formatBay(b: typeof baysTable.$inferSelect) {
  return {
    id: b.id, shopId: b.shopId, name: b.name, hourlyRate: b.hourlyRate,
    equipment: (b.equipment as string[]) ?? [],
    allowedJobCategories: (b.allowedJobCategories as string[]) ?? [],
    minMechanicTier: b.minMechanicTier, autoApprove: b.autoApprove,
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
  const [bay] = await db.insert(baysTable).values({
    shopId, name: v.name, hourlyRate: v.hourlyRate,
    equipment: v.equipment ?? [],
    allowedJobCategories: v.allowedJobCategories,
    minMechanicTier: v.minMechanicTier,
    autoApprove: v.autoApprove ?? false,
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

// Active-mechanic-only bay search. Filters out bays the requesting mechanic
// couldn't book anyway (tier too low, wrong job category, inactive).
router.get("/bays/available", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "mechanic" || req.user?.status !== "active") {
    res.status(403).json({ error: "Active mechanics only" }); return;
  }
  const { jobCategory, minTier } = req.query as { jobCategory?: string; minTier?: string };

  // Look up the requesting mechanic's tier so we can filter out bays whose
  // minMechanicTier exceeds it. This is the SAME enforcement that runs at
  // booking time — keeping it here just hides un-bookable rows from the UI.
  const [me] = await db.select({ mechanicTier: usersTable.mechanicTier }).from(usersTable).where(eq(usersTable.id, req.userId!));
  const myTierRank = me?.mechanicTier ? TIER_RANK[me.mechanicTier] ?? 0 : 0;

  let rows = await db.select({ bay: baysTable, shop: shopsTable })
    .from(baysTable)
    .innerJoin(shopsTable, eq(baysTable.shopId, shopsTable.id))
    .where(and(eq(baysTable.status, "active"), eq(shopsTable.status, "active")));

  rows = rows.filter(({ bay }) => {
    const bayMinRank = TIER_RANK[bay.minMechanicTier] ?? 0;
    if (bayMinRank > myTierRank) return false;
    if (jobCategory) {
      const cats = (bay.allowedJobCategories as string[]) ?? [];
      if (!cats.includes(jobCategory)) return false;
    }
    if (minTier) {
      const wanted = TIER_RANK[minTier] ?? 0;
      if (bayMinRank > wanted) return false;
    }
    return true;
  });
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
  const updates: Partial<typeof baysTable.$inferInsert> = {};
  if (v.name !== undefined) updates.name = v.name;
  if (v.hourlyRate !== undefined) updates.hourlyRate = v.hourlyRate;
  if (v.equipment !== undefined) updates.equipment = v.equipment;
  if (v.allowedJobCategories !== undefined) updates.allowedJobCategories = v.allowedJobCategories;
  if (v.minMechanicTier !== undefined) updates.minMechanicTier = v.minMechanicTier;
  if (v.autoApprove !== undefined) updates.autoApprove = v.autoApprove;
  if (v.status !== undefined) updates.status = v.status;
  const [updated] = await db.update(baysTable).set(updates).where(eq(baysTable.id, bayId)).returning();
  // Suppress unused-import warning for sql in environments where it's stripped.
  void sql;
  res.json(formatBay(updated));
});

export default router;
