import {
  pgTable, serial, integer, text, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { socialPostsTable } from "./socialPosts";

/**
 * AI-generated media assets attached to social posts.
 *
 * Phase A: images only. `kind` is left open so future video assets reuse
 * the same table + workflow without a migration.
 *
 * Safety: assets start as `pending_review`. The admin queue surfaces them
 * alongside the parent post so they can be approved/rejected/regenerated
 * before the post itself is published.
 *
 * Storage: images are written to the api-server's local storage dir and
 * served via `/api/media/files/:filename` (filename is a UUID). The `url`
 * column stores that relative path; clients prepend the API base.
 */
export const mediaAssetsTable = pgTable("media_assets", {
  id: serial("id").primaryKey(),

  /** "image" today; "video" reserved for Phase C. */
  kind: text("kind", { enum: ["image", "video"] }).notNull().default("image"),

  /** Approval state — mirrors social_posts lifecycle but per-asset. */
  status: text("status", {
    enum: ["generating", "ready", "failed", "approved", "rejected"],
  }).notNull().default("generating"),

  /** Parent social post. Nullable so we can support library-mode assets later. */
  socialPostId: integer("social_post_id").references(() => socialPostsTable.id, {
    onDelete: "cascade",
  }),

  /** Aspect framing — drives provider sizing + UI grouping. */
  aspectRatio: text("aspect_ratio", {
    enum: ["1:1", "9:16", "16:9", "4:3", "3:4"],
  }).notNull().default("1:1"),

  /** Logical role on the platform: feed post, story/reel, header, etc. */
  intent: text("intent", {
    enum: ["square_feed", "vertical_reel", "landscape_header", "thumbnail", "generic"],
  }).notNull().default("generic"),

  width: integer("width"),
  height: integer("height"),

  /** Relative URL (e.g. `/api/media/files/abc.png`) — clients prepend the API base. */
  url: text("url"),

  /** Provider key from the media-provider registry (e.g. "openai-image"). */
  providerKey: text("provider_key").notNull(),

  /** Provider model identifier (e.g. "gpt-image-1"). */
  providerModel: text("provider_model"),

  /** Full text prompt sent to the provider (system + user merged). */
  prompt: text("prompt").notNull(),

  /** Negative/avoid prompt, optional. */
  negativePrompt: text("negative_prompt"),

  /** Free-form provider response metadata (revised prompt, safety flags, etc.). */
  providerMeta: jsonb("provider_meta").$type<Record<string, unknown>>().notNull().default({}),

  /** Populated when status="failed". */
  failureReason: text("failure_reason"),

  generatedById: integer("generated_by_id").references(() => usersTable.id),
  reviewedById: integer("reviewed_by_id").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("media_assets_post_idx").on(t.socialPostId),
  index("media_assets_status_idx").on(t.status),
  index("media_assets_kind_idx").on(t.kind),
]);

export type MediaAsset = typeof mediaAssetsTable.$inferSelect;
export type NewMediaAsset = typeof mediaAssetsTable.$inferInsert;
