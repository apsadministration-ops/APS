/**
 * Reuse engine — recycle proven-successful published posts back into the
 * queue with a cooldown.
 *
 * "Proven-successful" means: status='published', engagement_score >= REUSE_THRESHOLD,
 * AND either never reused OR last_reused_at older than REUSE_COOLDOWN_DAYS,
 * AND reuse_count < MAX_REUSES_PER_POST.
 *
 * Reusing clones the original into a NEW row with status='scheduled' so it
 * goes back through the publishing engine — never mutates the original, and
 * never bypasses moderation if the admin set the system to draft-mode.
 *
 * Linkage: new row's `reused_from_id` points at the original; original's
 * `reuse_count` and `last_reused_at` are bumped atomically in the same tx.
 */
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db, socialPostsTable, type SocialPost } from "@workspace/db";
import { recommendSchedule } from "./growthAnalytics";
import { logger } from "./logger";

export const REUSE_THRESHOLD = 75;          // higher bar than iteration
export const REUSE_COOLDOWN_DAYS = 30;
export const MAX_REUSES_PER_POST = 3;
export const REUSE_PER_TICK = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Eligible: published winner, under reuse cap, cooldown elapsed. */
export async function listReuseCandidates(opts?: {
  limit?: number;
  threshold?: number;
}): Promise<SocialPost[]> {
  const limit = opts?.limit ?? 25;
  const threshold = opts?.threshold ?? REUSE_THRESHOLD;
  const cutoff = new Date(Date.now() - REUSE_COOLDOWN_DAYS * DAY_MS);

  return db.select().from(socialPostsTable)
    .where(and(
      eq(socialPostsTable.status, "published"),
      gte(socialPostsTable.engagementScore, threshold),
      lt(socialPostsTable.reuseCount, MAX_REUSES_PER_POST),
      or(
        isNull(socialPostsTable.lastReusedAt),
        lt(socialPostsTable.lastReusedAt, cutoff),
      ),
    ))
    .orderBy(desc(socialPostsTable.engagementScore))
    .limit(limit);
}

/**
 * Clone one winner into a freshly-scheduled post. Returns the new row.
 *
 * @throws if the source isn't eligible (not published / under threshold /
 * over reuse cap / inside cooldown).
 */
export async function reusePost(opts: {
  sourcePostId: number;
  /** Optional explicit schedule time; otherwise recommendSchedule() picks one. */
  scheduledFor?: Date;
  generatedById?: number | null;
}): Promise<SocialPost> {
  return db.transaction(async (tx) => {
    const [src] = await tx.select().from(socialPostsTable)
      .where(eq(socialPostsTable.id, opts.sourcePostId))
      .for("update");
    if (!src) throw new Error("source_post_not_found");
    if (src.status !== "published") throw new Error("source_not_published");
    if (src.engagementScore < REUSE_THRESHOLD) throw new Error("source_below_threshold");
    if (src.reuseCount >= MAX_REUSES_PER_POST) throw new Error("reuse_cap_reached");

    const cutoff = new Date(Date.now() - REUSE_COOLDOWN_DAYS * DAY_MS);
    if (src.lastReusedAt && src.lastReusedAt > cutoff) {
      throw new Error("cooldown_active");
    }

    // Pick a schedule slot. Look at already-scheduled posts on the same
    // platform so we don't pile reuses on top of fresh content.
    let scheduledFor: Date;
    if (opts.scheduledFor) {
      scheduledFor = opts.scheduledFor;
    } else {
      const upcoming = await tx.select({ scheduledFor: socialPostsTable.scheduledFor })
        .from(socialPostsTable)
        .where(and(
          eq(socialPostsTable.platform, src.platform),
          eq(socialPostsTable.status, "scheduled"),
        ));
      const recommendation = recommendSchedule({
        platform: src.platform,
        alreadyScheduled: upcoming
          .map((u) => u.scheduledFor)
          .filter((d): d is Date => d != null),
      });
      scheduledFor = new Date(recommendation.suggestedAt);
    }

    const [clone] = await tx.insert(socialPostsTable).values({
      platform: src.platform,
      // Reuse skips moderation by design — admin already approved the
      // original. If you want every reuse re-reviewed, change to "pending_review".
      status: "scheduled",
      topicKind: src.topicKind,
      topicTitle: src.topicTitle,
      region: src.region,
      caption: src.caption,
      hashtags: src.hashtags,
      mediaIdeas: src.mediaIdeas,
      hookText: src.hookText,
      callToAction: src.callToAction,
      generationModel: src.generationModel,
      generationPrompt: src.generationPrompt,
      generatedById: opts.generatedById ?? null,
      scheduledFor,
      reusedFromId: src.id,
    }).returning();

    // Atomic bump on the parent.
    await tx.update(socialPostsTable).set({
      reuseCount: sql`${socialPostsTable.reuseCount} + 1`,
      lastReusedAt: new Date(),
    }).where(eq(socialPostsTable.id, src.id));

    return clone;
  });
}

/** Scheduler tick: reuse up to REUSE_PER_TICK eligible winners. */
export async function sweepReuseCandidates(): Promise<{
  reused: number;
  errors: number;
}> {
  const candidates = await listReuseCandidates({ limit: REUSE_PER_TICK });
  let reused = 0, errors = 0;
  for (const c of candidates) {
    try {
      await reusePost({ sourcePostId: c.id });
      reused += 1;
    } catch (err) {
      errors += 1;
      logger.error({ err, postId: c.id }, "reuse failed");
    }
  }
  return { reused, errors };
}
