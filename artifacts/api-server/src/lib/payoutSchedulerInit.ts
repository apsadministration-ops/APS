/**
 * In-process cron sweepers for payout/dispute/approval engines.
 * Replit dynos are single-process so an in-memory setInterval is sufficient.
 *
 * Sweepers run on a 60s tick. Each tick:
 *   - sweepExpiredApprovals() — 60s mechanic-acceptance window
 *   - sweepExpiredConfirmations() — 24h customer work-confirmation window
 *   - sweepStaleHolds() — belt-and-suspenders for orphaned capture_pending rows
 *
 * All sweep calls catch their own errors so one failure cannot stop the
 * other sweeps from firing on this tick or the next one.
 */

import { logger } from "./logger";
import { sweepExpiredApprovals } from "./customerApprovalEngine";
import { sweepExpiredConfirmations, sweepStaleHolds } from "./payoutHoldEngine";

const TICK_MS = 60 * 1000;
let started = false;
let timer: NodeJS.Timeout | null = null;

export function startPayoutScheduler(): void {
  if (started) return;
  started = true;
  logger.info({ tickMs: TICK_MS }, "Payout scheduler started");
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  // Also run once at boot (caught up after restart).
  void tick();
}

export function stopPayoutScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

async function tick(): Promise<void> {
  await Promise.allSettled([
    sweepExpiredApprovals().catch((err) => logger.error({ err }, "sweep approvals failed")),
    sweepExpiredConfirmations().catch((err) => logger.error({ err }, "sweep confirmations failed")),
    sweepStaleHolds().catch((err) => logger.error({ err }, "sweep stale holds failed")),
  ]);
}
