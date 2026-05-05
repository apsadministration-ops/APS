import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { vehiclesTable } from "./vehicles";

export const ownershipTable = pgTable("ownership_history", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  vin: text("vin").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull().defaultNow(),
  endDate: timestamp("end_date", { withTimezone: true }),
  transferVerified: boolean("transfer_verified").notNull().default(false),
}, (t) => [
  index("ownership_vin_idx").on(t.vin),
  index("ownership_vehicle_id_idx").on(t.vehicleId),
]);

export const insertOwnershipSchema = createInsertSchema(ownershipTable).omit({ id: true });
export type InsertOwnership = z.infer<typeof insertOwnershipSchema>;
export type Ownership = typeof ownershipTable.$inferSelect;
