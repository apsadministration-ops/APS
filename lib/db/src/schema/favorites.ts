import { pgTable, serial, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const favoritesTable = pgTable("favorites", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("favorites_customer_mechanic_unique").on(t.customerId, t.mechanicId),
  index("favorites_customer_idx").on(t.customerId),
  index("favorites_mechanic_idx").on(t.mechanicId),
]);

export type Favorite = typeof favoritesTable.$inferSelect;
