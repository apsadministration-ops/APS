import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, workLogsTable, jobsTable, usersTable, paymentsTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

async function formatWorkLog(log: typeof workLogsTable.$inferSelect) {
  const [mechanic] = await db.select().from(usersTable).where(eq(usersTable.id, log.mechanicId));
  return {
    id: log.id,
    jobId: log.jobId,
    vehicleId: log.vehicleId,
    vin: log.vin,
    mechanicId: log.mechanicId,
    mechanicName: mechanic?.name ?? "Unknown",
    customerId: log.customerId,
    serviceCategory: log.serviceCategory,
    serviceDescription: log.serviceDescription,
    laborCost: log.laborCost,
    partsCost: log.partsCost,
    totalCost: log.totalCost,
    partsUsed: (log.partsUsed as string[]) ?? [],
    notes: log.notes ?? null,
    beforeImages: (log.beforeImages as string[]) ?? [],
    afterImages: (log.afterImages as string[]) ?? [],
    createdAt: log.createdAt,
  };
}

router.post("/worklogs", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "mechanic") {
    res.status(403).json({ error: "Only mechanics can submit work logs" });
    return;
  }

  const {
    jobId,
    serviceCategory,
    serviceDescription,
    laborCost,
    partsCost,
    partsUsed,
    notes,
    beforeImages,
    afterImages,
  } = req.body as {
    jobId: number;
    serviceCategory: string;
    serviceDescription: string;
    laborCost: number;
    partsCost: number;
    partsUsed: string[];
    notes?: string;
    beforeImages: string[];
    afterImages: string[];
  };

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.mechanicId !== req.userId) {
    res.status(403).json({ error: "You are not assigned to this job" });
    return;
  }

  const totalCost = (laborCost ?? 0) + (partsCost ?? 0);
  const platformFee = totalCost * 0.1;
  const mechanicPayout = totalCost - platformFee;

  const [workLog] = await db.insert(workLogsTable).values({
    jobId,
    vehicleId: job.vehicleId,
    vin: job.vin,
    mechanicId: req.userId!,
    customerId: job.customerId,
    serviceCategory: serviceCategory as "repair" | "diagnostic" | "maintenance" | "detailing",
    serviceDescription,
    laborCost,
    partsCost,
    totalCost,
    partsUsed: partsUsed ?? [],
    notes: notes ?? null,
    beforeImages: beforeImages ?? [],
    afterImages: afterImages ?? [],
    immutableFlag: true,
  }).returning();

  // Mark job COMPLETED and set final price
  await db.update(jobsTable).set({
    status: "COMPLETED",
    finalPrice: totalCost,
    completedAt: new Date(),
  }).where(eq(jobsTable.id, jobId));

  // Create payment record
  await db.insert(paymentsTable).values({
    jobId,
    amount: totalCost,
    platformFee,
    mechanicPayout,
    status: "held",
  });

  res.status(201).json(await formatWorkLog(workLog));
});

router.get("/worklogs/vin/:vin", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const vin = (Array.isArray(req.params.vin) ? req.params.vin[0] : req.params.vin).toUpperCase();

  const logs = await db
    .select()
    .from(workLogsTable)
    .where(eq(workLogsTable.vin, vin))
    .orderBy(workLogsTable.createdAt);

  const result = await Promise.all(logs.map(formatWorkLog));
  res.json(result);
});

router.get("/worklogs/:worklogId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.worklogId) ? req.params.worklogId[0] : req.params.worklogId;
  const worklogId = parseInt(rawId, 10);

  if (isNaN(worklogId)) {
    res.status(400).json({ error: "Invalid worklog ID" });
    return;
  }

  const [log] = await db.select().from(workLogsTable).where(eq(workLogsTable.id, worklogId));
  if (!log) {
    res.status(404).json({ error: "Work log not found" });
    return;
  }

  res.json(await formatWorkLog(log));
});

export default router;
