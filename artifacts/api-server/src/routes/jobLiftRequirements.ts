import { Router, type IRouter, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db, jobsTable } from "@workspace/db";
import { authenticate, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";
import { parsePositiveSafeInteger } from "../lib/validation";

const router: IRouter = Router();
const LIFT_ELIGIBLE_STATUSES = ["ACCEPTED", "EN_ROUTE", "IN_PROGRESS"] as const;

function isLiftEligibleStatus(status: string): boolean {
  return (LIFT_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

/**
 * The mechanic's lift request is intentionally isolated from jobs.ts. The
 * commercial jobs/dispatch owner can retain ownership of the broader job
 * route while this Part 6 action only changes the existing
 * jobs.requiresGhostGarage field.
 */
router.get("/jobs/:jobId/lift-requirement", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const jobId = parsePositiveSafeInteger(req.params.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const [job] = await db.select({
    id: jobsTable.id,
    mechanicId: jobsTable.mechanicId,
    status: jobsTable.status,
    requiresGhostGarage: jobsTable.requiresGhostGarage,
    customerTransportApproved: jobsTable.customerTransportApproved,
  }).from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const allowed = req.userRole === "admin"
    || (req.userRole === "mechanic" && job.mechanicId === req.userId);
  if (!allowed) { res.status(403).json({ error: "Only the assigned mechanic or an admin can view this lift requirement" }); return; }
  res.json({
    jobId: job.id,
    requiresGhostGarage: job.requiresGhostGarage,
    customerTransportApproved: job.customerTransportApproved,
    status: job.status,
  });
});

const setLiftRequirement = async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = parsePositiveSafeInteger(req.params.jobId);
  if (jobId === null) { res.status(400).json({ error: "Invalid job ID" }); return; }
  const body = req.body as { requiresGhostGarage?: unknown };
  if (typeof body?.requiresGhostGarage !== "boolean") {
    res.status(400).json({ error: "requiresGhostGarage must be a boolean" }); return;
  }
  const requiresGhostGarage = body.requiresGhostGarage;

  try {
    const updated = await db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT id, mechanic_id, status, requires_ghost_garage,
               customer_transport_approved
        FROM jobs
        WHERE id = ${jobId}
        FOR UPDATE
      `);
      if (locked.rows.length === 0) throw new Error("JOB_NOT_FOUND");
      const job = locked.rows[0] as {
        id: number | string;
        mechanic_id: number | string | null;
        status: string;
        requires_ghost_garage: boolean;
        customer_transport_approved: boolean;
      };
      if (Number(job.mechanic_id) !== req.userId) throw new Error("FORBIDDEN");
      if (!isLiftEligibleStatus(job.status)) throw new Error("JOB_STATUS");

      // Customer approval is reset only on the false -> true transition. An
      // already-approved customer is not silently asked again, and turning
      // the requirement off does not mutate customer approval state.
      const newlyRequired = requiresGhostGarage && !job.requires_ghost_garage;
      const [result] = await tx.update(jobsTable)
        .set({
          requiresGhostGarage,
          ...(newlyRequired ? { customerTransportApproved: false } : {}),
        })
        .where(eq(jobsTable.id, jobId))
        .returning({
          id: jobsTable.id,
          mechanicId: jobsTable.mechanicId,
          status: jobsTable.status,
          requiresGhostGarage: jobsTable.requiresGhostGarage,
          customerTransportApproved: jobsTable.customerTransportApproved,
        });
      return result;
    });
    res.json({
      jobId: updated.id,
      requiresGhostGarage: updated.requiresGhostGarage,
      customerTransportApproved: updated.customerTransportApproved,
      status: updated.status,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "JOB_NOT_FOUND") { res.status(404).json({ error: "Job not found" }); return; }
    if (message === "FORBIDDEN") { res.status(403).json({ error: "Only the assigned mechanic can change this lift requirement" }); return; }
    if (message === "JOB_STATUS") {
      res.status(409).json({ error: "Lift requirements can only change for an accepted, en-route, or in-progress job" }); return;
    }
    throw error;
  }
};

// Command-style alias retained for clients that model this mechanic action as
// an explicit request rather than a partial resource update.
router.patch("/jobs/:jobId/lift-requirement", authenticate, requireActiveMechanic, setLiftRequirement);
router.post("/jobs/:jobId/lift-requirement", authenticate, requireActiveMechanic, setLiftRequirement);

export default router;