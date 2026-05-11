import { pgTable, serial, integer, text, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { jobsTable } from "./jobs";

/**
 * Reviews — one per (job, author). Either direction (customer→mechanic OR
 * mechanic→customer). The visibility-lock pattern is enforced in code, not
 * SQL: a row is `visibility="hidden"` until either both parties have
 * submitted a review for the same job, or `visibleAt` (submittedAt + 72h)
 * passes — whichever comes first. Hidden reviews still count for aggregates
 * but are never returned to opposing-side viewers.
 *
 * Category rating shape (1–5 each):
 *   customer→mechanic: { professionalism, communication, punctuality,
 *                        cleanliness, workmanship, efficiency, honesty,
 *                        vehicleCare }
 *   mechanic→customer: { communication, punctuality, safety, professionalism,
 *                        paymentReliability, accuracyOfDescription,
 *                        vehicleAccessibility, cooperation }
 */
export const reviewsTable = pgTable("reviews", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  authorRole: text("author_role", { enum: ["customer", "mechanic"] }).notNull(),
  subjectId: integer("subject_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  subjectRole: text("subject_role", { enum: ["customer", "mechanic"] }).notNull(),

  overallRating: integer("overall_rating").notNull(),  // 1..5
  categories: jsonb("categories").$type<Record<string, number>>().notNull().default({}),
  text: text("text"),
  photos: jsonb("photos").$type<string[]>().notNull().default([]),

  visibility: text("visibility", { enum: ["hidden", "visible", "removed"] }).notNull().default("hidden"),
  visibleAt: timestamp("visible_at", { withTimezone: true }).notNull(),  // submittedAt + 72h fallback

  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedBy: integer("removed_by").references(() => usersTable.id, { onDelete: "set null" }),
  removedReason: text("removed_reason"),

  // Forward-compatible bucket for AI trust scoring, identity verification,
  // anomaly detection, etc. Phase-5+ writers populate; safe to ignore today.
  trustSignals: jsonb("trust_signals").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [
  unique("reviews_job_author_uq").on(t.jobId, t.authorId),
  index("reviews_subject_idx").on(t.subjectId),
  index("reviews_job_idx").on(t.jobId),
  index("reviews_visibility_idx").on(t.visibility),
]);

export type Review = typeof reviewsTable.$inferSelect;

/**
 * Append-only audit history for every state change on a review (create, edit,
 * remove, restore, moderation). Snapshots are full JSON copies of the
 * before/after row so we can reconstruct any past state.
 */
export const reviewAuditLogsTable = pgTable("review_audit_logs", {
  id: serial("id").primaryKey(),
  reviewId: integer("review_id").notNull().references(() => reviewsTable.id, { onDelete: "cascade" }),
  action: text("action", { enum: ["created", "edited", "removed", "restored", "auto_published", "moderated"] }).notNull(),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  actorRole: text("actor_role"),
  before: jsonb("before").$type<Record<string, unknown> | null>(),
  after: jsonb("after").$type<Record<string, unknown> | null>(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("review_audit_review_idx").on(t.reviewId),
  index("review_audit_created_idx").on(t.createdAt),
]);
