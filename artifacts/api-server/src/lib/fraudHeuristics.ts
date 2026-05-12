import { db, partsItemsTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

/**
 * Lightweight server-side fraud / risk heuristics for parts reimbursement.
 * Returns a non-empty `reason` string when something looks off; the worklog
 * is then stamped `flaggedForReview=true` and surfaces to admin queue.
 *
 * These are intentionally cheap — no ML, no external calls. They exist to
 * give APS admins a queue to review, NOT to block payouts. Only an admin
 * can hold/revert a payout.
 */

export interface FraudCheckInput {
  mechanicId: number;
  partsCostActualCents: number;
  partsCostEstimateCents: number; // catalog-derived estimate at job creation
  laborRevenueCents: number;
  partsItems: Array<{ name: string; partNumber?: string | null; supplier?: string | null; totalCents: number }>;
}

export async function checkPartsFraud(input: FraudCheckInput): Promise<string | null> {
  const reasons: string[] = [];

  // 1) Actual parts cost wildly exceeds the catalog estimate.
  if (
    input.partsCostEstimateCents > 0 &&
    input.partsCostActualCents > Math.round(input.partsCostEstimateCents * 1.75)
  ) {
    const overPct = Math.round(((input.partsCostActualCents - input.partsCostEstimateCents) / input.partsCostEstimateCents) * 100);
    reasons.push(`Parts cost ${overPct}% over estimate`);
  }

  // 2) Parts cost greater than labor revenue (suspicious for non-detail jobs).
  if (input.partsCostActualCents > input.laborRevenueCents && input.partsCostActualCents > 50000) {
    reasons.push("Parts cost exceeds labor revenue");
  }

  // 3) Single line item over $1000 — high-ticket items merit a quick eyeball.
  const bigItem = input.partsItems.find((p) => p.totalCents >= 100000);
  if (bigItem) {
    reasons.push(`High-ticket item: ${bigItem.name} ($${(bigItem.totalCents / 100).toFixed(2)})`);
  }

  // 4) Repeated identical part# from same supplier in last 7 days >= 4 times.
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    for (const p of input.partsItems) {
      if (!p.partNumber || !p.supplier) continue;
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(partsItemsTable)
        .where(and(
          eq(partsItemsTable.mechanicId, input.mechanicId),
          eq(partsItemsTable.partNumber, p.partNumber),
          eq(partsItemsTable.supplier, p.supplier),
          gte(partsItemsTable.createdAt, sevenDaysAgo),
        ));
      if ((row?.n ?? 0) >= 4) {
        reasons.push(`Repeated reimbursement: ${p.partNumber} @ ${p.supplier} (${row?.n ?? 0}× in 7d)`);
        break; // one is enough
      }
    }
  } catch { /* heuristic — never block on a count failure */ }

  return reasons.length > 0 ? reasons.join("; ") : null;
}
