import { Router, type IRouter } from "express";
import { eq, and, isNull, or } from "drizzle-orm";
import { db, jobsTable, vehiclesTable, usersTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

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
    estimatedPrice: job.estimatedPrice ?? null,
    finalPrice: job.finalPrice ?? null,
    rating: job.rating ?? null,
    ratingNote: job.ratingNote ?? null,
    vehicle: vehicle
      ? {
          id: vehicle.id,
          vin: vehicle.vin,
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year,
          trim: vehicle.trim ?? null,
          color: vehicle.color ?? null,
          createdAt: vehicle.createdAt,
        }
      : null,
    createdAt: job.createdAt,
    acceptedAt: job.acceptedAt ?? null,
    completedAt: job.completedAt ?? null,
  };
}

router.get("/jobs", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const { status, vehicleId, mechanicId } = req.query as {
    status?: string;
    vehicleId?: string;
    mechanicId?: string;
  };

  let allJobs = await db.select().from(jobsTable).orderBy(jobsTable.createdAt);

  // Role-based filtering
  if (req.userRole === "customer") {
    allJobs = allJobs.filter((j) => j.customerId === req.userId);
  } else if (req.userRole === "mechanic") {
    allJobs = allJobs.filter((j) => j.mechanicId === req.userId || j.status === "REQUESTED");
  }

  if (status) allJobs = allJobs.filter((j) => j.status === status);
  if (vehicleId) allJobs = allJobs.filter((j) => j.vehicleId === parseInt(vehicleId, 10));
  if (mechanicId) allJobs = allJobs.filter((j) => j.mechanicId === parseInt(mechanicId, 10));

  const result = await Promise.all(allJobs.map(formatJob));
  res.json(result);
});

router.get("/jobs/available", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobs = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.status, "REQUESTED"))
    .orderBy(jobsTable.createdAt);

  const result = await Promise.all(jobs.map(formatJob));
  res.json(result);
});

router.post("/jobs", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "customer" && req.userRole !== "admin") {
    res.status(403).json({ error: "Only customers can create jobs" });
    return;
  }

  const { vehicleId, jobType, description, locationLat, locationLng, locationAddress, estimatedPrice } = req.body as {
    vehicleId: number;
    jobType: string;
    description: string;
    locationLat?: number;
    locationLng?: number;
    locationAddress?: string;
    estimatedPrice?: number;
  };

  if (!vehicleId || !jobType || !description) {
    res.status(400).json({ error: "vehicleId, jobType, and description are required" });
    return;
  }

  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }

  const [job] = await db.insert(jobsTable).values({
    vehicleId,
    vin: vehicle.vin,
    customerId: req.userId!,
    jobType: jobType as "repair" | "diagnostic" | "maintenance" | "detailing",
    description,
    locationLat: locationLat ?? null,
    locationLng: locationLng ?? null,
    locationAddress: locationAddress ?? null,
    estimatedPrice: estimatedPrice ?? null,
    status: "REQUESTED",
  }).returning();

  res.status(201).json(await formatJob(job));
});

router.get("/jobs/:jobId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const jobId = parseInt(rawId, 10);

  if (isNaN(jobId)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.json(await formatJob(job));
});

router.patch("/jobs/:jobId/status", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const jobId = parseInt(rawId, 10);

  if (isNaN(jobId)) {
    res.status(400).json({ error: "Invalid job ID" });
    return;
  }

  const { status, estimatedPrice } = req.body as { status: string; estimatedPrice?: number };

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const updates: Partial<typeof jobsTable.$inferInsert> = {
    status: status as typeof job.status,
  };

  if (estimatedPrice !== undefined) updates.estimatedPrice = estimatedPrice;
  if (status === "COMPLETED") updates.completedAt = new Date();
  if (status === "ACCEPTED") updates.acceptedAt = new Date();

  const [updated] = await db.update(jobsTable).set(updates).where(eq(jobsTable.id, jobId)).returning();
  res.json(await formatJob(updated));
});

router.post("/jobs/:jobId/accept", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "mechanic") {
    res.status(403).json({ error: "Only mechanics can accept jobs" });
    return;
  }

  const rawId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const jobId = parseInt(rawId, 10);

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status !== "REQUESTED" && job.status !== "OFFERED") {
    res.status(400).json({ error: "Job cannot be accepted in its current state" });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({ status: "ACCEPTED", mechanicId: req.userId!, acceptedAt: new Date() })
    .where(eq(jobsTable.id, jobId))
    .returning();

  res.json(await formatJob(updated));
});

router.post("/jobs/:jobId/cancel", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const jobId = parseInt(rawId, 10);

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (req.userRole === "customer" && job.customerId !== req.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const cancellableStatuses = ["REQUESTED", "OFFERED"];
  if (!cancellableStatuses.includes(job.status) && req.userRole !== "admin") {
    res.status(400).json({ error: "Job cannot be cancelled after it has been accepted" });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({ status: "CANCELLED" })
    .where(eq(jobsTable.id, jobId))
    .returning();

  res.json(await formatJob(updated));
});

router.post("/jobs/:jobId/rate", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "customer") {
    res.status(403).json({ error: "Only customers can rate jobs" });
    return;
  }

  const rawId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const jobId = parseInt(rawId, 10);

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.customerId !== req.userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (job.status !== "COMPLETED" && job.status !== "PAID") {
    res.status(400).json({ error: "Job must be completed before rating" });
    return;
  }

  const { rating, note } = req.body as { rating: number; note?: string };
  if (!rating || rating < 1 || rating > 5) {
    res.status(400).json({ error: "Rating must be between 1 and 5" });
    return;
  }

  const [updated] = await db
    .update(jobsTable)
    .set({ rating, ratingNote: note ?? null })
    .where(eq(jobsTable.id, jobId))
    .returning();

  res.json(await formatJob(updated));
});

export default router;
