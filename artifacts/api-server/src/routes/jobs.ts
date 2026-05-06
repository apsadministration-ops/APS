import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, jobsTable, vehiclesTable, usersTable, workLogsTable, paymentsTable, messagesTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import { notifyMechanics, notifyCustomerJobAccepted } from "../lib/notifications";

const router: IRouter = Router();

async function formatJob(job: typeof jobsTable.$inferSelect) {
  const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, job.customerId));
  const mechanic = job.mechanicId
    ? (await db.select().from(usersTable).where(eq(usersTable.id, job.mechanicId)))[0] ?? null
    : null;
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
  return {
    id: job.id,
    vehicleId: job.vehicleId,
    vin: job.vin,
    customerId: job.customerId,
    customerName: customer?.name ?? "Unknown",
    mechanicId: job.mechanicId ?? null,
    mechanicName: mechanic?.name ?? null,
    jobType: job.jobType,
    description: job.description,
    locationLat: job.locationLat ?? null,
    locationLng: job.locationLng ?? null,
    locationAddress: job.locationAddress ?? null,
    status: job.status,
    mechanicLat: job.mechanicLat ?? null,
    mechanicLng: job.mechanicLng ?? null,
    mechanicLocationUpdatedAt: job.mechanicLocationUpdatedAt ?? null,
    estimatedPrice: job.estimatedPrice ?? null,
    finalPrice: job.finalPrice ?? null,
    rating: job.rating ?? null,
    ratingNote: job.ratingNote ?? null,
    vehicle: vehicle ? {
      id: vehicle.id, vin: vehicle.vin, make: vehicle.make, model: vehicle.model,
      year: vehicle.year, trim: vehicle.trim ?? null, color: vehicle.color ?? null, createdAt: vehicle.createdAt,
    } : null,
    createdAt: job.createdAt,
    acceptedAt: job.acceptedAt ?? null,
    completedAt: job.completedAt ?? null,
  };
}

router.get("/jobs", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const { status, vehicleId, mechanicId } = req.query as { status?: string; vehicleId?: string; mechanicId?: string };
  let allJobs = await db.select().from(jobsTable).orderBy(jobsTable.createdAt);
  if (req.userRole === "customer") allJobs = allJobs.filter((j) => j.customerId === req.userId);
  else if (req.userRole === "mechanic") allJobs = allJobs.filter((j) => j.mechanicId === req.userId || j.status === "REQUESTED");
  if (status) allJobs = allJobs.filter((j) => j.status === status);
  if (vehicleId) allJobs = allJobs.filter((j) => j.vehicleId === parseInt(vehicleId, 10));
  if (mechanicId) allJobs = allJobs.filter((j) => j.mechanicId === parseInt(mechanicId, 10));
  res.json(await Promise.all(allJobs.map(formatJob)));
});

router.get("/jobs/available", authenticate, async (req: AuthRequest, res): Promise<void> => {
  let jobs = await db.select().from(jobsTable).where(eq(jobsTable.status, "REQUESTED")).orderBy(jobsTable.createdAt);

  // Detailers can only see detailing jobs
  if (req.userRole === "mechanic") {
    const [mechanic] = await db.select({ mechanicTier: usersTable.mechanicTier }).from(usersTable).where(eq(usersTable.id, req.userId!));
    if (mechanic?.mechanicTier === "detailer") {
      jobs = jobs.filter((j) => j.jobType === "detailing");
    }
  }

  res.json(await Promise.all(jobs.map(formatJob)));
});

router.post("/jobs", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "customer" && req.userRole !== "admin") {
    res.status(403).json({ error: "Only customers can create jobs" }); return;
  }
  const { vehicleId, jobType, description, locationLat, locationLng, locationAddress, estimatedPrice } = req.body as {
    vehicleId: number; jobType: string; description: string;
    locationLat?: number; locationLng?: number; locationAddress?: string; estimatedPrice?: number;
  };
  if (!vehicleId || !jobType || !description) {
    res.status(400).json({ error: "vehicleId, jobType, and description are required" }); return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) { res.status(404).json({ error: "Vehicle not found" }); return; }

  const [job] = await db.insert(jobsTable).values({
    vehicleId, vin: vehicle.vin, customerId: req.userId!,
    jobType: jobType as "repair" | "diagnostic" | "maintenance" | "detailing",
    description, locationLat: locationLat ?? null, locationLng: locationLng ?? null,
    locationAddress: locationAddress ?? null, estimatedPrice: estimatedPrice ?? null, status: "REQUESTED",
  }).returning();

  // Notify all active mechanics with push tokens (fire-and-forget)
  db.select({ pushToken: usersTable.pushToken })
    .from(usersTable)
    .where(eq(usersTable.role, "mechanic"))
    .then((mechanics) => {
      const tokens = mechanics.map((m) => m.pushToken).filter(Boolean) as string[];
      notifyMechanics(tokens, jobType, description, job.id).catch(() => {});
    })
    .catch(() => {});

  res.status(201).json(await formatJob(job));
});

router.get("/jobs/:jobId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json(await formatJob(job));
});

router.patch("/jobs/:jobId/status", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const { status, estimatedPrice } = req.body as { status: string; estimatedPrice?: number };
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const updates: Partial<typeof jobsTable.$inferInsert> = { status: status as typeof job.status };
  if (estimatedPrice !== undefined) updates.estimatedPrice = estimatedPrice;
  if (status === "COMPLETED") updates.completedAt = new Date();
  if (status === "ACCEPTED") updates.acceptedAt = new Date();
  const [updated] = await db.update(jobsTable).set(updates).where(eq(jobsTable.id, jobId)).returning();
  res.json(await formatJob(updated));
});

router.post("/jobs/:jobId/accept", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "mechanic") { res.status(403).json({ error: "Only mechanics can accept jobs" }); return; }
  const jobId = parseInt(String(req.params.jobId), 10);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "REQUESTED" && job.status !== "OFFERED") {
    res.status(400).json({ error: "Job cannot be accepted in its current state" }); return;
  }
  const [updated] = await db.update(jobsTable)
    .set({ status: "ACCEPTED", mechanicId: req.userId!, acceptedAt: new Date() })
    .where(eq(jobsTable.id, jobId)).returning();

  // Notify customer their job was accepted (fire-and-forget)
  const [mechanic] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  const [customer] = await db.select().from(usersTable).where(eq(usersTable.id, job.customerId));
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
  if (customer?.pushToken && mechanic && vehicle) {
    notifyCustomerJobAccepted(
      customer.pushToken,
      mechanic.name,
      `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      jobId,
    ).catch(() => {});
  }

  res.json(await formatJob(updated));
});

router.post("/jobs/:jobId/cancel", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (req.userRole === "customer" && job.customerId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!["REQUESTED", "OFFERED"].includes(job.status) && req.userRole !== "admin") {
    res.status(400).json({ error: "Job cannot be cancelled after it has been accepted" }); return;
  }
  const [updated] = await db.update(jobsTable).set({ status: "CANCELLED" }).where(eq(jobsTable.id, jobId)).returning();
  res.json(await formatJob(updated));
});

// Mechanic updates their live GPS location for a job
router.put("/jobs/:jobId/mechanic-location", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "mechanic") { res.status(403).json({ error: "Only mechanics can update location" }); return; }
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const { lat, lng } = req.body as { lat: number; lng: number };
  if (typeof lat !== "number" || typeof lng !== "number") {
    res.status(400).json({ error: "lat and lng are required numbers" }); return;
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.mechanicId !== req.userId) { res.status(403).json({ error: "You are not assigned to this job" }); return; }
  await db.update(jobsTable)
    .set({ mechanicLat: lat, mechanicLng: lng, mechanicLocationUpdatedAt: new Date() })
    .where(eq(jobsTable.id, jobId));
  res.json({ ok: true });
});

// Admin can permanently delete a job and all related rows (work logs, payments, messages)
router.delete("/jobs/:jobId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "admin") {
    res.status(403).json({ error: "Only admins can delete jobs" }); return;
  }
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  await db.transaction(async (tx) => {
    await tx.delete(messagesTable).where(eq(messagesTable.jobId, jobId));
    await tx.delete(paymentsTable).where(eq(paymentsTable.jobId, jobId));
    await tx.delete(workLogsTable).where(eq(workLogsTable.jobId, jobId));
    await tx.delete(jobsTable).where(eq(jobsTable.id, jobId));
  });
  res.json({ ok: true });
});

router.post("/jobs/:jobId/rate", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "customer") { res.status(403).json({ error: "Only customers can rate jobs" }); return; }
  const jobId = parseInt(String(req.params.jobId), 10);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.customerId !== req.userId) { res.status(403).json({ error: "Forbidden" }); return; }
  if (job.status !== "COMPLETED" && job.status !== "PAID") {
    res.status(400).json({ error: "Job must be completed before rating" }); return;
  }
  const { rating, note } = req.body as { rating: number; note?: string };
  if (!rating || rating < 1 || rating > 5) { res.status(400).json({ error: "Rating must be between 1 and 5" }); return; }
  const [updated] = await db.update(jobsTable).set({ rating, ratingNote: note ?? null }).where(eq(jobsTable.id, jobId)).returning();
  res.json(await formatJob(updated));
});

export default router;
