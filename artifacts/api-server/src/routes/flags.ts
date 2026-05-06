import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, flagsTable, usersTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

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
  const { targetId, type, reason, jobId } = req.body as {
    targetId: number; type: string; reason?: string; jobId?: number;
  };
  if (!targetId || !type) { res.status(400).json({ error: "targetId and type are required" }); return; }
  const allowedTypes = ["scam", "rude", "no_show", "unsafe", "other"] as const;
  if (!allowedTypes.includes(type as typeof allowedTypes[number])) {
    res.status(400).json({ error: "Invalid type" }); return;
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
  const [row] = await db.insert(flagsTable).values({
    reporterId: req.userId!,
    targetId,
    targetRole: target.role as "customer" | "mechanic",
    jobId: jobId ?? null,
    type: type as typeof allowedTypes[number],
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
