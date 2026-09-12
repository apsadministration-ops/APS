import { Router, type IRouter } from "express";
import { eq, and, isNull, count, inArray, sql } from "drizzle-orm";
import { db, vehiclesTable, ownershipTable, usersTable, workLogsTable, jobsTable, shopsTable, partnerVehicleOperationsTable } from "@workspace/db";
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

class LegacyVehicleConflict extends Error {
  constructor(readonly response: string) {
    super(response);
  }
}

class VehicleTransferError extends Error {
  constructor(
    readonly status: number,
    readonly response: string,
  ) {
    super(response);
  }
}

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
    insuranceCarrier: vehicle.insuranceCarrier ?? null,
    insurancePolicyNumber: vehicle.insurancePolicyNumber ?? null,
    ownerShopId: vehicle.ownerShopId ?? null,
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
  const { vin, plateNumber, make, model, year, trim, color, mileage, insuranceCarrier, insurancePolicyNumber, ownerShopId } = req.body as {
    vin: string; plateNumber?: string; make: string; model: string;
    year: number; trim?: string; color?: string; mileage: number;
    insuranceCarrier?: string; insurancePolicyNumber?: string; ownerShopId?: number;
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

  const normalizedVin = vin.toUpperCase();
  const [existing] = await db.select().from(vehiclesTable).where(sql`lower(${vehiclesTable.vin}) = lower(${normalizedVin})`);
  if (existing) {
    try {
      const claimed = await db.transaction(async (tx) => {
        // This advisory lock is shared with partner create/link and ownership
        // transfer. It closes the no-row race where a VIN is being imported
        // while the legacy endpoint is trying to claim it.
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(lower(${normalizedVin}), 0)
          )
        `);
        const lockedRows = await tx.execute(sql`
          SELECT id
          FROM vehicles
          WHERE id = ${existing.id}
          FOR UPDATE
        `);
        const lockedId = lockedRows.rows[0] as { id: number } | undefined;
        if (!lockedId) throw new LegacyVehicleConflict("This vehicle no longer exists");
        const [currentVehicle] = await tx
          .select()
          .from(vehiclesTable)
          .where(eq(vehiclesTable.id, lockedId.id));
        if (!currentVehicle) throw new LegacyVehicleConflict("This vehicle no longer exists");

        // Re-check the registry only after the canonical vehicle row is
        // locked. A committed operation always wins over a legacy claim.
        const [registeredPartnerVehicle] = await tx
          .select({ id: partnerVehicleOperationsTable.id })
          .from(partnerVehicleOperationsTable)
          .where(eq(partnerVehicleOperationsTable.vehicleId, currentVehicle.id));
        if (registeredPartnerVehicle) {
          throw new LegacyVehicleConflict("This VIN is registered to a commercial partner vehicle");
        }

        const [activeOwnership] = await tx
          .select()
          .from(ownershipTable)
          .where(and(eq(ownershipTable.vehicleId, currentVehicle.id), isNull(ownershipTable.endDate)));
        if (activeOwnership) {
          if (activeOwnership.userId === req.userId) {
            throw new LegacyVehicleConflict("You already own this vehicle");
          }
          throw new LegacyVehicleConflict("This VIN is already registered to another user");
        }

        // Update plate number + mileage if provided. Only accept a higher
        // mileage on re-add (odometers don't go down).
        const updateFields: { plateNumber?: string; mileage?: number } = {};
        if (plateNumber) updateFields.plateNumber = plateNumber.toUpperCase();
        const newMileageInt = Math.floor(mileage);
        if (newMileageInt > (currentVehicle.mileage ?? 0)) updateFields.mileage = newMileageInt;
        if (Object.keys(updateFields).length > 0) {
          await tx
            .update(vehiclesTable)
            .set(updateFields)
            .where(eq(vehiclesTable.id, currentVehicle.id));
        }

        const [newOwnership] = await tx.insert(ownershipTable).values({
          vehicleId: currentVehicle.id,
          userId: req.userId!,
          vin: currentVehicle.vin,
          startDate: new Date(),
          transferVerified: false,
        }).returning();
        if (!newOwnership) throw new Error("Ownership insert did not return a row");
        return {
          vehicle: { ...currentVehicle, ...updateFields } as typeof currentVehicle,
          ownership: newOwnership,
        };
      });

      const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
      const [sc] = await db.select({ c: count() }).from(workLogsTable).where(eq(workLogsTable.vehicleId, claimed.vehicle.id));
      res.status(201).json(formatVehicle(claimed.vehicle, claimed.ownership, owner ?? null, Number(sc?.c ?? 0), req.userId!));
    } catch (error) {
      if (error instanceof LegacyVehicleConflict) {
        res.status(409).json({ error: error.response });
        return;
      }
      throw error;
    }
    return;
  }

  // Validate fleet linkage: ownerShopId must belong to the caller and be a
  // partner type that owns vehicles (dealership / fleet / gsa). Independent
  // shops are bay-rental marketplaces and don't own vehicles.
  let resolvedOwnerShopId: number | null = null;
  if (ownerShopId != null) {
    const sid = Number(ownerShopId);
    if (!Number.isFinite(sid) || sid <= 0) {
      res.status(400).json({ error: "Invalid ownerShopId" });
      return;
    }
    const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, sid));
    if (!shop) { res.status(404).json({ error: "Partner shop not found" }); return; }
    if (shop.ownerId !== req.userId && req.userRole !== "admin") {
      res.status(403).json({ error: "You do not own that partner shop" }); return;
    }
    if (shop.partnerKind !== "dealership" && shop.partnerKind !== "fleet" && shop.partnerKind !== "gsa") {
      res.status(400).json({ error: "Only Dealership, Fleet, or GSA partners can own fleet vehicles" }); return;
    }
    resolvedOwnerShopId = sid;
  }

  let vehicle: typeof vehiclesTable.$inferSelect | undefined;
  let ownership: typeof ownershipTable.$inferSelect | undefined;
  try {
    ({ vehicle, ownership } = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(lower(${normalizedVin}), 0)
        )
      `);
      const [insertedVehicle] = await tx.insert(vehiclesTable).values({
        vin: normalizedVin,
        plateNumber: plateNumber ? plateNumber.toUpperCase() : null,
        make, model, year,
        trim: trim ?? null,
        color: color ?? null,
        mileage: Math.floor(mileage),
        insuranceCarrier: insuranceCarrier?.trim() || null,
        insurancePolicyNumber: insurancePolicyNumber?.trim() || null,
        ownerShopId: resolvedOwnerShopId,
      }).returning();
      if (!insertedVehicle) throw new Error("Vehicle insert did not return a row");
      const [insertedOwnership] = await tx.insert(ownershipTable).values({
        vehicleId: insertedVehicle.id,
        userId: req.userId!,
        vin: insertedVehicle.vin,
        startDate: new Date(),
        transferVerified: true,
      }).returning();
      if (!insertedOwnership) throw new Error("Ownership insert did not return a row");
      return { vehicle: insertedVehicle, ownership: insertedOwnership };
    }));
  } catch (error) {
    // A concurrent partner registry insert may win the global VIN race after
    // the lookup above. Preserve the legacy endpoint's normal 409 behavior
    // instead of leaking a unique-index error as a 500.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505"
    ) {
      res.status(409).json({ error: "This VIN is already registered" });
      return;
    }
    throw error;
  }
  if (!vehicle) {
    res.status(500).json({ error: "Vehicle insert did not return a row" });
    return;
  }

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

  try {
    const transferred = await db.transaction(async (tx) => {
      const identityRows = await tx.execute(sql`
        SELECT vin
        FROM vehicles
        WHERE id = ${vehicleId}
      `);
      const identity = identityRows.rows[0] as { vin: string } | undefined;
      if (!identity) throw new VehicleTransferError(404, "Vehicle not found");
      // Match partner import and legacy claim locking. The row lock and this
      // advisory VIN lock ensure a transfer cannot race an import.
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(lower(${identity.vin}), 0)
        )
      `);
      const lockedRows = await tx.execute(sql`
        SELECT id
        FROM vehicles
        WHERE id = ${vehicleId}
        FOR UPDATE
      `);
      if (!lockedRows.rows[0]) throw new VehicleTransferError(404, "Vehicle not found");
      const [vehicle] = await tx
        .select()
        .from(vehiclesTable)
        .where(eq(vehiclesTable.id, vehicleId));
      if (!vehicle) throw new VehicleTransferError(404, "Vehicle not found");

      // Imported commercial vehicles remain registry-owned. Do not end their
      // existing ownership history or append a transfer row.
      const [registeredPartnerVehicle] = await tx
        .select({ id: partnerVehicleOperationsTable.id })
        .from(partnerVehicleOperationsTable)
        .where(eq(partnerVehicleOperationsTable.vehicleId, vehicleId));
      if (registeredPartnerVehicle) {
        throw new VehicleTransferError(
          409,
          "This VIN is registered to a commercial partner vehicle",
        );
      }

      const [currentOwnership] = await tx.select().from(ownershipTable)
        .where(and(eq(ownershipTable.vehicleId, vehicleId), isNull(ownershipTable.endDate)));
      if (!currentOwnership || currentOwnership.userId !== req.userId) {
        throw new VehicleTransferError(403, "You do not own this vehicle");
      }

      const [newOwner] = await tx.select().from(usersTable).where(eq(usersTable.email, newOwnerEmail));
      if (!newOwner) throw new VehicleTransferError(404, "New owner not found");

      const [endedOwnership] = await tx.update(ownershipTable)
        .set({ endDate: new Date(), transferVerified: true })
        .where(eq(ownershipTable.id, currentOwnership.id))
        .returning();
      if (!endedOwnership) throw new Error("Ownership transfer update did not return a row");
      const [newOwnership] = await tx.insert(ownershipTable).values({
        vehicleId,
        userId: newOwner.id,
        vin: vehicle.vin,
        startDate: new Date(),
        transferVerified: true,
      }).returning();
      if (!newOwnership) throw new Error("Ownership transfer insert did not return a row");
      return { newOwnership, newOwner };
    });

    res.json({
      id: transferred.newOwnership.id,
      vehicleId: transferred.newOwnership.vehicleId,
      vin: transferred.newOwnership.vin,
      userId: transferred.newOwnership.userId,
      userName: transferred.newOwner.name,
      startDate: transferred.newOwnership.startDate,
      endDate: transferred.newOwnership.endDate ?? null,
      transferVerified: transferred.newOwnership.transferVerified,
    });
  } catch (error) {
    if (error instanceof VehicleTransferError) {
      res.status(error.status).json({ error: error.response });
      return;
    }
    throw error;
  }
});

// List the fleet vehicles owned by a single partner shop. Restricted to the
// shop's owner + admin — leaks would expose plate numbers and insurance.
router.get("/shops/:shopId/vehicles", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const shopId = parseInt(String(req.params.shopId), 10);
  if (!Number.isFinite(shopId) || shopId <= 0) {
    res.status(400).json({ error: "Invalid shop ID" }); return;
  }
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, shopId));
  if (!shop) { res.status(404).json({ error: "Shop not found" }); return; }
  if (shop.ownerId !== req.userId && req.userRole !== "admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const vehicles = await db.select().from(vehiclesTable).where(eq(vehiclesTable.ownerShopId, shopId));
  const rows = await Promise.all(vehicles.map(async (v) => {
    const [sc] = await db.select({ c: count() }).from(workLogsTable).where(eq(workLogsTable.vehicleId, v.id));
    return {
      id: v.id, vin: v.vin, plateNumber: v.plateNumber ?? null,
      make: v.make, model: v.model, year: v.year,
      trim: v.trim ?? null, color: v.color ?? null,
      mileage: v.mileage ?? 0,
      insuranceCarrier: v.insuranceCarrier ?? null,
      insurancePolicyNumber: v.insurancePolicyNumber ?? null,
      ownerShopId: v.ownerShopId ?? null,
      serviceCount: Number(sc?.c ?? 0),
      createdAt: v.createdAt,
    };
  }));
  res.json(rows);
});

export default router;
