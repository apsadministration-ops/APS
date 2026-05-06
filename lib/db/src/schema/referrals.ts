import { pgTable, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const referralsTable = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull().references(() => usersTable.id),
  referredId: integer("referred_id").notNull().references(() => usersTable.id),
  rewarded: boolean("rewarded").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("referrals_referrer_id_idx").on(t.referrerId),
]);

export type Referral = typeof referralsTable.$inferSelect;
