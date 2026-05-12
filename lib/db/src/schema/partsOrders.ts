/**
 * Parts-order lifecycle.
 *
 * A parts order is created by a mechanic from the VIN-aware "Source Parts"
 * picker. It moves through the states:
 *
 *   candidate → ordered → received → installed
 *                       ↘ cancelled / returned
 *
 * `confidence` is snapshotted at creation time so we have a permanent
 * record of how sure the engine was when the mechanic placed the order.
 * `validation_state` snapshots whether the engine blocked, warned, or
 * passed the order — and `validation_reasons` records exactly why so the
 * customer/admin can audit later.
 *
 * Customer-safe view (`partsOrderEngine.customerView`) exposes brand,
 * warranty, qty, and total — NEVER supplier_key, supplier_sku, or any
 * margin/payout field.
 */

import {
  pgTable, serial, integer, text, timestamp, jsonb, index,
} from "drizzle-orm/pg-core";
import { jobsTable } from "./jobs";
import { vehiclesTable } from "./vehicles";
import { usersTable } from "./users";
import { partsCatalogTable } from "./partsCatalog";

export const PARTS_ORDER_STATUS_VALUES = [
  "candidate", "ordered", "received", "installed", "returned", "cancelled",
] as const;
export type PartsOrderStatus = (typeof PARTS_ORDER_STATUS_VALUES)[number];

export const PARTS_ORDER_CONFIDENCE_VALUES = [
  "exact_vin", "oem_confirmed", "supplier_confirmed", "universal", "manual_verify",
] as const;
export type PartsOrderConfidence = (typeof PARTS_ORDER_CONFIDENCE_VALUES)[number];

export const PARTS_ORDER_VALIDATION_VALUES = ["passed", "warned", "blocked"] as const;
export type PartsOrderValidation = (typeof PARTS_ORDER_VALIDATION_VALUES)[number];

export const partsOrdersTable = pgTable("parts_orders", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id, { onDelete: "cascade" }),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id),
  vin: text("vin").notNull(),
  mechanicId: integer("mechanic_id").notNull().references(() => usersTable.id),
  catalogId: integer("catalog_id").notNull().references(() => partsCatalogTable.id),
  supplierKey: text("supplier_key").notNull(),
  sku: text("sku").notNull(),
  qty: integer("qty").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(),
  totalPriceCents: integer("total_price_cents").notNull(),
  status: text("status", { enum: PARTS_ORDER_STATUS_VALUES }).notNull().default("candidate"),
  confidence: text("confidence", { enum: PARTS_ORDER_CONFIDENCE_VALUES }).notNull(),
  validationState: text("validation_state", { enum: PARTS_ORDER_VALIDATION_VALUES }).notNull(),
  validationReasons: jsonb("validation_reasons").$type<string[]>().notNull().default([]),
  supplierInvoiceUrl: text("supplier_invoice_url"),
  supplierOrderRef: text("supplier_order_ref"),
  orderedAt: timestamp("ordered_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  installedAt: timestamp("installed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("parts_orders_job_idx").on(t.jobId),
  index("parts_orders_vehicle_idx").on(t.vehicleId),
  index("parts_orders_vin_idx").on(t.vin),
  index("parts_orders_mechanic_idx").on(t.mechanicId),
  index("parts_orders_status_idx").on(t.status),
]);

export type PartsOrder = typeof partsOrdersTable.$inferSelect;
