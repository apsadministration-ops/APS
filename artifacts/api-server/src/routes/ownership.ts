import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, ownershipTable, usersTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

router.get("/ownership/:vehicleId", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rawId = Array.isArray(req.params.vehicleId) ? req.params.vehicleId[0] : req.params.vehicleId;
  const vehicleId = parseInt(rawId, 10);

  if (isNaN(vehicleId)) {
    res.status(400).json({ error: "Invalid vehicle ID" });
    return;
  }

  const records = await db
    .select()
    .from(ownershipTable)
    .where(eq(ownershipTable.vehicleId, vehicleId))
    .orderBy(ownershipTable.startDate);

  const result = await Promise.all(
    records.map(async (r) => {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.id, r.userId));
      return {
        id: r.id,
        vehicleId: r.vehicleId,
        vin: r.vin,
        userId: r.userId,
        userName: user?.name ?? "Unknown",
        startDate: r.startDate,
        endDate: r.endDate ?? null,
        transferVerified: r.transferVerified,
      };
    }),
  );

  res.json(result);
});

export default router;
