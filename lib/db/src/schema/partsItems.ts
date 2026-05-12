import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { workLogsTable } from "./worklogs";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";

export const partsItemsTable = pgTable("parts_items", {
  id: serial("id").primaryKey(),
  workLogId: integer("work_log_id").notNull().references(() => workLogsTable.id, { onDelete: "cascade" }),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  partNumber: text("part_number"),
  brand: text("brand"),
  supplier: text("supplier"),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(),
  totalCents: integer("total_cents").notNull(),
  receiptImageUrl: text("receipt_image_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("parts_items_worklog_idx").on(t.workLogId),
  index("parts_items_job_idx").on(t.jobId),
  index("parts_items_mechanic_idx").on(t.mechanicId),
]);

export const insertPartsItemSchema = createInsertSchema(partsItemsTable).omit({ id: true, createdAt: true });
export type InsertPartsItem = z.infer<typeof insertPartsItemSchema>;
export type PartsItem = typeof partsItemsTable.$inferSelect;
