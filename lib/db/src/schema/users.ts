import { pgTable, serial, text, integer, timestamp, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["customer", "mechanic", "admin"] }).notNull().default("customer"),
  status: text("status", { enum: ["active", "suspended", "pending"] }).notNull().default("active"),
  avatarUrl: text("avatar_url"),
  pushToken: text("push_token"),
  referralCode: text("referral_code").unique(),
  mechanicTier: text("mechanic_tier", { enum: ["detailer", "technician", "senior", "master"] }).default("detailer"),
  certifications: text("certifications").default("[]"),
  loyaltyPoints: integer("loyalty_points").notNull().default(0),
  address: text("address"),
  city: text("city"),
  region: text("region"),
  zipCode: text("zip_code"),
  homeLat: doublePrecision("home_lat"),
  homeLng: doublePrecision("home_lng"),
  serviceRadiusMiles: integer("service_radius_miles"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
