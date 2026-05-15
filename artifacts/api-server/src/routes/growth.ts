/**
 * APS Growth Intelligence Center — admin-only API.
 *
 *   GET    /admin/growth/overview               — Acquisition Overview Dashboard
 *   GET    /admin/growth/referrals              — Referral Intelligence
 *   GET    /admin/growth/regions                — Regional Density Intelligence
 *   GET    /admin/growth/balance                — Marketplace Balancing recommendations
 *   GET    /admin/growth/cpa                    — Growth Analytics & CPA Tracking
 *   GET    /admin/growth/engagement             — Engagement & Conversion Intelligence
 *   GET    /admin/growth/amplification          — Mechanic Amplification leaderboard
 *   GET    /admin/growth/trends                 — AI-generated trend & seasonal opportunities
 *   GET    /admin/growth/topics                 — Available topic kinds + labels
 *
 *   POST   /admin/growth/content/generate       — Generate a single post (queue: pending_review)
 *   POST   /admin/growth/content/generate-batch — Generate posts across platforms for one topic
 *   GET    /admin/growth/content                — List queue (status filter)
 *   GET    /admin/growth/content/:id            — Single post
 *   PATCH  /admin/growth/content/:id            — Edit caption/hashtags/etc (only when not published)
 *   POST   /admin/growth/content/:id/approve    — Move pending_review → approved
 *   POST   /admin/growth/content/:id/reject     — Move → rejected
 *   POST   /admin/growth/content/:id/schedule   — Set scheduled_for (must be approved)
 *   POST   /admin/growth/content/:id/publish    — Mark as published (manual; record external_url)
 *   POST   /admin/growth/content/:id/engagement — Record performance metrics for a published post
 *   POST   /admin/growth/content/:id/recommend-time — AI-recommended posting time
 *   DELETE /admin/growth/content/:id            — Delete a draft/rejected post
 */

import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  db, socialPostsTable, mechanicAmplificationTable, usersTable,
  type SocialPost,
} from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";
import {
  getAcquisitionOverview,
  getReferralIntelligence,
  getRegionalDensity,
  getCpaSnapshot,
  getEngagementSnapshot,
  getMechanicAmplification,
  recommendSchedule,
  getRecentSignups,
} from "../lib/growthAnalytics";
import {
  generateContent,
  generateMechanicContent,
  suggestTrendingTopics,
  recommendForBalance,
  TOPIC_KINDS,
  TOPIC_LABELS,
  PLATFORM_LABELS,
  type Platform,
  type TopicKind,
} from "../lib/contentEngine";
import {
  getAdminGrowthSettings,
  updateAdminGrowthSettings,
  assertAiGenerationAllowed,
  PolicyError,
  AI_RESTRICTIONS,
  ADMIN_PERMISSIONS,
} from "../lib/adminGrowthPolicy";
import { buildAmplificationKit } from "../lib/mechanicAmplification";
import { FUTURE_CAPABILITIES } from "../lib/_futureGrowth";
import {
  iteratePost,
  listWinnerCandidates,
  engagementScore as engagementScoreOf,
  WINNER_THRESHOLD,
} from "../lib/iterationEngine";
import {
  reusePost,
  listReuseCandidates,
  REUSE_THRESHOLD,
  REUSE_COOLDOWN_DAYS,
  MAX_REUSES_PER_POST,
} from "../lib/reuseEngine";
import { publishOne } from "../lib/publishingEngine";
import { sql as drizzleSql } from "drizzle-orm";
import { mediaAssetsTable } from "@workspace/db";

const router: IRouter = Router();

// All endpoints below require admin role.
router.use("/admin/growth", authenticate, requireRole("admin"));

const PLATFORMS: Platform[] = ["facebook", "instagram", "tiktok", "twitter"];

/* -------------------------------------------------------------------------- */
/* Dashboards                                                                 */
/* -------------------------------------------------------------------------- */

router.get("/admin/growth/overview", async (_req: AuthRequest, res): Promise<void> => {
  const [overview, recent] = await Promise.all([getAcquisitionOverview(), getRecentSignups(10)]);
  res.json({ ...overview, recentSignups: recent });
});

router.get("/admin/growth/referrals", async (_req: AuthRequest, res): Promise<void> => {
  res.json(await getReferralIntelligence());
});

router.get("/admin/growth/regions", async (_req: AuthRequest, res): Promise<void> => {
  res.json(await getRegionalDensity());
});

router.get("/admin/growth/balance", async (_req: AuthRequest, res): Promise<void> => {
  const regions = await getRegionalDensity();
  const recs = regions.slice(0, 12).map((r) => recommendForBalance({
    region: r.region,
    customerCount: r.customerCount,
    mechanicCount: r.mechanicCount,
    jobsLast30: r.jobsLast30,
    averageWaitMinutes: r.averageWaitMinutes ?? 0,
  }));
  res.json({
    recommendations: recs,
    summary: {
      mechanicShortageRegions: recs.filter((r) => r.balance === "mechanic_shortage").map((r) => r.region),
      customerShortageRegions: recs.filter((r) => r.balance === "customer_shortage").map((r) => r.region),
      balancedRegions: recs.filter((r) => r.balance === "balanced").map((r) => r.region),
    },
  });
});

router.get("/admin/growth/cpa", async (_req: AuthRequest, res): Promise<void> => {
  res.json(await getCpaSnapshot());
});

router.get("/admin/growth/engagement", async (_req: AuthRequest, res): Promise<void> => {
  res.json(await getEngagementSnapshot());
});

router.get("/admin/growth/amplification", async (_req: AuthRequest, res): Promise<void> => {
  res.json(await getMechanicAmplification());
});

router.get("/admin/growth/trends", async (_req: AuthRequest, res): Promise<void> => {
  try { await assertAiGenerationAllowed(); }
  catch (err) {
    if (err instanceof PolicyError) { res.status(err.statusCode).json({ error: err.message }); return; }
    throw err;
  }
  const regions = await getRegionalDensity();
  const top = regions.slice(0, 5).map((r) => r.region);
  const shortages = regions
    .map((r) => recommendForBalance({
      region: r.region,
      customerCount: r.customerCount,
      mechanicCount: r.mechanicCount,
      jobsLast30: r.jobsLast30,
      averageWaitMinutes: r.averageWaitMinutes ?? 0,
    }))
    .filter((r) => r.balance !== "balanced")
    .map((r) => ({ region: r.region, balance: r.balance }));
  try {
    const ideas = await suggestTrendingTopics({ now: new Date(), topRegions: top, shortages });
    res.json({ ideas });
  } catch (err) {
    req_log(_req).error({ err }, "trend suggestion failed");
    res.status(502).json({ error: "Trend engine unavailable", detail: err instanceof Error ? err.message : "unknown" });
  }
});

router.get("/admin/growth/topics", (_req: AuthRequest, res): void => {
  res.json({
    topicKinds: TOPIC_KINDS.map((k) => ({ value: k, label: TOPIC_LABELS[k] })),
    platforms: PLATFORMS.map((p) => ({ value: p, label: PLATFORM_LABELS[p] })),
  });
});

/* -------------------------------------------------------------------------- */
/* Content engine — generation                                                */
/* -------------------------------------------------------------------------- */

const generateBodySchema = z.object({
  platform: z.enum(["facebook", "instagram", "tiktok", "twitter"]),
  topicKind: z.enum(TOPIC_KINDS as [TopicKind, ...TopicKind[]]),
  region: z.string().trim().max(120).optional().nullable(),
  topicTitle: z.string().trim().min(2).max(160),
  briefingContext: z.string().trim().max(1000).optional().nullable(),
});

router.post("/admin/growth/content/generate", async (req: AuthRequest, res): Promise<void> => {
  const parsed = generateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const body = parsed.data;
  try { await assertAiGenerationAllowed(); }
  catch (err) {
    if (err instanceof PolicyError) { res.status(err.statusCode).json({ error: err.message }); return; }
    throw err;
  }
  let generated;
  try {
    generated = await generateContent({
      platform: body.platform,
      topicKind: body.topicKind,
      region: body.region ?? null,
      briefingContext: body.briefingContext ?? null,
    });
  } catch (err) {
    req.log?.error({ err }, "content generation failed");
    res.status(502).json({ error: "Content generation failed", detail: err instanceof Error ? err.message : "unknown" });
    return;
  }
  const [post] = await db.insert(socialPostsTable).values({
    platform: body.platform,
    status: "pending_review",
    topicKind: body.topicKind,
    topicTitle: body.topicTitle,
    region: body.region ?? null,
    caption: generated.caption,
    hashtags: generated.hashtags,
    mediaIdeas: generated.mediaIdeas,
    hookText: generated.hookText,
    callToAction: generated.callToAction,
    generationModel: generated.model,
    generationPrompt: generated.prompt,
    generatedById: req.userId!,
  }).returning();
  res.status(201).json(post);
});

const generateBatchBodySchema = z.object({
  topicKind: z.enum(TOPIC_KINDS as [TopicKind, ...TopicKind[]]),
  topicTitle: z.string().trim().min(2).max(160),
  region: z.string().trim().max(120).optional().nullable(),
  briefingContext: z.string().trim().max(1000).optional().nullable(),
  platforms: z.array(z.enum(["facebook", "instagram", "tiktok", "twitter"])).min(1).max(4),
});

router.post("/admin/growth/content/generate-batch", async (req: AuthRequest, res): Promise<void> => {
  const parsed = generateBatchBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }
  const { platforms, ...rest } = parsed.data;
  try { await assertAiGenerationAllowed(); }
  catch (err) {
    if (err instanceof PolicyError) { res.status(err.statusCode).json({ error: err.message }); return; }
    throw err;
  }
  const out: SocialPost[] = [];
  const errors: { platform: Platform; error: string }[] = [];
  // Sequential to avoid model rate limits.
  for (const platform of platforms) {
    try {
      const generated = await generateContent({
        platform,
        topicKind: rest.topicKind,
        region: rest.region ?? null,
        briefingContext: rest.briefingContext ?? null,
      });
      const [post] = await db.insert(socialPostsTable).values({
        platform,
        status: "pending_review",
        topicKind: rest.topicKind,
        topicTitle: rest.topicTitle,
        region: rest.region ?? null,
        caption: generated.caption,
        hashtags: generated.hashtags,
        mediaIdeas: generated.mediaIdeas,
        hookText: generated.hookText,
        callToAction: generated.callToAction,
        generationModel: generated.model,
        generationPrompt: generated.prompt,
        generatedById: req.userId!,
      }).returning();
      out.push(post);
    } catch (err) {
      req.log?.error({ err, platform }, "batch content generation failed");
      errors.push({ platform, error: err instanceof Error ? err.message : "unknown" });
    }
  }
  res.status(out.length === 0 ? 502 : 201).json({ posts: out, errors });
});

/* -------------------------------------------------------------------------- */
/* Content engine — queue management                                          */
/* -------------------------------------------------------------------------- */

const STATUS_VALUES = ["draft", "pending_review", "approved", "rejected", "scheduled", "published"] as const;

router.get("/admin/growth/content", async (req: AuthRequest, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
  const conditions = [];
  if (status && (STATUS_VALUES as readonly string[]).includes(status)) {
    conditions.push(eq(socialPostsTable.status, status as SocialPost["status"]));
  }
  if (platform && (PLATFORMS as readonly string[]).includes(platform)) {
    conditions.push(eq(socialPostsTable.platform, platform as Platform));
  }
  const rows = await db.select().from(socialPostsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(socialPostsTable.createdAt))
    .limit(200);
  res.json(rows);
});

router.get("/admin/growth/content/:id", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id));
  if (!post) { res.status(404).json({ error: "Not found" }); return; }
  res.json(post);
});

const patchSchema = z.object({
  caption: z.string().trim().min(1).max(5000).optional(),
  hashtags: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  mediaIdeas: z.array(z.string().trim().min(1).max(280)).max(8).optional(),
  hookText: z.string().trim().max(160).nullable().optional(),
  callToAction: z.string().trim().max(160).optional(),
  topicTitle: z.string().trim().min(2).max(160).optional(),
  region: z.string().trim().max(120).nullable().optional(),
});

router.patch("/admin/growth/content/:id", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status === "published") { res.status(409).json({ error: "Cannot edit a published post" }); return; }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  const hashtags = parsed.data.hashtags
    ? parsed.data.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).map((h) => h.replace(/\s+/g, ""))
    : undefined;
  const [post] = await db.update(socialPostsTable).set({
    ...(parsed.data.caption !== undefined && { caption: parsed.data.caption }),
    ...(hashtags !== undefined && { hashtags }),
    ...(parsed.data.mediaIdeas !== undefined && { mediaIdeas: parsed.data.mediaIdeas }),
    ...(parsed.data.hookText !== undefined && { hookText: parsed.data.hookText }),
    ...(parsed.data.callToAction !== undefined && { callToAction: parsed.data.callToAction }),
    ...(parsed.data.topicTitle !== undefined && { topicTitle: parsed.data.topicTitle }),
    ...(parsed.data.region !== undefined && { region: parsed.data.region }),
  }).where(eq(socialPostsTable.id, id)).returning();
  res.json(post);
});

router.post("/admin/growth/content/:id/approve", async (req: AuthRequest, res): Promise<void> => {
  await transition(req, res, ["pending_review", "rejected", "draft"], "approved");
});

const rejectSchema = z.object({ reviewNote: z.string().trim().max(500).optional().nullable() });
router.post("/admin/growth/content/:id/reject", async (req: AuthRequest, res): Promise<void> => {
  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  await transition(req, res, ["pending_review", "approved", "scheduled", "draft"], "rejected", { reviewNote: parsed.data.reviewNote ?? null });
});

const scheduleSchema = z.object({ scheduledFor: z.string().datetime() });
router.post("/admin/growth/content/:id/schedule", async (req: AuthRequest, res): Promise<void> => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  const when = new Date(parsed.data.scheduledFor);
  if (when.getTime() < Date.now() - 60_000) { res.status(400).json({ error: "scheduledFor must be in the future" }); return; }
  await transition(req, res, ["approved"], "scheduled", { scheduledFor: when });
});

const publishSchema = z.object({ externalUrl: z.string().url().max(2048).optional().nullable() });
router.post("/admin/growth/content/:id/publish", async (req: AuthRequest, res): Promise<void> => {
  const parsed = publishSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  // SAFETY: must be approved or scheduled before publish.
  await transition(req, res, ["approved", "scheduled"], "published", {
    publishedAt: new Date(),
    externalUrl: parsed.data.externalUrl ?? null,
  });
});

const engagementSchema = z.object({
  likes: z.number().int().nonnegative().optional(),
  shares: z.number().int().nonnegative().optional(),
  comments: z.number().int().nonnegative().optional(),
  saves: z.number().int().nonnegative().optional(),
  clicks: z.number().int().nonnegative().optional(),
  impressions: z.number().int().nonnegative().optional(),
  signupConversions: z.number().int().nonnegative().optional(),
  bookingConversions: z.number().int().nonnegative().optional(),
});

router.post("/admin/growth/content/:id/engagement", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = engagementSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  const [existing] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status !== "published") { res.status(409).json({ error: "Engagement can only be recorded on published posts" }); return; }
  const merged = { ...existing.engagement, ...parsed.data };
  // Merge the engagement jsonb AND recompute the cached weighted score in a
  // single transaction so the winner/reuse sweeps (which filter on
  // engagement_score) never see a stale score for the new metrics.
  const post = await db.transaction(async (tx) => {
    const [updated] = await tx.update(socialPostsTable)
      .set({ engagement: merged })
      .where(eq(socialPostsTable.id, id))
      .returning();
    if (!updated) return null;
    const score = engagementScoreOf(updated.engagement);
    const [final] = await tx.update(socialPostsTable)
      .set({ engagementScore: score })
      .where(eq(socialPostsTable.id, id))
      .returning();
    return final ?? updated;
  });
  res.json(post);
});

router.post("/admin/growth/content/:id/recommend-time", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id));
  if (!post) { res.status(404).json({ error: "Not found" }); return; }
  const others = await db.select({ scheduledFor: socialPostsTable.scheduledFor })
    .from(socialPostsTable)
    .where(and(
      eq(socialPostsTable.platform, post.platform),
      eq(socialPostsTable.status, "scheduled"),
      isNotNull(socialPostsTable.scheduledFor),
      gte(socialPostsTable.scheduledFor, new Date()),
    ));
  const scheduled = others.map((r) => r.scheduledFor!).filter(Boolean);
  res.json(recommendSchedule({ platform: post.platform, alreadyScheduled: scheduled }));
});

router.delete("/admin/growth/content/:id", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.status === "published") { res.status(409).json({ error: "Cannot delete a published post — use reject instead" }); return; }
  await db.delete(socialPostsTable).where(eq(socialPostsTable.id, id));
  res.status(204).end();
});

/* -------------------------------------------------------------------------- */
/* Phase B: analytics-driven iteration                                        */
/* -------------------------------------------------------------------------- */

/** Iterate a single winner: clone topic + regenerate caption into a new draft. */
const iterateSchema = z.object({ force: z.boolean().optional() });
router.post("/admin/growth/content/:id/iterate", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = iterateSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }

  try { await assertAiGenerationAllowed(); }
  catch (err) {
    if (err instanceof PolicyError) { res.status(err.statusCode).json({ error: err.message }); return; }
    throw err;
  }

  try {
    const draft = await iteratePost({
      sourcePostId: id,
      generatedById: req.userId ?? null,
      force: parsed.data.force,
    });
    res.status(201).json(draft);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "iterate_failed";
    if (msg === "source_post_not_found") { res.status(404).json({ error: msg }); return; }
    if (msg === "source_not_published" || msg === "already_iterated") {
      res.status(409).json({ error: msg }); return;
    }
    req.log?.error({ err, postId: id }, "iterate failed");
    res.status(500).json({ error: "iterate_failed" });
  }
});

/** List eligible winners (manually or automatically). */
router.get("/admin/growth/iterations/winners", async (req: AuthRequest, res): Promise<void> => {
  const threshold = Number(req.query.threshold);
  const winners = await listWinnerCandidates({
    threshold: Number.isFinite(threshold) ? threshold : WINNER_THRESHOLD,
  });
  res.json({
    threshold: Number.isFinite(threshold) ? threshold : WINNER_THRESHOLD,
    winners,
  });
});

/* -------------------------------------------------------------------------- */
/* Phase C: auto-publish + reuse                                              */
/* -------------------------------------------------------------------------- */

/** Force-publish a scheduled or approved post immediately via the configured provider. */
router.post("/admin/growth/content/:id/publish-now", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const out = await publishOne(id);
  if (out.ok) {
    res.status(200).json(out);
    return;
  }
  // Map known failure modes to actionable HTTP codes.
  if (out.error === "post_not_publishable") { res.status(409).json(out); return; }
  if (out.error?.startsWith("no_provider_registered_for_")) { res.status(503).json(out); return; }
  // Other failures: the underlying message is the provider's not-configured
  // error or a transient error. 502 — admin can retry from the UI.
  res.status(502).json(out);
});

/** Clone a proven winner into a new scheduled post. */
const reuseSchema = z.object({ scheduledFor: z.string().datetime().optional() });
router.post("/admin/growth/content/:id/reuse", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = reuseSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }

  try {
    const clone = await reusePost({
      sourcePostId: id,
      generatedById: req.userId ?? null,
      scheduledFor: parsed.data.scheduledFor ? new Date(parsed.data.scheduledFor) : undefined,
    });
    res.status(201).json(clone);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "reuse_failed";
    if (msg === "source_post_not_found") { res.status(404).json({ error: msg }); return; }
    if (
      msg === "source_not_published" ||
      msg === "source_below_threshold" ||
      msg === "reuse_cap_reached" ||
      msg === "cooldown_active"
    ) { res.status(409).json({ error: msg }); return; }
    req.log?.error({ err, postId: id }, "reuse failed");
    res.status(500).json({ error: "reuse_failed" });
  }
});

/** List published winners that are currently eligible for reuse. */
router.get("/admin/growth/reuse/candidates", async (_req: AuthRequest, res): Promise<void> => {
  const candidates = await listReuseCandidates();
  res.json({
    threshold: REUSE_THRESHOLD,
    cooldownDays: REUSE_COOLDOWN_DAYS,
    maxReusesPerPost: MAX_REUSES_PER_POST,
    candidates,
  });
});

/* -------------------------------------------------------------------------- */

async function transition(
  req: AuthRequest,
  res: import("express").Response,
  allowedFrom: SocialPost["status"][],
  to: SocialPost["status"],
  patch: Partial<SocialPost> = {},
): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Atomic check-and-set: a single UPDATE conditional on status IN allowedFrom
  // avoids the read-then-update race where two admins could each transition the
  // same row concurrently. If 0 rows are affected, distinguish 404 from 409.
  const updated = await db.update(socialPostsTable).set({
    status: to,
    reviewedById: req.userId!,
    reviewedAt: new Date(),
    ...patch,
  }).where(and(
    eq(socialPostsTable.id, id),
    inArray(socialPostsTable.status, allowedFrom),
  )).returning();

  if (updated.length > 0) { res.json(updated[0]); return; }

  const [existing] = await db.select({ status: socialPostsTable.status })
    .from(socialPostsTable).where(eq(socialPostsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  res.status(409).json({ error: `Cannot transition from ${existing.status} to ${to}` });
}

function req_log(req: AuthRequest) {
  return req.log ?? { error: () => {/* noop */}, info: () => {/* noop */}, warn: () => {/* noop */} };
}

/* -------------------------------------------------------------------------- */
/* Admin Controls — AI policy + permissions surface                           */
/* -------------------------------------------------------------------------- */

router.get("/admin/growth/settings", async (_req: AuthRequest, res): Promise<void> => {
  const settings = await getAdminGrowthSettings();
  res.json({
    settings,
    aiRestrictions: AI_RESTRICTIONS,
    adminPermissions: ADMIN_PERMISSIONS,
    futureCapabilities: FUTURE_CAPABILITIES,
  });
});

const settingsPatchSchema = z.object({
  aiContentGenerationPaused: z.boolean().optional(),
  maxDailyDrafts: z.number().int().min(1).max(10000).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "Empty patch" });

router.patch("/admin/growth/settings", async (req: AuthRequest, res): Promise<void> => {
  const parsed = settingsPatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  const updated = await updateAdminGrowthSettings(parsed.data, req.userId!);
  res.json(updated);
});

/* -------------------------------------------------------------------------- */
/* Admin Mechanic Amplification — kit access + page customization             */
/* -------------------------------------------------------------------------- */

async function loadMechanicWithPage(mechanicId: number) {
  const [mechanic] = await db.select().from(usersTable)
    .where(and(eq(usersTable.id, mechanicId), eq(usersTable.role, "mechanic")));
  if (!mechanic) return null;
  const [page] = await db.select().from(mechanicAmplificationTable)
    .where(eq(mechanicAmplificationTable.mechanicId, mechanicId));
  return { mechanic, page: page ?? null };
}

router.get("/admin/growth/mechanics/:id/kit", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const found = await loadMechanicWithPage(id);
  if (!found) { res.status(404).json({ error: "Mechanic not found" }); return; }
  const kit = await buildAmplificationKit(found.mechanic, found.page);
  res.json(kit);
});

const pagePatchSchema = z.object({
  displayName: z.string().trim().max(80).nullable().optional(),
  tagline: z.string().trim().max(120).nullable().optional(),
  bio: z.string().trim().max(600).nullable().optional(),
  specialty: z.string().trim().max(80).nullable().optional(),
  brandColor: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  instagramHandle: z.string().trim().max(40).nullable().optional(),
  facebookHandle: z.string().trim().max(80).nullable().optional(),
  tiktokHandle: z.string().trim().max(40).nullable().optional(),
  twitterHandle: z.string().trim().max(40).nullable().optional(),
  pageEnabled: z.boolean().optional(),
});

router.patch("/admin/growth/mechanics/:id/page", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = pagePatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  const found = await loadMechanicWithPage(id);
  if (!found) { res.status(404).json({ error: "Mechanic not found" }); return; }
  const [row] = await db.insert(mechanicAmplificationTable)
    .values({ mechanicId: id, ...parsed.data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: mechanicAmplificationTable.mechanicId,
      set: { ...parsed.data, updatedAt: new Date() },
    }).returning();
  res.json(row);
});

const mechanicContentSchema = z.object({
  variant: z.enum(["spotlight", "book_with_me", "referral_push"]),
  platform: z.enum(["facebook", "instagram", "tiktok", "twitter"]),
  briefingContext: z.string().trim().max(1000).optional().nullable(),
});

router.post("/admin/growth/mechanics/:id/content", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = mechanicContentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  try { await assertAiGenerationAllowed(); }
  catch (err) {
    if (err instanceof PolicyError) { res.status(err.statusCode).json({ error: err.message }); return; }
    throw err;
  }
  const found = await loadMechanicWithPage(id);
  if (!found) { res.status(404).json({ error: "Mechanic not found" }); return; }
  const m = found.mechanic;
  let generated;
  try {
    generated = await generateMechanicContent({
      mechanic: {
        id: m.id, name: found.page?.displayName ?? m.name,
        region: m.region, city: m.city,
        specialty: found.page?.specialty ?? null,
        tagline: found.page?.tagline ?? null,
        referralCode: m.referralCode,
      },
      variant: parsed.data.variant,
      platform: parsed.data.platform,
      briefingContext: parsed.data.briefingContext ?? null,
    });
  } catch (err) {
    req.log?.error({ err }, "mechanic content generation failed");
    res.status(502).json({ error: "Content generation failed", detail: err instanceof Error ? err.message : "unknown" });
    return;
  }
  const topicMap = { spotlight: "mechanic_spotlight", book_with_me: "book_through_aps", referral_push: "referral_campaign" } as const;
  const [post] = await db.insert(socialPostsTable).values({
    platform: parsed.data.platform,
    status: "pending_review",
    topicKind: topicMap[parsed.data.variant],
    topicTitle: `${parsed.data.variant === "spotlight" ? "Spotlight" : parsed.data.variant === "book_with_me" ? "Book with" : "Referral push"}: ${m.name}`,
    region: m.city ?? m.region ?? null,
    caption: generated.caption,
    hashtags: generated.hashtags,
    mediaIdeas: generated.mediaIdeas,
    hookText: generated.hookText,
    callToAction: generated.callToAction,
    generationModel: generated.model,
    generationPrompt: generated.prompt,
    generatedById: req.userId!,
  }).returning();
  res.status(201).json(post);
});

/* -------------------------------------------------------------------------- */
/* Content Asset Library                                                      */
/* -------------------------------------------------------------------------- */

/**
 * GET /admin/growth/library
 *   ?platform=facebook|instagram|tiktok|twitter
 *   &status=draft|pending_review|approved|scheduled|published|rejected
 *   &topicKind=...
 *   &minScore=number
 *   &sort=recent|engagement|published
 *   &limit=number (default 50, max 200)
 *   &offset=number
 *
 * Returns posts with their primary media asset thumbnail + a flat
 * engagement rollup so the library grid can render without N+1 fetches.
 */
const LIBRARY_PLATFORMS = ["facebook", "instagram", "tiktok", "twitter"] as const;
const LIBRARY_STATUSES = ["draft", "pending_review", "approved", "scheduled", "published", "rejected"] as const;
const LIBRARY_SORTS = ["recent", "engagement", "published"] as const;
const librarySchema = z.object({
  platform:  z.enum(LIBRARY_PLATFORMS).optional(),
  status:    z.enum(LIBRARY_STATUSES).optional(),
  topicKind: z.enum(TOPIC_KINDS as unknown as readonly [string, ...string[]]).optional(),
  minScore:  z.coerce.number().int().min(0).max(1000).optional(),
  sort:      z.enum(LIBRARY_SORTS).default("recent"),
  limit:     z.coerce.number().int().min(1).max(200).default(50),
  offset:    z.coerce.number().int().min(0).default(0),
});

router.get("/admin/growth/library", async (req: AuthRequest, res): Promise<void> => {
  const parsed = librarySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid filters", issues: parsed.error.issues });
    return;
  }
  const { platform, status, topicKind, minScore, sort, limit, offset } = parsed.data;

  const where: ReturnType<typeof eq>[] = [];
  if (platform)  where.push(eq(socialPostsTable.platform,  platform));
  if (status)    where.push(eq(socialPostsTable.status,    status));
  if (topicKind) where.push(eq(socialPostsTable.topicKind, topicKind));
  if (minScore != null) where.push(gte(socialPostsTable.engagementScore, minScore));

  const orderBy = sort === "engagement"
    ? desc(socialPostsTable.engagementScore)
    : sort === "published"
    ? desc(socialPostsTable.publishedAt)
    : desc(socialPostsTable.createdAt);

  const rows = await db.select().from(socialPostsTable)
    .where(where.length ? and(...where) : undefined)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  // Fetch the best (most-recently-ready) media asset for each post in one query.
  const postIds = rows.map((r) => r.id);
  const thumbs = postIds.length === 0 ? [] : await db.select({
    socialPostId: mediaAssetsTable.socialPostId,
    id: mediaAssetsTable.id,
    kind: mediaAssetsTable.kind,
    status: mediaAssetsTable.status,
    url: mediaAssetsTable.url,
    aspectRatio: mediaAssetsTable.aspectRatio,
  }).from(mediaAssetsTable)
    .where(and(
      inArray(mediaAssetsTable.socialPostId, postIds),
      inArray(mediaAssetsTable.status, ["approved", "ready"]),
    ))
    .orderBy(desc(mediaAssetsTable.createdAt));

  // First-seen wins (which is the most recent because we ordered desc).
  const thumbByPost = new Map<number, typeof thumbs[number]>();
  for (const t of thumbs) {
    if (t.socialPostId == null) continue;
    if (!thumbByPost.has(t.socialPostId)) thumbByPost.set(t.socialPostId, t);
  }

  // Aggregate counts (filtered) — small extra query for the library header.
  const countRows = await db.select({ count: drizzleSql<number>`count(*)::int` })
    .from(socialPostsTable)
    .where(where.length ? and(...where) : undefined);
  const count = countRows[0]?.count ?? 0;

  res.json({
    total: count,
    limit,
    offset,
    posts: rows.map((p) => {
      const t = thumbByPost.get(p.id);
      return {
        id: p.id,
        platform: p.platform,
        status: p.status,
        topicKind: p.topicKind,
        topicTitle: p.topicTitle,
        caption: p.caption,
        engagementScore: p.engagementScore,
        engagement: p.engagement,
        publishedAt: p.publishedAt,
        scheduledFor: p.scheduledFor,
        createdAt: p.createdAt,
        reuseCount: p.reuseCount,
        parentPostId: p.parentPostId,
        reusedFromId: p.reusedFromId,
        thumb: t ? { id: t.id, kind: t.kind, url: t.url, aspectRatio: t.aspectRatio } : null,
      };
    }),
  });
});

/**
 * GET /admin/growth/library/stats — high-level counts the library landing
 * card uses (totals per status + best-performing post).
 */
router.get("/admin/growth/library/stats", async (_req, res): Promise<void> => {
  const rows = await db.select({
    status: socialPostsTable.status,
    count: drizzleSql<number>`count(*)::int`,
  }).from(socialPostsTable).groupBy(socialPostsTable.status);

  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = r.count;

  const [topPost] = await db.select({
    id: socialPostsTable.id,
    topicTitle: socialPostsTable.topicTitle,
    platform: socialPostsTable.platform,
    engagementScore: socialPostsTable.engagementScore,
  }).from(socialPostsTable)
    .where(eq(socialPostsTable.status, "published"))
    .orderBy(desc(socialPostsTable.engagementScore))
    .limit(1);

  res.json({ byStatus, topPost: topPost ?? null });
});

export default router;
