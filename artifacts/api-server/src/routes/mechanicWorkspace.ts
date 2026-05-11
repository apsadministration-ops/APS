/**
 * Mechanic-only Vehicle Intelligence Workspace API.
 *
 * EVERY route in this file is gated by `requireMechanicOrAdmin` so customer
 * accounts can never read or write workspace data. This is the chokepoint
 * that enforces "customers do NOT see mechanic notes / installed-part
 * verification / compatibility data / override logs".
 *
 * Endpoints:
 *   POST   /mechanic/vin/decode           { vin } → NHTSA proxy + cache
 *   GET    /mechanic/workspace/by-vin/:vin → full workspace bundle (creates a
 *                                            vehicle row + profile if missing)
 *   GET    /mechanic/workspace/:vehicleId → same bundle, indexed by vehicle id
 *
 *   GET    /mechanic/vehicles/:vehicleId/installed-parts
 *   POST   /mechanic/vehicles/:vehicleId/installed-parts
 *   PATCH  /mechanic/installed-parts/:id     (mark removed / update notes)
 *
 *   GET    /mechanic/vehicles/:vehicleId/notes
 *   POST   /mechanic/vehicles/:vehicleId/notes
 *   PATCH  /mechanic/notes/:id               (resolve)
 *
 *   GET    /mechanic/vehicles/:vehicleId/recommendations
 *   POST   /mechanic/vehicles/:vehicleId/recommendations
 *   PATCH  /mechanic/recommendations/:id     (status change)
 *
 *   GET    /mechanic/vehicles/:vehicleId/compatibility?category=oil_filter
 *   GET    /mechanic/parts/categories        (catalog of categories + meta)
 *
 *   GET    /mechanic/vehicles/:vehicleId/diagram-lookup?component=tires|...
 */

import { Router, type IRouter, type Response, type NextFunction } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  vehiclesTable,
  workLogsTable,
  mechanicVehicleProfilesTable,
  installedPartsTable,
  mechanicVehicleNotesTable,
  vehicleRecommendationsTable,
} from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import {
  PARTS_CATEGORIES, computeCompatibility,
} from "../lib/partsCompatibilityEngine";

const router: IRouter = Router();

// ────────────────────────────────────────────────────────────────────────
// Single chokepoint. Mechanic must be active OR caller must be admin.
// Customers (and pending mechanics) get a 403 with a clear reason.
// ────────────────────────────────────────────────────────────────────────
function requireMechanicOrAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  const role = req.user?.role;
  if (role === "admin") { next(); return; }
  if (role !== "mechanic") {
    res.status(403).json({ error: "Mechanics or admins only." });
    return;
  }
  if (req.user?.status !== "active") {
    res.status(403).json({ error: "Your mechanic account is pending admin approval." });
    return;
  }
  next();
}

router.use("/mechanic", authenticate, requireMechanicOrAdmin);

// ────────────────────────────────────────────────────────────────────────
// VIN validation. 17-char ISO 3779 spec, no I/O/Q. Reject anything else.
// ────────────────────────────────────────────────────────────────────────
function normalizeVin(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  if (v.length !== 17) return null;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return null;
  return v;
}

interface NhtsaResultRow { Variable: string; Value: string | null; ValueId?: string | null }

async function decodeFromNhtsa(vin: string): Promise<{ raw: Record<string, string | null>; pretty: ReturnType<typeof flatten> }> {
  // Use the values endpoint which returns one flat object — easiest to cache.
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NHTSA ${res.status}`);
  const json = (await res.json()) as { Results?: Array<Record<string, string | null>> };
  const row = json.Results?.[0] ?? {};
  return { raw: row, pretty: flatten(row) };
}

function flatten(row: Record<string, string | null>): {
  year: number | null; make: string | null; model: string | null; trim: string | null;
  engine: string | null; transmission: string | null; drivetrain: string | null;
  fuelType: string | null; bodyClass: string | null;
} {
  const yearStr = row["ModelYear"] ?? "";
  const year = yearStr && /^\d{4}$/.test(yearStr) ? Number(yearStr) : null;
  const cyl = row["EngineCylinders"];
  const disp = row["DisplacementL"];
  const engine = [disp ? `${disp}L` : null, cyl ? `${cyl}cyl` : null, row["FuelTypePrimary"]]
    .filter(Boolean).join(" ") || null;
  return {
    year,
    make: row["Make"] || null,
    model: row["Model"] || null,
    trim: row["Trim"] || null,
    engine,
    transmission: row["TransmissionStyle"] || null,
    drivetrain: row["DriveType"] || null,
    fuelType: row["FuelTypePrimary"] || null,
    bodyClass: row["BodyClass"] || null,
  };
}

// ────────────────────────────────────────────────────────────────────────
// POST /mechanic/vin/decode
// Decode + cache. If a vehicle row already exists for this VIN, refresh the
// mechanic profile with the latest decode. If not, the caller can choose to
// promote into a real vehicle row via /mechanic/workspace/by-vin/:vin (which
// upserts).
// ────────────────────────────────────────────────────────────────────────
router.post("/mechanic/vin/decode", async (req: AuthRequest, res: Response): Promise<void> => {
  const body = z.object({ vin: z.string() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "vin required" }); return; }
  const vin = normalizeVin(body.data.vin);
  if (!vin) { res.status(400).json({ error: "Invalid VIN — must be 17 characters, no I/O/Q." }); return; }

  let decoded;
  try { decoded = await decodeFromNhtsa(vin); }
  catch (e) {
    req.log?.warn({ err: e }, "NHTSA decode failed");
    res.status(502).json({ error: "VIN decode service unavailable. Try again." });
    return;
  }

  // If decode came back with no make/model the VIN is invalid in NHTSA's eyes.
  if (!decoded.pretty.make && !decoded.pretty.model) {
    res.status(422).json({ error: "VIN not recognized by NHTSA. Double-check the characters." });
    return;
  }

  res.json({ vin, decoded: decoded.pretty, raw: decoded.raw });
});

// ────────────────────────────────────────────────────────────────────────
// GET /mechanic/workspace/by-vin/:vin
// The "open vehicle workspace" entry point. Idempotent — if no vehicle row
// exists for this VIN, we create one from the NHTSA decode so the mechanic
// can immediately start logging notes / installed parts. Customer linkage
// (ownership) stays unchanged — adding a new vehicle row here does NOT
// assign a customer; it just creates the persistent intelligence shell.
// ────────────────────────────────────────────────────────────────────────
async function loadOrCreateVehicleByVin(vin: string, mechanicId: number): Promise<{ vehicleId: number; created: boolean }> {
  const [existing] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.vin, vin));
  if (existing) return { vehicleId: existing.id, created: false };

  // Decode to seed make/model/year. If decode fails, abort — we don't want
  // a row with empty make/model (vehicles.make/model are NOT NULL).
  const decoded = await decodeFromNhtsa(vin);
  if (!decoded.pretty.make || !decoded.pretty.model || !decoded.pretty.year) {
    throw new Error("VIN_NOT_DECODABLE");
  }
  const [created] = await db.insert(vehiclesTable).values({
    vin,
    make: decoded.pretty.make,
    model: decoded.pretty.model,
    year: decoded.pretty.year,
    trim: decoded.pretty.trim ?? null,
    color: null,
    mileage: 0,
  }).returning();
  await db.insert(mechanicVehicleProfilesTable).values({
    vehicleId: created.id,
    vin,
    decodedVin: decoded.raw,
    decodedAt: new Date(),
    engine: decoded.pretty.engine,
    transmission: decoded.pretty.transmission,
    drivetrain: decoded.pretty.drivetrain,
    fuelType: decoded.pretty.fuelType,
    bodyClass: decoded.pretty.bodyClass,
    lastMechanicId: mechanicId,
    lastOpenedAt: new Date(),
  });
  return { vehicleId: created.id, created: true };
}

async function workspaceBundle(vehicleId: number, mechanicId: number) {
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) return null;

  // Ensure profile row exists; if not, create on-the-fly + decode.
  let [profile] = await db.select().from(mechanicVehicleProfilesTable)
    .where(eq(mechanicVehicleProfilesTable.vehicleId, vehicleId));
  if (!profile) {
    try {
      const decoded = await decodeFromNhtsa(vehicle.vin);
      [profile] = await db.insert(mechanicVehicleProfilesTable).values({
        vehicleId, vin: vehicle.vin,
        decodedVin: decoded.raw, decodedAt: new Date(),
        engine: decoded.pretty.engine, transmission: decoded.pretty.transmission,
        drivetrain: decoded.pretty.drivetrain, fuelType: decoded.pretty.fuelType,
        bodyClass: decoded.pretty.bodyClass,
        lastMechanicId: mechanicId, lastOpenedAt: new Date(),
      }).returning();
    } catch {
      // Decode failed — store an empty profile so the workspace still loads.
      [profile] = await db.insert(mechanicVehicleProfilesTable).values({
        vehicleId, vin: vehicle.vin, lastMechanicId: mechanicId, lastOpenedAt: new Date(),
      }).returning();
    }
  } else {
    await db.update(mechanicVehicleProfilesTable)
      .set({ lastMechanicId: mechanicId, lastOpenedAt: new Date() })
      .where(eq(mechanicVehicleProfilesTable.id, profile.id));
  }

  const [
    serviceHistory, installedParts, notes, recommendations,
  ] = await Promise.all([
    db.select().from(workLogsTable).where(eq(workLogsTable.vehicleId, vehicleId))
      .orderBy(desc(workLogsTable.createdAt)).limit(50),
    db.select().from(installedPartsTable)
      .where(and(eq(installedPartsTable.vehicleId, vehicleId), isNull(installedPartsTable.removedAt)))
      .orderBy(desc(installedPartsTable.installedAt)),
    db.select().from(mechanicVehicleNotesTable)
      .where(eq(mechanicVehicleNotesTable.vehicleId, vehicleId))
      .orderBy(desc(mechanicVehicleNotesTable.createdAt)).limit(100),
    db.select().from(vehicleRecommendationsTable)
      .where(eq(vehicleRecommendationsTable.vehicleId, vehicleId))
      .orderBy(desc(vehicleRecommendationsTable.createdAt)).limit(100),
  ]);

  return {
    vehicle,
    profile: {
      decoded: profile.decodedVin,
      decodedAt: profile.decodedAt,
      engine: profile.engine,
      transmission: profile.transmission,
      drivetrain: profile.drivetrain,
      fuelType: profile.fuelType,
      bodyClass: profile.bodyClass,
      imageUrl: profile.imageUrl,
    },
    serviceHistory,
    installedParts,
    notes,
    recommendations,
    counts: {
      services: serviceHistory.length,
      installedParts: installedParts.length,
      openNotes: notes.filter((n) => !n.resolvedAt).length,
      openRecommendations: recommendations.filter((r) => r.status === "open").length,
    },
  };
}

router.get("/mechanic/workspace/by-vin/:vin", async (req: AuthRequest, res: Response): Promise<void> => {
  const vin = normalizeVin(String(req.params["vin"] ?? ""));
  if (!vin) { res.status(400).json({ error: "Invalid VIN" }); return; }
  let vehicleId: number;
  try {
    const r = await loadOrCreateVehicleByVin(vin, req.userId!);
    vehicleId = r.vehicleId;
  } catch (e) {
    if (e instanceof Error && e.message === "VIN_NOT_DECODABLE") {
      res.status(422).json({ error: "VIN not recognized by NHTSA." });
      return;
    }
    throw e;
  }
  const bundle = await workspaceBundle(vehicleId, req.userId!);
  if (!bundle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  res.json(bundle);
});

router.get("/mechanic/workspace/:vehicleId", async (req: AuthRequest, res: Response): Promise<void> => {
  const vehicleId = Number(req.params.vehicleId);
  if (!Number.isInteger(vehicleId)) { res.status(400).json({ error: "Bad vehicleId" }); return; }
  const bundle = await workspaceBundle(vehicleId, req.userId!);
  if (!bundle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  res.json(bundle);
});

// ────────────────────────────────────────────────────────────────────────
// Installed parts
// ────────────────────────────────────────────────────────────────────────
const installedPartSchema = z.object({
  category: z.string().min(1).max(64),
  partNumber: z.string().max(128).optional(),
  brand: z.string().max(128).optional(),
  supplier: z.string().max(128).optional(),
  installMileage: z.number().int().nonnegative().optional(),
  photoUrl: z.string().url().max(2048).optional(),
  notes: z.string().max(2000).optional(),
  jobId: z.number().int().positive().optional(),
  confidenceAtInstall: z.enum(["high", "medium", "verify"]).optional(),
  overrideRecommendation: z.object({
    recommendedPartNumber: z.string().optional(),
    recommendedBrand: z.string().optional(),
    reason: z.string().min(1).max(500),
  }).optional(),
});

router.get("/mechanic/vehicles/:vehicleId/installed-parts", async (req: AuthRequest, res: Response): Promise<void> => {
  const vehicleId = Number(req.params.vehicleId);
  if (!Number.isInteger(vehicleId)) { res.status(400).json({ error: "Bad vehicleId" }); return; }
  // include=all → also return removed/superseded rows for full part history.
  const includeRemoved = String(req.query["include"] ?? "") === "all";
  const rows = await db.select().from(installedPartsTable)
    .where(includeRemoved
      ? eq(installedPartsTable.vehicleId, vehicleId)
      : and(eq(installedPartsTable.vehicleId, vehicleId), isNull(installedPartsTable.removedAt)))
    .orderBy(desc(installedPartsTable.installedAt));
  res.json(rows);
});

router.post("/mechanic/vehicles/:vehicleId/installed-parts", async (req: AuthRequest, res: Response): Promise<void> => {
  const vehicleId = Number(req.params.vehicleId);
  if (!Number.isInteger(vehicleId)) { res.status(400).json({ error: "Bad vehicleId" }); return; }
  const body = installedPartSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body", details: body.error.flatten() }); return; }
  const [veh] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!veh) { res.status(404).json({ error: "Vehicle not found" }); return; }

  // Replace-on-install must be atomic: lock the vehicle row, mark prior active
  // rows in this category removed, THEN insert the new one. The DB partial
  // unique index `(vehicle_id, category) WHERE removed_at IS NULL` is the
  // safety net — without the tx + lock, two concurrent installs would race
  // and one would 23505. Doing both in one tx makes the second caller block
  // until the first commits, then they see the now-removed prior row and
  // succeed cleanly.
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM vehicles WHERE id = ${vehicleId} FOR UPDATE`);
    await tx.update(installedPartsTable)
      .set({ removedAt: new Date(), removedReason: "Superseded by new install" })
      .where(and(
        eq(installedPartsTable.vehicleId, vehicleId),
        eq(installedPartsTable.category, body.data.category),
        isNull(installedPartsTable.removedAt),
      ));
    const [inserted] = await tx.insert(installedPartsTable).values({
      vehicleId, vin: veh.vin,
      mechanicId: req.userId!,
      jobId: body.data.jobId ?? null,
      category: body.data.category,
      partNumber: body.data.partNumber ?? null,
      brand: body.data.brand ?? null,
      supplier: body.data.supplier ?? null,
      installMileage: body.data.installMileage ?? null,
      photoUrl: body.data.photoUrl ?? null,
      notes: body.data.notes ?? null,
      confidenceAtInstall: body.data.confidenceAtInstall ?? null,
      overrideRecommendation: body.data.overrideRecommendation ?? null,
    }).returning();
    return inserted;
  });
  res.status(201).json(row);
});

router.patch("/mechanic/installed-parts/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const body = z.object({
    removedReason: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const patch: Record<string, unknown> = {};
  if (body.data.removedReason !== undefined) {
    patch["removedAt"] = new Date();
    patch["removedReason"] = body.data.removedReason;
  }
  if (body.data.notes !== undefined) patch["notes"] = body.data.notes;
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  const [row] = await db.update(installedPartsTable).set(patch)
    .where(eq(installedPartsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ────────────────────────────────────────────────────────────────────────
// Notes
// ────────────────────────────────────────────────────────────────────────
const noteSchema = z.object({
  type: z.enum(["observation", "warning", "diagnostic"]),
  severity: z.enum(["info", "low", "medium", "high"]).optional(),
  title: z.string().min(1).max(200),
  body: z.string().max(4000).optional(),
  jobId: z.number().int().positive().optional(),
});

router.get("/mechanic/vehicles/:vehicleId/notes", async (req: AuthRequest, res: Response): Promise<void> => {
  const vehicleId = Number(req.params.vehicleId);
  if (!Number.isInteger(vehicleId)) { res.status(400).json({ error: "Bad vehicleId" }); return; }
  const rows = await db.select().from(mechanicVehicleNotesTable)
    .where(eq(mechanicVehicleNotesTable.vehicleId, vehicleId))
    .orderBy(desc(mechanicVehicleNotesTable.createdAt));
  res.json(rows);
});

router.post("/mechanic/vehicles/:vehicleId/notes", async (req: AuthRequest, res: Response): Promise<void> => {
  const vehicleId = Number(req.params.vehicleId);
  if (!Number.isInteger(vehicleId)) { res.status(400).json({ error: "Bad vehicleId" }); return; }
  const body = noteSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const [veh] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!veh) { res.status(404).json({ error: "Vehicle not found" }); return; }
  const [row] = await db.insert(mechanicVehicleNotesTable).values({
    vehicleId, vin: veh.vin, mechanicId: req.userId!,
    jobId: body.data.jobId ?? null,
    type: body.data.type,
    severity: body.data.severity ?? "info",
    title: body.data.title,
    body: body.data.body ?? null,
  }).returning();
  res.status(201).json(row);
});

router.patch("/mechanic/notes/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const body = z.object({ resolved: z.boolean() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const [row] = await db.update(mechanicVehicleNotesTable).set({
    resolvedAt: body.data.resolved ? new Date() : null,
    resolvedById: body.data.resolved ? req.userId! : null,
  }).where(eq(mechanicVehicleNotesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ────────────────────────────────────────────────────────────────────────
// Recommendations
// ────────────────────────────────────────────────────────────────────────
const recoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  urgency: z.enum(["low", "medium", "high", "critical"]).optional(),
  estimatedCost: z.number().nonnegative().optional(),
  jobId: z.number().int().positive().optional(),
});

router.get("/mechanic/vehicles/:vehicleId/recommendations", async (req: AuthRequest, res: Response): Promise<void> => {
  const vehicleId = Number(req.params.vehicleId);
  if (!Number.isInteger(vehicleId)) { res.status(400).json({ error: "Bad vehicleId" }); return; }
  const rows = await db.select().from(vehicleRecommendationsTable)
    .where(eq(vehicleRecommendationsTable.vehicleId, vehicleId))
    .orderBy(desc(vehicleRecommendationsTable.createdAt));
  res.json(rows);
});

router.post("/mechanic/vehicles/:vehicleId/recommendations", async (req: AuthRequest, res: Response): Promise<void> => {
  const vehicleId = Number(req.params.vehicleId);
  if (!Number.isInteger(vehicleId)) { res.status(400).json({ error: "Bad vehicleId" }); return; }
  const body = recoSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const [veh] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!veh) { res.status(404).json({ error: "Vehicle not found" }); return; }
  const [row] = await db.insert(vehicleRecommendationsTable).values({
    vehicleId, vin: veh.vin, mechanicId: req.userId!,
    jobId: body.data.jobId ?? null,
    title: body.data.title,
    description: body.data.description ?? null,
    urgency: body.data.urgency ?? "medium",
    estimatedCost: body.data.estimatedCost ?? null,
  }).returning();
  res.status(201).json(row);
});

router.patch("/mechanic/recommendations/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const body = z.object({ status: z.enum(["open", "addressed", "dismissed"]) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid body" }); return; }
  const isFinal = body.data.status !== "open";
  const [row] = await db.update(vehicleRecommendationsTable).set({
    status: body.data.status,
    addressedAt: isFinal ? new Date() : null,
    addressedById: isFinal ? req.userId! : null,
  }).where(eq(vehicleRecommendationsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// ────────────────────────────────────────────────────────────────────────
// Compatibility engine
// ────────────────────────────────────────────────────────────────────────
router.get("/mechanic/parts/categories", async (_req: AuthRequest, res: Response): Promise<void> => {
  res.json(PARTS_CATEGORIES);
});

router.get("/mechanic/vehicles/:vehicleId/compatibility", async (req: AuthRequest, res: Response): Promise<void> => {
  const vehicleId = Number(req.params.vehicleId);
  if (!Number.isInteger(vehicleId)) { res.status(400).json({ error: "Bad vehicleId" }); return; }
  const category = String(req.query["category"] ?? "");
  if (!category) { res.status(400).json({ error: "category query param required" }); return; }
  const reco = await computeCompatibility(vehicleId, category);
  if (!reco) { res.status(404).json({ error: "Unknown category" }); return; }
  res.json(reco);
});

// ────────────────────────────────────────────────────────────────────────
// Diagram lookup — quick OEM specs by clickable component.
//
// Pulls from the cached NHTSA decode + overlays whatever the mechanic has
// actually installed (e.g. the tires currently on this vehicle). The
// front-end can render any of these inline without a second round-trip.
// ────────────────────────────────────────────────────────────────────────
router.get("/mechanic/vehicles/:vehicleId/diagram-lookup", async (req: AuthRequest, res: Response): Promise<void> => {
  const vehicleId = Number(req.params.vehicleId);
  if (!Number.isInteger(vehicleId)) { res.status(400).json({ error: "Bad vehicleId" }); return; }
  const component = String(req.query["component"] ?? "");
  if (!component) { res.status(400).json({ error: "component query param required" }); return; }

  const [profile] = await db.select().from(mechanicVehicleProfilesTable)
    .where(eq(mechanicVehicleProfilesTable.vehicleId, vehicleId));
  const decoded = profile?.decodedVin ?? {};

  const installed = await db.select().from(installedPartsTable)
    .where(and(eq(installedPartsTable.vehicleId, vehicleId), isNull(installedPartsTable.removedAt)));
  const installedByCat = new Map(installed.map((p) => [p.category, p]));

  switch (component) {
    case "tires_front":
    case "tires_rear":
    case "tires": {
      const installedTires = installedByCat.get("tires");
      res.json({
        component,
        oem: { note: "Read OEM size from door-jamb sticker — VIN does not always reflect plus-sized OEM trims." },
        installed: installedTires ? {
          partNumber: installedTires.partNumber, brand: installedTires.brand,
          installedAt: installedTires.installedAt, mileage: installedTires.installMileage,
          notes: installedTires.notes,
        } : null,
        loadRatingHint: "Match or exceed door-jamb load rating.",
        speedRatingHint: "Match or exceed door-jamb speed rating.",
      });
      return;
    }
    case "windshield": {
      res.json({
        component,
        wiperHint: "Front wiper sizes vary even within the same year/model — confirm by measuring or via OEM lookup.",
        washerFluid: "Use seasonally-appropriate washer fluid (winter blend below freezing).",
      });
      return;
    }
    case "battery": {
      const installedBat = installedByCat.get("battery");
      res.json({
        component,
        oem: { note: "Group size and CCA vary by trim and HD electrical package — confirm from existing battery." },
        installed: installedBat ? {
          partNumber: installedBat.partNumber, brand: installedBat.brand,
          installedAt: installedBat.installedAt, mileage: installedBat.installMileage,
        } : null,
      });
      return;
    }
    case "brakes_front":
    case "brakes_rear":
    case "brakes": {
      const isFront = component !== "brakes_rear";
      const padCat = isFront ? "brake_pads_front" : "brake_pads_rear";
      const rotorCat = isFront ? "rotor_front" : "rotor_rear";
      res.json({
        component,
        oem: { note: "Brake pad/rotor specs vary heavily by trim, sport package, tow package, and HD package. ALWAYS verify before ordering." },
        installedPads: installedByCat.get(padCat) ?? null,
        installedRotors: installedByCat.get(rotorCat) ?? null,
      });
      return;
    }
    case "oil_cap":
    case "oil": {
      const installedFilter = installedByCat.get("oil_filter");
      res.json({
        component,
        oem: {
          viscosityHint: "Confirm oil viscosity from owner's manual or OEM cap stamp (often 0W-20 / 5W-30 / 5W-20).",
          capacityHint: "Capacity varies by engine variant — see service manual.",
        },
        engine: profile?.engine ?? null,
        installedFilter,
      });
      return;
    }
    case "headlights": {
      res.json({
        component,
        oem: { note: "Bulb fitment varies by trim (halogen / HID / LED). Confirm before ordering." },
        bodyClass: profile?.bodyClass ?? null,
        modelYear: decoded["ModelYear"] ?? null,
      });
      return;
    }
    default: {
      res.status(400).json({ error: `Unknown component: ${component}` });
      return;
    }
  }
});

export default router;
