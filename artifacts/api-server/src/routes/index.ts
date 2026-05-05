import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import vehiclesRouter from "./vehicles";
import ownershipRouter from "./ownership";
import jobsRouter from "./jobs";
import worklogsRouter from "./worklogs";
import paymentsRouter from "./payments";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(vehiclesRouter);
router.use(ownershipRouter);
router.use(jobsRouter);
router.use(worklogsRouter);
router.use(paymentsRouter);
router.use(dashboardRouter);

export default router;
