import { Router, type IRouter } from "express";
import { eq, and, lt, gt, sql, inArray } from "drizzle-orm";
import { db, bayBookingsTable, baysTable, shopsTable, jobsTable, usersTable } from "@workspace/db";
import { CreateBayBookingBody } from "@workspace/api-zod";
import { authenticate, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

const TIER_RANK: Record<string, number> = { detailer: 0, technician: 1, senior: 2, master: 3 };

function formatBooking(b: typeof bayBookingsTable.$inferSelect) {
  return {
    id: b.id, bayId: b.bayId, jobId: b.jobId, mechanicId: b.mechanicId, shopId: b.shopId,
    startTime: b.startTime, estimatedEndTime: b.estimatedEndTime,
    actualStartTime: b.actualStartTime ?? null, actualEndTime: b.actualEndTime ?? null,
    hourlyRateSnapshot: b.hourlyRateSnapshot, estimatedHours: b.estimatedHours,
    totalCost: b.totalCost ?? null,
    status: b.status, cancellationReason: b.cancellationReason ?? null,
    createdAt: b.createdAt,
  };
}

router.post("/bays/:bayId/bookings", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const bayId = parseInt(String(req.params.bayId), 10);
  if (isNaN(bayId)) { res.status(400).json({ error: "Invalid bay ID" }); return; }
  const parsed = CreateBayBookingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const v = parsed.data;

  const [bay] = await db.select().from(baysTable).where(eq(baysTable.id, bayId));
  if (!bay) { res.status(404).json({ error: "Bay not found" }); return; }
  if (bay.status !== "active") { res.status(400).json({ error: "Bay is not active" }); return; }

  // Verify the mechanic owns the job they're booking the bay for, AND that
  // the job is in a state where bay work makes sense (ACCEPTED or earlier
  // in-progress states). This prevents bookings for jobs that are completed
  // or assigned to someone else.
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, v.jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.mechanicId !== req.userId) { res.status(403).json({ error: "You are not assigned to this job" }); return; }
  if (!["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"].includes(job.status)) {
    res.status(400).json({ error: `Cannot book a bay for a job in status ${job.status}` }); return;
  }

  // Tier check — same logic as the search filter, enforced server-side.
  const [me] = await db.select({ mechanicTier: usersTable.mechanicTier }).from(usersTable).where(eq(usersTable.id, req.userId!));
  const myTierRank = me?.mechanicTier ? TIER_RANK[me.mechanicTier] ?? 0 : 0;
  const bayMinRank = TIER_RANK[bay.minMechanicTier] ?? 0;
  if (bayMinRank > myTierRank) {
    res.status(403).json({ error: `Bay requires ${bay.minMechanicTier} tier or higher` }); return;
  }

  // Job-category check.
  const cats = (bay.allowedJobCategories as string[]) ?? [];
  if (cats.length > 0 && !cats.includes(job.jobType)) {
    res.status(400).json({ error: `This bay does not accept ${job.jobType} jobs` }); return;
  }

  const start = new Date(v.startTime);
  const end = new Date(start.getTime() + v.estimatedHours * 3600 * 1000);
  if (!(start.getTime() > 0) || isNaN(start.getTime())) {
    res.status(400).json({ error: "Invalid startTime" }); return;
  }

  // For ghost-garage jobs, the customer must have approved transport before
  // the mechanic can finalize a bay. (For non-ghost jobs we keep this open;
  // a mechanic might reserve a bay for a regular repair too.)
  if (job.requiresGhostGarage && !job.customerTransportApproved) {
    res.status(409).json({ error: "Customer has not yet approved transport to a shop bay." }); return;
  }

  // Time-slot conflict check + insert wrapped in a transaction with a row
  // lock on the bay, which acts as a per-bay mutex. Without this lock two
  // concurrent requests could both pass the SELECT, both INSERT, and end
  // up double-booking the bay (TOCTOU race).
  try {
    const booking = await db.transaction(async (tx) => {
      // SELECT … FOR UPDATE serializes concurrent booking attempts against
      // the same bay. Other bays remain unaffected.
      await tx.execute(sql`SELECT id FROM bays WHERE id = ${bayId} FOR UPDATE`);
      const conflicts = await tx.select({ id: bayBookingsTable.id })
        .from(bayBookingsTable)
        .where(and(
          eq(bayBookingsTable.bayId, bayId),
          inArray(bayBookingsTable.status, ["reserved", "active"]),
          lt(bayBookingsTable.startTime, end),
          gt(bayBookingsTable.estimatedEndTime, start),
        ));
      if (conflicts.length > 0) {
        throw new Error("BOOKING_CONFLICT");
      }
      const [created] = await tx.insert(bayBookingsTable).values({
        bayId, jobId: v.jobId, mechanicId: req.userId!, shopId: bay.shopId,
        startTime: start, estimatedEndTime: end,
        hourlyRateSnapshot: bay.hourlyRate, estimatedHours: v.estimatedHours,
        status: "reserved",
      }).returning();
      return created;
    });
    res.status(201).json(formatBooking(booking));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "BOOKING_CONFLICT") {
      res.status(409).json({ error: "That time slot conflicts with another booking" }); return;
    }
    if (msg.includes("bay_bookings_job_id_unique")) {
      res.status(409).json({ error: "This job already has a bay booking." }); return;
    }
    throw err;
  }
});

router.get("/bookings/mine", authenticate, async (req: AuthRequest, res): Promise<void> => {
  let rows: (typeof bayBookingsTable.$inferSelect)[] = [];
  if (req.userRole === "mechanic") {
    rows = await db.select().from(bayBookingsTable).where(eq(bayBookingsTable.mechanicId, req.userId!));
  } else if (req.userRole === "shop_owner") {
    // Shop owner sees bookings on any of their shops.
    const shops = await db.select({ id: shopsTable.id }).from(shopsTable).where(eq(shopsTable.ownerId, req.userId!));
    if (shops.length === 0) { res.json([]); return; }
    rows = await db.select().from(bayBookingsTable)
      .where(inArray(bayBookingsTable.shopId, shops.map((s) => s.id)));
  } else if (req.userRole === "admin") {
    rows = await db.select().from(bayBookingsTable);
  } else {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(rows.map(formatBooking));
});

router.patch("/bookings/:bookingId/start", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const bookingId = parseInt(String(req.params.bookingId), 10);
  const [b] = await db.select().from(bayBookingsTable).where(eq(bayBookingsTable.id, bookingId));
  if (!b) { res.status(404).json({ error: "Booking not found" }); return; }
  if (b.mechanicId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (b.status !== "reserved") {
    res.status(400).json({ error: `Cannot start a booking in status ${b.status}` }); return;
  }
  const [updated] = await db.update(bayBookingsTable)
    .set({ status: "active", actualStartTime: new Date() })
    .where(eq(bayBookingsTable.id, bookingId)).returning();
  res.json(formatBooking(updated));
});

router.patch("/bookings/:bookingId/complete", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const bookingId = parseInt(String(req.params.bookingId), 10);
  const [b] = await db.select().from(bayBookingsTable).where(eq(bayBookingsTable.id, bookingId));
  if (!b) { res.status(404).json({ error: "Booking not found" }); return; }
  if (b.mechanicId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (b.status !== "active") {
    res.status(400).json({ error: `Cannot complete a booking in status ${b.status}` }); return;
  }
  const now = new Date();
  // Bill from actualStart -> now, but never less than 1 hour. Snapshot rate
  // protects us from any rate change on the bay between booking and completion.
  const startMs = b.actualStartTime?.getTime() ?? b.startTime.getTime();
  const elapsedHours = Math.max(1, (now.getTime() - startMs) / 3_600_000);
  const totalCost = Math.round(elapsedHours * b.hourlyRateSnapshot * 100) / 100;
  const [updated] = await db.update(bayBookingsTable)
    .set({ status: "completed", actualEndTime: now, totalCost })
    .where(eq(bayBookingsTable.id, bookingId)).returning();
  res.json(formatBooking(updated));
});

router.patch("/bookings/:bookingId/cancel", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const bookingId = parseInt(String(req.params.bookingId), 10);
  const [b] = await db.select().from(bayBookingsTable).where(eq(bayBookingsTable.id, bookingId));
  if (!b) { res.status(404).json({ error: "Booking not found" }); return; }

  // Mechanic on the booking, or the shop owner of the bay's shop, may cancel.
  let allowed = req.userRole === "admin";
  if (!allowed && req.userRole === "mechanic" && b.mechanicId === req.userId) allowed = true;
  if (!allowed && req.userRole === "shop_owner") {
    const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, b.shopId));
    if (shop?.ownerId === req.userId) allowed = true;
  }
  if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  if (["completed", "cancelled"].includes(b.status)) {
    res.status(400).json({ error: `Cannot cancel a booking in status ${b.status}` }); return;
  }
  const { reason } = (req.body as { reason?: string } | undefined) ?? {};
  const [updated] = await db.update(bayBookingsTable)
    .set({ status: "cancelled", cancellationReason: reason ?? null })
    .where(eq(bayBookingsTable.id, bookingId)).returning();
  res.json(formatBooking(updated));
});

export default router;
