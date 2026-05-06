import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import {
  db,
  customerPointsLedgerTable,
  customerRedemptionsTable,
  mechanicPointsLedgerTable,
  mechanicRewardsTable,
  usersTable,
} from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import {
  CUSTOMER_REWARDS,
  MECHANIC_REWARDS,
  redeemCustomerReward,
  redeemMechanicReward,
} from "../lib/loyaltyEngine";

const router: IRouter = Router();

/* -------------------------------------------------------------------------- */
/* CUSTOMER LOYALTY                                                            */
/* -------------------------------------------------------------------------- */

router.get("/loyalty/customer", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select({ loyaltyPoints: usersTable.loyaltyPoints })
    .from(usersTable).where(eq(usersTable.id, req.userId!));
  const history = await db.select().from(customerPointsLedgerTable)
    .where(eq(customerPointsLedgerTable.userId, req.userId!))
    .orderBy(desc(customerPointsLedgerTable.createdAt))
    .limit(100);
  res.json({ balance: user?.loyaltyPoints ?? 0, history });
});

router.get("/loyalty/rewards/customer", authenticate, async (_req, res): Promise<void> => {
  res.json(CUSTOMER_REWARDS);
});

router.post("/loyalty/customer/redeem", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const { rewardKey } = req.body as { rewardKey: string };
  if (!rewardKey) { res.status(400).json({ error: "rewardKey required" }); return; }
  try {
    const newBalance = await redeemCustomerReward(req.userId!, rewardKey);
    res.json({ ok: true, balance: newBalance });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get("/loyalty/customer/redemptions", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const rows = await db.select().from(customerRedemptionsTable)
    .where(eq(customerRedemptionsTable.userId, req.userId!))
    .orderBy(desc(customerRedemptionsTable.createdAt));
  res.json(rows);
});

/* -------------------------------------------------------------------------- */
/* MECHANIC LOYALTY                                                            */
/* -------------------------------------------------------------------------- */

router.get("/loyalty/mechanic", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "mechanic") { res.status(403).json({ error: "Mechanics only" }); return; }
  const [user] = await db.select({ mechanicPoints: usersTable.mechanicPoints })
    .from(usersTable).where(eq(usersTable.id, req.userId!));
  const history = await db.select().from(mechanicPointsLedgerTable)
    .where(eq(mechanicPointsLedgerTable.mechanicId, req.userId!))
    .orderBy(desc(mechanicPointsLedgerTable.createdAt))
    .limit(100);
  res.json({ balance: user?.mechanicPoints ?? 0, history });
});

router.get("/loyalty/rewards/mechanic", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "mechanic") { res.status(403).json({ error: "Mechanics only" }); return; }
  res.json(MECHANIC_REWARDS);
});

router.post("/loyalty/mechanic/redeem", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "mechanic") { res.status(403).json({ error: "Mechanics only" }); return; }
  const { rewardKey } = req.body as { rewardKey: string };
  if (!rewardKey) { res.status(400).json({ error: "rewardKey required" }); return; }
  try {
    const newBalance = await redeemMechanicReward(req.userId!, rewardKey);
    res.json({ ok: true, balance: newBalance });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get("/loyalty/mechanic/redemptions", authenticate, async (req: AuthRequest, res): Promise<void> => {
  if (req.userRole !== "mechanic") { res.status(403).json({ error: "Mechanics only" }); return; }
  const rows = await db.select().from(mechanicRewardsTable)
    .where(eq(mechanicRewardsTable.mechanicId, req.userId!))
    .orderBy(desc(mechanicRewardsTable.createdAt));
  res.json(rows);
});

/* -------------------------------------------------------------------------- */
/* LEGACY GET /loyalty — kept so the existing customer screen keeps working    */
/* until the new screens ship. Returns the customer ledger.                    */
/* -------------------------------------------------------------------------- */

router.get("/loyalty", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select({ loyaltyPoints: usersTable.loyaltyPoints })
    .from(usersTable).where(eq(usersTable.id, req.userId!));
  const history = await db.select().from(customerPointsLedgerTable)
    .where(eq(customerPointsLedgerTable.userId, req.userId!))
    .orderBy(desc(customerPointsLedgerTable.createdAt))
    .limit(100);
  res.json({ balance: user?.loyaltyPoints ?? 0, history });
});

export default router;
