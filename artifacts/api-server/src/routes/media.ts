/**
 * Media asset routes.
 *
 *  - Admin queue routes (live under /admin/growth/...):
 *      POST   /admin/growth/content/:id/media/generate
 *      GET    /admin/growth/content/:id/media
 *      PATCH  /admin/growth/media/:assetId
 *      DELETE /admin/growth/media/:assetId
 *      GET    /admin/growth/media/providers
 *
 *  - Public file route (no auth — unguessable UUID filenames):
 *      GET    /media/files/:filename
 */
import { Router, type IRouter } from "express";
import path from "node:path";
import { promises as fs } from "node:fs";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db, mediaAssetsTable, socialPostsTable, type MediaAsset,
} from "@workspace/db";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate";
import { assertAiGenerationAllowed, PolicyError } from "../lib/adminGrowthPolicy";
import {
  generateImagesForPost,
  deleteAssetFile,
  mediaStorageDir,
  INTENT_SPECS,
} from "../lib/mediaEngine";
import { listMediaProviders } from "../lib/mediaProviders";
import { MediaProviderNotConfiguredError, MediaProviderError } from "../lib/mediaProviders/types";

const router: IRouter = Router();

/* -------------------------------------------------------------------------- */
/* Public file route — unguessable UUID filenames, allow-listed extension     */
/* -------------------------------------------------------------------------- */

router.get("/media/files/:filename", async (req, res): Promise<void> => {
  const filename = req.params.filename;
  // Defence in depth: only allow `<safe>.png`. Reject path-traversal and
  // dotfiles. The UUIDs we emit only contain [A-Za-z0-9-].
  if (!/^[A-Za-z0-9_-]+\.png$/.test(filename)) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const filepath = path.join(mediaStorageDir(), filename);
  // Re-resolve to make absolutely sure we're inside the storage dir.
  if (!path.resolve(filepath).startsWith(path.resolve(mediaStorageDir()))) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  try {
    const stat = await fs.stat(filepath);
    if (!stat.isFile()) { res.status(404).end(); return; }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Content-Length", String(stat.size));
    const stream = (await import("node:fs")).createReadStream(filepath);
    stream.pipe(res);
  } catch {
    res.status(404).end();
  }
});

/* -------------------------------------------------------------------------- */
/* Admin routes                                                               */
/* -------------------------------------------------------------------------- */

router.use("/admin/growth", authenticate, requireRole("admin"));

router.get("/admin/growth/media/providers", (_req: AuthRequest, res): void => {
  const providers = listMediaProviders().map((p) => ({
    key: p.key,
    label: p.label,
    capabilities: p.capabilities,
    configured: p.isConfigured(),
  }));
  const intents = (Object.keys(INTENT_SPECS) as Array<keyof typeof INTENT_SPECS>)
    .map((k) => ({
      value: k,
      label: INTENT_SPECS[k].label,
      aspectRatio: INTENT_SPECS[k].aspectRatio,
    }));
  res.json({ providers, intents });
});

const generateSchema = z.object({
  intents: z
    .array(z.enum(["square_feed", "vertical_reel", "landscape_header", "thumbnail", "generic"]))
    .min(1).max(4),
  promptOverride: z.string().trim().max(2000).nullable().optional(),
  providerKey: z.string().trim().min(1).max(80).optional(),
});

router.post("/admin/growth/content/:id/media/generate", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }

  const [post] = await db.select().from(socialPostsTable).where(eq(socialPostsTable.id, id));
  if (!post) { res.status(404).json({ error: "Post not found" }); return; }
  if (post.status === "published") {
    res.status(409).json({ error: "Cannot generate media for a published post" });
    return;
  }

  try { await assertAiGenerationAllowed(); }
  catch (err) {
    if (err instanceof PolicyError) { res.status(err.statusCode).json({ error: err.message }); return; }
    throw err;
  }

  try {
    const result = await generateImagesForPost({
      post,
      intents: parsed.data.intents,
      promptOverride: parsed.data.promptOverride ?? null,
      providerKey: parsed.data.providerKey,
      userId: req.userId!,
    });
    res.status(result.errors.length === parsed.data.intents.length ? 502 : 201).json(result);
  } catch (err) {
    if (err instanceof MediaProviderNotConfiguredError) {
      res.status(503).json({
        error: "image_provider_not_configured",
        message: err.message,
        providerKey: err.providerKey,
      });
      return;
    }
    if (err instanceof MediaProviderError) {
      res.status(502).json({ error: "image_provider_error", message: err.message });
      return;
    }
    req.log?.error({ err, postId: id }, "media generate failed");
    res.status(500).json({ error: "Media generation failed" });
  }
});

router.get("/admin/growth/content/:id/media", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.select().from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.socialPostId, id))
    .orderBy(desc(mediaAssetsTable.createdAt));
  res.json(rows);
});

const patchSchema = z.object({
  status: z.enum(["approved", "rejected"]).optional(),
  reviewNote: z.string().trim().max(500).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "Empty patch" });

router.patch("/admin/growth/media/:assetId", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.assetId);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }

  if (parsed.data.status) {
    // Atomic transition: only allow approve/reject from `ready` (or each other).
    const allowedFrom: MediaAsset["status"][] =
      parsed.data.status === "approved" ? ["ready", "rejected"] : ["ready", "approved"];
    const updated = await db.update(mediaAssetsTable).set({
      status: parsed.data.status,
      reviewNote: parsed.data.reviewNote ?? null,
      reviewedById: req.userId!,
      reviewedAt: new Date(),
    }).where(and(
      eq(mediaAssetsTable.id, id),
      inArray(mediaAssetsTable.status, allowedFrom),
    )).returning();
    if (updated.length > 0) { res.json(updated[0]); return; }
    const [existing] = await db.select({ status: mediaAssetsTable.status })
      .from(mediaAssetsTable).where(eq(mediaAssetsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    res.status(409).json({ error: `Cannot transition from ${existing.status} to ${parsed.data.status}` });
    return;
  }

  // Note-only update.
  const [updated] = await db.update(mediaAssetsTable).set({
    reviewNote: parsed.data.reviewNote ?? null,
    reviewedById: req.userId!,
    reviewedAt: new Date(),
  }).where(eq(mediaAssetsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/admin/growth/media/:assetId", async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.assetId);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  // Delete file best-effort before row.
  await deleteAssetFile(existing);
  await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.id, id));
  res.status(204).end();
});

export default router;
