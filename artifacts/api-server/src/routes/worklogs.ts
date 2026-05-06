import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, workLogsTable, jobsTable, usersTable, paymentsTable, vehiclesTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import { notifyCustomerJobComplete } from "../lib/notifications";

const router: IRouter = Router();

async function formatWorkLog(log: typeof workLogsTable.$inferSelect) {
  const [mechanic] = await db.select().from(usersTable).where(eq(usersTable.id, log.mechanicId));
  return {
    id: log.id, jobId: log.jobId, vehicleId: log.vehicleId, vin: log.vin,
    mechanicId: log.mechanicId, mechanicName: mechanic?.name ?? "Unknown", customerId: log.customerId,
    serviceCategory: log.serviceCategory, serviceDescription: log.serviceDescription,
    mileageAtService: log.mileageAtService ?? 0,
    laborCost: log.laborCost, partsCost: log.partsCost, totalCost: log.totalCost,
    partsUsed: (log.partsUsed as string[]) ?? [], notes: log.notes ?? null,
    beforeImages: (log.beforeImages as string[]) ?? [], afterImages: (log.afterImages as string[]) ?? [],
    createdAt: log.createdAt,
  };
}

router.post("/worklogs", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "mechanic") { res.status(403).json({ error: "Only mechanics can submit work logs" }); return; }
  const { jobId, serviceCategory, serviceDescription, mileageAtService, laborCost, partsCost, partsUsed, notes, beforeImages, afterImages } = req.body as {
    jobId: number; serviceCategory: string; serviceDescription: string;
    mileageAtService: number;
    laborCost: number; partsCost: number; partsUsed: string[];
    notes?: string; beforeImages: string[]; afterImages: string[];
  };
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.mechanicId !== req.userId) { res.status(403).json({ error: "You are not assigned to this job" }); return; }

  if (mileageAtService == null || typeof mileageAtService !== "number" || !Number.isFinite(mileageAtService) || mileageAtService < 0) {
    res.status(400).json({ error: "mileageAtService is required and must be a non-negative number" });
    return;
  }

  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
  if (vehicle && mileageAtService < (vehicle.mileage ?? 0)) {
    res.status(400).json({
      error: `Mileage at service (${mileageAtService}) cannot be lower than the current odometer reading (${vehicle.mileage}).`,
    });
    return;
  }

  const totalCost = (laborCost ?? 0) + (partsCost ?? 0);
  const platformFee = totalCost * 0.1;
  const mechanicPayout = totalCost - platformFee;

  const mileageInt = Math.floor(mileageAtService);

  const workLog = await db.transaction(async (tx) => {
    const [created] = await tx.insert(workLogsTable).values({
      jobId, vehicleId: job.vehicleId, vin: job.vin, mechanicId: req.userId!, customerId: job.customerId,
      serviceCategory: serviceCategory as "repair" | "diagnostic" | "maintenance" | "detailing",
      serviceDescription,
      mileageAtService: mileageInt,
      laborCost, partsCost, totalCost,
      partsUsed: partsUsed ?? [], notes: notes ?? null,
      beforeImages: beforeImages ?? [], afterImages: afterImages ?? [],
      immutableFlag: true,
    }).returning();

    await tx.update(jobsTable).set({ status: "COMPLETED", finalPrice: totalCost, completedAt: new Date() }).where(eq(jobsTable.id, jobId));
    await tx.update(vehiclesTable).set({ mileage: mileageInt }).where(eq(vehiclesTable.id, job.vehicleId));
    await tx.insert(paymentsTable).values({ jobId, amount: totalCost, platformFee, mechanicPayout, status: "held" });
    return created;
  });

  // Notify customer job is complete (fire-and-forget)
  db.select().from(usersTable).where(eq(usersTable.id, job.customerId))
    .then(async ([customer]) => {
      if (customer?.pushToken) {
        const vehicleName = vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : "your vehicle";
        notifyCustomerJobComplete(customer.pushToken, vehicleName, totalCost, jobId).catch(() => {});
      }
    })
    .catch(() => {});

  res.status(201).json(await formatWorkLog(workLog));
});

router.get("/worklogs/vin/:vin", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const vin = String(req.params.vin).toUpperCase();
  const logs = await db.select().from(workLogsTable).where(eq(workLogsTable.vin, vin)).orderBy(workLogsTable.createdAt);
  res.json(await Promise.all(logs.map(formatWorkLog)));
});

router.get("/worklogs/:worklogId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const worklogId = parseInt(String(req.params.worklogId), 10);
  if (isNaN(worklogId)) { res.status(400).json({ error: "Invalid worklog ID" }); return; }
  const [log] = await db.select().from(workLogsTable).where(eq(workLogsTable.id, worklogId));
  if (!log) { res.status(404).json({ error: "Work log not found" }); return; }
  res.json(await formatWorkLog(log));
});

export default router;
