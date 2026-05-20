import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, shopsTable, baysTable } from "@workspace/db";
import { CreateShopBody, UpdateShopBody } from "@workspace/api-zod";
import { authenticate, requireShopOwner, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

function formatShop(s: typeof shopsTable.$inferSelect) {
  return {
    id: s.id, ownerId: s.ownerId,
    partnerKind: s.partnerKind,
    name: s.name,
    address: s.address, city: s.city, region: s.region, zipCode: s.zipCode,
    lat: s.lat ?? null, lng: s.lng ?? null, phone: s.phone ?? null,
    federalEin: s.federalEin ?? null,
    businessLicense: s.businessLicense ?? null,
    // DEPRECATED — kept in the response shape only for any client that
    // still reads them. New UI no longer surfaces these.
    insuranceCarrier: s.insuranceCarrier ?? null,
    insurancePolicyNumber: s.insurancePolicyNumber ?? null,
    commissionOverridePct: s.commissionOverridePct ?? null,
    status: s.status, createdAt: s.createdAt,
  };
}

function formatBay(b: typeof baysTable.$inferSelect) {
  return {
    id: b.id, shopId: b.shopId, name: b.name, hourlyRate: b.hourlyRate,
    equipment: (b.equipment as string[]) ?? [],
    allowedJobCategories: (b.allowedJobCategories as string[]) ?? [],
    minMechanicTier: b.minMechanicTier, autoApprove: b.autoApprove,
    status: b.status, createdAt: b.createdAt,
  };
}

router.post("/shops", authenticate, requireShopOwner, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateShopBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const v = parsed.data;
  // Reject malformed override pct loudly so partner UI surfaces a 400 instead
  // of silently clamping/rounding (which would hide misconfigured GSA contracts).
  // Integer-only: a fractional commission would be a contract misconfiguration.
  if (v.commissionOverridePct != null && (
    !Number.isInteger(v.commissionOverridePct) ||
    v.commissionOverridePct < 0 || v.commissionOverridePct > 100
  )) {
    res.status(400).json({ error: "commissionOverridePct must be an integer 0..100" }); return;
  }
  const [shop] = await db.insert(shopsTable).values({
    ownerId: req.userId!,
    partnerKind: v.partnerKind ?? "independent_shop",
    name: v.name, address: v.address, city: v.city, region: v.region, zipCode: v.zipCode,
    lat: v.lat ?? null, lng: v.lng ?? null, phone: v.phone ?? null,
    federalEin: v.federalEin ?? null,
    businessLicense: v.businessLicense ?? null,
    insuranceCarrier: v.insuranceCarrier ?? null,
    insurancePolicyNumber: v.insurancePolicyNumber ?? null,
    commissionOverridePct: v.commissionOverridePct ?? null,
  }).returning();
  res.status(201).json(formatShop(shop));
});

router.get("/shops/mine", authenticate, requireShopOwner, async (req: AuthRequest, res): Promise<void> => {
  const rows = await db.select().from(shopsTable).where(eq(shopsTable.ownerId, req.userId!));
  res.json(rows.map(formatShop));
});

router.get("/shops/:shopId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const shopId = parseInt(String(req.params.shopId), 10);
  if (isNaN(shopId)) { res.status(400).json({ error: "Invalid shop ID" }); return; }
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, shopId));
  if (!shop) { res.status(404).json({ error: "Shop not found" }); return; }
  // Shop + bay configuration is sensitive (rate cards, equipment lists,
  // tier policy). Restrict viewing to admin, the owning shop_owner, and
  // ACTIVE mechanics (the only ones who can actually book a bay). Customers
  // never need to see a shop directly — they interact with their job's
  // mechanic, who handles bay selection.
  const isOwner = req.userRole === "shop_owner" && shop.ownerId === req.userId;
  const isActiveMechanic = req.userRole === "mechanic" && req.user?.status === "active";
  if (!(req.userRole === "admin" || isOwner || isActiveMechanic)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const bays = await db.select().from(baysTable).where(eq(baysTable.shopId, shopId));
  res.json({ ...formatShop(shop), bays: bays.map(formatBay) });
});

router.patch("/shops/:shopId", authenticate, requireShopOwner, async (req: AuthRequest, res): Promise<void> => {
  const shopId = parseInt(String(req.params.shopId), 10);
  if (isNaN(shopId)) { res.status(400).json({ error: "Invalid shop ID" }); return; }
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, shopId));
  if (!shop) { res.status(404).json({ error: "Shop not found" }); return; }
  // IDOR guard: only the owning shop_owner can mutate.
  if (shop.ownerId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = UpdateShopBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const v = parsed.data;
  const updates: Partial<typeof shopsTable.$inferInsert> = {};
  if (v.name !== undefined) updates.name = v.name;
  if (v.address !== undefined) updates.address = v.address;
  if (v.city !== undefined) updates.city = v.city;
  if (v.region !== undefined) updates.region = v.region;
  if (v.zipCode !== undefined) updates.zipCode = v.zipCode;
  if (v.lat !== undefined) updates.lat = v.lat;
  if (v.lng !== undefined) updates.lng = v.lng;
  if (v.phone !== undefined) updates.phone = v.phone;
  if (v.federalEin !== undefined) updates.federalEin = v.federalEin;
  if (v.businessLicense !== undefined) updates.businessLicense = v.businessLicense;
  if (v.insuranceCarrier !== undefined) updates.insuranceCarrier = v.insuranceCarrier;
  if (v.insurancePolicyNumber !== undefined) updates.insurancePolicyNumber = v.insurancePolicyNumber;
  if (v.commissionOverridePct !== undefined) {
    // null clears the override → revert to system default. Otherwise integer 0..100.
    if (v.commissionOverridePct !== null && (
      !Number.isInteger(v.commissionOverridePct) ||
      v.commissionOverridePct < 0 || v.commissionOverridePct > 100
    )) {
      res.status(400).json({ error: "commissionOverridePct must be an integer 0..100 or null" }); return;
    }
    updates.commissionOverridePct = v.commissionOverridePct;
  }
  if (v.status !== undefined) updates.status = v.status;
  const [updated] = await db.update(shopsTable).set(updates).where(eq(shopsTable.id, shopId)).returning();
  res.json(formatShop(updated));
});

export default router;
