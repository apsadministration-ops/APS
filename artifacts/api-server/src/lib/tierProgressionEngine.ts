/**
 * Tier Progression Engine
 *
 * Data-driven, rule-based mechanic tier progression. Single source of truth
 * for evaluating eligibility and performing automatic promotions.
 *
 * Tier ladder (internal name → spec name):
 *   detailer    → TIER 1 Detailer
 *   technician  → TIER 2 Basic Mechanic
 *   senior      → TIER 3 Intermediate Mechanic
 *   advanced    → TIER 4 Advanced Mechanic
 *   master      → TIER 5 Master Mechanic
 *
 * Promotion principles:
 *  - Append-only: every promotion writes a row to tier_promotions.
 *  - Atomic: tier change + audit row happen in one DB transaction.
 *  - Idempotent: running the engine multiple times for the same mechanic is a no-op
 *    once they're at their highest qualifying tier.
 *  - Master tier promotions are flagged for admin review (autoApply=false) — every
 *    other tier promotes automatically when thresholds are met.
 *  - Disciplinary state (unresolved flags) blocks all upward movement.
 */

import { and, eq, count, avg, isNotNull } from "drizzle-orm";
import {
  db,
  usersTable,
  jobsTable,
  flagsTable,
  mechanicCertificationsTable,
  tierPromotionsTable,
} from "@workspace/db";
import type { Logger } from "pino";

export type MechanicTier = "detailer" | "technician" | "senior" | "advanced" | "master";

export const TIER_ORDER: MechanicTier[] = ["detailer", "technician", "senior", "advanced", "master"];

export const MECHANIC_TIER_LABELS: Record<MechanicTier, string> = {
  detailer: "Detailer",
  technician: "Basic Mechanic",
  senior: "Intermediate Mechanic",
  advanced: "Advanced Mechanic",
  master: "Master Mechanic",
};

export interface MechanicMetrics {
  completedJobs: number;
  averageRating: number | null;
  ratingCount: number;
  unresolvedFlags: number;
  verifiedCertifications: number;
  verifiedAdvancedCertifications: number;
  pendingCertifications: number;
}

export interface PromotionRule {
  from: MechanicTier;
  to: MechanicTier;
  /** Human-readable summary used in promotion audit log + UI. */
  summary: string;
  /** Returns null if eligible, otherwise an array of human-readable blockers. */
  evaluate: (m: MechanicMetrics) => string[] | null;
  /** When false, eligibility flags the mechanic for admin review instead of auto-promoting. */
  autoApply: boolean;
  thresholds: {
    minCompletedJobs?: number;
    minAverageRating?: number;
    minRatingCount?: number;
    minVerifiedCertifications?: number;
    minVerifiedAdvancedCertifications?: number;
  };
}

const noUnresolvedFlags = (m: MechanicMetrics): string | null =>
  m.unresolvedFlags > 0 ? `${m.unresolvedFlags} unresolved disciplinary flag(s)` : null;

export const PROMOTION_RULES: PromotionRule[] = [
  {
    from: "detailer",
    to: "technician",
    summary: "≥1 verified certification + clean disciplinary record",
    autoApply: true,
    thresholds: { minVerifiedCertifications: 1 },
    evaluate: (m) => {
      const blockers: string[] = [];
      if (m.verifiedCertifications < 1) blockers.push("Upload and verify at least 1 automotive certification or training credential.");
      const flag = noUnresolvedFlags(m); if (flag) blockers.push(flag);
      return blockers.length === 0 ? null : blockers;
    },
  },
  {
    from: "technician",
    to: "senior",
    summary: "≥10 paid jobs · avg rating ≥4.0 (≥5 reviews) · clean disciplinary record",
    autoApply: true,
    thresholds: { minCompletedJobs: 10, minAverageRating: 4.0, minRatingCount: 5 },
    evaluate: (m) => {
      const blockers: string[] = [];
      if (m.completedJobs < 10) blockers.push(`Complete at least 10 paid jobs (currently ${m.completedJobs}).`);
      if (m.ratingCount < 5) blockers.push(`Receive at least 5 customer ratings (currently ${m.ratingCount}).`);
      if ((m.averageRating ?? 0) < 4.0) blockers.push(`Maintain an average rating of 4.0 or higher (currently ${m.averageRating?.toFixed(2) ?? "n/a"}).`);
      const flag = noUnresolvedFlags(m); if (flag) blockers.push(flag);
      return blockers.length === 0 ? null : blockers;
    },
  },
  {
    from: "senior",
    to: "advanced",
    summary: "≥30 paid jobs · avg rating ≥4.3 (≥15 reviews) · clean disciplinary record (verified cert accelerates)",
    autoApply: true,
    thresholds: { minCompletedJobs: 30, minAverageRating: 4.3, minRatingCount: 15 },
    evaluate: (m) => {
      const blockers: string[] = [];
      // Verified advanced certification cuts the job requirement in half.
      const jobThreshold = m.verifiedAdvancedCertifications >= 1 ? 15 : 30;
      const reviewThreshold = m.verifiedAdvancedCertifications >= 1 ? 8 : 15;
      if (m.completedJobs < jobThreshold) blockers.push(`Complete at least ${jobThreshold} paid jobs (currently ${m.completedJobs}).`);
      if (m.ratingCount < reviewThreshold) blockers.push(`Receive at least ${reviewThreshold} customer ratings (currently ${m.ratingCount}).`);
      if ((m.averageRating ?? 0) < 4.3) blockers.push(`Maintain an average rating of 4.3 or higher (currently ${m.averageRating?.toFixed(2) ?? "n/a"}).`);
      const flag = noUnresolvedFlags(m); if (flag) blockers.push(flag);
      return blockers.length === 0 ? null : blockers;
    },
  },
  {
    from: "advanced",
    to: "master",
    summary: "≥75 paid jobs · avg rating ≥4.6 (≥30 reviews) · ≥1 verified advanced certification — admin verification required",
    // Master tier requires admin sign-off. Engine surfaces the candidate; admin endpoint promotes.
    autoApply: false,
    thresholds: { minCompletedJobs: 75, minAverageRating: 4.6, minRatingCount: 30, minVerifiedAdvancedCertifications: 1 },
    evaluate: (m) => {
      const blockers: string[] = [];
      if (m.completedJobs < 75) blockers.push(`Complete at least 75 paid jobs (currently ${m.completedJobs}).`);
      if (m.ratingCount < 30) blockers.push(`Receive at least 30 customer ratings (currently ${m.ratingCount}).`);
      if ((m.averageRating ?? 0) < 4.6) blockers.push(`Maintain an average rating of 4.6 or higher (currently ${m.averageRating?.toFixed(2) ?? "n/a"}).`);
      if (m.verifiedAdvancedCertifications < 1) blockers.push("Upload and verify at least 1 advanced/master-class certification (e.g. ASE A1–A8 or equivalent).");
      const flag = noUnresolvedFlags(m); if (flag) blockers.push(flag);
      return blockers.length === 0 ? null : blockers;
    },
  },
];

export async function loadMechanicMetrics(mechanicId: number): Promise<MechanicMetrics> {
  const [done] = await db
    .select({ n: count(jobsTable.id).as("n") })
    .from(jobsTable)
    .where(and(eq(jobsTable.mechanicId, mechanicId), eq(jobsTable.status, "PAID")));

  const [stats] = await db
    .select({ avg: avg(jobsTable.rating).as("avg"), n: count(jobsTable.id).as("n") })
    .from(jobsTable)
    .where(and(eq(jobsTable.mechanicId, mechanicId), isNotNull(jobsTable.rating)));

  const [flagged] = await db
    .select({ n: count(flagsTable.id).as("n") })
    .from(flagsTable)
    .where(and(eq(flagsTable.targetId, mechanicId), eq(flagsTable.resolved, false)));

  const certs = await db
    .select()
    .from(mechanicCertificationsTable)
    .where(eq(mechanicCertificationsTable.mechanicId, mechanicId));

  const verified = certs.filter((c) => c.status === "verified");
  const verifiedAdvanced = verified.filter((c) => c.skillLevel === "advanced");
  const pending = certs.filter((c) => c.status === "pending");

  return {
    completedJobs: Number(done?.n ?? 0),
    averageRating: stats?.avg != null ? Number(stats.avg) : null,
    ratingCount: Number(stats?.n ?? 0),
    unresolvedFlags: Number(flagged?.n ?? 0),
    verifiedCertifications: verified.length,
    verifiedAdvancedCertifications: verifiedAdvanced.length,
    pendingCertifications: pending.length,
  };
}

export interface NextTierEvaluation {
  from: MechanicTier;
  to: MechanicTier;
  summary: string;
  thresholds: PromotionRule["thresholds"];
  blockers: string[] | null;
  autoApply: boolean;
  /** True when blockers === null AND the rule is auto-apply; false when only flagged for admin. */
  promotedAutomatically?: boolean;
}

export interface ProgressionEvaluation {
  mechanicId: number;
  currentTier: MechanicTier;
  metrics: MechanicMetrics;
  next: NextTierEvaluation | null;
  /** True if currentTier === "master" — top of the ladder. */
  atMaxTier: boolean;
  /** True when an automatic promotion just occurred during this evaluation. */
  promoted: boolean;
  promotedTo?: MechanicTier;
  /** True when the mechanic is eligible for master and is now flagged for admin review. */
  flaggedForAdminReview: boolean;
}

export async function evaluateMechanic(mechanicId: number): Promise<ProgressionEvaluation> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, mechanicId));
  if (!user || user.role !== "mechanic") {
    throw new Error(`User ${mechanicId} is not a mechanic`);
  }
  const currentTier = (user.mechanicTier ?? "detailer") as MechanicTier;
  const metrics = await loadMechanicMetrics(mechanicId);

  if (currentTier === "master") {
    return {
      mechanicId, currentTier, metrics,
      next: null, atMaxTier: true, promoted: false, flaggedForAdminReview: false,
    };
  }

  const rule = PROMOTION_RULES.find((r) => r.from === currentTier);
  if (!rule) {
    return { mechanicId, currentTier, metrics, next: null, atMaxTier: true, promoted: false, flaggedForAdminReview: false };
  }
  const blockers = rule.evaluate(metrics);

  return {
    mechanicId, currentTier, metrics,
    next: {
      from: rule.from, to: rule.to, summary: rule.summary,
      thresholds: rule.thresholds, blockers, autoApply: rule.autoApply,
    },
    atMaxTier: false, promoted: false, flaggedForAdminReview: false,
  };
}

/**
 * Evaluate, then auto-promote (or flag for admin) if eligible. Writes a
 * tier_promotions audit row and updates users.mechanic_tier atomically.
 *
 * `trigger` describes WHAT caused this evaluation (e.g. "job_paid",
 * "certification_verified", "admin_request"). It's stored in the audit log.
 *
 * Returns the resulting evaluation. If a promotion happened, `promoted` is true
 * and the user record reflects the new tier.
 */
export async function runProgression(
  mechanicId: number,
  trigger: string,
  opts: { adminId?: number; logger?: Logger } = {},
): Promise<ProgressionEvaluation> {
  const evaluation = await evaluateMechanic(mechanicId);
  if (!evaluation.next || evaluation.next.blockers !== null && evaluation.next.blockers.length > 0) {
    return evaluation;
  }
  if (evaluation.next.blockers !== null) {
    return evaluation;
  }
  // Eligible — either auto-promote or flag.
  const rule = evaluation.next;
  if (!rule.autoApply) {
    // Master-tier candidate. Surface but don't promote.
    return { ...evaluation, flaggedForAdminReview: true };
  }
  // Auto-promote inside a transaction. Lock the user row, then conditionally
  // update on the expected from-tier so concurrent triggers cannot double-promote.
  return await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, mechanicId))
      .for("update");
    if (!fresh || (fresh.mechanicTier ?? "detailer") !== rule.from) {
      // Tier changed beneath us; bail.
      return evaluation;
    }
    const updated = await tx
      .update(usersTable)
      .set({ mechanicTier: rule.to, status: "active" })
      .where(and(eq(usersTable.id, mechanicId), eq(usersTable.mechanicTier, rule.from)))
      .returning({ id: usersTable.id });
    if (updated.length === 0) {
      // Lost the race to another transaction.
      return evaluation;
    }
    await tx.insert(tierPromotionsTable).values({
      mechanicId,
      previousTier: rule.from,
      newTier: rule.to,
      reason: rule.summary,
      trigger: opts.adminId ? "admin" : "system",
      metricsSnapshot: evaluation.metrics,
      triggeredBy: opts.adminId ?? null,
    });
    opts.logger?.info({ mechanicId, from: rule.from, to: rule.to, trigger }, "tier promotion");
    return {
      ...evaluation,
      currentTier: rule.to,
      promoted: true,
      promotedTo: rule.to,
      next: null,
    };
  });
}

/**
 * Admin-only: force-promote a mechanic to master once an automatic eligibility
 * has flagged them. Validates that the engine evaluation is positive before
 * applying — admins cannot bypass thresholds.
 */
export async function adminPromoteToMaster(
  mechanicId: number,
  adminId: number,
  opts: { logger?: Logger; bypassThresholds?: boolean } = {},
): Promise<ProgressionEvaluation> {
  const evaluation = await evaluateMechanic(mechanicId);
  if (evaluation.currentTier !== "advanced") {
    throw new Error(`Mechanic ${mechanicId} must be at 'advanced' tier to be promoted to master (currently ${evaluation.currentTier})`);
  }
  if (!opts.bypassThresholds) {
    const blockers = evaluation.next?.blockers ?? null;
    if (blockers !== null && blockers.length > 0) {
      throw new Error(`Mechanic ${mechanicId} not eligible for master promotion: ${blockers.join("; ")}`);
    }
  }
  return await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, mechanicId))
      .for("update");
    if (!fresh || (fresh.mechanicTier ?? "detailer") !== "advanced") {
      throw new Error(`Mechanic ${mechanicId} is no longer at 'advanced' tier (currently ${fresh?.mechanicTier ?? "unknown"})`);
    }
    const updated = await tx
      .update(usersTable)
      .set({ mechanicTier: "master", status: "active" })
      .where(and(eq(usersTable.id, mechanicId), eq(usersTable.mechanicTier, "advanced")))
      .returning({ id: usersTable.id });
    if (updated.length === 0) {
      throw new Error(`Mechanic ${mechanicId} promotion lost a concurrent update race; please retry.`);
    }
    await tx.insert(tierPromotionsTable).values({
      mechanicId,
      previousTier: "advanced",
      newTier: "master",
      reason: opts.bypassThresholds
        ? "Admin override — thresholds bypassed"
        : "Admin verification of master-tier eligibility",
      trigger: "admin",
      metricsSnapshot: evaluation.metrics,
      triggeredBy: adminId,
    });
    opts.logger?.info({ mechanicId, adminId, bypass: !!opts.bypassThresholds }, "admin promotion to master");
    return { ...evaluation, currentTier: "master", promoted: true, promotedTo: "master", next: null, atMaxTier: true };
  });
}
