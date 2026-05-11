/**
 * Badge auto-award engine.
 *
 * Definitions live in code (not DB). For each badge we declare:
 *   - audience: who can earn it
 *   - check(ctx): given a snapshot of metrics, returns true/false
 *
 * After every reputation recompute the engine runs every applicable badge:
 *   - active + check passes  → leave alone
 *   - inactive + check passes → award (insert)
 *   - active + check fails    → revoke (set revoked_at)
 *
 * Badges are visual rewards. They MUST NOT gate access — that lives in
 * `users.role` / `users.status` / `users.mechanicTier`.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db, userBadgesTable, userReputationTable, usersTable } from "@workspace/db";

export type BadgeAudience = "customer" | "mechanic" | "any";

export interface BadgeContext {
  userId: number;
  role: string;
  reviewCount: number;
  overallAvg: number;
  completionRate: number;
  cancellationRate: number;
  noShowRate: number;
  repeatCustomerRate: number;
  trustScore: number;
  mechanicTier: string | null;
  jobsCompleted: number;
}

export interface BadgeDefinition {
  key: string;
  label: string;
  description: string;
  audience: BadgeAudience;
  check: (ctx: BadgeContext) => boolean;
}

/* -------------------------------------------------------------------------- */
/* Badge catalogue                                                            */
/* -------------------------------------------------------------------------- */

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  // ------ Mechanic badges ------
  {
    key: "top_rated",
    label: "Top Rated",
    description: "Maintains a 4.8+ overall rating across 10 or more reviews.",
    audience: "mechanic",
    check: (c) => c.reviewCount >= 10 && c.overallAvg >= 4.8,
  },
  {
    key: "trusted_mechanic",
    label: "Trusted Mechanic",
    description: "Trust score of 80 or higher.",
    audience: "mechanic",
    check: (c) => c.trustScore >= 80,
  },
  {
    key: "high_completion",
    label: "High Completion Rate",
    description: "Completes 95% or more of accepted jobs.",
    audience: "mechanic",
    check: (c) => c.jobsCompleted >= 5 && c.completionRate >= 0.95,
  },
  {
    key: "highly_recommended",
    label: "Highly Recommended",
    description: "Repeat customer rate of 30% or higher.",
    audience: "mechanic",
    check: (c) => c.jobsCompleted >= 10 && c.repeatCustomerRate >= 0.3,
  },
  {
    key: "master_technician",
    label: "Master Technician",
    description: "Holds the master mechanic tier.",
    audience: "mechanic",
    check: (c) => c.mechanicTier === "master",
  },
  // ------ Customer badges ------
  {
    key: "trusted_customer",
    label: "Trusted Customer",
    description: "Trust score of 75 or higher with at least 3 completed jobs.",
    audience: "customer",
    check: (c) => c.jobsCompleted >= 3 && c.trustScore >= 75,
  },
  {
    key: "repeat_customer",
    label: "Repeat Customer",
    description: "Has booked 3 or more jobs.",
    audience: "customer",
    check: (c) => c.jobsCompleted >= 3,
  },
  {
    key: "excellent_communication",
    label: "Excellent Communication",
    description: "Communication rating of 4.7+ across reviews.",
    audience: "customer",
    check: (c) => c.reviewCount >= 3 && (categoryAvg(c, "communication") ?? 0) >= 4.7,
  },
];

function categoryAvg(c: BadgeContext, _key: string): number | undefined {
  // Stub for future per-category badges. Full per-category averages live on
  // user_reputation.categoriesAvg; not threaded into ctx yet to keep the
  // engine cheap.
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Engine                                                                     */
/* -------------------------------------------------------------------------- */

export async function recomputeBadgesForUser(userId: number): Promise<void> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return;
  const [rep] = await db.select().from(userReputationTable).where(eq(userReputationTable.userId, userId));

  const ctx: BadgeContext = {
    userId,
    role: user.role,
    reviewCount: rep?.reviewCount ?? 0,
    overallAvg: rep ? Number(rep.overallAvg) : 0,
    completionRate: rep ? Number(rep.completionRate) : 0,
    cancellationRate: rep ? Number(rep.cancellationRate) : 0,
    noShowRate: rep ? Number(rep.noShowRate) : 0,
    repeatCustomerRate: rep ? Number(rep.repeatCustomerRate) : 0,
    trustScore: rep?.trustScore ?? 50,
    mechanicTier: user.mechanicTier ?? null,
    jobsCompleted: 0,
  };

  // jobsCompleted = paid jobs the user participated in.
  const jobsRows = await db.execute(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await import("drizzle-orm")).sql`
      SELECT COUNT(*)::int AS n FROM jobs
      WHERE status = 'PAID' AND (customer_id = ${userId} OR mechanic_id = ${userId})
    `,
  );
  ctx.jobsCompleted = ((jobsRows.rows[0] as { n?: number } | undefined)?.n) ?? 0;

  const active = await db.select().from(userBadgesTable)
    .where(and(eq(userBadgesTable.userId, userId), isNull(userBadgesTable.revokedAt)));
  const activeKeys = new Set(active.map((b) => b.badgeKey));

  for (const def of BADGE_DEFINITIONS) {
    if (def.audience !== "any" && def.audience !== ctx.role) continue;
    const shouldHave = def.check(ctx);
    const has = activeKeys.has(def.key);
    if (shouldHave && !has) {
      // Race-safe: the partial unique index `user_badges_active_uq` on
      // (user_id, badge_key) WHERE revoked_at IS NULL guarantees at most one
      // active row even under concurrent recomputes. onConflictDoNothing
      // makes parallel inserts idempotent.
      await db.insert(userBadgesTable).values({
        userId,
        badgeKey: def.key,
        criteriaSnapshot: {
          reviewCount: ctx.reviewCount,
          overallAvg: ctx.overallAvg,
          trustScore: ctx.trustScore,
          jobsCompleted: ctx.jobsCompleted,
        },
      }).onConflictDoNothing();
    } else if (!shouldHave && has) {
      await db.update(userBadgesTable)
        .set({ revokedAt: new Date(), revokedReason: "criteria_no_longer_met" })
        .where(and(
          eq(userBadgesTable.userId, userId),
          eq(userBadgesTable.badgeKey, def.key),
          isNull(userBadgesTable.revokedAt),
        ));
    }
  }
}

export function badgeMetadata(): { key: string; label: string; description: string; audience: BadgeAudience }[] {
  return BADGE_DEFINITIONS.map((b) => ({ key: b.key, label: b.label, description: b.description, audience: b.audience }));
}
