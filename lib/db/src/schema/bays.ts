import { pgTable, serial, integer, text, timestamp, real, json, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { shopsTable } from "./shops";

/**
 * Optional weekly opening windows for a bay. An empty object preserves the
 * legacy behavior (a bay is available at any time while it and its shop are
 * active). Times are UTC `HH:mm` values; the route layer validates and
 * normalizes client input before it is written.
 */
export type BayAvailabilityConfig = {
  timezone?: "UTC";
  weekly?: Array<{
    dayOfWeek: number;
    open: string;
    close: string;
  }>;
};

// A rentable service bay inside a shop. Tier + job-category restrictions
// are enforced server-side at booking time (see routes/bookings.ts).
export const baysTable = pgTable("bays", {
  id: serial("id").primaryKey(),
  shopId: integer("shop_id").notNull().references(() => shopsTable.id),
  name: text("name").notNull(),
  hourlyRate: real("hourly_rate").notNull(),
  // Free-form equipment list (e.g. "2-post lift", "tire machine", "compressor").
  equipment: json("equipment").$type<string[]>().notNull().default([]),
  // Subset of job categories this bay accepts.
  allowedJobCategories: json("allowed_job_categories")
    .$type<("repair" | "diagnostic" | "maintenance" | "detailing")[]>()
    .notNull()
    .default([]),
  // Lowest mechanic tier permitted to book.
  minMechanicTier: text("min_mechanic_tier", {
    enum: ["detailer", "technician", "senior", "advanced", "master"],
  }).notNull().default("detailer"),
  autoApprove: boolean("auto_approve").notNull().default(false),
  // Legacy rows use an empty config, which means "available any time". The
  // additive Part 6 migration adds this column without rewriting bay rows.
  availabilityConfig: json("availability_config").$type<BayAvailabilityConfig>().notNull().default({}),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("bays_shop_id_idx").on(t.shopId),
  index("bays_status_idx").on(t.status),
]);

export const insertBaySchema = createInsertSchema(baysTable).omit({ id: true, createdAt: true });
export type InsertBay = z.infer<typeof insertBaySchema>;
export type Bay = typeof baysTable.$inferSelect;
