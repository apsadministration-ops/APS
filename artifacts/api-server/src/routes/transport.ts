import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, jobsTable, vehicleTransportLegsTable } from "@workspace/db";
import { authenticate, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

/** Read access: customer who owns the job, the assigned mechanic, or admin. */
async function loadJobForAccess(jobId: number, req: AuthRequest) {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) return { ok: false as const, status: 404, error: "Job not found" };
  const isCustomer = req.userRole === "customer" && job.customerId === req.userId;
  const isAssignedMechanic = req.userRole === "mechanic" && job.mechanicId === req.userId;
  const isAdmin = req.userRole === "admin";
  if (!isCustomer && !isAssignedMechanic && !isAdmin) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }
  return { ok: true as const, job };
}

function formatLeg(l: typeof vehicleTransportLegsTable.$inferSelect) {
  const miles = l.endMileage != null ? l.endMileage - l.startMileage : null;
  return {
    id: l.id,
    jobId: l.jobId,
    driverId: l.driverId,
    direction: l.direction,
    status: l.status,
    startMileage: l.startMileage,
    endMileage: l.endMileage,
    miles,
    startedAt: l.startedAt.toISOString(),
    completedAt: l.completedAt ? l.completedAt.toISOString() : null,
    startLat: l.startLat, startLng: l.startLng,
    endLat: l.endLat, endLng: l.endLng,
    lastLat: l.lastLat, lastLng: l.lastLng,
    lastLocationAt: l.lastLocationAt ? l.lastLocationAt.toISOString() : null,
    notes: l.notes,
  };
}

// GET /jobs/:jobId/transport — list legs (customer/mechanic/admin)
router.get("/jobs/:jobId/transport", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const access = await loadJobForAccess(jobId, req);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
  const legs = await db.select().from(vehicleTransportLegsTable)
    .where(eq(vehicleTransportLegsTable.jobId, jobId))
    .orderBy(desc(vehicleTransportLegsTable.startedAt));
  res.json(legs.map(formatLeg));
});

// POST /jobs/:jobId/transport/legs — mechanic starts a transport leg.
router.post("/jobs/:jobId/transport/legs", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const { direction, startMileage, startLat, startLng, notes } = req.body as {
    direction?: "outbound" | "return";
    startMileage?: number;
    startLat?: number; startLng?: number;
    notes?: string;
  };
  if (direction !== "outbound" && direction !== "return") {
    res.status(400).json({ error: "direction must be 'outbound' or 'return'" }); return;
  }
  if (typeof startMileage !== "number" || !Number.isFinite(startMileage) || startMileage < 0) {
    res.status(400).json({ error: "startMileage (whole miles) is required before driving the vehicle" }); return;
  }

  const result = await db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`SELECT id, mechanic_id, customer_transport_approved, requires_ghost_garage FROM jobs WHERE id = ${jobId} FOR UPDATE`,
    );
    const j = locked.rows[0] as { id: number; mechanic_id: number | null; customer_transport_approved: boolean; requires_ghost_garage: boolean } | undefined;
    if (!j) return { ok: false as const, status: 404, error: "Job not found" };
    if (j.mechanic_id !== req.userId) return { ok: false as const, status: 403, error: "Only the assigned mechanic can start a transport leg" };
    if (!j.requires_ghost_garage) return { ok: false as const, status: 409, error: "This job is not flagged for vehicle transport" };
    if (!j.customer_transport_approved) return { ok: false as const, status: 409, error: "Customer has not approved vehicle transport yet" };

    // Hard cap: at most one completed leg per direction. Prevents duplicate
    // outbound/return entries even if a client retries after a network blip.
    const sameDir = await tx.select().from(vehicleTransportLegsTable).where(and(
      eq(vehicleTransportLegsTable.jobId, jobId),
      eq(vehicleTransportLegsTable.direction, direction),
      eq(vehicleTransportLegsTable.status, "completed"),
    ));
    if (sameDir.length > 0) {
      return { ok: false as const, status: 409, error: `A ${direction} transport leg has already been completed for this job` };
    }

    // Disallow overlapping in-progress legs.
    const open = await tx.select().from(vehicleTransportLegsTable)
      .where(and(eq(vehicleTransportLegsTable.jobId, jobId), eq(vehicleTransportLegsTable.status, "in_progress")));
    if (open.length > 0) {
      return { ok: false as const, status: 409, error: "Finish the current transport leg before starting another" };
    }

    // For 'return', require an outbound leg to have completed first.
    if (direction === "return") {
      const out = await tx.select().from(vehicleTransportLegsTable).where(and(
        eq(vehicleTransportLegsTable.jobId, jobId),
        eq(vehicleTransportLegsTable.direction, "outbound"),
        eq(vehicleTransportLegsTable.status, "completed"),
      ));
      if (out.length === 0) {
        return { ok: false as const, status: 409, error: "Complete the outbound leg before starting the return" };
      }
    }

    const [leg] = await tx.insert(vehicleTransportLegsTable).values({
      jobId, driverId: req.userId!, direction, status: "in_progress",
      startMileage: Math.round(startMileage),
      startLat: startLat ?? null, startLng: startLng ?? null,
      lastLat: startLat ?? null, lastLng: startLng ?? null,
      lastLocationAt: startLat != null && startLng != null ? new Date() : null,
      notes: notes ?? null,
    }).returning();
    return { ok: true as const, leg };
  });

  if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
  res.status(201).json(formatLeg(result.leg));
});

// PATCH /jobs/:jobId/transport/legs/:legId/finish — mechanic completes the leg.
router.patch("/jobs/:jobId/transport/legs/:legId/finish", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  const legId = parseInt(String(req.params.legId), 10);
  if (isNaN(jobId) || isNaN(legId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

  const { endMileage, endLat, endLng, notes } = req.body as {
    endMileage?: number; endLat?: number; endLng?: number; notes?: string;
  };
  if (typeof endMileage !== "number" || !Number.isFinite(endMileage) || endMileage < 0) {
    res.status(400).json({ error: "endMileage (whole miles) is required to close out the leg" }); return;
  }

  const [leg] = await db.select().from(vehicleTransportLegsTable).where(eq(vehicleTransportLegsTable.id, legId));
  if (!leg || leg.jobId !== jobId) { res.status(404).json({ error: "Transport leg not found" }); return; }
  if (leg.driverId !== req.userId) { res.status(403).json({ error: "Only the leg's driver can finish it" }); return; }
  if (leg.status !== "in_progress") { res.status(409).json({ error: "Leg is not in progress" }); return; }
  const finalEnd = Math.round(endMileage);
  if (finalEnd < leg.startMileage) {
    res.status(400).json({ error: `End mileage (${finalEnd}) cannot be lower than start mileage (${leg.startMileage})` }); return;
  }

  // Conditional update: only flips to completed if still in_progress.
  // Two simultaneous finish requests will result in exactly one transition.
  const updates = await db.update(vehicleTransportLegsTable).set({
    status: "completed",
    endMileage: finalEnd,
    endLat: endLat ?? leg.lastLat ?? null,
    endLng: endLng ?? leg.lastLng ?? null,
    completedAt: new Date(),
    notes: notes ?? leg.notes,
  }).where(and(
    eq(vehicleTransportLegsTable.id, legId),
    eq(vehicleTransportLegsTable.status, "in_progress"),
  )).returning();
  if (updates.length === 0) {
    res.status(409).json({ error: "Leg is no longer in progress" });
    return;
  }
  res.json(formatLeg(updates[0]));
});

// PATCH /jobs/:jobId/transport/legs/:legId/location — mechanic GPS heartbeat.
router.patch("/jobs/:jobId/transport/legs/:legId/location", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  const legId = parseInt(String(req.params.legId), 10);
  if (isNaN(jobId) || isNaN(legId)) { res.status(400).json({ error: "Invalid IDs" }); return; }
  const { lat, lng } = req.body as { lat?: number; lng?: number };
  if (typeof lat !== "number" || typeof lng !== "number") {
    res.status(400).json({ error: "lat and lng are required" }); return;
  }
  const [leg] = await db.select().from(vehicleTransportLegsTable).where(eq(vehicleTransportLegsTable.id, legId));
  if (!leg || leg.jobId !== jobId) { res.status(404).json({ error: "Transport leg not found" }); return; }
  if (leg.driverId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (leg.status !== "in_progress") { res.status(409).json({ error: "Leg is not in progress" }); return; }
  const [updated] = await db.update(vehicleTransportLegsTable).set({
    lastLat: lat, lastLng: lng, lastLocationAt: new Date(),
  }).where(eq(vehicleTransportLegsTable.id, legId)).returning();
  res.json(formatLeg(updated));
});

export default router;
