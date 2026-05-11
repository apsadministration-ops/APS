import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const mechanicCertificationsTable = pgTable("mechanic_certifications", {
  id: serial("id").primaryKey(),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  certificationType: text("certification_type").notNull(),
  issuingInstitution: text("issuing_institution").notNull(),
  issueDate: timestamp("issue_date", { withTimezone: true }).notNull(),
  expirationDate: timestamp("expiration_date", { withTimezone: true }),
  documentUrl: text("document_url").notNull(),
  documentKind: text("document_kind", { enum: ["pdf", "image", "other"] }).notNull().default("pdf"),
  // Mapped to which tier-progression gates this cert can satisfy.
  // basic = entry/foundational (ASE Maintenance, OSHA, manufacturer training)
  // advanced = ASE A1-A8, advanced manufacturer programs, master tech
  skillLevel: text("skill_level", { enum: ["basic", "advanced"] }).notNull().default("basic"),
  status: text("status", { enum: ["pending", "verified", "rejected"] }).notNull().default("pending"),
  reviewNote: text("review_note"),
  reviewedBy: integer("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("mechanic_certs_mechanic_idx").on(t.mechanicId),
  index("mechanic_certs_status_idx").on(t.status),
]);

export const insertMechanicCertificationSchema = createInsertSchema(mechanicCertificationsTable).omit({
  id: true, createdAt: true, updatedAt: true, reviewedBy: true, reviewedAt: true, status: true, reviewNote: true,
});
export type InsertMechanicCertification = z.infer<typeof insertMechanicCertificationSchema>;
export type MechanicCertification = typeof mechanicCertificationsTable.$inferSelect;
