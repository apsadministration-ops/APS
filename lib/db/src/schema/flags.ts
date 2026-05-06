import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { jobsTable } from "./jobs";

export const flagsTable = pgTable("flags", {
  id: serial("id").primaryKey(),
  reporterId: integer("reporter_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  targetId: integer("target_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  targetRole: text("target_role", { enum: ["customer", "mechanic"] }).notNull(),
  jobId: integer("job_id").references(() => jobsTable.id, { onDelete: "set null" }),
  type: text("type", { enum: ["scam", "rude", "no_show", "unsafe", "other"] }).notNull(),
  reason: text("reason"),
  resolved: boolean("resolved").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("flags_target_idx").on(t.targetId),
  index("flags_reporter_idx").on(t.reporterId),
]);

export type Flag = typeof flagsTable.$inferSelect;
