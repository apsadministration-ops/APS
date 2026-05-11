/**
 * Review visibility lock helpers.
 *
 * A review is `hidden` until either:
 *   1. Both directions of the same job have submitted a review, OR
 *   2. The 72-hour `visible_at` deadline passes.
 *
 * Whenever a review is created we run `flipBothIfReady(jobId)` which checks
 * if the counterpart exists and, if so, flips both rows to `visible` in one
 * UPDATE. A periodic sweeper handles the 72h fallback for un-reciprocated
 * reviews. We also lazily flip on read in `loadVisibleReviewsForSubject`.
 */

import { and, eq, lte, ne, sql } from "drizzle-orm";
import { db, reviewsTable, reviewAuditLogsTable } from "@workspace/db";
import { recomputeUserReputation } from "./reputationEngine";
import { recomputeBadgesForUser } from "./badgeEngine";

export const REVIEW_LOCK_HOURS = 72;

/**
 * After a review is inserted: if the counterpart for the same job already
 * exists, publish BOTH atomically. Returns the set of subject IDs that need
 * reputation recompute.
 */
export async function publishIfReciprocated(jobId: number): Promise<number[]> {
  const rows = await db.select().from(reviewsTable).where(eq(reviewsTable.jobId, jobId));
  if (rows.length < 2) return [];
  // Both sides present → unhide.
  const updated = await db.update(reviewsTable)
    .set({ visibility: "visible" })
    .where(and(eq(reviewsTable.jobId, jobId), eq(reviewsTable.visibility, "hidden")))
    .returning();
  for (const r of updated) {
    await db.insert(reviewAuditLogsTable).values({
      reviewId: r.id,
      action: "auto_published",
      actorRole: "system",
      reason: "reciprocated",
    });
  }
  return Array.from(new Set(updated.map((r) => r.subjectId)));
}

/**
 * Periodic sweeper: publish any hidden reviews whose 72h window has passed.
 * Safe to call from a cron tick or lazily before a hot read. Returns the
 * list of subjects whose reputation should be recomputed.
 */
export async function publishExpiredHiddenReviews(): Promise<number[]> {
  const now = new Date();
  const updated = await db.update(reviewsTable)
    .set({ visibility: "visible" })
    .where(and(
      eq(reviewsTable.visibility, "hidden"),
      lte(reviewsTable.visibleAt, now),
    ))
    .returning();
  for (const r of updated) {
    await db.insert(reviewAuditLogsTable).values({
      reviewId: r.id,
      action: "auto_published",
      actorRole: "system",
      reason: "lock_expired",
    });
  }
  const subjects = Array.from(new Set(updated.map((r) => r.subjectId)));
  for (const s of subjects) {
    await recomputeUserReputation(s);
    await recomputeBadgesForUser(s);
  }
  return subjects;
}

/**
 * Whether the requesting user is allowed to see a `hidden` review's contents.
 * Author always sees their own; admins see everything; otherwise hidden
 * means hidden.
 */
export function canSeeHidden(review: { authorId: number }, viewer: { id: number; role: string }): boolean {
  if (viewer.role === "admin") return true;
  return viewer.id === review.authorId;
}

/**
 * Convenience: have we (the viewer) already submitted a review for this
 * job? Used to mask the counterpart's review until we've left ours.
 */
export async function hasSubmittedReviewForJob(jobId: number, authorId: number): Promise<boolean> {
  const [row] = await db.select({ id: reviewsTable.id }).from(reviewsTable)
    .where(and(eq(reviewsTable.jobId, jobId), eq(reviewsTable.authorId, authorId)));
  return Boolean(row);
}

/** Mark a review as removed (moderation). Reputation must be recomputed by caller. */
export async function moderateRemove(
  reviewId: number,
  actorId: number,
  reason: string,
): Promise<{ subjectId: number } | null> {
  const [before] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, reviewId));
  if (!before) return null;
  const [after] = await db.update(reviewsTable)
    .set({ visibility: "removed", removedAt: new Date(), removedBy: actorId, removedReason: reason })
    .where(and(eq(reviewsTable.id, reviewId), ne(reviewsTable.visibility, "removed")))
    .returning();
  if (!after) return null;
  await db.insert(reviewAuditLogsTable).values({
    reviewId,
    action: "moderated",
    actorId,
    actorRole: "admin",
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
    reason,
  });
  return { subjectId: before.subjectId };
}

// drizzle-orm `sql` re-export so callers can build raw fragments without
// re-importing — keeps engine glue self-contained.
export { sql };
