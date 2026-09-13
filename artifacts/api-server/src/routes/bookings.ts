import { Router, type IRouter, type Response } from "express";
import { eq, and, lt, gt, sql, inArray, desc } from "drizzle-orm";
import { db, bayBookingsTable, baysTable, shopsTable, jobsTable, usersTable, vehiclesTable, partnerOrganizationsTable } from "@workspace/db";
import { CreateBayBookingBody } from "@workspace/api-zod";
import { authenticate, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";
import { parsePositiveSafeInteger } from "../lib/validation";
import { formatBayAvailabilityConfig, isBayIntervalAvailable } from "../lib/bayAvailability";
import { canCancelBooking } from "../lib/authorization";

const router: IRouter = Router();

const TIER_RANK: Record<string, number> = { detailer: 0, technician: 1, senior: 2, advanced: 3, master: 4 };
const LIVE_BOOKING_STATUSES = ["pending", "reserved", "active"] as const;

function formatBookingBase(
  b: typeof bayBookingsTable.$inferSelect,
  canonicalShopId = b.shopId,
) {
  return {
    id: b.id, bayId: b.bayId, jobId: b.jobId, mechanicId: b.mechanicId, shopId: canonicalShopId,
    startTime: b.startTime, estimatedEndTime: b.estimatedEndTime,
    actualStartTime: b.actualStartTime ?? null, actualEndTime: b.actualEndTime ?? null,
    hourlyRateSnapshot: b.hourlyRateSnapshot, estimatedHours: b.estimatedHours,
    totalCost: b.totalCost ?? null,
    status: b.status, cancellationReason: b.cancellationReason ?? null,
    createdAt: b.createdAt,
  };
}

/**
 * Booking links are always derived from the bay -> shop -> organization and
 * job -> vehicle relationships. The denormalized booking.shopId/mechanicId
 * columns remain legacy storage fields, but are never trusted to construct
 * the mechanic-facing context.
 */
async function formatBooking(booking: typeof bayBookingsTable.$inferSelect) {
  const [row] = await db.select({
    bay: baysTable,
    shop: shopsTable,
    job: jobsTable,
    vehicle: vehiclesTable,
    organization: partnerOrganizationsTable,
  })
    .from(bayBookingsTable)
    .innerJoin(baysTable, eq(bayBookingsTable.bayId, baysTable.id))
    .innerJoin(shopsTable, eq(baysTable.shopId, shopsTable.id))
    .innerJoin(jobsTable, eq(bayBookingsTable.jobId, jobsTable.id))
    .innerJoin(vehiclesTable, eq(jobsTable.vehicleId, vehiclesTable.id))
    .leftJoin(partnerOrganizationsTable, eq(shopsTable.organizationId, partnerOrganizationsTable.id))
    .where(eq(bayBookingsTable.id, booking.id));

  const canonicalShopId = row?.shop.id ?? booking.shopId;
  const base = formatBookingBase(booking, canonicalShopId);
  if (!row) return base;

  return {
    ...base,
    job: {
      id: row.job.id,
      status: row.job.status,
      vehicleId: row.job.vehicleId,
      mechanicId: row.job.mechanicId,
      customerId: row.job.customerId,
      jobType: row.job.jobType,
      requiresGhostGarage: row.job.requiresGhostGarage,
      customerTransportApproved: row.job.customerTransportApproved,
      postedByShopId: row.job.postedByShopId ?? null,
      partnerKindSnapshot: row.job.partnerKindSnapshot ?? null,
    },
    vehicle: {
      id: row.vehicle.id,
      vin: row.vehicle.vin,
      make: row.vehicle.make,
      model: row.vehicle.model,
      year: row.vehicle.year,
      trim: row.vehicle.trim ?? null,
      color: row.vehicle.color ?? null,
    },
    bay: {
      id: row.bay.id,
      shopId: row.bay.shopId,
      name: row.bay.name,
      hourlyRate: row.bay.hourlyRate,
      equipment: (row.bay.equipment as string[]) ?? [],
      allowedJobCategories: (row.bay.allowedJobCategories as string[]) ?? [],
      minMechanicTier: row.bay.minMechanicTier,
      autoApprove: row.bay.autoApprove,
      availabilityConfig: formatBayAvailabilityConfig(row.bay.availabilityConfig),
      status: row.bay.status,
    },
    // `location` is the canonical name for a physical shop in the Partner
    // layer. Keep `shop` as a compatibility alias for existing consumers.
    location: {
      id: row.shop.id,
      ownerId: row.shop.ownerId,
      organizationId: row.shop.organizationId ?? null,
      name: row.shop.name,
      address: row.shop.address,
      city: row.shop.city,
      region: row.shop.region,
      zipCode: row.shop.zipCode,
      status: row.shop.status,
    },
    organization: row.organization
      ? {
        id: row.organization.id,
        name: row.organization.name,
        subtype: row.organization.subtype,
        status: row.organization.status,
      }
      : null,
    shop: {
      id: row.shop.id,
      name: row.shop.name,
      organizationId: row.shop.organizationId ?? null,
      status: row.shop.status,
    },
  };
}

router.post("/bays/:bayId/bookings", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const bayId = parsePositiveSafeInteger(req.params.bayId);
  if (bayId === null) { res.status(400).json({ error: "Invalid bay ID" }); return; }
  const parsed = CreateBayBookingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const v = parsed.data;
  const jobId = parsePositiveSafeInteger(v.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const [bay] = await db.select().from(baysTable).where(eq(baysTable.id, bayId));
  if (!bay) { res.status(404).json({ error: "Bay not found" }); return; }
  if (bay.status !== "active") { res.status(400).json({ error: "Bay is not active" }); return; }
  const [shop] = await db.select().from(shopsTable).where(eq(shopsTable.id, bay.shopId));
  if (!shop) { res.status(404).json({ error: "Shop not found" }); return; }
  if (shop.status !== "active") { res.status(400).json({ error: "Shop is not active" }); return; }

  // Ordinary customer jobs and commercial jobs follow the same assigned
  // mechanic gate. Posting a job through a partner does not grant the shop
  // owner booking or dispatch authority.
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
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
  const end = new Date(start.getTime() + v.estimatedHours * 3_600_000);
  if (!Number.isFinite(start.getTime()) || start.getTime() <= 0 || !Number.isFinite(v.estimatedHours)
    || v.estimatedHours <= 0 || v.estimatedHours > 24 || !Number.isFinite(end.getTime())) {
    res.status(400).json({ error: "startTime must be a valid timestamp and estimatedHours must be between 0 and 24" }); return;
  }
  if (!isBayIntervalAvailable(bay.availabilityConfig, start, end)) {
    res.status(400).json({ error: "The requested interval is outside this bay's availability" }); return;
  }

  // For ghost-garage jobs, the customer must have approved transport before
  // the mechanic can finalize a bay. (For non-ghost jobs we keep this open;
  // a mechanic might reserve a bay for a regular repair too.)
  if (job.requiresGhostGarage && !job.customerTransportApproved) {
    res.status(409).json({ error: "Customer has not yet approved transport to a shop bay." }); return;
  }

  // Pending requests do not reserve a slot. Auto-approved requests are
  // inserted as reserved and check active/reserved overlaps under the bay row
  // lock so concurrent approvals cannot double-book the same interval.
  try {
    const booking = await db.transaction(async (tx) => {
      // Lock the job first, then the bay/shop. This ordering is shared with
      // approval so concurrent requests for one job cannot create a second
      // live booking while terminal history is retained.
      const lockedJob = await tx.execute(sql`
        SELECT id FROM jobs WHERE id = ${jobId} FOR UPDATE
      `);
      if (lockedJob.rows.length === 0) throw new Error("JOB_NOT_FOUND");
      const lockedFacility = await tx.execute(sql`
        SELECT b.id AS bay_id, b.shop_id AS shop_id,
               b.auto_approve AS auto_approve,
               b.hourly_rate AS hourly_rate,
               b.availability_config AS availability_config
        FROM bays b
        INNER JOIN shops s ON s.id = b.shop_id
        WHERE b.id = ${bayId}
          AND b.status = 'active'
          AND s.status = 'active'
        FOR UPDATE OF b, s
      `);
      if (lockedFacility.rows.length === 0) {
        throw new Error("FACILITY_INACTIVE");
      }
      const lockedRow = lockedFacility.rows[0] as {
        shop_id: number | string;
        auto_approve: boolean;
        hourly_rate: number | string;
        availability_config: unknown;
      };
      const lockedShopId = Number(lockedRow.shop_id);
      if (!isBayIntervalAvailable(lockedRow.availability_config, start, end)) {
        throw new Error("OUTSIDE_AVAILABILITY");
      }
      const [existingForJob] = await tx.select({ id: bayBookingsTable.id })
        .from(bayBookingsTable)
        .where(and(
          eq(bayBookingsTable.jobId, jobId),
          inArray(bayBookingsTable.status, LIVE_BOOKING_STATUSES),
        ))
        .limit(1);
      if (existingForJob) throw new Error("JOB_BOOKING_EXISTS");

      const status = lockedRow.auto_approve ? "reserved" : "pending";
      if (status === "reserved") {
        const conflicts = await tx.select({ id: bayBookingsTable.id })
          .from(bayBookingsTable)
          .where(and(
            eq(bayBookingsTable.bayId, bayId),
            inArray(bayBookingsTable.status, ["reserved", "active"]),
            lt(bayBookingsTable.startTime, end),
            gt(bayBookingsTable.estimatedEndTime, start),
          ));
        if (conflicts.length > 0) throw new Error("BOOKING_CONFLICT");
      }
      const [created] = await tx.insert(bayBookingsTable).values({
        bayId, jobId, mechanicId: req.userId!, shopId: lockedShopId,
        startTime: start, estimatedEndTime: end,
        hourlyRateSnapshot: Number(lockedRow.hourly_rate), estimatedHours: v.estimatedHours,
        status,
      }).returning();
      return created;
    });
    res.status(201).json(await formatBooking(booking));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "BOOKING_CONFLICT") {
      res.status(409).json({ error: "That time slot conflicts with another booking" }); return;
    }
    if (msg === "FACILITY_INACTIVE") {
      res.status(400).json({ error: "The shop and bay must be active to reserve a booking" }); return;
    }
    if (msg === "OUTSIDE_AVAILABILITY") {
      res.status(400).json({ error: "The requested interval is outside this bay's availability" }); return;
    }
    if (msg === "JOB_NOT_FOUND") {
      res.status(404).json({ error: "Job not found" }); return;
    }
    if (msg === "JOB_BOOKING_EXISTS" || msg.includes("bay_bookings_job_id_")) {
      res.status(409).json({ error: "This job already has a live bay booking." }); return;
    }
    throw err;
  }
});

router.get("/bookings/mine", authenticate, async (req: AuthRequest, res): Promise<void> => {
  let rows: (typeof bayBookingsTable.$inferSelect)[] = [];
  if (req.userRole === "mechanic") {
    // Keep the current confirmed booking ahead of terminal history for
    // existing clients that choose the first usable row for a job.
    rows = await db.select().from(bayBookingsTable)
      .where(eq(bayBookingsTable.mechanicId, req.userId!))
      .orderBy(
        sql`CASE WHEN ${bayBookingsTable.status} IN ('reserved', 'active') THEN 0 ELSE 1 END`,
        desc(bayBookingsTable.createdAt),
        desc(bayBookingsTable.id),
      );
  } else if (req.userRole === "shop_owner") {
    // Shop owner sees bookings on any of their shops.
    // Resolve ownership through the bay relationship rather than trusting the
    // denormalized booking.shopId column. This keeps a legacy/malformed row
    // from exposing or authorizing a booking for another owner's bay.
    const ownedBookings = await db.select({ booking: bayBookingsTable })
      .from(bayBookingsTable)
      .innerJoin(baysTable, eq(bayBookingsTable.bayId, baysTable.id))
      .innerJoin(shopsTable, eq(baysTable.shopId, shopsTable.id))
      .where(eq(shopsTable.ownerId, req.userId!));
    rows = ownedBookings.map(({ booking }) => booking);
  } else if (req.userRole === "admin") {
    rows = await db.select().from(bayBookingsTable);
  } else {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(await Promise.all(rows.map((booking) => formatBooking(booking))));
});

// A detail read uses the same derived relationship context as the mechanic
// list. It never authorizes from the denormalized shopId field.
router.get("/bookings/:bookingId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const bookingId = parsePositiveSafeInteger(req.params.bookingId);
  if (bookingId === null) { res.status(400).json({ error: "Invalid booking ID" }); return; }
  const [booking] = await db.select().from(bayBookingsTable).where(eq(bayBookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  const [ownership] = await db.select({ ownerId: shopsTable.ownerId })
    .from(baysTable)
    .innerJoin(shopsTable, eq(baysTable.shopId, shopsTable.id))
    .where(eq(baysTable.id, booking.bayId));
  const allowed = req.userRole === "admin"
    || (req.userRole === "mechanic" && booking.mechanicId === req.userId)
    || (req.userRole === "shop_owner" && ownership?.ownerId === req.userId);
  if (!allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  res.json(await formatBooking(booking));
});

router.patch("/bookings/:bookingId/start", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const bookingId = parsePositiveSafeInteger(req.params.bookingId);
  if (bookingId === null) { res.status(400).json({ error: "Invalid booking ID" }); return; }
  const [b] = await db.select().from(bayBookingsTable).where(eq(bayBookingsTable.id, bookingId));
  if (!b) { res.status(404).json({ error: "Booking not found" }); return; }
  if (b.mechanicId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (b.status !== "reserved") {
    res.status(400).json({ error: `Cannot start a booking in status ${b.status}` }); return;
  }
  const [startJob] = await db.select({
    requiresGhostGarage: jobsTable.requiresGhostGarage,
    customerTransportApproved: jobsTable.customerTransportApproved,
  }).from(jobsTable).where(eq(jobsTable.id, b.jobId));
  if (startJob?.requiresGhostGarage && !startJob.customerTransportApproved) {
    res.status(409).json({ error: "Customer has not yet approved transport to a shop bay." }); return;
  }
  const [updated] = await db.update(bayBookingsTable)
    .set({ status: "active", actualStartTime: new Date() })
    .where(eq(bayBookingsTable.id, bookingId)).returning();
  res.json(await formatBooking(updated));
});

router.patch("/bookings/:bookingId/complete", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const bookingId = parsePositiveSafeInteger(req.params.bookingId);
  if (bookingId === null) { res.status(400).json({ error: "Invalid booking ID" }); return; }
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
  res.json(await formatBooking(updated));
});

async function handleBookingApproval(
  req: AuthRequest,
  res: Response,
  decision: "approve" | "reject",
): Promise<void> {
  const bookingId = parsePositiveSafeInteger(req.params.bookingId);
  if (bookingId === null) { res.status(400).json({ error: "Invalid booking ID" }); return; }
  const reasonValue = (req.body as { reason?: unknown } | undefined)?.reason;
  if (reasonValue !== undefined && (typeof reasonValue !== "string" || reasonValue.length > 500)) {
    res.status(400).json({ error: "reason must be a string of at most 500 characters" }); return;
  }

  try {
    const updated = await db.transaction(async (tx) => {
      // Lock job first, then bay/shop, then the booking row. Creation uses
      // the same job -> bay ordering, so a retry after cancellation cannot
      // race an approval while terminal history is retained.
      const [bookingRef] = await tx.select({
        jobId: bayBookingsTable.jobId,
        bayId: bayBookingsTable.bayId,
      }).from(bayBookingsTable).where(eq(bayBookingsTable.id, bookingId)).limit(1);
      if (!bookingRef) throw new Error("BOOKING_NOT_FOUND");
      const lockedJob = await tx.execute(sql`
        SELECT id FROM jobs WHERE id = ${bookingRef.jobId} FOR UPDATE
      `);
      if (lockedJob.rows.length === 0) throw new Error("BOOKING_NOT_FOUND");
      const lockedFacility = await tx.execute(sql`
        SELECT b.id, s.id AS shop_id
        FROM bays b
        INNER JOIN shops s ON s.id = b.shop_id
        WHERE b.id = ${bookingRef.bayId}
        FOR UPDATE OF b, s
      `);
      if (lockedFacility.rows.length === 0) throw new Error("BOOKING_NOT_FOUND");
      await tx.execute(sql`
        SELECT id FROM bay_bookings WHERE id = ${bookingId} FOR UPDATE
      `);
      const locked = await tx.execute(sql`
        SELECT bb.id, bb.bay_id, bb.job_id, bb.mechanic_id, bb.start_time,
               bb.estimated_end_time, bb.status AS booking_status,
               b.shop_id, b.hourly_rate, b.availability_config,
               b.status AS bay_status, s.owner_id, s.status AS shop_status,
               j.requires_ghost_garage, j.customer_transport_approved
        FROM bay_bookings bb
        INNER JOIN bays b ON b.id = bb.bay_id
        INNER JOIN shops s ON s.id = b.shop_id
        INNER JOIN jobs j ON j.id = bb.job_id
        WHERE bb.id = ${bookingId}
      `);
      if (locked.rows.length === 0) throw new Error("BOOKING_NOT_FOUND");
      const row = locked.rows[0] as {
        id: number | string;
        bay_id: number | string;
        job_id: number | string;
        mechanic_id: number | string;
        start_time: Date | string;
        estimated_end_time: Date | string;
        booking_status: string;
        shop_id: number | string;
        hourly_rate: number | string;
        availability_config: unknown;
        bay_status: string;
        owner_id: number | string;
        shop_status: string;
        requires_ghost_garage: boolean;
        customer_transport_approved: boolean;
      };
      if (
        req.userRole !== "admin" &&
        (req.userRole !== "shop_owner" || req.user?.status !== "active" || Number(row.owner_id) !== req.userId)
      ) {
        throw new Error("FORBIDDEN");
      }
      if (row.booking_status !== "pending") throw new Error("NOT_PENDING");
      if (decision === "reject") {
        const [rejected] = await tx.update(bayBookingsTable)
          .set({ status: "rejected", cancellationReason: typeof reasonValue === "string" ? reasonValue : null })
          .where(eq(bayBookingsTable.id, bookingId))
          .returning();
        return rejected;
      }
      if (row.bay_status !== "active" || row.shop_status !== "active") throw new Error("FACILITY_INACTIVE");
      if (row.requires_ghost_garage && !row.customer_transport_approved) {
        throw new Error("TRANSPORT_NOT_APPROVED");
      }
      const start = new Date(row.start_time);
      const end = new Date(row.estimated_end_time);
      if (!isBayIntervalAvailable(row.availability_config, start, end)) throw new Error("OUTSIDE_AVAILABILITY");
      const conflicts = await tx.select({ id: bayBookingsTable.id })
        .from(bayBookingsTable)
        .where(and(
          eq(bayBookingsTable.bayId, Number(row.bay_id)),
          inArray(bayBookingsTable.status, ["reserved", "active"]),
          lt(bayBookingsTable.startTime, end),
          gt(bayBookingsTable.estimatedEndTime, start),
        ));
      if (conflicts.length > 0) throw new Error("BOOKING_CONFLICT");
      const [approved] = await tx.update(bayBookingsTable)
        .set({ status: "reserved", cancellationReason: null })
        .where(eq(bayBookingsTable.id, bookingId))
        .returning();
      return approved;
    });
    res.json(await formatBooking(updated));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "BOOKING_NOT_FOUND") { res.status(404).json({ error: "Booking not found" }); return; }
    if (message === "FORBIDDEN") { res.status(403).json({ error: "Only the owning shop owner can approve this booking" }); return; }
    if (message === "NOT_PENDING") { res.status(409).json({ error: "Only pending bookings can be approved or rejected" }); return; }
    if (message === "BOOKING_CONFLICT") { res.status(409).json({ error: "That time slot conflicts with another approved booking" }); return; }
    if (message === "FACILITY_INACTIVE") { res.status(400).json({ error: "The shop and bay must be active to approve a booking" }); return; }
    if (message === "OUTSIDE_AVAILABILITY") { res.status(400).json({ error: "The requested interval is outside this bay's availability" }); return; }
    if (message === "TRANSPORT_NOT_APPROVED") {
      res.status(409).json({ error: "Customer has not yet approved transport to a shop bay." }); return;
    }
    throw error;
  }
}

router.patch("/bookings/:bookingId/approve", authenticate, (req, res) => handleBookingApproval(req as AuthRequest, res, "approve"));
// POST aliases the PATCH action for clients that model approval as a command.
router.post("/bookings/:bookingId/approve", authenticate, (req, res) => handleBookingApproval(req as AuthRequest, res, "approve"));
router.patch("/bookings/:bookingId/reject", authenticate, (req, res) => handleBookingApproval(req as AuthRequest, res, "reject"));
router.post("/bookings/:bookingId/reject", authenticate, (req, res) => handleBookingApproval(req as AuthRequest, res, "reject"));

router.patch("/bookings/:bookingId/cancel", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const bookingId = parsePositiveSafeInteger(req.params.bookingId);
  if (bookingId === null) { res.status(400).json({ error: "Invalid booking ID" }); return; }
  const [b] = await db.select().from(bayBookingsTable).where(eq(bayBookingsTable.id, bookingId));
  if (!b) { res.status(404).json({ error: "Booking not found" }); return; }

  // Mechanic on the booking, or the active shop owner of the bay's shop, may
  // cancel. Resolve ownership through the bay relationship rather than the
  // denormalized booking.shopId column.
  let shopOwnerId: number | null = null;
  if (req.userRole === "shop_owner") {
    const [shop] = await db.select({ ownerId: shopsTable.ownerId })
      .from(baysTable)
      .innerJoin(shopsTable, eq(baysTable.shopId, shopsTable.id))
      .where(eq(baysTable.id, b.bayId));
    shopOwnerId = shop?.ownerId ?? null;
  }
  if (!canCancelBooking({
    role: req.userRole,
    status: req.user?.status,
    userId: req.userId,
    mechanicId: b.mechanicId,
    shopOwnerId,
  })) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  if (["completed", "cancelled"].includes(b.status)) {
    res.status(400).json({ error: `Cannot cancel a booking in status ${b.status}` }); return;
  }
  const reason = (req.body as { reason?: unknown } | undefined)?.reason;
  if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
    res.status(400).json({ error: "reason must be a string of at most 500 characters" }); return;
  }
  const [updated] = await db.update(bayBookingsTable)
    .set({ status: "cancelled", cancellationReason: typeof reason === "string" ? reason : null })
    .where(eq(bayBookingsTable.id, bookingId)).returning();
  res.json(await formatBooking(updated));
});

export default router;
