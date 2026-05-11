import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, inspectionsTable, jobsTable, vehiclesTable } from "@workspace/db";
import { CreateInspectionBody } from "@workspace/api-zod";
import { authenticate, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

function formatInspection(i: typeof inspectionsTable.$inferSelect) {
  return {
    id: i.id, jobId: i.jobId, vehicleId: i.vehicleId, vin: i.vin,
    mechanicId: i.mechanicId, kind: i.kind, mileage: i.mileage,
    mediaUrls: (i.mediaUrls as string[]) ?? [],
    damageChecklist: i.damageChecklist ?? null,
    notes: i.notes ?? null,
    transportPickupMileage: i.transportPickupMileage ?? null,
    transportArrivalMileage: i.transportArrivalMileage ?? null,
    createdAt: i.createdAt,
  };
}

router.post("/jobs/:jobId/inspections", authenticate, requireActiveMechanic, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const parsed = CreateInspectionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const v = parsed.data;

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.mechanicId !== req.userId) { res.status(403).json({ error: "You are not assigned to this job" }); return; }

  // Mileage rollback check — same invariant we enforce on work-log submission.
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, job.vehicleId));
  if (vehicle && v.mileage < (vehicle.mileage ?? 0)) {
    res.status(400).json({
      error: `Inspection mileage (${v.mileage}) cannot be lower than current odometer (${vehicle.mileage}).`,
    });
    return;
  }

  // Walkthrough media is required to keep the dispute trail complete.
  if (!Array.isArray(v.mediaUrls) || v.mediaUrls.length === 0) {
    res.status(400).json({ error: "At least one walkthrough media URL is required." });
    return;
  }

  try {
    const [created] = await db.insert(inspectionsTable).values({
      jobId, vehicleId: job.vehicleId, vin: job.vin, mechanicId: req.userId!,
      kind: v.kind, mileage: v.mileage,
      mediaUrls: v.mediaUrls,
      damageChecklist: v.damageChecklist ?? null,
      notes: v.notes ?? null,
      transportPickupMileage: v.transportPickupMileage ?? null,
      transportArrivalMileage: v.transportArrivalMileage ?? null,
    }).returning();
    res.status(201).json(formatInspection(created));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("inspections_job_kind_unique")) {
      res.status(409).json({ error: `A ${v.kind}-inspection already exists for this job.` }); return;
    }
    throw err;
  }
});

router.get("/jobs/:jobId/inspections", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  // IDOR: admin OR job customer OR assigned mechanic.
  const isCustomer = req.userRole === "customer" && job.customerId === req.userId;
  const isMechanic = req.userRole === "mechanic" && job.mechanicId === req.userId;
  if (!(req.userRole === "admin" || isCustomer || isMechanic)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const rows = await db.select().from(inspectionsTable)
    .where(eq(inspectionsTable.jobId, jobId))
    .orderBy(inspectionsTable.createdAt);
  void and;
  res.json(rows.map(formatInspection));
});

export default router;
