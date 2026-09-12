import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehiclesTable = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  vin: text("vin").notNull(),
  plateNumber: text("plate_number"),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  trim: text("trim"),
  color: text("color"),
  mileage: integer("mileage").notNull(),
  // Optional per-vehicle insurance (used by fleet/dealership/GSA partners
  // who track coverage on each unit). Stored opaquely — APS does not
  // contact the carrier.
  insuranceCarrier: text("insurance_carrier"),
  insurancePolicyNumber: text("insurance_policy_number"),
  // Fleet linkage: when a fleet/GSA/dealership partner adds a vehicle, we
  // stamp the owning shop so the partner can list "their" fleet. NULL for
  // ordinary customer-owned vehicles (which use ownership history).
  ownerShopId: integer("owner_shop_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("vehicles_vin_unique").on(t.vin),
  uniqueIndex("vehicles_vin_lower_unique").on(sql`lower(${t.vin})`),
]);

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({ id: true, createdAt: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
