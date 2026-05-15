/**
 * Iteration engine — analytics-driven auto-iteration of winning posts.
 *
 * A "winner" is a published social post whose engagement score is at or
 * above WINNER_THRESHOLD. Iterating a winner clones its topic/platform/
 * region into a fresh draft, calls `generateContent()` for a new caption +
 * hashtags + media ideas, and links the new draft back via `parent_post_id`.
 *
 * Guardrails:
 *   - We mark the parent with `iterated_at` and refuse to iterate the same
 *     winner twice (idempotent across calls + the periodic sweep).
 *   - Sweep generates at most ITERATE_PER_TICK new drafts per run so we
 *     don't flood the review queue or burn the AI budget.
 *   - All new drafts land in `pending_review` — admin still has to approve
 *     before anything publishes. The engine never bypasses moderation.
 */
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, socialPostsTable, type SocialPost } from "@workspace/db";
import { generateContent, type Platform, type TopicKind } from "./contentEngine";
import { logger } from "./logger";

/** Same weighting used in growthAnalytics.getEngagementSnapshot(). */
export function engagementScore(e: SocialPost["engagement"]): number {
  return (
    (e.likes ?? 0) +
    (e.shares ?? 0) * 4 +
    (e.comments ?? 0) * 3 +
    (e.saves ?? 0) * 5 +
    (e.clicks ?? 0) * 6
  );
}

export const WINNER_THRESHOLD = 50;
export const ITERATE_PER_TICK = 3;
export const WINNER_LOOKBACK_DAYS = 30;

/**
 * Recompute + persist `engagement_score` for a single post. Called whenever
 * an admin patches engagement metrics so the index stays useful. Cheap.
 */
export async function recomputeEngagementScore(postId: number): Promise<number> {
  const [row] = await db
    .select({ engagement: socialPostsTable.engagement })
    .from(socialPostsTable)
    .where(eq(socialPostsTable.id, postId));
  if (!row) return 0;
  const score = engagementScore(row.engagement);
  await db.update(socialPostsTable)
    .set({ engagementScore: score })
    .where(eq(socialPostsTable.id, postId));
  return score;
}

/**
 * Iterate one winning post. Returns the newly-created draft post.
 *
 * @throws if the source post is not eligible (not published, score below
 * threshold, or already iterated).
 */
export async function iteratePost(opts: {
  sourcePostId: number;
  generatedById?: number | null;
  /** Force iteration even if already iterated. Use for "iterate again". */
  force?: boolean;
}): Promise<SocialPost> {
  return db.transaction(async (tx) => {
    const [src] = await tx
      .select()
      .from(socialPostsTable)
      .where(eq(socialPostsTable.id, opts.sourcePostId))
      .for("update");
    if (!src) throw new Error("source_post_not_found");
    if (src.status !== "published") throw new Error("source_not_published");
    if (!opts.force && src.iteratedAt) throw new Error("already_iterated");

    const score = engagementScore(src.engagement);

    // Generate a fresh variant from the same topic/platform/region.
    const variant = await generateContent({
      platform: src.platform as Platform,
      topicKind: src.topicKind as TopicKind,
      region: src.region ?? undefined,
      // Tell the model this is a winner variant so it keeps the same angle
      // but writes a distinct hook + caption.
      briefingContext: `Iteration of high-performing post #${src.id} (engagement score ${score}). Keep the same topic angle and audience, but write a fresh hook and caption — must not duplicate the original wording. Original CTA: ${src.callToAction ?? "n/a"}. Original hook: ${src.hookText ?? "n/a"}.`,
    });

    const [draft] = await tx.insert(socialPostsTable).values({
      platform: src.platform,
      status: "pending_review",
      topicKind: src.topicKind,
      topicTitle: src.topicTitle,
      region: src.region,
      caption: variant.caption,
      hashtags: variant.hashtags,
      mediaIdeas: variant.mediaIdeas,
      hookText: variant.hookText,
      callToAction: variant.callToAction,
      generationModel: variant.model,
      generationPrompt: variant.prompt,
      generatedById: opts.generatedById ?? null,
      parentPostId: src.id,
    }).returning();

    // Stamp the parent so the sweep skips it next tick. Use the row from the
    // tx so we never overwrite a concurrent iteratedAt.
    const stampClause = opts.force
      ? eq(socialPostsTable.id, src.id)
      : and(eq(socialPostsTable.id, src.id), isNull(socialPostsTable.iteratedAt));
    await tx.update(socialPostsTable)
      .set({ iteratedAt: new Date() })
      .where(stampClause);

    return draft;
  });
}

/**
 * Find published winners that haven't been iterated yet. Sorted by score
 * desc so the best content gets the first variant slot.
 */
export async function listWinnerCandidates(opts?: {
  limit?: number;
  threshold?: number;
}): Promise<SocialPost[]> {
  const limit = opts?.limit ?? 25;
  const threshold = opts?.threshold ?? WINNER_THRESHOLD;
  const since = new Date(Date.now() - WINNER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return db.select().from(socialPostsTable)
    .where(and(
      eq(socialPostsTable.status, "published"),
      gte(socialPostsTable.engagementScore, threshold),
      gte(socialPostsTable.publishedAt, since),
    ))
    .orderBy(desc(socialPostsTable.engagementScore))
    .limit(limit);
}

/**
 * Scheduler tick. Iterates up to ITERATE_PER_TICK eligible winners that
 * haven't been iterated yet. Caller catches errors per post so a bad row
 * never stops the rest of the sweep.
 */
export async function sweepWinnerIterations(): Promise<{
  iterated: number;
  errors: number;
}> {
  const since = new Date(Date.now() - WINNER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.select({ id: socialPostsTable.id })
    .from(socialPostsTable)
    .where(and(
      eq(socialPostsTable.status, "published"),
      gte(socialPostsTable.engagementScore, WINNER_THRESHOLD),
      gte(socialPostsTable.publishedAt, since),
      isNull(socialPostsTable.iteratedAt),
    ))
    .orderBy(desc(socialPostsTable.engagementScore))
    .limit(ITERATE_PER_TICK);

  let iterated = 0;
  let errors = 0;
  for (const r of rows) {
    try {
      await iteratePost({ sourcePostId: r.id });
      iterated += 1;
    } catch (err) {
      errors += 1;
      logger.error({ err, postId: r.id }, "winner iteration failed");
    }
  }
  return { iterated, errors };
}

/**
 * Backfill `engagement_score` for any post where the cached value is stale.
 * Run once at boot so winners that pre-date this engine become eligible.
 */
export async function backfillEngagementScores(): Promise<number> {
  const rows = await db.select({
    id: socialPostsTable.id,
    engagement: socialPostsTable.engagement,
    cached: socialPostsTable.engagementScore,
  }).from(socialPostsTable)
    .where(eq(socialPostsTable.status, "published"));

  let updated = 0;
  for (const r of rows) {
    const fresh = engagementScore(r.engagement);
    if (fresh !== r.cached) {
      await db.update(socialPostsTable)
        .set({ engagementScore: fresh })
        .where(eq(socialPostsTable.id, r.id));
      updated += 1;
    }
  }
  return updated;
}

// Silence the unused-import warning for `sql` — kept in scope for future
// raw-SQL helpers without re-importing.
void sql;
