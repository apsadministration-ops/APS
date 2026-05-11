/**
 * Mechanic tier progression + certification routes.
 *
 *   Mechanic-side
 *     GET    /mechanic/me/progression         — current tier, metrics, next-tier blockers
 *     GET    /mechanic/me/promotion-history   — immutable audit log
 *     GET    /mechanic/me/certifications      — own certifications (any status)
 *     POST   /mechanic/me/certifications      — upload metadata (status: pending)
 *     DELETE /mechanic/me/certifications/:id  — remove a still-pending certification
 *
 *   Admin-side
 *     GET   /admin/certifications?status=pending  — review queue
 *     PATCH /admin/certifications/:id             — verify or reject (triggers re-evaluation)
 *     GET   /admin/promotions/pending             — mechanics flagged for master review
 *     GET   /admin/mechanics/:id/progression      — single mechanic snapshot
 *     POST  /admin/mechanics/:id/promote          — admin-finalize a master promotion
 */

import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  usersTable,
  mechanicCertificationsTable,
  tierPromotionsTable,
} from "@workspace/db";
import { authenticate, requireRole, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";
import {
  evaluateMechanic,
  runProgression,
  adminPromoteToMaster,
  MECHANIC_TIER_LABELS,
  TIER_ORDER,
  type MechanicTier,
} from "../lib/tierProgressionEngine";

const router: IRouter = Router();

/* -------------------------------------------------------------------------- */
/* MECHANIC SELF                                                              */
/* -------------------------------------------------------------------------- */

router.get("/mechanic/me/progression", authenticate, requireRole("mechanic"), async (req: AuthRequest, res): Promise<void> => {
  const evaluation = await evaluateMechanic(req.userId!);
  res.json({
    ...evaluation,
    currentTierLabel: MECHANIC_TIER_LABELS[evaluation.currentTier],
    nextTierLabel: evaluation.next ? MECHANIC_TIER_LABELS[evaluation.next.to] : null,
    tierOrder: TIER_ORDER,
    tierLabels: MECHANIC_TIER_LABELS,
  });
});

router.get("/mechanic/me/promotion-history", authenticate, requireRole("mechanic"), async (req: AuthRequest, res): Promise<void> => {
  const rows = await db.select().from(tierPromotionsTable)
    .where(eq(tierPromotionsTable.mechanicId, req.userId!))
    .orderBy(desc(tierPromotionsTable.createdAt));
  res.json(rows);
});

router.get("/mechanic/me/certifications", authenticate, requireRole("mechanic"), async (req: AuthRequest, res): Promise<void> => {
  const rows = await db.select().from(mechanicCertificationsTable)
    .where(eq(mechanicCertificationsTable.mechanicId, req.userId!))
    .orderBy(desc(mechanicCertificationsTable.createdAt));
  res.json(rows);
});

const createCertSchema = z.object({
  certificationType: z.string().trim().min(2).max(120),
  issuingInstitution: z.string().trim().min(2).max(120),
  issueDate: z.coerce.date(),
  expirationDate: z.coerce.date().nullable().optional(),
  documentUrl: z.string().trim().min(1).max(2048),
  documentKind: z.enum(["pdf", "image", "other"]).default("pdf"),
  skillLevel: z.enum(["basic", "advanced"]).default("basic"),
});

router.post("/mechanic/me/certifications", authenticate, requireRole("mechanic"), async (req: AuthRequest, res): Promise<void> => {
  const parsed = createCertSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid certification payload", issues: parsed.error.issues }); return; }
  if (parsed.data.expirationDate && parsed.data.expirationDate <= parsed.data.issueDate) {
    res.status(400).json({ error: "Expiration date must be after issue date" }); return;
  }
  const [created] = await db.insert(mechanicCertificationsTable).values({
    mechanicId: req.userId!,
    certificationType: parsed.data.certificationType,
    issuingInstitution: parsed.data.issuingInstitution,
    issueDate: parsed.data.issueDate,
    expirationDate: parsed.data.expirationDate ?? null,
    documentUrl: parsed.data.documentUrl,
    documentKind: parsed.data.documentKind,
    skillLevel: parsed.data.skillLevel,
    status: "pending",
  }).returning();
  res.status(201).json(created);
});

router.delete("/mechanic/me/certifications/:id", authenticate, requireRole("mechanic"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [cert] = await db.select().from(mechanicCertificationsTable).where(eq(mechanicCertificationsTable.id, id));
  if (!cert) { res.status(404).json({ error: "Certification not found" }); return; }
  if (cert.mechanicId !== req.userId!) { res.status(403).json({ error: "Forbidden" }); return; }
  // Once verified, certifications form part of the immutable promotion audit trail
  // and cannot be removed by the mechanic.
  if (cert.status !== "pending") { res.status(409).json({ error: "Only pending certifications can be removed" }); return; }
  await db.delete(mechanicCertificationsTable).where(eq(mechanicCertificationsTable.id, id));
  res.status(204).end();
});

/* -------------------------------------------------------------------------- */
/* ADMIN                                                                      */
/* -------------------------------------------------------------------------- */

router.get("/admin/certifications", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const status = req.query.status as string | undefined;
  const rows = status
    ? await db.select().from(mechanicCertificationsTable)
        .where(eq(mechanicCertificationsTable.status, status as "pending" | "verified" | "rejected"))
        .orderBy(desc(mechanicCertificationsTable.createdAt))
    : await db.select().from(mechanicCertificationsTable)
        .orderBy(desc(mechanicCertificationsTable.createdAt));
  // Decorate with mechanic name for the admin queue UI.
  const out = await Promise.all(rows.map(async (c) => {
    const [m] = await db.select().from(usersTable).where(eq(usersTable.id, c.mechanicId));
    return { ...c, mechanicName: m?.name ?? null, mechanicEmail: m?.email ?? null, mechanicTier: m?.mechanicTier ?? null };
  }));
  res.json(out);
});

const reviewCertSchema = z.object({
  status: z.enum(["verified", "rejected"]),
  reviewNote: z.string().trim().max(500).nullable().optional(),
});

router.patch("/admin/certifications/:id", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = reviewCertSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid review payload", issues: parsed.error.issues }); return; }
  const [cert] = await db.select().from(mechanicCertificationsTable).where(eq(mechanicCertificationsTable.id, id));
  if (!cert) { res.status(404).json({ error: "Certification not found" }); return; }
  if (cert.status !== "pending") { res.status(409).json({ error: `Certification already ${cert.status}` }); return; }
  const [updated] = await db.update(mechanicCertificationsTable)
    .set({
      status: parsed.data.status,
      reviewNote: parsed.data.reviewNote ?? null,
      reviewedBy: req.userId!,
      reviewedAt: new Date(),
    })
    .where(eq(mechanicCertificationsTable.id, id))
    .returning();
  // A newly verified cert can unlock the detailer→technician auto-promotion.
  let progression = null;
  if (parsed.data.status === "verified") {
    progression = await runProgression(cert.mechanicId, "certification_verified", {
      adminId: req.userId!, logger: req.log,
    });
  }
  res.json({ certification: updated, progression });
});

router.get("/admin/promotions/pending", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  // Find all mechanics currently at 'advanced' tier and evaluate them for master.
  const advanced = await db.select().from(usersTable)
    .where(and(eq(usersTable.role, "mechanic"), eq(usersTable.mechanicTier, "advanced")));
  const results = await Promise.all(advanced.map(async (m) => {
    const evaluation = await evaluateMechanic(m.id);
    return {
      mechanicId: m.id,
      mechanicName: m.name,
      mechanicEmail: m.email,
      currentTier: evaluation.currentTier,
      metrics: evaluation.metrics,
      next: evaluation.next,
      flaggedForAdminReview: evaluation.next?.blockers === null,
    };
  }));
  // Surface eligible candidates first.
  results.sort((a, b) => Number(b.flaggedForAdminReview) - Number(a.flaggedForAdminReview));
  res.json(results);
});

router.get("/admin/mechanics/:id/progression", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user || user.role !== "mechanic") { res.status(404).json({ error: "Mechanic not found" }); return; }
  const evaluation = await evaluateMechanic(id);
  const history = await db.select().from(tierPromotionsTable)
    .where(eq(tierPromotionsTable.mechanicId, id))
    .orderBy(desc(tierPromotionsTable.createdAt));
  res.json({
    ...evaluation,
    currentTierLabel: MECHANIC_TIER_LABELS[evaluation.currentTier],
    nextTierLabel: evaluation.next ? MECHANIC_TIER_LABELS[evaluation.next.to] : null,
    history,
  });
});

const promoteSchema = z.object({
  bypassThresholds: z.boolean().optional(),
});

router.post("/admin/mechanics/:id/promote", authenticate, requireRole("admin"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = promoteSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid promote payload" }); return; }
  try {
    const result = await adminPromoteToMaster(id, req.userId!, {
      logger: req.log,
      bypassThresholds: parsed.data.bypassThresholds,
    });
    res.json(result);
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Promotion failed" });
  }
});

export default router;
