/**
 * Mechanic Amplification — public + mechanic-facing endpoints.
 *
 *   PUBLIC (no auth):
 *     GET  /p/m/:code             — HTML landing page for a mechanic's referral code
 *     GET  /p/m/:code/vcard       — downloadable .vcf contact card
 *     GET  /p/m/:code/card.svg    — downloadable / printable business card
 *
 *   MECHANIC (requireActiveMechanic):
 *     GET   /mechanics/me/amplification          — full kit (links, QR, vCard, card, starters)
 *     PATCH /mechanics/me/amplification          — update tagline/bio/brandColor/handles
 *     POST  /mechanics/me/amplification/content  — request AI variant (admin-queued)
 *     GET   /mechanics/me/amplification/content  — list this mechanic's draft + approved posts
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db, usersTable, mechanicAmplificationTable, socialPostsTable,
} from "@workspace/db";
import { authenticate, requireActiveMechanic, type AuthRequest } from "../middlewares/authenticate";
import { generateMechanicContent } from "../lib/contentEngine";
import {
  buildAmplificationKit, renderLandingHtml, personalLinks,
} from "../lib/mechanicAmplification";
import { assertAiGenerationAllowed, PolicyError } from "../lib/adminGrowthPolicy";
import {
  AnthropicUnavailableError,
  isAnthropicConfigured,
} from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

/* -------------------------------------------------------------------------- */
/* Public landing                                                             */
/* -------------------------------------------------------------------------- */

async function findMechanicByCode(code: string) {
  const [m] = await db.select().from(usersTable).where(and(
    eq(usersTable.role, "mechanic"),
    eq(usersTable.referralCode, code),
  ));
  return m ?? null;
}

router.get("/p/m/:code", async (req: Request, res: Response): Promise<void> => {
  const code = String(req.params.code ?? "").trim();
  if (!code) { res.status(400).send("Missing code"); return; }
  const mechanic = await findMechanicByCode(code);
  if (!mechanic) { res.status(404).type("text/html").send("<h1>Mechanic not found</h1>"); return; }
  const [page] = await db.select().from(mechanicAmplificationTable)
    .where(eq(mechanicAmplificationTable.mechanicId, mechanic.id));
  if (page && page.pageEnabled === false) {
    res.status(403).type("text/html").send("<h1>This page is currently unavailable.</h1>");
    return;
  }
  const kit = await buildAmplificationKit(mechanic, page ?? null);
  res.type("text/html").send(renderLandingHtml(kit));
});

router.get("/p/m/:code/vcard", async (req: Request, res: Response): Promise<void> => {
  const mechanic = await findMechanicByCode(String(req.params.code ?? ""));
  if (!mechanic) { res.status(404).send("Not found"); return; }
  const [page] = await db.select().from(mechanicAmplificationTable)
    .where(eq(mechanicAmplificationTable.mechanicId, mechanic.id));
  if (page && page.pageEnabled === false) { res.status(403).send("Page disabled"); return; }
  const kit = await buildAmplificationKit(mechanic, page ?? null);
  res.type("text/vcard")
    .setHeader("Content-Disposition", `attachment; filename="${(mechanic.name || "mechanic").replace(/\s+/g, "_")}.vcf"`)
    .send(kit.vCard);
});

router.get("/p/m/:code/card.svg", async (req: Request, res: Response): Promise<void> => {
  const mechanic = await findMechanicByCode(String(req.params.code ?? ""));
  if (!mechanic) { res.status(404).send("Not found"); return; }
  const [page] = await db.select().from(mechanicAmplificationTable)
    .where(eq(mechanicAmplificationTable.mechanicId, mechanic.id));
  if (page && page.pageEnabled === false) { res.status(403).send("Page disabled"); return; }
  const kit = await buildAmplificationKit(mechanic, page ?? null);
  res.type("image/svg+xml").send(kit.businessCardSvg);
});

/* -------------------------------------------------------------------------- */
/* Mechanic-facing                                                            */
/* -------------------------------------------------------------------------- */

router.use("/mechanics/me/amplification", authenticate, requireActiveMechanic);

router.get("/mechanics/me/amplification", async (req: AuthRequest, res: Response): Promise<void> => {
  const meId = req.userId!;
  const [mechanic] = await db.select().from(usersTable).where(eq(usersTable.id, meId));
  if (!mechanic) { res.status(404).json({ error: "Not found" }); return; }
  const [page] = await db.select().from(mechanicAmplificationTable)
    .where(eq(mechanicAmplificationTable.mechanicId, meId));
  const kit = await buildAmplificationKit(mechanic, page ?? null);
  res.json(kit);
});

const meAmpPatchSchema = z.object({
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

router.patch("/mechanics/me/amplification", async (req: AuthRequest, res: Response): Promise<void> => {
  const meId = req.userId!;
  const parsed = meAmpPatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  const [row] = await db.insert(mechanicAmplificationTable)
    .values({ mechanicId: meId, ...parsed.data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: mechanicAmplificationTable.mechanicId,
      set: { ...parsed.data, updatedAt: new Date() },
    }).returning();
  res.json(row);
});

const meContentSchema = z.object({
  variant: z.enum(["spotlight", "book_with_me", "referral_push"]),
  platform: z.enum(["facebook", "instagram", "tiktok", "twitter"]),
  briefingContext: z.string().trim().max(1000).optional().nullable(),
});

router.post("/mechanics/me/amplification/content", async (req: AuthRequest, res: Response): Promise<void> => {
  const meId = req.userId!;
  const parsed = meContentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", issues: parsed.error.issues }); return; }
  if (!isAnthropicConfigured()) {
    res.status(503).json({
      error: "ai_provider_not_configured",
      message: "AI content generation is temporarily unavailable.",
    });
    return;
  }
  try { await assertAiGenerationAllowed(); }
  catch (err) {
    if (err instanceof PolicyError) { res.status(err.statusCode).json({ error: err.message }); return; }
    throw err;
  }
  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, meId));
  if (!me) { res.status(404).json({ error: "Not found" }); return; }
  const [page] = await db.select().from(mechanicAmplificationTable)
    .where(eq(mechanicAmplificationTable.mechanicId, meId));
  let generated;
  try {
    generated = await generateMechanicContent({
      mechanic: {
        id: me.id, name: page?.displayName ?? me.name,
        region: me.region, city: me.city,
        specialty: page?.specialty ?? null,
        tagline: page?.tagline ?? null,
        referralCode: me.referralCode,
      },
      variant: parsed.data.variant,
      platform: parsed.data.platform,
      briefingContext: parsed.data.briefingContext ?? null,
    });
  } catch (err) {
    if (err instanceof AnthropicUnavailableError) {
      res.status(503).json({ error: "ai_provider_not_configured" });
      return;
    }
    req.log?.error({
      errorName: err instanceof Error ? err.name : "UnknownError",
    }, "mechanic-self content generation failed");
    res.status(502).json({ error: "content_generation_unavailable" });
    return;
  }
  const topicMap = { spotlight: "mechanic_spotlight", book_with_me: "book_through_aps", referral_push: "referral_campaign" } as const;
  const [post] = await db.insert(socialPostsTable).values({
    platform: parsed.data.platform,
    status: "pending_review",
    topicKind: topicMap[parsed.data.variant],
    topicTitle: `${parsed.data.variant}: ${me.name} (self-requested)`,
    region: me.city ?? me.region ?? null,
    caption: generated.caption,
    hashtags: generated.hashtags,
    mediaIdeas: generated.mediaIdeas,
    hookText: generated.hookText,
    callToAction: generated.callToAction,
    generationModel: generated.model,
    generationPrompt: generated.prompt,
    generatedById: me.id,
  }).returning();
  res.status(201).json(post);
});

router.get("/mechanics/me/amplification/content", async (req: AuthRequest, res: Response): Promise<void> => {
  const meId = req.userId!;
  const [me] = await db.select().from(usersTable).where(eq(usersTable.id, meId));
  if (!me) { res.status(404).json({ error: "Not found" }); return; }
  // Strict ownership: only posts this mechanic generated themselves.
  // (Admin-curated spotlights are surfaced separately on the admin queue.)
  const rows = await db.select().from(socialPostsTable)
    .where(eq(socialPostsTable.generatedById, meId))
    .orderBy(desc(socialPostsTable.createdAt))
    .limit(50);
  res.json({ posts: rows, links: personalLinks(me.referralCode) });
});

export default router;
