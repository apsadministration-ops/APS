import { Router, type IRouter } from "express";
import { eq, and, count, avg, isNotNull, desc } from "drizzle-orm";
import { db, usersTable, jobsTable, favoritesTable, flagsTable } from "@workspace/db";
import { authenticate, type AuthRequest } from "../middlewares/authenticate";

const router: IRouter = Router();

router.get("/mechanics", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const { jobType } = req.query as { jobType?: string };
  const mechanics = await db.select().from(usersTable)
    .where(and(eq(usersTable.role, "mechanic"), eq(usersTable.status, "active")));

  // For detailing, only include detailers; for other types, exclude detailer-tier
  const filtered = jobType
    ? mechanics.filter((m) => jobType === "detailing"
        ? m.mechanicTier === "detailer"
        : m.mechanicTier !== "detailer")
    : mechanics;

  const myFavs = req.userRole === "customer"
    ? new Set((await db.select().from(favoritesTable).where(eq(favoritesTable.customerId, req.userId!)))
        .map((f) => f.mechanicId))
    : new Set<number>();

  const out = await Promise.all(filtered.map(async (m) => {
    const [stats] = await db
      .select({ avg: avg(jobsTable.rating).as("avg"), n: count(jobsTable.id).as("n") })
      .from(jobsTable)
      .where(and(eq(jobsTable.mechanicId, m.id), isNotNull(jobsTable.rating)));
    const [done] = await db
      .select({ n: count(jobsTable.id).as("n") })
      .from(jobsTable)
      .where(and(eq(jobsTable.mechanicId, m.id), eq(jobsTable.status, "PAID")));
    const [flagged] = await db
      .select({ n: count(flagsTable.id).as("n") })
      .from(flagsTable)
      .where(eq(flagsTable.targetId, m.id));
    return {
      id: m.id,
      name: m.name,
      mechanicTier: m.mechanicTier ?? null,
      certifications: m.certifications ?? null,
      city: m.city ?? null,
      region: m.region ?? null,
      averageRating: stats?.avg != null ? Number(stats.avg) : null,
      reviewCount: Number(stats?.n ?? 0),
      completedJobs: Number(done?.n ?? 0),
      isFavorite: myFavs.has(m.id),
      flagCount: Number(flagged?.n ?? 0),
    };
  }));
  // Sort: favorites first, then by rating desc, then by completedJobs desc
  out.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    const ar = a.averageRating ?? 0; const br = b.averageRating ?? 0;
    if (br !== ar) return br - ar;
    return b.completedJobs - a.completedJobs;
  });
  res.json(out);
});

router.get("/mechanics/:mechanicId/reviews", authenticate, async (req: AuthRequest, res): Promise<void> => {
  const mechanicId = parseInt(String(req.params.mechanicId), 10);
  if (isNaN(mechanicId)) { res.status(400).json({ error: "Invalid mechanic id" }); return; }
  const rows = await db.select().from(jobsTable)
    .where(and(eq(jobsTable.mechanicId, mechanicId), isNotNull(jobsTable.rating)))
    .orderBy(desc(jobsTable.completedAt));
  const reviews = await Promise.all(rows.map(async (j) => {
    const [reviewer] = await db.select().from(usersTable).where(eq(usersTable.id, j.customerId));
    return {
      jobId: j.id,
      rating: j.rating!,
      text: j.mechanicReviewText ?? j.ratingNote ?? null,
      reviewerId: j.customerId,
      reviewerName: reviewer?.name ?? "Customer",
      createdAt: j.completedAt ?? j.createdAt,
    };
  }));
  res.json(reviews);
});

router.get("/me/reviews", authenticate, async (req: AuthRequest, res): Promise<void> => {
  // Mechanic: reviews from customers (rating + mechanicReviewText)
  // Customer: reviews from mechanics (customerRating + customerReviewText)
  const userId = req.userId!;
  if (req.userRole === "mechanic") {
    const rows = await db.select().from(jobsTable)
      .where(and(eq(jobsTable.mechanicId, userId), isNotNull(jobsTable.rating)))
      .orderBy(desc(jobsTable.completedAt));
    const reviews = await Promise.all(rows.map(async (j) => {
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, j.customerId));
      return {
        jobId: j.id, rating: j.rating!,
        text: j.mechanicReviewText ?? j.ratingNote ?? null,
        reviewerId: j.customerId, reviewerName: u?.name ?? "Customer",
        createdAt: j.completedAt ?? j.createdAt,
      };
    }));
    res.json(reviews); return;
  }
  if (req.userRole === "customer") {
    const rows = await db.select().from(jobsTable)
      .where(and(eq(jobsTable.customerId, userId), isNotNull(jobsTable.customerRating)))
      .orderBy(desc(jobsTable.completedAt));
    const reviews = await Promise.all(rows.map(async (j) => {
      const [u] = j.mechanicId
        ? await db.select().from(usersTable).where(eq(usersTable.id, j.mechanicId))
        : [null];
      return {
        jobId: j.id, rating: j.customerRating!,
        text: j.customerReviewText ?? null,
        reviewerId: j.mechanicId ?? 0, reviewerName: u?.name ?? "Mechanic",
        createdAt: j.completedAt ?? j.createdAt,
      };
    }));
    res.json(reviews); return;
  }
  res.json([]);
});

export default router;
