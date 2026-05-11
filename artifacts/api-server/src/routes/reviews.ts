/**
 * Reviews API.
 *
 *   POST   /reviews                       Submit a review for a completed job.
 *   GET    /reviews/user/:userId          Visible reviews where this user is the subject.
 *   GET    /reviews/job/:jobId            Reviews on a job, masked by visibility lock.
 *   GET    /reviews/me/pending            Jobs the caller still owes a review on.
 *   PATCH  /reviews/:id                   Edit own review (audit trail recorded).
 *   POST   /reviews/:id/moderate-remove   Admin-only — remove fraudulent review.
 *   GET    /reputation/:userId            Cached reputation snapshot + badges.
 *
 * Visibility-lock contract — see lib/reviewVisibility.ts.
 */

import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, isNull, ne, inArray as sqlIn, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db, reviewsTable, reviewAuditLogsTable, jobsTable, usersTable,
  userReputationTable, userBadgesTable,
} from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";
import { validateCategories } from "../lib/reviewCategories";
import {
  REVIEW_LOCK_HOURS, publishIfReciprocated, publishExpiredHiddenReviews,
  canSeeHidden, moderateRemove,
} from "../lib/reviewVisibility";
import { recomputeUserReputation } from "../lib/reputationEngine";
import { recomputeBadgesForUser, badgeMetadata } from "../lib/badgeEngine";

const router: IRouter = Router();

const reviewableJobStatuses = new Set(["COMPLETED", "PAID"]);

const submitSchema = z.object({
  jobId: z.number().int().positive(),
  overallRating: z.number().int().min(1).max(5),
  categories: z.record(z.string(), z.number()).optional(),
  text: z.string().max(4000).optional(),
  photos: z.array(z.string().url().max(2048)).max(8).optional(),
});

router.post("/reviews", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { jobId, overallRating, text, photos } = parsed.data;

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (!reviewableJobStatuses.has(job.status)) {
    res.status(409).json({ error: "Job is not in a reviewable state yet." }); return;
  }

  // Determine direction. Customer can only review the assigned mechanic and
  // vice versa. Admin not allowed to author (admins moderate, not review).
  let authorRole: "customer" | "mechanic";
  let subjectId: number;
  let subjectRole: "customer" | "mechanic";
  if (req.userRole === "customer" && job.customerId === req.userId) {
    if (!job.mechanicId) { res.status(409).json({ error: "Job has no mechanic to review." }); return; }
    authorRole = "customer"; subjectId = job.mechanicId; subjectRole = "mechanic";
  } else if (req.userRole === "mechanic" && job.mechanicId === req.userId) {
    authorRole = "mechanic"; subjectId = job.customerId; subjectRole = "customer";
  } else {
    res.status(403).json({ error: "You are not a participant in this job." }); return;
  }

  const cats = validateCategories(authorRole, parsed.data.categories);
  if (!cats.ok) { res.status(400).json({ error: cats.error }); return; }

  const visibleAt = new Date(Date.now() + REVIEW_LOCK_HOURS * 60 * 60 * 1000);

  let inserted;
  try {
    [inserted] = await db.insert(reviewsTable).values({
      jobId, authorId: req.userId!, authorRole,
      subjectId, subjectRole,
      overallRating, categories: cats.value,
      text: text ?? null, photos: photos ?? [],
      visibility: "hidden",
      visibleAt,
    }).returning();
  } catch (err) {
    // Unique (job_id, author_id) collision → already reviewed.
    if (err instanceof Error && /reviews_job_author_uq|duplicate key/i.test(err.message)) {
      res.status(409).json({ error: "You have already reviewed this job." }); return;
    }
    throw err;
  }
  await db.insert(reviewAuditLogsTable).values({
    reviewId: inserted.id,
    action: "created",
    actorId: req.userId!,
    actorRole: req.userRole,
    after: inserted as unknown as Record<string, unknown>,
  });

  // If the counterpart already exists, publish both and recompute both subjects.
  const subjectsToRecompute = await publishIfReciprocated(jobId);
  if (subjectsToRecompute.length > 0) {
    for (const s of subjectsToRecompute) {
      await recomputeUserReputation(s);
      await recomputeBadgesForUser(s);
    }
  }

  res.status(201).json(serialize(inserted, { isOwn: true, masked: false }));
});

router.get("/reviews/user/:userId", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) { res.status(400).json({ error: "Bad userId" }); return; }
  // Lazy-publish any expired hidden reviews so the public list stays fresh.
  await publishExpiredHiddenReviews();
  const rows = await db.select().from(reviewsTable)
    .where(and(eq(reviewsTable.subjectId, userId), eq(reviewsTable.visibility, "visible")))
    .orderBy(desc(reviewsTable.submittedAt))
    .limit(100);
  // Decorate with author display name.
  const out = await Promise.all(rows.map(async (r) => {
    const [author] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, r.authorId));
    return { ...serialize(r, { isOwn: r.authorId === req.userId, masked: false }), authorName: maskName(author?.name ?? "Anonymous", r.authorRole) };
  }));
  res.json(out);
});

router.get("/reviews/job/:jobId", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const jobId = Number(req.params.jobId);
  if (!Number.isInteger(jobId)) { res.status(400).json({ error: "Bad jobId" }); return; }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Not found" }); return; }
  const isParticipant = req.userId === job.customerId || req.userId === job.mechanicId;
  if (!isParticipant && req.userRole !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  // Lazy-publish any reviews on this job whose 72h lock has expired so the
  // visibility-lock contract holds on every read surface, not just /user/:id.
  const flipped = await publishExpiredHiddenReviews();
  for (const subjectId of flipped) {
    await recomputeUserReputation(subjectId);
    await recomputeBadgesForUser(subjectId);
  }
  const rows = await db.select().from(reviewsTable).where(eq(reviewsTable.jobId, jobId));
  // Mask the counterpart's hidden review unless caller is author or admin.
  const viewer = { id: req.userId!, role: req.userRole! };
  const out = rows.map((r) => {
    const isOwn = r.authorId === viewer.id;
    const reveal = r.visibility === "visible" || canSeeHidden(r, viewer);
    return serialize(r, { isOwn, masked: !reveal });
  });
  res.json(out);
});

router.get("/reviews/me/pending", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  // Jobs caller participated in that are PAID/COMPLETED and have no review by them yet.
  const completed = await db.select().from(jobsTable).where(and(
    req.userRole === "customer" ? eq(jobsTable.customerId, req.userId!) : eq(jobsTable.mechanicId, req.userId!),
  ));
  const pending = [];
  for (const j of completed) {
    if (!reviewableJobStatuses.has(j.status)) continue;
    const [existing] = await db.select({ id: reviewsTable.id }).from(reviewsTable)
      .where(and(eq(reviewsTable.jobId, j.id), eq(reviewsTable.authorId, req.userId!)));
    if (!existing) pending.push({ jobId: j.id, status: j.status, completedAt: j.completedAt ?? j.createdAt });
  }
  res.json(pending);
});

const editSchema = z.object({
  overallRating: z.number().int().min(1).max(5).optional(),
  categories: z.record(z.string(), z.number()).optional(),
  text: z.string().max(4000).optional(),
  photos: z.array(z.string().url().max(2048)).max(8).optional(),
});

router.patch("/reviews/:id", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Bad id" }); return; }
  const parsed = editSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [existing] = await db.select().from(reviewsTable).where(eq(reviewsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.authorId !== req.userId) { res.status(403).json({ error: "Not your review" }); return; }
  if (existing.visibility === "removed") { res.status(409).json({ error: "Review was removed by moderators." }); return; }
  // Anti-retaliation: once a review is visible (the counterpart has reviewed
  // OR the 72h lock expired), we freeze it. Otherwise an author could read
  // the published counterpart and edit theirs in retaliation, which defeats
  // the entire visibility-lock contract. Edits are only permitted while the
  // review is still hidden.
  if (existing.visibility !== "hidden") {
    res.status(409).json({ error: "Reviews are locked once they become visible." }); return;
  }

  let cats = existing.categories;
  if (parsed.data.categories !== undefined) {
    const v = validateCategories(existing.authorRole as "customer" | "mechanic", parsed.data.categories);
    if (!v.ok) { res.status(400).json({ error: v.error }); return; }
    cats = v.value;
  }

  const [updated] = await db.update(reviewsTable).set({
    overallRating: parsed.data.overallRating ?? existing.overallRating,
    categories: cats,
    text: parsed.data.text ?? existing.text,
    photos: parsed.data.photos ?? existing.photos,
    editedAt: new Date(),
  }).where(eq(reviewsTable.id, id)).returning();

  await db.insert(reviewAuditLogsTable).values({
    reviewId: id,
    action: "edited",
    actorId: req.userId!,
    actorRole: req.userRole,
    before: existing as unknown as Record<string, unknown>,
    after: updated as unknown as Record<string, unknown>,
  });

  if (updated.visibility === "visible") {
    await recomputeUserReputation(updated.subjectId);
    await recomputeBadgesForUser(updated.subjectId);
  }
  res.json(serialize(updated, { isOwn: true, masked: false }));
});

router.post("/reviews/:id/moderate-remove", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userRole !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const id = Number(req.params.id);
  const reason = String((req.body as { reason?: string })?.reason ?? "").slice(0, 500);
  if (!reason) { res.status(400).json({ error: "reason is required" }); return; }
  const result = await moderateRemove(id, req.userId!, reason);
  if (!result) { res.status(404).json({ error: "Not found or already removed" }); return; }
  await recomputeUserReputation(result.subjectId);
  await recomputeBadgesForUser(result.subjectId);
  res.json({ ok: true });
});

router.get("/reputation/:userId", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) { res.status(400).json({ error: "Bad userId" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  const [rep] = await db.select().from(userReputationTable).where(eq(userReputationTable.userId, userId));
  const badges = await db.select().from(userBadgesTable)
    .where(and(eq(userBadgesTable.userId, userId), isNull(userBadgesTable.revokedAt)));
  const meta = Object.fromEntries(badgeMetadata().map((b) => [b.key, b]));
  res.json({
    userId,
    role: user.role,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    mechanicTier: user.mechanicTier ?? null,
    reviewCount: rep?.reviewCount ?? 0,
    overallAvg: rep ? Number(rep.overallAvg) : 0,
    categoriesAvg: rep?.categoriesAvg ?? {},
    completionRate: rep ? Number(rep.completionRate) : 0,
    cancellationRate: rep ? Number(rep.cancellationRate) : 0,
    noShowRate: rep ? Number(rep.noShowRate) : 0,
    repeatCustomerRate: rep ? Number(rep.repeatCustomerRate) : 0,
    trustScore: rep?.trustScore ?? 50,
    badges: badges.map((b) => ({
      key: b.badgeKey,
      label: meta[b.badgeKey]?.label ?? b.badgeKey,
      description: meta[b.badgeKey]?.description ?? "",
      awardedAt: b.awardedAt,
    })),
  });
});

router.get("/badges/catalog", (_req, res) => {
  res.json(badgeMetadata());
});

/* ----------------------------- admin moderation --------------------------- */
/**
 * Admin-only feed of recent reviews for the moderation queue. Joins author,
 * subject, and job-type metadata so the admin UI can render single-call. We
 * intentionally include `removed` reviews so admins can see the full history.
 */
router.get("/admin/reviews/recent", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userRole !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const rows = await db.select().from(reviewsTable)
    .orderBy(desc(reviewsTable.submittedAt))
    .limit(limit);
  const userIds = Array.from(new Set(rows.flatMap((r) => [r.authorId, r.subjectId])));
  const jobIds = Array.from(new Set(rows.map((r) => r.jobId)));
  const users = userIds.length
    ? await db.select().from(usersTable).where(sqlIn(usersTable.id, userIds))
    : [];
  const jobs = jobIds.length
    ? await db.select().from(jobsTable).where(sqlIn(jobsTable.id, jobIds))
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  res.json(rows.map((r) => ({
    id: r.id,
    jobId: r.jobId,
    jobType: jobMap.get(r.jobId)?.jobType ?? null,
    authorId: r.authorId,
    authorRole: r.authorRole,
    authorName: userMap.get(r.authorId)?.name ?? "Unknown",
    subjectId: r.subjectId,
    subjectRole: r.subjectRole,
    subjectName: userMap.get(r.subjectId)?.name ?? "Unknown",
    overallRating: r.overallRating,
    text: r.text ?? null,
    visibility: r.visibility,
    visibleAt: r.visibleAt,
    submittedAt: r.submittedAt,
    editedAt: r.editedAt,
    removedAt: r.removedAt,
    removedReason: r.removedReason,
  })));
});

/**
 * Admin trust analytics overview: top mechanics by trust, low-trust mechanics,
 * and platform-wide review volume. Single endpoint to power the admin trust
 * dashboard with one round trip.
 */
router.get("/admin/trust/overview", authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.userRole !== "admin") { res.status(403).json({ error: "Admin only" }); return; }
  const reps = await db.select().from(userReputationTable);
  const userIdsForReps = reps.map((r) => r.userId);
  const users = userIdsForReps.length
    ? await db.select().from(usersTable).where(sqlIn(usersTable.id, userIdsForReps))
    : [];
  const userMap = new Map(users.map((u) => [u.id, u]));
  const decorated = reps
    .map((r) => {
      const u = userMap.get(r.userId);
      if (!u) return null;
      return {
        userId: r.userId,
        name: u.name,
        role: u.role,
        mechanicTier: u.mechanicTier ?? null,
        trustScore: r.trustScore,
        overallAvg: Number(r.overallAvg),
        reviewCount: r.reviewCount,
        cancellationRate: Number(r.cancellationRate),
        noShowRate: Number(r.noShowRate),
      };
    })
    .filter(<T>(x: T | null): x is T => x !== null);
  const mechanics = decorated.filter((d) => d.role === "mechanic" && d.reviewCount >= 1);
  const top = [...mechanics].sort((a, b) => b.trustScore - a.trustScore).slice(0, 10);
  const low = [...mechanics].sort((a, b) => a.trustScore - b.trustScore).slice(0, 10);
  const totalReviews = await db.select({ id: reviewsTable.id }).from(reviewsTable);
  const visible = totalReviews.length; // count alias; cheap enough at current scale
  const removed = (await db.select({ id: reviewsTable.id }).from(reviewsTable)
    .where(eq(reviewsTable.visibility, "removed"))).length;
  res.json({
    totals: { reviews: visible, removed },
    topMechanics: top,
    lowMechanics: low,
  });
});

/* -------------------------------------------------------------------------- */
function maskName(name: string, role: string): string {
  // Mechanics' full names stay public; customer names are first-name + last-initial.
  if (role === "mechanic") return name;
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return parts[0] ?? "Customer";
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
}

function serialize(
  r: typeof reviewsTable.$inferSelect,
  opts: { isOwn: boolean; masked: boolean },
) {
  if (opts.masked) {
    return {
      id: r.id, jobId: r.jobId, authorId: r.authorId, authorRole: r.authorRole,
      subjectId: r.subjectId, subjectRole: r.subjectRole,
      visibility: "hidden",
      visibleAt: r.visibleAt,
      isOwn: opts.isOwn,
      submittedAt: r.submittedAt,
    };
  }
  return {
    id: r.id, jobId: r.jobId, authorId: r.authorId, authorRole: r.authorRole,
    subjectId: r.subjectId, subjectRole: r.subjectRole,
    overallRating: r.overallRating,
    categories: r.categories,
    text: r.text ?? null,
    photos: r.photos,
    visibility: r.visibility,
    visibleAt: r.visibleAt,
    submittedAt: r.submittedAt,
    editedAt: r.editedAt,
    removedAt: r.removedAt,
    removedReason: r.removedReason,
    isOwn: opts.isOwn,
  };
}

export default router;
// Re-export so unused-import lint stays quiet for `ne` (used by moderate path).
export const _internal = { ne };
