/**
 * Growth scheduler — separate sweeper from the payout scheduler so a slow
 * publishing API or content-engine retry never blocks payout ticks.
 *
 * Cadence:
 *   - sweepDuePublishes() — every PUBLISH_TICK_MS (1 min)
 *   - sweepWinnerIterations() — every ITERATION_TICK_MS (30 min)
 *   - sweepReuseCandidates() — every REUSE_TICK_MS (60 min)
 *
 * All three are bounded per tick (see each engine for batch size). All
 * sweep calls catch their own errors so one failure cannot stop the others.
 *
 * Boot order: server starts → run a one-shot backfill of engagement_score
 * so winners from before this engine become eligible immediately.
 */
import { logger } from "./logger";
import { sweepDuePublishes } from "./publishingEngine";
import { sweepWinnerIterations, backfillEngagementScores } from "./iterationEngine";
import { sweepReuseCandidates } from "./reuseEngine";

const PUBLISH_TICK_MS   = 60 * 1000;
const ITERATION_TICK_MS = 30 * 60 * 1000;
const REUSE_TICK_MS     = 60 * 60 * 1000;

let started = false;
const timers: NodeJS.Timeout[] = [];

export function startGrowthScheduler(): void {
  if (started) return;
  started = true;
  logger.info({
    publishTickMs: PUBLISH_TICK_MS,
    iterationTickMs: ITERATION_TICK_MS,
    reuseTickMs: REUSE_TICK_MS,
  }, "Growth scheduler started");

  // One-shot backfill so legacy posts get a score.
  void backfillEngagementScores()
    .then((n) => { if (n > 0) logger.info({ updated: n }, "engagement scores backfilled"); })
    .catch((err) => logger.error({
      errorName: err instanceof Error ? err.name : "UnknownError",
    }, "engagement backfill failed"));

  const publishTimer = setInterval(() => { void runPublishTick(); }, PUBLISH_TICK_MS);
  const iterTimer    = setInterval(() => { void runIterationTick(); }, ITERATION_TICK_MS);
  const reuseTimer   = setInterval(() => { void runReuseTick(); }, REUSE_TICK_MS);
  timers.push(publishTimer, iterTimer, reuseTimer);

  // Catch-up runs at boot.
  void runPublishTick();
}

export function stopGrowthScheduler(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  started = false;
}

async function runPublishTick(): Promise<void> {
  await sweepDuePublishes()
    .then((r) => { if (r.attempted > 0) logger.info({ ...r }, "publish sweep"); })
    .catch((err) => logger.error({
      errorName: err instanceof Error ? err.name : "UnknownError",
    }, "publish sweep failed"));
}

async function runIterationTick(): Promise<void> {
  await sweepWinnerIterations()
    .then((r) => { if (r.iterated > 0 || r.errors > 0) logger.info({ ...r }, "iteration sweep"); })
    .catch((err) => logger.error({
      errorName: err instanceof Error ? err.name : "UnknownError",
    }, "iteration sweep failed"));
}

async function runReuseTick(): Promise<void> {
  await sweepReuseCandidates()
    .then((r) => { if (r.reused > 0 || r.errors > 0) logger.info({ ...r }, "reuse sweep"); })
    .catch((err) => logger.error({
      errorName: err instanceof Error ? err.name : "UnknownError",
    }, "reuse sweep failed"));
}
