import { Router, type IRouter } from "express";
import { eq, and, count, avg } from "drizzle-orm";
import { db, favoritesTable, usersTable, jobsTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

async function decorate(fav: typeof favoritesTable.$inferSelect) {
  const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, fav.mechanicId));
  const [stats] = await db
    .select({ avg: avg(jobsTable.rating).as("avg"), n: count(jobsTable.id).as("n") })
    .from(jobsTable)
    .where(and(eq(jobsTable.mechanicId, fav.mechanicId), eq(jobsTable.status, "PAID")));
  return {
    id: fav.id,
    mechanicId: fav.mechanicId,
    mechanicName: mech?.name ?? "Unknown",
    mechanicTier: mech?.mechanicTier ?? null,
    averageRating: stats?.avg != null ? Number(stats.avg) : null,
    completedJobs: Number(stats?.n ?? 0),
    createdAt: fav.createdAt,
  };
}

router.get("/favorites", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "customer") { res.status(403).json({ error: "Customers only" }); return; }
  const rows = await db.select().from(favoritesTable).where(eq(favoritesTable.customerId, req.userId!));
  res.json(await Promise.all(rows.map(decorate)));
});

router.post("/favorites", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "customer") { res.status(403).json({ error: "Customers only" }); return; }
  const { mechanicId } = req.body as { mechanicId: number };
  if (!mechanicId || typeof mechanicId !== "number") {
    res.status(400).json({ error: "mechanicId is required" }); return;
  }
  const [mech] = await db.select().from(usersTable).where(eq(usersTable.id, mechanicId));
  if (!mech || mech.role !== "mechanic") { res.status(404).json({ error: "Mechanic not found" }); return; }
  const existing = await db.select().from(favoritesTable)
    .where(and(eq(favoritesTable.customerId, req.userId!), eq(favoritesTable.mechanicId, mechanicId)));
  let row = existing[0];
  if (!row) {
    [row] = await db.insert(favoritesTable).values({ customerId: req.userId!, mechanicId }).returning();
  }
  res.status(201).json(await decorate(row));
});

router.delete("/favorites/:mechanicId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "customer") { res.status(403).json({ error: "Customers only" }); return; }
  const mechanicId = parseInt(String(req.params.mechanicId), 10);
  if (isNaN(mechanicId)) { res.status(400).json({ error: "Invalid mechanic id" }); return; }
  await db.delete(favoritesTable)
    .where(and(eq(favoritesTable.customerId, req.userId!), eq(favoritesTable.mechanicId, mechanicId)));
  res.json({ ok: true });
});

export default router;
