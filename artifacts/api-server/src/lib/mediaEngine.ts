/**
 * Media generation engine — orchestrates the provider abstraction, prompt
 * shaping, persistence, and storage of AI-generated images for social posts.
 *
 * Inputs: a `SocialPost` row + a list of intents (square_feed, vertical_reel,
 * landscape_header). For each intent we:
 *   1. Insert a `media_assets` row in `generating` state (so the UI can show
 *      a placeholder + retry if the server dies mid-generate).
 *   2. Call the configured provider.
 *   3. Persist PNG bytes to `STORAGE_DIR/<uuid>.png`.
 *   4. Update the asset row to `ready` with width/height/url + provider meta.
 *
 * Failures stamp `status="failed"` + `failureReason` on the row so the admin
 * can retry without losing context.
 */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, mediaAssetsTable, type MediaAsset, type SocialPost } from "@workspace/db";
import { logger } from "./logger";
import {
  MediaProviderError,
  MediaProviderNotConfiguredError,
  defaultImageProvider,
  getMediaProvider,
  type AspectRatio,
  type MediaIntent,
} from "./mediaProviders";

/**
 * Storage dir for generated PNG bytes. The api-server runs with cwd =
 * `artifacts/api-server/` under both `pnpm --filter` and the deployed
 * artifact runner, so a path relative to cwd lands in the package's own
 * `storage/` directory (already gitignored).
 *
 * NOTE: this is local-filesystem persistence — for production scale, swap
 * this for Replit Object Storage (the asset row's `url` column abstracts
 * the difference). The `MEDIA_STORAGE_DIR` env var lets ops point at a
 * mounted volume if needed.
 */
const STORAGE_DIR = path.resolve(
  process.env.MEDIA_STORAGE_DIR ?? path.join(process.cwd(), "storage", "media"),
);

let _storageReady = false;
async function ensureStorageDir(): Promise<void> {
  if (_storageReady) return;
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  _storageReady = true;
}

export function mediaStorageDir(): string {
  return STORAGE_DIR;
}

interface IntentSpec {
  intent: MediaIntent;
  aspectRatio: AspectRatio;
  label: string;
}

export const INTENT_SPECS: Record<MediaIntent, IntentSpec> = {
  square_feed:       { intent: "square_feed",       aspectRatio: "1:1",  label: "Square feed (1:1)" },
  vertical_reel:     { intent: "vertical_reel",     aspectRatio: "9:16", label: "Vertical reel (9:16)" },
  landscape_header:  { intent: "landscape_header",  aspectRatio: "16:9", label: "Landscape header (16:9)" },
  thumbnail:         { intent: "thumbnail",         aspectRatio: "1:1",  label: "Thumbnail (1:1)" },
  generic:           { intent: "generic",           aspectRatio: "1:1",  label: "Generic" },
};

/**
 * Build a visual prompt for the image model from a post's text content.
 *
 * The content engine already produces text descriptions in `mediaIdeas`.
 * If the admin supplies a `promptOverride` we use that verbatim. Otherwise
 * we synthesise a brand-consistent prompt from the topic + caption + first
 * media idea.
 */
export function buildImagePrompt(opts: {
  post: SocialPost;
  promptOverride?: string | null;
  intent: MediaIntent;
}): string {
  if (opts.promptOverride && opts.promptOverride.trim().length > 0) {
    return opts.promptOverride.trim();
  }
  const post = opts.post;
  const idea = post.mediaIdeas?.[0]?.trim();
  const captionPreview = post.caption.slice(0, 240).replace(/\s+/g, " ").trim();

  const brand = [
    "Professional automotive service marketplace marketing image.",
    "Brand voice: trusted, transparent, neighborhood, mechanic-first.",
    "Clean modern photography aesthetic with natural lighting.",
    "NO embedded text, NO logos, NO watermarks, NO captions in the image.",
  ];

  const topical: string[] = [];
  if (idea) topical.push(`Visual concept: ${idea}.`);
  if (post.region) topical.push(`Setting: ${post.region}, USA.`);
  topical.push(`Topic: ${post.topicTitle}.`);
  topical.push(`Context: ${captionPreview}`);

  const framing = opts.intent === "vertical_reel"
    ? "Composition: vertical 9:16 framing, optimized for mobile reels."
    : opts.intent === "landscape_header"
      ? "Composition: wide 16:9 framing suitable for a header or banner."
      : "Composition: balanced 1:1 square framing for feed.";

  return [...brand, ...topical, framing].join(" ");
}

export const NEGATIVE_PROMPT = [
  "text", "watermark", "logo", "lettering", "low quality", "blurry",
  "distorted hands", "extra fingers", "cartoon", "anime", "nsfw",
].join(", ");

export interface GenerateForPostOptions {
  post: SocialPost;
  intents: MediaIntent[];
  promptOverride?: string | null;
  providerKey?: string;
  userId: number;
}

export interface GenerateForPostResult {
  assets: MediaAsset[];
  errors: { intent: MediaIntent; error: string }[];
}

export async function generateImagesForPost(opts: GenerateForPostOptions): Promise<GenerateForPostResult> {
  const provider = opts.providerKey
    ? getMediaProvider(opts.providerKey)
    : defaultImageProvider();

  if (!provider) {
    throw new MediaProviderNotConfiguredError(
      opts.providerKey ?? "default",
      "No image provider is registered. Connect the Replit OpenAI integration.",
    );
  }
  if (!provider.capabilities.image) {
    throw new MediaProviderError(provider.key, "Provider does not support image generation");
  }

  await ensureStorageDir();

  const assets: MediaAsset[] = [];
  const errors: GenerateForPostResult["errors"] = [];

  // Sequential — image gen is heavy + can rate-limit. Same pattern as the
  // text generation batch endpoint.
  for (const intent of opts.intents) {
    const spec = INTENT_SPECS[intent];
    const prompt = buildImagePrompt({ post: opts.post, promptOverride: opts.promptOverride, intent });

    // 1. Placeholder row so the UI can show progress.
    const [placeholder] = await db.insert(mediaAssetsTable).values({
      kind: "image",
      status: "generating",
      socialPostId: opts.post.id,
      aspectRatio: spec.aspectRatio,
      intent,
      providerKey: provider.key,
      prompt,
      negativePrompt: NEGATIVE_PROMPT,
      generatedById: opts.userId,
    }).returning();

    try {
      const generated = await provider.generateImage({
        prompt,
        negativePrompt: NEGATIVE_PROMPT,
        aspectRatio: spec.aspectRatio,
      });

      const filename = `${randomUUID()}.png`;
      const filepath = path.join(STORAGE_DIR, filename);
      await fs.writeFile(filepath, generated.pngBytes);

      const [ready] = await db.update(mediaAssetsTable).set({
        status: "ready",
        url: `/api/media/files/${filename}`,
        width: generated.width,
        height: generated.height,
        providerModel: generated.model,
        providerMeta: generated.meta,
      }).where(eq(mediaAssetsTable.id, placeholder.id)).returning();
      assets.push(ready);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      logger.error({ err, postId: opts.post.id, intent }, "media generation failed");
      const [failed] = await db.update(mediaAssetsTable).set({
        status: "failed",
        failureReason: reason,
      }).where(eq(mediaAssetsTable.id, placeholder.id)).returning();
      assets.push(failed);
      errors.push({ intent, error: reason });
    }
  }

  return { assets, errors };
}

/** Delete the underlying PNG file for an asset (best-effort). */
export async function deleteAssetFile(asset: MediaAsset): Promise<void> {
  if (!asset.url) return;
  const m = asset.url.match(/\/api\/media\/files\/([A-Za-z0-9._-]+)$/);
  if (!m) return;
  const filename = m[1];
  // Defence in depth: only allow the uuid.png shape we generate.
  if (!/^[A-Za-z0-9_-]+\.png$/i.test(filename)) return;
  const filepath = path.join(STORAGE_DIR, filename);
  try {
    await fs.unlink(filepath);
  } catch (err) {
    logger.warn({ err, filepath }, "media file delete failed");
  }
}
