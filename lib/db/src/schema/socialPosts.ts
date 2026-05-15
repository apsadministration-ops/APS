import { pgTable, serial, integer, text, timestamp, jsonb, index, AnyPgColumn } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * AI-generated social media posts for the APS Growth Intelligence Center.
 *
 * SAFETY: status starts as `draft` or `pending_review`. The system MUST NOT
 * mark a post as `published` without an admin transitioning it through
 * `approved` first. The publishing endpoint enforces this in code.
 *
 * Lineage columns:
 *   - `parentPostId`  — set when this row is an analytics-driven iteration
 *                       (variant) of another post. See iterationEngine.ts.
 *   - `reusedFromId`  — set when this row is a scheduled reuse-clone of
 *                       a proven winner. See reuseEngine.ts.
 */
export const socialPostsTable = pgTable("social_posts", {
  id: serial("id").primaryKey(),
  platform: text("platform", {
    enum: ["facebook", "instagram", "tiktok", "twitter"],
  }).notNull(),
  status: text("status", {
    enum: ["draft", "pending_review", "approved", "rejected", "scheduled", "published"],
  }).notNull().default("pending_review"),
  topicKind: text("topic_kind").notNull(),
  topicTitle: text("topic_title").notNull(),
  region: text("region"),
  caption: text("caption").notNull(),
  hashtags: jsonb("hashtags").$type<string[]>().notNull().default([]),
  mediaIdeas: jsonb("media_ideas").$type<string[]>().notNull().default([]),
  hookText: text("hook_text"),
  callToAction: text("call_to_action"),
  /** Per-platform engagement metrics, recorded after publishing. */
  engagement: jsonb("engagement").$type<{
    likes?: number; shares?: number; comments?: number; saves?: number;
    clicks?: number; impressions?: number; signupConversions?: number;
    bookingConversions?: number;
  }>().notNull().default({}),
  /** Cached weighted engagement score; recomputed on engagement updates. */
  engagementScore: integer("engagement_score").notNull().default(0),
  generationModel: text("generation_model"),
  generationPrompt: text("generation_prompt"),
  generatedById: integer("generated_by_id").references(() => usersTable.id),
  reviewedById: integer("reviewed_by_id").references(() => usersTable.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNote: text("review_note"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  externalUrl: text("external_url"),
  /** Self-FK: parent post when this row is an analytics-driven iteration. */
  parentPostId: integer("parent_post_id").references((): AnyPgColumn => socialPostsTable.id, { onDelete: "set null" }),
  iteratedAt: timestamp("iterated_at", { withTimezone: true }),
  /** Self-FK: original post when this row is a reuse-clone of a winner. */
  reusedFromId: integer("reused_from_id").references((): AnyPgColumn => socialPostsTable.id, { onDelete: "set null" }),
  reuseCount: integer("reuse_count").notNull().default(0),
  lastReusedAt: timestamp("last_reused_at", { withTimezone: true }),
  /** Publishing attempt counters — managed by publishingEngine. */
  publishAttemptCount: integer("publish_attempt_count").notNull().default(0),
  lastPublishError: text("last_publish_error"),
  lastPublishAttemptAt: timestamp("last_publish_attempt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("social_posts_status_idx").on(t.status),
  index("social_posts_platform_idx").on(t.platform),
  index("social_posts_topic_kind_idx").on(t.topicKind),
  index("social_posts_scheduled_idx").on(t.scheduledFor),
  index("social_posts_parent_idx").on(t.parentPostId),
  index("social_posts_reused_from_idx").on(t.reusedFromId),
  index("social_posts_engagement_score_idx").on(t.engagementScore),
]);

export type SocialPost = typeof socialPostsTable.$inferSelect;
export type SocialPostInsert = typeof socialPostsTable.$inferInsert;
