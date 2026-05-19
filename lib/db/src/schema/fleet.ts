import { pgTable, serial, integer, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { vehiclesTable } from "./vehicles";

export const FLEET_SOURCE_TYPES = ["consumer", "fleet", "commercial"] as const;
export type FleetSourceType = (typeof FLEET_SOURCE_TYPES)[number];

export const FLEET_PRIORITIES = ["standard", "priority", "urgent"] as const;
export type FleetPriority = (typeof FLEET_PRIORITIES)[number];

export const FLEET_SERVICE_TIERS = ["basic", "premium", "enterprise"] as const;
export type FleetServiceTier = (typeof FLEET_SERVICE_TIERS)[number];

export const fleetAccountsTable = pgTable("fleet_accounts", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id),
  companyName: text("company_name").notNull(),
  accountKind: text("account_kind", { enum: ["fleet", "commercial"] }).notNull().default("fleet"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  serviceTier: text("service_tier", { enum: FLEET_SERVICE_TIERS }).notNull().default("basic"),
  defaultPriority: text("default_priority", { enum: FLEET_PRIORITIES }).notNull().default("standard"),
  responseTimeMinutes: integer("response_time_minutes").notNull().default(240),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("fleet_accounts_owner_idx").on(t.ownerId),
]);

export const fleetContractsTable = pgTable("fleet_contracts", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => fleetAccountsTable.id, { onDelete: "cascade" }),
  contractNumber: text("contract_number").notNull(),
  name: text("name").notNull(),
  priorityOverride: text("priority_override", { enum: FLEET_PRIORITIES }),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("fleet_contracts_account_idx").on(t.accountId),
]);

export const fleetVehiclesTable = pgTable("fleet_vehicles", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => fleetAccountsTable.id, { onDelete: "cascade" }),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id),
  vin: text("vin").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("fleet_vehicles_account_idx").on(t.accountId),
  index("fleet_vehicles_vin_idx").on(t.vin),
]);

export const insertFleetAccountSchema = createInsertSchema(fleetAccountsTable).omit({ id: true, createdAt: true });
export const insertFleetContractSchema = createInsertSchema(fleetContractsTable).omit({ id: true, createdAt: true });
export const insertFleetVehicleSchema = createInsertSchema(fleetVehiclesTable).omit({ id: true, createdAt: true });

export type FleetAccount = typeof fleetAccountsTable.$inferSelect;
export type FleetContract = typeof fleetContractsTable.$inferSelect;
export type FleetVehicle = typeof fleetVehiclesTable.$inferSelect;
export type InsertFleetAccount = z.infer<typeof insertFleetAccountSchema>;
export type InsertFleetContract = z.infer<typeof insertFleetContractSchema>;
export type InsertFleetVehicle = z.infer<typeof insertFleetVehicleSchema>;
