/**
 * VIN-Integrated Parts Matching API.
 *
 * Three audiences, all gated explicitly per route:
 *
 *   1. Mechanic+admin: VIN decode, parts recommendations, parts orders.
 *   2. Customer (of the job): customer-safe view (brand/warranty only).
 *   3. Admin: catalog CRUD + flagged orders queue.
 *
 * The mechanic surface NEVER exposes commission/margin/payout data; the
 * customer surface NEVER exposes supplier_key, sku, or internal cost.
 */

import { Router, type IRouter, type Response, type NextFunction } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  jobsTable, vehiclesTable,
  mechanicVehicleProfilesTable,
  partsCatalogTable, partsCatalogFitmentTable, partsOffersTable,
  partsOrdersTable,
  PARTS_ORDER_STATUS_VALUES,
  QUALITY_TIER_VALUES,
} from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";
import {
  decodeVin, normalizeVin, upsertProfileFromDecode,
} from "../lib/vinDecodeService";
import { searchCompatibleParts } from "../lib/partsCatalogEngine";
import {
  validateOrder, createOrder, transitionStatus, listForJob, customerView,
} from "../lib/partsOrderEngine";
import { APS_CURATED_KEY } from "../lib/suppliers/internal/apsCuratedAdapter";

const router: IRouter = Router();

/**
 * Single chokepoint for mechanic+admin parts surfaces. Mirrors the
 * pattern in mechanicWorkspace.ts so customer accounts (and pending
 * mechanics) get a clean 403 instead of leaking partial data.
 */
function requireMechanicOrAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const role = req.user?.role;
  if (role !== "admin" && role !== "mechanic") {
    res.status(403).json({ error: "Mechanic or admin only" });
    return;
  }
  if (role === "mechanic" && req.user?.status !== "active") {
    res.status(403).json({ error: "Your mechanic account is pending admin approval." });
    return;
  }
  next();
}

// ────────────────────────────────────────────────────────────────────────
// VIN decode (mechanic+admin)
// ────────────────────────────────────────────────────────────────────────
router.get("/vin/:vin/decode", authenticate, requireMechanicOrAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const vin = normalizeVin(String(req.params.vin));
    if (!vin) { res.status(400).json({ error: "Invalid VIN — must be 17 characters, no I/O/Q." }); return; }
    let decoded;
    try { decoded = await decodeVin(vin); }
    catch (e) {
      req.log?.warn({ err: e }, "NHTSA decode failed");
      res.status(502).json({ error: "VIN decode service unavailable. Try again." });
      return;
    }
    if (!decoded.pretty.make && !decoded.pretty.model) {
      res.status(422).json({ error: "VIN not recognized by NHTSA." }); return;
    }
    // Lazy-persist if we have a vehicle row for this VIN — keeps the
    // enriched profile fresh whenever decode is called. Best-effort.
    try {
      const [veh] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.vin, vin));
      if (veh) await upsertProfileFromDecode(veh.id, vin, req.userId ?? null, decoded);
    } catch { /* best-effort */ }
    res.json({ vin, decoded: decoded.pretty });
  });

// ────────────────────────────────────────────────────────────────────────
// Recommended parts for a job (mechanic+admin)
// ────────────────────────────────────────────────────────────────────────
router.get("/jobs/:jobId/parts/recommended", authenticate, requireMechanicOrAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const jobId = parseInt(String(req.params.jobId), 10);
    if (!Number.isFinite(jobId)) { res.status(400).json({ error: "Invalid jobId" }); return; }
    const category = String(req.query.category ?? "").trim();
    if (!category) { res.status(400).json({ error: "category query param required" }); return; }

    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    // Mechanic must be assigned to this job (or admin).
    if (req.user?.role !== "admin" && job.mechanicId !== req.userId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const [profile] = await db.select().from(mechanicVehicleProfilesTable)
      .where(eq(mechanicVehicleProfilesTable.vehicleId, job.vehicleId));
    const recs = await searchCompatibleParts(profile ?? null, category, 25);
    res.json({
      vehicle: profile
        ? { vin: profile.vin, year: profile.modelYear, make: profile.make, model: profile.model, trim: profile.trim, engine: profile.engine, drivetrain: profile.drivetrain }
        : { vin: job.vin, year: null, make: null, model: null, trim: null, engine: null, drivetrain: null },
      recommendations: recs.map((r) => ({
        catalogId: r.catalog.id,
        category: r.catalog.category,
        brand: r.catalog.brand,
        oemPartNumber: r.catalog.oemPartNumber,
        name: r.catalog.name,
        qualityTier: r.catalog.qualityTier,
        warrantyMonths: r.catalog.warrantyMonths,
        msrpCents: r.catalog.msrpCents,
        confidence: r.confidence,
        reasons: r.reasons,
        offers: r.offers.map((o) => ({
          supplierKey: o.supplierKey,
          sku: o.sku,
          priceCents: o.priceCents,
          currency: o.currency,
          inStock: o.inStock,
          etaDays: o.etaDays,
        })),
      })),
    });
  });

// ────────────────────────────────────────────────────────────────────────
// Place a parts order (mechanic)
// ────────────────────────────────────────────────────────────────────────
const orderBody = z.object({
  catalogId: z.number().int().positive(),
  supplierKey: z.string().min(1),
  sku: z.string().min(1),
  qty: z.number().int().min(1).max(99),
  unitPriceCents: z.number().int().min(0),
});
router.post("/jobs/:jobId/parts/order", authenticate, requireMechanicOrAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const jobId = parseInt(String(req.params.jobId), 10);
    if (!Number.isFinite(jobId)) { res.status(400).json({ error: "Invalid jobId" }); return; }
    const parsed = orderBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.format() }); return; }

    // Admins can place on behalf of the assigned mechanic; otherwise
    // the requester IS the mechanic on the job.
    let mechanicId: number;
    if (req.user?.role === "admin") {
      const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
      if (!job?.mechanicId) { res.status(409).json({ error: "Job has no assigned mechanic." }); return; }
      mechanicId = job.mechanicId;
    } else {
      mechanicId = req.userId!;
    }

    const result = await createOrder({ jobId, mechanicId, ...parsed.data });
    if (!result.ok) { res.status(result.status).json({ error: result.error, reasons: result.reasons }); return; }
    res.status(201).json({ order: result.order });
  });

// ────────────────────────────────────────────────────────────────────────
// PATCH /parts/orders/:id  — mechanic owner OR admin (status transitions)
// ────────────────────────────────────────────────────────────────────────
const patchBody = z.object({
  status: z.enum(PARTS_ORDER_STATUS_VALUES).optional(),
  supplierInvoiceUrl: z.string().url().optional(),
  supplierOrderRef: z.string().min(1).optional(),
});
router.patch("/parts/orders/:id", authenticate, requireMechanicOrAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
    const isAdmin = req.user?.role === "admin";

    if (parsed.data.status) {
      const result = await transitionStatus(id, req.userId ?? null, isAdmin, parsed.data.status, {
        supplierInvoiceUrl: parsed.data.supplierInvoiceUrl,
        supplierOrderRef: parsed.data.supplierOrderRef,
      });
      if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
      res.json({ order: result.order });
      return;
    }

    // No status change — just attaching invoice/ref.
    const [order] = await db.select().from(partsOrdersTable).where(eq(partsOrdersTable.id, id));
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    if (!isAdmin && order.mechanicId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
    const updates: Record<string, unknown> = {};
    if (parsed.data.supplierInvoiceUrl) updates.supplierInvoiceUrl = parsed.data.supplierInvoiceUrl;
    if (parsed.data.supplierOrderRef)   updates.supplierOrderRef   = parsed.data.supplierOrderRef;
    if (Object.keys(updates).length === 0) { res.json({ order }); return; }
    const [updated] = await db.update(partsOrdersTable).set(updates)
      .where(eq(partsOrdersTable.id, id)).returning();
    res.json({ order: updated });
  });

// ────────────────────────────────────────────────────────────────────────
// List parts on a job (mechanic+admin)
// ────────────────────────────────────────────────────────────────────────
router.get("/jobs/:jobId/parts", authenticate, requireMechanicOrAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const jobId = parseInt(String(req.params.jobId), 10);
    if (!Number.isFinite(jobId)) { res.status(400).json({ error: "Invalid jobId" }); return; }
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    if (req.user?.role !== "admin" && job.mechanicId !== req.userId) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const rows = await listForJob(jobId);
    res.json({ orders: rows });
  });

// ────────────────────────────────────────────────────────────────────────
// Customer-safe parts view (brand/warranty/qty/msrp only)
// ────────────────────────────────────────────────────────────────────────
router.get("/jobs/:jobId/parts/customer-view", authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const jobId = parseInt(String(req.params.jobId), 10);
    if (!Number.isFinite(jobId)) { res.status(400).json({ error: "Invalid jobId" }); return; }
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    const isOwner = job.customerId === req.userId;
    const isMechanic = job.mechanicId === req.userId;
    if (!(req.user?.role === "admin" || isOwner || isMechanic)) {
      res.status(403).json({ error: "Forbidden" }); return;
    }
    const parts = await customerView(jobId);
    res.json({ parts });
  });

// ────────────────────────────────────────────────────────────────────────
// Admin: parts catalog CRUD + flagged orders queue
// ────────────────────────────────────────────────────────────────────────
router.get("/admin/parts-catalog", authenticate, requireRole("admin"),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    const rows = await db.select().from(partsCatalogTable)
      .orderBy(desc(partsCatalogTable.createdAt));
    res.json({ catalog: rows });
  });

const catalogEntryBody = z.object({
  category: z.string().min(1),
  brand: z.string().min(1),
  oemPartNumber: z.string().min(1),
  name: z.string().min(1),
  qualityTier: z.enum(QUALITY_TIER_VALUES).default("standard"),
  warrantyMonths: z.number().int().min(0).default(12),
  msrpCents: z.number().int().min(0).default(0),
  crossRefs: z.array(z.string()).default([]),
  notes: z.string().optional(),
  fitments: z.array(z.object({
    yearMin: z.number().int().nullable().optional(),
    yearMax: z.number().int().nullable().optional(),
    make: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    enginePattern: z.string().nullable().optional(),
    transmissionPattern: z.string().nullable().optional(),
    drivetrainPattern: z.string().nullable().optional(),
    trimPattern: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })).default([]),
  offers: z.array(z.object({
    supplierKey: z.string().default(APS_CURATED_KEY),
    sku: z.string().min(1),
    priceCents: z.number().int().min(0),
    currency: z.string().default("USD"),
    inStock: z.boolean().default(true),
    etaDays: z.number().int().min(0).default(2),
  })).default([]),
});

async function insertCatalogEntry(input: z.infer<typeof catalogEntryBody>): Promise<number> {
  return await db.transaction(async (tx) => {
    const [c] = await tx.insert(partsCatalogTable).values({
      category: input.category,
      brand: input.brand,
      oemPartNumber: input.oemPartNumber,
      name: input.name,
      qualityTier: input.qualityTier,
      warrantyMonths: input.warrantyMonths,
      msrpCents: input.msrpCents,
      crossRefs: input.crossRefs,
      notes: input.notes ?? null,
    }).onConflictDoUpdate({
      target: [partsCatalogTable.brand, partsCatalogTable.oemPartNumber],
      set: { name: input.name, qualityTier: input.qualityTier, warrantyMonths: input.warrantyMonths, msrpCents: input.msrpCents, crossRefs: input.crossRefs, notes: input.notes ?? null, active: true },
    }).returning();
    if (input.fitments.length > 0) {
      await tx.insert(partsCatalogFitmentTable).values(
        input.fitments.map((f) => ({
          catalogId: c!.id,
          yearMin: f.yearMin ?? null, yearMax: f.yearMax ?? null,
          make: f.make ?? null, model: f.model ?? null,
          enginePattern: f.enginePattern ?? null,
          transmissionPattern: f.transmissionPattern ?? null,
          drivetrainPattern: f.drivetrainPattern ?? null,
          trimPattern: f.trimPattern ?? null,
          notes: f.notes ?? null,
        })),
      );
    }
    if (input.offers.length > 0) {
      for (const o of input.offers) {
        await tx.insert(partsOffersTable).values({
          catalogId: c!.id,
          supplierKey: o.supplierKey, sku: o.sku,
          priceCents: o.priceCents, currency: o.currency,
          inStock: o.inStock, etaDays: o.etaDays,
        }).onConflictDoUpdate({
          target: [partsOffersTable.supplierKey, partsOffersTable.sku],
          set: { catalogId: c!.id, priceCents: o.priceCents, currency: o.currency, inStock: o.inStock, etaDays: o.etaDays, lastSeenAt: new Date() },
        });
      }
    }
    return c!.id;
  });
}

router.post("/admin/parts-catalog", authenticate, requireRole("admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = catalogEntryBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.format() }); return; }
    const id = await insertCatalogEntry(parsed.data);
    res.status(201).json({ id });
  });

router.post("/admin/parts-catalog/bulk-seed", authenticate, requireRole("admin"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const parsed = z.object({ entries: z.array(catalogEntryBody) }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }
    const ids: number[] = [];
    for (const entry of parsed.data.entries) ids.push(await insertCatalogEntry(entry));
    res.status(201).json({ ids, count: ids.length });
  });

router.get("/admin/parts-orders/flagged", authenticate, requireRole("admin"),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    const rows = await db.select().from(partsOrdersTable)
      .where(and(ne(partsOrdersTable.validationState, "passed")))
      .orderBy(desc(partsOrdersTable.createdAt));
    res.json({ orders: rows });
  });

export default router;
