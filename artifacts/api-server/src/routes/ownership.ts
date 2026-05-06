import { Router, type IRouter } from "express";
import { eq, and, isNull } from "drizzle-orm";
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

  // IDOR guard: only an admin, or someone who currently owns or has previously
  // owned this vehicle, may view its full ownership chain. (Mechanics access
  // VIN history through /worklogs, which has its own scoped check.)
  const allOwnerships = await db
    .select()
    .from(ownershipTable)
    .where(eq(ownershipTable.vehicleId, vehicleId))
    .orderBy(ownershipTable.startDate);

  if (req.userRole !== "admin") {
    const everOwned = allOwnerships.some((o) => o.userId === req.userId);
    if (!everOwned) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  const result = await Promise.all(
    allOwnerships.map(async (r) => {
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

// Used internally by other route handlers — keep the export in case future code
// needs the same ownership check.
export async function userMayAccessVehicle(userId: number, role: string, vehicleId: number): Promise<boolean> {
  if (role === "admin") return true;
  // Owner (current OR past) is allowed.
  const [own] = await db.select().from(ownershipTable)
    .where(and(eq(ownershipTable.vehicleId, vehicleId), eq(ownershipTable.userId, userId)));
  if (own) return true;
  return false;
}

export async function userMayAccessVin(userId: number, role: string, vin: string): Promise<boolean> {
  if (role === "admin") return true;
  const [own] = await db.select().from(ownershipTable)
    .where(and(eq(ownershipTable.vin, vin), eq(ownershipTable.userId, userId)));
  return !!own;
}

// Vehicle is "currently owned by user" — used by mechanic active-job check below.
export async function isCurrentOwner(userId: number, vehicleId: number): Promise<boolean> {
  const [own] = await db.select().from(ownershipTable)
    .where(and(
      eq(ownershipTable.vehicleId, vehicleId),
      eq(ownershipTable.userId, userId),
      isNull(ownershipTable.endDate),
    ));
  return !!own;
}

export default router;
