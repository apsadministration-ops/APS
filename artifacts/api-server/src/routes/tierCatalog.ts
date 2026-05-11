import { Router, type IRouter } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, vehiclesTable, ownershipTable, jobsTable } from "@workspace/db";
import {
  TIERS, JOB_CATALOG, COMMISSION, EUROPEAN_PREMIUM,
  quoteForService, isEuropeanVehicle, findServiceBySlug,
} from "@workspace/tier-catalog";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

/**
 * Public, cacheable. Mirrors the in-process `@workspace/tier-catalog` lib so
 * non-TS clients (or a future web admin) can render tier ladders, service
 * pickers, earnings calculators, and flat-rate quotes without baking the
 * catalog into their source. The mobile app can also fall back to this if
 * its bundled lib copy is older than the running server.
 */
router.get("/tier-catalog", (_req, res): void => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    tiers: TIERS,
    services: JOB_CATALOG,
    commission: {
      normal:      COMMISSION.normal,
      workingDown: COMMISSION.workingDown,
      detailing:   COMMISSION.detailing,
    },
    europeanPremium: EUROPEAN_PREMIUM,
  });
});

/**
 * Quote a service for a specific vehicle (so we can apply the European
 * premium based on the VIN/make). Returns the same shape as
 * `quoteForService()` plus the boolean `isEuropean` flag we used.
 *
 * `vehicleId` is optional — if omitted we return the domestic quote with
 * `isEuropean=false` so the customer can preview prices before picking a car.
 */
router.get("/quotes/service/:slug", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const slug = String(req.params.slug);
  const svc = findServiceBySlug(slug);
  if (!svc) { res.status(404).json({ error: `Unknown serviceSlug: ${slug}` }); return; }

  let isEuropean = false;
  const vehicleIdRaw = (req.query as { vehicleId?: string }).vehicleId;
  if (vehicleIdRaw) {
    const vehicleId = parseInt(String(vehicleIdRaw), 10);
    if (!Number.isFinite(vehicleId)) { res.status(400).json({ error: "Invalid vehicleId" }); return; }

    // Allow-list of roles that may quote against a specific vehicle. Other
    // authenticated roles (e.g. shop_owner) can still quote prices, just not
    // tie them to an arbitrary vehicle ID.
    const role = req.userRole;
    if (role !== "customer" && role !== "mechanic" && role !== "admin") {
      // Same response shape as below to avoid leaking vehicle existence.
      res.status(404).json({ error: "Vehicle not found" }); return;
    }

    // Authorize FIRST, then load the vehicle. This avoids using the endpoint
    // as an existence oracle (404 vs 403 telling an attacker which IDs exist).
    let authorized = role === "admin";
    if (role === "customer") {
      // Current owner only — historical owners must not see live pricing for
      // a car they no longer hold (`end_date IS NULL` ⇒ active row).
      const [own] = await db.select().from(ownershipTable).where(and(
        eq(ownershipTable.vehicleId, vehicleId),
        eq(ownershipTable.userId, req.userId!),
        isNull(ownershipTable.endDate),
      ));
      authorized = !!own;
    } else if (role === "mechanic") {
      // Mechanic must have an ACTIVE job touching this vehicle. We don't let
      // mechanics quote arbitrary vehicles to mirror the IDOR rules used on
      // /vehicles/:id (see canAccessVehicle in routes/vehicles.ts).
      const [job] = await db.select({ id: jobsTable.id }).from(jobsTable).where(and(
        eq(jobsTable.vehicleId, vehicleId),
        eq(jobsTable.mechanicId, req.userId!),
      )).limit(1);
      authorized = !!job;
    }
    if (!authorized) {
      res.status(404).json({ error: "Vehicle not found" }); return;
    }

    const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
    if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }
    isEuropean = isEuropeanVehicle({ vin: vehicle.vin, make: vehicle.make });
  }

  const quote = quoteForService(svc, { isEuropean });
  if (!quote) {
    res.status(409).json({ error: "Service is not currently quotable (no published flat rate)." });
    return;
  }
  res.json(quote);
});

export default router;
