import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, flagsTable, usersTable, jobsTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import { canCreateJobFlag } from "../lib/authorization";

const router: IRouter = Router();

async function decorate(flag: typeof flagsTable.$inferSelect) {
  const [reporter] = await db.select().from(usersTable).where(eq(usersTable.id, flag.reporterId));
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, flag.targetId));
  return {
    id: flag.id,
    reporterId: flag.reporterId,
    reporterName: reporter?.name ?? "Unknown",
    targetId: flag.targetId,
    targetName: target?.name ?? "Unknown",
    targetRole: flag.targetRole,
    jobId: flag.jobId ?? null,
    type: flag.type,
    reason: flag.reason ?? null,
    resolved: flag.resolved,
    createdAt: flag.createdAt,
  };
}

router.get("/flags", authenticate, async (req: AuthRequest, res): Promise<void> => {
  let rows;
  if (req.userRole === "admin") {
    rows = await db.select().from(flagsTable).orderBy(desc(flagsTable.createdAt));
  } else {
    rows = await db.select().from(flagsTable)
      .where(eq(flagsTable.reporterId, req.userId!))
      .orderBy(desc(flagsTable.createdAt));
  }
  res.json(await Promise.all(rows.map(decorate)));
});

router.post("/flags", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const parsed = z.object({
    targetId: z.coerce.number().int().positive(),
    type: z.enum(["scam", "rude", "no_show", "unsafe", "other"]),
    reason: z.string().trim().max(2000).optional(),
    jobId: z.coerce.number().int().positive().optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid flag payload", issues: parsed.error.issues });
    return;
  }
  const { targetId, type, reason, jobId } = parsed.data;
  if (req.userRole === "mechanic" && req.user?.status !== "active") {
    res.status(403).json({ error: "Your mechanic account is not active." });
    return;
  }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, targetId));
  if (!target || target.role === "admin") { res.status(404).json({ error: "Target not found" }); return; }
  // Role-rule: customers can flag mechanics, mechanics can flag customers, admins anything.
  if (req.userRole === "customer" && target.role !== "mechanic") {
    res.status(403).json({ error: "Customers can only report mechanics" }); return;
  }
  if (req.userRole === "mechanic" && target.role !== "customer") {
    res.status(403).json({ error: "Mechanics can only report customers" }); return;
  }
  if (jobId !== undefined) {
    const [job] = await db.select({
      customerId: jobsTable.customerId,
      mechanicId: jobsTable.mechanicId,
    }).from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) { res.status(404).json({ error: "Job not found" }); return; }
    if (!canCreateJobFlag({
      role: req.userRole,
      reporterId: req.userId!,
      targetId,
      job,
    })) {
      res.status(403).json({ error: "The reporter and target must be participants in the referenced job" });
      return;
    }
  }
  const [row] = await db.insert(flagsTable).values({
    reporterId: req.userId!,
    targetId,
    targetRole: target.role as "customer" | "mechanic",
    jobId: jobId ?? null,
    type,
    reason: reason ?? null,
  }).returning();
  res.status(201).json(await decorate(row));
});

router.post("/flags/:flagId/resolve", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const flagId = parseInt(String(req.params.flagId), 10);
  if (isNaN(flagId)) { res.status(400).json({ error: "Invalid flag id" }); return; }
  const [updated] = await db.update(flagsTable).set({ resolved: true })
    .where(eq(flagsTable.id, flagId)).returning();
  if (!updated) { res.status(404).json({ error: "Flag not found" }); return; }
  res.json(await decorate(updated));
});

export default router;
