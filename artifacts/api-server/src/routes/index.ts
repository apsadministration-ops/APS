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
import messagesRouter from "./messages";
import loyaltyRouter from "./loyalty";
import referralsRouter from "./referrals";
import assistantRouter from "./assistant";
import favoritesRouter from "./favorites";
import flagsRouter from "./flags";
import mechanicsRouter from "./mechanics";

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
router.use(messagesRouter);
router.use(loyaltyRouter);
router.use(referralsRouter);
router.use(assistantRouter);
router.use(favoritesRouter);
router.use(flagsRouter);
router.use(mechanicsRouter);

export default router;
