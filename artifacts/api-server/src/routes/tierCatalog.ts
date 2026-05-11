import { Router, type IRouter } from "express";
import { TIERS, JOB_CATALOG, COMMISSION } from "@workspace/tier-catalog";

const router: IRouter = Router();

/**
 * Public, cacheable. Mirrors the in-process `@workspace/tier-catalog` lib so
 * non-TS clients (or a future web admin) can render tier ladders, service
 * pickers, and earnings calculators without baking the catalog into their
 * source. The mobile app can also fall back to this if its bundled lib copy
 * is older than the running server.
 */
router.get("/tier-catalog", (_req, res): void => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    tiers: TIERS,
    services: JOB_CATALOG,
    commission: {
      normal:      COMMISSION.normal,
      workingDown: COMMISSION.workingDown,
      detailing:   COMMISSION.detailing,
    },
  });
});

export default router;
