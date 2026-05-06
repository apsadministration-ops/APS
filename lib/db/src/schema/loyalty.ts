import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { jobsTable } from "./jobs";

export const loyaltyPointsTable = pgTable("loyalty_points", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  points: integer("points").notNull(),
  reason: text("reason").notNull(),
  jobId: integer("job_id").references(() => jobsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("loyalty_user_id_idx").on(t.userId),
]);

export type LoyaltyPoint = typeof loyaltyPointsTable.$inferSelect;
