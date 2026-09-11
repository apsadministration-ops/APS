import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch {
    // Keep readiness failures explicit without returning database connection
    // strings or driver/provider details to callers.
    const data = HealthCheckResponse.parse({ status: "degraded" });
    res.status(503).json(data);
  }
});

export default router;
