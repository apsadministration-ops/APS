import { Router, type IRouter } from "express";
import { eq, and, isNull, count, inArray } from "drizzle-orm";
import { db, vehiclesTable, ownershipTable, usersTable, workLogsTable, jobsTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import { lookupComponentSpecs } from "../lib/componentSpecs";
import { lookupParts, type PartCategory } from "../lib/partsCatalog";
import { generateRecommendations } from "../lib/recommendationsEngine";

/**
 * Returns true if `userId` may view the given vehicle's data:
 *  - admins always
 *  - the current OR a past owner (VIN history is preserved across transfer)
 *  - a mechanic with a non-cancelled job assigned for this vehicle (so they
 *    can see the car they're servicing). Cancelled/refused jobs do NOT grant
 *    access.
 */
async function canAccessVehicle(userId: number, role: string, vehicleId: number): Promise<boolean> {
  if (role === "admin") return true;
  const [own] = await db.select().from(ownershipTable)
    .where(and(eq(ownershipTable.vehicleId, vehicleId), eq(ownershipTable.userId, userId)));
  if (own) return true;
  if (role === "mechanic") {
    // Only an ACTIVE working relationship grants access. Cancelled/refused
    // jobs do NOT — otherwise a mechanic who briefly held a job (or was
    // requested then cancelled) would retain VIN/history access forever.
    const [job] = await db.select({ id: jobsTable.id }).from(jobsTable)
      .where(and(
        eq(jobsTable.vehicleId, vehicleId),
        eq(jobsTable.mechanicId, userId),
        inArray(jobsTable.status, ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "PAID"]),
      ));
    if (job) return true;
  }
  return false;
}

const router: IRouter = Router();

function formatVehicle(
  vehicle: typeof vehiclesTable.$inferSelect,
  ownership: typeof ownershipTable.$inferSelect | null,
  owner: typeof usersTable.$inferSelect | null,
  serviceCount: number,
  currentUserId: number,
) {
  return {
    id: vehicle.id,
    vin: vehicle.vin,
    plateNumber: vehicle.plateNumber ?? null,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    trim: vehicle.trim ?? null,
    color: vehicle.color ?? null,
    mileage: vehicle.mileage ?? 0,
    createdAt: vehicle.createdAt,
    currentOwner: owner
      ? {
          id: owner.id,
          name: owner.name,
          email: owner.email,
          phone: owner.phone ?? null,
          role: owner.role,
          status: owner.status,
          avatarUrl: owner.avatarUrl ?? null,
          createdAt: owner.createdAt,
        }
      : null,
    isCurrentUserOwner: owner?.id === currentUserId,
    serviceCount,
  };
}

router.get("/vehicles", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const ownerships = await db
    .select()
    .from(ownershipTable)
    .where(and(eq(ownershipTable.userId, req.userId!), isNull(ownershipTable.endDate)));

  const result = await Promise.all(
    ownerships.map(async (o) => {
      const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, o.vehicleId));
      if (!vehicle) return null;
      const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, o.userId));
      const [sc] = await db.select({ c: count() }).from(workLogsTable).where(eq(workLogsTable.vehicleId, vehicle.id));
      return formatVehicle(vehicle, o, owner ?? null, Number(sc?.c ?? 0), req.userId!);
    }),
  );

  res.json(result.filter(Boolean));
});

router.post("/vehicles", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const { vin, plateNumber, make, model, year, trim, color, mileage } = req.body as {
    vin: string; plateNumber?: string; make: string; model: string;
    year: number; trim?: string; color?: string; mileage: number;
  };

  if (!vin || !make || !model || !year) {
    res.status(400).json({ error: "vin, make, model, and year are required" });
    return;
  }
  if (vin.length !== 17) {
    res.status(400).json({ error: "VIN must be exactly 17 characters" });
    return;
  }
  if (mileage == null || typeof mileage !== "number" || !Number.isFinite(mileage) || mileage < 0) {
    res.status(400).json({ error: "Mileage is required and must be a non-negative number" });
    return;
  }

  const [existing] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.vin, vin.toUpperCase()));
  if (existing) {
    const [activeOwnership] = await db
      .select()
      .from(ownershipTable)
      .where(and(eq(ownershipTable.vehicleId, existing.id), isNull(ownershipTable.endDate)));

    if (activeOwnership) {
      if (activeOwnership.userId === req.userId) {
        res.status(409).json({ error: "You already own this vehicle" });
      } else {
        res.status(409).json({ error: "This VIN is already registered to another user" });
      }
      return;
    }

    // Update plate number + mileage if provided
    const updateFields: { plateNumber?: string; mileage?: number } = {};
    if (plateNumber) updateFields.plateNumber = plateNumber.toUpperCase();
    // Only accept a higher mileage on re-add (odometers don't go down)
    const newMileageInt = Math.floor(mileage);
    if (newMileageInt > (existing.mileage ?? 0)) updateFields.mileage = newMileageInt;
    if (Object.keys(updateFields).length > 0) {
      await db.update(vehiclesTable).set(updateFields).where(eq(vehiclesTable.id, existing.id));
    }

    const [newOwnership] = await db.insert(ownershipTable).values({
      vehicleId: existing.id,
      userId: req.userId!,
      vin: existing.vin,
      startDate: new Date(),
      transferVerified: false,
    }).returning();

    const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
    const [sc] = await db.select({ c: count() }).from(workLogsTable).where(eq(workLogsTable.vehicleId, existing.id));
    const updated = { ...existing, ...updateFields } as typeof existing;
    res.status(201).json(formatVehicle(updated, newOwnership, owner ?? null, Number(sc?.c ?? 0), req.userId!));
    return;
  }

  const [vehicle] = await db.insert(vehiclesTable).values({
    vin: vin.toUpperCase(),
    plateNumber: plateNumber ? plateNumber.toUpperCase() : null,
    make, model, year,
    trim: trim ?? null,
    color: color ?? null,
    mileage: Math.floor(mileage),
  }).returning();

  const [ownership] = await db.insert(ownershipTable).values({
    vehicleId: vehicle.id,
    userId: req.userId!,
    vin: vehicle.vin,
    startDate: new Date(),
    transferVerified: true,
  }).returning();

  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  res.status(201).json(formatVehicle(vehicle, ownership, owner ?? null, 0, req.userId!));
});

router.delete("/vehicles/:vehicleId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const vehicleId = parseInt(String(req.params.vehicleId), 10);
  if (isNaN(vehicleId)) { res.status(400).json({ error: "Invalid vehicle ID" }); return; }

  const [ownership] = await db
    .select()
    .from(ownershipTable)
    .where(and(eq(ownershipTable.vehicleId, vehicleId), eq(ownershipTable.userId, req.userId!), isNull(ownershipTable.endDate)));

  if (!ownership) {
    res.status(404).json({ error: "You do not own this vehicle" });
    return;
  }

  await db.update(ownershipTable).set({ endDate: new Date() }).where(eq(ownershipTable.id, ownership.id));
  res.json({ message: "Vehicle removed from your account" });
});

router.get("/vehicles/vin/:vin", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const vin = (Array.isArray(req.params.vin) ? req.params.vin[0] : req.params.vin).toUpperCase();
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.vin, vin));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  if (!(await canAccessVehicle(req.userId!, req.userRole ?? "", vehicle.id))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [activeOwnership] = await db.select().from(ownershipTable)
    .where(and(eq(ownershipTable.vehicleId, vehicle.id), isNull(ownershipTable.endDate)));
  const owner = activeOwnership
    ? (await db.select().from(usersTable).where(eq(usersTable.id, activeOwnership.userId)))[0] ?? null
    : null;
  const [sc] = await db.select({ c: count() }).from(workLogsTable).where(eq(workLogsTable.vehicleId, vehicle.id));
  res.json(formatVehicle(vehicle, activeOwnership ?? null, owner, Number(sc?.c ?? 0), req.userId!));
});

router.get("/vehicles/:vehicleId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.vehicleId) ? req.params.vehicleId[0] : req.params.vehicleId;
  const vehicleId = parseInt(rawId, 10);
  if (isNaN(vehicleId)) { res.status(400).json({ error: "Invalid vehicle ID" }); return; }

  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  if (!(await canAccessVehicle(req.userId!, req.userRole ?? "", vehicleId))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [activeOwnership] = await db.select().from(ownershipTable)
    .where(and(eq(ownershipTable.vehicleId, vehicleId), isNull(ownershipTable.endDate)));
  const owner = activeOwnership
    ? (await db.select().from(usersTable).where(eq(usersTable.id, activeOwnership.userId)))[0] ?? null
    : null;
  const [sc] = await db.select({ c: count() }).from(workLogsTable).where(eq(workLogsTable.vehicleId, vehicleId));
  res.json(formatVehicle(vehicle, activeOwnership ?? null, owner, Number(sc?.c ?? 0), req.userId!));
});

router.get("/vehicles/:vehicleId/history", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.vehicleId) ? req.params.vehicleId[0] : req.params.vehicleId;
  const vehicleId = parseInt(rawId, 10);
  if (isNaN(vehicleId)) { res.status(400).json({ error: "Invalid vehicle ID" }); return; }
  if (!(await canAccessVehicle(req.userId!, req.userRole ?? "", vehicleId))) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const logs = await db.select().from(workLogsTable).where(eq(workLogsTable.vehicleId, vehicleId)).orderBy(workLogsTable.createdAt);
  const result = await Promise.all(logs.map(async (log) => {
    const [mechanic] = await db.select().from(usersTable).where(eq(usersTable.id, log.mechanicId));
    return { ...log, partsUsed: (log.partsUsed as string[]) ?? [], beforeImages: (log.beforeImages as string[]) ?? [], afterImages: (log.afterImages as string[]) ?? [], mechanicName: mechanic?.name ?? "Unknown" };
  }));
  res.json(result);
});

/**
 * Workbench endpoints have a stricter access model than general vehicle reads:
 * the caller MUST be either an admin OR the mechanic currently assigned to a
 * non-cancelled/non-refused job on this exact vehicle. Owners and past
 * mechanics cannot use these endpoints — the workbench is a live tool for the
 * mechanic on the active job only. The required `jobId` query param ties the
 * request to a specific job so a mechanic with a different job on the same
 * vehicle still cannot access it from a stale context.
 */
async function resolveWorkbenchAccess(
  req: AuthRequest,
  vehicleId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const rawJobId = Array.isArray(req.query.jobId) ? req.query.jobId[0] : req.query.jobId;
  const jobId = typeof rawJobId === "string" ? parseInt(rawJobId, 10) : NaN;
  if (!Number.isFinite(jobId)) {
    return { ok: false, status: 400, error: "jobId query param is required" };
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job || job.vehicleId !== vehicleId) {
    return { ok: false, status: 404, error: "Job not found for this vehicle" };
  }
  if (req.userRole === "admin") return { ok: true };
  if (req.userRole !== "mechanic" || job.mechanicId !== req.userId) {
    return { ok: false, status: 403, error: "Workbench is restricted to the assigned mechanic" };
  }
  if (!["ACCEPTED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "PAID"].includes(job.status)) {
    return { ok: false, status: 403, error: "Workbench requires an active or completed job" };
  }
  return { ok: true };
}

router.get("/vehicles/:vehicleId/component-specs", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.vehicleId) ? req.params.vehicleId[0] : req.params.vehicleId;
  const vehicleId = parseInt(rawId, 10);
  if (isNaN(vehicleId)) { res.status(400).json({ error: "Invalid vehicle ID" }); return; }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  const access = await resolveWorkbenchAccess(req, vehicleId);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  res.json(lookupComponentSpecs({ make: vehicle.make, model: vehicle.model, year: vehicle.year }));
});

router.get("/vehicles/:vehicleId/parts-catalog", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.vehicleId) ? req.params.vehicleId[0] : req.params.vehicleId;
  const vehicleId = parseInt(rawId, 10);
  if (isNaN(vehicleId)) { res.status(400).json({ error: "Invalid vehicle ID" }); return; }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  const access = await resolveWorkbenchAccess(req, vehicleId);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  const rawCat = Array.isArray(req.query.category) ? req.query.category[0] : req.query.category;
  const validCats: PartCategory[] = ["all", "engine", "brakes", "suspension", "filters", "fluids", "electrical", "wipers", "tires"];
  const category = (typeof rawCat === "string" && (validCats as string[]).includes(rawCat) ? rawCat : "all") as PartCategory;
  const parts = lookupParts({ make: vehicle.make, model: vehicle.model, year: vehicle.year }, category);
  res.json({
    vehicle: { id: vehicle.id, vin: vehicle.vin, make: vehicle.make, model: vehicle.model, year: vehicle.year },
    category,
    parts,
  });
});

router.get("/vehicles/:vehicleId/recommendations", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.vehicleId) ? req.params.vehicleId[0] : req.params.vehicleId;
  const vehicleId = parseInt(rawId, 10);
  if (isNaN(vehicleId)) { res.status(400).json({ error: "Invalid vehicle ID" }); return; }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
  const access = await resolveWorkbenchAccess(req, vehicleId);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  const history = await db.select().from(workLogsTable).where(eq(workLogsTable.vehicleId, vehicleId));
  res.json(generateRecommendations(vehicle, history));
});

router.post("/vehicles/:vehicleId/transfer", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.vehicleId) ? req.params.vehicleId[0] : req.params.vehicleId;
  const vehicleId = parseInt(rawId, 10);
  if (isNaN(vehicleId)) { res.status(400).json({ error: "Invalid vehicle ID" }); return; }

  const { newOwnerEmail } = req.body as { newOwnerEmail: string };
  if (!newOwnerEmail) { res.status(400).json({ error: "newOwnerEmail is required" }); return; }

  const [currentOwnership] = await db.select().from(ownershipTable)
    .where(and(eq(ownershipTable.vehicleId, vehicleId), isNull(ownershipTable.endDate)));
  if (!currentOwnership || currentOwnership.userId !== req.userId) {
    res.status(403).json({ error: "You do not own this vehicle" }); return;
  }

  const [newOwner] = await db.select().from(usersTable).where(eq(usersTable.email, newOwnerEmail));
  if (!newOwner) { res.status(404).json({ error: "New owner not found" }); return; }

  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }

  await db.update(ownershipTable).set({ endDate: new Date(), transferVerified: true }).where(eq(ownershipTable.id, currentOwnership.id));
  const [newOwnership] = await db.insert(ownershipTable).values({ vehicleId, userId: newOwner.id, vin: vehicle.vin, startDate: new Date(), transferVerified: true }).returning();

  res.json({ id: newOwnership.id, vehicleId: newOwnership.vehicleId, vin: newOwnership.vin, userId: newOwnership.userId, userName: newOwner.name, startDate: newOwnership.startDate, endDate: newOwnership.endDate ?? null, transferVerified: newOwnership.transferVerified });
});

export default router;
