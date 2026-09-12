import {
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  serial,
  check,
  text,
  timestamp,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnerOrganizationsTable } from "./partnerOrganizations";
import { shopsTable } from "./shops";
import { vehiclesTable } from "./vehicles";

export const PARTNER_INVENTORY_STATUSES = [
  "in_stock",
  "preparing",
  "ready",
  "sold",
] as const;

export const PARTNER_OPERATING_STATUSES = [
  "active",
  "maintenance",
  "out_of_service",
  "retired",
] as const;

/**
 * Operational information belongs to the organization/location relationship,
 * not to the canonical vehicle, ownership history, work logs, or customer
 * profile. One canonical vehicle may be registered by at most one partner
 * organization at a time.
 */
export const partnerVehicleOperationsTable = pgTable(
  "partner_vehicle_operations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => partnerOrganizationsTable.id),
    vehicleId: integer("vehicle_id")
      .notNull()
      .references(() => vehiclesTable.id),
    linkedShopId: integer("linked_shop_id").notNull(),

    stockNumber: text("stock_number"),
    inventoryStatus: text("inventory_status", {
      enum: PARTNER_INVENTORY_STATUSES,
    }),
    serviceNeeded: boolean("service_needed"),
    serviceNotes: text("service_notes"),

    unitNumber: text("unit_number"),
    groupName: text("group_name"),
    operatingStatus: text("operating_status", {
      enum: PARTNER_OPERATING_STATUSES,
    }),
    odometer: integer("odometer"),
    usageHours: doublePrecision("usage_hours"),
    maintenanceDueDate: date("maintenance_due_date", { mode: "string" }),
    maintenanceDueMileage: integer("maintenance_due_mileage"),
    downtimeSince: timestamp("downtime_since", { withTimezone: true }),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // This composite FK prevents an operation from pointing at a location
    // belonging to a different organization. `shops` supplies the matching
    // unique key while retaining its existing owner-consistency FK.
    foreignKey({
      name: "partner_vehicle_operations_org_shop_fk",
      columns: [table.organizationId, table.linkedShopId],
      foreignColumns: [shopsTable.organizationId, shopsTable.id],
    }),
    uniqueIndex("partner_vehicle_operations_vehicle_unique").on(
      table.vehicleId,
    ),
    index("partner_vehicle_operations_org_idx").on(table.organizationId),
    index("partner_vehicle_operations_shop_idx").on(table.linkedShopId),
    // Keep enum and non-negative guarantees in the database as well as in
    // request validation. The subtype-specific required-field checks remain
    // server-side because they depend on the organization row.
    check(
      "partner_vehicle_operations_inventory_status_check",
      sql`${table.inventoryStatus} IS NULL OR ${table.inventoryStatus} IN ('in_stock', 'preparing', 'ready', 'sold')`,
    ),
    check(
      "partner_vehicle_operations_operating_status_check",
      sql`${table.operatingStatus} IS NULL OR ${table.operatingStatus} IN ('active', 'maintenance', 'out_of_service', 'retired')`,
    ),
    check(
      "partner_vehicle_operations_nonnegative_check",
      sql`(${table.odometer} IS NULL OR ${table.odometer} >= 0)
        AND (${table.usageHours} IS NULL OR ${table.usageHours} >= 0)
        AND (${table.maintenanceDueMileage} IS NULL OR ${table.maintenanceDueMileage} >= 0)`,
    ),
  ],
);

export const insertPartnerVehicleOperationSchema = createInsertSchema(
  partnerVehicleOperationsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertPartnerVehicleOperation = z.infer<
  typeof insertPartnerVehicleOperationSchema
>;
export type PartnerVehicleOperation =
  typeof partnerVehicleOperationsTable.$inferSelect;