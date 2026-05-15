/**
 * Publishing engine — owns the `scheduled → published` transition.
 *
 * The scheduler tick picks up posts whose `status = 'scheduled'` and
 * `scheduledFor <= now()`, looks up the platform's posting provider, and
 * attempts to publish. On success: status moves to `published`, `published_at`
 * + `external_url` are stamped, `publish_attempt_count` is incremented, any
 * prior error is cleared.
 *
 * On failure: status stays `scheduled`, `last_publish_error` is stamped, and
 * `publish_attempt_count` is incremented so admins can see how many retries
 * we've burned. After MAX_ATTEMPTS, the post is bumped back to `approved` so
 * it doesn't loop forever (admin can re-schedule manually).
 *
 * Manual `publish-now` calls go through `publishOne()` directly so the admin
 * UI gets a synchronous error message instead of a silent retry.
 */
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  socialPostsTable,
  mediaAssetsTable,
  type SocialPost,
} from "@workspace/db";
import {
  getPostingProvider,
  PostingProviderNotConfiguredError,
  type PostingPlatform,
} from "./publishingProviders";
import { logger } from "./logger";

export const MAX_PUBLISH_ATTEMPTS = 5;
export const PUBLISH_SWEEP_BATCH = 10;
/**
 * In-flight cooldown — if a row was claimed less than this long ago, the
 * sweep skips it. Protects against re-attempting a post that's currently
 * hanging inside a slow provider call (the row keeps `status='scheduled'`
 * until the call returns).
 */
export const PUBLISH_IN_FLIGHT_MS = 5 * 60 * 1000;

export interface PublishOutcome {
  ok: boolean;
  postId: number;
  externalUrl?: string;
  error?: string;
  /** True if the post was downgraded to `approved` after exceeding MAX_PUBLISH_ATTEMPTS. */
  exhausted?: boolean;
}

/**
 * Publish a single post via its platform adapter. Atomically claims the
 * row first to prevent two scheduler ticks from racing on the same post.
 *
 * Returns ok=true on success, ok=false on a recoverable failure (admin can
 * see the error). Throws only for programmer errors (e.g. unknown post id).
 */
export async function publishOne(postId: number): Promise<PublishOutcome> {
  // Atomic claim: only proceed if the post is still in a publishable state.
  // We use a `last_publish_attempt_at = now()` stamp as the claim marker so
  // a concurrent sweep skips it (it'll see the recent attempt and back off).
  const claimedAt = new Date();
  const [claimed] = await db.update(socialPostsTable)
    .set({
      lastPublishAttemptAt: claimedAt,
      publishAttemptCount: sql`${socialPostsTable.publishAttemptCount} + 1`,
    })
    .where(and(
      eq(socialPostsTable.id, postId),
      // Only the row owner of "scheduled" or "approved" (manual publish-now)
      // can be picked up. `published`/`draft`/`rejected` are skipped.
      sql`${socialPostsTable.status} IN ('scheduled','approved')`,
    ))
    .returning();

  if (!claimed) {
    return { ok: false, postId, error: "post_not_publishable" };
  }

  const provider = getPostingProvider(claimed.platform as PostingPlatform);
  if (!provider) {
    return await markFailed(claimed, `no_provider_registered_for_${claimed.platform}`);
  }

  // Gather approved media assets so providers can attach them.
  const media = await db.select({ url: mediaAssetsTable.url })
    .from(mediaAssetsTable)
    .where(and(
      eq(mediaAssetsTable.socialPostId, claimed.id),
      eq(mediaAssetsTable.status, "approved"),
    ));
  const mediaUrls = media.map((m) => m.url).filter((u): u is string => !!u);

  try {
    const result = await provider.publish({ post: claimed, mediaUrls });
    const [done] = await db.update(socialPostsTable).set({
      status: "published",
      publishedAt: new Date(),
      externalUrl: result.externalUrl,
      lastPublishError: null,
    }).where(eq(socialPostsTable.id, claimed.id)).returning();
    logger.info({ postId: done?.id, externalUrl: result.externalUrl }, "post published");
    return { ok: true, postId: done?.id ?? claimed.id, externalUrl: result.externalUrl };
  } catch (err) {
    const reason = err instanceof PostingProviderNotConfiguredError
      ? err.message
      : err instanceof Error
        ? err.message
        : "unknown_publish_error";
    return await markFailed(claimed, reason);
  }
}

async function markFailed(claimed: SocialPost, reason: string): Promise<PublishOutcome> {
  const exhausted = claimed.publishAttemptCount >= MAX_PUBLISH_ATTEMPTS;
  await db.update(socialPostsTable).set({
    lastPublishError: reason,
    // Demote to `approved` after too many failures so admins can re-handle
    // it without it looping forever in the sweep.
    status: exhausted ? "approved" : claimed.status,
  }).where(eq(socialPostsTable.id, claimed.id));
  logger.warn({ postId: claimed.id, attempts: claimed.publishAttemptCount, reason, exhausted }, "publish attempt failed");
  return { ok: false, postId: claimed.id, error: reason, exhausted };
}

/**
 * Scheduler tick: publish all scheduled posts whose time has come.
 * Bounded by PUBLISH_SWEEP_BATCH to keep tick latency predictable.
 */
export async function sweepDuePublishes(now: Date = new Date()): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}> {
  // Skip rows whose last attempt was very recent — they're either currently
  // in-flight inside a provider call or about to be retried by another tick.
  const inFlightCutoff = new Date(now.getTime() - PUBLISH_IN_FLIGHT_MS);
  const due = await db.select({ id: socialPostsTable.id })
    .from(socialPostsTable)
    .where(and(
      eq(socialPostsTable.status, "scheduled"),
      lte(socialPostsTable.scheduledFor, now),
      or(
        isNull(socialPostsTable.lastPublishAttemptAt),
        lte(socialPostsTable.lastPublishAttemptAt, inFlightCutoff),
      ),
    ))
    .limit(PUBLISH_SWEEP_BATCH);

  let succeeded = 0, failed = 0;
  for (const r of due) {
    const out = await publishOne(r.id).catch((err) => {
      logger.error({ err, postId: r.id }, "publishOne threw");
      return { ok: false, postId: r.id, error: "exception" } satisfies PublishOutcome;
    });
    if (out.ok) succeeded += 1; else failed += 1;
  }
  return { attempted: due.length, succeeded, failed };
}
