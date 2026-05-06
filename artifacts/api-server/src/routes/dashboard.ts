import { Router, type IRouter } from "express";
import { eq, and, isNull, count, sum, avg } from "drizzle-orm";
import { db, jobsTable, vehiclesTable, ownershipTable, usersTable, paymentsTable } from "@workspace/db";
import { authenticate, requireRole, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";

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

router.get("/dashboard/customer", authenticate, requireRole("customer", "admin"), async (req: AuthRequest, res): Promise<void> => {
  const ownerships = await db
    .select()
    .from(ownershipTable)
    .where(and(eq(ownershipTable.userId, req.userId!), isNull(ownershipTable.endDate)));

  const jobs = await db.select().from(jobsTable).where(eq(jobsTable.customerId, req.userId!));

  const activeStatuses = ["REQUESTED", "OFFERED", "ACCEPTED", "EN_ROUTE", "IN_PROGRESS"];
  const activeJobs = jobs.filter((j) => activeStatuses.includes(j.status));
  const completedJobs = jobs.filter((j) => j.status === "COMPLETED" || j.status === "PAID");

  const totalSpent = completedJobs.reduce((sum, j) => sum + (j.finalPrice ?? 0), 0);

  const recentJobs = await Promise.all(
    jobs
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5)
      .map(formatJob),
  );

  res.json({
    vehicleCount: ownerships.length,
    activeJobCount: activeJobs.length,
    completedJobCount: completedJobs.length,
    recentJobs,
    totalSpent,
  });
});

router.get("/dashboard/mechanic", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const myJobs = await db.select().from(jobsTable).where(eq(jobsTable.mechanicId, req.userId!));
  const availableJobs = await db.select().from(jobsTable).where(eq(jobsTable.status, "REQUESTED"));

  const activeStatuses = ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"];
  const activeJobs = myJobs.filter((j) => activeStatuses.includes(j.status));
  const completedJobs = myJobs.filter((j) => j.status === "COMPLETED" || j.status === "PAID");

  const totalEarnings = completedJobs.reduce((sum, j) => sum + (j.finalPrice ?? 0) * 0.9, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCompleted = completedJobs.filter((j) => j.completedAt && j.completedAt >= today);
  const todayEarnings = todayCompleted.reduce((sum, j) => sum + (j.finalPrice ?? 0) * 0.9, 0);

  const ratings = myJobs.filter((j) => j.rating !== null).map((j) => j.rating!);
  const averageRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

  const recentJobs = await Promise.all(
    myJobs
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5)
      .map(formatJob),
  );

  res.json({
    activeJobCount: activeJobs.length,
    completedJobCount: completedJobs.length,
    availableJobCount: availableJobs.length,
    todayEarnings,
    totalEarnings,
    averageRating,
    recentJobs,
  });
});

router.get("/dashboard/admin", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const users = await db.select().from(usersTable);
  const jobs = await db.select().from(jobsTable);
  const payments = await db.select().from(paymentsTable);

  const totalUsers = users.filter((u) => u.role !== "admin").length;
  const totalMechanics = users.filter((u) => u.role === "mechanic").length;
  const pendingMechanics = users.filter((u) => u.role === "mechanic" && u.status === "pending").length;

  const activeStatuses = ["REQUESTED", "OFFERED", "ACCEPTED", "EN_ROUTE", "IN_PROGRESS"];
  const activeJobs = jobs.filter((j) => activeStatuses.includes(j.status));

  const totalRevenue = payments
    .filter((p) => p.status === "released")
    .reduce((sum, p) => sum + p.platformFee, 0);

  const pendingPayouts = payments
    .filter((p) => p.status === "held")
    .reduce((sum, p) => sum + p.mechanicPayout, 0);

  const recentJobs = await Promise.all(
    jobs
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)
      .map(formatJob),
  );

  res.json({
    totalUsers,
    totalMechanics,
    pendingMechanics,
    totalJobs: jobs.length,
    activeJobs: activeJobs.length,
    totalRevenue,
    pendingPayouts,
    recentJobs,
  });
});

export default router;
